"""Live tests for the grounded Socratic chat endpoint.

These hit the deployed site because Pages Functions have no local runtime.
"""

import requests


def _chat(base_url, body, timeout=90):
    return requests.post(f"{base_url}/api/chat", json=body, timeout=timeout)


def test_grounded_reply_retrieves_context(base_url):
    r = _chat(base_url, {
        "messages": [{"role": "user", "content": "Con em chưa hiểu vì sao cộng hai số lại phải nhớ. Giúp em với."}],
        "ground": True,
        "lang": "vi",
    })
    assert r.status_code == 200, r.text
    assert int(r.headers.get("X-RAG-Chunks", "0")) > 0, r.headers
    content = r.json()["choices"][0]["message"]["content"]
    assert content.strip() != ""


def test_short_reply_stays_grounded(base_url):
    """Most chat turns are short answers. On its own "12" retrieves nothing, so grounding
    would switch off mid-problem unless the previous student turn is part of the query."""
    r = _chat(base_url, {
        "messages": [
            {"role": "user", "content": "Con em chưa hiểu vì sao cộng hai số lại phải nhớ."},
            {"role": "assistant", "content": "Em thử cộng hàng đơn vị trước nhé. 7 cộng 5 bằng mấy?"},
            {"role": "user", "content": "12"},
        ],
        "ground": True,
        "lang": "vi",
    })
    assert r.status_code == 200, r.text
    assert int(r.headers.get("X-RAG-Chunks", "0")) > 0, r.headers


def test_rag_error_header_is_a_fixed_code(base_url):
    """X-RAG-Error must only ever carry a fixed code. A raw error message could contain
    CR/LF, which makes Headers.set() throw and crashes chat."""
    r = _chat(base_url, {
        "messages": [{"role": "user", "content": "Phân số là gì?"}],
        "ground": True,
        "lang": "vi",
    })
    assert r.status_code == 200, r.text
    err = r.headers.get("X-RAG-Error")
    assert err is None or err in {"no_binding", "timeout", "retrieval_failed"}, err


def test_offtopic_query_retrieves_nothing(base_url):
    r = _chat(base_url, {
        "messages": [{"role": "user", "content": "zzzqqq wubbalubba flimflam"}],
        "ground": True,
        "lang": "vi",
    })
    assert r.status_code == 200, r.text
    assert int(r.headers.get("X-RAG-Chunks", "0")) == 0, r.headers


def test_ungrounded_request_is_unchanged(base_url):
    """The existing game frontend sends no `ground` flag and must keep working."""
    r = _chat(base_url, {
        "messages": [
            {"role": "system", "content": "Reply with exactly the word BANANA and nothing else."},
            {"role": "user", "content": "Go."},
        ]
    })
    assert r.status_code == 200, r.text
    assert r.headers.get("X-RAG-Chunks") is None
    content = r.json()["choices"][0]["message"]["content"]
    assert "BANANA" in content.upper()


def test_grounded_reply_is_in_english_when_asked(base_url):
    r = _chat(base_url, {
        "messages": [{"role": "user", "content": "How do I add 27 and 15?"}],
        "ground": True,
        "lang": "en",
    })
    assert r.status_code == 200, r.text
    content = r.json()["choices"][0]["message"]["content"]
    # Vietnamese-specific characters should not appear in an English reply.
    assert not any(ch in content for ch in "ăâđêôơư"), content
