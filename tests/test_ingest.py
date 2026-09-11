import requests

FIXTURE = [
    {
        "id": "test-doc:0000",
        "text": "Phep cong la khi ta gop hai nhom lai voi nhau. Vi du 2 + 3 = 5.",
        "metadata": {"doc_id": "test-doc", "section": "Phep cong", "chunk_index": 0},
    },
    {
        "id": "test-doc:0001",
        "text": "Phep tru la khi ta bot di mot so luong. Vi du 5 - 2 = 3.",
        "metadata": {"doc_id": "test-doc", "section": "Phep tru", "chunk_index": 1},
    },
]


def test_requires_auth(base_url):
    r = requests.post(f"{base_url}/api/ingest", json={"chunks": FIXTURE},
                      headers={"Authorization": "Bearer nope"}, timeout=60)
    assert r.status_code == 401


def test_rejects_empty_chunks(base_url, auth_headers):
    r = requests.post(f"{base_url}/api/ingest", json={"chunks": []},
                      headers=auth_headers, timeout=60)
    assert r.status_code == 400


def test_rejects_null_body(base_url, auth_headers):
    r = requests.post(f"{base_url}/api/ingest", data="null",
                      headers={**auth_headers, "Content-Type": "application/json"},
                      timeout=60)
    assert r.status_code == 400


def test_upserts_chunks(allow_prod_writes, base_url, auth_headers):
    r = requests.post(f"{base_url}/api/ingest", json={"chunks": FIXTURE},
                      headers=auth_headers, timeout=120)
    assert r.status_code == 200, r.text
    assert r.json()["upserted"] == 2
