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

ANSWER_RE = re.compile(r"^(0|[1-9]\d*)(/[1-9]\d*)?$")
LESSON_KEYS = {"id", "title", "ghiNho", "problems"}
PROBLEM_KEYS = {"question", "expr", "answer", "simplest", "unit"}

_OPS = {
    ast.Add: lambda a, b: a + b,
    ast.Sub: lambda a, b: a - b,
    ast.Mult: lambda a, b: a * b,
    ast.Div: lambda a, b: a / b,
}


def evaluate(expr):
    """Evaluate integers, + - * / and brackets exactly, as Fractions. Refuse anything else."""
    def walk(node):
        if isinstance(node, ast.Expression):
            return walk(node.body)
        if isinstance(node, ast.Constant) and type(node.value) is int:
            return Fraction(node.value)
        if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
            return _OPS[type(node.op)](walk(node.left), walk(node.right))
        raise ValueError(f"unsupported syntax in expr {expr!r}")
    return walk(ast.parse(expr, mode="eval"))


def parse_answer(answer):
    num, _, den = answer.partition("/")
    return int(num), int(den) if den else 1


def _lessons():
    return [(g["grade"], lesson) for g in DATA["grades"] for lesson in g["lessons"]]


def _problems():
    return [(lesson["id"], i, p)
            for _, lesson in _lessons()
            for i, p in enumerate(lesson.get("problems", []))]


def test_evaluate_is_exact_and_refuses_other_syntax():
    assert evaluate("2/3 * 4/5") == Fraction(8, 15)
    assert evaluate("(1/2 + 1/3) * 6") == 5
    assert evaluate("60 - 60 * 3/5") == 24
    for bad in ("2**3", "abs(1)", "1.5 * 2", "x + 1", "-1"):
        with pytest.raises(ValueError):
            evaluate(bad)


def test_grades_are_one_to_five_in_order():
    assert [g["grade"] for g in DATA["grades"]] == [1, 2, 3, 4, 5]
    assert DATA["defaultGrade"] in {1, 2, 3, 4, 5}


def test_lesson_ids_are_unique():
    ids = [lesson["id"] for _, lesson in _lessons()]
    assert len(ids) == len(set(ids)), sorted(i for i in ids if ids.count(i) > 1)


def test_every_content_file_is_listed_once_under_its_grade():
    files = sorted(CONTENT_DIR.glob("grade*/*.md"))
    assert files, "no content files found"
    listed = {(grade, lesson["id"]) for grade, lesson in _lessons()}
    on_disk = {(int(f.parent.name.removeprefix("grade")), f.stem) for f in files}
    assert listed == on_disk, {
        "listed but no file": sorted(listed - on_disk),
        "file but not listed": sorted(on_disk - listed),
    }


def test_titles_match_the_content_headings():
    for grade, lesson in _lessons():
        path = CONTENT_DIR / f"grade{grade}" / f"{lesson['id']}.md"
        heading = path.read_text(encoding="utf-8").splitlines()[0]
        assert heading == f"# {lesson['title']}", (lesson["id"], heading)


def test_lesson_fields():
    for _, lesson in _lessons():
        assert set(lesson) <= LESSON_KEYS, (lesson["id"], set(lesson) - LESSON_KEYS)
        assert lesson["title"].strip()
        # A lesson with content has both cards; the home screen tags it "Ghi nhớ · Luyện tập".
        assert ("ghiNho" in lesson) == ("problems" in lesson), lesson["id"]
        if "ghiNho" in lesson:
            assert 3 <= len(lesson["ghiNho"]) <= 5, lesson["id"]
            assert all(isinstance(b, str) and b.strip() for b in lesson["ghiNho"]), lesson["id"]
            assert 8 <= len(lesson["problems"]) <= 10, lesson["id"]


def test_featured_units_point_at_practice_lessons_in_their_grade():
    for grade in DATA["grades"]:
        featured = grade.get("featured")
        if featured is None:
            continue
        assert featured["title"].strip()
        ids = featured["lessonIds"]
        assert ids and len(ids) == len(set(ids))
        by_id = {lesson["id"]: lesson for lesson in grade["lessons"]}
        for lesson_id in ids:
            assert lesson_id in by_id, (grade["grade"], lesson_id)
            assert "problems" in by_id[lesson_id], f"featured {lesson_id} has no practice"


def test_problem_fields():
    for lesson_id, i, problem in _problems():
        where = f"{lesson_id} problem {i + 1}"
        assert set(problem) <= PROBLEM_KEYS, (where, set(problem) - PROBLEM_KEYS)
        assert problem["question"].strip(), where
        assert isinstance(problem["simplest"], bool), where
        assert ANSWER_RE.match(problem["answer"]), (where, problem["answer"])
        if "unit" in problem:
            assert isinstance(problem["unit"], str) and problem["unit"].strip(), where


def test_every_answer_is_its_expression_in_lowest_terms():
    wrong = []
    for lesson_id, i, problem in _problems():
        num, den = parse_answer(problem["answer"])
        value = evaluate(problem["expr"])
        if Fraction(num, den) != value or (num, den) != (value.numerator, value.denominator):
            wrong.append(f"{lesson_id} problem {i + 1}: {problem['expr']} = {value}, "
                         f"answer says {problem['answer']}")
    assert not wrong, "\n".join(wrong)


def test_maths_uses_balanced_backslash_parens_and_no_dollars():
    texts = [(lesson["id"], t) for _, lesson in _lessons() for t in lesson.get("ghiNho", [])]
    texts += [(lesson_id, p["question"]) for lesson_id, _, p in _problems()]
    for lesson_id, text in texts:
        assert "$" not in text, (lesson_id, text)
        assert text.count("\\(") == text.count("\\)"), (lesson_id, text)
