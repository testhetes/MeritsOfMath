# Chat box hidden under the phone keyboard — fix

Date: 2026-09-16. Status: approved by the user.

## Problem

On an Android phone (Chrome), tapping the chat box opens the keyboard over the bottom of the
page. The chat box is left half hidden behind the keyboard, the header scrolls off the top, and
the content area shows blank space (user screenshot, 2026-09-16 20:57).

## Cause

`chat.css` fixes the app's height to the screen: `body { height: 100dvh; display: flex; ... }`,
with the chat box as the column's last child. Since Chrome 108 the on-screen keyboard resizes only
the *visual* viewport by default (`interactive-widget=resizes-visual`); the layout viewport, and
with it `100dvh`, keeps its full height. The composer therefore stays under the keyboard, and
Chrome scrolls the whole document to bring the focused textarea into view, which moves the header
off-screen. iOS Safari behaves the same way and does not support `interactive-widget`.

## Fix

1. `index.html`: add `interactive-widget=resizes-content` to the viewport meta tag. Chrome then
   shrinks the layout viewport when the keyboard opens, and the flex column reflows above it.
2. A fallback for browsers that ignore it (iOS Safari, older Chrome). In `js/chat.js`:
   - listen to `window.visualViewport` `resize` and `scroll`;
   - set the CSS variable `--app-height` on `<html>` to `visualViewport.height` in px;
   - when that happens, scroll the document back to the top (`window.scrollTo(0, 0)`).
   - If the chat box or an answer box has focus, keep the message list scrolled to the newest
     message.
   Where `visualViewport` does not exist, nothing is set and the CSS falls back to `100dvh`.
3. `chat.css`: `body { height: var(--app-height, 100dvh); }`.

## Out of scope

The neubrutalism restyle and the maths keyboard, which are the next two pieces of work in that
order. A maths keypad may later replace the phone keyboard in practice answer boxes.

## Testing

- An on-screen keyboard cannot be opened in the in-app browser. Instead, at 375 × 812 and then at
  375 × 420 (keyboard-open height):
  - the header, the content area and the chat box are all inside the viewport;
  - `document.documentElement.scrollHeight <= innerHeight` (no page-level scroll);
  - on Home, the home list scrolls inside its own area;
  - inside a lesson, the message list scrolls inside its own area.
- The offline test suite still passes.
- Real test by the user on their Android phone after deploy: tap the chat box on Home and inside
  a lesson; the header and the chat box stay visible above the keyboard.
