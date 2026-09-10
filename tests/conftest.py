# Shared setup for RAG endpoint tests. Both env vars are required — tests fail
# fast with a clear KeyError if either is missing from the shell.
import os

BASE = os.environ["RAG_BASE_URL"]
SECRET = os.environ["INGEST_SECRET"]

HEADERS = {"Authorization": f"Bearer {SECRET}"}
