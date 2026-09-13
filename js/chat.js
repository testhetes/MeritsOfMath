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
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function renderMarkdown(text) {
        const math = [];
        const shielded = text.replace(MATH_SPAN, (span) => {
            math.push(span);
            return '@@MATH' + (math.length - 1) + '@@';
        });

        let html;
        if (window.marked && window.marked.parse) {
            html = window.marked.parse(shielded, { breaks: true });
        } else {
            const div = document.createElement('div');
            div.textContent = shielded;
            html = div.innerHTML;
        }

        // Escape on restore: a formula such as \(a<b\) would otherwise be injected as HTML.
        // MathJax reads decoded text nodes, so &lt; still typesets as <.
        return html.replace(/@@MATH(\d+)@@/g, (_, i) => escapeHtml(math[Number(i)]));
    }

    // ---- MathJax typesetting: every formula gets typeset exactly once, ever ----
    //
    // Measured on the live site, 2026-09-13, against a seeded reply containing 3 formulas:
    //   after page load, no manual typeset             formulas 3   nested containers 0
    //   after 1 typesetPromise([#messages]) call        formulas 6   nested containers 3
    //   after 2 such calls                               formulas 9   nested containers 6
    // MathJax.typesetPromise() is not idempotent on content it has already typeset: it does
    // not skip or replace the existing mjx-container output, it nests a fresh copy of every
    // formula inside the one already there. The previous version of this file called
    // typesetPromise([els.messages]) -- the WHOLE conversation -- from both send() and
    // renderAll(), so every message after the one containing a formula added one more nested
    // copy of it. The fix has two parts: (1) chat.html sets startup.typeset: false so MathJax
    // never auto-typesets the page itself, making this file the only thing that ever typesets;
    // (2) every call here targets only the single element that was just created or rebuilt,
    // never a container that may already hold rendered formulas -- so nothing is ever handed
    // to typesetPromise twice. Do not "simplify" this back into one typesetPromise([els.messages])
    // call after every change; that is the exact bug this fixes.

    // The MathJax script tag is `async`, so window.MathJax can still be just the plain config
    // object from chat.html (no `.typesetPromise`) when this file's other functions run. Once
    // the library loads, it augments that same object with `startup.promise`, a promise that
    // resolves when MathJax's own startup (input/output jax, document setup) is ready --
    // see https://docs.mathjax.org/en/latest/web/typeset.html. Poll for that property so every
    // caller below waits on the exact same readiness signal instead of each guessing whether
    // MathJax has loaded yet.
    const mathJaxReadyPromise = new Promise((resolve) => {
        (function poll() {
            if (window.MathJax && window.MathJax.startup && window.MathJax.startup.promise) {
                window.MathJax.startup.promise.then(resolve);
            } else {
                setTimeout(poll, 30);
            }
        })();
    });

    // Typeset exactly one element, exactly once. `.then()` callbacks on the same promise run
    // in the order they were attached, so calls made before MathJax is ready still typeset in
    // the order they were queued once it becomes ready.
    function typesetOnce(el) {
        mathJaxReadyPromise.then(() => window.MathJax.typesetPromise([el])).catch(() => {});
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

    // skipTypeset is used only by renderAll, which typesets the whole rebuilt container once
    // itself after appending every bubble, instead of once per bubble here.
    function appendBubble(role, text, extraClass, skipTypeset) {
        const div = document.createElement('div');
        div.className = 'msg ' + (extraClass || (role === 'user' ? 'user' : 'ai'));
        div.innerHTML = renderMarkdown(text);
        els.messages.appendChild(div);
        if (!skipTypeset) typesetOnce(div);
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
        // Clear MathJax's bookkeeping for the content about to be discarded, then rebuild and
        // typeset the container exactly once -- not once per bubble, which is why appendBubble
        // is told to skip its own typeset here.
        typesetClear(els.messages);
        els.messages.innerHTML = '';
        if (history.length === 0) {
            appendBubble('assistant', t('chat.greeting'), null, true);
        } else {
            history.forEach((m) => appendBubble(m.role, m.content, null, true));
        }
        renderSuggestions();
        typesetOnce(els.messages);
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
