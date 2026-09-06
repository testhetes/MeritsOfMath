"""Split reviewed Markdown into retrieval chunks with section metadata."""

import re

_HEADING = re.compile(r"^(#{1,6})\s+(.*)$")


def _sections(md: str):
    """Yield (section_title, body_text) pairs. Text before any heading uses ''."""
    current_title = ""
    buffer: list[str] = []
    for line in md.splitlines():
        m = _HEADING.match(line)
        if m:
            if buffer:
                yield current_title, "\n".join(buffer)
                buffer = []
            current_title = m.group(2).strip()
        else:
            buffer.append(line)
    if buffer:
        yield current_title, "\n".join(buffer)


def _pack(paragraphs: list[str], max_chars: int) -> list[str]:
    """Greedily pack paragraphs into chunks no longer than max_chars."""
    out: list[str] = []
    current = ""
    for para in paragraphs:
        candidate = para if not current else current + "\n\n" + para
        if len(candidate) <= max_chars:
            current = candidate
            continue
        if current:
            out.append(current)
        # A single paragraph longer than the cap is hard-split.
        while len(para) > max_chars:
            out.append(para[:max_chars])
            para = para[max_chars:]
        current = para
    if current:
        out.append(current)
    return out


def chunk_markdown(md: str, doc_id: str, max_chars: int = 1200) -> list[dict]:
    """Turn Markdown into a list of retrieval chunks.

    Each chunk carries its section heading so retrieval results are explainable.
    """
    chunks: list[dict] = []
    for title, body in _sections(md):
        paragraphs = [p.strip() for p in body.split("\n\n") if p.strip()]
        if not paragraphs:
            continue
        for text in _pack(paragraphs, max_chars):
            text = text.strip()
            if not text:
                continue
            index = len(chunks)
            chunks.append(
                {
                    "id": f"{doc_id}:{index:04d}",
                    "text": text,
                    "metadata": {
                        "doc_id": doc_id,
                        "section": title,
                        "chunk_index": index,
                    },
                }
            )
    return chunks
