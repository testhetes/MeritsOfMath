# Content Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every lesson in Lớp 1–5 gets Ghi nhớ and 9 practice problems. Lớp 5 can take decimal answers. A "Nâng cao ★" tab next to the grade chips holds four "Nhóm nhân tử" lessons that use numbers only.

**Architecture:** All practice is data in `lessons.json`, checked on the device by `js/lessons.js`. `tests/test_lessons.py` recomputes every answer. Extras sit in a new top-level `extras` array, and their lessons are indexed with the grades' lessons, so cards, hints and replay work unchanged. Only the four Nâng cao Markdown files go to the knowledge base.

**Tech Stack:**
- Vanilla JS, with no build step and no Node.
- Python pytest for the offline checks.
- The Browser pane on the `static` launch config (`python -m http.server 8000`) for the device checks.
- Cloudflare Vectorize via `python -m scripts.rag.upload`.

Spec: `docs/superpowers/specs/2026-09-17-content-pass-design.md`.

## Global Constraints

**Answers and questions**
- Canonical answer forms: `"12"`, `"3/4"`, `"4,25"`.
  - Decimals use a Vietnamese comma, with no leading zeros except a single `0` before the comma, and no trailing zeros after it.
  - Fractions are in lowest terms.
- `ANSWER_RE` is `^(0|[1-9]\d*)(/[1-9]\d*|,\d*[1-9])?$`.
- `expr` may contain decimal literals written with a dot (`4.25 + 1.5`). They are evaluated exactly, from their source text, never through a float.
- `parseAnswer` accepts:
  - a whole number (up to 6 digits);
  - `a/b` (up to 6 digits each);
  - a decimal with `,` or `.` (up to 6 digits before the separator, 4 after).
- `checkAnswer` cross-multiplies with `BigInt`. `simplest` only concerns fractions.
- Questions are in Vietnamese.
  - Written expressions go inside `\( \)`, using `\times`, `:`, `+`, `-` and `\dfrac{a}{b}`.
  - A decimal inside maths is written `4{,}25`, so MathJax does not add a space after the comma. In running text it is `4,25`.
- Units go in `unit`, never in `answer`. `simplest: true` only when the question says "rút gọn".
- `expr` repeats the question's own expression as the child sees it (`43 * 27 + 43 * 73`), not a regrouped form, so the tests check the question's arithmetic. A fill-in or pick-one question uses the calculation that finds it (`7 - 3`) or the literal value.
- Each lesson has 3–5 Ghi nhớ bullets, drawn from its own Markdown, and exactly 9 problems. Nâng cao answers are whole numbers.

**Keypad**
- Answer layout row 4 is `0` (2 columns), `,` (`aria-label` "Dấu phẩy"), with "Kiểm tra" spanning rows 3–4.
- `PARTIAL_ANSWER` is `^(\d{1,6}(\/\d{0,6}|[.,]\d{0,4})?)?$`.

**Nâng cao tab**
- `extras` entry: `id "nang-cao"`, `label "Nâng cao"`, `title "Nâng cao · Nhóm nhân tử"`, `note "Dành cho học sinh lớp 4–5 thích thử thách."`.
- Its files live in `content/nang-cao/<lesson id>.md`.
- The chip reads "Nâng cao ★", with `btn grade-chip tone-lavender`.
- `meritsGrade` stores `"nang-cao"`. An unknown stored value falls back to `defaultGrade`.

**Handling rules**
- Edit JSON with the Edit tool or a Python script file in the scratchpad, never with a Bash heredoc (it mangles backslashes).
- Secrets are never committed, printed, echoed or put in assertion messages. Read `INGEST_SECRET` with `[Environment]::GetEnvironmentVariable('INGEST_SECRET','User')` inside the same PowerShell invocation.
- Never set `RAG_ALLOW_PROD_WRITES`. Uploading to the knowledge base needs the user's explicit OK at the time.
- Commit with explicit paths only. Never `git add -A`. Every commit message ends with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Never add a root-level `conftest.py`.

**User checkpoints**
1. A maths and wording review of all new content, before any upload or deploy.
2. An explicit OK before uploading the Nâng cao Markdown.

**Test commands**
- Offline suite: `python -m pytest tests -q`. Live tests skip without `RAG_BASE_URL`.
- Lesson data only: `python -m pytest tests/test_lessons.py -q`.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `tests/test_lessons.py` | modify | exact decimal evaluation, the new answer shape, extras schema and folders, the practice-coverage rule |
| `js/lessons.js` | modify | decimal `parseAnswer`/`checkAnswer`; extras indexed and shown on Home as a chip, heading and note |
| `js/mathpad.js` | modify | decimal `PARTIAL_ANSWER`; `,` key in the answer layout |
| `chat.css` | modify | `.home-note` |
| `lessons.json` | modify | `extras` with 4 lessons; Ghi nhớ and problems for the 16 remaining lessons |
| `content/nang-cao/*.md` | create | the four Nâng cao explanations (knowledge base) |
| `tests/evals/retrieval_cases.json` | modify | 4 new retrieval cases |
| `tests/test_retrieval_eval.py` | modify | the re-measured numbers comment and the ratchet after the live run |
| `docs/RAG-OPERATIONS.md` | modify | vector and document counts |

---

### Task 1: Decimal answers in the data checks

**Files:**
- Modify: `tests/test_lessons.py`

**Interfaces:**
- Produces:
  - `evaluate(expr) -> Fraction`, which now accepts dotted decimal literals and `//`, `%`;
  - `answer_value(answer) -> Fraction`;
  - `canonical_answer(value: Fraction) -> str | None`, which returns the whole-number or fraction form, or `None` when only a decimal can express it.
- Later content tasks rely on these to check their data.

`//` and `%` are added so the chia có dư lessons can write `17 // 5` and `17 % 5`, which read as what they check.

- [ ] **Step 1: Write the failing tests**

Replace `test_evaluate_is_exact_and_refuses_other_syntax` with:

```python
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
```

- [ ] **Step 2: Run them to see them fail**

Run: `python -m pytest tests/test_lessons.py -q -k "evaluate or answer_shapes"`

Expected: FAIL. `4.25` raises `ValueError`, and `answer_value` is not defined.

- [ ] **Step 3: Implement**

In `tests/test_lessons.py`:
- Set `ANSWER_RE = re.compile(r"^(0|[1-9]\d*)(/[1-9]\d*|,\d*[1-9])?$")`.
- Add `ast.FloorDiv: lambda a, b: Fraction(a // b)` and `ast.Mod: lambda a, b: a % b` to `_OPS`.
- Add `DECIMAL_LITERAL = re.compile(r"^\d+\.\d+$")`.
- Replace `evaluate` and `parse_answer`:

```python
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
    """How a whole-number or fraction answer must be written. None for a value such as 17/4
    that a lesson may instead give as the decimal 4,25."""
    if value.denominator == 1:
        return str(value.numerator)
    return f"{value.numerator}/{value.denominator}"
```

Replace `test_every_answer_is_its_expression_in_lowest_terms` with:

```python
def test_every_answer_is_its_expression_in_canonical_form():
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
```

A decimal answer's own shape (no trailing zeros, no `4,0`) is already enforced by `ANSWER_RE` in `test_problem_fields`.

- [ ] **Step 4: Run the lesson tests**

Run: `python -m pytest tests/test_lessons.py -q`

Expected: all pass. The existing Lớp 4 data still satisfies the stricter canonical check.

- [ ] **Step 5: Commit**

```bash
git add tests/test_lessons.py
git commit -m "test(lessons): exact decimal answers and // % in problem expressions"
```

---

### Task 2: Decimal answers on the device

**Files:**
- Modify: `js/lessons.js` (`parseAnswer`, `checkAnswer`, `gcd`, `FEEDBACK.invalid`)
- Modify: `js/mathpad.js` (`PARTIAL_ANSWER`, `LAYOUTS.answer`, header comment)

**Interfaces:**
- Produces:
  - `Lessons.parseAnswer(text) -> { num: bigint, den: bigint } | null`, where `den` is a power of ten for a decimal;
  - `Lessons.checkAnswer(text, problem) -> 'correct' | 'wrong' | 'not-simplest' | 'invalid'`.
- Its only callers are in `js/lessons.js` (`checkAnswer`, `cardMessages`, `problemCard`). `js/chat.js` does not call `parseAnswer`.

- [ ] **Step 1: Implement `parseAnswer` and `checkAnswer`**

In `js/lessons.js`, replace the answers section:

```js
    // ---- answers ----

    // A whole number, a fraction a/b, or a decimal written with "," or "." (4,25), spaces ignored.
    // At most 6 digits a part, and 4 after the decimal separator. Anything else, a zero denominator
    // included, is null. Values are BigInt, so cross-multiplying below stays exact.
    const ANSWER_SHAPE = /^(\d{1,6})(?:\/(\d{1,6})|[.,](\d{1,4}))?$/;

    function parseAnswer(text) {
        const match = String(text).replace(/\s+/g, '').match(ANSWER_SHAPE);
        if (!match) return null;
        if (match[3] !== undefined) {
            return { num: BigInt(match[1] + match[3]), den: 10n ** BigInt(match[3].length) };
        }
        const den = match[2] === undefined ? 1n : BigInt(match[2]);
        return den === 0n ? null : { num: BigInt(match[1]), den: den };
    }

    function gcd(a, b) {
        while (b) {
            [a, b] = [b, a % b];
        }
        return a;
    }

    // Any equal value is correct: 6/8 for 3/4, and 4,250, 4.25 or 17/4 for 4,25. The one exception
    // is a problem that asks to simplify, and that only concerns an answer written as a fraction.
    function checkAnswer(text, problem) {
        const given = parseAnswer(text);
        if (!given) return 'invalid';
        const expected = parseAnswer(problem.answer);
        if (given.num * expected.den !== expected.num * given.den) return 'wrong';
        if (problem.simplest && String(text).includes('/') && gcd(given.num, given.den) !== 1n) return 'not-simplest';
        return 'correct';
    }
```

Change `FEEDBACK.invalid` to `'Em viết đủ số nhé, ví dụ 12, 3/4 hoặc 4,25.'`.

- [ ] **Step 2: Implement the keypad changes**

In `js/mathpad.js`:
- Update the comment above `PARTIAL_ANSWER`, and the constant itself:

```js
    // An answer is a whole number, a/b, or a decimal with "," or "." (js/lessons.js parseAnswer).
    // Partial answers ("", "12", "12/", "4,") are allowed while typing; a leading "/" or "," is not,
    // and so is a second separator.
    const PARTIAL_ANSWER = /^(\d{1,6}(\/\d{0,6}|[.,]\d{0,4})?)?$/;
```

- Replace the answer layout's last line so row 4 is `0` (2 columns), `,`, with Kiểm tra (rows 2) beside it:

```js
            { text: 'Kiểm tra', tone: 'green', action: 'check', word: true, rows: 2 },
            digit('0', { cols: 2 }),
            { text: ',', aria: 'Dấu phẩy', insert: ',' }
```

- Change the header comment's "digits, the fraction bar, Kiểm tra" to "digits, the fraction bar, the decimal comma, Kiểm tra".

- [ ] **Step 3: Run the offline suite**

Run: `python -m pytest tests -q`

Expected: all offline tests pass. There are no JS unit tests; behaviour is checked in the browser next.

- [ ] **Step 4: Check in the browser**

1. `preview_start {name: "static"}` and navigate to `http://localhost:8000/`.
2. Clear stale files with `javascript_tool`:

```js
(async () => {
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  for (const k of await caches.keys()) await caches.delete(k);
  for (const f of ['js/lessons.js', 'js/mathpad.js', 'chat.css', 'lessons.json']) await fetch(f, { cache: 'reload' });
  location.reload();
})()
```

3. Run the `checkAnswer` table:

```js
const p = { answer: '4,25', simplest: false };
const q = { answer: '1/2', simplest: true };
const rows = [
  ['4,25', p, 'correct'], ['4.25', p, 'correct'], ['4,250', p, 'correct'], ['17/4', p, 'correct'],
  ['4,2', p, 'wrong'], ['4,25,1', p, 'invalid'], ['4,', p, 'invalid'], [',', p, 'invalid'], ['4,12345', p, 'invalid'],
  ['2/4', q, 'not-simplest'], ['0,5', q, 'correct'], ['1/2', q, 'correct'],
  ['999999,9999', { answer: '999999,9999', simplest: false }, 'correct']
];
rows.map(([t, prob, want]) => [t, Lessons.checkAnswer(t, prob), want]).filter((r) => r[1] !== r[2])
```

   Expected: `[]`.

4. Check the keypad on a phone:
   - `resize_window {preset: "mobile"}`, then reload.
   - Open "Nhân hai phân số" → "Cho em bài để luyện tập".
   - Tap the answer box. The docked keypad's last row shows `0` (wide), `,`, with Kiểm tra beside rows 3–4.
   - Tap `4` `,` `2` `5` `,`. The box reads `4,25`: the second comma is refused.
   - Screenshot, then `resize_window {preset: "desktop"}`.
5. Check the desktop pop-up at 1280×800: the keypad button opens the pop-up with the same last row, and `1` `,` `5` types `1,5`. Screenshot.
6. `read_console_messages {onlyErrors: true}` returns nothing.

- [ ] **Step 5: Commit**

```bash
git add js/lessons.js js/mathpad.js
git commit -m "feat(practice): decimal answers and a comma key on the maths keypad"
```

---

### Task 3: The Nâng cao tab, with its first lesson

**Files:**
- Modify: `tests/test_lessons.py`, `js/lessons.js`, `chat.css`, `lessons.json`, `tests/evals/retrieval_cases.json`
- Create: `content/nang-cao/nhan-mot-so-voi-mot-tong.md`

**Interfaces:**
- Consumes: `evaluate`, `answer_value`, `canonical_answer` (Task 1).
- Produces:
  - `_groups()` in the tests returns `[(folder, group_dict)]`, where folder is `"grade1"`…`"grade5"` or the extra's id;
  - `_lessons()` returns `[(folder, lesson)]` for grades and extras;
  - `lessons.json` has `extras: [{ id, label, title, note, lessons }]`.
- In JS, `groups()` returns `[{ key, label, heading, note?, tone, lessons }]`, with keys `"1"`…`"5"` and `"nang-cao"`.

- [ ] **Step 1: Write the failing tests**

In `tests/test_lessons.py`, replace `_lessons`, and add the extras constants after `PROBLEM_KEYS`:

```python
EXTRA_KEYS = {"id", "label", "title", "note", "lessons"}
WHOLE_NUMBER_RE = re.compile(r"^(0|[1-9]\d*)$")


def _groups():
    """Grades and extras, each with the content folder its Markdown lives in."""
    grades = [(f"grade{g['grade']}", g) for g in DATA["grades"]]
    return grades + [(x["id"], x) for x in DATA.get("extras", [])]


def _lessons():
    return [(folder, lesson) for folder, group in _groups() for lesson in group["lessons"]]
```

Update the two content-file tests to use folders:

```python
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
```

Add:

```python
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
```

`test_lesson_ids_are_unique` already covers extras through the new `_lessons()`.

- [ ] **Step 2: Run them to see them fail**

Run: `python -m pytest tests/test_lessons.py -q`

Expected: FAIL with `KeyError: 'extras'`.

- [ ] **Step 3: Write the lesson Markdown**

Create `content/nang-cao/nhan-mot-so-voi-mot-tong.md` in the existing lesson style: the child is "em", short paragraphs, plain-text maths using `×`, `−` and `=`.

Write each section below as short prose paragraphs:

- `# Nhân một số với một tổng, một hiệu`
- Intro: a × (b + c) means a groups, each made of b things and c things. So em can count the b things and the c things separately and add.
- `## Nhân một số với một tổng`: the rule a × (b + c) = a × b + a × c. Picture 4 hàng hoa, each with 3 bông đỏ and 5 bông vàng: 4 × (3 + 5) = 4 × 8 = 32, and 4 × 3 + 4 × 5 = 12 + 20 = 32.
- `## Nhân một số với một hiệu`: the rule a × (b − c) = a × b − a × c. 6 × (10 − 2) = 6 × 8 = 48, and 6 × 10 − 6 × 2 = 60 − 12 = 48.
- `## Dùng để tính nhẩm`: split one factor into a round number plus or minus a little. 25 × 12 = 25 × 10 + 25 × 2 = 250 + 50 = 300; 15 × 9 = 15 × 10 − 15 = 150 − 15 = 135.
- `## Lỗi thường gặp`: multiplying only the first number, writing 4 × (3 + 5) as 4 × 3 + 5 = 17. Every number inside the brackets must be multiplied.
- `## Luyện tập`: "Tính nhẩm 32 × 11." and "Tính bằng hai cách: 9 × (10 − 4)."

- [ ] **Step 4: Add the extra and its lesson to `lessons.json`**

Add after the `grades` array, via the Edit tool:

```json
  "extras": [
    {
      "id": "nang-cao",
      "label": "Nâng cao",
      "title": "Nâng cao · Nhóm nhân tử",
      "note": "Dành cho học sinh lớp 4–5 thích thử thách.",
      "lessons": [
        {
          "id": "nhan-mot-so-voi-mot-tong",
          "title": "Nhân một số với một tổng, một hiệu",
          "ghiNho": [ ... ],
          "problems": [ ... ]
        }
      ]
    }
  ]
```

**Ghi nhớ** (4 bullets):
1. `\(a \times (b + c) = a \times b + a \times c\)`, stating that the number is multiplied with each addend and the results are added.
2. `\(a \times (b - c) = a \times b - a \times c\)`.
3. For mental maths, split a factor into a round number plus or minus a little: `\(25 \times 12 = 25 \times 10 + 25 \times 2\)`.
4. Every number inside the brackets is multiplied, none is left out.

**Problems.** Write each question in full Vietnamese; the `expr` and `answer` are fixed:

| # | question gist | expr | answer | unit |
|---|---|---|---|---|
| 1 | Tính bằng hai cách: `\(7 \times (10 + 3)\)` | `7 * (10 + 3)` | 91 | |
| 2 | Tính bằng hai cách: `\(5 \times (20 - 4)\)` | `5 * (20 - 4)` | 80 | |
| 3 | Điền số vào chỗ dấu hỏi: `\(8 \times (6 + 4) = 8 \times 6 + 8 \times \, ?\)` | `4` | 4 | |
| 4 | Tính nhẩm `\(35 \times 11\)` | `35 * 11` | 385 | |
| 5 | Tính nhẩm `\(45 \times 9\)` | `45 * 9` | 405 | |
| 6 | Tính nhẩm `\(12 \times 102\)` | `12 * 102` | 1224 | |
| 7 | Tính nhẩm `\(7 \times 99\)` | `7 * 99` | 693 | |
| 8 | Mỗi hộp có 12 bút chì xanh và 8 bút chì đỏ. 6 hộp có bao nhiêu bút chì? | `6 * (12 + 8)` | 120 | chiếc |
| 9 | Mỗi gói kẹo có 24 cái. An mua 11 gói. An có bao nhiêu cái kẹo? | `24 * 11` | 264 | cái |

All nine have `"simplest": false`.

- [ ] **Step 5: Add its retrieval case**

Append to `tests/evals/retrieval_cases.json`:

```json
  {
    "query": "Lấy 6 nhân với tổng của 10 và 3 thì có được tách ra nhân từng số rồi cộng lại không ạ?",
    "expect_doc_id": "nhan-mot-so-voi-mot-tong"
  }
```

- [ ] **Step 6: Run the offline suite**

Run: `python -m pytest tests -q`

Expected: all pass, including `test_case_has_no_lexical_confound_with_target_document` for the new case and `test_negative_case_shares_no_five_gram_with_any_document` against the new file. If the confound guard fails, reword the query, not the lesson.

- [ ] **Step 7: Show extras on Home**

In `js/lessons.js`:
- `load()` indexes extras too:

```js
                if (json && Array.isArray(json.grades)) {
                    lessonsById.clear();
                    json.grades.concat(json.extras || []).forEach((group) =>
                        group.lessons.forEach((lesson) => lessonsById.set(lesson.id, lesson)));
                    data = json;
                }
```

- Replace `currentGrade` and `saveGrade` with:

```js
    // Home's tabs: one per grade, then one per extra topic such as "Nâng cao". meritsGrade stores
    // the grade number or the extra's id.
    function groups() {
        const grades = data.grades.map((g) => ({
            key: String(g.grade),
            label: 'Lớp ' + g.grade,
            heading: 'Các bài học lớp ' + g.grade,
            tone: GRADE_TONES[g.grade] || 'neutral',
            lessons: g.lessons
        }));
        const extras = (data.extras || []).map((x) => ({
            key: x.id,
            label: x.label + ' ★',
            heading: x.title,
            note: x.note,
            tone: 'lavender',
            lessons: x.lessons
        }));
        return grades.concat(extras);
    }

    function currentGroup(list) {
        let saved = null;
        try {
            saved = localStorage.getItem(GRADE_KEY);
        } catch {
            // Storage unavailable: use the default grade.
        }
        return list.find((group) => group.key === saved) ||
            list.find((group) => group.key === String(data.defaultGrade)) || list[0];
    }

    function saveGroup(key) {
        try {
            localStorage.setItem(GRADE_KEY, key);
        } catch {
            // Storage unavailable: the choice lasts until the page reloads.
        }
    }
```

- In `renderHome`, replace everything from `const grade = currentGrade();` through the heading. The greeting block is unchanged:

```js
        const list = groups();
        const current = currentGroup(list);
        // (home-top greeting and stickers unchanged)

        const chips = el('div', 'grade-chips');
        list.forEach((group) => {
            const chip = button(group.label, 'btn grade-chip tone-' + group.tone, () => {
                saveGroup(group.key);
                renderHome(container, onPick);
            });
            chip.setAttribute('aria-pressed', String(group === current));
            chips.appendChild(chip);
        });
        container.appendChild(chips);

        container.appendChild(el('h2', 'home-heading', current.heading));
        if (current.note) container.appendChild(el('p', 'home-note', current.note));
        const lessonList = el('div', 'lesson-list');
        practiceFirst(current.lessons).forEach((lesson) => {
```

  Rename the rest of the old `list` variable (the lesson grid) to `lessonList`.

In `chat.css`, after `.home-heading`, add:

```css
/* The extra topic's one-line note under its heading ("Dành cho học sinh lớp 4–5 thích thử thách."). */
.home-note { margin: -10px 0 0; font-family: var(--font-body); font-weight: 700; }
```

Also add `.home-note { font-size: 1.1rem; }` inside the `@media (min-width: 900px)` block, after `.home-heading`.

- [ ] **Step 8: Check in the browser**

1. Clear stale files and reload, as in Task 2 Step 4.2.
2. At 375×812 (mobile preset):
   - Home shows six chips; the last is "Nâng cao ★" in lavender.
   - Tap it. The heading reads "Nâng cao · Nhóm nhân tử", the note is under it, and there is one lesson card tagged "Ghi nhớ · Luyện tập".
   - `localStorage.meritsGrade === "nang-cao"`.
   - Reload: still selected.
   - Screenshot.
3. Open the lesson → "Những kiến thức phải nhớ" shows 4 bullets with rendered maths → "Cho em bài để luyện tập" → type `91` with the keypad → "Kiểm tra" says "Giỏi quá!".
4. At 1280×800: the chips are centred on one row, and "Nâng cao ★" is pressed. Screenshot.
5. Set `localStorage.meritsGrade = "7"` and reload. Lớp 4 (`defaultGrade`) is selected.
6. `read_console_messages {onlyErrors: true}` returns nothing.
7. Clean up: `localStorage.removeItem('meritsGrade'); localStorage.removeItem('meritsChatHistory')`.

- [ ] **Step 9: Commit**

```bash
git add tests/test_lessons.py js/lessons.js chat.css lessons.json content/nang-cao/nhan-mot-so-voi-mot-tong.md tests/evals/retrieval_cases.json
git commit -m "feat(home): Nâng cao tab with its first Nhóm nhân tử lesson"
```

---

### Task 4: The other three Nâng cao lessons

**Files:**
- Create:
  - `content/nang-cao/dat-thua-so-chung.md`
  - `content/nang-cao/thua-so-chung-an.md`
  - `content/nang-cao/bai-toan-nhom-nhan-tu.md`
- Modify: `lessons.json` (extras lessons 2–4), `tests/evals/retrieval_cases.json`

**Interfaces:**
- Consumes: the extras shape and tests from Task 3.

- [ ] **Step 1: Write the failing change**

Add the three lesson entries (`id` and `title` only for now) to `extras[0].lessons` in `lessons.json`:

- `dat-thua-so-chung` / "Đặt thừa số chung ra ngoài";
- `thua-so-chung-an` / "Tìm thừa số chung ẩn";
- `bai-toan-nhom-nhan-tu` / "Bài toán có lời văn dùng nhóm nhân tử".

Run: `python -m pytest tests/test_lessons.py -q`

Expected: FAIL, "listed but no file" for the three ids, and the extras test fails because Ghi nhớ and problems are missing.

- [ ] **Step 2: Write `dat-thua-so-chung.md`**

Use the same style as Task 3, with these sections and examples:

- `# Đặt thừa số chung ra ngoài`
- Intro: the rule from the previous lesson, read from right to left: `a × b + a × c = a × (b + c)`.
- `## Tìm thừa số chung`: 37 × 18 + 37 × 82 = 37 × (18 + 82) = 37 × 100 = 3700.
- `## Với một hiệu`: 56 × 13 − 56 × 3 = 56 × (13 − 3) = 56 × 10 = 560.
- `## Thừa số chung có thể đứng sau`: 18 × 25 + 82 × 25 = (18 + 82) × 25 = 100 × 25 = 2500.
- `## Khi nào nên dùng`: when the numbers left in the brackets make a round ten, hundred or thousand.
- `## Lỗi thường gặp`:
  - forgetting the brackets (37 × 18 + 82);
  - grouping two products with no common factor (12 × 5 + 8 × 7).
- `## Luyện tập`: two items.

`lessons.json` Ghi nhớ (4 bullets):
1. `\(a \times b + a \times c = a \times (b + c)\)`.
2. `\(a \times b - a \times c = a \times (b - c)\)`.
3. The common factor may stand first or second in each product.
4. Grouping is quickest when the bracket gives 10, 100 or 1000.

| # | question gist | expr | answer | unit |
|---|---|---|---|---|
| 1 | Tính nhanh `\(43 \times 27 + 43 \times 73\)` | `43 * 27 + 43 * 73` | 4300 | |
| 2 | Tính nhanh `\(26 \times 64 + 26 \times 36\)` | `26 * 64 + 26 * 36` | 2600 | |
| 3 | Tính nhanh `\(58 \times 17 - 58 \times 7\)` | `58 * 17 - 58 * 7` | 580 | |
| 4 | Tính nhanh `\(125 \times 13 - 125 \times 5\)` | `125 * 13 - 125 * 5` | 1000 | |
| 5 | Tính nhanh `\(19 \times 64 + 36 \times 19\)` | `19 * 64 + 36 * 19` | 1900 | |
| 6 | Tính nhanh `\(234 \times 45 - 234 \times 35\)` | `234 * 45 - 234 * 35` | 2340 | |
| 7 | Điền số: `\(48 \times 25 + 48 \times 75 = 48 \times \, ?\)` | `25 + 75` | 100 | |
| 8 | Buổi sáng bán 35 bao gạo, buổi chiều bán 65 bao, mỗi bao 25 kg. Cả ngày bán bao nhiêu ki-lô-gam? | `35 * 25 + 65 * 25` | 2500 | kg |
| 9 | Mỗi vé xem xiếc giá 45 nghìn đồng. Lớp 4A mua 28 vé, lớp 4B mua 22 vé. Hai lớp trả bao nhiêu nghìn đồng? | `45 * 28 + 45 * 22` | 2250 | nghìn đồng |

- [ ] **Step 3: Write `thua-so-chung-an.md`**

- `# Tìm thừa số chung ẩn`
- Intro: sometimes the common factor is hidden.
- `## Số đứng một mình là số đó nhân với 1`: 45 × 99 + 45 = 45 × 99 + 45 × 1 = 45 × 100 = 4500.
- `## Thừa số chung giấu trong một tích`: 25 × 36 + 50 × 32 = 25 × 36 + 25 × 2 × 32 = 25 × 36 + 25 × 64 = 25 × 100 = 2500.
- `## Nhiều hơn hai số hạng`: 18 × 7 + 18 × 2 + 18 = 18 × (7 + 2 + 1) = 18 × 10 = 180.
- `## Với phép trừ`: 64 × 101 − 64 = 64 × (101 − 1) = 6400.
- `## Mẹo`: ask which number appears in every term, and write a number standing alone as "× 1".
- `## Luyện tập`: two items.

Ghi nhớ (4 bullets):
1. A number alone equals itself × 1: `\(45 = 45 \times 1\)`.
2. A multiple can reveal the factor: `\(50 \times 32 = 25 \times 64\)`.
3. With three or more terms, put every term's other factor into the bracket.
4. Check that the common factor is in every term before grouping.

| # | question gist | expr | answer | unit |
|---|---|---|---|---|
| 1 | Tính nhanh `\(36 \times 99 + 36\)` | `36 * 99 + 36` | 3600 | |
| 2 | Tính nhanh `\(72 \times 101 - 72\)` | `72 * 101 - 72` | 7200 | |
| 3 | Tính nhanh `\(15 \times 7 + 15 \times 2 + 15\)` | `15 * 7 + 15 * 2 + 15` | 150 | |
| 4 | Tính nhanh `\(25 \times 46 + 50 \times 27\)` | `25 * 46 + 50 * 27` | 2500 | |
| 5 | Tính nhanh `\(12 \times 35 + 24 \times 30 + 12 \times 5\)` | `12 * 35 + 24 * 30 + 12 * 5` | 1200 | |
| 6 | Tính nhanh `\(47 \times 8 + 47 + 47\)` | `47 * 8 + 47 + 47` | 470 | |
| 7 | Tính nhanh `\(9 \times 58 + 9 \times 41 + 9\)` | `9 * 58 + 9 * 41 + 9` | 900 | |
| 8 | Tính nhanh `\(20 \times 48 + 40 \times 26\)` | `20 * 48 + 40 * 26` | 2000 | |
| 9 | Mỗi quyển truyện giá 18 nghìn đồng. An mua 6 quyển, Bình mua 3 quyển, Chi mua 1 quyển. Cả ba bạn trả bao nhiêu nghìn đồng? | `18 * 6 + 18 * 3 + 18 * 1` | 180 | nghìn đồng |

- [ ] **Step 4: Write `bai-toan-nhom-nhan-tu.md`**

- `# Bài toán có lời văn dùng nhóm nhân tử`
- Intro: word problems where the same amount repeats.
- `## Các bước`: read what is given and asked, write the expression, find the common factor, compute quickly, write the unit.
- `## Mua cùng một món hàng hai lần`: Mỗi quyển vở giá 8 nghìn đồng; thứ Hai mẹ mua 27 quyển, thứ Ba mua 23 quyển. 8 × 27 + 8 × 23 = 8 × 50 = 400 nghìn đồng.
- `## Các hàng ghế bằng nhau`: mỗi hàng 16 ghế; khu A có 14 hàng, khu B có 6 hàng. 16 × 14 + 16 × 6 = 16 × 20 = 320 ghế.
- `## Tìm phần còn lại`: mỗi thùng 24 chai; kho có 15 thùng, đã chuyển đi 5 thùng. 24 × 15 − 24 × 5 = 24 × 10 = 240 chai.
- `## Lỗi thường gặp`: grouping amounts that are not the same repeated quantity (price of different items).
- `## Luyện tập`: two items.

Ghi nhớ (4 bullets):
1. Look for an amount that repeats: the same price, the same number in each row or box.
2. Write the whole expression before calculating.
3. Put the repeated amount outside the bracket, and the counts inside.
4. Always write the unit.

| # | question gist | expr | answer | unit |
|---|---|---|---|---|
| 1 | Mỗi hộp bút có 12 chiếc. Lớp 4A nhận 37 hộp, lớp 4B nhận 63 hộp. Hai lớp nhận bao nhiêu chiếc bút? | `12 * 37 + 12 * 63` | 1200 | chiếc |
| 2 | Mỗi xe chở 45 bao xi măng. Buổi sáng có 13 xe, buổi chiều có 7 xe. Cả ngày chở bao nhiêu bao? | `45 * 13 + 45 * 7` | 900 | bao |
| 3 | Mỗi mét vải giá 35 nghìn đồng. Mẹ mua 16 m vải hoa và 4 m vải trắng. Mẹ trả bao nhiêu nghìn đồng? | `35 * 16 + 35 * 4` | 700 | nghìn đồng |
| 4 | Mỗi thùng có 24 chai. Kho có 38 thùng, đã chuyển đi 18 thùng. Kho còn bao nhiêu chai? | `24 * 38 - 24 * 18` | 480 | chai |
| 5 | Cô chia kẹo, mỗi bạn 15 cái. Tổ 1 có 9 bạn, tổ 2 có 8 bạn, tổ 3 có 3 bạn. Cô chia hết bao nhiêu cái kẹo? | `15 * 9 + 15 * 8 + 15 * 3` | 300 | cái |
| 6 | Vé người lớn giá 50 nghìn đồng, vé trẻ em giá 25 nghìn đồng. Đoàn có 32 người lớn và 36 trẻ em. Cả đoàn trả bao nhiêu nghìn đồng? | `50 * 32 + 25 * 36` | 2500 | nghìn đồng |
| 7 | Hai mảnh vườn hình chữ nhật cùng rộng 15 m, một mảnh dài 46 m, mảnh kia dài 54 m. Tính tổng diện tích hai mảnh vườn. | `46 * 15 + 54 * 15` | 1500 | m² |
| 8 | Mỗi bao gạo nặng 50 kg. Kho có 128 bao, đã xuất đi 28 bao. Kho còn bao nhiêu ki-lô-gam gạo? | `50 * 128 - 50 * 28` | 5000 | kg |
| 9 | Mỗi bạn góp 5 quyển vở. Lớp 4A có 32 bạn, lớp 4B có 35 bạn, lớp 4C có 33 bạn. Ba lớp góp bao nhiêu quyển vở? | `5 * 32 + 5 * 35 + 5 * 33` | 500 | quyển |

- [ ] **Step 5: Add three retrieval cases**

Append to `tests/evals/retrieval_cases.json`:

```json
  {
    "query": "Hai tích cùng có chung số 37 thì gộp lại thế nào để tính cho nhanh ạ?",
    "expect_doc_id": "dat-thua-so-chung"
  },
  {
    "query": "Bài bắt tính nhanh 45 nhân 99 rồi cộng thêm 45 mà em không thấy số chung ở đâu thì làm sao?",
    "expect_doc_id": "thua-so-chung-an"
  },
  {
    "query": "Đề toán kể mẹ mua cùng một món đồ hai lần với giá như nhau, có cách nào tính tổng tiền nhanh không?",
    "expect_doc_id": "bai-toan-nhom-nhan-tu"
  }
```

- [ ] **Step 6: Run the offline suite**

Run: `python -m pytest tests -q`

Expected: all pass. If a confound guard fails, reword the query.

- [ ] **Step 7: Commit**

```bash
git add lessons.json content/nang-cao/dat-thua-so-chung.md content/nang-cao/thua-so-chung-an.md content/nang-cao/bai-toan-nhom-nhan-tu.md tests/evals/retrieval_cases.json
git commit -m "feat(content): three more Nâng cao lessons on common factors"
```

---

### Task 5: Practice for Lớp 1

**Files:**
- Modify: `tests/test_lessons.py`, `lessons.json` (grade 1)

**Interfaces:**
- Produces: `AWAITING_PRACTICE` in `tests/test_lessons.py`, a set of lesson ids that don't have practice yet. Tasks 6–9 each remove their grade's ids, and Task 9 deletes the set.

- [ ] **Step 1: Write the failing test**

In `test_lesson_fields`, replace the "has both or neither" assertion. Above the test, add the set:

```python
# Lessons still waiting for their Ghi nhớ and practice. Each grade's ids leave this set as its
# practice is written (content pass, 2026-09-17); every other lesson must have both.
AWAITING_PRACTICE = {
    "phep-cong-co-nho-trong-pham-vi-100", "phep-tru-co-nho-trong-pham-vi-100", "bang-nhan-2-3-4-5",
    "bang-nhan-chia-6-7-8-9", "chia-het-va-chia-co-du", "chu-vi-hinh-chu-nhat-hinh-vuong",
    "phan-so-va-cach-doc", "cong-tru-phan-so", "dau-hieu-chia-het",
    "so-thap-phan", "phep-tinh-voi-so-thap-phan", "ti-so-phan-tram", "dien-tich-va-the-tich",
}
```

Inside `test_lesson_fields`:

```python
        waiting = lesson["id"] in AWAITING_PRACTICE
        assert ("ghiNho" not in lesson and "problems" not in lesson) if waiting else \
            ("ghiNho" in lesson and "problems" in lesson), lesson["id"]
        if "ghiNho" in lesson:
            assert 3 <= len(lesson["ghiNho"]) <= 5, lesson["id"]
            assert all(isinstance(b, str) and b.strip() for b in lesson["ghiNho"]), lesson["id"]
            assert len(lesson["problems"]) == 9, lesson["id"]
```

Run: `python -m pytest tests/test_lessons.py::test_lesson_fields -q`

Expected: FAIL on `phep-cong-trong-pham-vi-10`.

- [ ] **Step 2: Write Lớp 1 practice in `lessons.json`**

Every answer is 0–100, with no units except in the word problems.

**`phep-cong-trong-pham-vi-10`**

Ghi nhớ (3 bullets):
1. Adding puts two groups together.
2. Count on from the bigger number: for `\(2 + 3\)`, start at 3 and count 4, 5.
3. The example "2 quả táo, thêm 3 quả là 5 quả".

| # | question | expr | answer | unit |
|---|---|---|---|---|
| 1 | Tính `\(4 + 3\)`. | `4 + 3` | 7 | |
| 2 | Tính `\(2 + 6\)`. | `2 + 6` | 8 | |
| 3 | Tính `\(5 + 5\)`. | `5 + 5` | 10 | |
| 4 | Tính `\(1 + 8\)`. | `1 + 8` | 9 | |
| 5 | Tính `\(0 + 6\)`. | `0 + 6` | 6 | |
| 6 | Điền số vào chỗ dấu hỏi: `\(3 + \, ? = 7\)` | `7 - 3` | 4 | |
| 7 | Tính `\(2 + 3 + 4\)`. | `2 + 3 + 4` | 9 | |
| 8 | Lan có 3 bông hoa, Mai cho Lan thêm 4 bông. Lan có tất cả mấy bông hoa? | `3 + 4` | 7 | bông |
| 9 | Trong chuồng có 6 con gà, thêm 2 con gà chạy vào. Trong chuồng có tất cả mấy con gà? | `6 + 2` | 8 | con |

**`phep-tru-trong-pham-vi-10`**

Ghi nhớ (4 bullets):
1. Subtracting takes away and asks how many are left.
2. The names: số bị trừ, số trừ, hiệu, using `\(5 - 2 = 3\)`.
3. Count back from the bigger number.
4. Subtraction undoes addition: `\(3 + 4 = 7\)` so `\(7 - 4 = 3\)`.

| # | question | expr | answer | unit |
|---|---|---|---|---|
| 1 | Tính `\(9 - 3\)`. | `9 - 3` | 6 | |
| 2 | Tính `\(7 - 5\)`. | `7 - 5` | 2 | |
| 3 | Tính `\(10 - 4\)`. | `10 - 4` | 6 | |
| 4 | Tính `\(6 - 6\)`. | `6 - 6` | 0 | |
| 5 | Tính `\(8 - 0\)`. | `8 - 0` | 8 | |
| 6 | Biết `\(2 + 5 = 7\)`. Tính `\(7 - 5\)`. | `7 - 5` | 2 | |
| 7 | Điền số vào chỗ dấu hỏi: `\(9 - \, ? = 4\)` | `9 - 4` | 5 | |
| 8 | Hoa có 8 cái nhãn vở, Hoa cho em 3 cái. Hoa còn lại mấy cái nhãn vở? | `8 - 3` | 5 | cái |
| 9 | Trên cành có 10 con chim, 6 con bay đi. Trên cành còn lại mấy con chim? | `10 - 6` | 4 | con |

**`cac-so-den-100`**

Ghi nhớ (4 bullets):
1. A two-digit number has tens and units: 34 has 3 chục and 4 đơn vị.
2. `\(57 = 50 + 7\)`.
3. Compare the tens first, then the units.
4. Round tens end in 0.

| # | question | expr | answer |
|---|---|---|---|
| 1 | Số gồm 6 chục và 3 đơn vị là số nào? | `6 * 10 + 3` | 63 |
| 2 | Số gồm 9 chục và 0 đơn vị là số nào? | `9 * 10` | 90 |
| 3 | Số 76 có mấy chục? | `7` | 7 |
| 4 | Chữ số 4 trong số 48 có giá trị bằng bao nhiêu? | `40` | 40 |
| 5 | Điền số vào chỗ dấu hỏi: `\(85 = 80 + \, ?\)` | `85 - 80` | 5 |
| 6 | Trong hai số 47 và 74, số nào lớn hơn? | `74` | 74 |
| 7 | Trong hai số 65 và 62, số nào bé hơn? | `62` | 62 |
| 8 | Trong các số 45, 28, 91, 60, số nào bé nhất? | `28` | 28 |
| 9 | Số tròn chục liền sau số 40 là số nào? | `50` | 50 |

All problems in this task have `"simplest": false`.

- [ ] **Step 3: Run the lesson tests**

Lớp 1's ids were never in `AWAITING_PRACTICE`, so the set stays as written.

Run: `python -m pytest tests/test_lessons.py -q`

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add tests/test_lessons.py lessons.json
git commit -m "feat(content): Ghi nhớ and practice for Lớp 1"
```

---

### Task 6: Practice for Lớp 2

**Files:**
- Modify: `tests/test_lessons.py` (`AWAITING_PRACTICE`), `lessons.json` (grade 2)

- [ ] **Step 1: Write the failing change**

Remove `phep-cong-co-nho-trong-pham-vi-100`, `phep-tru-co-nho-trong-pham-vi-100` and `bang-nhan-2-3-4-5` from `AWAITING_PRACTICE`.

Run: `python -m pytest tests/test_lessons.py::test_lesson_fields -q`

Expected: FAIL on `phep-cong-co-nho-trong-pham-vi-100`.

- [ ] **Step 2: Write Lớp 2 practice**

Every sum needs a carry (the units add to 10 or more), and every difference needs a borrow (the units digit on top is smaller).

**`phep-cong-co-nho-trong-pham-vi-100`**

Ghi nhớ (4 bullets):
1. When the units add to more than 9, carry 1 ten.
2. Line up units under units, tens under tens.
3. Add the units first, then the tens plus the 1 carried: `\(27 + 15 = 42\)`.
4. Check by splitting: `\(27 + 10 + 5\)`.

| # | question | expr | answer | unit |
|---|---|---|---|---|
| 1 | Tính `\(36 + 27\)`. | `36 + 27` | 63 | |
| 2 | Tính `\(48 + 35\)`. | `48 + 35` | 83 | |
| 3 | Tính `\(19 + 56\)`. | `19 + 56` | 75 | |
| 4 | Tính `\(67 + 8\)`. | `67 + 8` | 75 | |
| 5 | Tính `\(29 + 29\)`. | `29 + 29` | 58 | |
| 6 | Tính `\(64 + 36\)`. | `64 + 36` | 100 | |
| 7 | Nhà Minh nuôi 38 con gà và 25 con vịt. Nhà Minh nuôi tất cả bao nhiêu con? | `38 + 25` | 63 | con |
| 8 | Thùng thứ nhất có 47 quả cam, thùng thứ hai có 46 quả cam. Cả hai thùng có bao nhiêu quả cam? | `47 + 46` | 93 | quả |
| 9 | Lớp 2A trồng được 29 cây, lớp 2B trồng được nhiều hơn lớp 2A 14 cây. Lớp 2B trồng được bao nhiêu cây? | `29 + 14` | 43 | cây |

**`phep-tru-co-nho-trong-pham-vi-100`**

Ghi nhớ (4 bullets):
1. When the top units digit is smaller, borrow 1 ten.
2. The borrowed ten becomes 10 units: `\(52 - 27\)` becomes `\(12 - 7\)` in the units.
3. After borrowing, the tens digit is 1 less.
4. Check: hiệu + số trừ = số bị trừ.

| # | question | expr | answer | unit |
|---|---|---|---|---|
| 1 | Tính `\(54 - 28\)`. | `54 - 28` | 26 | |
| 2 | Tính `\(82 - 47\)`. | `82 - 47` | 35 | |
| 3 | Tính `\(70 - 36\)`. | `70 - 36` | 34 | |
| 4 | Tính `\(91 - 9\)`. | `91 - 9` | 82 | |
| 5 | Tính `\(63 - 45\)`. | `63 - 45` | 18 | |
| 6 | Tính `\(100 - 58\)`. | `100 - 58` | 42 | |
| 7 | Cửa hàng có 65 quả bóng, đã bán 38 quả. Cửa hàng còn lại bao nhiêu quả bóng? | `65 - 38` | 27 | quả |
| 8 | Sợi dây dài 80 cm, bạn Hà cắt đi 24 cm. Sợi dây còn lại dài bao nhiêu xăng-ti-mét? | `80 - 24` | 56 | cm |
| 9 | Trong vườn có 41 cây, trong đó có 17 cây cam, còn lại là cây bưởi. Trong vườn có bao nhiêu cây bưởi? | `41 - 17` | 24 | cây |

**`bang-nhan-2-3-4-5`**

Ghi nhớ (4 bullets):
1. Multiplication is a short way to add equal numbers: `\(3 + 3 + 3 + 3 = 3 \times 4\)`.
2. The names: thừa số, tích.
3. Swapping the factors does not change the product.
4. The 5 times table ends in 0 or 5.

| # | question | expr | answer | unit |
|---|---|---|---|---|
| 1 | Tính `\(2 \times 7\)`. | `2 * 7` | 14 | |
| 2 | Tính `\(3 \times 6\)`. | `3 * 6` | 18 | |
| 3 | Tính `\(4 \times 9\)`. | `4 * 9` | 36 | |
| 4 | Tính `\(5 \times 8\)`. | `5 * 8` | 40 | |
| 5 | Viết thành phép nhân rồi tính: `\(4 + 4 + 4 + 4 + 4\)`. | `4 * 5` | 20 | |
| 6 | Điền số vào chỗ dấu hỏi: `\(3 \times \, ? = 27\)` | `27 / 3` | 9 | |
| 7 | Biết `\(5 \times 7 = 35\)`. Tính `\(7 \times 5\)`. | `7 * 5` | 35 | |
| 8 | Mỗi bình có 3 bông hoa. Hỏi 7 bình như thế có bao nhiêu bông hoa? | `3 * 7` | 21 | bông |
| 9 | Mỗi con thỏ có 4 chân. Hỏi 6 con thỏ có bao nhiêu chân? | `4 * 6` | 24 | chân |

All `"simplest": false`.

- [ ] **Step 3: Run the lesson tests**

Run: `python -m pytest tests/test_lessons.py -q`

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add tests/test_lessons.py lessons.json
git commit -m "feat(content): Ghi nhớ and practice for Lớp 2"
```

---

### Task 7: Practice for Lớp 3

**Files:**
- Modify: `tests/test_lessons.py` (`AWAITING_PRACTICE`), `lessons.json` (grade 3)

- [ ] **Step 1: Write the failing change**

Remove `bang-nhan-chia-6-7-8-9`, `chia-het-va-chia-co-du` and `chu-vi-hinh-chu-nhat-hinh-vuong` from `AWAITING_PRACTICE`.

Run: `python -m pytest tests/test_lessons.py::test_lesson_fields -q`

Expected: FAIL.

- [ ] **Step 2: Write Lớp 3 practice**

**`bang-nhan-chia-6-7-8-9`**

Ghi nhớ (4 bullets):
1. Every multiplication gives two divisions: `\(7 \times 8 = 56\)`, so `\(56 : 7 = 8\)` and `\(56 : 8 = 7\)`.
2. For `\(56 : 8\)`, ask "8 nhân mấy bằng 56?".
3. In the 9 times table, the digits of each result add to 9.
4. Division finds a missing factor.

| # | question | expr | answer | unit |
|---|---|---|---|---|
| 1 | Tính `\(6 \times 7\)`. | `6 * 7` | 42 | |
| 2 | Tính `\(8 \times 9\)`. | `8 * 9` | 72 | |
| 3 | Tính `\(9 \times 6\)`. | `9 * 6` | 54 | |
| 4 | Tính `\(48 : 6\)`. | `48 / 6` | 8 | |
| 5 | Tính `\(63 : 7\)`. | `63 / 7` | 9 | |
| 6 | Tính `\(56 : 8\)`. | `56 / 8` | 7 | |
| 7 | Điền số vào chỗ dấu hỏi: `\(? \times 9 = 81\)` | `81 / 9` | 9 | |
| 8 | Mỗi hộp có 8 cái bánh. Hỏi 7 hộp như thế có bao nhiêu cái bánh? | `8 * 7` | 56 | cái |
| 9 | Có 54 quyển sách xếp đều vào 6 ngăn. Mỗi ngăn có bao nhiêu quyển sách? | `54 / 6` | 9 | quyển |

**`chia-het-va-chia-co-du`**

Quotient and remainder are asked in separate problems, and every remainder is smaller than the divisor.

Ghi nhớ (4 bullets):
1. Exact division has remainder 0: `\(12 : 3 = 4\)`.
2. Division with a remainder: `\(13 : 3 = 4\)` (dư 1).
3. The remainder is always smaller than the divisor.
4. Check: thương × số chia + số dư = số bị chia.

| # | question | expr | answer | unit |
|---|---|---|---|---|
| 1 | Tính `\(35 : 5\)`. | `35 // 5` | 7 | |
| 2 | Trong phép chia `\(23 : 4\)`, thương là bao nhiêu? | `23 // 4` | 5 | |
| 3 | Trong phép chia `\(23 : 4\)`, số dư là bao nhiêu? | `23 % 4` | 3 | |
| 4 | Trong phép chia `\(47 : 6\)`, thương là bao nhiêu? | `47 // 6` | 7 | |
| 5 | Trong phép chia `\(47 : 6\)`, số dư là bao nhiêu? | `47 % 6` | 5 | |
| 6 | Phép chia `\(36 : 4\)` có số dư là bao nhiêu? | `36 % 4` | 0 | |
| 7 | Trong phép chia cho 7, số dư lớn nhất có thể là bao nhiêu? | `7 - 1` | 6 | |
| 8 | Có 29 quả táo chia đều vào 3 đĩa. Mỗi đĩa có mấy quả táo? | `29 // 3` | 9 | quả |
| 9 | Có 29 quả táo chia đều vào 3 đĩa. Còn thừa mấy quả táo? | `29 % 3` | 2 | quả |

**`chu-vi-hinh-chu-nhat-hinh-vuong`**

Ghi nhớ (4 bullets):
1. Rectangle perimeter = (dài + rộng) × 2.
2. Square perimeter = cạnh × 4.
3. Always write a length unit.
4. Convert to the same unit first.

| # | question | expr | answer | unit |
|---|---|---|---|---|
| 1 | Tính chu vi hình chữ nhật có chiều dài 9 cm, chiều rộng 6 cm. | `(9 + 6) * 2` | 30 | cm |
| 2 | Tính chu vi hình chữ nhật có chiều dài 15 m, chiều rộng 10 m. | `(15 + 10) * 2` | 50 | m |
| 3 | Tính chu vi hình vuông có cạnh 7 cm. | `7 * 4` | 28 | cm |
| 4 | Tính chu vi hình vuông có cạnh 25 m. | `25 * 4` | 100 | m |
| 5 | Một hình vuông có chu vi 36 cm. Cạnh hình vuông dài bao nhiêu xăng-ti-mét? | `36 / 4` | 9 | cm |
| 6 | Một hình chữ nhật có chu vi 30 m, chiều dài 9 m. Tính chiều rộng. | `30 / 2 - 9` | 6 | m |
| 7 | Một khung ảnh hình chữ nhật dài 1 m, rộng 60 cm. Tính chu vi khung ảnh theo xăng-ti-mét. | `(100 + 60) * 2` | 320 | cm |
| 8 | Bác Tư rào quanh một mảnh vườn hình chữ nhật dài 20 m, rộng 12 m. Hàng rào dài bao nhiêu mét? | `(20 + 12) * 2` | 64 | m |
| 9 | Một viên gạch hình vuông có cạnh 40 cm. Tính chu vi viên gạch. | `40 * 4` | 160 | cm |

All `"simplest": false`.

- [ ] **Step 3: Run the lesson tests**

Run: `python -m pytest tests/test_lessons.py -q`

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add tests/test_lessons.py lessons.json
git commit -m "feat(content): Ghi nhớ and practice for Lớp 3"
```

---

### Task 8: Practice for the rest of Lớp 4

**Files:**
- Modify: `tests/test_lessons.py` (`AWAITING_PRACTICE`), `lessons.json` (grade 4)

- [ ] **Step 1: Write the failing change**

Remove `phan-so-va-cach-doc`, `cong-tru-phan-so` and `dau-hieu-chia-het` from `AWAITING_PRACTICE`.

Run: `python -m pytest tests/test_lessons.py::test_lesson_fields -q`

Expected: FAIL.

- [ ] **Step 2: Write Lớp 4 practice**

**`phan-so-va-cach-doc`**

Ghi nhớ (5 bullets):
1. A fraction is part of a whole split into equal parts.
2. `\(\dfrac{3}{4}\)`: the mẫu số 4 is how many equal parts, the tử số 3 is how many are taken.
3. The parts must be equal.
4. When the tử số equals the mẫu số, the fraction is 1.
5. With the same mẫu số, the bigger tử số is bigger; multiplying both by the same number gives an equal fraction: `\(\dfrac{1}{2} = \dfrac{2}{4}\)`.

| # | question | expr | answer | simplest |
|---|---|---|---|---|
| 1 | Một cái bánh chia thành 8 phần bằng nhau, em ăn 3 phần. Em đã ăn mấy phần cái bánh? (Viết phân số) | `3/8` | 3/8 | false |
| 2 | Viết phân số "năm phần chín". | `5/9` | 5/9 | false |
| 3 | Mẫu số của phân số `\(\dfrac{5}{8}\)` là bao nhiêu? | `8` | 8 | false |
| 4 | Phân số `\(\dfrac{7}{7}\)` bằng số nào? | `7/7` | 1 | false |
| 5 | Phân số nào lớn hơn: `\(\dfrac{4}{7}\)` hay `\(\dfrac{6}{7}\)`? | `6/7` | 6/7 | false |
| 6 | Phân số nào bé hơn: `\(\dfrac{5}{9}\)` hay `\(\dfrac{2}{9}\)`? | `2/9` | 2/9 | false |
| 7 | Điền số vào chỗ dấu hỏi: `\(\dfrac{1}{2} = \dfrac{?}{8}\)` | `8 / 2` | 4 | false |
| 8 | Điền số vào chỗ dấu hỏi: `\(\dfrac{2}{3} = \dfrac{6}{?}\)` | `3 * 3` | 9 | false |
| 9 | Một thanh sô-cô-la có 10 miếng bằng nhau. An ăn 2 miếng, Bình ăn 5 miếng. Hai bạn ăn mấy phần thanh sô-cô-la? (Viết phân số) | `2/10 + 5/10` | 7/10 | false |

**`cong-tru-phan-so`**

The denominators are the same, or one is a multiple of the other.

Ghi nhớ (4 bullets):
1. Same mẫu số: add or subtract the tử số and keep the mẫu số: `\(\dfrac{2}{7} + \dfrac{3}{7} = \dfrac{5}{7}\)`.
2. Different mẫu số: quy đồng first.
3. Never add the tử số together and the mẫu số together.
4. Rút gọn the result if possible.

| # | question | expr | answer | simplest |
|---|---|---|---|---|
| 1 | Tính `\(\dfrac{2}{9} + \dfrac{5}{9}\)`. | `2/9 + 5/9` | 7/9 | false |
| 2 | Tính `\(\dfrac{3}{8} + \dfrac{4}{8}\)`. | `3/8 + 4/8` | 7/8 | false |
| 3 | Tính `\(\dfrac{6}{7} - \dfrac{2}{7}\)`. | `6/7 - 2/7` | 4/7 | false |
| 4 | Tính rồi rút gọn kết quả: `\(\dfrac{5}{9} - \dfrac{2}{9}\)`. | `5/9 - 2/9` | 1/3 | true |
| 5 | Tính `\(\dfrac{1}{4} + \dfrac{1}{2}\)`. | `1/4 + 1/2` | 3/4 | false |
| 6 | Tính rồi rút gọn kết quả: `\(\dfrac{5}{6} - \dfrac{1}{3}\)`. | `5/6 - 1/3` | 1/2 | true |
| 7 | Tính `\(\dfrac{3}{8} + \dfrac{5}{8}\)`. | `3/8 + 5/8` | 1 | false |
| 8 | Một sợi dây, lần đầu cắt `\(\dfrac{2}{5}\)` sợi dây, lần sau cắt `\(\dfrac{1}{10}\)` sợi dây. Cả hai lần cắt mấy phần sợi dây? | `2/5 + 1/10` | 1/2 | false |
| 9 | Bể đang chứa `\(\dfrac{7}{8}\)` bể nước, người ta dùng hết `\(\dfrac{1}{4}\)` bể. Trong bể còn lại mấy phần bể nước? | `7/8 - 1/4` | 5/8 | false |

**`dau-hieu-chia-het`**

Ghi nhớ (5 bullets):
1. Ending in 0, 2, 4, 6 or 8: chia hết cho 2.
2. Ending in 0 or 5: chia hết cho 5.
3. Digit sum divisible by 9: chia hết cho 9.
4. Digit sum divisible by 3: chia hết cho 3.
5. Ending in 0 means divisible by both 2 and 5; divisible by 9 means also divisible by 3.

| # | question | expr | answer | unit |
|---|---|---|---|---|
| 1 | Số lớn nhất có hai chữ số chia hết cho 9 là số nào? | `99` | 99 | |
| 2 | Số bé nhất có ba chữ số chia hết cho 5 là số nào? | `100` | 100 | |
| 3 | Số bé nhất có hai chữ số chia hết cho cả 2 và 5 là số nào? | `10` | 10 | |
| 4 | Trong các số 45, 68, 91, 123, có bao nhiêu số chia hết cho 3? | `2` | 2 | |
| 5 | Trong các số 108, 207, 315, 412, có bao nhiêu số chia hết cho 9? | `3` | 3 | |
| 6 | Tìm chữ số thích hợp viết vào chỗ dấu hỏi để số `7?5` chia hết cho 9. | `18 - 7 - 5` | 6 | |
| 7 | Từ 1 đến 30 có bao nhiêu số chia hết cho 5? | `30 / 5` | 6 | |
| 8 | Số lớn nhất có hai chữ số chia hết cho cả 2 và 3 là số nào? | `96` | 96 | |
| 9 | Lan có một số viên bi ít hơn 20. Số bi chia hết cho cả 2 và 9. Lan có bao nhiêu viên bi? | `18` | 18 | viên |

Row 6's `7?5` is plain text, not maths, so the question reads "số 7?5".

`simplest` is as listed in the tables. The `dau-hieu-chia-het` rows all have `false`.

- [ ] **Step 3: Run the lesson tests**

Run: `python -m pytest tests/test_lessons.py -q`

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add tests/test_lessons.py lessons.json
git commit -m "feat(content): Ghi nhớ and practice for the rest of Lớp 4"
```

---

### Task 9: Practice for Lớp 5, and every lesson has practice

**Files:**
- Modify: `tests/test_lessons.py` (delete `AWAITING_PRACTICE`), `lessons.json` (grade 5)

- [ ] **Step 1: Write the failing change**

Delete `AWAITING_PRACTICE` and its comment. In `test_lesson_fields`, replace the waiting assertion with:

```python
        # Every lesson in every grade and extra has both cards (content pass, 2026-09-17).
        assert "ghiNho" in lesson and "problems" in lesson, lesson["id"]
```

Remove the now-redundant `if "ghiNho" in lesson:` guard, and dedent its three assertions.

Run: `python -m pytest tests/test_lessons.py::test_lesson_fields -q`

Expected: FAIL on `so-thap-phan`.

- [ ] **Step 2: Write Lớp 5 practice**

Decimals in maths are `4{,}25`, and in `expr` `4.25`.

**`so-thap-phan`**

Ghi nhớ (5 bullets):
1. A decimal has a whole part and a decimal part, separated by a comma.
2. After the comma: phần mười, phần trăm, phần nghìn.
3. `\(0{,}7 = \dfrac{7}{10}\)` and `\(0{,}25 = \dfrac{25}{100}\)`.
4. Zeros added at the right end change nothing: `\(2{,}5 = 2{,}50\)`.
5. Compare the whole parts first, then phần mười, then phần trăm.

| # | question | expr | answer | unit |
|---|---|---|---|---|
| 1 | Viết `\(\dfrac{7}{10}\)` thành số thập phân. | `7/10` | 0,7 | |
| 2 | Viết `\(\dfrac{25}{100}\)` thành số thập phân. | `25/100` | 0,25 | |
| 3 | Viết số thập phân gồm 8 đơn vị, 5 phần mười và 2 phần trăm. | `8 + 5/10 + 2/100` | 8,52 | |
| 4 | Viết 1 m 35 cm thành số đo có đơn vị là mét. | `1 + 35/100` | 1,35 | m |
| 5 | Số nào lớn hơn: 4,9 hay 4,15? | `4.9` | 4,9 | |
| 6 | Trong các số 6,7; 6,25; 6,52, số nào bé nhất? | `6.25` | 6,25 | |
| 7 | Bỏ các chữ số 0 ở tận cùng bên phải phần thập phân để viết gọn số 3,500. | `3.500` | 3,5 | |
| 8 | Chữ số 7 trong số 3,472 có giá trị bằng phân số nào? | `7/100` | 7/100 | |
| 9 | Bạn An cao 1,4 m, bạn Bình cao 1,38 m. Bạn cao hơn cao bao nhiêu mét? | `1.4` | 1,4 | m |

**`phep-tinh-voi-so-thap-phan`**

Division is only by whole numbers, and there are ×/: by 10, 100, 1000.

Ghi nhớ (5 bullets):
1. To add or subtract, line up the commas.
2. To multiply, multiply as whole numbers, then separate as many decimal places as both factors have together.
3. To divide by a whole number, put the comma in the quotient when the whole part is used up.
4. × 10, 100, 1000: move the comma right 1, 2, 3 places.
5. : 10, 100, 1000: move it left.

| # | question | expr | answer | unit |
|---|---|---|---|---|
| 1 | Tính `\(4{,}7 + 2{,}85\)`. | `4.7 + 2.85` | 7,55 | |
| 2 | Tính `\(12{,}5 - 3{,}74\)`. | `12.5 - 3.74` | 8,76 | |
| 3 | Tính `\(2{,}6 \times 4\)`. | `2.6 * 4` | 10,4 | |
| 4 | Tính `\(1{,}5 \times 0{,}4\)`. | `1.5 * 0.4` | 0,6 | |
| 5 | Tính `\(8{,}4 : 3\)`. | `8.4 / 3` | 2,8 | |
| 6 | Tính `\(2{,}358 \times 100\)`. | `2.358 * 100` | 235,8 | |
| 7 | Tính `\(45{,}6 : 10\)`. | `45.6 / 10` | 4,56 | |
| 8 | Tính `\(0{,}072 \times 1000\)`. | `0.072 * 1000` | 72 | |
| 9 | Mỗi chai nước chứa 1,25 l. Hỏi 6 chai như thế chứa bao nhiêu lít nước? | `1.25 * 6` | 7,5 | l |

**`ti-so-phan-tram`**

Ghi nhớ (4 bullets):
1. 25% means 25 parts out of 100: `\(25\% = \dfrac{25}{100}\)`.
2. The percentage of a in b: a : b, times 100, write %.
3. A percentage of a number: the number × the percentage : 100.
4. `\(50\% = 0{,}5\)`, one half; `\(100\%\)` is the whole.

| # | question | expr | answer | unit |
|---|---|---|---|---|
| 1 | Tìm 25% của 80. | `80 * 25 / 100` | 20 | |
| 2 | Tìm 15% của 200. | `200 * 15 / 100` | 30 | |
| 3 | Tìm tỉ số phần trăm của 24 và 40. | `24 / 40 * 100` | 60 | % |
| 4 | Viết 0,35 thành tỉ số phần trăm. | `0.35 * 100` | 35 | % |
| 5 | Viết `\(\dfrac{3}{4}\)` thành tỉ số phần trăm. | `3/4 * 100` | 75 | % |
| 6 | Lớp 5A có 40 học sinh, trong đó 45% là học sinh nữ. Lớp 5A có bao nhiêu học sinh nữ? | `40 * 45 / 100` | 18 | học sinh |
| 7 | Cửa hàng có 80 quyển sách, đã bán 60 quyển. Số sách đã bán chiếm bao nhiêu phần trăm số sách của cửa hàng? | `60 / 80 * 100` | 75 | % |
| 8 | Một chiếc áo giá 200 000 đồng, được giảm giá 15%. Mua chiếc áo đó phải trả bao nhiêu đồng? | `200000 - 200000 * 15 / 100` | 170000 | đồng |
| 9 | Một mảnh vườn có diện tích 500 m², trong đó 40% diện tích trồng rau. Diện tích trồng rau là bao nhiêu mét vuông? | `500 * 40 / 100` | 200 | m² |

**`dien-tich-va-the-tich`**

Ghi nhớ (5 bullets):
1. Rectangle area = dài × rộng; square area = cạnh × cạnh.
2. Triangle area = đáy × chiều cao : 2.
3. Box volume = dài × rộng × cao.
4. Area uses square units (cm², m²), volume uses cubic units (cm³, dm³, m³).
5. Perimeter, area and volume are different quantities.

| # | question | expr | answer | unit |
|---|---|---|---|---|
| 1 | Tính diện tích hình chữ nhật có chiều dài 9 cm, chiều rộng 6 cm. | `9 * 6` | 54 | cm² |
| 2 | Tính diện tích hình vuông có cạnh 8 cm. | `8 * 8` | 64 | cm² |
| 3 | Tính diện tích hình tam giác có đáy 12 cm, chiều cao 5 cm. | `12 * 5 / 2` | 30 | cm² |
| 4 | Tính thể tích hình hộp chữ nhật dài 6 cm, rộng 4 cm, cao 3 cm. | `6 * 4 * 3` | 72 | cm³ |
| 5 | Một hình chữ nhật có diện tích 48 cm², chiều dài 8 cm. Tính chiều rộng. | `48 / 8` | 6 | cm |
| 6 | Tính diện tích hình chữ nhật dài 2,5 m, rộng 4 m. | `2.5 * 4` | 10 | m² |
| 7 | Tính diện tích hình tam giác có đáy 4,5 m, chiều cao 3 m. | `4.5 * 3 / 2` | 6,75 | m² |
| 8 | Tính thể tích hình hộp chữ nhật dài 1,5 m, rộng 1,2 m, cao 2 m. | `1.5 * 1.2 * 2` | 3,6 | m³ |
| 9 | Một bể cá hình hộp chữ nhật dài 5 dm, rộng 3 dm, cao 4 dm. Tính thể tích bể cá. | `5 * 3 * 4` | 60 | dm³ |

All `"simplest": false`.

- [ ] **Step 3: Run the offline suite**

Run: `python -m pytest tests -q`

Expected: all pass.

- [ ] **Step 4: Check every tab in the browser**

1. Clear stale files and reload, as in Task 2 Step 4.2. Use the mobile preset.
2. For each chip in turn (Lớp 1, 2, 3, 4, 5, Nâng cao ★):
   - Every lesson card is tagged "Ghi nhớ · Luyện tập".
   - Open the first lesson → Ghi nhớ renders its bullets with maths and no raw `\(` → "Cho em bài để luyện tập" shows Bài 1/9.
   - Go home with the header back button.
3. On Lớp 5 → "Cộng, trừ, nhân, chia số thập phân":
   - Answer Bài 1 with keypad keys `7` `,` `5` `5` → correct.
   - Bài 2: type `8.76` on the keyboard at 1280×800 → correct.
   - Screenshot the card with `4{,}7` rendered as "4,7".
4. `read_console_messages {onlyErrors: true}` returns nothing.
5. Clean up `meritsGrade` and `meritsChatHistory`, then `resize_window {preset: "desktop"}`.

- [ ] **Step 5: Commit**

```bash
git add tests/test_lessons.py lessons.json
git commit -m "feat(content): Ghi nhớ and practice for Lớp 5; every lesson now has practice"
```

---

### Task 10: The user's maths and wording review

**Files:**
- Create: a scratchpad `content-review.py` and a scratchpad `content-review.html`. These are not committed.

- [ ] **Step 1: Build a review page**

Write a Python script in the scratchpad that reads `lessons.json` and `content/nang-cao/*.md`, and writes one HTML page:
- For each grade and the Nâng cao tab, and each lesson: the Ghi nhớ bullets, then a table of the 9 problems (question, answer + unit, "rút gọn" flag).
- For Nâng cao, the full Markdown explanation, as preformatted text above the lesson.
- MathJax 3 from `https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js`, configured for `\( \)`.
- A dark background (`#14131A`), light text and Nunito, so it matches the app.
- The page is UTF-8, and HTML-escapes all text before inserting it.

Run it, then open the result with `SendUserFile {files: [<scratchpad>/content-review.html], display: "render", status: "normal"}`.

- [ ] **Step 2: Ask for the review**

Ask the user to check the maths and wording of the 16 lessons' Ghi nhớ and problems and the 4 Nâng cao lessons. Wait. Apply their corrections with the Edit tool, rerun `python -m pytest tests -q`, and commit the corrections:

```bash
git add lessons.json content/nang-cao/<changed files>
git commit -m "fix(content): corrections from the maths review"
```

Repeat until the user approves.

---

### Task 11: Upload the Nâng cao explanations and measure retrieval

**Files:**
- Modify: `tests/test_retrieval_eval.py` (measurement comment, `MIN_UNACCENTED_TOP3` and its comment), `docs/RAG-OPERATIONS.md`

- [ ] **Step 1: Ask for the OK**

Ask the user explicitly: upload the four `content/nang-cao/*.md` files to the production knowledge base? Do nothing until they say yes.

- [ ] **Step 2: Upload**

In one PowerShell call:

```powershell
$env:RAG_BASE_URL = 'https://meritsofmath.pages.dev'
$env:INGEST_SECRET = [Environment]::GetEnvironmentVariable('INGEST_SECRET','User')
python -m scripts.rag.upload content/nang-cao/nhan-mot-so-voi-mot-tong.md content/nang-cao/dat-thua-so-chung.md content/nang-cao/thua-so-chung-an.md content/nang-cao/bai-toan-nhom-nhan-tu.md
```

Expected: four "chunks (pruned + confirmed applied)" lines and a TOTAL. Record the total.

Confirm the base URL against `docs/RAG-OPERATIONS.md` before running.

- [ ] **Step 3: Run the live retrieval eval**

In one PowerShell call, with the same two env vars:

```powershell
python -m pytest tests/test_retrieval_eval.py -v
```

Expected: every accented case (24) is in the top 3 and clears the floor, and the ratchet and negatives pass. Keep the printed score table.

If a case fails, report the table to the user. Fix it by rewording a lesson passage, not the query (the precedent from 2026-09-16), re-upload that file with the user's OK, and rerun.

- [ ] **Step 4: Record the numbers**

- In `tests/test_retrieval_eval.py`, add a `RE-MEASURED, <date>` paragraph under the 2026-09-16 one, with:
  - the vector count;
  - 24 accented and 24 unaccented cases;
  - the three ranges;
  - how many unaccented cases reach the top 3.
- Set `MIN_UNACCENTED_TOP3` to one below the measured count, and update its comment and the docstring's "13/20".
- In `docs/RAG-OPERATIONS.md`:
  - update the "Contents today" row (vectors, 24 Markdown lessons);
  - update the chunker block, re-run offline with:

```bash
python -c "import pathlib; from scripts.rag.chunker import chunk_markdown; fs=sorted(pathlib.Path('content').glob('*/*.md')); cs=[chunk_markdown(f.read_text(encoding='utf-8'), doc_id=f.stem) for f in fs]; n=[len(c) for c in cs]; ls=[len(x['text']) for c in cs for x in c]; print(len(fs), sum(n), min(n), sum(n)/len(n), max(n), min(ls), sum(ls)/len(ls), sorted(ls)[len(ls)//2], max(ls))"
```

  - update the headroom arithmetic lines that use 116.

Check the chunk dict's text key in `scripts/rag/chunker.py` before running.

Run: `python -m pytest tests -q`

Expected: offline tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/test_retrieval_eval.py docs/RAG-OPERATIONS.md
git commit -m "docs(rag): re-measured retrieval after the Nâng cao lessons"
```

---

### Task 12: Deploy and live checks

- [ ] **Step 1: Deploy**

```bash
git fetch -q origin && git merge-base --is-ancestor origin/main HEAD && echo ok
git push origin feat/socratic-chat
git checkout main && git merge --ff-only feat/socratic-chat && git push origin main && git checkout feat/socratic-chat
```

- [ ] **Step 2: Wait for the live files**

Poll `https://meritsofmath.pages.dev/lessons.json` and `/js/lessons.js` with PowerShell `Invoke-WebRequest` (browser user agent). Decode `RawContentStream` as UTF-8, until `lessons.json` contains `"nang-cao"` and `js/lessons.js` contains `ANSWER_SHAPE`.

- [ ] **Step 3: Run the live suite**

In one PowerShell call, with `RAG_BASE_URL` and `INGEST_SECRET` set as in Task 11:

Run: `python -m pytest tests -q`

Expected: all pass. Report the pass/skip counts.

- [ ] **Step 4: Check the live site in the browser**

1. At the mobile preset:
   - the "Nâng cao ★" chip;
   - one Nâng cao problem answered correctly;
   - one Lớp 5 decimal answer.
2. At desktop size, the same checks with the pop-up keypad's `,` key.
3. No console errors.
4. Clean up `meritsGrade` and `meritsChatHistory`, then screenshot.

- [ ] **Step 5: Update memory and hand over**

Update `project-status-vs-prd.md` in memory: the content pass is live, `main` is at the new hash, and the user's device checks are pending. Tell the user what is live and ask them to check on their phone and desktop.
