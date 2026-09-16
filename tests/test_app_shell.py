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
