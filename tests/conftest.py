# Shared fixtures for RAG endpoint tests. Lookups are lazy (inside fixtures,
# not at module import time) so offline tests that never request these
# fixtures — e.g. test_chunker.py — can still be collected and run without
# RAG_BASE_URL / INGEST_SECRET set. A contributor without the admin secret
# sees live endpoint tests SKIP with a clear reason instead of a collection
# error.
import os

import pytest


@pytest.fixture(scope="session")
def base_url() -> str:
    url = os.environ.get("RAG_BASE_URL")
    if not url:
        pytest.skip("RAG_BASE_URL not set — skipping live endpoint test")
    return url


@pytest.fixture(scope="session")
def auth_headers() -> dict:
    secret = os.environ.get("INGEST_SECRET")
    if not secret:
        pytest.skip("INGEST_SECRET not set — skipping live endpoint test")
    return {"Authorization": f"Bearer {secret}"}
