# Content pass: practice for every grade, decimal answers, "Nâng cao · Nhóm nhân tử"

Date: 2026-09-17. Status: design approved by the user.

Second of the two passes the user ordered (the design pass is live at `ad8388b`).

## 1. Decimal answers

Lớp 5 lessons need decimal answers. The answer model grows from "whole number or a/b" to "whole
number, a/b, or a decimal".

- **`lessons.json` `answer`:** canonical forms are `"12"`, `"3/4"` and `"4,25"`.
  - Decimals use a Vietnamese comma.
  - No leading zeros except a single `0` before the comma.
  - No trailing zeros after it.
  - Fractions stay in lowest terms.
- **`expr`** may contain decimal literals written with a dot (`4.25 + 1.5`).
  - `tests/test_lessons.py` evaluates them exactly: each literal's source text goes through
    `Fraction(...)`, never through a float.
  - `ANSWER_RE` becomes `^(0|[1-9]\d*)(/[1-9]\d*|,\d*[1-9])?$`.
  - A fraction answer must be in lowest terms. A decimal answer must equal `expr` exactly.
- **`js/lessons.js` `parseAnswer`** accepts:
  - a whole number (up to 6 digits);
  - `a/b` (up to 6 digits each);
  - a decimal with `,` or `.` (up to 6 digits before the separator and 4 after).

  Spaces are ignored. It returns `{ num, den }`, with `den` a power of ten for decimals.
- **`checkAnswer`:**
  - It compares by cross-multiplying with `BigInt`, so large decimals stay exact.
  - Any equal value is correct: "4,250", "4.25" and "17/4" are all right for `4,25`.
  - `simplest` still only concerns fractions.
- **Keypad answer layout:**
  - Row 4 becomes `0` (2 columns), `,`, then "Kiểm tra" (spanning rows 3–4). The `,` key has
    `aria-label` "Dấu phẩy".
  - `PARTIAL_ANSWER` becomes `^(\d{1,6}(\/\d{0,6}|[.,]\d{0,4})?)?$`.
  - This applies to both the docked keypad and the desktop pop-up.

## 2. "Nâng cao" tab

### Data

A new top-level `extras` array in `lessons.json`, beside `grades`:

```json
"extras": [
  {
    "id": "nang-cao",
    "label": "Nâng cao",
    "title": "Nâng cao · Nhóm nhân tử",
    "note": "Dành cho học sinh lớp 4–5 thích thử thách.",
    "lessons": [ /* same lesson shape as grades, all with ghiNho + problems */ ]
  }
]
```

- The extra's content files live in `content/<extra id>/<lesson id>.md`, i.e.
  `content/nang-cao/`. Titles match their `# ` headings, as for grades.
- Lesson ids are unique across grades and extras.
- `js/lessons.js` indexes extras' lessons with the grades' lessons, so `find`, `isValidCard`,
  cards and hints work unchanged.

### Home

- After the five grade chips, one chip per extra: "Nâng cao ★".
  - It uses `btn grade-chip tone-lavender` with the same pressed state as grade chips.
  - `aria-pressed` follows the selection.
- `meritsGrade` stores `"nang-cao"` when the tab is selected. A stored value matching neither a
  grade nor an extra falls back to `defaultGrade`.
- When an extra is selected, Home shows:
  - its `title` as the section heading;
  - its `note` in a paragraph (`home-note`, Nunito 700);
  - its lessons as lesson cards, the same as a grade.

### The four lessons (Lớp 4–5 level, numbers only, no variables)

| id | title | teaches |
|---|---|---|
| `nhan-mot-so-voi-mot-tong` | Nhân một số với một tổng, một hiệu | a × (b + c) = a × b + a × c and a × (b − c) = a × b − a × c; using them to compute mentally (25 × 12 = 25 × 10 + 25 × 2). |
| `dat-thua-so-chung` | Đặt thừa số chung ra ngoài | a × b + a × c = a × (b + c) read the other way: 37 × 18 + 37 × 82 = 37 × 100; the same with a difference. |
| `thua-so-chung-an` | Tìm thừa số chung ẩn | A factor hidden as 1 (45 × 99 + 45 = 45 × 100), as a multiple (25 × 13 + 50 × 7 = 25 × 13 + 25 × 14), or spread over three or more terms (18 × 7 + 18 × 2 + 18 = 18 × 10). |
| `bai-toan-nhom-nhan-tu` | Bài toán có lời văn dùng nhóm nhân tử | Word problems where a common factor makes the calculation quick, such as buying the same item at the same price on two days, or equal rows in two groups. |

Each lesson has:

- a Markdown explanation in the existing format (`# Title`, intro, `## sections`,
  `## Luyện tập`);
- 3–5 Ghi nhớ bullets;
- 9 problems with whole-number answers.

Problems ask for the final value ("Tính nhanh: 37 × 18 + 37 × 82"). The grouping is what the
lesson, Ghi nhớ and tutor hints teach. Every `expr` is recomputed by the tests.

### Knowledge base

- **Upload:** the four Markdown files are uploaded with `python -m scripts.rag.upload`. This is a
  production write, so it needs the user's explicit OK at the time.
- **Retrieval eval:**
  - 4 new cases, one per lesson, each a paraphrase that passes the 5-gram confound guard;
  - the full live eval must still pass;
  - the measured numbers are recorded as in the previous pass.

## 3. Practice for the other 16 lessons

Each lesson gets 3–5 Ghi nhớ bullets, drawn from its own Markdown, and 9 problems. No Markdown
changes, so no knowledge-base upload.

Rules for problems, by lesson:

| Grade | Lesson | Answer kinds and constraints |
|---|---|---|
| 1 | Phép cộng / Phép trừ trong phạm vi 10 | whole numbers 0–10; short word problems about everyday objects |
| 1 | Các số đến 100 | whole numbers; comparisons ask for the number ("Trong hai số 47 và 74, số nào lớn hơn?"); tens and units ("Số gồm 6 chục và 3 đơn vị là số nào?") |
| 2 | Cộng / trừ có nhớ trong phạm vi 100 | whole numbers ≤ 100, every problem needs a carry or borrow |
| 2 | Bảng nhân 2, 3, 4, 5 | products and missing factors from those tables |
| 3 | Bảng nhân và chia 6, 7, 8, 9 | products, quotients and missing factors from those tables |
| 3 | Phép chia hết và chia có dư | quotient and remainder asked in separate problems; remainder always smaller than the divisor |
| 3 | Chu vi hình chữ nhật và hình vuông | whole numbers with a length unit (`cm`, `m`); also a side from a perimeter |
| 4 | Phân số và cách đọc phân số | fractions in lowest terms or whole numbers; comparisons ask for the larger or smaller fraction |
| 4 | Cộng và trừ phân số | fractions; same denominators, or one denominator a multiple of the other |
| 4 | Dấu hiệu chia hết cho 2, 3, 5, 9 | whole numbers ("Số lớn nhất có hai chữ số chia hết cho 9"; "Có bao nhiêu số …") |
| 5 | Số thập phân | decimals and whole numbers; comparisons ask for the larger or smaller number |
| 5 | Cộng, trừ, nhân, chia số thập phân | decimals; division only by whole numbers; ×/: by 10, 100, 1000 |
| 5 | Tỉ số phần trăm | percentages as a number with `unit: "%"`, and values of a percentage of a number |
| 5 | Diện tích và thể tích | whole numbers or decimals with `cm²`, `m²`, `cm³`, `m³` |

All questions follow the existing style:

- Vietnamese;
- maths inside `\( \)` with `\dfrac` for fractions;
- units in `unit`;
- `simplest: true` only when the question says "rút gọn".

## Testing

Offline:

- `tests/test_lessons.py`:
  - extras schema;
  - content files for extras;
  - unique ids across grades and extras;
  - decimal evaluation and the new `ANSWER_RE`;
  - every lesson in every grade and extra has Ghi nhớ and practice (the "has both or neither" rule
    becomes "has both");
  - `test_evaluate_is_exact_and_refuses_other_syntax` gains decimal cases (`4.25 + 1.5` =
    `Fraction(23, 4)`; `0.1 + 0.2` = `Fraction(3, 10)`).
- `tests/test_app_shell.py`: unchanged.

Browser (static server):

- **`checkAnswer` table** for decimals: "4,25", "4.25", "4,250", "17/4" correct for `4,25`;
  "4,2" wrong; "4,25,1", "4,", "," and "4,12345" invalid.
- **Keypad `,` key:** at most one separator; typing "4,25" with keys.
- **Nâng cao chip:**
  - selecting it shows the title, note and 4 lessons, and the selection survives a reload;
  - a lesson opens and its problem card checks an answer.
- **Grade chips:** one lesson per grade opens its Ghi nhớ and a problem.

Live, after deploy:

- the live suite;
- the retrieval eval with the 4 new cases;
- a check on the user's phone and desktop.

## User checkpoints

1. Maths and wording review of all new content: 16 lessons' Ghi nhớ and problems, and the 4
   Nâng cao lessons with explanations. This happens before anything is uploaded or deployed.
2. An explicit OK before uploading the Nâng cao explanations to the knowledge base.

## Out of scope

- More lessons per grade.
- Progress stars.
- Phép chia phân số.
- The deferred minors from the design pass (column alignment, caret jump, short landscape).
