"""Uploads one real content file through the full chunk -> /api/ingest path.

This WRITES TO PRODUCTION: the index it updates is the one students' chat
retrieves from, and it publishes the WORKING-TREE copy of the file —
uncommitted edits included. So it only runs when RAG_ALLOW_PROD_WRITES=1 is
set. Run it deliberately, from a checkout whose copy of this file is the one
you mean to publish.
"""
import pathlib

import pytest

from scripts.rag import upload as upload_module
from scripts.rag.upload import (
    MutationTimeout,
    _stale_ids,
    upload_markdown_file,
    wait_for_mutation,
)

# Resolved from this file's location rather than the process CWD, so the test
# finds the file whichever directory pytest is started from.
CONTENT_FILE = (
    pathlib.Path(__file__).parent.parent
    / "content" / "grade1" / "phep-cong-trong-pham-vi-10.md"
)


def test_uploads_a_markdown_file(allow_prod_writes, base_url, ingest_secret):
    count = upload_markdown_file(
        str(CONTENT_FILE),
        base_url=base_url,
        secret=ingest_secret,
    )
    assert count > 0


# --------------------------------------------------------------------------
# Safe re-upload (I3). These run fully offline against a fake transport, so
# they cover the prune window and the mutation wait without touching the live
# index — the parts that are hardest to observe against production, since a
# same-count re-upload leaves nothing visible to check.
# --------------------------------------------------------------------------

SAMPLE_MD = """# Bai hoc

Doan van thu nhat.

## Muc hai

Doan van thu hai.
"""


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload
        self.status_code = 200

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


def test_stale_ids_starts_at_the_chunk_count_and_spans_the_window():
    """The first ID pruned is the one just past the last chunk written: a
    document that shrank from 7 chunks to 5 must have :0005 and :0006
    deleted, and must NOT have :0004 (a live chunk) deleted."""
    ids = _stale_ids("lesson", chunk_count=5, window=3)
    assert ids == ["lesson:0005", "lesson:0006", "lesson:0007"]
    assert "lesson:0004" not in ids


def test_upload_prunes_stale_chunks_and_waits_on_the_delete_mutation(
        tmp_path, monkeypatch):
    source = tmp_path / "lesson.md"
    source.write_text(SAMPLE_MD, encoding="utf-8")

    posts = []

    def fake_post(url, json=None, headers=None, timeout=None):
        posts.append((url, json))
        if url.endswith("/api/ingest") and "chunks" in json:
            return _FakeResponse({"upserted": len(json["chunks"]),
                                  "mutationId": "upsert-mutation",
                                  "deleted": 0, "deleteMutationId": None})
        if url.endswith("/api/ingest") and "delete_ids" in json:
            return _FakeResponse({"upserted": 0, "mutationId": None,
                                  "deleted": len(json["delete_ids"]),
                                  "deleteMutationId": "delete-mutation"})
        if url.endswith("/api/rag-status"):
            return _FakeResponse(
                {"index": {"processedUpToMutation": "delete-mutation"}})
        raise AssertionError(f"unexpected request to {url}")

    monkeypatch.setattr(upload_module.requests, "post", fake_post)

    count = upload_markdown_file(str(source), base_url="https://example.invalid",
                                 secret="unused", prune_window=4)
    assert count == 2

    delete_bodies = [body for _, body in posts if body and "delete_ids" in body]
    assert len(delete_bodies) == 1
    assert delete_bodies[0]["delete_ids"] == [
        "lesson:0002", "lesson:0003", "lesson:0004", "lesson:0005",
    ]

    # The wait must have happened, and against the LATER (delete) mutation.
    assert any(url.endswith("/api/rag-status") for url, _ in posts)


def test_prune_window_is_split_into_batches_vectorize_will_accept(
        tmp_path, monkeypatch):
    """Vectorize rejects more than 100 ids per deleteByIds call (error 40007).
    The default 200-wide prune window must therefore go out as two requests —
    this is the bug that made the live upload return 502."""
    source = tmp_path / "lesson.md"
    source.write_text(SAMPLE_MD, encoding="utf-8")

    delete_batches = []

    def fake_post(url, json=None, headers=None, timeout=None):
        if url.endswith("/api/ingest") and "chunks" in json:
            return _FakeResponse({"upserted": len(json["chunks"]),
                                  "mutationId": "upsert-mutation"})
        if url.endswith("/api/ingest") and "delete_ids" in json:
            delete_batches.append(json["delete_ids"])
            return _FakeResponse({"upserted": 0, "mutationId": None,
                                  "deleted": len(json["delete_ids"]),
                                  "deleteMutationId": "delete-mutation"})
        return _FakeResponse(
            {"index": {"processedUpToMutation": "delete-mutation"}})

    monkeypatch.setattr(upload_module.requests, "post", fake_post)
    upload_markdown_file(str(source), base_url="https://example.invalid",
                         secret="unused")

    assert len(delete_batches) == 2
    assert all(len(b) <= upload_module.DELETE_BATCH_SIZE for b in delete_batches)
    # Every id in the window is still covered, none duplicated or dropped.
    flat = [i for b in delete_batches for i in b]
    assert flat == _stale_ids("lesson", 2, upload_module.PRUNE_WINDOW)


def test_wait_for_mutation_returns_once_the_watermark_reaches_the_target(
        monkeypatch):
    seen = iter(["older-mutation", "older-mutation", "target-mutation"])

    def fake_post(url, json=None, headers=None, timeout=None):
        return _FakeResponse({"index": {"processedUpToMutation": next(seen)}})

    monkeypatch.setattr(upload_module.requests, "post", fake_post)
    monkeypatch.setattr(upload_module.time, "sleep", lambda s: None)

    wait_for_mutation("https://example.invalid", "unused", "target-mutation")


def test_wait_for_mutation_raises_rather_than_returning_on_stale_index(
        monkeypatch):
    """The failure this replaces was silent — the caller read vectors that
    predated the upload and reported success."""
    def fake_post(url, json=None, headers=None, timeout=None):
        return _FakeResponse({"index": {"processedUpToMutation": "some-other"}})

    monkeypatch.setattr(upload_module.requests, "post", fake_post)
    monkeypatch.setattr(upload_module.time, "sleep", lambda s: None)

    with pytest.raises(MutationTimeout):
        wait_for_mutation("https://example.invalid", "unused",
                          "target-mutation", timeout=0.05, poll_interval=0.01)
