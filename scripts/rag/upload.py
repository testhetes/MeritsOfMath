"""Chunk a reviewed Markdown file and push it to the /api/ingest endpoint.

Re-uploading safely
-------------------
Chunk IDs are positional (`{doc_id}:{chunk_index:04d}`) and an upsert only
ever overwrites the IDs it is given. So a lesson edited from 7 chunks down to
5 would keep `{doc_id}:0005` and `{doc_id}:0006` in the index forever, and a
child could later be shown text that was deleted from the curriculum months
earlier.

Vectorize has no "list the IDs of this document" API, so after uploading a
document's N chunks this module deletes a *window* of IDs above N
(`{doc_id}:{N:04d}` .. `{doc_id}:{N+PRUNE_WINDOW-1:04d}`). Deleting an ID that
does not exist is a harmless no-op, which is what makes a blind window safe
and removes the need for a listing API.

It then waits on the returned mutationId rather than on vectorCount. A
same-count re-upload (a lesson edited without changing how many chunks it
produces) leaves vectorCount completely unchanged, so a count-watching wait
returns immediately and anything reading the index next — the retrieval eval,
a child's chat turn — is served the OLD vectors. `processedUpToMutation` from
/api/rag-status is the real signal.

Renaming a source file is NOT handled here: the new name produces a whole new
doc_id and every vector under the OLD doc_id is orphaned, untouched by this
prune. See docs/RAG-OPERATIONS.md for the manual cleanup.
"""

import os
import pathlib
import sys
import time

import requests

from scripts.rag.chunker import chunk_markdown

BATCH_SIZE = 25

# How far above the current chunk count to prune. A document would have to
# lose more than this many chunks in a single edit for a stale vector to
# survive; 200 is far beyond any realistic lesson (the largest today is 9
# chunks) and still one request, since /api/ingest accepts 500 delete_ids.
PRUNE_WINDOW = 200

# Vectorize rejects more than 100 ids in one deleteByIds call (error 40007), so
# a prune window wider than this is sent as several requests.
DELETE_BATCH_SIZE = 100

# Vectorize applies mutations asynchronously. Observed settling is a few
# seconds; this ceiling only decides how long to wait before calling it a
# failure rather than letting callers read stale vectors silently.
MUTATION_TIMEOUT_SECONDS = 180
MUTATION_POLL_SECONDS = 3


class MutationTimeout(RuntimeError):
    """Raised when a write does not become visible within the timeout.

    Deliberately an exception rather than a warning: the failure mode this
    replaces was a silent one, where the caller carried on and read vectors
    that predated the upload.
    """


def wait_for_mutation(base_url: str, secret: str, mutation_id: str,
                      timeout: float = MUTATION_TIMEOUT_SECONDS,
                      poll_interval: float = MUTATION_POLL_SECONDS) -> None:
    """Block until Vectorize reports it has processed `mutation_id`.

    `processedUpToMutation` is a watermark, so waiting on the last mutation a
    document issued implies every earlier one has been applied too.
    """
    headers = {"Authorization": f"Bearer {secret}"}
    deadline = time.monotonic() + timeout
    observed = None
    while time.monotonic() < deadline:
        response = requests.post(f"{base_url}/api/rag-status",
                                 headers=headers, timeout=30)
        # No header or body echo here: this request carries the live secret
        # and nothing about it may reach an error message.
        if response.status_code != 200:
            raise MutationTimeout(
                f"rag-status returned HTTP {response.status_code} while "
                f"waiting for a mutation to be applied"
            )
        index = response.json().get("index") or {}
        observed = index.get("processedUpToMutation")
        if observed == mutation_id:
            return
        time.sleep(poll_interval)
    raise MutationTimeout(
        f"mutation {mutation_id} was not applied within {timeout:.0f}s "
        f"(processedUpToMutation is still {observed!r}); anything read from "
        f"the index now may predate this upload"
    )


def _stale_ids(doc_id: str, chunk_count: int, window: int) -> list[str]:
    return [f"{doc_id}:{i:04d}"
            for i in range(chunk_count, chunk_count + window)]


def upload_markdown_file(path: str, base_url: str, secret: str,
                         doc_id: str | None = None,
                         prune: bool = True,
                         wait: bool = True,
                         prune_window: int = PRUNE_WINDOW) -> int:
    """Upload one Markdown file. Returns the number of chunks upserted.

    Also prunes stale higher-numbered chunk IDs left by a previous, longer
    version of the document, and waits for the write to become visible.
    """
    file_path = pathlib.Path(path)
    md = file_path.read_text(encoding="utf-8")
    doc_id = doc_id or file_path.stem

    chunks = chunk_markdown(md, doc_id=doc_id)
    if not chunks:
        return 0

    headers = {"Authorization": f"Bearer {secret}"}
    total = 0
    last_mutation = None

    for start in range(0, len(chunks), BATCH_SIZE):
        batch = chunks[start:start + BATCH_SIZE]
        response = requests.post(
            f"{base_url}/api/ingest",
            json={"chunks": batch},
            headers=headers,
            timeout=180,
        )
        response.raise_for_status()
        body = response.json()
        total += body["upserted"]
        last_mutation = body.get("mutationId") or last_mutation

    if prune and prune_window > 0:
        stale = _stale_ids(doc_id, len(chunks), prune_window)
        for start in range(0, len(stale), DELETE_BATCH_SIZE):
            response = requests.post(
                f"{base_url}/api/ingest",
                json={"delete_ids": stale[start:start + DELETE_BATCH_SIZE]},
                headers=headers,
                timeout=180,
            )
            response.raise_for_status()
            last_mutation = (response.json().get("deleteMutationId")
                             or last_mutation)

    if wait and last_mutation:
        wait_for_mutation(base_url, secret, last_mutation)

    return total


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python -m scripts.rag.upload <markdown-file> [more-files...]")
        raise SystemExit(2)
    base_url = os.environ["RAG_BASE_URL"]
    secret = os.environ["INGEST_SECRET"]
    grand_total = 0
    for path in sys.argv[1:]:
        count = upload_markdown_file(path, base_url=base_url, secret=secret)
        print(f"{path}: {count} chunks (pruned + confirmed applied)")
        grand_total += count
    print(f"TOTAL: {grand_total} chunks")


if __name__ == "__main__":
    main()
