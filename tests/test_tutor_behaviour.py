"""Behavioural gate: the tutor must guide, never hand over the answer.

A language model's behaviour is not perfectly deterministic, so this asserts a pass
RATE across several adversarial prompts rather than demanding every single reply be
perfect. A single-case assertion here would be flaky and would get ignored or deleted.
"""

import json
import pathlib

import pytest
import requests

CASES_PATH = pathlib.Path(__file__).parent / "evals" / "tutor_behaviour_cases.json"
CASES = json.loads(CASES_PATH.read_text(encoding="utf-8"))

# Of 5 cases, allow at most one imperfect reply. Below that the tutor's core promise
# is not being kept and the system prompt needs work.
MIN_PASSES = len(CASES) - 1


def _ask(base_url, message):
    r = requests.post(
        f"{base_url}/api/chat",
        json={"messages": [{"role": "user", "content": message}], "ground": True, "lang": "vi"},
        timeout=90,
    )
    assert r.status_code == 200, r.text
    return r.json()["choices"][0]["message"]["content"]


def test_tutor_withholds_answers(base_url):
    failures = []
    for case in CASES:
        reply = _ask(base_url, case["message"])
        leaked = [f for f in case["forbidden"] if f in reply]
        if leaked:
            failures.append(f"{case['name']}: leaked {leaked} in {reply!r}")

    passes = len(CASES) - len(failures)
    assert passes >= MIN_PASSES, (
        f"tutor revealed answers in {len(failures)}/{len(CASES)} cases "
        f"(need at least {MIN_PASSES} clean):\n" + "\n".join(failures)
    )


def test_tutor_asks_questions(base_url):
    """Socratic means the reply moves the student forward with a question.

    A pass RATE, for the same reason as above: one reply that happens to phrase its
    next step as an invitation rather than a question is not a broken tutor, but a
    per-case assertion would fail on it, go flaky, and get deleted.
    """
    without = []
    for case in CASES:
        reply = _ask(base_url, case["message"])
        if "?" not in reply:
            without.append(f"{case['name']}: {reply!r}")

    asked = len(CASES) - len(without)
    assert asked >= MIN_PASSES, (
        f"only {asked}/{len(CASES)} replies asked a question "
        f"(need at least {MIN_PASSES}):\n" + "\n".join(without)
    )


# Small talk with no maths in it. Retrieval still attaches five maths passages to each of
# these: at MIN_SCORE 0.30 every query on this index retrieves topK chunks (measured
# 2026-09-13 — 'Mẹ em nấu món canh chua cá lóc rất ngon' scored 0.467-0.407 against lessons
# on subtraction and division). No score floor can filter that without also rejecting
# children who type without diacritics, so keeping it out of the conversation rests on the
# system prompt's instruction to ignore reference material that does not fit.
OFFTOPIC = [
    "Mẹ em nấu món canh chua cá lóc rất ngon ạ.",
    "Hôm nay em được đi chơi công viên với bạn.",
    "Con mèo nhà em tên là Mướp, nó lười lắm.",
    "Cô ơi, cô thích màu gì nhất ạ?",
]


def _looks_like_a_maths_lesson(reply):
    """True if the reply works through maths: a formula, or a worked expression like 7 + 5.

    A tutor that gently steers small talk back toward learning is fine, and may even name a
    topic. What this catches is the tutor *teaching* the passages retrieval happened to
    attach, which almost always means writing an expression or a formula.
    """
    if any(marker in reply for marker in ("\\(", "\\[", "$", "\\frac")):
        return True
    # A worked expression is written with spaced operators: "7 + 5", "3 x 4 = 12". Unspaced
    # hyphens between digits are ranges and dates in ordinary Vietnamese — "5-6 tuổi",
    # "2-3 giờ", "ngày 13-9" — so an operator only counts with a space on each side.
    # Measured 2026-09-13: without that rule, all three of those replies were misflagged
    # as maths lessons, which would fail a tutor that was behaving correctly.
    for i, ch in enumerate(reply):
        if ch in "+-×x÷=" and reply[i - 1:i] == " " and reply[i + 1:i + 2] == " ":
            if reply[:i - 1].rstrip()[-1:].isdigit() and reply[i + 2:].lstrip()[:1].isdigit():
                return True
    return False


def test_tutor_does_not_steer_small_talk_into_retrieved_maths(base_url):
    """Irrelevant retrieved passages must not hijack an off-topic conversation.

    A pass RATE, for the same reason as the checks above: one reply that happens to slip in
    an example is not a broken tutor, but a per-message assertion would go flaky and be
    deleted.
    """
    lectured = []
    for message in OFFTOPIC:
        reply = _ask(base_url, message)
        if _looks_like_a_maths_lesson(reply):
            lectured.append(f"{message!r} -> {reply!r}")

    clean = len(OFFTOPIC) - len(lectured)
    assert clean >= len(OFFTOPIC) - 1, (
        f"tutor turned {len(lectured)}/{len(OFFTOPIC)} off-topic messages into maths lessons "
        f"(allow at most 1):\n" + "\n".join(lectured)
    )
