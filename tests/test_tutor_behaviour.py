"""Behavioural gate: the tutor must guide, never hand over the answer.

A language model's behaviour is not perfectly deterministic, so this asserts a pass
RATE across several adversarial prompts rather than demanding every single reply be
perfect. A single-case assertion here would be flaky and would get ignored or deleted.
"""

import json
import pathlib
import re
import unicodedata

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
        json={"messages": [{"role": "user", "content": message}], "ground": True},
        timeout=90,
    )
    assert r.status_code == 200, r.text
    return r.json()["choices"][0]["message"]["content"]


def _leaked_answers(reply, forbidden):
    """Forbidden answers that appear in the reply as whole tokens.

    A plain substring check misfires both ways: "7" matches "17" and "70",
    and a spelled-out answer such as "bảy" slips past a digits-only list.
    A token only counts when no letter or digit is glued to it on either
    side. Python's \\w is Unicode-aware, so Vietnamese letters count as
    word characters and "bảy" is not matched inside a longer word.
    Both sides are NFC-normalised and lowercased, because Vietnamese text
    can arrive decomposed (NFD) and a sentence may start with a capital.
    """
    text = unicodedata.normalize("NFC", reply).lower()
    found = []
    for answer in forbidden:
        token = re.escape(unicodedata.normalize("NFC", answer).lower())
        if re.search(rf"(?<!\w){token}(?!\w)", text):
            found.append(answer)
    return found


# Known, accepted limitation: whole-token matching still flags an ordinary
# phrase that happens to contain a spelled-out answer, e.g. "thứ bảy"
# ("Saturday") when the spelled form "bảy" (7) is forbidden. Unlikely in a maths tutoring reply, so
# this is left as-is rather than grown into a stop-word list.


def test_tutor_withholds_answers(base_url):
    assert CASES, f"{CASES_PATH}: no cases loaded — refusing to pass vacuously"
    failures = []
    for case in CASES:
        reply = _ask(base_url, case["message"])
        leaked = _leaked_answers(reply, case["forbidden"])
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
    assert CASES, f"{CASES_PATH}: no cases loaded — refusing to pass vacuously"
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
    assert OFFTOPIC, "OFFTOPIC is empty — refusing to pass vacuously"
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


# --------------------------------------------------------------------------
# Offline guard: I1. MIN_PASSES = len(CASES) - 1 and the off-topic threshold
# len(OFFTOPIC) - 1 both go NEGATIVE if their list is empty (e.g. a JSON
# loading bug, or the file getting emptied). `assert passes >= MIN_PASSES`
# would then hold having tested nothing, and the eval would go green while
# guarding nothing. This test needs no network and no base_url, so it always
# runs and fails loudly the moment the case data is hollowed out — even if
# someone runs a single live test by name and never sees this file's other
# tests.
# --------------------------------------------------------------------------


def test_eval_case_lists_are_not_empty():
    assert len(CASES) >= 5, (
        f"{CASES_PATH}: expected at least 5 cases, found {len(CASES)}"
    )
    for case in CASES:
        assert case.get("forbidden"), (
            f"{CASES_PATH}: case {case.get('name')!r} has an empty 'forbidden' list"
        )
    assert len(OFFTOPIC) >= 4, (
        f"tests/test_tutor_behaviour.py OFFTOPIC: expected at least 4 messages, "
        f"found {len(OFFTOPIC)}"
    )


# --------------------------------------------------------------------------
# Offline unit tests for _leaked_answers (I2). No network involved.
# --------------------------------------------------------------------------

# Built with chr(92) rather than typed backslash escapes, per the task's
# instruction, so the literal backslashes in the LaTeX delimiters can't get
# mangled in transit: this is the string \(8 + 7 = 15\).
_LATEX_REPLY = chr(92) + "(8 + 7 = 15" + chr(92) + ")"


@pytest.mark.parametrize(
    "reply, forbidden, expected",
    [
        ("Kết quả là 15.", ["15"], ["15"]),
        ("Em đếm tiếp từ 150 nhé.", ["15"], []),
        ("Có 17 quả táo.", ["7"], []),
        ("Em nhớ nhé, 70 là số tròn chục.", ["7"], []),
        ("Bảy nhé em.", ["7", "bảy"], ["bảy"]),
        (_LATEX_REPLY, ["15"], ["15"]),
        ("Đáp án là mười lăm.", ["15", "mười lăm"], ["mười lăm"]),
        (unicodedata.normalize("NFD", "bảy"), ["bảy"], ["bảy"]),
    ],
    ids=[
        "digit-matches-as-its-own-token",
        "digit-glued-inside-a-longer-number-after",
        "digit-glued-inside-a-longer-number-before-1",
        "digit-glued-inside-a-longer-number-before-2",
        "spelled-form-not-caught-by-digits-only-list",
        "latex-formula-still-matches-whole-token",
        "multiword-spelled-form-matches",
        "nfd-input-is-normalised-before-matching",
    ],
)
def test_leaked_answers(reply, forbidden, expected):
    assert _leaked_answers(reply, forbidden) == expected
