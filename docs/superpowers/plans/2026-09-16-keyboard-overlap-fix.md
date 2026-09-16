# Keyboard Overlap Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the header and the chat box visible above the phone's on-screen keyboard.

**Architecture:** Chrome is told to resize the page when the keyboard opens (`interactive-widget=resizes-content`). Browsers that ignore that get the visible height copied into a CSS variable from `window.visualViewport`. The app's height comes from that variable, with `100dvh` as the fallback.

**Tech Stack:** Vanilla JS, CSS, pytest for static checks; Browser pane for layout checks.

Spec: `docs/superpowers/specs/2026-09-16-keyboard-overlap-fix-design.md`.

## Global Constraints

- No JS runtime on this machine. Verify JavaScript in the Browser pane (`static` server, `http://localhost:8000/`).
- Commit with explicit paths only, ending with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Deploy: fast-forward `main` from `feat/socratic-chat` after `git merge-base --is-ancestor origin/main HEAD`.
- Pinch-zoom must keep working. When zoomed, `visualViewport.height` shrinks by the zoom scale, so the code multiplies it back by `visualViewport.scale`, and does not scroll the page while zoomed.

---

### Task 1: Resize the app to the visible viewport

**Files:**
- Modify: `index.html:5` (viewport meta), `chat.css` (body height), `js/chat.js` (new `fitToVisibleViewport`, called from `init`)
- Test: `tests/test_app_shell.py`

**Interfaces:**
- Consumes: `els.input`, `els.messages`, `scrollToBottom()` in `js/chat.js`.
- Produces: CSS variable `--app-height` on `<html>`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_app_shell.py`:

```python
def test_layout_follows_the_on_screen_keyboard():
    """Chrome keeps 100dvh at full height when the phone keyboard opens, so the chat box sat under
    the keyboard (reported 2026-09-16). index.html must ask Chrome to resize the page, and the app's
    height must come from the visible height js/chat.js measures, for browsers that ignore that."""
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    viewport = re.search(r'<meta name="viewport" content="([^"]*)"', html)
    assert viewport, "viewport meta tag not found"
    assert "interactive-widget=resizes-content" in viewport.group(1)
    css = (ROOT / "chat.css").read_text(encoding="utf-8")
    assert "height: var(--app-height, 100dvh);" in css
    chat = (ROOT / "js" / "chat.js").read_text(encoding="utf-8")
    assert "visualViewport" in chat and "--app-height" in chat
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python -m pytest tests/test_app_shell.py -q`
Expected: 1 failed (`test_layout_follows_the_on_screen_keyboard`), 2 passed.

- [ ] **Step 3: Implement**

`index.html` line 5:

```html
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content">
```

`chat.css`, in the `body` rule, replace `height: 100dvh;` with:

```css
    /* The phone keyboard: see fitToVisibleViewport in js/chat.js. */
    height: var(--app-height, 100dvh);
```

`js/chat.js`, add above `function init() {`:

```js
    // The phone's on-screen keyboard covers the bottom of the page. Chrome keeps 100dvh at full
    // height when it opens, so the chat box sat under the keyboard and Chrome scrolled the whole
    // page to reach it, pushing the header off the top (reported on Android, 2026-09-16).
    // index.html asks Chrome to shrink the page instead (interactive-widget=resizes-content).
    // Browsers that ignore that, iOS Safari among them, get the visible height copied into
    // --app-height, which chat.css uses for the app's height.
    // Pinch-zoom also shrinks visualViewport.height, by the zoom scale, so the height is multiplied
    // back by the scale, and the page is only scrolled back to the top when not zoomed.
    function fitToVisibleViewport() {
        const viewport = window.visualViewport;
        if (!viewport) return;   // no API: chat.css falls back to 100dvh
        const sync = () => {
            const height = Math.round(viewport.height * viewport.scale);
            document.documentElement.style.setProperty('--app-height', height + 'px');
            if (viewport.scale > 1.01) return;
            if (window.scrollY !== 0) window.scrollTo(0, 0);
            const focused = document.activeElement;
            if (focused === els.input) {
                scrollToBottom();
            } else if (focused && els.messages.contains(focused)) {
                focused.scrollIntoView({ block: 'nearest' });
            }
        };
        viewport.addEventListener('resize', sync);
        viewport.addEventListener('scroll', sync);
        sync();
    }

```

In `init`, directly after `els.backBtn = document.getElementById('back-btn');`, add:

```js
        fitToVisibleViewport();
```

- [ ] **Step 4: Run the offline suite**

Run: `python -m pytest -q`
Expected: all pass (3 in `tests/test_app_shell.py`).

- [ ] **Step 5: Browser check**

On `http://localhost:8000/` with `localStorage` cleared, for viewport 375×812 and then custom 375×420 (keyboard-open height):

```js
(() => {
    const r = (sel) => document.querySelector(sel).getBoundingClientRect();
    return {
        appHeight: document.documentElement.style.getPropertyValue('--app-height'),
        innerHeight: innerHeight,
        pageScroll: document.documentElement.scrollHeight - innerHeight,
        headerTop: r('.chat-header').top,
        composerBottom: Math.round(r('.composer').bottom),
        homeScrolls: document.getElementById('home').scrollHeight > document.getElementById('home').clientHeight
    };
})()
```

Expected at both sizes:
- `appHeight` equals `innerHeight` + "px";
- `pageScroll <= 0`;
- `headerTop === 0`;
- `composerBottom <= innerHeight`.

At 375×420, `homeScrolls` is true.

Then open "Nhân hai phân số" → "Cho em bài để luyện tập" and repeat at 375×420, with `#messages` in place of `#home`. Take a screenshot at 375×420. Clear `localStorage`, reset the viewport.

- [ ] **Step 6: Commit and deploy**

```bash
git add index.html chat.css js/chat.js tests/test_app_shell.py
git commit -F msg.txt   # "fix(chat): keep the chat box above the phone keyboard" + Co-Authored-By
git fetch origin && git merge-base --is-ancestor origin/main HEAD
git push origin feat/socratic-chat
git checkout main && git merge --ff-only feat/socratic-chat && git push origin main && git checkout feat/socratic-chat
```

Poll `https://meritsofmath.pages.dev/?cb=<ts>` until the served HTML contains `interactive-widget=resizes-content`. Then ask the user to test on their phone.
