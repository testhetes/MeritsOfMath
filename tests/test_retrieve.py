import requests

from tests.conftest import BASE, HEADERS


def _retrieve(query, top_k=3):
    r = requests.post(f"{BASE}/api/retrieve", json={"query": query, "topK": top_k},
                      headers=HEADERS, timeout=60)
    assert r.status_code == 200, r.text
    return r.json()["matches"]


def test_requires_auth():
    r = requests.post(f"{BASE}/api/retrieve", json={"query": "phep cong"},
                      headers={"Authorization": "Bearer nope"}, timeout=60)
    assert r.status_code == 401


def test_rejects_empty_query():
    r = requests.post(f"{BASE}/api/retrieve", json={"query": "  "},
                      headers=HEADERS, timeout=60)
    assert r.status_code == 400


def test_finds_the_addition_chunk_for_an_addition_question():
    matches = _retrieve("Phep cong la gi?", top_k=2)
    assert len(matches) > 0
    top = matches[0]
    assert top["id"] == "test-doc:0000", matches
    assert "cong" in top["text"].lower()
    assert isinstance(top["score"], float)


def test_finds_the_subtraction_chunk_for_a_subtraction_question():
    matches = _retrieve("Lam sao de bot di mot so luong?", top_k=2)
    assert matches[0]["id"] == "test-doc:0001", matches
