# Design pass 2: tactile fonts, softer shadows, desktop layout, pop-up keypad

Date: 2026-09-17. Status: design approved by the user through mockups.

This is the first of two passes the user ordered. The second is a content pass: practice for every
grade and a "Nâng cao" tab with "Nhóm nhân tử". It is out of scope here and gets its own spec.

## 1. Fonts: Baloo 2 + Nunito

The user chose option C from the font mockups ("chunky and rounded, the most playful for
children") over Bricolage Grotesque and Unbounded + Lexend. Both faces have a `vietnamese` subset
(checked on Google Fonts, 2026-09-17).

| Role | Font | Where |
|---|---|---|
| display | Baloo 2 800 | greeting, logo letter, keypad digits, stickers |
| heading | Baloo 2 700 | header title, section headings, lesson card titles, finish line |
| body | Nunito 600 (700 for emphasis) | running text, bubbles, inputs |
| buttons and tags | Nunito 800 | all buttons; tags uppercase with 0.05em tracking |

Changes:

- Be Vietnam Pro, Space Grotesk, Inter and Space Mono are no longer loaded.
- The stylesheet link becomes `family=Baloo+2:wght@700;800&family=Nunito:wght@600;700;800`.
- Display type uses `line-height: 1.1`, because Baloo 2's tall metrics otherwise space lines far
  apart.

## 2. Softer shadows

The user found the pure near-white shadows tiring.

- **Colour:** all hard shadows use a new token `--shadow-color: #BDBCC8`, a light grey. Outlines stay
  `--ink` (#F3F3F6), so objects keep a crisp edge.
- **Home offsets:**

  | Element | Before | After |
  |---|---|---|
  | lesson card | 5px (hover 7px) | 4px (hover 6px) |
  | grade chip, unselected | 2px (hover 3px) | unchanged |
  | grade chip, selected | 2px, bright own colour | unchanged |

  Offsets elsewhere are unchanged: buttons 3px, bubbles and cards 5px, overlays 8px.

## 3. Desktop layout (`min-width: 900px`)

Phones keep today's layout. From 900px wide:

- **Header.**
  - Padding `16px 40px`.
  - Logo tile 52px.
  - Title `1.6rem`.
  - Icon buttons 52px.
- **Home.** Everything sits in a centred column, max-width 1060px.
  - **Hero band.**
    - Centred.
    - Padding `36px 0 24px`.
    - A dashed `3px` bottom border in `#3A3948` as a decorative divider.
    - The greeting in Baloo 2 800 at `3.2rem`.
    - Under it, a subtitle: "Chọn lớp của em, rồi chọn một bài để bắt đầu." (Nunito 700, `1.25rem`,
      desktop only).
  - **Stickers.**
    - Four 64px stickers (½ × ÷ =): two on the left and two on the right of the hero, slightly
      rotated.
    - They keep the float and wiggle.
    - Phones keep three stickers on the right; the fourth ("=") is hidden below 900px.
  - **Grade chips.**
    - The row is centred.
    - Chips are larger: `1.35rem`, padding `10px 24px`, min-height 52px.
  - **Section heading** `1.5rem`.
  - **Lesson grid.**
    - 3 equal columns with a 22px gap.
    - Cards have min-height 128px and padding `18px 20px`.
    - Titles are Baloo 2 700 at `1.6rem`, and the tag sits at the bottom
      (`justify-content: space-between`).
- **Conversation.**
  - Bubbles and cards sit in a centred 820px column: side padding
    `max(40px, calc((100% - 820px) / 2))`.
  - Body text is `1.1rem`.
  - Cards have max-width 640px.
- **Chat box.** It uses the same centred 820px column.

## 4. Maths keypad on desktop: pop-up

Which keypad a field gets depends on the pointer, not the width:

- **Coarse pointers (phones, tablets):** the docked keypad from the previous pass, unchanged.
- **Fine pointers:** `(hover: hover) and (pointer: fine)` gets a pop-up keypad.

### Answer boxes (fine pointer)

- **Physical keyboard.**
  - Focusing an answer box does **not** open anything.
  - `inputmode` is not set, and typing works as now, filtered to digits and one "/".
- **Keypad button.**
  - A square button (⌨, `aria-label="Mở bàn phím toán"`, lavender, 48px) sits right after the
    answer box.
  - It toggles a pop-up keypad with the answer layout (7 8 9 ⌫ / 4 5 6 ▭/▭ / 1 2 3 Kiểm tra / 0).
  - While open, it shows the pressed state: `translate(1px,1px)` and a 2px bright-lavender shadow.
- **The pop-up.**
  - It is a card: `--surface`, 3px ink outline, 8px `--shadow-color` shadow, 12px padding, 4-column
    grid of 52px keys.
  - It is anchored to the answer row (`position: absolute` inside the row) below the box, with a
    small caret pointing at the box.
  - It scrolls into view inside the conversation when it opens.
  - Keys type into the box and never take focus. If the box doesn't have focus, the first key press
    focuses it.
- **Closing.**
  - The pop-up closes on a pointer press outside it and its button, on Esc, or when the answer is
    right.
  - A wrong answer leaves it open, so the child can correct the answer.

### Chat box (fine pointer)

- "123 ×÷" toggles a pop-up with the chat layout (6 columns).
- It is anchored above the chat box's left edge (`position: absolute` inside the composer,
  `bottom: calc(100% + 12px)`).
- The phone-keyboard switch (`inputmode`) is not used, since a desktop has no on-screen keyboard.
- "ABC" closes the pop-up. So do Esc and a pointer press outside it and its toggle.
- Sending keeps it open, as on phones.
- The toggle's `aria-pressed` follows the open state.

### Shared

- Keys and layouts are the same objects as the docked keypad; one render function fills either
  container.
- Only one keypad is open at a time. Opening the answer pop-up closes the chat pop-up, and the other
  way round.
- `MathPad.reset()` (called by `renderAll`) closes any pop-up.
- The pop-up has `role="group"` and `aria-label="Bàn phím toán"`, like the docked keypad.

## Testing

Offline (pytest):

- `tests/test_app_shell.py`:
  - the font test asserts Baloo 2 and Nunito are loaded and the retired faces are not;
  - the contrast test is unchanged;
  - a check that `--shadow-color` exists in `:root` and differs from `--ink`.

Browser, on the static server:

- **Desktop (1280 × 800).**
  - Home: hero with 4 stickers, subtitle, centred chips, a 3-column grid of cards at least 128px
    tall. Computed fonts are Baloo 2 and Nunito, and `document.fonts.check` passes with Vietnamese
    glyphs.
  - Lesson: a centred column.
  - Answer pop-up, with real clicks:
    - focus opens nothing;
    - the ⌨ button opens the pop-up;
    - keys type into the box;
    - a wrong answer keeps it open;
    - Esc closes it; an outside press closes it;
    - a right answer closes it.
  - Chat pop-up: "123 ×÷" opens it above the chat box, keys type, and ABC closes it.
  - Screenshots.
- **Phone (375 × 600, touch emulation).**
  - The docked keypad still opens on focus.
  - No ⌨ button.
  - Fonts and shadows applied.
  - Screenshots.
- No console errors.

Live, after deploy: the offline suite and the live suite. The user checks on desktop and phone.

## Out of scope

- Practice content for other grades.
- The "Nâng cao" tab (content pass).
- M6 (caret jump on a rejected key).
- M10 (short landscape screens).
