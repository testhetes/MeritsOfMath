"""Per-provider health checks for /api/chat.

The fallback chain hides a dead provider. When Groq retired our model on
2026-08-16, every request silently fell through to Workers AI and nothing
alerted for weeks. These tests force each provider individually, so a retired
model, a leaked reasoning block, or an empty reply fails loudly instead.
"""

import pytest
import requests

PROMPT = "Em chào cô. Hai cộng ba bằng mấy ạ? Trả lời thật ngắn."


def _force(base_url, provider, max_tokens=60):
    return requests.post(
        f"{base_url}/api/chat?provider={provider}",
        json={"messages": [{"role": "user", "content": PROMPT}], "max_tokens": max_tokens},
        timeout=90,
    )


def _content(response):
    return response.json()["choices"][0]["message"]["content"]


def test_groq_primary_serves_a_real_reply(base_url):
    r = _force(base_url, "groq")
    # A free-tier rate limit is transient and says nothing about model health.
    if r.status_code == 503 and "groq: 429" in r.headers.get("X-AI-Error", ""):
        pytest.skip("Groq is rate-limited right now; model health cannot be checked")
    assert r.status_code == 200, r.headers.get("X-AI-Error", r.text)
    assert r.headers.get("X-AI-Provider") == "groq", dict(r.headers)
    content = _content(r)
    assert content.strip(), "Groq returned empty content (did reasoning consume the token budget?)"
    assert "<think>" not in content, f"reasoning leaked into the reply: {content!r}"


def test_workersai_fallback_serves_a_real_reply(base_url):
    r = _force(base_url, "workersai")
    assert r.status_code == 200, r.headers.get("X-AI-Error", r.text)
    assert r.headers.get("X-AI-Provider") == "workersai", dict(r.headers)
    assert _content(r).strip(), "Workers AI returned empty content"
