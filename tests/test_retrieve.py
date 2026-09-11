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
