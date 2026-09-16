# Dark neubrutalism restyle, no highlights, maths keyboard

Date: 2026-09-16. Status: design approved by the user through mockups.

Three changes, built together:

1. Remove the "Chủ đề nổi bật" highlight so every grade looks the same.
2. Restyle the whole site in dark neubrutalism, following https://neubrutalism.com and the user's
   palette.
3. Add a maths keyboard for practice answers and the chat box.

## 1. No highlights

Only Lớp 4 had a featured unit, which the user found inconsistent. The user chose to remove
highlights rather than write a unit for every grade.

- `lessons.json`: the grade 4 `featured` block is deleted. No grade has one.
- The home screen shows, for the selected grade:
  - a heading "Các bài học lớp N";
  - one list of lesson cards.
- Order within that list:
  - lessons with Ghi nhớ and practice come first;
  - within each group, data order is kept.
- Each lesson card shows its title and one tag:
  - "Ghi nhớ · Luyện tập" (orange) when the lesson has practice;
  - "Hỏi cô" (blue) when it doesn't.
- `tests/test_lessons.py` drops the featured-unit test, and `js/lessons.js` drops the featured
  rendering.

## 2. Dark neubrutalism

### Tokens

These are the guide's own dark-theme tokens, measured on neubrutalism.com, plus deep tones the user
asked for so that white text stands out on filled controls.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#14131A` | page |
| `--surface` | `#1F1E28` | cards, bubbles, header, keypad |
| `--surface-2` | `#2B2A37` | inputs, neutral buttons, keys |
| `--ink` | `#F3F3F6` | every outline and hard shadow |
| `--text` | `#ECECED` | text on dark surfaces |
| `--border` | `3px solid var(--ink)` | components (`2px` for small tags) |
| `--radius` | `0` | everything |
| `--shadow-sm` / `--shadow` / `--shadow-lg` | `3px 3px 0 0` / `5px 5px 0 0` / `8px 8px 0 0` in `--ink` | chips and small controls / cards and buttons / focus and overlays |

Each palette colour has two tones:

- **Deep tones** are filled controls with white (`#FFFFFF`) text.
- **Bright tones** are the user's palette. They appear only as decoration, pressed-state shadows and
  focus rings, never behind text.

| Colour | Deep (fill + white text) | White text contrast | Bright (decoration) |
|---|---|---|---|
| yellow | `#8A6A00` | 5.07:1 | `#FFD23F` |
| coral | `#B83B3B` | 5.63:1 | `#FF6B6B` |
| blue | `#1F6AAF` | 5.62:1 | `#74B9FF` |
| green | `#2E7A45` | 5.27:1 | `#88D498` |
| orange | `#A85400` | 5.34:1 | `#FFA552` |
| lavender | `#6650C4` | 5.98:1 | `#B8A9FA` |
| cyan | `#1B7675` | 5.39:1 | `#7FDBDA` |

Readability rules:

- Normal text is at least 4.5:1 (WCAG AA). `--text` on `--surface` is 13.96:1 and on `--bg` is
  15.63:1.
- No grey text on light backgrounds anywhere.
- No `opacity` on text, and no low-contrast "muted" text.
- A test enforces the ratios (see Testing).

### Type

All four faces load from Google Fonts with the `vietnamese` subset, checked 2026-09-16. The current
Outfit has no Vietnamese subset.

| Role | Font | Use |
|---|---|---|
| display | Be Vietnam Pro 800 | greeting, big numbers, key labels |
| heading | Space Grotesk 700 | header title, card and section headings |
| body | Inter 400/600 | all running text, buttons |
| label | Space Mono 700, uppercase, 11–12px | tags such as "BÀI 1/9" |

The fallback is `system-ui, sans-serif`.

### Interaction grammar (from the guide)

- **Buttons and cards that act:**
  - hover lifts by `translate(-2px,-2px)` and the shadow grows by 2px;
  - active presses by `translate(3px,3px)` and removes the shadow.
- **Focus:** `:focus-visible` shows `outline: 3px solid #74B9FF; outline-offset: 3px`.
- **Grade chips** use the user-approved variant:
  - unselected: a 2px ink shadow, growing to 3px on hover;
  - selected: `translate(1px,1px)`, a 2px shadow in the chip's bright tone, and a trailing "✓",
    so the state never relies on colour alone.
- **Disabled controls:** they keep their colours, lose the shadow (a pressed look) and get
  `cursor: default`. There is no opacity fade.

### Colour by context

| Control | Colour |
|---|---|
| Lớp 1 / 2 / 3 / 4 / 5 | coral / orange / yellow / green / blue |
| Gửi (send) | yellow |
| Những kiến thức phải nhớ | blue |
| Cho em bài để luyện tập | orange |
| Kiểm tra | green |
| Cô gợi ý | lavender; after a wrong answer it gains a 3px bright-lavender shadow |
| Bài tiếp theo | cyan |
| Chọn bài khác, back ←, new conversation ↻ | neutral (`--surface-2`, ink outline) |
| Tag "Bài n/9" | orange |
| Tag "Ghi nhớ · …" | blue |
| Child's message bubble | blue |
| Error message bubble | coral |

### Screens

- **Header.** `--bg` background with a 3px ink bottom border. It holds:
  - a 40px "M" logo tile in yellow;
  - the title in Space Grotesk;
  - "Gia sư toán của em" as a Space Mono label.
  - The back and ↻ buttons are neutral square icon buttons.
- **Home.**
  - The greeting "Hôm nay em muốn học bài nào?" in display type.
  - The grade chips.
  - "Các bài học lớp N" and the lesson list from section 1.
- **Messages.**
  - Tutor bubbles: `--surface`, ink outline, 5px shadow.
  - Child bubbles: blue fill, white text, 3px shadow, aligned right.
  - Error bubble: coral fill, white text.
  - Typing indicator: a surface bubble with three square dots in bright yellow, coral and blue.
- **Tutor markdown.** Code and tables use `--bg` inner surfaces with 2px ink lines. MathJax inherits
  `currentColor`, so formulas are `--text` on dark and white on filled bubbles.
- **Lesson cards.** The existing cards, in surface style with coloured buttons and tags as above.
  Answer feedback is a filled block with white text:
  - correct: green;
  - "not in lowest terms": yellow;
  - wrong or invalid: coral.
  - A solved card's shadow turns bright green (`#88D498`).
- **Chat box.**
  - `--surface-2` textarea with an ink outline, and the blue focus outline.
  - Yellow send button.
  - The "123 ×÷" toggle (section 3) sits on its left.
- `index.html` `theme-color` and `manifest.webmanifest` `background_color`/`theme_color` become
  `#14131A`.

### Decorations ("interactive, lively")

- **Maths stickers on Home.**
  - Three bright squares with ½, × and ÷ sit in the free space beside the greeting, clear of
    buttons, with `aria-hidden="true"`.
  - They float gently (3–4s loop) and wiggle when tapped.
  - They don't take focus and don't cover any control.
- **Press physics** on every button and chip, per the grammar above.
- **Correct answer:** a burst of about 16 small bright squares from the answer box, lasting 0.9s.
- **Wrong answer:** the answer box shakes for 0.3s.
- `prefers-reduced-motion: reduce` turns off floating, wiggling, the confetti and the shake.
  Presses still move, without transition.

## 3. Maths keyboard

A new `js/mathpad.js` (`window.MathPad`) owns one keypad, docked at the bottom of the app's flex
column: a normal child of `<body>` below the chat box, not `position: fixed`.

- When the keypad opens, the content area above shrinks, just as it does for the phone keyboard
  since the keyboard fix.
- It is built with DOM methods.
- Keys are `<button type="button">` elements with Vietnamese `aria-label`s.
- Pressing a key never moves focus away from the field it types into: `pointerdown` calls
  `preventDefault`.
- Keys are at least 40px tall.
- Key colours:
  - digits: neutral;
  - operators: lavender;
  - fraction: cyan;
  - delete: coral;
  - Kiểm tra: green;
  - Gửi: yellow.

### Answer mode (practice answer boxes)

- **Layout** (4 columns):

  ```
  7 8 9 ⌫
  4 5 6 ▭/▭
  1 2 3 Kiểm tra
  0 0 0 Kiểm tra
  ```

  "0" spans 3 columns, "Kiểm tra" spans 2 rows, and "▭/▭" is the fraction key.
- **Opening and the phone keyboard.**
  - Focusing an answer input opens the keypad in answer mode and hides the chat box.
  - The input has `inputmode="none"`, so the phone keyboard stays closed.
  - The focused card scrolls into view above the keypad.
- **Keys.**
  - Digits add a digit, up to 6 digits on each side of the fraction.
  - The fraction key adds "/" only if the box is not empty and has no "/" yet.
  - ⌫ removes the character before the caret.
  - Kiểm tra submits the card's form, which runs the existing checker.
- **Physical keyboard.** Typing still works; input is filtered to digits and one "/", with the same
  rules.
- **Closing.** Blurring the input (tapping elsewhere) closes the keypad and shows the chat box again.
  A solved (locked) input doesn't open the keypad.

### Chat mode (chat box)

- **Layout** (6 columns):

  ```
  7 8 9 + − ⌫
  4 5 6 × : ▭/▭
  1 2 3 = ( )
  ABC ABC 0 , cách cách
  ```

  Division is ":", the sign Vietnamese primary schools use.
- **Toggle.** The "123 ×÷" button turns chat mode on:
  - the keypad opens;
  - the textarea gets `inputmode="none"` and keeps focus.
  - The toggle is `aria-pressed="true"` while on.
- **Inserting.**
  - Keys insert at the caret, replacing any selection: `setRangeText`, then an `input` event so
    the box auto-grows.
  - Operators are inserted with a space on each side: " + ", " − ", " × ", " : ", " = ".
  - "/", "(", ")", "," and digits are inserted without spaces; "cách" inserts one space.
  - ⌫ deletes one character, or the selection.
- **Switching back.** "ABC" turns chat mode off: the keypad closes, the `inputmode` attribute is
  removed and the textarea is focused, so the phone keyboard opens.
- **Sending** keeps the current mode.
- The child's message is plain text ("2/3 × 4/5") and is shown exactly as typed, as now.

### Interplay

- Only one mode is open at a time. Focusing an answer box while chat mode is on switches the keypad
  to answer mode; leaving the answer box returns to chat mode if the toggle is still pressed.
- If `js/mathpad.js` fails to load, answer boxes and the chat box behave as today (phone keyboard).
- `sw.js` precaches `./js/mathpad.js`.

## Testing

Offline (pytest):

- `tests/test_app_shell.py`:
  - every `APP_SHELL` file exists (already there; now covers `js/mathpad.js`);
  - a contrast test:
    - parses the colour tokens from `chat.css` `:root`;
    - asserts white on every deep tone is at least 4.5:1;
    - asserts `--text` on `--bg`, `--surface` and `--surface-2` is at least 4.5:1;
    - asserts `--ink` against `--bg` is at least 3:1.
- `tests/test_lessons.py`: no `featured` key in any grade.

Browser, on the static server at 375 × 812 and 375 × 420, with screenshots:

- **Home.** No featured card in any grade, practice lessons first with the right tags, chip states
  (selected: pressed, bright shadow, ✓), stickers wiggle on tap, `scrollWidth <= 375`.
- **Lesson flow.**
  - Buttons in their context colours.
  - Correct answer: the confetti element appears and the card gets the bright green shadow.
  - Wrong answer: the shake class is applied.
- **Answer keypad.**
  - Focusing opens answer mode, hides the chat box and sets `inputmode="none"`.
  - "/" rules; the 6-digit limit.
  - Kiểm tra checks the answer; blurring closes the keypad.
  - A solved input doesn't open it.
  - Physical typing is filtered.
- **Chat keypad.**
  - The toggle opens chat mode.
  - Insertion at the caret with the right spacing; ⌫.
  - "ABC" restores the phone keyboard (no `inputmode`); sending keeps the mode.
- **Everywhere.**
  - Computed contrast spot-checks on filled buttons.
  - `document.fonts.check('800 16px "Be Vietnam Pro"', 'ệừở')`.
  - Reduced motion turns off the animations.
  - No console errors.

Live, after deploy: the offline and live suites. The user checks on their phone that the keypad
replaces the phone keyboard in answer boxes and that the "123 ×÷" toggle works.

## Out of scope

- A highlight unit per grade.
- New lesson content.
- Progress stars.
- Rendering fractions stacked inside the child's own chat bubbles.
- A light theme.
