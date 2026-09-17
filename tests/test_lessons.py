"""Offline checks on lessons.json, the data behind the home screen, Ghi nhớ cards and practice.

The answer checker in js/lessons.js trusts each problem's `answer`. These tests recompute every
answer from its `expr`, so a typo in the data cannot mark a child's correct answer wrong. They
also keep lessons.json and the knowledge base's content files in step. No network, no secrets.
"""

import ast
import json
import pathlib
import re
from fractions import Fraction

import pytest

ROOT = pathlib.Path(__file__).parent.parent
CONTENT_DIR = ROOT / "content"
DATA = json.loads((ROOT / "lessons.json").read_text(encoding="utf-8"))

# A whole number, a fraction in lowest terms, or a decimal with a Vietnamese comma and no trailing
# zeros: "12", "3/4", "4,25".
ANSWER_RE = re.compile(r"^(0|[1-9]\d*)(/[1-9]\d*|,\d*[1-9])?$")
DECIMAL_LITERAL = re.compile(r"^\d+\.\d+$")
LESSON_KEYS = {"id", "title", "ghiNho", "problems"}
PROBLEM_KEYS = {"question", "expr", "answer", "simplest", "unit"}
EXTRA_KEYS = {"id", "label", "title", "note", "lessons"}
WHOLE_NUMBER_RE = re.compile(r"^(0|[1-9]\d*)$")

# // and % let a chia có dư problem write its quotient and remainder as 17 // 5 and 17 % 5.
_OPS = {
    ast.Add: lambda a, b: a + b,
    ast.Sub: lambda a, b: a - b,
    ast.Mult: lambda a, b: a * b,
    ast.Div: lambda a, b: a / b,
    ast.FloorDiv: lambda a, b: Fraction(a // b),
    ast.Mod: lambda a, b: a % b,
}


def evaluate(expr):
    """Evaluate integers, dotted decimals, + - * / // % and brackets exactly, as Fractions.
    A decimal is read from its source text ("4.25"), never through a float. Refuse anything else."""
    def walk(node):
        if isinstance(node, ast.Expression):
            return walk(node.body)
        if isinstance(node, ast.Constant) and type(node.value) is int:
            if "_" in ast.get_source_segment(expr, node):
                raise ValueError(f"unsupported syntax in expr {expr!r}")
            return Fraction(node.value)
        if isinstance(node, ast.Constant) and type(node.value) is float:
            text = ast.get_source_segment(expr, node)
            if not DECIMAL_LITERAL.match(text):
                raise ValueError(f"unsupported number {text!r} in expr {expr!r}")
            return Fraction(text)
        if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
            return _OPS[type(node.op)](walk(node.left), walk(node.right))
        raise ValueError(f"unsupported syntax in expr {expr!r}")
    return walk(ast.parse(expr, mode="eval"))


def answer_value(answer):
    """The exact value of a canonical answer: "12", "3/4" or "4,25"."""
    if "," in answer:
        return Fraction(answer.replace(",", "."))
    num, _, den = answer.partition("/")
    return Fraction(int(num), int(den) if den else 1)


def canonical_answer(value):
    """How a whole-number or fraction answer must be written. A lesson may give a value such as
    17/4 as the decimal 4,25 instead; that case is checked by value."""
    if value.denominator == 1:
        return str(value.numerator)
    return f"{value.numerator}/{value.denominator}"


def _groups():
    """Grades and extras, each with the content folder its Markdown lives in."""
    grades = [(f"grade{g['grade']}", g) for g in DATA["grades"]]
    return grades + [(x["id"], x) for x in DATA.get("extras", [])]


def _lessons():
    return [(folder, lesson) for folder, group in _groups() for lesson in group["lessons"]]


def _problems():
    return [(lesson["id"], i, p)
            for _, lesson in _lessons()
            for i, p in enumerate(lesson.get("problems", []))]


def test_evaluate_is_exact_and_refuses_other_syntax():
    assert evaluate("2/3 * 4/5") == Fraction(8, 15)
    assert evaluate("(1/2 + 1/3) * 6") == 5
    assert evaluate("60 - 60 * 3/5") == 24
    assert evaluate("4.25 + 1.5") == Fraction(23, 4)
    assert evaluate("0.1 + 0.2") == Fraction(3, 10)
    assert evaluate("17 // 5") == 3
    assert evaluate("17 % 5") == 2
    for bad in ("2**3", "abs(1)", "x + 1", "-1", "1e3", "1.", ".5", "1_000"):
        with pytest.raises(ValueError):
            evaluate(bad)


def test_answer_shapes():
    for good in ("0", "12", "3/4", "4,25", "0,5", "120,05"):
        assert ANSWER_RE.match(good), good
    for bad in ("012", "4,250", "4,0", "4,", ",5", "4.25", "3/0", "3/04", "-1"):
        assert not ANSWER_RE.match(bad), bad
    assert answer_value("4,25") == Fraction(17, 4)
    assert answer_value("3/4") == Fraction(3, 4)
    assert canonical_answer(Fraction(8, 1)) == "8"
    assert canonical_answer(Fraction(6, 8)) == "3/4"


def test_grades_are_one_to_five_in_order():
    assert [g["grade"] for g in DATA["grades"]] == [1, 2, 3, 4, 5]
    assert DATA["defaultGrade"] in {1, 2, 3, 4, 5}


def test_lesson_ids_are_unique():
    ids = [lesson["id"] for _, lesson in _lessons()]
    assert len(ids) == len(set(ids)), sorted(i for i in ids if ids.count(i) > 1)


def test_every_content_file_is_listed_once_under_its_folder():
    files = sorted(CONTENT_DIR.glob("*/*.md"))
    assert files, "no content files found"
    listed = {(folder, lesson["id"]) for folder, lesson in _lessons()}
    on_disk = {(f.parent.name, f.stem) for f in files}
    assert listed == on_disk, {
        "listed but no file": sorted(listed - on_disk),
        "file but not listed": sorted(on_disk - listed),
    }


def test_titles_match_the_content_headings():
    for folder, lesson in _lessons():
        path = CONTENT_DIR / folder / f"{lesson['id']}.md"
        heading = path.read_text(encoding="utf-8").splitlines()[0]
        assert heading == f"# {lesson['title']}", (lesson["id"], heading)


def test_extras_are_a_nang_cao_tab_of_practice_lessons():
    """The user asked for a bonus tab beside the grade chips, starting with "Nhóm nhân tử" without
    variables (2026-09-17). Every lesson in it has Ghi nhớ and practice with whole-number answers."""
    extras = DATA["extras"]
    assert [x["id"] for x in extras] == ["nang-cao"]
    for extra in extras:
        assert set(extra) == EXTRA_KEYS, (extra["id"], set(extra) ^ EXTRA_KEYS)
        assert re.fullmatch(r"[a-z0-9-]+", extra["id"]) and not extra["id"].startswith("grade")
        for key in ("label", "title", "note"):
            assert extra[key].strip(), (extra["id"], key)
        assert extra["lessons"], extra["id"]
        for lesson in extra["lessons"]:
            assert "ghiNho" in lesson and "problems" in lesson, lesson["id"]
            for i, problem in enumerate(lesson["problems"]):
                assert WHOLE_NUMBER_RE.match(problem["answer"]), (lesson["id"], i + 1, problem["answer"])


# Lessons still waiting for their Ghi nhớ and practice. Each grade's ids leave this set as its
# practice is written (content pass, 2026-09-17); every other lesson must have both.
AWAITING_PRACTICE = {
    "so-thap-phan", "phep-tinh-voi-so-thap-phan", "ti-so-phan-tram", "dien-tich-va-the-tich",
}


def test_lesson_fields():
    for _, lesson in _lessons():
        assert set(lesson) <= LESSON_KEYS, (lesson["id"], set(lesson) - LESSON_KEYS)
        assert lesson["title"].strip()
        # A lesson with content has both cards; the home screen tags it "Ghi nhớ · Luyện tập".
        waiting = lesson["id"] in AWAITING_PRACTICE
        assert ("ghiNho" not in lesson and "problems" not in lesson) if waiting else \
            ("ghiNho" in lesson and "problems" in lesson), lesson["id"]
        if "ghiNho" in lesson:
            assert 3 <= len(lesson["ghiNho"]) <= 5, lesson["id"]
            assert all(isinstance(b, str) and b.strip() for b in lesson["ghiNho"]), lesson["id"]
            assert len(lesson["problems"]) == 9, lesson["id"]


def test_no_grade_has_a_highlight_unit():
    """Only Lớp 4 had a "Chủ đề nổi bật" unit, which the user found inconsistent (2026-09-16).
    Every grade shows one plain lesson list instead."""
    for grade in DATA["grades"]:
        assert "featured" not in grade, f"grade {grade['grade']} still has a featured unit"


def test_problem_fields():
    for lesson_id, i, problem in _problems():
        where = f"{lesson_id} problem {i + 1}"
        assert set(problem) <= PROBLEM_KEYS, (where, set(problem) - PROBLEM_KEYS)
        assert problem["question"].strip(), where
        assert isinstance(problem["simplest"], bool), where
        assert ANSWER_RE.match(problem["answer"]), (where, problem["answer"])
        if "unit" in problem:
            assert isinstance(problem["unit"], str) and problem["unit"].strip(), where


def test_every_answer_is_its_expression_in_canonical_form():
    """A decimal answer's own shape (no trailing zeros, no "4,0") is held by ANSWER_RE in
    test_problem_fields; here it only has to equal its expression."""
    wrong = []
    for lesson_id, i, problem in _problems():
        value = evaluate(problem["expr"])
        answer = problem["answer"]
        if "," in answer:
            ok = answer_value(answer) == value
        else:
            ok = answer == canonical_answer(value)
        if not ok:
            wrong.append(f"{lesson_id} problem {i + 1}: {problem['expr']} = {value}, answer says {answer}")
    assert not wrong, "\n".join(wrong)


def test_maths_uses_balanced_backslash_parens_and_no_dollars():
    texts = [(lesson["id"], t) for _, lesson in _lessons() for t in lesson.get("ghiNho", [])]
    texts += [(lesson_id, p["question"]) for lesson_id, _, p in _problems()]
    for lesson_id, text in texts:
        assert "$" not in text, (lesson_id, text)
        assert text.count("\\(") == text.count("\\)"), (lesson_id, text)
