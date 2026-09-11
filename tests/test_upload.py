"""Uploads one real content file through the full chunk -> /api/ingest path.

This WRITES TO PRODUCTION: the index it updates is the one students' chat
retrieves from, and it publishes the WORKING-TREE copy of the file —
uncommitted edits included. So it only runs when RAG_ALLOW_PROD_WRITES=1 is
set. Run it deliberately, from a checkout whose copy of this file is the one
you mean to publish.
"""
import pathlib

from scripts.rag.upload import upload_markdown_file

# Resolved from this file's location rather than the process CWD, so the test
# finds the file whichever directory pytest is started from.
CONTENT_FILE = (
    pathlib.Path(__file__).parent.parent
    / "content" / "grade1" / "phep-cong-trong-pham-vi-10.md"
)


def test_uploads_a_markdown_file(allow_prod_writes, base_url, ingest_secret):
    count = upload_markdown_file(
        str(CONTENT_FILE),
        base_url=base_url,
        secret=ingest_secret,
    )
    assert count > 0
