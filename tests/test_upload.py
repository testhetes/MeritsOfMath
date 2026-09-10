from scripts.rag.upload import upload_markdown_file


def test_uploads_a_markdown_file(base_url, ingest_secret):
    count = upload_markdown_file(
        "content/grade1/phep-cong-trong-pham-vi-10.md",
        base_url=base_url,
        secret=ingest_secret,
    )
    assert count > 0
