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


def test_maths_keypad_is_wired_into_the_page():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    assert 'id="mathpad"' in html and 'id="mathpad-toggle"' in html
    scripts = re.findall(r'<script src="(js/[a-z]+\.js)"></script>', html)
    assert scripts == ["js/mathpad.js", "js/lessons.js", "js/chat.js"], scripts
    assert "mathpad.js" in "".join(_app_shell())


def test_keypad_pops_up_on_mouse_and_keyboard_devices():
    """A full-width docked keypad looked out of place on a desktop (2026-09-17)."""
    js = (ROOT / "js" / "mathpad.js").read_text(encoding="utf-8")
    assert "(hover: hover) and (pointer: fine)" in js
    css = (ROOT / "chat.css").read_text(encoding="utf-8")
    assert ".mathpad-popup" in css and ".keypad-btn" in css
