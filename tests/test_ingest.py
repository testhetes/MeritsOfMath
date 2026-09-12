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
    """Upsert the two fixture vectors, then delete them again.

    These fixtures are the only unaccented text in an otherwise fully
    accented Vietnamese index, so leaving them behind lets an unaccented
    student question retrieve test data as if it were curriculum. The
    cleanup uses the same delete_ids path the uploader's prune step uses,
    so this test also exercises it.
    """
    try:
        r = requests.post(f"{base_url}/api/ingest", json={"chunks": FIXTURE},
                          headers=auth_headers, timeout=120)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["upserted"] == 2
        # I3: the mutationId is the only signal that a write has landed.
        assert body.get("mutationId"), f"no mutationId in response: {body}"
    finally:
        cleanup = requests.post(
            f"{base_url}/api/ingest",
            json={"delete_ids": [c["id"] for c in FIXTURE]},
            headers=auth_headers, timeout=120,
        )
        assert cleanup.status_code == 200, cleanup.text
        assert cleanup.json()["deleted"] == 2


def test_delete_only_request_returns_a_mutation_id(
        allow_prod_writes, base_url, auth_headers):
    """Deleting ids that do not exist is harmless — that is what makes the
    uploader's blind prune window safe — but it is still a mutation, so it
    must report a mutationId and run only behind the prod-write gate."""
    r = requests.post(
        f"{base_url}/api/ingest",
        json={"delete_ids": ["no-such-doc:9998", "no-such-doc:9999"]},
        headers=auth_headers, timeout=120,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["upserted"] == 0
    assert body["deleted"] == 2
    assert body.get("deleteMutationId"), f"no deleteMutationId: {body}"


# --------------------------------------------------------------------------
# ID validation (M3). Every case here must be rejected with 400 BEFORE
# anything is embedded or upserted, so none of them needs the prod-write gate.
# --------------------------------------------------------------------------

def _ingest(base_url, auth_headers, chunks):
    return requests.post(f"{base_url}/api/ingest", json={"chunks": chunks},
                         headers=auth_headers, timeout=60)


def test_rejects_id_longer_than_64_bytes(base_url, auth_headers):
    chunk = {"id": "x" * 65, "text": "Mot doan van ban ngan.", "metadata": {}}
    r = _ingest(base_url, auth_headers, [chunk])
    assert r.status_code == 400, r.text


def test_rejects_id_that_is_short_in_characters_but_long_in_bytes(
        base_url, auth_headers):
    """The Vectorize limit is 64 BYTES, not 64 characters.

    30 copies of 'ế' is 30 characters but 90 UTF-8 bytes. A server that
    measured `id.length` would accept this and then either be rejected by
    Vectorize or silently truncate. This is the case that proves the check
    measures bytes.
    """
    long_id = "ế" * 30
    assert len(long_id) < 64 < len(long_id.encode("utf-8"))
    chunk = {"id": long_id, "text": "Mot doan van ban ngan.", "metadata": {}}
    r = _ingest(base_url, auth_headers, [chunk])
    assert r.status_code == 400, r.text


def test_rejects_blank_id(base_url, auth_headers):
    chunk = {"id": "   ", "text": "Mot doan van ban ngan.", "metadata": {}}
    r = _ingest(base_url, auth_headers, [chunk])
    assert r.status_code == 400, r.text


# --------------------------------------------------------------------------
# delete_ids validation (I3). All rejected before any mutation is issued.
# --------------------------------------------------------------------------

def _post(base_url, auth_headers, body):
    return requests.post(f"{base_url}/api/ingest", json=body,
                         headers=auth_headers, timeout=60)


def test_rejects_non_array_delete_ids(base_url, auth_headers):
    r = _post(base_url, auth_headers, {"delete_ids": "test-doc:0000"})
    assert r.status_code == 400, r.text


def test_rejects_empty_delete_ids(base_url, auth_headers):
    r = _post(base_url, auth_headers, {"delete_ids": []})
    assert r.status_code == 400, r.text


def test_rejects_non_string_delete_ids(base_url, auth_headers):
    r = _post(base_url, auth_headers, {"delete_ids": ["ok:0000", 17]})
    assert r.status_code == 400, r.text


def test_rejects_blank_delete_id(base_url, auth_headers):
    r = _post(base_url, auth_headers, {"delete_ids": ["ok:0000", "  "]})
    assert r.status_code == 400, r.text


def test_rejects_too_many_delete_ids(base_url, auth_headers):
    """Vectorize caps deleteByIds at 100 ids (error 40007). Exceeding it must
    be a 400 from our own validation, not a 502 raised from inside Vectorize
    after the request has already been accepted."""
    r = _post(base_url, auth_headers,
              {"delete_ids": [f"bulk:{i:04d}" for i in range(101)]})
    assert r.status_code == 400, r.text


def test_still_rejects_a_request_with_neither_chunks_nor_delete_ids(
        base_url, auth_headers):
    """delete_ids made chunks[] optional; it must not have made an empty
    request acceptable."""
    r = _post(base_url, auth_headers, {})
    assert r.status_code == 400, r.text


def test_rejects_duplicate_ids_within_one_batch(base_url, auth_headers):
    """Two chunks sharing an id is an upsert racing itself: one text wins
    arbitrarily and the caller is told both were stored."""
    chunks = [
        {"id": "dup-guard:0000", "text": "Van ban thu nhat.", "metadata": {}},
        {"id": "dup-guard:0000", "text": "Van ban thu hai.", "metadata": {}},
    ]
    r = _ingest(base_url, auth_headers, chunks)
    assert r.status_code == 400, r.text
    assert "uplicate" in r.json().get("error", ""), r.text
