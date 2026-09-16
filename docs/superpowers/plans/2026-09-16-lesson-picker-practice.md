# Lesson Picker, Ghi nhớ and Practice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the chat a home screen with a lesson picker, and give each lesson a Ghi nhớ card and practice problems checked on the device, with a full four-lesson unit on phép nhân phân số for the demo.

**Architecture:** A static `lessons.json` holds all lesson data. A new `js/lessons.js` (`window.Lessons`) loads it, draws the home screen and the lesson cards, and checks answers. The existing `js/chat.js` keeps owning the conversation. It stores cards in history as ids, draws them through `Lessons`, and turns them into plain text for `/api/chat`. English mode is removed first.

**Tech Stack:** Vanilla JS (no build, no Node), Cloudflare Pages + Pages Functions, Workers AI + Vectorize RAG, Python 3.14 + pytest 8.4 for tests.

Spec: `docs/superpowers/specs/2026-09-16-lesson-picker-practice-design.md`.

## Global Constraints

**Language and copy**
- All UI text is Vietnamese. The tutor calls the child "em" and itself "cô". Nothing in the app is English.
- Maths in any content string is written between `\(` and `\)`, never with `$`.

**Safety of what reaches the page**
- Text that can contain markdown or maths reaches the page only through `fillRich` in `js/chat.js`: `renderMarkdown`, then DOMPurify with `SANITISE`, then `typesetOnce`.
- Every other string goes in through `textContent`.
- Buttons and inputs are built with DOM methods, never HTML strings.

**Layout**
- Tap targets are at least 44 px tall.
- Every screen must work at 375 px wide.

**Storage**
- localStorage keys in use: `meritsChatHistory` and `meritsGrade`.
- `meritsLang` is retired and gets removed from visitors' browsers.

**Commits and deploys**
- Commit with explicit paths only. Never `git add -A`.
- Never `git checkout main` with uncommitted changes.
- Every commit message ends with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Never set a `GROQ_MODEL` env var in Cloudflare.
- Never add a root-level `conftest.py`.

**Secrets and production writes**
- Secrets are never printed, echoed, committed, or put into assertion messages. Read `INGEST_SECRET` with `[Environment]::GetEnvironmentVariable('INGEST_SECRET','User')` in the same PowerShell invocation that uses it.
- Ingesting into Vectorize is a production write. Ask the user for an explicit OK immediately before running the uploader.
- Never set `RAG_ALLOW_PROD_WRITES`.

**Running things**
- Offline tests: `python -m pytest -q`. Live tests skip unless `RAG_BASE_URL` is set.
- Live site: `https://meritsofmath.pages.dev`.
- No JS runtime exists on this machine (no Node, Deno or Bun). JavaScript is verified in the Browser pane against the `static` server in `.claude/launch.json` (`python -m http.server 8000`, `http://localhost:8000/`).

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `lessons.json` | new | Grades, lesson titles, featured unit, Ghi nhớ bullets, problems + answers |
| `js/lessons.js` | new | `window.Lessons`: load data, home screen, cards, answer checking, card→text |
| `js/chat.js` | modify | Conversation: history (text + card entries), storage, sending, bubbles |
| `js/i18n.js` | delete | English/Vietnamese switcher, retired |
| `index.html` | modify | Header back button, `#home`, no toggle, no suggestions, script tags |
| `chat.css` | modify | Remove toggle + suggestions; add `[hidden]`, home, card styles |
| `sw.js` | modify | Cache `merits-v6`; shell drops i18n, adds lessons files |
| `functions/api/chat.js` | modify | Vietnamese-only Socratic prompt |
| `content/grade4/*.md` | 4 new | Fraction-multiplication lessons for the knowledge base |
| `tests/test_app_shell.py` | new | Shell files exist; English mode stays gone |
| `tests/test_lessons.py` | new | lessons.json schema, content-file match, recomputed answers |
| `tests/test_chat_grounded.py` | modify | English test becomes Vietnamese-only test; card-shaped conversation test |
| `tests/test_tutor_behaviour.py` | modify | Drop `lang` |
| `tests/evals/retrieval_cases.json` | modify | 4 new cases |
| `tests/evals/tutor_behaviour_cases.json` | modify | Hint-request case |
| `tests/test_retrieval_eval.py` | modify (Task 6) | Re-measured counts and ratchet |
| `docs/RAG-OPERATIONS.md` | modify (Task 6) | Vector and lesson counts |

---

### Task 1: Remove English mode

**Files:**
- Create: `tests/test_app_shell.py`
- Delete: `js/i18n.js`
- Modify: `index.html`, `chat.css:42-52`, `js/chat.js`, `sw.js:18-29`, `functions/api/chat.js:1-10,141,324-348`, `tests/test_chat_grounded.py`, `tests/test_tutor_behaviour.py:27`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `js/chat.js` has a `TEXT` object (`greeting`, `suggestions`, `thinking`, `error`) instead of `t()`.
  - `buildSocraticPrompt(chunks)` takes one argument.
  - `tests/test_app_shell.py::_app_shell()` returns the `APP_SHELL` paths without their `./` prefix.

- [ ] **Step 1: Write the failing test**

Create `tests/test_app_shell.py`:

```python
"""Offline checks on the static app: files the service worker precaches must exist, and the
retired English mode must stay gone. No network, no secrets."""

import pathlib
import re

ROOT = pathlib.Path(__file__).parent.parent


def _app_shell():
    sw = (ROOT / "sw.js").read_text(encoding="utf-8")
    block = re.search(r"const APP_SHELL = \[(.*?)\];", sw, re.S)
    assert block, "APP_SHELL not found in sw.js"
    return re.findall(r"'\./([^']*)'", block.group(1))


def test_every_app_shell_file_exists():
    paths = _app_shell()
    assert paths, "APP_SHELL is empty"
    for path in paths:
        if path == "":
            continue  # './' is the page itself
        assert (ROOT / path).is_file(), f"sw.js precaches ./{path}, which does not exist"


def test_english_mode_is_gone():
    assert not (ROOT / "js" / "i18n.js").exists(), "js/i18n.js should be deleted"
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    for marker in ("data-lang-btn", "data-i18n", "i18n.js", "lang-toggle"):
        assert marker not in html, f"index.html still contains {marker!r}"
    chat = (ROOT / "js" / "chat.js").read_text(encoding="utf-8")
    for marker in ("I18n", "langchange", "lang:"):
        assert marker not in chat, f"js/chat.js still contains {marker!r}"
    css = (ROOT / "chat.css").read_text(encoding="utf-8")
    assert "lang-toggle" not in css
    server = (ROOT / "functions" / "api" / "chat.js").read_text(encoding="utf-8")
    assert "body.lang" not in server and "lang === 'en'" not in server
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python -m pytest tests/test_app_shell.py -q`
Expected: `test_every_app_shell_file_exists` PASS, `test_english_mode_is_gone` FAIL with "js/i18n.js should be deleted".

- [ ] **Step 3: Remove English from the page**

In `index.html`:
- `<h1 data-i18n="chat.title">Merits of Math</h1>` → `<h1>Merits of Math</h1>`
- `<p class="sub" data-i18n="chat.subtitle">Gia sư toán của em</p>` → `<p class="sub">Gia sư toán của em</p>`
- Delete the whole `<div class="lang-toggle">…</div>` block (4 lines).
- `<button type="button" class="icon-btn" id="clear-btn" title="New conversation">&#8635;</button>` → `<button type="button" class="icon-btn" id="clear-btn" title="Cuộc trò chuyện mới" aria-label="Cuộc trò chuyện mới">&#8635;</button>`
- `<textarea id="input" rows="1" data-i18n-ph="chat.placeholder" placeholder="Hỏi cô về toán..."></textarea>` → `<textarea id="input" rows="1" placeholder="Hỏi cô về toán..." aria-label="Hỏi cô về toán"></textarea>`
- `<button type="submit" id="send-btn" data-i18n="chat.send">Gửi</button>` → `<button type="submit" id="send-btn">Gửi</button>`
- Delete `<script src="js/i18n.js"></script>`.

In `chat.css`, delete lines 42–52 (`.lang-toggle { … }` through `.lang-toggle button.lang-active { … }`).

Delete the file: `git rm js/i18n.js`.

- [ ] **Step 4: Remove English from `js/chat.js`**

Replace line 8 (`const SUGGESTION_KEYS = …`) with:

```js
    // Every word the chat shows. The app is Vietnamese only; its English mode was removed on
    // 2026-09-16.
    const TEXT = {
        greeting: 'Chào em! Cô ở đây để giúp em tự tìm ra lời giải. Hôm nay em đang học bài gì?',
        suggestions: ['Em không hiểu phép cộng có nhớ', 'Phân số là gì ạ?', 'Giúp em học bảng nhân'],
        thinking: 'Đang suy nghĩ...',
        error: 'Gia sư đang bận. Em thử lại sau giây lát nhé.'
    };
```

Delete the `t(key)` function (lines 15–17).

Replace the `RETIRED_KEYS` comment and constant (lines 37–41) with:

```js
    // Keys written by code that no longer exists: the retired skill-tree game (js/aiTutor.js,
    // js/progression.js) and the retired English toggle (meritsLang). The values persist in every
    // visitor's browser on this origin — including any Groq API key a user once pasted into the
    // old Settings modal. Remove them. The chat's own key, meritsChatHistory, is deliberately NOT
    // in this list.
    const RETIRED_KEYS = ['groqApiKey', 'localApiBaseUrl', 'localModelName', 'aiProvider', 'meritsProfile_v2', 'meritsLang'];
```

Then make these replacements:
- In `showTyping`: `div.setAttribute('aria-label', t('chat.thinking'));` → `div.setAttribute('aria-label', TEXT.thinking);`
- In `renderAll`: `appendBubble('assistant', t('chat.greeting'));` → `appendBubble('assistant', TEXT.greeting);`
- In `renderSuggestions`, replace the loop with:

  ```js
          TEXT.suggestions.forEach((text) => {
              const btn = document.createElement('button');
              btn.type = 'button';
              btn.textContent = text;
              btn.addEventListener('click', () => send(text));
              els.suggestions.appendChild(btn);
          });
  ```

- In `send`: delete the line `lang: window.I18n ? window.I18n.getLang() : 'vi',`. Replace all three `t('chat.error')` with `TEXT.error`.
- Delete `applyLabels` (its comment and function, lines 396–401) and the `applyLabels();` call in `init`. `index.html` now carries the button's label.
- In `init`, delete the `langchange` listener and its comment (lines 435–440).

- [ ] **Step 5: Make the server prompt Vietnamese only**

In `functions/api/chat.js`, in the header comment on line 4, change `` body plus `ground` and `lang`; `` to `` body plus `ground`; ``. Add this sentence to that comment block: `` A `lang` field sent by a page cached before 2026-09-16 is ignored. ``

Line 141: `const systemPrompt = buildSocraticPrompt(chunks, body.lang);` → `const systemPrompt = buildSocraticPrompt(chunks);`

Replace lines 324–348 (from `function buildSocraticPrompt(chunks, lang) {` through the closing `}` of the `if (lang !== 'en')` block) with:

```js
function buildSocraticPrompt(chunks) {
    const lines = [
        'You are a warm, patient maths tutor for Vietnamese primary-school children (Grades 1 to 5).',
        'LANGUAGE: Write every word of your reply in Vietnamese. Keep numbers as digits.',
        '',
        'HOW YOU TEACH:',
        '- You never state the final answer. Not when asked directly, not when the student says they give up, not "just this once".',
        '- Ask ONE short question at a time: the next small step, never the whole path.',
        '- Use words a child aged 6 to 11 knows. Short sentences, one idea each.',
        '- When the student is wrong, never say "wrong". Ask something that lets them notice it themselves.',
        '- When the student is right, say so warmly in a few words, then ask what comes next.',
        '- Use everyday things: sweets, apples, marbles, fingers, steps.',
        '- If the student is stuck twice on the same step, make the step smaller. Do not answer it for them.',
        '- Keep replies under about 60 words.',
        '- Write any maths in LaTeX between \\( and \\). Never use $ signs for maths.',
        // Vietnamese teacher-to-pupil register. Without an explicit rule, Qwen drifted between
        // "em" (correct for a teacher speaking to a child) and "bạn" (peer register) across
        // consecutive replies measured on 2026-09-13.
        '- Speak like a Vietnamese primary-school teacher: call the student "em" and refer to yourself as "cô". Never call the student "bạn".'
    ];
```

Keep everything after that unchanged: the maths-delimiter comment, the `if (chunks.length > 0)` block and `return lines.join('\n');`.

- [ ] **Step 6: Drop the i18n file from the service worker**

In `sw.js`: `const CACHE = 'merits-v5';` → `const CACHE = 'merits-v6';`, and delete the `'./js/i18n.js',` line from `APP_SHELL`.

- [ ] **Step 7: Update the live tests**

In `tests/test_chat_grounded.py`, delete every `"lang": "vi",` line (4 of them). Replace `test_grounded_reply_is_in_english_when_asked` with:

```python
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
```

In `tests/test_tutor_behaviour.py` line 27: `json={"messages": [{"role": "user", "content": message}], "ground": True, "lang": "vi"},` → `json={"messages": [{"role": "user", "content": message}], "ground": True},`

- [ ] **Step 8: Run the offline suite**

Run: `python -m pytest -q`
Expected: every offline test passes, including both tests in `tests/test_app_shell.py`, and live tests skip.

- [ ] **Step 9: Commit**

```bash
git add tests/test_app_shell.py index.html chat.css js/chat.js sw.js functions/api/chat.js tests/test_chat_grounded.py tests/test_tutor_behaviour.py
git commit -F msg.txt   # message below, written to a scratch file first
```

Message:

```
feat(chat): remove English mode

The app is Vietnamese only. The VI/EN toggle, js/i18n.js and the server's English prompt
branch are gone; meritsLang is cleared from visitors' browsers with the other retired keys.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

(`git rm js/i18n.js` in Step 3 already staged the deletion.)

---

### Task 2: `lessons.json` for the existing lessons

**Files:**
- Create: `lessons.json`, `tests/test_lessons.py`

**Interfaces:**
- Consumes: `content/grade<N>/<id>.md`, where each file's first line is `# <title>`.
- Produces: `lessons.json` with the schema below. Task 3 extends grade 4 and Task 4 reads it.
  - `{ defaultGrade: int, grades: [{ grade: int, featured?: { title, lessonIds: [id] }, lessons: [{ id, title, ghiNho?: [str], problems?: [{ question, expr, answer, simplest, unit? }] }] }] }`
  - `tests/test_lessons.py::evaluate(expr) -> Fraction`

- [ ] **Step 1: Write the failing test**

Create `tests/test_lessons.py`:

```python
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python -m pytest tests/test_lessons.py -q`
Expected: collection ERROR, `FileNotFoundError` for `lessons.json`.

- [ ] **Step 3: Create `lessons.json`**

```json
{
  "defaultGrade": 4,
  "grades": [
    {
      "grade": 1,
      "lessons": [
        { "id": "phep-cong-trong-pham-vi-10", "title": "Phép cộng trong phạm vi 10" },
        { "id": "phep-tru-trong-pham-vi-10", "title": "Phép trừ trong phạm vi 10" },
        { "id": "cac-so-den-100", "title": "Các số đến 100" }
      ]
    },
    {
      "grade": 2,
      "lessons": [
        { "id": "phep-cong-co-nho-trong-pham-vi-100", "title": "Phép cộng có nhớ trong phạm vi 100" },
        { "id": "phep-tru-co-nho-trong-pham-vi-100", "title": "Phép trừ có nhớ trong phạm vi 100" },
        { "id": "bang-nhan-2-3-4-5", "title": "Bảng nhân 2, 3, 4, 5" }
      ]
    },
    {
      "grade": 3,
      "lessons": [
        { "id": "bang-nhan-chia-6-7-8-9", "title": "Bảng nhân và bảng chia 6, 7, 8, 9" },
        { "id": "chia-het-va-chia-co-du", "title": "Phép chia hết và phép chia có dư" },
        { "id": "chu-vi-hinh-chu-nhat-hinh-vuong", "title": "Chu vi hình chữ nhật và hình vuông" }
      ]
    },
    {
      "grade": 4,
      "lessons": [
        { "id": "phan-so-va-cach-doc", "title": "Phân số và cách đọc phân số" },
        { "id": "cong-tru-phan-so", "title": "Cộng và trừ phân số" },
        { "id": "dau-hieu-chia-het", "title": "Dấu hiệu chia hết cho 2, 3, 5, 9" }
      ]
    },
    {
      "grade": 5,
      "lessons": [
        { "id": "so-thap-phan", "title": "Số thập phân" },
        { "id": "phep-tinh-voi-so-thap-phan", "title": "Cộng, trừ, nhân, chia số thập phân" },
        { "id": "ti-so-phan-tram", "title": "Tỉ số phần trăm" },
        { "id": "dien-tich-va-the-tich", "title": "Diện tích và thể tích" }
      ]
    }
  ]
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `python -m pytest tests/test_lessons.py -q`
Expected: all PASS. The problem tests pass vacuously for now; Task 3 gives them data.

- [ ] **Step 5: Commit**

```bash
git add lessons.json tests/test_lessons.py
git commit -F msg.txt
```

Message: `feat(lessons): list every lesson in lessons.json, checked against the content files` + blank line + Co-Authored-By line.

---

### Task 3: The phép nhân phân số unit

**Files:**
- Create: `content/grade4/nhan-hai-phan-so.md`, `content/grade4/tinh-chat-phep-nhan-phan-so.md`, `content/grade4/tim-phan-so-cua-mot-so.md`, `content/grade4/giai-toan-voi-phep-nhan-phan-so.md`
- Modify: `lessons.json` (grade 4 block), `tests/evals/retrieval_cases.json`, `tests/evals/tutor_behaviour_cases.json`

**Interfaces:**
- Consumes: the Task 2 schema and tests.
- Produces:
  - Grade 4 `featured.lessonIds` = `["nhan-hai-phan-so", "tinh-chat-phep-nhan-phan-so", "tim-phan-so-cua-mot-so", "giai-toan-voi-phep-nhan-phan-so"]`.
  - `nhan-hai-phan-so` has 9 problems. Problem 1 is `2/3 × 4/5`, answer `8/15`. Problem 6 is `simplest: true`, answer `1/2`. Task 5's browser walkthrough relies on these.

- [ ] **Step 1: Write the failing checks first**

Replace the grade 4 block in `lessons.json` with the full block from Step 3 **before** creating the Markdown files.

Run: `python -m pytest tests/test_lessons.py -q`
Expected: FAIL `test_every_content_file_is_listed_once_under_its_grade` ("listed but no file") and `test_titles_match_the_content_headings` (FileNotFoundError).

- [ ] **Step 2: Write the four lessons**

`content/grade4/nhan-hai-phan-so.md`:

```markdown
# Nhân hai phân số

Phép nhân phân số dùng khi em cần lấy một phần của một phần, hoặc tính diện tích một hình có cạnh là phân số.

## Quy tắc nhân hai phân số

Muốn nhân hai phân số, em lấy tử số nhân với tử số, mẫu số nhân với mẫu số.

Ví dụ: 2/3 × 4/5 = (2 × 4)/(3 × 5) = 8/15.

Khác với phép cộng, khi nhân em không cần quy đồng mẫu số.

## Vì sao lại nhân tử với tử, mẫu với mẫu?

Hãy nghĩ đến một hình vuông có cạnh dài 1 m. Em chia một cạnh thành 5 phần bằng nhau và cạnh kia thành 3 phần bằng nhau, hình vuông được chia thành 3 × 5 = 15 ô nhỏ bằng nhau. Một hình chữ nhật dài 4/5 m, rộng 2/3 m phủ đúng 4 × 2 = 8 ô trong 15 ô đó. Vậy diện tích của nó là 8/15 m².

## Nhân phân số với số tự nhiên

Em viết số tự nhiên thành phân số có mẫu số là 1, rồi nhân như bình thường.

Ví dụ: 3/7 × 2 = 3/7 × 2/1 = 6/7.

Nói gọn lại: em nhân tử số với số tự nhiên và giữ nguyên mẫu số.

## Rút gọn kết quả

Sau khi nhân, em xem kết quả có rút gọn được không.

Ví dụ: 2/3 × 3/4 = 6/12. Cả 6 và 12 đều chia hết cho 6, nên 6/12 = 1/2.

## Lỗi thường gặp

Có bạn nhân tử số với tử số nhưng lại cộng hai mẫu số, viết 1/2 × 1/3 = 1/5. Em thử nghĩ: chia cái bánh thành 3 phần, lấy 1 phần, rồi chia phần đó làm đôi. Cả cái bánh khi đó giống như được chia thành 3 × 2 = 6 phần bằng nhau, nên em có 1/6 cái bánh, không phải 1/5.

Cũng có bạn quy đồng mẫu số như khi cộng rồi mới nhân. Khi nhân thì không cần quy đồng.

## Luyện tập

Tính 3/4 × 5/7.

Tính 2/9 × 3 rồi rút gọn kết quả.
```

`content/grade4/tinh-chat-phep-nhan-phan-so.md`:

```markdown
# Tính chất của phép nhân phân số

Phép nhân phân số có những tính chất giống phép nhân số tự nhiên. Biết các tính chất này, em có thể tính nhanh và tính thuận tiện hơn.

## Tính chất giao hoán

Khi đổi chỗ hai phân số trong một tích, tích không thay đổi.

Ví dụ: 2/5 × 3/4 = 6/20 và 3/4 × 2/5 = 6/20.

## Tính chất kết hợp

Khi nhân một tích hai phân số với phân số thứ ba, em có thể nhân phân số thứ nhất với tích của hai phân số còn lại.

Ví dụ: (1/2 × 2/3) × 3/4 = 1/2 × (2/3 × 3/4).

Tính chất này giúp em chọn cặp phân số nhân với nhau cho dễ. Ở ví dụ trên, 2/3 × 3/4 = 6/12 = 1/2, rồi 1/2 × 1/2 = 1/4.

## Nhân một tổng hai phân số với một phân số

Khi nhân một tổng hai phân số với một phân số, em có thể nhân từng phân số của tổng với phân số đó, rồi cộng các kết quả lại.

Ví dụ: (1/5 + 2/5) × 5/6 = 1/5 × 5/6 + 2/5 × 5/6.

Cách nào cũng ra cùng một kết quả, nhưng cộng trong ngoặc trước thường nhanh hơn: 1/5 + 2/5 = 3/5, rồi 3/5 × 5/6 = 15/30 = 1/2.

## Nhân với 1

Phân số nào nhân với 1 cũng bằng chính phân số đó. Một phân số có tử số bằng mẫu số, như 4/4 hay 7/7, cũng bằng 1.

## Tính thuận tiện

Khi thấy tử số của phân số này bằng mẫu số của phân số kia và ngược lại, em nên nhân hai phân số đó với nhau trước.

Ví dụ: 3/7 × 5/8 × 7/3. Đổi chỗ để nhân 3/7 × 7/3 trước: 3/7 × 7/3 = 21/21 = 1. Vậy tích bằng 1 × 5/8 = 5/8.

## Luyện tập

Tính bằng hai cách: (1/4 + 1/2) × 2/3.

Tính thuận tiện: 5/9 × 4/7 × 9/5.
```

`content/grade4/tim-phan-so-cua-mot-so.md`:

```markdown
# Tìm phân số của một số

Nhiều bài toán hỏi "2/3 của 12 là bao nhiêu" hay "3/4 số học sinh của lớp là bao nhiêu bạn". Đó là tìm phân số của một số.

## Tìm một phần của một số

Muốn tìm 1/3 của 12, em chia 12 thành 3 phần bằng nhau và lấy 1 phần: 12 : 3 = 4.

Vậy 1/3 của 12 là 4.

## Tìm nhiều phần của một số

Muốn tìm 2/3 của 12, em lấy 2 phần như thế: 12 : 3 × 2 = 8.

Vậy 2/3 của 12 là 8.

## Dùng phép nhân phân số

Em cũng có thể lấy số đó nhân với phân số: 12 × 2/3 = 24/3 = 8.

Hai cách cho cùng một kết quả. Chia cho mẫu số rồi nhân với tử số chính là nhân với phân số.

## Bài toán mẫu

Một rổ có 20 quả cam. Mẹ biếu bà 3/5 số cam. Hỏi mẹ biếu bà bao nhiêu quả cam?

Bài giải: Số cam mẹ biếu bà là 20 × 3/5 = 12 (quả). Đáp số: 12 quả cam.

## Lỗi thường gặp

Có bạn chỉ lấy số đó chia cho mẫu số rồi dừng lại, quên nhân với tử số. 20 : 5 = 4 mới là 1/5 số cam, còn 3/5 số cam là 3 phần như thế.

Cũng có bạn lấy số đó chia cho tử số. Em nhớ: mẫu số cho biết chia thành mấy phần bằng nhau, tử số cho biết lấy mấy phần.

## Luyện tập

Tìm 3/4 của 16.

Lớp em có 35 bạn, trong đó 2/5 số bạn thích bóng đá. Hỏi có bao nhiêu bạn thích bóng đá?
```

`content/grade4/giai-toan-voi-phep-nhan-phan-so.md`:

```markdown
# Giải toán có lời văn với phép nhân phân số

Bài toán có lời văn kể một câu chuyện và giấu phép tính ở bên trong. Em cần đọc kĩ để tìm ra phép tính đó.

## Các bước giải

Bước 1: Đọc kĩ đề bài, gạch chân những số đã cho.

Bước 2: Tìm xem bài toán hỏi gì và đơn vị là gì: mét, ki-lô-gam, mét vuông hay quả.

Bước 3: Chọn phép tính. Nếu đề bài hỏi diện tích hình chữ nhật, em nhân chiều dài với chiều rộng. Nếu đề bài hỏi một phân số của một số, như 2/3 của 15 kg, em nhân số đó với phân số.

Bước 4: Viết lời giải, phép tính và đáp số có đơn vị.

## Bài toán về diện tích

Một tấm bìa hình chữ nhật có chiều dài 4/5 m, chiều rộng 1/2 m. Tính diện tích tấm bìa.

Bài giải: Diện tích tấm bìa là 4/5 × 1/2 = 4/10 = 2/5 (m²). Đáp số: 2/5 m².

## Bài toán tìm phân số của một số

Một cửa hàng có 50 kg gạo, đã bán 2/5 số gạo. Hỏi cửa hàng đã bán bao nhiêu ki-lô-gam gạo?

Bài giải: Số gạo đã bán là 50 × 2/5 = 20 (kg). Đáp số: 20 kg.

## Bài toán hai bước

Có bài toán cần hai phép tính. Ví dụ: một cửa hàng có 50 kg gạo, đã bán 2/5 số gạo. Hỏi cửa hàng còn lại bao nhiêu ki-lô-gam gạo?

Phép tính thứ nhất tìm số gạo đã bán: 50 × 2/5 = 20 (kg). Phép tính thứ hai tìm số gạo còn lại: 50 - 20 = 30 (kg).

## Lỗi thường gặp

Có bạn tìm được số gạo đã bán rồi dừng lại, trong khi đề bài hỏi số gạo còn lại. Trước khi viết đáp số, em đọc lại câu hỏi một lần nữa.

Có bạn quên đơn vị, hoặc viết sai đơn vị: diện tích phải là mét vuông, không phải mét.

## Luyện tập

Một hình vuông có cạnh 3/8 m. Tính diện tích hình vuông đó.

Một bể có 90 l nước, đã dùng 1/3 số nước. Hỏi trong bể còn lại bao nhiêu lít nước?
```

- [ ] **Step 3: The grade 4 block of `lessons.json`**

```json
    {
      "grade": 4,
      "featured": {
        "title": "Phép nhân phân số",
        "lessonIds": ["nhan-hai-phan-so", "tinh-chat-phep-nhan-phan-so", "tim-phan-so-cua-mot-so", "giai-toan-voi-phep-nhan-phan-so"]
      },
      "lessons": [
        { "id": "phan-so-va-cach-doc", "title": "Phân số và cách đọc phân số" },
        { "id": "cong-tru-phan-so", "title": "Cộng và trừ phân số" },
        {
          "id": "nhan-hai-phan-so",
          "title": "Nhân hai phân số",
          "ghiNho": [
            "Muốn nhân hai phân số, ta lấy tử số nhân tử số, mẫu số nhân mẫu số.",
            "\\(\\frac{a}{b} \\times \\frac{c}{d} = \\frac{a \\times c}{b \\times d}\\)",
            "Nhân phân số với số tự nhiên: nhân tử số với số đó, giữ nguyên mẫu số. Ví dụ \\(\\frac{3}{7} \\times 2 = \\frac{6}{7}\\).",
            "Khi nhân phân số, không cần quy đồng mẫu số.",
            "Nhân xong, rút gọn kết quả nếu có thể."
          ],
          "problems": [
            { "question": "Tính \\(\\frac{2}{3} \\times \\frac{4}{5}\\).", "expr": "2/3 * 4/5", "answer": "8/15", "simplest": false },
            { "question": "Tính \\(\\frac{1}{2} \\times \\frac{3}{7}\\).", "expr": "1/2 * 3/7", "answer": "3/14", "simplest": false },
            { "question": "Tính \\(\\frac{5}{6} \\times \\frac{1}{4}\\).", "expr": "5/6 * 1/4", "answer": "5/24", "simplest": false },
            { "question": "Tính \\(\\frac{3}{8} \\times 3\\).", "expr": "3/8 * 3", "answer": "9/8", "simplest": false },
            { "question": "Tính \\(4 \\times \\frac{2}{9}\\).", "expr": "4 * 2/9", "answer": "8/9", "simplest": false },
            { "question": "Tính rồi rút gọn kết quả: \\(\\frac{4}{5} \\times \\frac{5}{8}\\).", "expr": "4/5 * 5/8", "answer": "1/2", "simplest": true },
            { "question": "Tính rồi rút gọn kết quả: \\(\\frac{3}{10} \\times \\frac{5}{9}\\).", "expr": "3/10 * 5/9", "answer": "1/6", "simplest": true },
            { "question": "Tính rồi rút gọn kết quả: \\(\\frac{5}{12} \\times 4\\).", "expr": "5/12 * 4", "answer": "5/3", "simplest": true },
            { "question": "Một hình chữ nhật có chiều dài \\(\\frac{5}{6}\\) m và chiều rộng \\(\\frac{2}{3}\\) m. Tính diện tích hình chữ nhật đó.", "expr": "5/6 * 2/3", "answer": "5/9", "simplest": false, "unit": "m²" }
          ]
        },
        {
          "id": "tinh-chat-phep-nhan-phan-so",
          "title": "Tính chất của phép nhân phân số",
          "ghiNho": [
            "Giao hoán: đổi chỗ hai phân số trong một tích thì tích không thay đổi. \\(\\frac{a}{b} \\times \\frac{c}{d} = \\frac{c}{d} \\times \\frac{a}{b}\\)",
            "Kết hợp: \\((\\frac{a}{b} \\times \\frac{c}{d}) \\times \\frac{m}{n} = \\frac{a}{b} \\times (\\frac{c}{d} \\times \\frac{m}{n})\\)",
            "Nhân một tổng với một phân số: \\((\\frac{a}{b} + \\frac{c}{d}) \\times \\frac{m}{n} = \\frac{a}{b} \\times \\frac{m}{n} + \\frac{c}{d} \\times \\frac{m}{n}\\)",
            "Phân số nào nhân với 1 cũng bằng chính nó.",
            "Tính thuận tiện: tìm hai phân số nhân với nhau được 1 để nhân trước."
          ],
          "problems": [
            { "question": "Điền phân số thích hợp vào chỗ dấu hỏi: \\(\\frac{3}{5} \\times \\frac{2}{7} = \\frac{2}{7} \\times \\, ?\\)", "expr": "3/5", "answer": "3/5", "simplest": false },
            { "question": "Tính bằng cách thuận tiện: \\(\\frac{4}{9} \\times \\frac{7}{11} \\times \\frac{9}{4}\\).", "expr": "4/9 * 7/11 * 9/4", "answer": "7/11", "simplest": false },
            { "question": "Tính bằng cách thuận tiện: \\(\\frac{2}{3} \\times \\frac{5}{6} \\times \\frac{3}{2}\\).", "expr": "2/3 * 5/6 * 3/2", "answer": "5/6", "simplest": false },
            { "question": "Tính: \\((\\frac{1}{3} + \\frac{1}{3}) \\times \\frac{3}{4}\\).", "expr": "(1/3 + 1/3) * 3/4", "answer": "1/2", "simplest": false },
            { "question": "Tính: \\((\\frac{2}{7} + \\frac{3}{7}) \\times \\frac{7}{8}\\).", "expr": "(2/7 + 3/7) * 7/8", "answer": "5/8", "simplest": false },
            { "question": "Tính rồi rút gọn kết quả: \\(\\frac{3}{8} \\times \\frac{5}{6} + \\frac{5}{8} \\times \\frac{5}{6}\\).", "expr": "3/8 * 5/6 + 5/8 * 5/6", "answer": "5/6", "simplest": true },
            { "question": "Tính: \\(\\frac{5}{6} \\times \\frac{7}{7}\\).", "expr": "5/6 * 7/7", "answer": "5/6", "simplest": false },
            { "question": "Tính bằng cách thuận tiện: \\(\\frac{1}{2} \\times \\frac{3}{5} \\times 2\\).", "expr": "1/2 * 3/5 * 2", "answer": "3/5", "simplest": false },
            { "question": "Một tấm kính hình chữ nhật dài \\(\\frac{3}{4}\\) m, rộng \\(\\frac{1}{2}\\) m. Bạn An tính diện tích bằng \\(\\frac{3}{4} \\times \\frac{1}{2}\\), bạn Bình tính bằng \\(\\frac{1}{2} \\times \\frac{3}{4}\\). Diện tích tấm kính là bao nhiêu mét vuông?", "expr": "3/4 * 1/2", "answer": "3/8", "simplest": false, "unit": "m²" }
          ]
        },
        {
          "id": "tim-phan-so-cua-mot-so",
          "title": "Tìm phân số của một số",
          "ghiNho": [
            "Muốn tìm phân số của một số, ta lấy số đó nhân với phân số.",
            "\\(\\frac{2}{3}\\) của 12 là \\(12 \\times \\frac{2}{3} = 8\\).",
            "Cách khác: chia số đó cho mẫu số, rồi nhân với tử số: \\(12 : 3 \\times 2 = 8\\).",
            "Mẫu số cho biết chia thành mấy phần bằng nhau, tử số cho biết lấy mấy phần."
          ],
          "problems": [
            { "question": "Tìm \\(\\frac{1}{4}\\) của 20.", "expr": "20 * 1/4", "answer": "5", "simplest": false },
            { "question": "Tìm \\(\\frac{2}{5}\\) của 30.", "expr": "30 * 2/5", "answer": "12", "simplest": false },
            { "question": "Tìm \\(\\frac{3}{4}\\) của 24.", "expr": "24 * 3/4", "answer": "18", "simplest": false },
            { "question": "Tìm \\(\\frac{5}{6}\\) của 42.", "expr": "42 * 5/6", "answer": "35", "simplest": false },
            { "question": "Tìm \\(\\frac{2}{3}\\) của 18 kg.", "expr": "18 * 2/3", "answer": "12", "simplest": false, "unit": "kg" },
            { "question": "Một lớp có 32 học sinh, trong đó \\(\\frac{3}{8}\\) số học sinh là học sinh nam. Hỏi lớp đó có bao nhiêu học sinh nam?", "expr": "32 * 3/8", "answer": "12", "simplest": false, "unit": "học sinh" },
            { "question": "Một sợi dây dài 45 m. Người ta cắt đi \\(\\frac{4}{9}\\) sợi dây. Hỏi đã cắt đi bao nhiêu mét dây?", "expr": "45 * 4/9", "answer": "20", "simplest": false, "unit": "m" },
            { "question": "Một cửa hàng có 48 quả trứng, đã bán \\(\\frac{5}{8}\\) số trứng. Hỏi cửa hàng đã bán bao nhiêu quả trứng?", "expr": "48 * 5/8", "answer": "30", "simplest": false, "unit": "quả" },
            { "question": "Một thùng có 60 l nước. Đã dùng \\(\\frac{3}{5}\\) số nước. Hỏi trong thùng còn lại bao nhiêu lít nước?", "expr": "60 - 60 * 3/5", "answer": "24", "simplest": false, "unit": "l" }
          ]
        },
        {
          "id": "giai-toan-voi-phep-nhan-phan-so",
          "title": "Giải toán có lời văn với phép nhân phân số",
          "ghiNho": [
            "Đọc kĩ đề: bài cho biết gì, hỏi gì, đơn vị là gì.",
            "Diện tích hình chữ nhật = chiều dài × chiều rộng (cùng đơn vị đo).",
            "Tìm phân số của một số: lấy số đó nhân với phân số.",
            "Bài toán hỏi phần còn lại: tìm phần đã dùng trước, rồi lấy tổng trừ đi phần đó.",
            "Đáp số luôn có đơn vị. Diện tích dùng đơn vị mét vuông."
          ],
          "problems": [
            { "question": "Một tấm bìa hình chữ nhật có chiều dài \\(\\frac{5}{7}\\) m, chiều rộng \\(\\frac{2}{3}\\) m. Tính diện tích tấm bìa.", "expr": "5/7 * 2/3", "answer": "10/21", "simplest": false, "unit": "m²" },
            { "question": "Một hình vuông có cạnh \\(\\frac{2}{5}\\) m. Tính diện tích hình vuông đó.", "expr": "2/5 * 2/5", "answer": "4/25", "simplest": false, "unit": "m²" },
            { "question": "Mỗi chai nước chứa \\(\\frac{3}{4}\\) l. Hỏi 8 chai như thế chứa bao nhiêu lít nước?", "expr": "3/4 * 8", "answer": "6", "simplest": false, "unit": "l" },
            { "question": "Một bao gạo nặng 45 kg. Mẹ đã dùng \\(\\frac{2}{9}\\) bao gạo. Hỏi mẹ đã dùng bao nhiêu ki-lô-gam gạo?", "expr": "45 * 2/9", "answer": "10", "simplest": false, "unit": "kg" },
            { "question": "Một đoàn xe chở 56 tấn hàng, đã dỡ xuống \\(\\frac{3}{7}\\) số hàng. Hỏi còn bao nhiêu tấn hàng chưa dỡ?", "expr": "56 - 56 * 3/7", "answer": "32", "simplest": false, "unit": "tấn" },
            { "question": "Lớp 4A có 36 học sinh. Số học sinh giỏi toán bằng \\(\\frac{5}{12}\\) số học sinh của lớp. Hỏi lớp 4A có bao nhiêu học sinh giỏi toán?", "expr": "36 * 5/12", "answer": "15", "simplest": false, "unit": "học sinh" },
            { "question": "Một mảnh vườn hình chữ nhật có chiều dài 24 m, chiều rộng bằng \\(\\frac{2}{3}\\) chiều dài. Tính diện tích mảnh vườn.", "expr": "24 * (24 * 2/3)", "answer": "384", "simplest": false, "unit": "m²" },
            { "question": "Mỗi vòng quanh sân trường dài \\(\\frac{3}{10}\\) km. Bạn Nam chạy 5 vòng. Hỏi bạn Nam chạy được bao nhiêu ki-lô-mét?", "expr": "3/10 * 5", "answer": "3/2", "simplest": false, "unit": "km" },
            { "question": "Một cửa hàng có 80 quả trứng. Buổi sáng bán \\(\\frac{1}{4}\\) số trứng, buổi chiều bán \\(\\frac{2}{5}\\) số trứng. Hỏi cả ngày cửa hàng bán được bao nhiêu quả trứng?", "expr": "80 * 1/4 + 80 * 2/5", "answer": "52", "simplest": false, "unit": "quả" }
          ]
        },
        { "id": "dau-hieu-chia-het", "title": "Dấu hiệu chia hết cho 2, 3, 5, 9" }
      ]
    },
```

- [ ] **Step 4: Add eval cases**

Append to `tests/evals/retrieval_cases.json` (inside the array):

```json
  {
    "query": "Con em hỏi 3 phần 4 nhân với 2 phần 5 thì tính thế nào, tử với mẫu làm gì ạ?",
    "expect_doc_id": "nhan-hai-phan-so"
  },
  {
    "query": "Đổi thứ tự các phân số khi làm phép nhân thì kết quả có khác đi không ạ?",
    "expect_doc_id": "tinh-chat-phep-nhan-phan-so"
  },
  {
    "query": "Nhà em có 24 cái kẹo, em được ăn 3 phần 8 số kẹo thì là mấy cái?",
    "expect_doc_id": "tim-phan-so-cua-mot-so"
  },
  {
    "query": "Đề toán kể chuyện về phân số thì em làm sao biết phải chọn phép tính nào, lại hay quên ghi đơn vị?",
    "expect_doc_id": "giai-toan-voi-phep-nhan-phan-so"
  }
```

Append to `tests/evals/tutor_behaviour_cases.json`. This is the message the practice card's "Cô gợi ý" button sends:

```json
  {
    "name": "hint-request-wrong-attempt",
    "message": "Cô gợi ý cho em bài «Nhân hai phân số» với ạ: Tính \\(\\frac{2}{3} \\times \\frac{4}{5}\\). Em làm ra 6/15.",
    "forbidden": ["8/15", "\\frac{8}{15}", "\\dfrac{8}{15}", "tám phần mười lăm"]
  }
```

- [ ] **Step 5: Run the offline suite**

Run: `python -m pytest -q`
Expected: all offline tests pass. That includes `test_lessons.py` (answers recomputed), `test_case_has_no_lexical_confound_with_target_document` for the 4 new cases, and the derived unaccented-variant guard.

If a confound guard fails, rewrite that **query** so it is still a paraphrase: change the words it shares with the lesson. Never edit the lesson to dodge the guard.

- [ ] **Step 6: Commit**

```bash
git add content/grade4/nhan-hai-phan-so.md content/grade4/tinh-chat-phep-nhan-phan-so.md content/grade4/tim-phan-so-cua-mot-so.md content/grade4/giai-toan-voi-phep-nhan-phan-so.md lessons.json tests/evals/retrieval_cases.json tests/evals/tutor_behaviour_cases.json
git commit -F msg.txt
```

Message: `feat(lessons): add the phép nhân phân số unit with Ghi nhớ and practice` + blank + Co-Authored-By.

- [ ] **Step 7: USER CHECKPOINT — maths review**

Stop. Ask the user to read the four lessons, the Ghi nhớ bullets and the 36 problems. Their commit link or file paths are enough. Apply any corrections, rerun `python -m pytest tests/test_lessons.py -q`, and commit the fix. Later tasks may proceed in parallel, but nothing is ingested or deployed until the user has approved the content.

---

### Task 4: `js/lessons.js` — data, answer checking, home and cards

**Files:**
- Create: `js/lessons.js`
- Modify: `index.html` (script tag), `sw.js` (APP_SHELL)

**Interfaces:**
- Consumes: `lessons.json` (Tasks 2–3).
- Produces `window.Lessons`:
  - `load(): Promise<boolean>` resolves `true` once the data is usable, `false` otherwise. It never rejects.
  - `isReady(): boolean`
  - `find(id: string): Lesson | null`
  - `hasPractice(lesson): boolean`
  - `parseAnswer(text: string): { num: number, den: number } | null`
  - `checkAnswer(text: string, problem): 'correct' | 'not-simplest' | 'wrong' | 'invalid'`
  - `isValidCard(entry): boolean`
  - `renderHome(container: HTMLElement, onPick: (lessonId: string) => void): void`
  - `renderCard(entry, ctx): HTMLElement | null`, where `ctx = { fill(el, text), act(action, entry) }` and `action ∈ 'ghiNho' | 'practice' | 'next' | 'attempt' | 'hint' | 'home'`
  - `cardMessages(entry): Array<{ role: 'assistant' | 'user', content: string }>`
  - `hintMessage(entry): string`
  - Card entries: `{ role: 'assistant', card: 'lesson' | 'ghiNho', lessonId }` and `{ role: 'assistant', card: 'problem', lessonId, index, attempts: string[], solved: boolean }`

- [ ] **Step 1: Write the browser check before the code**

Save this script as the check to run in Step 4. It must fail first: `window.Lessons` is undefined.

```js
(async () => {
    const out = [];
    const ok = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) out.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
    const L = window.Lessons;
    if (!L) return 'FAIL: window.Lessons is undefined';
    const half = { answer: '1/2', simplest: true }, frac = { answer: '8/15', simplest: false };
    const three = { answer: '3', simplest: false }, threeS = { answer: '3', simplest: true };
    [
        ['8/15', frac, 'correct'], [' 16 / 30 ', frac, 'correct'], ['6/15', frac, 'wrong'],
        ['3', three, 'correct'], ['6/2', three, 'correct'], ['6/2', threeS, 'not-simplest'],
        ['3/1', threeS, 'correct'], ['1/2', half, 'correct'], ['2/4', half, 'not-simplest'],
        ['3/4', half, 'wrong'], ['5/0', frac, 'invalid'], ['', frac, 'invalid'], ['abc', frac, 'invalid'],
        ['1,5', frac, 'invalid'], ['-1/2', half, 'invalid'], ['1234567', three, 'invalid'], ['1/2/3', half, 'invalid']
    ].forEach(([text, p, want]) => ok(`checkAnswer(${JSON.stringify(text)}, ${p.answer}${p.simplest ? ' simplest' : ''})`, L.checkAnswer(text, p), want));
    ok('isReady before load', L.isReady(), false);
    ok('load', await L.load(), true);
    ok('isReady after load', L.isReady(), true);
    const lesson = L.find('nhan-hai-phan-so');
    ok('find title', lesson && lesson.title, 'Nhân hai phân số');
    ok('find unknown', L.find('khong-co'), null);
    ok('hasPractice featured', L.hasPractice(lesson), true);
    ok('hasPractice plain', L.hasPractice(L.find('cong-tru-phan-so')), false);
    const p0 = { role: 'assistant', card: 'problem', lessonId: 'nhan-hai-phan-so', index: 0, attempts: ['6/15'], solved: false };
    [
        [{ role: 'assistant', card: 'lesson', lessonId: 'cong-tru-phan-so' }, true],
        [{ role: 'assistant', card: 'ghiNho', lessonId: 'cong-tru-phan-so' }, false],
        [{ role: 'assistant', card: 'ghiNho', lessonId: 'nhan-hai-phan-so' }, true],
        [p0, true], [{ ...p0, index: 9 }, false], [{ ...p0, index: 1.5 }, false],
        [{ ...p0, attempts: [3] }, false], [{ ...p0, solved: 'no' }, false],
        [{ ...p0, role: 'user' }, false], [{ ...p0, card: 'quiz' }, false], [{ ...p0, lessonId: '__proto__' }, false]
    ].forEach(([entry, want], i) => ok(`isValidCard #${i}`, L.isValidCard(entry), want));
    ok('cardMessages problem', L.cardMessages(p0), [
        { role: 'assistant', content: 'Bài 1: Tính \\(\\frac{2}{3} \\times \\frac{4}{5}\\).' },
        { role: 'user', content: 'Em trả lời: 6/15 (chưa đúng)' }
    ]);
    ok('cardMessages lesson', L.cardMessages({ role: 'assistant', card: 'lesson', lessonId: 'nhan-hai-phan-so' }),
        [{ role: 'assistant', content: 'Hôm nay mình học bài «Nhân hai phân số» nhé. Em muốn làm gì trước?' }]);
    ok('hintMessage', L.hintMessage(p0), 'Cô gợi ý cho em bài «Nhân hai phân số» với ạ: Tính \\(\\frac{2}{3} \\times \\frac{4}{5}\\). Em làm ra 6/15.');
    ok('hintMessage no attempt', L.hintMessage({ ...p0, attempts: [] }), 'Cô gợi ý cho em bài «Nhân hai phân số» với ạ: Tính \\(\\frac{2}{3} \\times \\frac{4}{5}\\). Em chưa biết bắt đầu từ đâu.');
    return out.length ? 'FAIL\n' + out.join('\n') : 'PASS';
})()
```

Run it: `preview_start {name: "static"}`, navigate to `http://localhost:8000/`, run the script with `javascript_tool`.
Expected: `FAIL: window.Lessons is undefined`.

Note: `isReady before load` is only `false` on a page where nothing has called `load()` yet. Until Task 5, nothing does.

- [ ] **Step 2: Write `js/lessons.js`**

```js
// Lessons: the home screen's lesson picker, and the Ghi nhớ and practice cards inside a lesson.
// All content comes from lessons.json, written and checked by people; tests/test_lessons.py
// recomputes every answer. Nothing here calls the AI: answers are checked on the device.
// js/chat.js owns the conversation. It calls in here to draw cards, and to turn them into the
// plain text the tutor sees.
//
// Everything is built with DOM methods and textContent. Text that can hold markdown or maths
// (Ghi nhớ bullets, questions) goes through ctx.fill, which is js/chat.js's sanitising pipeline.
window.Lessons = (function () {
    const DATA_URL = 'lessons.json';
    const GRADE_KEY = 'meritsGrade';

    let data = null;
    const lessonsById = new Map();

    // ---- data ----

    function load() {
        return fetch(DATA_URL)
            .then((res) => (res.ok ? res.json() : null))
            .then((json) => {
                if (json && Array.isArray(json.grades)) {
                    lessonsById.clear();
                    json.grades.forEach((grade) => grade.lessons.forEach((lesson) => lessonsById.set(lesson.id, lesson)));
                    data = json;
                }
            })
            .catch(() => {})   // offline with no cached copy: the chat works without lessons
            .then(() => data !== null);
    }

    function isReady() {
        return data !== null;
    }

    function find(id) {
        return (typeof id === 'string' && lessonsById.get(id)) || null;
    }

    function hasPractice(lesson) {
        return Boolean(lesson) && Array.isArray(lesson.ghiNho) &&
            Array.isArray(lesson.problems) && lesson.problems.length > 0;
    }

    // ---- answers ----

    // A whole number or a fraction a/b, spaces ignored. At most 6 digits a part, so the
    // cross-multiplication below stays exact. Anything else, a zero denominator included, is null.
    function parseAnswer(text) {
        const match = String(text).replace(/\s+/g, '').match(/^(\d{1,6})(?:\/(\d{1,6}))?$/);
        if (!match) return null;
        const num = Number(match[1]);
        const den = match[2] === undefined ? 1 : Number(match[2]);
        return den === 0 ? null : { num: num, den: den };
    }

    function gcd(a, b) {
        while (b) {
            [a, b] = [b, a % b];
        }
        return a;
    }

    // An equivalent fraction is correct (6/8 for 3/4) unless the problem asks to simplify.
    function checkAnswer(text, problem) {
        const given = parseAnswer(text);
        if (!given) return 'invalid';
        const expected = parseAnswer(problem.answer);
        if (given.num * expected.den !== expected.num * given.den) return 'wrong';
        if (problem.simplest && gcd(given.num, given.den) !== 1) return 'not-simplest';
        return 'correct';
    }

    // ---- conversation entries ----

    // Cards are replayed from localStorage, so a card is drawn only if everything it points at
    // still exists and has the right shape.
    function isValidCard(entry) {
        if (!entry || entry.role !== 'assistant') return false;
        const lesson = find(entry.lessonId);
        if (!lesson) return false;
        if (entry.card === 'lesson') return true;
        if (!hasPractice(lesson)) return false;
        if (entry.card === 'ghiNho') return true;
        return entry.card === 'problem' &&
            Number.isInteger(entry.index) && entry.index >= 0 && entry.index < lesson.problems.length &&
            Array.isArray(entry.attempts) && entry.attempts.every((a) => typeof a === 'string') &&
            typeof entry.solved === 'boolean';
    }

    function introText(lesson) {
        return hasPractice(lesson)
            ? 'Hôm nay mình học bài «' + lesson.title + '» nhé. Em muốn làm gì trước?'
            : 'Mình cùng tìm hiểu bài «' + lesson.title + '» nhé. Em muốn hỏi cô điều gì?';
    }

    const RESULT_WORDS = { correct: 'đúng', 'not-simplest': 'đúng nhưng chưa rút gọn', wrong: 'chưa đúng' };

    // What the tutor is told a card said. The API takes text only.
    function cardMessages(entry) {
        const lesson = find(entry.lessonId);
        if (!lesson) return [];
        if (entry.card === 'lesson') {
            return [{ role: 'assistant', content: introText(lesson) }];
        }
        if (entry.card === 'ghiNho') {
            return [{ role: 'assistant', content: 'Ghi nhớ: ' + lesson.ghiNho.join(' ') }];
        }
        if (entry.card === 'problem') {
            const problem = lesson.problems[entry.index];
            const messages = [{ role: 'assistant', content: 'Bài ' + (entry.index + 1) + ': ' + problem.question }];
            const last = entry.attempts[entry.attempts.length - 1];
            if (last !== undefined) {
                const result = RESULT_WORDS[checkAnswer(last, problem)] || 'chưa đúng';
                messages.push({ role: 'user', content: 'Em trả lời: ' + last + (problem.unit ? ' ' + problem.unit : '') + ' (' + result + ')' });
            }
            return messages;
        }
        return [];
    }

    // The child's message when they tap "Cô gợi ý". The lesson title is in it because retrieval
    // searches the child's last two messages, and the title finds the right lesson.
    function hintMessage(entry) {
        const lesson = find(entry.lessonId);
        const problem = lesson.problems[entry.index];
        const last = entry.attempts[entry.attempts.length - 1];
        return 'Cô gợi ý cho em bài «' + lesson.title + '» với ạ: ' + problem.question + ' ' +
            (last !== undefined ? 'Em làm ra ' + last + (problem.unit ? ' ' + problem.unit : '') + '.' : 'Em chưa biết bắt đầu từ đâu.');
    }

    // ---- drawing ----

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function button(label, className, onClick) {
        const node = el('button', className, label);
        node.type = 'button';
        node.addEventListener('click', onClick);
        return node;
    }

    function currentGrade() {
        let wanted = data.defaultGrade;
        try {
            const saved = Number(localStorage.getItem(GRADE_KEY));
            if (data.grades.some((grade) => grade.grade === saved)) wanted = saved;
        } catch {
            // Storage unavailable: use the default grade.
        }
        return data.grades.find((grade) => grade.grade === wanted) || data.grades[0];
    }

    function saveGrade(number) {
        try {
            localStorage.setItem(GRADE_KEY, String(number));
        } catch {
            // Storage unavailable: the choice lasts until the page reloads.
        }
    }

    function renderHome(container, onPick) {
        container.textContent = '';
        const grade = currentGrade();

        container.appendChild(el('p', 'home-greeting', 'Chào em! Hôm nay em muốn học bài nào?'));

        const chips = el('div', 'grade-chips');
        data.grades.forEach((g) => {
            const chip = button('Lớp ' + g.grade, 'grade-chip grade-' + g.grade, () => {
                saveGrade(g.grade);
                renderHome(container, onPick);
            });
            chip.setAttribute('aria-pressed', String(g.grade === grade.grade));
            chips.appendChild(chip);
        });
        container.appendChild(chips);

        const featuredIds = grade.featured ? grade.featured.lessonIds : [];
        if (grade.featured) {
            const box = el('section', 'featured');
            box.appendChild(el('p', 'featured-label', 'Chủ đề nổi bật'));
            box.appendChild(el('h2', 'featured-title', grade.featured.title));
            box.appendChild(el('p', 'featured-meta', featuredIds.length + ' bài · Ghi nhớ · Luyện tập'));
            featuredIds.forEach((id, i) => {
                const row = button(undefined, 'featured-lesson', () => onPick(id));
                row.appendChild(el('span', 'featured-number', String(i + 1)));
                row.appendChild(el('span', 'lesson-title', find(id).title));
                box.appendChild(row);
            });
            container.appendChild(box);
        }

        const others = grade.lessons.filter((lesson) => !featuredIds.includes(lesson.id));
        if (others.length > 0) {
            container.appendChild(el('h2', 'home-heading', grade.featured ? 'Các bài khác' : 'Các bài học lớp ' + grade.grade));
            const list = el('div', 'lesson-list');
            others.forEach((lesson) => {
                const card = button(undefined, 'lesson-card', () => onPick(lesson.id));
                card.appendChild(el('span', 'lesson-title', lesson.title));
                card.appendChild(el('span', 'lesson-tag', hasPractice(lesson) ? 'Ghi nhớ · Luyện tập' : 'Hỏi cô'));
                list.appendChild(card);
            });
            container.appendChild(list);
        }
    }

    function renderCard(entry, ctx) {
        const lesson = find(entry.lessonId);
        if (!lesson) return null;
        if (entry.card === 'lesson') return lessonCard(lesson, entry, ctx);
        if (entry.card === 'ghiNho') return ghiNhoCard(lesson, entry, ctx);
        if (entry.card === 'problem') return problemCard(lesson, entry, ctx);
        return null;
    }

    function lessonCard(lesson, entry, ctx) {
        const card = el('div', 'msg ai card lesson-card-msg');
        card.appendChild(el('p', 'card-text', introText(lesson)));
        if (hasPractice(lesson)) {
            const actions = el('div', 'card-actions');
            actions.appendChild(button('Những kiến thức phải nhớ', 'card-btn primary', () => ctx.act('ghiNho', entry)));
            actions.appendChild(button('Cho em bài để luyện tập', 'card-btn primary', () => ctx.act('practice', entry)));
            card.appendChild(actions);
        }
        return card;
    }

    function ghiNhoCard(lesson, entry, ctx) {
        const card = el('div', 'msg ai card ghinho-card');
        card.appendChild(el('p', 'card-label', 'Ghi nhớ · ' + lesson.title));
        const list = el('ul', 'ghinho-list');
        lesson.ghiNho.forEach((point) => {
            const item = el('li');
            ctx.fill(item, point);
            list.appendChild(item);
        });
        card.appendChild(list);
        const actions = el('div', 'card-actions');
        actions.appendChild(button('Cho em bài để luyện tập', 'card-btn primary', () => ctx.act('practice', entry)));
        card.appendChild(actions);
        return card;
    }

    const FEEDBACK = {
        correct: 'Giỏi quá! Em làm đúng rồi.',
        'not-simplest': 'Đúng rồi, nhưng em rút gọn được nữa đấy.',
        wrong: 'Chưa đúng rồi, em thử lại nhé.',
        invalid: 'Em viết số hoặc phân số, ví dụ 3/4 nhé.'
    };

    function problemCard(lesson, entry, ctx) {
        const problem = lesson.problems[entry.index];
        const total = lesson.problems.length;
        const card = el('div', 'msg ai card problem-card');

        card.appendChild(el('p', 'card-label', 'Bài ' + (entry.index + 1) + '/' + total));
        const question = el('div', 'card-text');
        ctx.fill(question, problem.question);
        card.appendChild(question);

        const form = el('form', 'answer-row');
        const input = el('input', 'answer-input');
        input.type = 'text';
        input.inputMode = 'text';   // a fraction needs the "/" key, which numeric keypads lack
        input.autocomplete = 'off';
        input.maxLength = 20;
        input.setAttribute('aria-label', 'Câu trả lời của em');
        form.appendChild(input);
        if (problem.unit) form.appendChild(el('span', 'answer-unit', problem.unit));
        const check = el('button', 'card-btn primary', 'Kiểm tra');
        check.type = 'submit';
        form.appendChild(check);
        card.appendChild(form);

        const feedback = el('p', 'feedback');
        feedback.setAttribute('role', 'status');
        card.appendChild(feedback);

        const actions = el('div', 'card-actions');
        const hint = button('Cô gợi ý', 'card-btn hint', () => ctx.act('hint', entry));
        actions.appendChild(hint);
        card.appendChild(actions);

        const done = el('div', 'card-done');
        const doneActions = el('div', 'card-actions');
        if (entry.index === total - 1) {
            done.appendChild(el('p', 'finish', 'Em đã làm hết ' + total + ' bài rồi. Giỏi quá!'));
            doneActions.appendChild(button('Những kiến thức phải nhớ', 'card-btn', () => ctx.act('ghiNho', entry)));
            doneActions.appendChild(button('Chọn bài khác', 'card-btn primary', () => ctx.act('home', entry)));
        } else {
            doneActions.appendChild(button('Bài tiếp theo', 'card-btn primary', () => ctx.act('next', entry)));
        }
        done.appendChild(doneActions);
        card.appendChild(done);

        function show(result) {
            feedback.textContent = result ? FEEDBACK[result] : '';
            feedback.className = 'feedback' + (result ? ' ' + result : '');
            input.disabled = entry.solved;
            check.disabled = entry.solved;
            hint.hidden = entry.solved;
            hint.classList.toggle('highlight', result === 'wrong');
            done.hidden = !entry.solved;
            card.classList.toggle('solved', entry.solved);
        }

        form.addEventListener('submit', (event) => {
            event.preventDefault();
            if (entry.solved) return;
            const result = checkAnswer(input.value, problem);
            if (result !== 'invalid') {
                entry.attempts.push(input.value.replace(/\s+/g, ''));
                entry.solved = result === 'correct';
                ctx.act('attempt', entry);
            }
            show(result);
        });

        // A saved card comes back with its last attempt in the box and that attempt's result.
        const last = entry.attempts[entry.attempts.length - 1];
        if (last !== undefined) input.value = last;
        show(last !== undefined ? checkAnswer(last, problem) : null);
        return card;
    }

    return {
        load: load,
        isReady: isReady,
        find: find,
        hasPractice: hasPractice,
        parseAnswer: parseAnswer,
        checkAnswer: checkAnswer,
        isValidCard: isValidCard,
        renderHome: renderHome,
        renderCard: renderCard,
        cardMessages: cardMessages,
        hintMessage: hintMessage
    };
})();
```

- [ ] **Step 3: Load it and precache it**

In `index.html`, add `<script src="js/lessons.js"></script>` immediately before `<script src="js/chat.js"></script>`.

In `sw.js` `APP_SHELL`, add `'./lessons.json',` and `'./js/lessons.js',` after `'./icons/icon.svg',`.

- [ ] **Step 4: Run the browser check**

Reload `http://localhost:8000/` and rerun the Step 1 script.
Expected: `PASS`. Also run `read_console_messages {onlyErrors: true}`. Expected: no errors from `js/lessons.js`.

- [ ] **Step 5: Run the offline suite**

Run: `python -m pytest -q`
Expected: all pass. `test_every_app_shell_file_exists` now covers the two new files.

- [ ] **Step 6: Commit**

```bash
git add js/lessons.js index.html sw.js
git commit -F msg.txt
```

Message: `feat(lessons): add the lessons module — data, answer checking, home and cards` + blank + Co-Authored-By.

---

### Task 5: Home screen and cards in the chat

**Files:**
- Modify: `js/chat.js`, `index.html`, `chat.css`, `tests/test_chat_grounded.py`

**Interfaces:**
- Consumes: every `window.Lessons` function listed in Task 4.
- Produces: the finished UI. `window.Chat` keeps `{ send, clear }`.

- [ ] **Step 1: Write the failing live test**

The server is unchanged, so this runs against today's live site. A lesson conversation starts with the tutor's card, so every provider must accept a conversation that begins with an assistant message. Append to `tests/test_chat_grounded.py`:

```python
import pytest


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
```

Put `import pytest` at the top of the file beside `import requests`, not above the test.

Run (PowerShell):

```powershell
$env:RAG_BASE_URL = "https://meritsofmath.pages.dev"; python -m pytest tests/test_chat_grounded.py -k tutor_message -q
```

Expected: this test documents an assumption rather than a missing feature. If both PASS, carry on. If a provider FAILS, stop: `js/chat.js`'s `toApiMessages` must then prepend nothing and instead fold the leading assistant text into the first user message. Report this before continuing.

- [ ] **Step 2: Update `index.html`**

Replace the `<header>…</header>`, `#messages`, `#suggestions` and `<form>` blocks with:

```html
    <header class="chat-header">
        <button type="button" class="icon-btn" id="back-btn" title="Về trang chủ" aria-label="Về trang chủ" hidden>&#8592;</button>
        <div>
            <h1>Merits of Math</h1>
            <p class="sub">Gia sư toán của em</p>
        </div>
        <div class="spacer"></div>
        <button type="button" class="icon-btn" id="clear-btn" title="Cuộc trò chuyện mới" aria-label="Cuộc trò chuyện mới" hidden>&#8635;</button>
    </header>

    <section class="home" id="home" hidden></section>

    <div class="messages" id="messages" hidden></div>

    <form class="composer" id="composer">
        <textarea id="input" rows="1" placeholder="Hỏi cô về toán..." aria-label="Hỏi cô về toán"></textarea>
        <button type="submit" id="send-btn" disabled>Gửi</button>
    </form>
```

- [ ] **Step 3: Update `js/chat.js`**

Top-of-file comment (lines 1–3):

```js
// The chat app. Talks to /api/chat in grounded mode; the Socratic prompt and the retrieved
// curriculum context are built server-side, so nothing about how the tutor is instructed is
// visible or editable here. The home screen's lesson picker and the lesson cards (Ghi nhớ,
// practice) are drawn by js/lessons.js; this file owns the conversation they live in.
```

In `TEXT`, delete the `suggestions` line.

Replace `let history = [];` and its comment with:

```js
    // Text entries { role: 'user'|'assistant', content } and card entries drawn by js/lessons.js,
    // e.g. { role: 'assistant', card: 'problem', lessonId, index, attempts, solved }.
    let history = [];
    let ready = false;             // true once lessons.json has loaded or failed to
```

Replace everything from `function appendBubble(role, text, extraClass) {` to the end of the file with:

```js
    // Fills `el` with markdown and maths, sanitised, and queues it for typesetting. Tutor replies,
    // Ghi nhớ bullets and practice questions all go through here.
    function fillRich(el, text) {
        if (window.DOMPurify && window.DOMPurify.sanitize) {
            // DOMPurify sanitises marked's output against an explicit allowlist before it reaches
            // innerHTML: marked itself does not sanitise, the child can steer the tutor's reply,
            // and it is replayed from localStorage on every future visit, so unsanitised HTML
            // here would run again and again. If DOMPurify is unavailable (its CDN script blocked
            // or failed to load), fail safe: plain text, never unsanitised innerHTML.
            el.innerHTML = window.DOMPurify.sanitize(renderMarkdown(text), SANITISE);
        } else {
            el.textContent = text;
        }
        typesetOnce(el);
    }

    function appendBubble(role, text, extraClass) {
        const div = document.createElement('div');
        div.className = 'msg ' + (extraClass || (role === 'user' ? 'user' : 'ai'));
        els.messages.appendChild(div);
        if (role === 'user') {
            // The child's own message is shown exactly as typed, never as markdown. A child
            // types `2*3*4` to multiply, and markdown turned it into 2<em>3</em>4, which read as
            // "234" (confirmed on the live site, 2026-09-15); lines starting "1.", "-" or "#"
            // likewise became lists or headings. textContent cannot carry HTML, and chat.css
            // keeps the child's line breaks. MathJax still typesets any maths the child typed,
            // under the same lock-down as every other bubble.
            div.textContent = text;
            typesetOnce(div);
        } else {
            fillRich(div, text);
        }
        return div;
    }

    // A card entry is drawn by js/lessons.js; a text entry is a bubble.
    function appendEntry(entry) {
        if (entry.card === undefined) return appendBubble(entry.role, entry.content);
        const card = window.Lessons.renderCard(entry, { fill: fillRich, act: onCardAction });
        if (card) els.messages.appendChild(card);
        return card;
    }

    // Saved entries are replayed from localStorage, so each is checked before it is drawn. A card
    // must still point at a lesson (and problem) in lessons.json.
    function isValidEntry(entry) {
        if (!entry || typeof entry !== 'object') return false;
        if (entry.card !== undefined) {
            return Boolean(window.Lessons && window.Lessons.isReady() && window.Lessons.isValidCard(entry));
        }
        return (entry.role === 'user' || entry.role === 'assistant') && typeof entry.content === 'string';
    }

    // What the tutor sees. The API takes { role, content } text only, so cards become the
    // sentences they show, and neighbouring messages from the same speaker are joined.
    function toApiMessages(entries) {
        const out = [];
        entries.forEach((entry) => {
            const parts = entry.card === undefined
                ? [{ role: entry.role, content: entry.content }]
                : window.Lessons.cardMessages(entry);
            parts.forEach((part) => {
                const last = out[out.length - 1];
                if (last && last.role === part.role) {
                    last.content += '\n\n' + part.content;
                } else {
                    out.push({ role: part.role, content: part.content });
                }
            });
        });
        return out;
    }

    function showTyping() {
        const div = document.createElement('div');
        div.className = 'typing';
        div.id = 'typing';
        // The animation is three dots, which conveys nothing to a screen reader.
        div.setAttribute('role', 'status');
        div.setAttribute('aria-label', TEXT.thinking);
        div.innerHTML = '<span></span><span></span><span></span>';
        els.messages.appendChild(div);
        scrollToBottom();
    }

    function hideTyping() {
        const el = document.getElementById('typing');
        if (el) el.remove();
    }

    // Home when there is no conversation and lessons.json loaded; otherwise the conversation.
    // If lessons.json could not load, this is the plain chat: greeting, ↻ button, no Home.
    function renderAll() {
        // Clear MathJax's bookkeeping for the content about to be discarded, then rebuild.
        // Each bubble typesets itself through appendBubble, the same as every other path --
        // there is no separate container-wide typeset here (see the comment above typesetOnce
        // for why that used to duplicate formulas).
        typesetClear(els.messages);
        els.messages.innerHTML = '';
        const lessonsReady = Boolean(window.Lessons && window.Lessons.isReady());
        const atHome = lessonsReady && history.length === 0;
        els.home.hidden = !atHome;
        els.messages.hidden = atHome;
        els.backBtn.hidden = !lessonsReady || atHome;
        els.clearBtn.hidden = lessonsReady;
        if (atHome) {
            window.Lessons.renderHome(els.home, startLesson);
        } else if (history.length === 0) {
            appendBubble('assistant', TEXT.greeting);
        } else {
            history.forEach(appendEntry);
        }
        scrollToBottom();
    }

    function startLesson(lessonId) {
        if (sending) return;
        history = [{ role: 'assistant', card: 'lesson', lessonId: lessonId }];
        save();
        renderAll();
        if (!window.Lessons.hasPractice(window.Lessons.find(lessonId))) els.input.focus();
    }

    // Adds a card under the conversation. Not while a reply is on its way: the reply would land
    // under the new card, answering something the child did not just ask.
    function pushEntry(entry) {
        if (sending) return;
        history.push(entry);
        save();
        const card = appendEntry(entry);
        const answer = card && card.querySelector('.answer-input');
        if (answer) answer.focus();
        scrollToBottom();
    }

    function onCardAction(action, entry) {
        const lessonId = entry.lessonId;
        if (action === 'ghiNho') {
            pushEntry({ role: 'assistant', card: 'ghiNho', lessonId: lessonId });
        } else if (action === 'practice') {
            pushEntry({ role: 'assistant', card: 'problem', lessonId: lessonId, index: 0, attempts: [], solved: false });
        } else if (action === 'next') {
            pushEntry({ role: 'assistant', card: 'problem', lessonId: lessonId, index: entry.index + 1, attempts: [], solved: false });
        } else if (action === 'attempt') {
            save();   // the card recorded the attempt on `entry`, which is the object in history
        } else if (action === 'hint') {
            send(window.Lessons.hintMessage(entry));
        } else if (action === 'home') {
            clearConversation();
        }
    }

    async function send(text) {
        const message = (text || '').trim();
        if (!message || sending || !ready) return;

        sending = true;
        els.sendBtn.disabled = true;
        els.input.value = '';
        autoGrow();

        history.push({ role: 'user', content: message });
        if (els.messages.hidden) {
            renderAll();                     // leaving Home: draws the conversation, this message included
        } else {
            appendBubble('user', message);   // typesets itself; see typesetOnce
        }
        scrollToBottom();
        showTyping();

        try {
            const res = await fetch(ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: toApiMessages(history.slice(-MAX_TURNS * 2)),
                    ground: true,
                    max_tokens: 220
                })
            });

            hideTyping();

            if (!res.ok) {
                appendBubble('assistant', TEXT.error, 'error');
                history.pop();      // drop the unanswered turn so a retry is clean
                return;
            }

            const data = await res.json();
            const reply = (data.choices && data.choices[0] && data.choices[0].message.content) || '';
            if (!reply.trim()) {
                appendBubble('assistant', TEXT.error, 'error');
                history.pop();
                return;
            }

            history.push({ role: 'assistant', content: reply });
            appendBubble('assistant', reply);   // typesets itself; see typesetOnce
            save();
        } catch {
            hideTyping();
            appendBubble('assistant', TEXT.error, 'error');
            history.pop();
        } finally {
            sending = false;
            els.sendBtn.disabled = false;
            scrollToBottom();
            els.input.focus();
        }
    }

    function autoGrow() {
        els.input.style.height = 'auto';
        els.input.style.height = Math.min(els.input.scrollHeight, 120) + 'px';
    }

    function clearConversation() {
        if (sending) return;   // a reply on its way would otherwise land in the next conversation
        history = [];
        save();
        renderAll();
    }

    function init() {
        clearRetiredStorage();   // first, before load() reads the conversation (see RETIRED_KEYS)
        els.home = document.getElementById('home');
        els.messages = document.getElementById('messages');
        els.input = document.getElementById('input');
        els.sendBtn = document.getElementById('send-btn');
        els.composer = document.getElementById('composer');
        els.clearBtn = document.getElementById('clear-btn');
        els.backBtn = document.getElementById('back-btn');

        load();

        els.composer.addEventListener('submit', (e) => {
            e.preventDefault();
            send(els.input.value);
        });

        els.input.addEventListener('input', autoGrow);

        // Enter sends; Shift+Enter makes a new line. On touch devices the on-screen
        // keyboard's return key should insert a newline instead, so only bind this
        // when a fine pointer is present.
        els.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) {
                e.preventDefault();
                send(els.input.value);
            }
        });

        els.clearBtn.addEventListener('click', clearConversation);
        els.backBtn.addEventListener('click', clearConversation);

        // Cards need lessons.json, so nothing is drawn, and nothing can be sent, until it has
        // loaded or failed to.
        const lessonsLoaded = window.Lessons ? window.Lessons.load() : Promise.resolve(false);
        lessonsLoaded.then(() => {
            history = history.filter(isValidEntry);
            ready = true;
            els.sendBtn.disabled = false;
            renderAll();
        });
    }

    document.addEventListener('DOMContentLoaded', init);

    return { send: send, clear: clearConversation };
})();
```

This drops `renderSuggestions` and `els.suggestions` entirely.

- [ ] **Step 4: Update `chat.css`**

Directly after the `* { box-sizing: border-box; }` rule, add:

```css
/* The hidden attribute must win over the display rules below (.home, .messages and
   .card-actions all set display). */
[hidden] { display: none !important; }
```

Delete the three `.suggestions` rules (`.suggestions { … }`, `.suggestions button { … }`, `.suggestions button:hover { … }`).

Before the `@media (max-width: 600px)` block, add:

```css
/* ---- Home: grade chips, featured unit, lessons ---- */
.home {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 14px;
}
.home-greeting { margin: 0; font-size: 1.05rem; color: var(--text-secondary); }

.grade-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.grade-chip {
    --chip: var(--accent-primary);
    min-height: 44px; padding: 0 18px;
    border: 2px solid var(--chip); border-radius: var(--radius-full);
    background: transparent; color: var(--chip); -webkit-text-fill-color: currentColor;
    font: inherit; font-weight: 600; cursor: pointer;
}
.grade-chip[aria-pressed="true"] { background: var(--chip); color: var(--bg-main); }
.grade-chip.grade-1 { --chip: #f472b6; }
.grade-chip.grade-2 { --chip: #fb923c; }
.grade-chip.grade-3 { --chip: #facc15; }
.grade-chip.grade-4 { --chip: #4ade80; }
.grade-chip.grade-5 { --chip: #38bdf8; }

.featured {
    display: flex; flex-direction: column; gap: 8px;
    padding: 16px;
    background: linear-gradient(135deg, rgba(129, 140, 248, 0.22), rgba(74, 222, 128, 0.10));
    border: 1px solid rgba(129, 140, 248, 0.45);
    border-radius: var(--radius-md);
}
.featured-label { margin: 0; font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent-hover); }
.featured-title { margin: 0; font-size: 1.3rem; }
.featured-meta { margin: 0 0 4px; font-size: 0.85rem; color: var(--text-secondary); }
.featured-lesson {
    display: flex; align-items: center; gap: 12px;
    min-height: 48px; padding: 8px 12px;
    border: 0; border-radius: var(--radius-sm);
    background: rgba(26, 27, 46, 0.55); color: var(--text-primary); -webkit-text-fill-color: currentColor;
    font: inherit; text-align: left; cursor: pointer;
}
.featured-lesson:hover { background: rgba(26, 27, 46, 0.85); }
.featured-number {
    flex: 0 0 auto; display: grid; place-items: center;
    width: 28px; height: 28px; border-radius: 50%;
    background: var(--accent-primary); color: var(--bg-main); -webkit-text-fill-color: currentColor;
    font-size: 0.85rem; font-weight: 700;
}

.home-heading { margin: 6px 0 0; font-size: 0.95rem; font-weight: 600; color: var(--text-secondary); }
.lesson-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
.lesson-card {
    display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
    min-height: 64px; padding: 12px 14px;
    border: 1px solid rgba(255, 255, 255, 0.08); border-left: 4px solid var(--accent-primary);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary); color: var(--text-primary); -webkit-text-fill-color: currentColor;
    font: inherit; text-align: left; cursor: pointer;
}
.lesson-card:hover { border-color: var(--accent-primary); }
.lesson-tag { font-size: 0.75rem; color: var(--text-tertiary); }

/* ---- Lesson cards inside the conversation ---- */
.msg.card {
    width: 100%; max-width: min(560px, 92%);
    display: flex; flex-direction: column; gap: 10px;
    border: 1px solid rgba(129, 140, 248, 0.35);
}
.msg.card.solved { border-color: rgba(74, 222, 128, 0.6); }
.card-text { margin: 0; }
.card-label { margin: 0; font-size: 0.75rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--accent-hover); }
.card-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.card-btn {
    min-height: 44px; padding: 0 16px;
    border: 1px solid rgba(129, 140, 248, 0.5); border-radius: var(--radius-sm);
    background: var(--bg-elevated); color: var(--text-primary); -webkit-text-fill-color: currentColor;
    font: inherit; font-weight: 600; cursor: pointer;
}
.card-btn.primary {
    background: linear-gradient(135deg, var(--accent-primary), #6366f1);
    border-color: transparent; color: #fff; -webkit-text-fill-color: #fff;
}
.card-btn.highlight { border-color: #facc15; box-shadow: 0 0 0 2px rgba(250, 204, 21, 0.35); }
.card-btn:disabled { opacity: 0.5; cursor: default; }

.ghinho-list { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; }

.answer-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.answer-input {
    flex: 1 1 120px; min-width: 0; min-height: 44px; padding: 0 12px;
    border: 1px solid rgba(255, 255, 255, 0.15); border-radius: var(--radius-sm);
    background: var(--bg-main); color: var(--text-primary);
    font: inherit; font-size: 1.1rem;
}
.answer-input:focus { outline: none; border-color: var(--accent-primary); }
.answer-input:disabled { opacity: 0.8; }
.answer-unit { color: var(--text-secondary); }

.feedback { margin: 0; min-height: 1.4em; font-weight: 600; }
.feedback.correct { color: #4ade80; }
.feedback.not-simplest { color: #facc15; }
.feedback.wrong, .feedback.invalid { color: #fca5a5; }
.finish { margin: 0 0 8px; font-weight: 600; color: #4ade80; }
```

In the `@media (max-width: 600px)` block, add `.home { padding: 14px; }`.

- [ ] **Step 5: Offline suite**

Run: `python -m pytest -q`
Expected: all pass.

- [ ] **Step 6: Browser walkthrough (local)**

The static server is already running from Task 4. Set the viewport to 375×812 (`resize_window {preset: "mobile"}`). Then:

1. `javascript_tool`: `localStorage.clear(); location.reload()`.
2. `read_page`. Expected:
   - the "Chào em! Hôm nay em muốn học bài nào?" greeting;
   - chips Lớp 1–5, with Lớp 4 `aria-pressed="true"`;
   - a featured card "Phép nhân phân số" listing 4 lessons;
   - "Các bài khác" with 3 cards tagged "Hỏi cô".
   - The ↻ and ← buttons are hidden, and the send button is enabled.
3. Click "Nhân hai phân số". Expected: the intro text and both buttons, the ← button visible, and `localStorage.meritsChatHistory` holding one lesson card.
4. Click "Những kiến thức phải nhớ". Expected: a Ghi nhớ card with 5 bullets. `javascript_tool` `document.querySelectorAll('.ghinho-card mjx-container').length >= 3` after about 2 s.
5. Click "Cho em bài để luyện tập". Expected: "Bài 1/9" with a typeset question, and focus in the answer box.
6. Type `6/15` and press Enter. Expected: "Chưa đúng rồi, em thử lại nhé.", with "Cô gợi ý" carrying the `highlight` class.
7. Type `abc` and click Kiểm tra. Expected: "Em viết số hoặc phân số, ví dụ 3/4 nhé." and `attempts` still `["6/15"]`.
8. Type `16/30` and click Kiểm tra. Expected: "Giỏi quá! Em làm đúng rồi.", the input disabled, "Cô gợi ý" hidden, and "Bài tiếp theo" visible.
9. Reload. Expected: the same conversation. Problem 1 shows `16/30`, locked, with the success text.
10. Seed problem 6 (simplest):

    ```js
    const h = JSON.parse(localStorage.meritsChatHistory);
    h.push({ role: 'assistant', card: 'problem', lessonId: 'nhan-hai-phan-so', index: 5, attempts: [], solved: false });
    localStorage.meritsChatHistory = JSON.stringify(h);
    location.reload();
    ```

    Answer `20/40`. Expected: "Đúng rồi, nhưng em rút gọn được nữa đấy.", not locked. Then answer `1/2`. Expected: correct.
11. Seed the last problem the same way (`index: 8`, `attempts: ['5/9'], solved: true`) and reload. Expected: `m²` after the box, "Em đã làm hết 9 bài rồi. Giỏi quá!", and "Những kiến thức phải nhớ" plus "Chọn bài khác".
12. Seed an invalid card (`index: 99`) and reload. Expected: it is not drawn, and there are no console errors.
13. Take a screenshot of a problem card at 375 px.
14. On an unsolved problem, click "Cô gợi ý". Expected: a user bubble with the hint text and typeset maths, then "Gia sư đang bận…". The local server has no `/api/chat`, so this is correct locally.
15. Click ←. Expected: Home again, and `meritsChatHistory` is `[]`.
16. Click "Lớp 2". Expected: chip pressed, no featured card, heading "Các bài học lớp 2", and `localStorage.meritsGrade === "2"`. Click "Bảng nhân 2, 3, 4, 5". Expected: "Mình cùng tìm hiểu bài «Bảng nhân 2, 3, 4, 5» nhé. Em muốn hỏi cô điều gì?", no buttons, and focus in `#input`.
17. From Home, type "Phân số là gì?" and send. Expected: the view switches to the conversation with the user bubble (then the local error bubble).
18. Take a Home screenshot at 375 px. Check `document.documentElement.scrollWidth <= 375`.
19. `read_console_messages {onlyErrors: true}`. Expected: nothing from app code. The local `/api/chat` failure is expected.
20. Clean up: `localStorage.clear()`, then `resize_window {preset: "desktop"}`.

Fix anything that fails, rerun the affected steps, and only then commit.

- [ ] **Step 7: Commit**

```bash
git add js/chat.js index.html chat.css tests/test_chat_grounded.py
git commit -F msg.txt
```

Message:

```
feat(chat): home screen with lesson picker, Ghi nhớ and practice cards

The chat opens on a lesson picker (grade chips, the featured phép nhân phân số unit, lesson
cards). A lesson offers its key points and practice problems, checked on the device; "Cô gợi
ý" asks the tutor for a hint. Cards are stored as ids and sent to the tutor as text.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

### Task 6: Ingest, deploy, live verification

**Files:**
- Modify: `tests/test_retrieval_eval.py` (measured comments and ratchet), `docs/RAG-OPERATIONS.md` (counts)
- Memory: `project-status-vs-prd.md`

**Interfaces:**
- Consumes: everything above, plus the user's maths approval from Task 3 Step 7.
- Produces: the live site at `https://meritsofmath.pages.dev` with the new UI and content.

- [ ] **Step 1: USER CHECKPOINT — ask for the ingest OK**

Confirm the user approved the maths in Task 3 Step 7. Then ask: "OK to ingest the four new lessons into the production knowledge base now?" Wait for a clear yes.

- [ ] **Step 2: Ingest**

PowerShell, one invocation:

```powershell
$env:RAG_BASE_URL = "https://meritsofmath.pages.dev"; $env:INGEST_SECRET = [Environment]::GetEnvironmentVariable('INGEST_SECRET','User'); python -m scripts.rag.upload content/grade4/nhan-hai-phan-so.md content/grade4/tinh-chat-phep-nhan-phan-so.md content/grade4/tim-phan-so-cua-mot-so.md content/grade4/giai-toan-voi-phep-nhan-phan-so.md
```

Expected: one line per file ending "(pruned + confirmed applied)", then `TOTAL: <n> chunks`. Record `n`.

- [ ] **Step 3: Live retrieval eval**

```powershell
$env:RAG_BASE_URL = "https://meritsofmath.pages.dev"; $env:INGEST_SECRET = [Environment]::GetEnvironmentVariable('INGEST_SECRET','User'); python -m pytest tests/test_retrieval_eval.py -q -s
```

Expected:
- All 20 accented cases in the top 3, the two existing fraction cases included.
- The unaccented ratchet holds.
- Negatives below the ceiling.

Record the printed score table.

- If a **new** case misses: do not reword the query to make it pass. Report it, check whether the lesson text actually covers the question, and fix the lesson if it does not.
- If an **existing** case regresses: report which new lesson displaced it, with scores, before changing anything.

Then update `tests/test_retrieval_eval.py` to the measured numbers:
- the "MEASURED" comment block: vectors, number of cases, score ranges;
- the `MIN_UNACCENTED_TOP3` comment and value. The rule is one below the measured count; never lower it silently.

- [ ] **Step 4: Update the docs counts**

In `docs/RAG-OPERATIONS.md`:
- update the "Contents today" row to `<88+n> vectors from 20 Markdown lessons`;
- update the other `88` mentions that describe the current index (lines ~409, ~471–481) to the new count. The `/api/rag-status` `vectorCount` is the source; read it with `python -c` against `/api/rag-status` without printing headers.

- [ ] **Step 5: Commit and deploy**

```bash
git add tests/test_retrieval_eval.py docs/RAG-OPERATIONS.md
git commit -F msg.txt   # "test(rag): re-measure retrieval with the fraction-multiplication unit" + Co-Authored-By
git status --short      # must show only ?? .superpowers/
git fetch origin
git merge-base --is-ancestor origin/main HEAD && echo ancestor-ok
git push origin feat/socratic-chat
git checkout main
git merge --ff-only feat/socratic-chat
git push origin main
git checkout feat/socratic-chat
```

Poll until the deploy is live. PowerShell, with a browser User-Agent and a cache-busting query; decode `RawContentStream` as UTF-8:

```powershell
$ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
for ($i = 0; $i -lt 40; $i++) {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -UserAgent $ua -Uri ("https://meritsofmath.pages.dev/lessons.json?cb=" + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
        $text = [System.Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
        if ($text.Contains('giai-toan-voi-phep-nhan-phan-so')) { 'live'; break }
    } catch {}
    Start-Sleep -Seconds 15
}
```

Expected: `live`.

- [ ] **Step 6: Full live suite**

```powershell
$env:RAG_BASE_URL = "https://meritsofmath.pages.dev"; $env:INGEST_SECRET = [Environment]::GetEnvironmentVariable('INGEST_SECRET','User'); python -m pytest -q
```

Expected: everything passes, including:
- `test_reply_is_vietnamese_even_if_an_old_page_asks_for_english`;
- both `test_conversation_may_start_with_a_tutor_message` cases;
- `test_tutor_withholds_answers` and `test_tutor_asks_questions` with the new hint case, at 5 of 6 or better.

Only tests gated on `RAG_ALLOW_PROD_WRITES` skip. Report the exact counts.

- [ ] **Step 7: Live browser check**

On `https://meritsofmath.pages.dev/?cb=<ts>`, at 375 px:
1. Clear `meritsChatHistory` and `meritsGrade`, then reload. Expected: Home as in Task 5.
2. Open "Nhân hai phân số" → practice → answer `6/15` → click "Cô gợi ý". This sends one real message, which the spec requires.
3. Expected: a tutor reply in Vietnamese that asks a question and does not contain `8/15`.
4. Take a screenshot.
5. Clean up `meritsChatHistory` and `meritsGrade`, and reset the viewport.

- [ ] **Step 8: Update memory**

Update `project-status-vs-prd.md`: the lesson picker demo slice is live at `<commit>`. Deferred: Ghi nhớ and problems for the other 16 lessons, progress stars, phép chia phân số, and the other grades one at a time. Update `MEMORY.md`'s one-line hook if it changes.
