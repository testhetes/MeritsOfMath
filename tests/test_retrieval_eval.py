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
import unicodedata

import pytest
import requests

# Resolved from this file's location rather than the process CWD, so the
# suite works regardless of the directory pytest is invoked from.
EVALS_DIR = pathlib.Path(__file__).parent / "evals"
CASES_PATH = EVALS_DIR / "retrieval_cases.json"
CASES = json.loads(CASES_PATH.read_text(encoding="utf-8"))

# Queries that should match NOTHING: off-topic chatter, gibberish, and the
# short mid-conversation replies that make up most real chat turns.
NEGATIVES_PATH = EVALS_DIR / "retrieval_negatives.json"
NEGATIVES = json.loads(NEGATIVES_PATH.read_text(encoding="utf-8"))

# Project root / content directory, derived the same CWD-independent way as
# CASES_PATH above (tests/ is a direct child of the project root).
CONTENT_DIR = pathlib.Path(__file__).parent.parent / "content"

_FIVE_GRAM_LEN = 5

# --------------------------------------------------------------------------
# Scores, and the floor.
#
# The chat endpoint takes the top TOP_K matches and drops anything scoring
# below a floor. Until this wave the floor was 0.45, a number taken from an
# early four-score probe — three of whose four queries were later found to be
# lexically confounded and were rewritten, so the floor rested on discarded
# evidence. It has now been re-derived against the whole distribution (88
# vectors, 16 accented cases, 16 unaccented variants, 14 negative probes).
#
# MEASURED, 2026-09-12, @cf/baai/bge-m3, topK=5:
#   accented positives (best score for the expected doc)  0.442 .. 0.723
#   unaccented positives (where retrieved at all)         0.347 .. 0.572
#   negatives (top score)                                 0.347 .. 0.505
#
# The ranges OVERLAP, and at the boundary they are inverted: the best
# negative ("Mẹ em nấu món canh chua cá lóc..." -> phep-tru-trong-pham-vi-10,
# 0.505) outscores the weakest genuine retrieval (0.442), and the lowest
# negative ties the lowest genuine unaccented retrieval at 0.347. So NO
# absolute floor separates relevant from irrelevant on this index, and 0.45
# in particular is wrong in both directions at once: it admits 5 of 14
# negatives while rejecting one accented positive and ten of sixteen
# unaccented ones — i.e. it silently switches retrieval off for children who
# type without diacritics.
#
# SCORE_FLOOR is therefore set BELOW everything genuine that was observed and
# is documented as a pathological-garbage filter, NOT a relevance gate. What
# actually separates a real turn from noise is the query construction: the
# two-turn query Plan 2 builds scores 0.659..0.750 on the same index, far
# clear of every negative. Relevance has to come from that and from the
# prompt, not from thresholding a cosine score.
# --------------------------------------------------------------------------

SCORE_FLOOR = 0.30

# Regression ceiling for irrelevant queries. Today's worst negative is 0.505;
# this catches a change that makes noise look materially more relevant
# without pretending a floor can filter it.
NEGATIVE_CEILING = 0.55

# topK the chat endpoint uses, so the eval measures the same candidate set.
EVAL_TOP_K = 5

# Unaccented variants: 11 of 16 currently retrieve their document in the top
# 3. A ratchet one below that records the real capability and catches a
# regression, without overstating it.
MIN_UNACCENTED_TOP3 = 10


def strip_accents(text):
    """Vietnamese typed without diacritics, as children on a plain keyboard
    actually type it. 'đ' has no combining form, so it is mapped first."""
    text = text.replace("đ", "d").replace("Đ", "D")
    decomposed = unicodedata.normalize("NFD", text)
    return unicodedata.normalize(
        "NFC", "".join(c for c in decomposed if not unicodedata.combining(c))
    )


# Derived from the accented cases rather than written by hand, so every
# unaccented variant is provably the same question as a case that already
# passes the lexical-confound guard below.
UNACCENTED_CASES = [
    {"query": strip_accents(c["query"]),
     "expect_doc_id": c["expect_doc_id"],
     "accented_query": c["query"]}
    for c in CASES
]


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


# --------------------------------------------------------------------------
# Score recording.
#
# Every query in the eval runs ONCE, in a session-scoped fixture, and the
# scores are kept in a table the assertions below read. Without this, each
# new assertion meant another round trip per case; with it the whole
# distribution — positives, unaccented variants and negatives together — is
# available to the assertion that has to reason about all three at once.
# --------------------------------------------------------------------------


def _retrieve(base_url, auth_headers, query, top_k=EVAL_TOP_K):
    response = requests.post(
        f"{base_url}/api/retrieve",
        json={"query": query, "topK": top_k},
        headers=auth_headers,
        timeout=60,
    )
    # No header or body echo: this request carries the live secret.
    assert response.status_code == 200, (
        f"/api/retrieve returned HTTP {response.status_code}"
    )
    return response.json()["matches"]


def _row(kind, label, expect_doc_id, matches):
    docs = [m["doc_id"] for m in matches]
    best = max((m["score"] for m in matches if m["doc_id"] == expect_doc_id),
               default=0.0)
    rank = docs.index(expect_doc_id) + 1 if expect_doc_id in docs else 0
    return {
        "kind": kind,
        "label": label,
        "expect_doc_id": expect_doc_id or "(none)",
        "best_score": best,
        "rank": rank,
        "top_score": matches[0]["score"] if matches else 0.0,
        "top_doc_id": matches[0]["doc_id"] if matches else "-",
    }


@pytest.fixture(scope="session")
def score_table(base_url, auth_headers, wait_for_index_to_settle):
    rows = []
    for case in CASES:
        rows.append(_row("positive", case["query"], case["expect_doc_id"],
                         _retrieve(base_url, auth_headers, case["query"])))
    for case in UNACCENTED_CASES:
        rows.append(_row("unaccented", case["query"], case["expect_doc_id"],
                         _retrieve(base_url, auth_headers, case["query"])))
    for case in NEGATIVES:
        rows.append(_row("negative", case["query"], None,
                         _retrieve(base_url, auth_headers, case["query"])))
    return rows


def _by_kind(rows, kind):
    return [r for r in rows if r["kind"] == kind]


def _lookup(rows, kind, label):
    for row in rows:
        if row["kind"] == kind and row["label"] == label:
            return row
    raise AssertionError(f"no {kind} row recorded for {label!r}")


@pytest.mark.parametrize("case", CASES, ids=[c["query"] for c in CASES])
def test_expected_document_clears_the_score_floor(case, score_table):
    """Containment in the top 3 is not enough: the chat endpoint also drops
    anything below SCORE_FLOOR, so a case can 'pass' the containment test and
    still contribute nothing to a child's answer. This asserts the score the
    chat will actually see."""
    row = _lookup(score_table, "positive", case["query"])
    assert row["best_score"] >= SCORE_FLOOR, (
        f"{case['expect_doc_id']} scored {row['best_score']:.3f}, below the "
        f"{SCORE_FLOOR} floor — chat would discard this match even though the "
        f"document is the right one"
    )


def test_unaccented_variants_still_retrieve_their_document(score_table):
    """Vietnamese children routinely type without diacritics. Every case is
    re-run with its accents stripped.

    This is an aggregate ratchet rather than a per-case assertion on purpose:
    unaccented retrieval genuinely does NOT work for all sixteen (11/16 reach
    the top 3 today), and asserting per case would mean hand-picking the ones
    that happen to work — exactly the cherry-picking that produced the
    discredited 0.45 probe. The ratchet records the real rate and fails if it
    drops; the printed table names every individual failure.
    """
    rows = _by_kind(score_table, "unaccented")
    in_top_3 = [r for r in rows if 0 < r["rank"] <= 3]
    missed = [r["expect_doc_id"] for r in rows if not 0 < r["rank"] <= 3]
    assert len(in_top_3) >= MIN_UNACCENTED_TOP3, (
        f"only {len(in_top_3)}/{len(rows)} unaccented variants retrieved "
        f"their document in the top 3 (need {MIN_UNACCENTED_TOP3}); "
        f"missed: {missed}"
    )


@pytest.mark.parametrize("case", NEGATIVES,
                         ids=[c["query"] for c in NEGATIVES])
def test_negative_case_does_not_look_more_relevant_than_it_is(
        case, score_table):
    """Off-topic text, gibberish and bare replies like '5' must not score
    like a real question.

    NOTE what this does NOT assert. The brief was to assert that a negative
    stays below the score floor; on this index no such floor exists — the
    best negative (0.505) outscores the weakest genuine retrieval (0.442).
    Asserting it would be asserting a falsehood. This instead pins the
    measured ceiling so a regression that makes noise look relevant is
    caught, and test_no_absolute_score_floor_separates_the_two_populations
    below keeps the underlying problem visible.
    """
    row = _lookup(score_table, "negative", case["query"])
    assert row["top_score"] < NEGATIVE_CEILING, (
        f"irrelevant query scored {row['top_score']:.3f} against "
        f"{row['top_doc_id']} (ceiling {NEGATIVE_CEILING}); {case['why']}"
    )


def test_no_absolute_score_floor_separates_the_two_populations(score_table):
    """A characterization test: it asserts a problem, not a property.

    Relevant and irrelevant queries currently occupy overlapping score
    ranges, so no single threshold can tell them apart. That is a real
    limitation of thresholding cosine similarity over a small, topically
    uniform index, and it is the reason SCORE_FLOOR is documented as a
    garbage filter rather than a relevance gate.

    If this test ever FAILS, that is good news, not a regression: the
    populations have separated. Re-derive the floor from the table below,
    update the chat endpoint's MIN_SCORE, and delete this test.
    """
    genuine = [r["best_score"] for r in _by_kind(score_table, "positive")]
    genuine += [r["best_score"] for r in _by_kind(score_table, "unaccented")
                if r["best_score"] > 0]
    worst_genuine = min(genuine)
    best_noise = max(r["top_score"] for r in _by_kind(score_table, "negative"))
    assert best_noise >= worst_genuine, (
        f"the score populations have SEPARATED: worst genuine retrieval "
        f"{worst_genuine:.3f} now beats the best noise {best_noise:.3f}. "
        f"A real score floor is possible — re-derive it, set the chat's "
        f"MIN_SCORE from it, and delete this test."
    )


def test_score_distribution_is_reported(pytestconfig, score_table):
    """Print the full table. Written through pytest's terminal reporter
    rather than print(), so it shows up on a passing run under plain
    `pytest -v` instead of only when something fails."""
    reporter = pytestconfig.pluginmanager.get_plugin("terminalreporter")
    lines = [
        "",
        "RETRIEVAL SCORE DISTRIBUTION "
        f"(topK={EVAL_TOP_K}, floor={SCORE_FLOOR}, "
        f"negative ceiling={NEGATIVE_CEILING})",
        f"{'KIND':<11}{'EXPECTED DOC':<37}{'BEST':>7}{'RANK':>5}"
        f"{'TOP':>7}  TOP DOC / QUERY",
        "-" * 104,
    ]
    for row in score_table:
        best = "-" if row["kind"] == "negative" else f"{row['best_score']:.3f}"
        rank = "-" if row["kind"] == "negative" else str(row["rank"])
        tail = (row["label"][:40] if row["kind"] == "negative"
                else row["top_doc_id"])
        lines.append(
            f"{row['kind']:<11}{row['expect_doc_id']:<37}{best:>7}{rank:>5}"
            f"{row['top_score']:>7.3f}  {tail}"
        )
    genuine = [r["best_score"] for r in _by_kind(score_table, "positive")]
    unacc = [r["best_score"] for r in _by_kind(score_table, "unaccented")
             if r["best_score"] > 0]
    noise = [r["top_score"] for r in _by_kind(score_table, "negative")]
    lines += [
        "-" * 104,
        f"accented positives   n={len(genuine):<3} "
        f"min={min(genuine):.3f} max={max(genuine):.3f}",
        f"unaccented retrieved n={len(unacc):<3} "
        f"min={min(unacc):.3f} max={max(unacc):.3f} "
        f"({len(unacc)}/{len(CASES)} retrieved at all)",
        f"negatives            n={len(noise):<3} "
        f"min={min(noise):.3f} max={max(noise):.3f}",
        f"MARGIN worst genuine {min(genuine + unacc):.3f} - best noise "
        f"{max(noise):.3f} = {min(genuine + unacc) - max(noise):+.3f} "
        f"(negative => the populations overlap; no floor separates them)",
        "",
    ]
    for line in lines:
        reporter.write_line(line)


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


# --------------------------------------------------------------------------
# Offline guards for the cases added in this wave. Same contract as the
# confound guard above: no network, no secrets, must pass in a bare shell.
# --------------------------------------------------------------------------


@pytest.mark.parametrize("case", UNACCENTED_CASES,
                         ids=[c["expect_doc_id"] for c in UNACCENTED_CASES])
def test_unaccented_variant_is_the_accented_case_with_its_accents_removed(case):
    """The unaccented variants are DERIVED, not hand-written.

    That is what makes them inherit the confound guard: each one is the same
    question as an accented case that already provably shares no 5-token span
    with its target document. Running the gram check directly against an
    unaccented query would pass trivially — the documents are accented, so no
    token could match — and would be a guard in name only. This asserts the
    derivation instead, which is the property that actually holds.
    """
    accented = case["accented_query"]
    assert case["query"] == strip_accents(accented)
    assert any(c["query"] == accented for c in CASES)
    # The stripping must have done something, or the "unaccented" variant is
    # just the original query duplicated and proves nothing.
    assert case["query"] != accented, (
        f"query for {case['expect_doc_id']} has no diacritics to strip; it "
        f"is not an unaccented variant of anything"
    )


@pytest.mark.parametrize("case", NEGATIVES, ids=[c["query"] for c in NEGATIVES])
def test_negative_case_shares_no_five_gram_with_any_document(case):
    """A negative that quotes the curriculum is not a negative.

    The mirror image of the confound guard: a case asserted to match NOTHING
    must not share a contiguous 5-token span with ANY content document, or it
    is secretly a positive and the negative population is contaminated.
    """
    query_grams = _five_grams(_normalize_tokens(case["query"]))
    if not query_grams:
        # Short replies like "5" or "dạ" are shorter than the window. That is
        # the point of including them, and there is nothing to check.
        return
    for doc_path in sorted(CONTENT_DIR.glob("**/*.md")):
        doc_grams = _five_grams(
            _normalize_tokens(doc_path.read_text(encoding="utf-8"))
        )
        shared = query_grams & doc_grams
        assert not shared, (
            f"negative case {case['query']!r} shares a 5-word span with "
            f"{doc_path.name}: {' '.join(next(iter(shared)))!r} — it is not "
            f"off-topic and must be rewritten or removed"
        )
