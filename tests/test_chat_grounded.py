"""Live tests for the grounded Socratic chat endpoint.

These hit the deployed site because Pages Functions have no local runtime.
"""

import pytest
import requests


def _chat(base_url, body, timeout=90):
    return requests.post(f"{base_url}/api/chat", json=body, timeout=timeout)


def test_grounded_reply_retrieves_context(base_url):
    r = _chat(base_url, {
        "messages": [{"role": "user", "content": "Con em chưa hiểu vì sao cộng hai số lại phải nhớ. Giúp em với."}],
        "ground": True,
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
    })
    assert r.status_code == 200, r.text
    assert int(r.headers.get("X-RAG-Chunks", "0")) > 0, r.headers


def test_rag_error_header_is_a_fixed_code(base_url):
    """X-RAG-Error must only ever carry a fixed code. A raw error message could contain
    CR/LF, which makes Headers.set() throw and crashes chat."""
    r = _chat(base_url, {
        "messages": [{"role": "user", "content": "Phân số là gì?"}],
        "ground": True,
    })
    assert r.status_code == 200, r.text
    err = r.headers.get("X-RAG-Error")
    assert err is None or err in {"no_binding", "timeout", "retrieval_failed"}, err


def test_offtopic_message_still_gets_a_reply(base_url):
    """An off-topic message must still get a normal reply and never crash chat.

    This deliberately does NOT assert that nothing is retrieved. On this index every
    query retrieves topK chunks at MIN_SCORE 0.30 — measured 2026-09-13, the top-5
    scores for 'zzzqqq wubbalubba flimflam' were 0.372-0.328 and for 'dạ' 0.389-0.371 —
    and no floor separates relevant from irrelevant input without also rejecting
    children who type without diacritics. Retrieval noise is therefore expected here.
    Keeping it out of the conversation is the system prompt's job, and that is checked
    behaviourally, as a pass rate, in Plan 2 Task 2's tutor behaviour eval.
    """
    r = _chat(base_url, {
        "messages": [{"role": "user", "content": "zzzqqq wubbalubba flimflam"}],
        "ground": True,
    })
    assert r.status_code == 200, r.text
    assert "X-RAG-Chunks" in r.headers, dict(r.headers)
    assert r.headers.get("X-RAG-Error") in (None, "no_binding", "timeout", "retrieval_failed"), dict(r.headers)
    content = r.json()["choices"][0]["message"]["content"]
    assert content.strip(), "off-topic grounded request returned empty content"
    assert "<think>" not in content, f"reasoning leaked into the reply: {content!r}"


def test_ungrounded_request_is_unchanged(base_url):
    """A request without a `ground` flag (API and test callers) must keep working."""
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


def test_reply_is_vietnamese_even_if_an_old_page_asks_for_english(base_url):
    """English mode was removed on 2026-09-16. A page cached from before may still send
    lang "en"; the tutor must answer in Vietnamese regardless."""
    r = _chat(base_url, {
        "messages": [{"role": "user", "content": "How do I add 27 and 15?"}],
        "ground": True,
        "lang": "en",
    })
    assert r.status_code == 200, r.text
    content = r.json()["choices"][0]["message"]["content"]
    assert any(ch in content.lower() for ch in "ăâđêôơư"), content


@pytest.mark.parametrize("provider", ["groq", "workersai"])
def test_conversation_may_start_with_a_tutor_message(base_url, provider):
    """A lesson opens with the tutor's card, so the page sends a conversation whose first
    message is the assistant's. Each provider in the chain must accept that."""
    r = requests.post(f"{base_url}/api/chat?provider={provider}", json={
        "messages": [
            {"role": "assistant", "content": "Hôm nay mình học bài «Nhân hai phân số» nhé. Em muốn làm gì trước?\n\nBài 1: Tính \\(\\frac{2}{3} \\times \\frac{4}{5}\\)."},
            {"role": "user", "content": "Em trả lời: 6/15 (chưa đúng)\n\nCô gợi ý cho em bài «Nhân hai phân số» với ạ: Tính \\(\\frac{2}{3} \\times \\frac{4}{5}\\). Em làm ra 6/15."},
        ],
        "ground": True,
    }, timeout=90)
    assert r.status_code == 200, r.text
    assert r.json()["choices"][0]["message"]["content"].strip()
