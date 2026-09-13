// The whole chat app. Talks to /api/chat in grounded mode; the Socratic prompt and the
// retrieved curriculum context are built server-side, so nothing about how the tutor is
// instructed is visible or editable here.
window.Chat = (function () {
    const ENDPOINT = '/api/chat';
    const STORAGE_KEY = 'meritsChatHistory';
    const MAX_TURNS = 30;          // trimmed before sending; the server caps again
    const SUGGESTION_KEYS = ['chat.suggest1', 'chat.suggest2', 'chat.suggest3'];

    let history = [];              // [{ role: 'user'|'assistant', content: string }]
    let sending = false;

    const els = {};

    function t(key) {
        return (window.I18n && window.I18n.t(key)) || key;
    }

    function load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            history = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(history)) history = [];
        } catch {
            history = [];
        }
    }

    function save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-MAX_TURNS * 2)));
        } catch {
            // Private browsing or full storage: the conversation still works in memory.
        }
    }

    // Maths must be shielded from marked. CommonMark treats \( \) \[ \] as escaped brackets,
    // so marked strips the backslashes and MathJax never sees the delimiters. Measured on the
    // live site, 2026-09-13: marked turned `\(1 + 2 + 3 = 6\)` into `(1 + 2 + 3 = 6)`, and
    // MathJax then rendered 0 formulas. Maths spans are swapped for placeholders before marked
    // runs and restored afterwards; the same pipeline rendered formulas that otherwise vanished.
    // $$..$$ is listed before $..$ so display maths is not split into two inline spans.
    const MATH_SPAN = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+?\$/g;

    function escapeHtml(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // marked does not sanitise: it treats any `<` in its input as the start of raw HTML and
    // passes that HTML straight through unchanged. Left alone, that means two problems at once:
    // `a<b` is parsed as an (unknown) tag and vanishes from the rendered text, and something
    // like `<img src=x onerror=...>` -- which the child can steer, since it comes from the
    // tutor's reply as well as the child's own message, and both are replayed from
    // localStorage on every future visit -- would run unchanged. So `&` and `<` are escaped
    // BEFORE marked ever sees the text; none of the markdown marked is asked to render here
    // (bold, italics, lists, > blockquotes, headings) needs a literal `&` or `<` character, so
    // this does not break legitimate formatting. `>` is left alone: escaping it is not needed
    // for safety (a lone `>` cannot open a tag) and would break `> blockquote` syntax.
    // marked's output is then sanitised again below with an allowlist, since escaping `<` on
    // the way in stops HTML from appearing in the source text but says nothing about what
    // marked itself might emit (e.g. an `<a href="javascript:...">` from a markdown link).
    function escapeAmpLt(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    }

    // Explicit allowlist for DOMPurify: only the tags/attributes marked's own Markdown syntax
    // can produce. MathJax typesets AFTER this sanitised HTML is inserted and builds its own
    // <mjx-container> elements directly in the DOM, not through this HTML string, so the
    // allowlist does not need to (and must not) include MathJax's tags.
    const SANITISE = {
        ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'blockquote',
                       'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'a',
                       'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span'],
        ALLOWED_ATTR: ['href', 'title'],
        ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i
    };

    // Renders one message's markdown+maths to an HTML string. Does NOT sanitise -- every
    // caller must pass the result through DOMPurify (see appendBubble) before it reaches
    // innerHTML. Kept as a separate step so the fail-safe in appendBubble (skip straight to
    // textContent when DOMPurify itself is unavailable) has one obvious place to live.
    function renderMarkdown(text) {
        const math = [];
        const shielded = text.replace(MATH_SPAN, (span) => {
            math.push(span);
            return '@@MATH' + (math.length - 1) + '@@';
        });

        const escaped = escapeAmpLt(shielded);

        let html;
        if (window.marked && window.marked.parse) {
            html = window.marked.parse(escaped, { breaks: true });
        } else {
            const div = document.createElement('div');
            div.textContent = escaped;
            html = div.innerHTML;
        }

        // Escape on restore: a formula such as \(a<b\) would otherwise be injected as HTML.
        // MathJax reads decoded text nodes, so &lt; still typesets as <.
        return html.replace(/@@MATH(\d+)@@/g, (_, i) => escapeHtml(math[Number(i)]));
    }

    // ---- MathJax typesetting: serialised so no element can ever be typeset twice ----
    //
    // Measured on the live site, 2026-09-13, against a seeded reply containing 3 formulas:
    //   after page load, no manual typeset             formulas 3   nested containers 0
    //   after 1 typesetPromise([#messages]) call        formulas 6   nested containers 3
    //   after 2 such calls                               formulas 9   nested containers 6
    // MathJax.typesetPromise() is not idempotent on content it has already typeset: it does
    // not skip or replace the existing mjx-container output, it nests a fresh copy of every
    // formula inside the one already there. An earlier version of this file called
    // typesetPromise on the WHOLE conversation container from renderAll() as well as
    // typesetting each new bubble individually, so a bubble added before MathJax finished
    // loading got queued once for itself and once again when the container-wide pass ran --
    // typesetting it twice back to back. That is fixed here by construction, not by care at
    // each call site: every element is typeset through the SAME function, `renderAll` typesets
    // its rebuilt bubbles exactly the way every other path does (via appendBubble, below) and
    // never separately typesets the container, and two independent guarantees make a duplicate
    // pass over any one element impossible regardless of call order or timing:
    //   1. every typeset runs off ONE promise chain (typesetQueue), so calls never run
    //      concurrently -- MathJax v3 warns against overlapping typesetPromise calls, since a
    //      retry (e.g. while autoloading a TeX extension) can otherwise interleave with another
    //      in-flight call -- and a call queued before MathJax is ready simply waits its turn
    //      once mathJaxReadyPromise resolves;
    //   2. a WeakSet records every element that has ever been queued, so even the same element
    //      passed to typesetOnce a second time (by a future bug, not by anything below today)
    //      is a no-op instead of a second pass over the same formulas.

    // The MathJax script tag is `async`, so window.MathJax can still be just the plain config
    // object from chat.html (no `.typesetPromise`) when this file's other functions run. Once
    // the library loads, it augments that same object with `startup.promise`, a promise that
    // resolves when MathJax's own startup (input/output jax, document setup) is ready --
    // see https://docs.mathjax.org/en/latest/web/typeset.html. Poll for that property so every
    // caller below waits on the exact same readiness signal instead of each guessing whether
    // MathJax has loaded yet. (This poll is unbounded if the MathJax script never loads at all,
    // e.g. the CDN is unreachable -- a separately recorded minor issue, not changed here.)
    const mathJaxReadyPromise = new Promise((resolve) => {
        (function poll() {
            if (window.MathJax && window.MathJax.startup && window.MathJax.startup.promise) {
                window.MathJax.startup.promise.then(resolve);
            } else {
                setTimeout(poll, 30);
            }
        })();
    });

    // Elements already typeset, or already queued to be. Belt-and-braces alongside the
    // serialised queue below: two independent reasons the same element can never be
    // typeset twice.
    const typesetSeen = new WeakSet();

    // Every typeset chains off this single promise, so calls run strictly one after another,
    // in the order typesetOnce was called, starting only once MathJax itself is ready.
    let typesetQueue = mathJaxReadyPromise;

    // Typeset one element, at most once, once MathJax is ready and every typeset queued before
    // it has finished. Skips elements no longer on the page (e.g. a bubble cleared by
    // renderAll before its queued turn arrived).
    function typesetOnce(el) {
        if (typesetSeen.has(el)) return;
        typesetSeen.add(el);
        typesetQueue = typesetQueue
            .then(() => el.isConnected && window.MathJax.typesetPromise([el]))
            .catch(() => {});
    }

    // Drop MathJax's bookkeeping for math inside `el` before its DOM nodes are discarded (used
    // by renderAll, which replaces #messages's innerHTML). If MathJax hasn't loaded yet there is
    // nothing rendered to clear, so this is a safe no-op in that case.
    function typesetClear(el) {
        if (window.MathJax && window.MathJax.typesetClear) {
            window.MathJax.typesetClear([el]);
        }
    }

    function scrollToBottom() {
        els.messages.scrollTop = els.messages.scrollHeight;
    }

    function appendBubble(role, text, extraClass) {
        const div = document.createElement('div');
        div.className = 'msg ' + (extraClass || (role === 'user' ? 'user' : 'ai'));
        // DOMPurify sanitises marked's output against an explicit allowlist before it ever
        // reaches innerHTML -- marked itself does not sanitise, and both the child's own
        // message and the tutor's reply (which the child can steer) are saved to localStorage
        // and replayed on every future visit, so unsanitised HTML here would run again and
        // again. If DOMPurify itself is unavailable (its CDN script blocked or failed to load),
        // fail safe: render as plain text via textContent rather than ever falling back to
        // unsanitised innerHTML.
        if (window.DOMPurify && window.DOMPurify.sanitize) {
            div.innerHTML = window.DOMPurify.sanitize(renderMarkdown(text), SANITISE);
        } else {
            div.textContent = text;
        }
        els.messages.appendChild(div);
        typesetOnce(div);
        return div;
    }

    function showTyping() {
        const div = document.createElement('div');
        div.className = 'typing';
        div.id = 'typing';
        // The animation is three dots, which conveys nothing to a screen reader.
        div.setAttribute('role', 'status');
        div.setAttribute('aria-label', t('chat.thinking'));
        div.innerHTML = '<span></span><span></span><span></span>';
        els.messages.appendChild(div);
        scrollToBottom();
    }

    function hideTyping() {
        const el = document.getElementById('typing');
        if (el) el.remove();
    }

    function renderAll() {
        // Clear MathJax's bookkeeping for the content about to be discarded, then rebuild.
        // Each bubble typesets itself through appendBubble, the same as every other path --
        // there is no separate container-wide typeset here (see the comment above typesetOnce
        // for why that used to duplicate formulas).
        typesetClear(els.messages);
        els.messages.innerHTML = '';
        if (history.length === 0) {
            appendBubble('assistant', t('chat.greeting'));
        } else {
            history.forEach((m) => appendBubble(m.role, m.content));
        }
        renderSuggestions();
        scrollToBottom();
    }

    function renderSuggestions() {
        els.suggestions.innerHTML = '';
        if (history.length > 0) return;   // only offer openers on an empty conversation
        SUGGESTION_KEYS.forEach((key) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = t(key);
            btn.addEventListener('click', () => send(btn.textContent));
            els.suggestions.appendChild(btn);
        });
    }

    async function send(text) {
        const message = (text || '').trim();
        if (!message || sending) return;

        sending = true;
        els.sendBtn.disabled = true;
        els.input.value = '';
        autoGrow();

        history.push({ role: 'user', content: message });
        appendBubble('user', message);   // typesets itself; see typesetOnce
        els.suggestions.innerHTML = '';
        scrollToBottom();
        showTyping();

        try {
            const res = await fetch(ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: history.slice(-MAX_TURNS * 2),
                    ground: true,
                    lang: window.I18n ? window.I18n.getLang() : 'vi',
                    max_tokens: 220
                })
            });

            hideTyping();

            if (!res.ok) {
                appendBubble('assistant', t('chat.error'), 'error');
                history.pop();      // drop the unanswered turn so a retry is clean
                return;
            }

            const data = await res.json();
            const reply = (data.choices && data.choices[0] && data.choices[0].message.content) || '';
            if (!reply.trim()) {
                appendBubble('assistant', t('chat.error'), 'error');
                history.pop();
                return;
            }

            history.push({ role: 'assistant', content: reply });
            appendBubble('assistant', reply);   // typesets itself; see typesetOnce
            save();
        } catch {
            hideTyping();
            appendBubble('assistant', t('chat.error'), 'error');
            history.pop();
        } finally {
            sending = false;
            els.sendBtn.disabled = false;
            scrollToBottom();
            els.input.focus();
        }
    }

    function autoGrow() {
        els.input.style.height = 'auto';
        els.input.style.height = Math.min(els.input.scrollHeight, 120) + 'px';
    }

    function clearConversation() {
        history = [];
        save();
        renderAll();
    }

    // The i18n engine handles data-i18n text and data-i18n-ph placeholders, but not
    // title/aria attributes, so those are set here and refreshed on language change.
    function applyLabels() {
        els.clearBtn.title = t('chat.clear');
        els.clearBtn.setAttribute('aria-label', t('chat.clear'));
    }

    function init() {
        els.messages = document.getElementById('messages');
        els.suggestions = document.getElementById('suggestions');
        els.input = document.getElementById('input');
        els.sendBtn = document.getElementById('send-btn');
        els.composer = document.getElementById('composer');
        els.clearBtn = document.getElementById('clear-btn');

        load();
        applyLabels();
        renderAll();

        els.composer.addEventListener('submit', (e) => {
            e.preventDefault();
            send(els.input.value);
        });

        els.input.addEventListener('input', autoGrow);

        // Enter sends; Shift+Enter makes a new line. On touch devices the on-screen
        // keyboard's return key should insert a newline instead, so only bind this
        // when a fine pointer is present.
        els.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) {
                e.preventDefault();
                send(els.input.value);
            }
        });

        els.clearBtn.addEventListener('click', clearConversation);

        // Re-render on language change so the greeting and suggestions switch language.
        document.addEventListener('langchange', () => {
            applyLabels();
            if (history.length === 0) renderAll();
            else renderSuggestions();
        });
    }

    document.addEventListener('DOMContentLoaded', init);

    return { send: send, clear: clearConversation };
})();
