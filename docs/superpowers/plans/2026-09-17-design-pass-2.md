# Design Pass 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch to Baloo 2 + Nunito, soften the hard shadows, give desktop screens a centred and fuller layout, and show the maths keypad as a pop-up on mouse-and-keyboard devices.

**Architecture:**
- Tokens and type change in `chat.css` `:root`. Desktop layout is one `@media (min-width: 900px)` block.
- `js/mathpad.js` keeps its docked keypad for touch devices. It adds a pop-up mode, chosen per field when `(hover: hover) and (pointer: fine)` matches, that renders the same key layouts into a card anchored to the field.

**Tech Stack:** Vanilla JS and CSS, Google Fonts, pytest (static checks), Browser pane (behaviour).

Spec: `docs/superpowers/specs/2026-09-17-design-pass-2-design.md`.

## Global Constraints

**Fonts**
- Only `family=Baloo+2:wght@700;800&family=Nunito:wght@600;700;800` is loaded.
- Display is Baloo 2 800, headings Baloo 2 700, body Nunito 600, buttons and tags Nunito 800.

**Shadows**
- Shadow colour `--shadow-color: #BDBCC8`. Outlines stay `--ink` `#F3F3F6`.
- Home lesson cards: 4px shadow, 6px on hover. Grade chips unchanged (2px, 3px hover, selected 2px bright).

**Desktop layout** (`min-width: 900px`)
- Centred home column, max-width 1060px.
- Hero: greeting `3.2rem`, subtitle "Chọn lớp của em, rồi chọn một bài để bắt đầu.", 4 stickers of 64px.
- Chips centred at `1.35rem`, 52px tall.
- 3-column lesson grid; cards at least 128px tall with titles at `1.6rem`.
- Conversation and chat box in an 820px column.

**Pop-up keypad** (only where `(hover: hover) and (pointer: fine)` matches)
- Answer boxes get a 48px lavender ⌨ button; focusing a box opens nothing.
- The pop-up closes on an outside press, Esc or a right answer, and stays open on a wrong one.
- The chat pop-up is anchored above the chat box. "ABC" closes it, and sending keeps it open.
- Only one keypad is open at a time.

**Project rules**
- No JS runtime here. Verify JavaScript in the Browser pane (`static` server). The local server has no cache headers, so clear caches before checking.
- Commit with explicit paths, ending with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Deploy by fast-forwarding `main`.

---

### Task 1: Fonts and softer shadows

**Files:**
- Modify: `chat.css` (`:root` and the rules listed), `index.html` (font link)
- Test: `tests/test_app_shell.py`

- [ ] **Step 1: Write the failing tests**

In `tests/test_app_shell.py`, replace `test_fonts_support_vietnamese` with:

```python
def test_fonts_support_vietnamese():
    """Baloo 2 + Nunito, chosen by the user on 2026-09-17 for a tactile, heavier feel; both have a
    Vietnamese subset. The faces they replaced must not load any more."""
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    for family in ("Baloo+2", "Nunito"):
        assert family in html, f"{family} is not loaded"
    for retired in ("Outfit", "Be+Vietnam+Pro", "Space+Grotesk", "Space+Mono", "family=Inter"):
        assert retired not in html, f"{retired} is still loaded"


def test_shadows_are_softer_than_outlines():
    """Pure near-white shadows were tiring to look at (2026-09-17)."""
    colours = _root_colours()
    assert "shadow-color" in colours
    assert colours["shadow-color"].upper() != colours["ink"].upper()
    css = (ROOT / "chat.css").read_text(encoding="utf-8")
    assert not re.search(r"box-shadow:[^;]*var\(--ink\)", css), "a shadow still uses --ink"
```

- [ ] **Step 2: Run them to verify they fail**

Run: `python -m pytest tests/test_app_shell.py -q`
Expected: 2 failed.

- [ ] **Step 3: Implement**

`index.html`: replace the Google Fonts stylesheet link with:

```html
    <link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@700;800&family=Nunito:wght@600;700;800&display=swap" rel="stylesheet">
```

`chat.css` `:root`: replace the shadow and font tokens with:

```css
    /* Softer than the outlines: pure near-white shadows were tiring to look at (2026-09-17). */
    --shadow-color: #BDBCC8;
    --shadow-sm: 3px 3px 0 0 var(--shadow-color);
    --shadow: 5px 5px 0 0 var(--shadow-color);
    --shadow-lg: 8px 8px 0 0 var(--shadow-color);

    /* Baloo 2 + Nunito: chunky and rounded, chosen by the user for a tactile, heavier feel. */
    --font-display: 'Baloo 2', system-ui, sans-serif;
    --font-heading: 'Baloo 2', system-ui, sans-serif;
    --font-body: 'Nunito', system-ui, sans-serif;
    --font-label: 'Nunito', system-ui, sans-serif;
```

Other `chat.css` changes:

| Rule | Change |
|---|---|
| `body` | add `font-weight: 600;` |
| `.btn` | `font-weight: 600` → `800` |
| `.tag` | `font-weight: 700` → `800` |
| `.logo` | `font-size: 1.3rem` → `1.5rem`; add `line-height: 1;` |
| `.chat-header h1` | `font-weight: 800; font-size: 1.3rem; line-height: 1;` |
| `.chat-header .sub` | `font-weight: 700` → `800` |
| `.home-greeting` | `font-size: 1.7rem; line-height: 1.1; letter-spacing: 0;` |
| `.grade-chip` | `box-shadow: 2px 2px 0 0 var(--shadow-color);` |
| `.grade-chip:hover` | `box-shadow: 3px 3px 0 0 var(--shadow-color);` |
| `.home-heading` | `font-weight: 800; font-size: 1.2rem;` |
| `.lesson-card` | `box-shadow: 4px 4px 0 0 var(--shadow-color);` |
| `.lesson-card:hover` | `box-shadow: 6px 6px 0 0 var(--shadow-color);` |
| `.lesson-title` | `font-family: var(--font-heading); font-weight: 700; font-size: 1.15rem; line-height: 1.15;` |
| `.msg code` | `font-family: ui-monospace, SFMono-Regular, Consolas, monospace;` |
| `.answer-unit` | `font-weight: 700;` |
| `.feedback` | `font-weight: 700;` |
| `.finish` | `font-weight: 800;` |
| `.key.word` | `font-weight: 800;` |

- [ ] **Step 4: Run the offline suite**

Run: `python -m pytest -q`. Expected: all pass.

- [ ] **Step 5: Browser check (375 × 600)**

Clear caches, then reload. Check:
- `getComputedStyle(document.querySelector('.home-greeting')).fontFamily` starts with `"Baloo 2"`.
- The body's computed font starts with `Nunito`.
- `document.fonts.check('800 16px "Baloo 2"', 'ệừở') && document.fonts.check('600 16px Nunito', 'ệừở')` is `true`.
- The lesson card's `boxShadow` is `rgb(189, 188, 200) 4px 4px 0px 0px`.

Take a screenshot.

- [ ] **Step 6: Commit** — `feat(style): Baloo 2 and Nunito, softer grey shadows`

---

### Task 2: Desktop layout

**Files:**
- Modify: `chat.css` (mobile hide rules and a new desktop block), `js/lessons.js` (`STICKERS`, `renderHome`)

- [ ] **Step 1: Home markup**

In `js/lessons.js`, set `const STICKERS = ['½', '×', '÷', '='];`. In `renderHome`, directly after the greeting line, add:

```js
        top.appendChild(el('p', 'home-sub', 'Chọn lớp của em, rồi chọn một bài để bắt đầu.'));
```

- [ ] **Step 2: Phone rules**

In `chat.css`, after `.home-greeting { … }`, add:

```css
.home-sub { display: none; }
```

After `.sticker:nth-child(3) { … }`, add:

```css
.sticker:nth-child(4) { display: none; }
```

- [ ] **Step 3: Desktop block**

Add before `@media (prefers-reduced-motion: reduce)`:

```css
/* ---- Desktop: a centred column, bigger type and cards (2026-09-17) ---- */
@media (min-width: 900px) {
    .chat-header { padding: 16px 40px; }
    .logo { width: 52px; height: 52px; font-size: 1.9rem; }
    .chat-header h1 { font-size: 1.6rem; }
    .chat-header .sub { font-size: 0.8rem; }
    .icon-btn { width: 52px; height: 52px; font-size: 1.4rem; }

    .home { padding: 0 40px 36px; gap: 24px; }
    .home > * { width: 100%; max-width: 1060px; margin-inline: auto; }
    .home-top { padding: 36px 96px 26px; min-height: 0; text-align: center; border-bottom: 3px dashed #3A3948; }
    .home-greeting { font-size: 3.2rem; line-height: 1.05; max-width: 760px; margin: 0 auto 10px; }
    .home-sub { display: block; margin: 0; font-weight: 700; font-size: 1.25rem; }
    .stickers { inset: 0; width: auto; height: auto; pointer-events: none; }
    .sticker { width: 64px; height: 64px; font-size: 2rem; pointer-events: auto; }
    .sticker:nth-child(1) { top: 26px; left: 0; right: auto; }
    .sticker:nth-child(2) { top: 104px; left: 70px; right: auto; }
    .sticker:nth-child(3) { top: 30px; right: 0; }
    .sticker:nth-child(4) { display: grid; top: 108px; right: 76px; background: var(--lavender-bright); animation-delay: -1.6s; }

    .grade-chips { justify-content: center; gap: 14px; }
    .grade-chip { min-height: 52px; padding: 0 24px; font-size: 1.35rem; }
    .home-heading { font-size: 1.5rem; }
    .lesson-list { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 22px; }
    .lesson-card { min-height: 128px; padding: 18px 20px; justify-content: space-between; }
    .lesson-title { font-size: 1.6rem; line-height: 1.1; }

    .messages { padding: 28px max(40px, calc((100% - 820px) / 2)); gap: 20px; }
    .msg { font-size: 1.1rem; }
    .msg.card { max-width: 640px; }
    .composer { padding: 16px max(40px, calc((100% - 820px) / 2)); }
    .composer textarea { font-size: 1.1rem; }
    .send-btn { padding: 0 26px; font-size: 1.1rem; }
    .mathpad-toggle { min-width: 72px; font-size: 0.9rem; }
}
```

- [ ] **Step 4: Offline suite** — `python -m pytest -q`. Expected: all pass.

- [ ] **Step 5: Browser check**

At 1280 × 800 on Home:
- the hero has 4 visible stickers and a visible subtitle;
- the chips' `justifyContent` is `center`;
- the lesson list has 3 columns, and each card is at least 128px tall;
- `scrollWidth <= innerWidth`.

Open a lesson and check the first card sits in the centred column: its left edge is at least `(1280 - 820) / 2`.

Take screenshots. At 375 × 600, check 3 stickers, no subtitle, and chips starting at the left.

- [ ] **Step 6: Commit** — `feat(style): desktop layout with a decorated hero and larger cards`

---

### Task 3: Pop-up keypad on mouse-and-keyboard devices

**Files:**
- Rewrite: `js/mathpad.js`
- Modify: `chat.css` (pop-up rules), `tests/test_app_shell.py`

**Interfaces:**
- `window.MathPad` keeps `init(options)`, `attachAnswer(input)`, `release(input)` and `reset()` with unchanged signatures.
- Callers (`js/chat.js`, `js/lessons.js`) do not change.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_app_shell.py`:

```python
def test_keypad_pops_up_on_mouse_and_keyboard_devices():
    """A full-width docked keypad looked out of place on a desktop (2026-09-17)."""
    js = (ROOT / "js" / "mathpad.js").read_text(encoding="utf-8")
    assert "(hover: hover) and (pointer: fine)" in js
    css = (ROOT / "chat.css").read_text(encoding="utf-8")
    assert ".mathpad-popup" in css and ".keypad-btn" in css
```

Run: `python -m pytest tests/test_app_shell.py -q`. Expected: 1 failed.

- [ ] **Step 2: Rewrite `js/mathpad.js`**

Keep, unchanged:
- the file-top constants (`PARTIAL_ANSWER`, `DELETE`, `FRACTION`, `digit`, `operator`, `LAYOUTS`);
- `afterTap`, `keepFocus`, `makeKey`, `insert` and `deleteBack`.

Replace everything else so the module reads:

```js
// The maths keypad. On a phone or tablet it is docked under the chat box: in a practice answer box
// it replaces the phone keyboard (digits, the fraction bar, Kiểm tra), and in the chat box the
// "123 ×÷" button swaps the phone keyboard for maths symbols, with "ABC" swapping back. On a
// computer with a mouse it is a pop-up card anchored to its field instead: a keyboard-wide keypad
// looked out of place on a desktop (2026-09-17), and a real keyboard types into the field anyway.
//
// The docked keypad is a normal child of the page's flex column (index.html #mathpad), not an
// overlay, so opening it shrinks the conversation above it the same way the phone keyboard does.
// Keys never take focus (pointerdown and mousedown are cancelled), so the field keeps its caret.
window.MathPad = (function () {
    /* PARTIAL_ANSWER, DELETE, FRACTION, digit, operator, LAYOUTS: unchanged */

    // A fine pointer that can hover is a mouse or trackpad, so the device has a real keyboard.
    const POPUP_QUERY = '(hover: hover) and (pointer: fine)';

    const els = {};
    let chatOn = false;
    let answerInput = null;   // the answer box the docked keypad is typing into, if any
    let popup = null;         // the open pop-up keypad: { node, button, field, mode }
    let pointerIsDown = false;

    function usePopup() {
        return Boolean(window.matchMedia && window.matchMedia(POPUP_QUERY).matches);
    }

    /* afterTap, keepFocus, makeKey: unchanged */

    function fillKeys(container, mode) {
        container.textContent = '';
        LAYOUTS[mode].forEach((spec) => container.appendChild(makeKey(spec)));
    }

    // ---- docked keypad (touch) ----

    function render(mode) {
        fillKeys(els.pad, mode);
        els.pad.className = 'mathpad ' + mode;
        els.pad.hidden = false;
        document.body.classList.add('mathpad-open');
    }

    function hide() {
        els.pad.hidden = true;
        els.pad.textContent = '';
        document.body.classList.remove('mathpad-open');
    }

    // ---- pop-up keypad (mouse and keyboard) ----

    function openPopup(mode, host, button, field) {
        closePopup();
        const node = document.createElement('div');
        node.className = 'mathpad-popup ' + mode;
        node.setAttribute('role', 'group');
        node.setAttribute('aria-label', 'Bàn phím toán');
        fillKeys(node, mode);
        host.appendChild(node);
        popup = { node: node, button: button, field: field, mode: mode };
        button.setAttribute('aria-pressed', 'true');
        if (mode === 'chat') chatOn = true;
        node.scrollIntoView({ block: 'nearest' });
    }

    function closePopup() {
        if (!popup) return;
        popup.node.remove();
        popup.button.setAttribute('aria-pressed', 'false');
        if (popup.mode === 'chat') chatOn = false;
        popup = null;
    }

    function press(spec) {
        // The answer box was removed from the page without a blur (not every browser fires one).
        if (answerInput && !answerInput.isConnected) release(answerInput);
        const field = popup ? popup.field : (answerInput || els.input);
        if (document.activeElement !== field) field.focus();
        if (spec.action === 'delete') {
            deleteBack(field);
        } else if (spec.action === 'check') {
            submitAnswer(field);
        } else if (spec.action === 'letters') {
            setChat(false);
        } else {
            insert(field, spec.insert);
        }
    }

    /* insert, deleteBack: unchanged */

    function submitAnswer(field) {
        const form = field.form;
        if (!form) return;
        if (form.requestSubmit) {
            form.requestSubmit();
        } else {
            form.querySelector('[type="submit"]').click();
        }
    }

    function setChat(on) {
        if (usePopup()) {
            if (on) {
                openPopup('chat', els.composer, els.toggle, els.input);
                els.onChatOpen();
            } else {
                closePopup();
            }
            els.input.focus();
            return;
        }
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

    // A practice answer box. Typing on a real keyboard is held to the same shape as the keys. On
    // touch, the docked keypad replaces the phone keyboard while the box has focus; with a mouse, a
    // keypad button beside the box opens the pop-up.
    function attachAnswer(input) {
        if (!els.pad) return;   // init never ran: the box keeps the phone keyboard
        // Taken when the box gains focus, not now: a saved attempt is put back into the box after
        // it is attached, and an invalid key must not wipe that attempt.
        let lastValid = '';
        input.addEventListener('input', () => {
            if (PARTIAL_ANSWER.test(input.value)) {
                lastValid = input.value;
            } else {
                input.value = lastValid;
            }
        });
        input.addEventListener('focus', () => {
            lastValid = PARTIAL_ANSWER.test(input.value) ? input.value : '';
        });
        if (usePopup()) {
            attachPopupButton(input);
        } else {
            attachDocked(input);
        }
    }

    function attachPopupButton(input) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn tone-lavender keypad-btn';
        button.setAttribute('aria-label', 'Mở bàn phím toán');
        button.setAttribute('aria-pressed', 'false');
        const icon = document.createElement('span');
        icon.className = 'keypad-icon';
        for (let i = 0; i < 6; i++) icon.appendChild(document.createElement('i'));
        button.appendChild(icon);
        keepFocus(button);
        button.addEventListener('click', () => {
            if (popup && popup.field === input) {
                closePopup();
            } else if (!input.disabled) {
                openPopup('answer', input.parentElement, button, input);
                input.focus();
            }
        });
        input.insertAdjacentElement('afterend', button);
    }

    function attachDocked(input) {
        input.setAttribute('inputmode', 'none');
        input.addEventListener('focus', () => {
            if (input.disabled) return;
            answerInput = input;
            els.composer.hidden = true;
            render('answer');
            // Straight away, not on the next frame: scrollIntoView forces layout, so the new
            // keypad is already measured, and a frame callback can be held back indefinitely.
            input.scrollIntoView({ block: 'nearest' });
        });
        input.addEventListener('blur', () => {
            afterTap(() => {
                if (document.activeElement !== input) release(input);
            });
        });
    }

    // Stops typing into an answer box: on blur, and when a right answer locks the box (a disabled
    // field does not reliably fire blur).
    function release(input) {
        if (popup && popup.field === input) closePopup();
        if (answerInput !== input) return;
        answerInput = null;
        els.composer.hidden = false;
        if (chatOn) {
            render('chat');
        } else {
            hide();
        }
    }

    // For js/chat.js to call before it rebuilds the conversation: the rebuilt cards are new
    // elements, and the old answer box may never fire blur. The chat keypad stays as it is.
    function reset() {
        if (popup && popup.mode === 'answer') closePopup();
        if (answerInput) release(answerInput);
    }

    function init(options) {
        els.pad = options.pad;
        els.toggle = options.toggle;
        els.input = options.input;
        els.composer = options.composer;
        els.onChatOpen = options.onChatOpen || function () {};
        els.pad.setAttribute('role', 'group');
        els.pad.setAttribute('aria-label', 'Bàn phím toán');
        document.addEventListener('pointerdown', (event) => {
            pointerIsDown = true;
            // A press outside the pop-up, its button and its field closes the pop-up.
            if (popup && !popup.node.contains(event.target) && !popup.button.contains(event.target)
                    && event.target !== popup.field) {
                closePopup();
            }
        }, true);
        document.addEventListener('pointerup', () => { pointerIsDown = false; }, true);
        document.addEventListener('pointercancel', () => { pointerIsDown = false; }, true);
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && popup) closePopup();
        });
        els.toggle.hidden = false;
        keepFocus(els.toggle);
        els.toggle.addEventListener('click', () => setChat(!chatOn));
    }

    return { init: init, attachAnswer: attachAnswer, release: release, reset: reset };
})();
```

The `/* … unchanged */` comments above mark the kept code; the implementer copies that code in.

- [ ] **Step 3: Pop-up CSS**

Append to the keypad section of `chat.css`:

```css
/* Pop-up keypad for a mouse and keyboard (js/mathpad.js): a card anchored to its field. */
.answer-row, .composer { position: relative; }
.mathpad-popup {
    position: absolute;
    z-index: 5;
    display: grid;
    gap: 8px;
    padding: 12px;
    background: var(--surface);
    border: 3px solid var(--ink);
    box-shadow: var(--shadow-lg);
}
.mathpad-popup.answer { top: calc(100% + 14px); left: 0; width: 320px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.mathpad-popup.chat { bottom: calc(100% + 14px); left: 16px; width: 440px; grid-template-columns: repeat(6, minmax(0, 1fr)); }
.mathpad-popup .key { min-height: 52px; }
.mathpad-popup::before {
    content: '';
    position: absolute;
    left: 28px;
    width: 18px;
    height: 18px;
    background: var(--surface);
    border-left: 3px solid var(--ink);
    border-top: 3px solid var(--ink);
}
.mathpad-popup.answer::before { top: -12px; transform: rotate(45deg); }
.mathpad-popup.chat::before { bottom: -12px; transform: rotate(225deg); }
.keypad-btn { width: 48px; min-height: 48px; padding: 0; display: grid; place-items: center; }
.keypad-icon { display: grid; grid-template-columns: repeat(3, 6px); gap: 3px; }
.keypad-icon i { display: block; width: 6px; height: 6px; background: currentColor; }
.keypad-btn[aria-pressed="true"] { transform: translate(1px, 1px); box-shadow: 2px 2px 0 0 var(--bright); }
.answer-input:disabled + .keypad-btn { display: none; }
```

In the desktop block, add `.mathpad-popup.chat { left: max(40px, calc((100% - 820px) / 2)); }`.

- [ ] **Step 4: Offline suite** — `python -m pytest -q`. Expected: all pass.

- [ ] **Step 5: Browser check, desktop (1280 × 800, real clicks via the computer tool)**

Seed a lesson card and an unsolved problem, then check in this order:
1. Clicking the answer box: focused, no `.mathpad-popup`, `#mathpad` hidden, no `inputmode` attribute.
2. Clicking ⌨: `.mathpad-popup.answer` exists and the button is `aria-pressed="true"`.
3. Keys "6", "Phân số", "1", "5" type "6/15". Kiểm tra (key): wrong feedback, and the pop-up is still open.
4. Esc: the pop-up is gone.
5. ⌨ again, then a click in empty conversation space: the pop-up is gone.
6. ⌨, clear the box, type "8/15" with keys, then Kiểm tra: correct feedback, the pop-up is gone, and ⌨ is hidden.
7. "123 ×÷": `.mathpad-popup.chat` exists inside the composer. Keys type "2/3 × 4/5". "ABC" removes it and the toggle is `aria-pressed="false"`.

Take screenshots of both pop-ups.

- [ ] **Step 6: Browser check, phone (375 × 600 mobile preset, touch emulation)**

Reload. There is no `.keypad-btn`. A real tap on the answer box opens `#mathpad.answer` docked.

- [ ] **Step 7: Commit** — `feat(chat): pop-up maths keypad on mouse-and-keyboard devices`

---

### Task 4: Deploy and verify live

- [ ] Run the offline suite, then fast-forward `main` and push.
- [ ] Poll `js/mathpad.js` until it contains `POPUP_QUERY`.
- [ ] Run the live suite without the retrieval eval.
- [ ] Take a live desktop screenshot at 1280 × 800.
- [ ] Clean up storage.
- [ ] Ask the user to check on desktop and phone.
