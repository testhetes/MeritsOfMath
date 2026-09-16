# Lesson picker, Ghi nhớ and practice — demo slice

Date: 2026-09-16. Status: design, awaiting review.

## Why

The app opens on one greeting bubble and three suggestion chips. A child who does not already
have a question has nothing to do. This change gives the home screen something to pick, and gives
each lesson two things a child asks a teacher for: "những kiến thức phải nhớ" (the key points) and
"cho em bài để luyện tập" (practice problems).

The demo runs on **phép nhân phân số** (fraction multiplication), so that unit gets full content
today. Everything else gets the new layout with the content it already has.

## Scope

In scope today (the demo slice):

1. Remove English mode everywhere.
2. Home screen, layout A: grade chips, a featured unit card and lesson cards, with the chat box
   below.
3. Lesson flow inside the chat: a lesson card with two buttons, a Ghi nhớ card, and practice
   problem cards that check answers on the device.
4. A new four-lesson unit on phép nhân phân số for Lớp 4: explanation, Ghi nhớ and 8–10 problems
   per lesson, ingested into the knowledge base.

Deferred, not in this slice:

- Ghi nhớ and problems for the other 16 lessons.
- Progress stars.
- Phép chia phân số (Bài 64) and more lessons for other grades, one grade at a time.
- A light theme.

## Curriculum placement (verified)

Phép nhân phân số is taught in **Lớp 4**. In the Kết nối tri thức textbook it is Chủ đề 12
"Phép nhân, phép chia phân số": Bài 63 Phép nhân phân số (including tính chất giao hoán, kết hợp,
nhân một tổng hai phân số với một phân số, and real-life problems), Bài 64 Phép chia phân số,
Bài 65 Tìm phân số của một số, Bài 66 Luyện tập chung. Checked against vietjack.com's chapter
index and lop4.com's lesson outline on 2026-09-16.

The featured unit follows that order:

| doc_id | Title | Covers |
|---|---|---|
| `nhan-hai-phan-so` | Nhân hai phân số | The rule; multiplying by a whole number (write it as n/1); simplifying the result; the common mistake of finding a common denominator first. |
| `tinh-chat-phep-nhan-phan-so` | Tính chất của phép nhân phân số | Giao hoán, kết hợp, nhân một tổng với một phân số, nhân với 1; computing the easy way. |
| `tim-phan-so-cua-mot-so` | Tìm phân số của một số | "Tìm 2/3 của 12" means 12 × 2/3; why it matches "chia 3 phần, lấy 2 phần". |
| `giai-toan-voi-phep-nhan-phan-so` | Giải toán có lời văn với phép nhân phân số | Reading a word problem: what is given, what is asked, which operation, the unit. Area of a rectangle with fraction sides, part of a quantity. |

Each file lives at `content/grade4/<doc_id>.md` in the existing format (`# Title`, intro,
`## sections`, `## Luyện tập`). The user checks the maths in every lesson before ingestion.

## 1. English removal

- `index.html`: remove the VI/EN toggle and every `data-i18n` / `data-i18n-ph` attribute. The
  Vietnamese text already in the markup stays.
- `js/i18n.js`: deleted. The handful of strings `js/chat.js` still needs (error, thinking, clear
  label) become a plain Vietnamese `TEXT` object in `js/chat.js`.
- `chat.css`: remove the `.lang-toggle` rules.
- `js/chat.js`: stop sending `lang`; add `meritsLang` to `RETIRED_KEYS`; remove the
  `langchange` listener.
- `functions/api/chat.js`: `buildSocraticPrompt(chunks)` is Vietnamese only, and the em/cô rule
  is unconditional. A `lang` sent by an old cached page is ignored.
- `tests/test_chat_grounded.py`: delete `test_grounded_reply_is_in_english_when_asked`; drop
  `lang` from the other payloads. `tests/test_tutor_behaviour.py`: drop `lang`.
- Docs that mention the toggle are updated.

## 2. Architecture

Three pieces, each with one job:

| File | Job |
|---|---|
| `lessons.json` (new, site root) | All lesson data: grades, lesson titles, the featured unit, Ghi nhớ bullets, problems and answers. Static, no AI. |
| `js/lessons.js` (new) | `window.Lessons`. Loads `lessons.json`; renders the home screen; renders lesson, Ghi nhớ and problem cards; checks answers. No network calls other than loading the JSON, and no knowledge of `/api/chat`. |
| `js/chat.js` (changed) | Owns the conversation: history, storage, sending, rendering text bubbles. Calls `Lessons` to render cards and to build the text the tutor sees for them. |

`lessons.json` is a static file rather than Markdown parsing in the browser because the answer
checker needs structured problems, and a Python test can validate structured data (see Testing).
The lesson `.md` files stay the knowledge base's source; `lessons.json` holds only titles and
the card content.

`sw.js`: cache bumped to `merits-v6` (a file is deleted); `APP_SHELL` drops `./js/i18n.js` and
adds `./js/lessons.js` and `./lessons.json`. Both are same-origin, so network-first applies and a
content fix reaches returning visitors on their next load.

If `lessons.json` cannot load (offline with no cache), the app falls back to today's behaviour:
the greeting bubble and the chat box.

## 3. Data model

### `lessons.json`

```json
{
  "defaultGrade": 4,
  "grades": [
    {
      "grade": 4,
      "featured": {
        "title": "Phép nhân phân số",
        "lessonIds": ["nhan-hai-phan-so", "tinh-chat-phep-nhan-phan-so",
                      "tim-phan-so-cua-mot-so", "giai-toan-voi-phep-nhan-phan-so"]
      },
      "lessons": [
        {
          "id": "nhan-hai-phan-so",
          "title": "Nhân hai phân số",
          "ghiNho": [
            "Muốn nhân hai phân số, ta lấy tử số nhân tử số, mẫu số nhân mẫu số.",
            "\\(\\frac{a}{b} \\times \\frac{c}{d} = \\frac{a \\times c}{b \\times d}\\)",
            "Rút gọn kết quả nếu có thể."
          ],
          "problems": [
            {
              "question": "Tính \\(\\frac{2}{3} \\times \\frac{4}{5}\\).",
              "expr": "2/3 * 4/5",
              "answer": "8/15",
              "simplest": false
            }
          ]
        },
        { "id": "cong-tru-phan-so", "title": "Cộng và trừ phân số" }
      ]
    }
  ]
}
```

- Every existing lesson appears under its grade with `id` and `title` only. `id` equals the
  content file's stem (the knowledge base's `doc_id`); `title` equals its `# ` heading.
- `ghiNho`: 3–5 bullets. Maths in `\( \)`.
- `problems`: 8–10 per lesson. Fields:
  - `question`: what the child reads. Maths in `\( \)`.
  - `expr`: the computation behind the answer, using integers, `+ - * /` and brackets only. It
    exists so a test can recompute every answer; it is never shown.
  - `answer`: the answer in lowest terms, as `"a/b"` or a whole number `"n"`.
  - `simplest`: `true` when the question asks the child to simplify ("rút gọn"); the child's
    answer must then be in lowest terms.
  - `unit` (optional): shown after the answer box, for example `"m²"`.

### Conversation history

`meritsChatHistory` keeps its current entries and gains card entries. Cards store ids, never
HTML or text, so a content fix in `lessons.json` shows up in saved conversations too:

| Entry | Shown as |
|---|---|
| `{ role, content }` | A text bubble, as today. |
| `{ role: "assistant", card: "lesson", lessonId }` | Tutor intro plus the lesson's buttons. |
| `{ role: "assistant", card: "ghiNho", lessonId }` | The Ghi nhớ card. |
| `{ role: "assistant", card: "problem", lessonId, index, attempts: [], solved }` | A problem card. `attempts` holds what the child submitted. |

On load, an entry is kept only if it is a valid text entry or a card whose lesson (and problem
index) exists in `lessons.json`. Anything else is dropped silently.

### What the tutor receives

The API still receives only `{ role, content }` text. `js/chat.js` converts cards before sending:

- lesson → assistant: `Hôm nay mình học bài «<title>» nhé.`
- ghiNho → assistant: `Ghi nhớ: <bullets joined>`
- problem → assistant: `Bài <n>: <question>`, then, if the child has answered, user:
  `Em trả lời: <latest attempt>`

Consecutive messages with the same role are merged into one, separated by a blank line, before
sending.

## 4. Screens and flow

### Home (layout A)

Shown when there is no conversation.

- Grade chips Lớp 1 to Lớp 5. The chosen grade is remembered in `meritsGrade`; the first visit
  opens Lớp 4 (`defaultGrade`).
- Featured unit card, only for a grade that has one: "Chủ đề nổi bật · Phép nhân phân số ·
  4 bài", with its lessons listed inside as tappable rows.
- Cards for the grade's other lessons. A lesson with content is tagged "Ghi nhớ · Luyện tập"; one
  without is tagged "Hỏi cô".
- The chat box stays at the bottom. Typing a question from Home starts a free conversation.
- The three suggestion chips are removed; the lesson cards replace them.

In a conversation, the header shows a back button in place of ↻. It returns to Home and ends
the conversation, exactly as ↻ does today. Reloading mid-conversation restores it.

### Lesson

Tapping a lesson starts a new conversation with a lesson card: "Hôm nay mình học bài «<title>»
nhé. Em muốn làm gì trước?" and two large buttons, **Những kiến thức phải nhớ** and **Cho em bài
để luyện tập**.

A lesson without content shows "Mình cùng tìm hiểu bài «<title>» nhé. Em muốn hỏi cô điều gì?"
with no buttons, and focuses the chat box. Nothing is sent to the AI until the child types.

- **Những kiến thức phải nhớ** appends the Ghi nhớ card. Under it: **Cho em bài để luyện tập**.
- **Cho em bài để luyện tập** appends problem 1.

### Problem card

"Bài 1/8", the question, an answer box (with `unit` after it if set), and **Kiểm tra** and
**Cô gợi ý**.

**Kiểm tra** checks on the device, with no AI call:

| Child types | Result |
|---|---|
| Equal to the answer (`6/8` for `3/4`, `3` or `6/2` for `3`), and `simplest` is false | Correct |
| Equal and in lowest terms, `simplest` true | Correct |
| Equal but not in lowest terms, `simplest` true | "Đúng rồi, nhưng em rút gọn được nữa đấy." Stays open. |
| Not equal | "Chưa đúng rồi, em thử lại nhé." **Cô gợi ý** is highlighted. |
| Not a whole number or `a/b` (including a zero denominator) | "Em viết số hoặc phân số, ví dụ 3/4 nhé." Not counted as an attempt. |

Spaces are ignored. Correct shows "Giỏi quá! Em làm đúng rồi.", locks the box and shows
**Bài tiếp theo**. After the last problem: "Em đã làm hết <n> bài rồi. Giỏi quá!" with
**Những kiến thức phải nhớ** and **Chọn bài khác** (back to Home).

**Cô gợi ý** sends a visible child message and asks the tutor:
`Cô gợi ý cho em bài «<lesson title>» với ạ: <question> Em làm ra <latest attempt>.` If there is
no attempt, the last sentence is `Em chưa biết bắt đầu từ đâu.` The lesson title is in the
message because retrieval searches the last two child messages. The server's existing rules
already forbid giving the result; no server change is needed for hints.

All card text goes through the same markdown, DOMPurify and MathJax pipeline as tutor replies.
Buttons and the answer box are built with DOM methods, not HTML strings.

### Look

Keep the dark palette; it matches the installed PWA's theme colour. Friendlier through:

- colour-coded grade chips;
- cards with a soft accent border;
- tap targets at least 44 px;
- a green success state on correct answers.

Must work at 375 px.

## 5. Content and knowledge base

- Write the four lessons (Markdown), their Ghi nhớ and their problems. The user checks the maths.
- Ingest the four files with `python -m scripts.rag.upload content/grade4/<file>.md`. This is a
  production write: ask the user for an explicit OK immediately before running it.
- Add retrieval eval cases for the four new lessons, then run the full live retrieval eval. The
  existing fraction cases (`cong-tru-phan-so`, `phan-so-va-cach-doc`) must still pass: new
  fraction content is the most likely thing to push them out of the top 3.

## 6. Testing

Offline (pytest, no network):

- `tests/test_lessons.py`:
  - `lessons.json` matches the schema above.
  - Ids are unique.
  - Every lesson has `content/grade<N>/<id>.md`, and every content file is listed exactly once
    under its grade.
  - Titles match the files' `# ` headings.
  - Featured ids exist in that grade.
  - Every `expr` evaluates, with `fractions.Fraction` and a restricted AST walker, to `answer`.
  - Every `answer` is in lowest terms.
  - Ghi nhớ has 3–5 bullets.
  - Lessons with problems have 8–10.
- A test that every `APP_SHELL` path in `sw.js` exists on disk, since this change adds and
  deletes shell files.

Browser, against a local static server (Node is not installed, so `python -m http.server` via
`.claude/launch.json`):

- `Lessons.checkAnswer` against a table of inputs covering every row of the checking table.
- Walk through Home → lesson → Ghi nhớ → problems → back, at 375 px, with screenshots.
- Reload mid-practice restores the cards.
- No console errors.

`/api/chat` does not run locally, so hints are checked on the live site.

Live, after deploy:

- The full live suite, with the English test removed.
- The retrieval eval with the new cases.
- One new tutor behaviour case: a hint request with a wrong attempt must not contain the answer.
- One real hint request on the site.

## 7. Delivery order

1. English removal.
2. `lessons.json` for the existing 16 lessons, plus `tests/test_lessons.py`.
3. The four fraction lessons: Markdown, Ghi nhớ and problems. User checks the maths.
4. Home screen, cards and answer checking.
5. Service worker, docs, local browser verification.
6. Deploy. Ingest the four lessons (with the user's OK). Run the live evals.
