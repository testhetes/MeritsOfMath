import requests


def test_requires_auth(base_url):
    r = requests.post(f"{base_url}/api/retrieve", json={"query": "phep cong"},
                      headers={"Authorization": "Bearer nope"}, timeout=60)
    assert r.status_code == 401


def test_rejects_empty_query(base_url, auth_headers):
    r = requests.post(f"{base_url}/api/retrieve", json={"query": "  "},
                      headers=auth_headers, timeout=60)
    assert r.status_code == 400


def test_rejects_null_body(base_url, auth_headers):
    r = requests.post(f"{base_url}/api/retrieve", data="null",
                      headers={**auth_headers, "Content-Type": "application/json"},
                      timeout=60)
    assert r.status_code == 400


# --------------------------------------------------------------------------
# The topK clamp lives inside the shared search() helper in _rag.js, so these
# also cover the exact clamp Plan 2's chat endpoint inherits. A non-positive
# topK must NOT reach Vectorize as 0 or -1 (which would return nothing, or
# error) — it falls back to the default.
# --------------------------------------------------------------------------

def _query(base_url, auth_headers, **body):
    return requests.post(f"{base_url}/api/retrieve",
                         json={"query": "phép cộng có nhớ", **body},
                         headers=auth_headers, timeout=60)


def test_match_shape_is_the_documented_contract(base_url, auth_headers):
    r = _query(base_url, auth_headers, topK=3)
    assert r.status_code == 200, r.text
    matches = r.json()["matches"]
    assert matches, "no matches returned"
    for m in matches:
        assert set(m) == {"id", "score", "text", "section", "doc_id"}, m
        assert isinstance(m["id"], str) and m["id"]
        assert isinstance(m["score"], (int, float))
        assert isinstance(m["text"], str)


def test_non_positive_topk_falls_back_to_the_default(base_url, auth_headers):
    for bad in (0, -1):
        r = _query(base_url, auth_headers, topK=bad)
        assert r.status_code == 200, r.text
        matches = r.json()["matches"]
        assert 1 <= len(matches) <= 20, f"topK={bad} returned {len(matches)}"


def test_excessive_topk_is_capped(base_url, auth_headers):
    r = _query(base_url, auth_headers, topK=1000)
    assert r.status_code == 200, r.text
    assert len(r.json()["matches"]) <= 20
