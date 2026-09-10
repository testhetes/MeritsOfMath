# Retrieval quality eval harness. Runs a fixed set of realistic Vietnamese
# questions (tests/evals/retrieval_cases.json) against POST /api/retrieve and
# checks that the expected source document shows up in the top-3 matches.
# This is the guardrail that tells us whether a model or chunking change made
# retrieval better or worse — see the case list for how each query is a
# paraphrase of its target document, not a copy of its wording.
import json
import pathlib
import time

import pytest
import requests

# Resolved from this file's location rather than the process CWD, so the
# suite works regardless of the directory pytest is invoked from.
CASES_PATH = pathlib.Path(__file__).parent / "evals" / "retrieval_cases.json"
CASES = json.loads(CASES_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="session", autouse=True)
def wait_for_index_to_settle(base_url, auth_headers):
    """
    Cloudflare Vectorize is *eventually consistent*: vectors upserted by the
    ingest step are not immediately queryable. Running this exact eval suite
    twice back to back, with no change to the model, the content, or the
    queries, scored 6/10 on the first run and 9/10 on the second — purely
    because the index had not finished settling before the first run's
    queries executed (per-case scores on the flipped cases rose, e.g.
    0.536->0.677). A fixed `time.sleep(20)` was tried and was NOT enough.

    So: before any eval assertion runs, poll POST /api/rag-status and wait
    for `index.vectorCount` to stop increasing across consecutive polls.
    That is a real settle signal; a guessed fixed delay is not. This fixture
    is session-scoped and autouse (within this module only) so it runs once
    per test session, not once per case.

    DO NOT replace this with a bare time.sleep() — a future reader might be
    tempted to "simplify" it that way, but a fixed delay can't know how long
    ingestion will actually take and will silently reintroduce the flake
    this fixture exists to prevent.
    """
    poll_interval_seconds = 3
    consecutive_stable_polls_required = 3
    timeout_seconds = 120

    deadline = time.monotonic() + timeout_seconds
    previous_count = None
    stable_polls = 0

    while time.monotonic() < deadline:
        response = requests.post(
            f"{base_url}/api/rag-status",
            headers=auth_headers,
            timeout=30,
        )
        # Deliberately no header/body echo here — this is a live-secret
        # request and assertion messages must never be able to leak it.
        assert response.status_code == 200, (
            f"rag-status check failed with HTTP {response.status_code}"
        )
        index = response.json().get("index") or {}
        count = index.get("vectorCount")

        if count is not None and count == previous_count:
            stable_polls += 1
            if stable_polls >= consecutive_stable_polls_required:
                return
        else:
            stable_polls = 0
        previous_count = count
        time.sleep(poll_interval_seconds)

    # Timed out without confirming settlement. Proceed rather than hang
    # forever, but a low score right after this warning should be treated
    # as suspect rather than as proof the embedding model is bad.
    print(
        f"WARNING: index did not settle within {timeout_seconds}s "
        f"(last observed vectorCount={previous_count}); proceeding anyway"
    )


@pytest.mark.parametrize("case", CASES, ids=[c["query"] for c in CASES])
def test_expected_document_is_retrieved(case, base_url, auth_headers):
    response = requests.post(
        f"{base_url}/api/retrieve",
        json={"query": case["query"], "topK": 3},
        headers=auth_headers,
        timeout=60,
    )
    assert response.status_code == 200, response.text
    matches = response.json()["matches"]
    assert matches, "no matches returned"
    doc_ids = [m["doc_id"] for m in matches]
    assert case["expect_doc_id"] in doc_ids, (
        f"expected '{case['expect_doc_id']}' in top-3, got {doc_ids}"
    )
