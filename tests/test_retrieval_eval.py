# Retrieval quality eval harness. Runs a fixed set of realistic Vietnamese
# questions (tests/evals/retrieval_cases.json) against POST /api/retrieve and
# checks that the expected source document shows up in the top-3 matches.
# This is the guardrail that tells us whether a model or chunking change made
# retrieval better or worse — see the case list for how each query is a
# paraphrase of its target document, not a copy of its wording.
import json
import pathlib
import re
import time

import pytest
import requests

# Resolved from this file's location rather than the process CWD, so the
# suite works regardless of the directory pytest is invoked from.
CASES_PATH = pathlib.Path(__file__).parent / "evals" / "retrieval_cases.json"
CASES = json.loads(CASES_PATH.read_text(encoding="utf-8"))

# Project root / content directory, derived the same CWD-independent way as
# CASES_PATH above (tests/ is a direct child of the project root).
CONTENT_DIR = pathlib.Path(__file__).parent.parent / "content"

_FIVE_GRAM_LEN = 5


def _normalize_tokens(text):
    """Lowercase, strip punctuation, collapse whitespace, split on spaces.

    Vietnamese diacritics are deliberately NOT stripped — token identity is
    the accented word, not an ASCII-folded approximation of it, since
    stripping diacritics would blur distinct Vietnamese words together and
    both weaken and pollute the overlap check.
    """
    text = text.lower()
    # \w is unicode-aware for str patterns in Python 3, so this keeps
    # letters (including diacritics) and digits, and only strips actual
    # punctuation/symbols.
    text = re.sub(r"[^\w\s]", " ", text, flags=re.UNICODE)
    return text.split()


def _five_grams(tokens):
    return {
        tuple(tokens[i : i + _FIVE_GRAM_LEN])
        for i in range(len(tokens) - _FIVE_GRAM_LEN + 1)
    }


def _find_content_file(doc_id):
    """Locate content/**/<doc_id>.md by stem, without hardcoding grade
    folders, so this test doesn't need updating when content is reorganized
    into new grade directories."""
    matches = sorted(CONTENT_DIR.glob(f"**/{doc_id}.md"))
    assert matches, (
        f"no content file found for doc_id '{doc_id}' under {CONTENT_DIR} "
        f"(searched **/{doc_id}.md)"
    )
    return matches[0]


@pytest.fixture(scope="session")
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
    That is a real settle signal; a guessed fixed delay is not. This
    fixture is session-scoped, so it runs once per test session (the first
    test that requests it triggers the wait; every later request in the
    same session reuses the already-settled result), not once per case.

    Deliberately NOT autouse: this module also holds an offline, no-network
    confound-guard test (test_case_has_no_lexical_confound_with_target_document)
    that must collect and pass with no env vars set, same as test_chunker.py.
    An autouse fixture here would force that test through base_url/
    auth_headers too and skip it whenever secrets aren't configured. Instead,
    only the live retrieval test below explicitly requests this fixture.

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
        payload = response.json()
        index = payload.get("index")
        # A null `index` means the VECTORIZE binding is missing from the
        # deployment — a misconfiguration, not a slow index. Waiting 120s and
        # then reporting "did not settle" describes the wrong problem, which
        # is exactly the ambiguity authFailure() was built to remove. Say so
        # at once.
        if index is None:
            pytest.fail(
                "rag-status reports no index: the VECTORIZE binding is "
                "missing from this deployment. Bindings are applied at BUILD "
                "time, so adding one in the Cloudflare dashboard has no "
                "effect until the project is redeployed. Nothing here is a "
                "settling problem — see docs/RAG-OPERATIONS.md."
            )
        if "error" in index:
            pytest.fail(f"rag-status could not describe the index: {index['error']}")
        count = index.get("vectorCount")

        if count is not None and count == previous_count:
            stable_polls += 1
            if stable_polls >= consecutive_stable_polls_required:
                return
        else:
            stable_polls = 0
        previous_count = count
        time.sleep(poll_interval_seconds)

    # Timed out without confirming settlement. Fail loudly here rather than
    # proceeding: if we let the suite continue, a stalled ingest surfaces
    # only as ordinary-looking "wrong doc_id" failures in the retrieval
    # cases below, with the real cause (the index never settled) buried in
    # captured stdout that most operators never read. A hard failure with
    # the observed counts in the message makes the true cause the first
    # thing anyone sees.
    pytest.fail(
        f"index did not settle within {timeout_seconds}s "
        f"(last observed vectorCount={previous_count}, "
        f"required {consecutive_stable_polls_required} consecutive stable "
        f"polls every {poll_interval_seconds}s); retrieval eval results "
        f"below this point would be checked against a possibly-unsettled "
        f"index and cannot be trusted"
    )


@pytest.mark.parametrize("case", CASES, ids=[c["query"] for c in CASES])
def test_expected_document_is_retrieved(
    case, base_url, auth_headers, wait_for_index_to_settle
):
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


@pytest.mark.parametrize("case", CASES, ids=[c["query"] for c in CASES])
def test_case_has_no_lexical_confound_with_target_document(case):
    """
    Offline, mechanical confound guard: no network access and no secrets,
    so it runs (and must pass) in a bare shell with no env vars set, the
    same as test_chunker.py.

    A case whose query copies a run of words straight from its own target
    document can be "won" by lexical overlap alone, even if the embedding
    model's semantic understanding is poor or regresses — which would make
    the whole eval suite falsely reassuring. This encodes that standard as
    a test instead of relying on manual review to catch it (manual review
    is exactly how the confounded cases this guard exists to prevent got
    into the suite in the first place).

    The check: no shared contiguous 5-token span between the normalized
    query and the normalized full text of its target document.
    """
    doc_path = _find_content_file(case["expect_doc_id"])
    doc_text = doc_path.read_text(encoding="utf-8")

    query_grams = _five_grams(_normalize_tokens(case["query"]))
    doc_grams = _five_grams(_normalize_tokens(doc_text))

    shared = query_grams & doc_grams
    assert not shared, (
        f"query for case expect_doc_id={case['expect_doc_id']!r} shares a "
        f"5-word span with its own target document ({doc_path.name}): "
        f"{' '.join(next(iter(shared)))!r} -- query was: {case['query']!r}"
    )
