# Dark Neubrutalism, No Highlights and Maths Keyboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every grade looks the same (no highlight unit), the whole site is restyled in the approved dark neubrutalism, and children get a maths keypad for practice answers and the chat box.

**Architecture:**
- `chat.css` is rewritten around design tokens: dark surfaces, near-white outlines and hard shadows, deep-tone fills with white text, and bright tones only for decoration.
- `js/lessons.js` gives each control a tone class by context and adds the decorations (stickers, confetti, shake).
- A new `js/mathpad.js` (`window.MathPad`) renders one keypad docked in the page's flex column. `js/lessons.js` attaches it to answer boxes and `js/chat.js` attaches it to the chat box.

**Tech Stack:** Vanilla JS and CSS, Google Fonts (Be Vietnam Pro, Space Grotesk, Inter, Space Mono), pytest for static checks, Browser pane for behaviour.

Spec: `docs/superpowers/specs/2026-09-16-neubrutalism-mathpad-design.md`.

## Global Constraints

**Tokens and contrast**
- Tokens, verbatim from the spec:
  - surfaces and text: `--bg #14131A`, `--surface #1F1E28`, `--surface-2 #2B2A37`, `--ink #F3F3F6`, `--text #ECECED`, `--on-fill #FFFFFF`;
  - deep tones: yellow `#8A6A00`, coral `#B83B3B`, blue `#1F6AAF`, green `#2E7A45`, orange `#A85400`, lavender `#6650C4`, cyan `#1B7675`;
  - bright tones: `#FFD23F`, `#FF6B6B`, `#74B9FF`, `#88D498`, `#FFA552`, `#B8A9FA`, `#7FDBDA`.
- Contrast minimums:
  - white text on every deep tone ≥ 4.5:1;
  - `--text` on `--bg`, `--surface` and `--surface-2` ≥ 4.5:1;
  - `--ink` on `--bg` ≥ 3:1.
- No text on bright tones except black symbols on decorative stickers. No `opacity` on text.

**Shape and motion**
- Borders are 3px (2px for tags). `border-radius: 0` everywhere. Shadows: `3px`/`5px`/`8px` hard offsets in `--ink`.
- Grade chips: 2px ink shadow; hover 3px. Selected: `translate(1px,1px)`, a 2px shadow in the chip's bright tone, and a trailing "✓".
- Buttons: hover `translate(-2px,-2px)` with a bigger shadow. Active `translate(3px,3px)` with no shadow. Focus-visible: `outline: 3px solid #74B9FF; outline-offset: 3px`.
- `prefers-reduced-motion: reduce` turns off floating, wiggling, confetti, shake and transitions.

**Fonts**
- Be Vietnam Pro 800 (display), Space Grotesk 700 (heading), Inter 400/600 (body), Space Mono 700 (labels).
- Outfit is removed: it has no Vietnamese subset.

**Maths keypad**
- Keys never take focus: `pointerdown` calls `preventDefault`.
- Answers accept digits and one "/", at most 6 digits a side, never a leading "/".
- Chat operators insert with a space on each side: " + ", " − ", " × ", " : ", " = ". Division is ":".

**Project rules**
- No JS runtime on this machine. Verify JavaScript in the Browser pane (`static` server, `http://localhost:8000/`).
- Commit with explicit paths only, ending with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Deploy by fast-forwarding `main` after `git merge-base --is-ancestor origin/main HEAD`.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `lessons.json` | modify | drop the grade 4 `featured` block |
| `tests/test_lessons.py` | modify | no grade has `featured` |
| `js/lessons.js` | modify | home list without highlights; tone classes; stickers, confetti, shake; attach answer boxes to MathPad |
| `chat.css` | rewrite | tokens and every component in dark neubrutalism, keypad styles |
| `index.html` | modify | fonts, theme colour, header logo, button classes, keypad toggle and container, script tag |
| `manifest.webmanifest` | modify | colours `#14131A` |
| `js/mathpad.js` | create | `window.MathPad`: keypad rendering, answer and chat modes |
| `js/chat.js` | modify | initialise MathPad for the chat box |
| `sw.js` | modify | precache `./js/mathpad.js` |
| `tests/test_app_shell.py` | modify | contrast tokens, fonts, keypad markup |

---

### Task 1: Remove the highlight unit

**Files:**
- Modify: `lessons.json` (grade 4 block), `js/lessons.js` (`renderHome`), `tests/test_lessons.py`

**Interfaces:**
- Consumes: `hasPractice(lesson)`, `find(id)`, `currentGrade()`, `saveGrade()`, `el()`, `button()` in `js/lessons.js`.
- Produces: `practiceFirst(lessons: Lesson[]): Lesson[]` in `js/lessons.js`. It lists lessons with practice first and keeps data order within each group.

- [ ] **Step 1: Write the failing test**

In `tests/test_lessons.py`, replace `test_featured_units_point_at_practice_lessons_in_their_grade` with:

```python
def test_no_grade_has_a_highlight_unit():
    """Only Lớp 4 had a "Chủ đề nổi bật" unit, which the user found inconsistent (2026-09-16).
    Every grade shows one plain lesson list instead."""
    for grade in DATA["grades"]:
        assert "featured" not in grade, f"grade {grade['grade']} still has a featured unit"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python -m pytest tests/test_lessons.py -q`
Expected: 1 failed (`test_no_grade_has_a_highlight_unit`, "grade 4 still has a featured unit").

- [ ] **Step 3: Remove the data and the rendering**

In `lessons.json`, delete these lines from the grade 4 block:

```json
      "featured": {
        "title": "Phép nhân phân số",
        "lessonIds": ["nhan-hai-phan-so", "tinh-chat-phep-nhan-phan-so", "tim-phan-so-cua-mot-so", "giai-toan-voi-phep-nhan-phan-so"]
      },
```

In `js/lessons.js`, replace everything in `renderHome` from `const featuredIds = grade.featured ? grade.featured.lessonIds : [];` to the end of the function with:

```js
        container.appendChild(el('h2', 'home-heading', 'Các bài học lớp ' + grade.grade));
        const list = el('div', 'lesson-list');
        practiceFirst(grade.lessons).forEach((lesson) => {
            const card = button(undefined, 'lesson-card', () => onPick(lesson.id));
            card.appendChild(el('span', 'lesson-title', lesson.title));
            card.appendChild(el('span', 'lesson-tag', hasPractice(lesson) ? 'Ghi nhớ · Luyện tập' : 'Hỏi cô'));
            list.appendChild(card);
        });
        container.appendChild(list);
    }

    // Lessons with Ghi nhớ and practice come first; within each group, lessons.json's order.
    function practiceFirst(lessons) {
        return lessons.filter(hasPractice).concat(lessons.filter((lesson) => !hasPractice(lesson)));
    }
```

- [ ] **Step 4: Run the offline suite**

Run: `python -m pytest -q`
Expected: all pass.

- [ ] **Step 5: Browser check**

Reload `http://localhost:8000/?cb=1` with `localStorage` cleared, then run:

```js
[...document.querySelectorAll('.grade-chip')].map((chip) => { chip.click(); return { grade: chip.textContent, featured: !!document.querySelector('.featured'), heading: document.querySelector('.home-heading').textContent, lessons: [...document.querySelectorAll('.lesson-card')].map((c) => c.innerText.replace(/\n/g, ' | ')) }; })
```

Expected:
- `featured: false` for every grade.
- Every heading reads "Các bài học lớp N".
- Lớp 4 lists the four fraction-multiplication lessons first, tagged "Ghi nhớ · Luyện tập", then the three "Hỏi cô" lessons.

- [ ] **Step 6: Commit**

```bash
git add lessons.json js/lessons.js tests/test_lessons.py
git commit -F msg.txt   # "feat(home): remove the highlight unit so every grade looks the same" + Co-Authored-By
```

---

### Task 2: Dark neubrutalism theme

**Files:**
- Rewrite: `chat.css`
- Modify: `index.html` (head and header markup), `manifest.webmanifest`, `js/lessons.js` (class names, stickers, confetti, shake)
- Test: `tests/test_app_shell.py`

**Interfaces:**
- Consumes: `practiceFirst` (Task 1).
- Produces:
  - CSS classes `btn`, `tone-{yellow|coral|blue|green|orange|lavender|cyan|neutral}`, `tag`, `key`, `word`;
  - custom properties `--fill` and `--bright`, set by tone classes;
  - `js/lessons.js` helpers `reducedMotion(): boolean` and `replayAnimation(node, className)`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_app_shell.py`:

```python
DEEP_TONES = ("yellow", "coral", "blue", "green", "orange", "lavender", "cyan")


def _root_colours():
    css = (ROOT / "chat.css").read_text(encoding="utf-8")
    block = re.search(r":root\s*\{(.*?)\}", css, re.S)
    assert block, ":root block not found in chat.css"
    return dict(re.findall(r"--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})\s*;", block.group(1)))


def _luminance(hex_colour):
    channels = [int(hex_colour[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]


def _contrast(a, b):
    high, low = sorted((_luminance(a), _luminance(b)), reverse=True)
    return (high + 0.05) / (low + 0.05)


def test_colour_tokens_meet_contrast_minimums():
    """The user asked for a dark theme that is easy on the eyes, with white text that stands out
    on filled controls (2026-09-16). WCAG AA: 4.5:1 for text, 3:1 for outlines."""
    colours = _root_colours()
    for tone in DEEP_TONES:
        ratio = _contrast(colours["on-fill"], colours[tone])
        assert ratio >= 4.5, f"white on --{tone} is {ratio:.2f}:1"
        assert f"{tone}-bright" in colours, f"--{tone}-bright is missing"
    for surface in ("bg", "surface", "surface-2"):
        ratio = _contrast(colours["text"], colours[surface])
        assert ratio >= 4.5, f"--text on --{surface} is {ratio:.2f}:1"
    assert _contrast(colours["placeholder"], colours["surface-2"]) >= 4.5
    assert _contrast(colours["ink"], colours["bg"]) >= 3


def test_fonts_support_vietnamese():
    """Outfit has no Vietnamese subset, so diacritics fell back to another font."""
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    assert "Outfit" not in html
    for family in ("Be+Vietnam+Pro", "Space+Grotesk", "Inter", "Space+Mono"):
        assert family in html, f"{family} is not loaded"
```

- [ ] **Step 2: Run them to verify they fail**

Run: `python -m pytest tests/test_app_shell.py -q`
Expected: 2 failed (`KeyError: 'on-fill'`; "Outfit" found), 3 passed.

- [ ] **Step 3: Rewrite `chat.css`**

Replace the whole file with:

```css
/* Dark neubrutalism, after https://neubrutalism.com (its dark-theme tokens) and the user's palette.
   Every palette colour has a DEEP tone for filled controls, which carry white text, and a BRIGHT
   tone for decoration, pressed-state shadows and focus only; bright tones never sit behind text.
   tests/test_app_shell.py checks the contrast of these tokens. */
:root {
    --bg: #14131A;
    --surface: #1F1E28;
    --surface-2: #2B2A37;
    --ink: #F3F3F6;
    --text: #ECECED;
    --placeholder: #BDBDC7;
    --on-fill: #FFFFFF;

    --yellow: #8A6A00;      --yellow-bright: #FFD23F;
    --coral: #B83B3B;       --coral-bright: #FF6B6B;
    --blue: #1F6AAF;        --blue-bright: #74B9FF;
    --green: #2E7A45;       --green-bright: #88D498;
    --orange: #A85400;      --orange-bright: #FFA552;
    --lavender: #6650C4;    --lavender-bright: #B8A9FA;
    --cyan: #1B7675;        --cyan-bright: #7FDBDA;

    --shadow-sm: 3px 3px 0 0 var(--ink);
    --shadow: 5px 5px 0 0 var(--ink);
    --shadow-lg: 8px 8px 0 0 var(--ink);

    --font-display: 'Be Vietnam Pro', system-ui, sans-serif;
    --font-heading: 'Space Grotesk', system-ui, sans-serif;
    --font-body: 'Inter', system-ui, sans-serif;
    --font-label: 'Space Mono', ui-monospace, monospace;
}

* { box-sizing: border-box; }

/* The hidden attribute must win over the display rules below (.home, .messages, .mathpad and
   .card-actions all set display). */
[hidden] { display: none !important; }

body {
    margin: 0;
    font-family: var(--font-body);
    background: var(--bg);
    color: var(--text);
    /* The phone keyboard: see fitToVisibleViewport in js/chat.js. */
    height: var(--app-height, 100dvh);
    display: flex;
    flex-direction: column;
}

:focus-visible { outline: 3px solid var(--blue-bright); outline-offset: 3px; }

/* ---- Tones: a deep fill for text, a bright twin for pressed shadows ---- */
.tone-yellow   { --fill: var(--yellow);   --bright: var(--yellow-bright); }
.tone-coral    { --fill: var(--coral);    --bright: var(--coral-bright); }
.tone-blue     { --fill: var(--blue);     --bright: var(--blue-bright); }
.tone-green    { --fill: var(--green);    --bright: var(--green-bright); }
.tone-orange   { --fill: var(--orange);   --bright: var(--orange-bright); }
.tone-lavender { --fill: var(--lavender); --bright: var(--lavender-bright); }
.tone-cyan     { --fill: var(--cyan);     --bright: var(--cyan-bright); }
.tone-neutral  { --fill: var(--surface-2); --bright: var(--ink); }

/* ---- Buttons: border + flat fill + hard shadow; lift on hover, press on tap ---- */
.btn {
    border: 3px solid var(--ink);
    border-radius: 0;
    background: var(--fill, var(--surface-2));
    color: var(--on-fill);
    -webkit-text-fill-color: currentColor;
    box-shadow: var(--shadow-sm);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    transition: transform 0.1s ease, box-shadow 0.1s ease;
}
.btn:hover { transform: translate(-2px, -2px); box-shadow: var(--shadow); }
.btn:active { transform: translate(3px, 3px); box-shadow: none; }
.btn:disabled { transform: none; box-shadow: none; cursor: default; }

.tag {
    display: inline-block;
    align-self: flex-start;
    background: var(--fill);
    color: var(--on-fill);
    border: 2px solid var(--ink);
    padding: 2px 7px;
    font-family: var(--font-label);
    font-weight: 700;
    font-size: 0.72rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
}

/* ---- Header ---- */
.chat-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: var(--bg);
    border-bottom: 3px solid var(--ink);
    flex: 0 0 auto;
}
.logo {
    flex: 0 0 auto;
    width: 40px;
    height: 40px;
    display: grid;
    place-items: center;
    background: var(--yellow);
    color: var(--on-fill);
    border: 3px solid var(--ink);
    box-shadow: var(--shadow-sm);
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 1.3rem;
}
.chat-header h1 { margin: 0; font-family: var(--font-heading); font-weight: 700; font-size: 1.1rem; }
.chat-header .sub { margin: 0; font-family: var(--font-label); font-weight: 700; font-size: 0.7rem; letter-spacing: 0.05em; text-transform: uppercase; }
.chat-header .spacer { flex: 1; }
.icon-btn { width: 40px; height: 40px; padding: 0; font-size: 1.1rem; }

/* ---- Home ---- */
.home {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 18px 16px 24px;
    display: flex;
    flex-direction: column;
    gap: 18px;
}
.home-top { position: relative; padding-right: 116px; min-height: 108px; }
.home-greeting {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 1.55rem;
    line-height: 1.2;
    letter-spacing: -0.02em;
}
.stickers { position: absolute; top: 0; right: 0; width: 110px; height: 108px; }
.sticker {
    position: absolute;
    width: 42px;
    height: 42px;
    display: grid;
    place-items: center;
    border: 3px solid var(--ink);
    box-shadow: var(--shadow-sm);
    color: #000;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 1.3rem;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    animation: float 3.4s ease-in-out infinite;
}
.sticker:nth-child(1) { top: 2px; right: 10px; background: var(--yellow-bright); }
.sticker:nth-child(2) { top: 40px; right: 62px; background: var(--coral-bright); animation-delay: -1.1s; }
.sticker:nth-child(3) { top: 62px; right: 4px; background: var(--cyan-bright); animation-delay: -2.2s; }
.sticker.wiggle { animation: wiggle 0.45s ease-in-out 2; }
@keyframes float { 0%, 100% { transform: translateY(0) rotate(-8deg); } 50% { transform: translateY(-6px) rotate(6deg); } }
@keyframes wiggle { 0%, 100% { transform: rotate(0) scale(1); } 30% { transform: rotate(-18deg) scale(1.15); } 70% { transform: rotate(18deg) scale(1.15); } }

.grade-chips { display: flex; flex-wrap: wrap; gap: 10px; }
.grade-chip { min-height: 44px; padding: 0 16px; font-size: 0.95rem; box-shadow: 2px 2px 0 0 var(--ink); }
.grade-chip:hover { transform: translate(-1px, -1px); box-shadow: 3px 3px 0 0 var(--ink); }
.grade-chip[aria-pressed="true"] { transform: translate(1px, 1px); box-shadow: 2px 2px 0 0 var(--bright); }
.grade-chip[aria-pressed="true"]::after { content: ' ✓'; }
.grade-chip:active { transform: translate(2px, 2px); box-shadow: none; }

.home-heading { margin: 0; font-family: var(--font-heading); font-weight: 700; font-size: 1.05rem; }
.lesson-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; }
.lesson-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    min-height: 72px;
    padding: 12px 14px;
    text-align: left;
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow);
}
.lesson-card:hover { box-shadow: 7px 7px 0 0 var(--ink); }
.lesson-title { font-size: 1rem; }

/* ---- Messages ---- */
.messages {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 18px 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    -webkit-overflow-scrolling: touch;
    /* Makes this scroll area the containing block for any position:fixed descendant. MathJax
       builds formula markup after the chat HTML is sanitised, and one route did let a replayed
       formula carry position:fixed over the whole page (measured 2026-09-14). If any such route
       ever reappears, the overlay stays trapped inside the message list instead of covering the
       header's clear button and the composer, so a child cannot be locked out of the app. */
    contain: paint;
}

/* Long unbroken text wraps inside the bubble, and content that cannot wrap scrolls sideways inside
   its own bubble instead of pushing the whole message list sideways. Measured at 375px on
   2026-09-15, in bubbles 305px wide: a 60-digit number needed 502px, a long URL 779px, a long
   inline formula 852px (MathJax 3 does not line-break) and a long code line 667px. The widest
   stretched .messages to 866px.
   break-word, not anywhere: `anywhere` also shrinks table cells' minimum width, so a wide table
   was squeezed to fit instead of scrolling. It split place-value headers mid-word and 9-digit
   numbers such as 342157896 across two lines, which a child reads as two numbers. With
   break-word a table keeps whole words and scrolls inside its bubble. break-word also works on
   Safari before 15.4, which ignores `anywhere`.
   flex-shrink: 0 is required alongside overflow-x. .messages is a flex column, and a scroll
   container's automatic minimum height is 0, so without it a conversation taller than the screen
   squashed every bubble (a one-line bubble to 28px of 46px) and gave each its own vertical
   scrollbar instead of scrolling the list. Measured on the live site, 2026-09-15. */
.msg { max-width: 82%; padding: 12px 14px; border: 3px solid var(--ink); line-height: 1.55; font-size: 0.98rem; overflow-wrap: break-word; overflow-x: auto; flex-shrink: 0; }
.msg p { margin: 0 0 8px; }
.msg p:last-child { margin-bottom: 0; }
.msg.ai { background: var(--surface); box-shadow: var(--shadow); align-self: flex-start; }
/* The child's own message is plain text (see appendBubble in js/chat.js); pre-wrap keeps the line
   breaks they typed with Shift+Enter. */
.msg.user { background: var(--blue); color: var(--on-fill); box-shadow: var(--shadow-sm); align-self: flex-end; white-space: pre-wrap; }
.msg.error { background: var(--coral); color: var(--on-fill); box-shadow: var(--shadow-sm); align-self: flex-start; }
.msg code { font-family: var(--font-label); background: var(--bg); border: 2px solid var(--ink); padding: 0 4px; }
.msg pre { background: var(--bg); border: 2px solid var(--ink); padding: 8px 10px; overflow-x: auto; }
.msg pre code { border: 0; padding: 0; }
.msg table { border-collapse: collapse; }
.msg th, .msg td { border: 2px solid var(--ink); padding: 4px 8px; }
.msg blockquote { margin: 0; padding-left: 10px; border-left: 3px solid var(--lavender-bright); }

.typing { display: flex; gap: 6px; align-self: flex-start; padding: 14px 16px; background: var(--surface); border: 3px solid var(--ink); box-shadow: var(--shadow-sm); }
.typing span { width: 9px; height: 9px; animation: bob 1.1s ease-in-out infinite; }
.typing span:nth-child(1) { background: var(--yellow-bright); }
.typing span:nth-child(2) { background: var(--coral-bright); animation-delay: 0.15s; }
.typing span:nth-child(3) { background: var(--blue-bright); animation-delay: 0.3s; }
@keyframes bob { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-5px); } }

/* ---- Composer ---- */
.composer {
    flex: 0 0 auto;
    display: flex;
    gap: 10px;
    align-items: stretch;
    padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
    background: var(--bg);
    border-top: 3px solid var(--ink);
}
.composer textarea {
    flex: 1;
    min-width: 0;
    resize: none;
    max-height: 120px;
    background: var(--surface-2);
    color: var(--text);
    border: 3px solid var(--ink);
    border-radius: 0;
    padding: 10px 12px;
    font: inherit;
    font-size: 1rem;
    line-height: 1.4;
}
.composer textarea::placeholder { color: var(--placeholder); opacity: 1; }
.composer textarea:focus { outline: 3px solid var(--blue-bright); outline-offset: 2px; }
.send-btn { padding: 0 18px; }

/* ---- Lesson cards inside the conversation ---- */
/* Cards are not clipped like text bubbles: the confetti flies outside them. */
.msg.card { width: 100%; max-width: min(560px, 92%); display: flex; flex-direction: column; gap: 12px; position: relative; overflow: visible; }
.msg.card.solved { box-shadow: 5px 5px 0 0 var(--green-bright); }
.card-text { margin: 0; }
.card-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.card-btn { min-height: 44px; padding: 0 14px; }
.card-btn.highlight { box-shadow: 3px 3px 0 0 var(--lavender-bright); }

.ghinho-list { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 8px; }
.ghinho-list li::marker { color: var(--yellow-bright); }

.answer-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.answer-input {
    flex: 1 1 120px;
    min-width: 0;
    min-height: 48px;
    padding: 0 12px;
    background: var(--surface-2);
    color: var(--text);
    -webkit-text-fill-color: var(--text);
    border: 3px solid var(--ink);
    border-radius: 0;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 1.25rem;
}
.answer-input:focus { outline: 3px solid var(--blue-bright); outline-offset: 2px; }
.answer-input:disabled { opacity: 1; }
.answer-unit { font-weight: 600; }
.answer-input.shake { animation: shake 0.3s ease-in-out; }
@keyframes shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-6px); } 75% { transform: translateX(6px); } }

.feedback { margin: 0; align-self: flex-start; border: 3px solid var(--ink); padding: 6px 10px; color: var(--on-fill); font-weight: 600; }
.feedback:empty { display: none; }
.feedback.correct { background: var(--green); }
.feedback.not-simplest { background: var(--yellow); }
.feedback.wrong, .feedback.invalid { background: var(--coral); }
.finish { margin: 0 0 8px; font-family: var(--font-heading); font-weight: 700; }

.confetti-bit { position: absolute; width: 10px; height: 10px; border: 2px solid var(--ink); pointer-events: none; animation: burst 0.9s ease-out forwards; }
.confetti-bit.c0 { background: var(--yellow-bright); }
.confetti-bit.c1 { background: var(--coral-bright); }
.confetti-bit.c2 { background: var(--blue-bright); }
.confetti-bit.c3 { background: var(--green-bright); }
.confetti-bit.c4 { background: var(--orange-bright); }
.confetti-bit.c5 { background: var(--lavender-bright); }
.confetti-bit.c6 { background: var(--cyan-bright); }
@keyframes burst { to { transform: translate(var(--dx), var(--dy)) rotate(260deg); opacity: 0; } }

@media (max-width: 600px) {
    .msg { max-width: 90%; }
    .messages { padding: 14px 12px; }
    .home { padding: 14px 12px 20px; }
}

@media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation: none !important; transition: none !important; }
}
```

- [ ] **Step 4: Update `index.html` and the manifest**

In `index.html`:

- `<meta name="theme-color" content="#1a1b2e">` → `<meta name="theme-color" content="#14131A">`
- Replace the Outfit stylesheet link with:

  ```html
      <link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@800&family=Inter:wght@400;600&family=Space+Grotesk:wght@700&family=Space+Mono:wght@700&display=swap" rel="stylesheet">
  ```

- Replace the `<header>` block with:

  ```html
      <header class="chat-header">
          <button type="button" class="btn tone-neutral icon-btn" id="back-btn" title="Về trang chủ" aria-label="Về trang chủ" hidden>&#8592;</button>
          <div class="logo" aria-hidden="true">M</div>
          <div>
              <h1>Merits of Math</h1>
              <p class="sub">Gia sư toán của em</p>
          </div>
          <div class="spacer"></div>
          <button type="button" class="btn tone-neutral icon-btn" id="clear-btn" title="Cuộc trò chuyện mới" aria-label="Cuộc trò chuyện mới" hidden>&#8635;</button>
      </header>
  ```

- `<button type="submit" id="send-btn" disabled>Gửi</button>` → `<button type="submit" class="btn tone-yellow send-btn" id="send-btn" disabled>Gửi</button>`

In `manifest.webmanifest`: `"background_color": "#14131A"` and `"theme_color": "#14131A"`.

- [ ] **Step 5: Give `js/lessons.js` its tone classes and decorations**

Add these helpers after the `button` function:

```js
    function reducedMotion() {
        return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    // Restarts a one-off animation class (a sticker's wiggle, the answer box's shake).
    function replayAnimation(node, className) {
        if (reducedMotion()) return;
        node.classList.remove(className);
        void node.offsetWidth;   // reflow, so re-adding the class starts the animation again
        node.classList.add(className);
    }

    // A burst of small bright squares from the answer box when an answer is right.
    function celebrate(card, from) {
        if (reducedMotion()) return;
        const originX = from.offsetLeft + from.offsetWidth / 2;
        const originY = from.offsetTop + from.offsetHeight / 2;
        for (let i = 0; i < 16; i++) {
            const bit = el('span', 'confetti-bit c' + (i % 7));
            const angle = (Math.PI * 2 * i) / 16 + Math.random() * 0.4;
            const distance = 50 + Math.random() * 60;
            bit.style.left = originX + 'px';
            bit.style.top = originY + 'px';
            bit.style.setProperty('--dx', Math.round(Math.cos(angle) * distance) + 'px');
            bit.style.setProperty('--dy', Math.round(Math.sin(angle) * distance) + 'px');
            card.appendChild(bit);
            setTimeout(() => bit.remove(), 950);
        }
    }

    const GRADE_TONES = { 1: 'coral', 2: 'orange', 3: 'yellow', 4: 'green', 5: 'blue' };
    const STICKERS = ['½', '×', '÷'];
```

Replace `renderHome` with:

```js
    function renderHome(container, onPick) {
        container.textContent = '';
        const grade = currentGrade();

        const top = el('div', 'home-top');
        top.appendChild(el('p', 'home-greeting', 'Chào em! Hôm nay em muốn học bài nào?'));
        const stickers = el('div', 'stickers');
        stickers.setAttribute('aria-hidden', 'true');
        STICKERS.forEach((symbol) => {
            const sticker = el('span', 'sticker', symbol);
            sticker.addEventListener('click', () => replayAnimation(sticker, 'wiggle'));
            sticker.addEventListener('animationend', () => sticker.classList.remove('wiggle'));
            stickers.appendChild(sticker);
        });
        top.appendChild(stickers);
        container.appendChild(top);

        const chips = el('div', 'grade-chips');
        data.grades.forEach((g) => {
            const tone = GRADE_TONES[g.grade] || 'neutral';
            const chip = button('Lớp ' + g.grade, 'btn grade-chip tone-' + tone, () => {
                saveGrade(g.grade);
                renderHome(container, onPick);
            });
            chip.setAttribute('aria-pressed', String(g.grade === grade.grade));
            chips.appendChild(chip);
        });
        container.appendChild(chips);

        container.appendChild(el('h2', 'home-heading', 'Các bài học lớp ' + grade.grade));
        const list = el('div', 'lesson-list');
        practiceFirst(grade.lessons).forEach((lesson) => {
            const card = button(undefined, 'btn lesson-card', () => onPick(lesson.id));
            card.appendChild(el('span', 'lesson-title', lesson.title));
            card.appendChild(hasPractice(lesson)
                ? el('span', 'tag tone-orange', 'Ghi nhớ · Luyện tập')
                : el('span', 'tag tone-blue', 'Hỏi cô'));
            list.appendChild(card);
        });
        container.appendChild(list);
    }
```

Make these class-name replacements in the card builders:

| Where | Before | After |
|---|---|---|
| `lessonCard` | `button('Những kiến thức phải nhớ', 'card-btn primary', …)` | `'btn card-btn tone-blue'` |
| `lessonCard` | `button('Cho em bài để luyện tập', 'card-btn primary', …)` | `'btn card-btn tone-orange'` |
| `ghiNhoCard` | `el('p', 'card-label', 'Ghi nhớ · ' + lesson.title)` | `el('p', 'tag tone-blue', 'Ghi nhớ · ' + lesson.title)` |
| `ghiNhoCard` | `button('Cho em bài để luyện tập', 'card-btn primary', …)` | `'btn card-btn tone-orange'` |
| `problemCard` | `el('p', 'card-label', 'Bài ' + …)` | `el('p', 'tag tone-orange', 'Bài ' + …)` |
| `problemCard` | `el('button', 'card-btn primary', 'Kiểm tra')` | `el('button', 'btn card-btn tone-green', 'Kiểm tra')` |
| `problemCard` | `button('Cô gợi ý', 'card-btn hint', …)` | `'btn card-btn tone-lavender hint'` |
| `problemCard` | `button('Những kiến thức phải nhớ', 'card-btn', …)` | `'btn card-btn tone-blue'` |
| `problemCard` | `button('Chọn bài khác', 'card-btn primary', …)` | `'btn card-btn tone-neutral'` |
| `problemCard` | `button('Bài tiếp theo', 'card-btn primary', …)` | `'btn card-btn tone-cyan'` |

In `problemCard`'s submit handler, replace `show(result);` with:

```js
            show(result);
            if (result === 'correct') celebrate(card, input);
            if (result === 'wrong') replayAnimation(input, 'shake');
```

and, directly after the `form.addEventListener('submit', …)` block, add:

```js
        input.addEventListener('animationend', () => input.classList.remove('shake'));
```

- [ ] **Step 6: Run the offline suite**

Run: `python -m pytest -q`
Expected: all pass, including both new tests in `tests/test_app_shell.py`.

- [ ] **Step 7: Browser check (375 × 812)**

With `localStorage` cleared, reload and run:

```js
(() => {
    const cs = (sel, prop) => getComputedStyle(document.querySelector(sel))[prop];
    return {
        bodyBg: cs('body', 'backgroundColor'),
        chipSelectedShadow: cs('.grade-chip[aria-pressed="true"]', 'boxShadow'),
        chipOtherShadow: cs('.grade-chip[aria-pressed="false"]', 'boxShadow'),
        chipBg: cs('.grade-chip[aria-pressed="true"]', 'backgroundColor'),
        stickers: document.querySelectorAll('.sticker').length,
        tagPractice: document.querySelector('.lesson-card .tag.tone-orange') && document.querySelector('.lesson-card .tag.tone-orange').textContent,
        fonts: document.fonts.check('800 16px "Be Vietnam Pro"', 'ệừở') && document.fonts.check('600 16px "Inter"', 'ệừở'),
        scrollWidth: document.documentElement.scrollWidth
    };
})()
```

Expected:
- `bodyBg` is `rgb(20, 19, 26)`.
- The selected chip's shadow is `rgb(136, 212, 152) 2px 2px 0px 0px` (Lớp 4), and other chips' shadows are `rgb(243, 243, 246) 2px 2px 0px 0px`.
- The selected chip's background is `rgb(46, 122, 69)`.
- `stickers` is 3, `tagPractice` is "Ghi nhớ · Luyện tập", `fonts` is `true`, and `scrollWidth` ≤ 375.

Take a Home screenshot. Click a sticker and confirm the `wiggle` class is added. Then:

1. Open "Nhân hai phân số", then "Cho em bài để luyện tập".
2. Type `6/15`, click Kiểm tra: expect `shake` on the input and coral feedback.
3. Type `8/15`, click Kiểm tra: expect `.confetti-bit` elements in the card, the card's shadow in bright green, and green feedback.
4. Take a screenshot.
5. Seed a text conversation containing an error bubble, check that `.msg.error`'s background is `rgb(184, 59, 59)`, and take a screenshot.
6. Emulate `prefers-reduced-motion: reduce` if the tool supports it; otherwise check the CSS rule is present.

Clear `localStorage` and reset the viewport.

- [ ] **Step 8: Commit**

```bash
git add chat.css index.html manifest.webmanifest js/lessons.js tests/test_app_shell.py
git commit -F msg.txt   # "feat(style): dark neubrutalism theme" + short body + Co-Authored-By
```

---

### Task 3: Maths keyboard

**Files:**
- Create: `js/mathpad.js`
- Modify: `chat.css` (append keypad section), `index.html` (toggle, keypad container, script tag), `js/chat.js` (`init`), `js/lessons.js` (`problemCard`), `sw.js` (`APP_SHELL`)
- Test: `tests/test_app_shell.py`

**Interfaces:**
- Consumes:
  - `btn`, `key`, `tone-*` CSS (Task 2);
  - `els.input`, `els.composer` and `scrollToBottom` in `js/chat.js`;
  - the answer `input` and its `form` in `problemCard`.
- Produces `window.MathPad`:
  - `init({ pad: HTMLElement, toggle: HTMLButtonElement, input: HTMLTextAreaElement, composer: HTMLElement, onChatOpen: () => void }): void`
  - `attachAnswer(input: HTMLInputElement): void`
  - `release(input: HTMLInputElement): void`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_app_shell.py`:

```python
def test_maths_keypad_is_wired_into_the_page():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    assert 'id="mathpad"' in html and 'id="mathpad-toggle"' in html
    assert html.index("js/mathpad.js") < html.index("js/lessons.js") < html.index("js/chat.js")
    assert "mathpad.js" in "".join(_app_shell())
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python -m pytest tests/test_app_shell.py -q`
Expected: 1 failed (`test_maths_keypad_is_wired_into_the_page`).

- [ ] **Step 3: Create `js/mathpad.js`**

```js
// The maths keypad. In a practice answer box it replaces the phone keyboard (digits, the fraction
// bar, Kiểm tra). In the chat box, the "123 ×÷" button swaps the phone keyboard for maths symbols
// and "ABC" swaps back.
//
// The keypad is a normal child of the page's flex column (index.html #mathpad), not an overlay, so
// opening it shrinks the conversation above it the same way the phone keyboard does. Its keys never
// take focus (pointerdown is cancelled), so the field being typed into keeps its caret.
window.MathPad = (function () {
    // An answer is a whole number or a/b, at most 6 digits a side (js/lessons.js parseAnswer).
    // Partial answers ("", "12", "12/") are allowed while typing; a leading "/" is not.
    const PARTIAL_ANSWER = /^(\d{1,6}(\/\d{0,6})?)?$/;

    const DELETE = { text: '⌫', aria: 'Xoá', tone: 'coral', action: 'delete' };
    const FRACTION = { aria: 'Phân số', tone: 'cyan', fraction: true, insert: '/' };

    function digit(d, extra) {
        return Object.assign({ text: d, insert: d }, extra);
    }

    // Operators get a space on each side, the way they are written in class: "2/3 × 4/5".
    function operator(symbol, aria) {
        return { text: symbol, aria: aria, tone: 'lavender', insert: ' ' + symbol + ' ' };
    }

    const LAYOUTS = {
        answer: [
            digit('7'), digit('8'), digit('9'), DELETE,
            digit('4'), digit('5'), digit('6'), FRACTION,
            digit('1'), digit('2'), digit('3'),
            { text: 'Kiểm tra', tone: 'green', action: 'check', word: true, rows: 2 },
            digit('0', { cols: 3 })
        ],
        chat: [
            digit('7'), digit('8'), digit('9'), operator('+', 'Cộng'), operator('−', 'Trừ'), DELETE,
            digit('4'), digit('5'), digit('6'), operator('×', 'Nhân'), operator(':', 'Chia'), FRACTION,
            digit('1'), digit('2'), digit('3'), operator('=', 'Bằng'),
            { text: '(', aria: 'Mở ngoặc', tone: 'lavender', insert: '(' },
            { text: ')', aria: 'Đóng ngoặc', tone: 'lavender', insert: ')' },
            { text: 'ABC', aria: 'Bàn phím chữ', action: 'letters', word: true, cols: 2 },
            digit('0'),
            { text: ',', aria: 'Dấu phẩy', insert: ',' },
            { text: 'cách', aria: 'Dấu cách', insert: ' ', word: true, cols: 2 }
        ]
    };

    const els = {};
    let chatOn = false;
    let answerInput = null;   // the practice answer box being typed into, if any

    function makeKey(spec) {
        const node = document.createElement('button');
        node.type = 'button';
        node.tabIndex = -1;
        node.className = 'btn key tone-' + (spec.tone || 'neutral') + (spec.word ? ' word' : '');
        if (spec.cols) node.style.gridColumn = 'span ' + spec.cols;
        if (spec.rows) node.style.gridRow = 'span ' + spec.rows;
        if (spec.fraction) {
            const icon = document.createElement('span');
            icon.className = 'frac-icon';
            icon.appendChild(document.createElement('i'));
            icon.appendChild(document.createElement('b'));
            icon.appendChild(document.createElement('i'));
            node.appendChild(icon);
        } else {
            node.textContent = spec.text;
        }
        if (spec.aria) node.setAttribute('aria-label', spec.aria);
        node.addEventListener('pointerdown', (event) => event.preventDefault());
        node.addEventListener('click', () => press(spec));
        return node;
    }

    function render(mode) {
        els.pad.textContent = '';
        els.pad.className = 'mathpad ' + mode;
        LAYOUTS[mode].forEach((spec) => els.pad.appendChild(makeKey(spec)));
        els.pad.hidden = false;
        document.body.classList.add('mathpad-open');
    }

    function hide() {
        els.pad.hidden = true;
        els.pad.textContent = '';
        document.body.classList.remove('mathpad-open');
    }

    function press(spec) {
        const field = answerInput || els.input;
        if (!answerInput) els.input.focus();
        if (spec.action === 'delete') {
            deleteBack(field);
        } else if (spec.action === 'check') {
            submitAnswer();
        } else if (spec.action === 'letters') {
            setChat(false);
        } else {
            insert(field, spec.insert);
        }
    }

    function insert(field, text) {
        field.setRangeText(text, field.selectionStart, field.selectionEnd, 'end');
        field.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function deleteBack(field) {
        let start = field.selectionStart;
        const end = field.selectionEnd;
        if (start === end) {
            if (start === 0) return;
            start -= 1;
        }
        field.setRangeText('', start, end, 'end');
        field.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function submitAnswer() {
        const form = answerInput && answerInput.form;
        if (!form) return;
        if (form.requestSubmit) {
            form.requestSubmit();
        } else {
            form.querySelector('[type="submit"]').click();
        }
    }

    function setChat(on) {
        chatOn = on;
        els.toggle.setAttribute('aria-pressed', String(on));
        if (on) {
            els.input.setAttribute('inputmode', 'none');
            if (!answerInput) render('chat');
            // Android keeps an open phone keyboard until the field is focused again.
            els.input.blur();
            els.input.focus();
            els.onChatOpen();
        } else {
            els.input.removeAttribute('inputmode');
            if (!answerInput) hide();
            els.input.blur();
            els.input.focus();   // focusing again brings the phone keyboard back
        }
    }

    // A practice answer box: the keypad replaces the phone keyboard while it has focus, and typing
    // on a real keyboard is held to the same shape as the keys.
    function attachAnswer(input) {
        if (!els.pad) return;   // init never ran: the box keeps the phone keyboard
        input.setAttribute('inputmode', 'none');
        let lastValid = PARTIAL_ANSWER.test(input.value) ? input.value : '';
        input.addEventListener('input', () => {
            if (PARTIAL_ANSWER.test(input.value)) {
                lastValid = input.value;
            } else {
                input.value = lastValid;
            }
        });
        input.addEventListener('focus', () => {
            if (input.disabled) return;
            answerInput = input;
            els.composer.hidden = true;
            render('answer');
            requestAnimationFrame(() => input.scrollIntoView({ block: 'nearest' }));
        });
        input.addEventListener('blur', () => release(input));
    }

    // Stops typing into an answer box: on blur, and when a right answer locks the box (a disabled
    // field does not reliably fire blur).
    function release(input) {
        if (answerInput !== input) return;
        answerInput = null;
        els.composer.hidden = false;
        if (chatOn) {
            render('chat');
        } else {
            hide();
        }
    }

    function init(options) {
        els.pad = options.pad;
        els.toggle = options.toggle;
        els.input = options.input;
        els.composer = options.composer;
        els.onChatOpen = options.onChatOpen || function () {};
        els.toggle.hidden = false;
        els.toggle.addEventListener('pointerdown', (event) => event.preventDefault());
        els.toggle.addEventListener('click', () => setChat(!chatOn));
    }

    return { init: init, attachAnswer: attachAnswer, release: release };
})();
```

- [ ] **Step 4: Wire it into the page**

`index.html`:
- In the composer, before the `<textarea>`, add:

  ```html
          <button type="button" class="btn tone-lavender mathpad-toggle" id="mathpad-toggle" aria-pressed="false" aria-label="Bàn phím toán" hidden>123<br>×÷</button>
  ```

- Directly after `</form>`, add:

  ```html
      <div class="mathpad" id="mathpad" hidden></div>
  ```

- Before `<script src="js/lessons.js"></script>`, add `<script src="js/mathpad.js"></script>`.

`sw.js` `APP_SHELL`: add `'./js/mathpad.js',` after `'./js/lessons.js',`.

`js/chat.js` `init`, directly after `fitToVisibleViewport();`:

```js
        if (window.MathPad) {
            window.MathPad.init({
                pad: document.getElementById('mathpad'),
                toggle: document.getElementById('mathpad-toggle'),
                input: els.input,
                composer: els.composer,
                onChatOpen: scrollToBottom
            });
        }
```

`js/lessons.js`, in `problemCard`:
- After `input.setAttribute('aria-label', 'Câu trả lời của em');`, add:

  ```js
          if (window.MathPad) window.MathPad.attachAnswer(input);
  ```

- In the submit handler, after the lines added in Task 2, add:

  ```js
              if (entry.solved && window.MathPad) window.MathPad.release(input);
  ```

Append to `chat.css`, before the `@media (max-width: 600px)` block:

```css
/* ---- Maths keypad (js/mathpad.js) ---- */
.mathpad {
    flex: 0 0 auto;
    display: grid;
    gap: 6px;
    padding: 10px 12px calc(12px + env(safe-area-inset-bottom));
    background: var(--surface);
    border-top: 3px solid var(--ink);
}
.mathpad.answer { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.mathpad.chat { grid-template-columns: repeat(6, minmax(0, 1fr)); }
.mathpad-open .composer { padding-bottom: 12px; }
.key { min-height: 40px; padding: 0; font-family: var(--font-display); font-weight: 800; font-size: 1.15rem; }
.key.word { font-family: var(--font-body); font-weight: 600; font-size: 0.85rem; }
.frac-icon { display: inline-flex; flex-direction: column; align-items: center; gap: 2px; vertical-align: middle; }
.frac-icon i { display: block; width: 11px; height: 9px; border: 2px solid currentColor; }
.frac-icon b { display: block; width: 18px; border-top: 2px solid currentColor; }
.mathpad-toggle { min-width: 56px; padding: 0 6px; font-size: 0.78rem; line-height: 1.15; }
.mathpad-toggle[aria-pressed="true"] { transform: translate(1px, 1px); box-shadow: 2px 2px 0 0 var(--bright); }
```

- [ ] **Step 5: Run the offline suite**

Run: `python -m pytest -q`
Expected: all pass.

- [ ] **Step 6: Browser check (375 × 812)**

Seed one problem card and reload:

```js
localStorage.meritsChatHistory = JSON.stringify([{ role: 'assistant', card: 'lesson', lessonId: 'nhan-hai-phan-so' }, { role: 'assistant', card: 'problem', lessonId: 'nhan-hai-phan-so', index: 0, attempts: [], solved: false }]); location.reload();
```

Then run:

```js
(async () => {
    const out = [];
    const ok = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) out.push(name + ': got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); };
    const pad = document.getElementById('mathpad');
    const composer = document.getElementById('composer');
    const input = document.querySelector('.answer-input');
    const keyByLabel = (label) => [...pad.querySelectorAll('.key')].find((k) => k.getAttribute('aria-label') === label || k.textContent === label);
    const tap = (label) => keyByLabel(label).click();
    const wait = () => new Promise((r) => setTimeout(r, 50));

    ok('toggle visible', document.getElementById('mathpad-toggle').hidden, false);
    ok('answer inputmode', input.getAttribute('inputmode'), 'none');
    input.focus(); await wait();
    ok('pad open', pad.hidden, false);
    ok('pad mode', pad.className, 'mathpad answer');
    ok('composer hidden', composer.hidden, true);
    tap('Phân số'); ok('no leading slash', input.value, '');
    tap('6'); tap('Phân số'); tap('Phân số'); tap('1'); tap('5');
    ok('one slash', input.value, '6/15');
    tap('Xoá'); ok('delete', input.value, '6/1');
    tap('5'); tap('Kiểm tra'); await wait();
    ok('wrong feedback', document.querySelector('.feedback').className, 'feedback wrong');
    input.value = ''; input.dispatchEvent(new Event('input'));
    ['1', '2', '3', '4', '5', '6', '7'].forEach(tap);
    ok('6 digit limit', input.value, '123456');
    input.value = '8/15x'; input.dispatchEvent(new Event('input'));
    ok('typing filtered', input.value, '123456');
    input.value = '8/15'; input.dispatchEvent(new Event('input'));
    tap('Kiểm tra'); await wait();
    ok('correct feedback', document.querySelector('.feedback').className, 'feedback correct');
    ok('pad closed after solve', pad.hidden, true);
    ok('composer back', composer.hidden, false);
    input.focus(); await wait();
    ok('locked input does not open pad', pad.hidden, true);

    const toggle = document.getElementById('mathpad-toggle');
    const chat = document.getElementById('input');
    toggle.click(); await wait();
    ok('chat mode', pad.className, 'mathpad chat');
    ok('chat inputmode', chat.getAttribute('inputmode'), 'none');
    ok('toggle pressed', toggle.getAttribute('aria-pressed'), 'true');
    tap('2'); tap('Phân số'); tap('3'); tap('Nhân'); tap('4'); tap('Phân số'); tap('5');
    ok('chat text', chat.value, '2/3 × 4/5');
    chat.setSelectionRange(0, 0); tap('Mở ngoặc');
    ok('insert at caret', chat.value, '(2/3 × 4/5');
    chat.setSelectionRange(chat.value.length, chat.value.length); tap('Xoá'); tap('Xoá');
    ok('chat delete', chat.value, '(2/3 × 4');
    tap('Bàn phím chữ'); await wait();
    ok('ABC closes pad', pad.hidden, true);
    ok('ABC restores keyboard', chat.hasAttribute('inputmode'), false);
    ok('toggle released', toggle.getAttribute('aria-pressed'), 'false');
    return out.length ? 'FAIL\n' + out.join('\n') : 'PASS';
})()
```

Expected: `PASS`. Then:
- take screenshots at 375 × 812 of the answer keypad open and of the chat keypad open (toggle on);
- at 375 × 420, focus the answer box and check the card stays visible above the keypad, and `document.documentElement.scrollHeight <= innerHeight`;
- check no console errors;
- clear `localStorage` and reset the viewport.

- [ ] **Step 7: Commit**

```bash
git add js/mathpad.js chat.css index.html js/chat.js js/lessons.js sw.js tests/test_app_shell.py
git commit -F msg.txt   # "feat(chat): maths keypad for practice answers and the chat box" + Co-Authored-By
```

---

### Task 4: Deploy and verify live

**Files:** none (deploy only)

- [ ] **Step 1: Offline suite**

Run: `python -m pytest -q`. Expected: all pass.

- [ ] **Step 2: Deploy**

```bash
git fetch origin && git merge-base --is-ancestor origin/main HEAD
git push origin feat/socratic-chat
git checkout main && git merge --ff-only feat/socratic-chat && git push origin main && git checkout feat/socratic-chat
```

Poll `https://meritsofmath.pages.dev/js/mathpad.js?cb=<ts>` with a browser User-Agent until it returns 200 and contains `window.MathPad`.

- [ ] **Step 3: Live checks**

1. Run the live suite:

   ```powershell
   $env:RAG_BASE_URL = "https://meritsofmath.pages.dev"; $env:INGEST_SECRET = [Environment]::GetEnvironmentVariable('INGEST_SECRET','User'); python -m pytest -q --deselect tests/test_retrieval_eval.py
   ```

   Expected: pass. The retrieval eval is unaffected by this change and was green at `c8eaa58`.
2. On the live site at 375 × 812, check Home (dark theme, no highlight card) and take a screenshot.
3. Clean up `localStorage` and reset the viewport.
4. Ask the user to check on their phone:
   - the answer box opens the maths keypad, and no phone keyboard appears;
   - "123 ×÷" swaps keyboards;
   - "ABC" brings the letters back.
