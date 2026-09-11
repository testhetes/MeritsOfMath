import requests


def _post(base_url, path, headers):
    return requests.post(f"{base_url}{path}", json={}, headers=headers, timeout=60)


def test_requires_auth(base_url):
    r = _post(base_url, "/api/rag-status", {"Authorization": "Bearer wrong-token"})
    assert r.status_code == 401


def test_reports_embedding_dimension(base_url, auth_headers):
    r = _post(base_url, "/api/rag-status", auth_headers)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["embeddingModel"] == "@cf/baai/bge-m3"
    assert isinstance(data["embeddingDim"], int)
    assert data["embeddingDim"] > 0
    print("EMBEDDING DIMENSION:", data["embeddingDim"])


def test_index_is_bound_with_matching_dimensions(base_url, auth_headers):
    r = _post(base_url, "/api/rag-status", auth_headers)
    assert r.status_code == 200, r.text
    data = r.json()
    index = data["index"]
    assert index is not None, "VECTORIZE binding missing"
    assert "error" not in index, index
    assert index["dimensions"] == data["embeddingDim"], (
        f"Vectorize index has {index['dimensions']} dimensions but "
        f"{data['embeddingModel']} returns {data['embeddingDim']}-dimensional "
        f"vectors; the index must be recreated with the model's dimension"
    )
