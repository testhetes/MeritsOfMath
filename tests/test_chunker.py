from scripts.rag.chunker import chunk_markdown

SAMPLE = """# Phep cong trong pham vi 10

Phep cong la khi ta gop hai nhom lai voi nhau.

Vi du: 2 + 3 = 5.

## Luyen tap

Tinh 4 + 1.

Tinh 5 + 2.
"""


def test_splits_by_heading_and_records_section():
    chunks = chunk_markdown(SAMPLE, doc_id="g1-phepcong")
    sections = {c["metadata"]["section"] for c in chunks}
    assert "Phep cong trong pham vi 10" in sections
    assert "Luyen tap" in sections


def test_ids_are_stable_and_sequential():
    chunks = chunk_markdown(SAMPLE, doc_id="g1-phepcong")
    assert chunks[0]["id"] == "g1-phepcong:0000"
    assert chunks[1]["id"] == "g1-phepcong:0001"
    for i, c in enumerate(chunks):
        assert c["metadata"]["chunk_index"] == i


def test_respects_max_chars():
    long_md = "# Big\n\n" + ("x" * 400 + "\n\n") * 10
    chunks = chunk_markdown(long_md, doc_id="d", max_chars=1200)
    assert len(chunks) > 1
    for c in chunks:
        assert len(c["text"]) <= 1200


def test_no_empty_chunks_and_doc_id_recorded():
    chunks = chunk_markdown(SAMPLE, doc_id="g1-phepcong")
    assert len(chunks) > 0
    for c in chunks:
        assert c["text"].strip() != ""
        assert c["metadata"]["doc_id"] == "g1-phepcong"
