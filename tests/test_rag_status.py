import os
import requests

BASE = os.environ["RAG_BASE_URL"]
SECRET = os.environ["INGEST_SECRET"]


def _post(path, body=None, token=SECRET):
    return requests.post(
        f"{BASE}{path}",
        json=body or {},
        headers={"Authorization": f"Bearer {token}"},
        timeout=60,
    )


def test_requires_auth():
    r = _post("/api/rag-status", token="wrong-token")
    assert r.status_code == 401


def test_reports_embedding_dimension():
    r = _post("/api/rag-status")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["embeddingModel"] == "@cf/baai/bge-m3"
    assert isinstance(data["embeddingDim"], int)
    assert data["embeddingDim"] > 0
    print("EMBEDDING DIMENSION:", data["embeddingDim"])
