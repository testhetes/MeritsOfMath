"""Chunk a reviewed Markdown file and push it to the /api/ingest endpoint."""

import os
import pathlib
import sys

import requests

from scripts.rag.chunker import chunk_markdown

BATCH_SIZE = 25


def upload_markdown_file(path: str, base_url: str, secret: str,
                         doc_id: str | None = None) -> int:
    """Upload one Markdown file. Returns the number of chunks upserted."""
    file_path = pathlib.Path(path)
    md = file_path.read_text(encoding="utf-8")
    doc_id = doc_id or file_path.stem

    chunks = chunk_markdown(md, doc_id=doc_id)
    if not chunks:
        return 0

    headers = {"Authorization": f"Bearer {secret}"}
    total = 0
    for start in range(0, len(chunks), BATCH_SIZE):
        batch = chunks[start:start + BATCH_SIZE]
        response = requests.post(
            f"{base_url}/api/ingest",
            json={"chunks": batch},
            headers=headers,
            timeout=180,
        )
        response.raise_for_status()
        total += response.json()["upserted"]
    return total


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python -m scripts.rag.upload <markdown-file> [more-files...]")
        raise SystemExit(2)
    base_url = os.environ["RAG_BASE_URL"]
    secret = os.environ["INGEST_SECRET"]
    grand_total = 0
    for path in sys.argv[1:]:
        count = upload_markdown_file(path, base_url=base_url, secret=secret)
        print(f"{path}: {count} chunks")
        grand_total += count
    print(f"TOTAL: {grand_total} chunks")


if __name__ == "__main__":
    main()
