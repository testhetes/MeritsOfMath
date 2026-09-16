// The chat app. Talks to /api/chat in grounded mode; the Socratic prompt and the retrieved
// curriculum context are built server-side, so nothing about how the tutor is instructed is
// visible or editable here. The home screen's lesson picker and the lesson cards (Ghi nhớ,
// practice) are drawn by js/lessons.js; this file owns the conversation they live in.
window.Chat = (function () {
    const ENDPOINT = '/api/chat';
    const STORAGE_KEY = 'meritsChatHistory';
    const MAX_TURNS = 30;          // trimmed before sending; the server caps again
    // Every word the chat shows. The app is Vietnamese only; its English mode was removed on
    // 2026-09-16.
    const TEXT = {
        greeting: 'Chào em! Cô ở đây để giúp em tự tìm ra lời giải. Hôm nay em đang học bài gì?',
        thinking: 'Đang suy nghĩ...',
        error: 'Gia sư đang bận. Em thử lại sau giây lát nhé.'
    };

    // Text entries { role: 'user'|'assistant', content } and card entries drawn by js/lessons.js,
    // e.g. { role: 'assistant', card: 'problem', lessonId, index, attempts, solved }.
    let history = [];
    let sending = false;
    let ready = false;             // true once lessons.json has loaded or failed to

    const els = {};

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

    // Keys written by code that no longer exists: the retired skill-tree game (js/aiTutor.js,
    // js/progression.js) and the retired English toggle (meritsLang). The values persist in every
    // visitor's browser on this origin — including any Groq API key a user once pasted into the
    // old Settings modal. Remove them. The chat's own key, meritsChatHistory, is deliberately NOT
    // in this list.
    const RETIRED_KEYS = ['groqApiKey', 'localApiBaseUrl', 'localModelName', 'aiProvider', 'meritsProfile_v2', 'meritsLang'];

    function clearRetiredStorage() {
        try {
            RETIRED_KEYS.forEach((key) => localStorage.removeItem(key));
        } catch {
            // Storage is unavailable, so the retired game could never have stored anything here.
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

    // marked does not sanitise: raw HTML in its input (`<img src=x onerror=...>`, `<style>`,
    // `<base href>`) goes straight through its `html` renderer, and `a<b va b>c` is parsed as a
    // tag and vanishes. The tutor's reply reaches this code (the child's own message is shown as
    // plain text, see appendBubble); the child can steer that reply, and it is replayed from
    // localStorage on every visit. So that
    // one renderer method is overridden to show raw HTML as visible text. marked.use extends
    // marked's renderer rather than replacing it, and this runs once, when the module loads.
    // Everything else (text, code spans, fenced code) marked escapes itself, exactly once.
    // An earlier version escaped `&` and `<` before marked ran instead; marked then escaped
    // code a second time, so `a<b` in backticks displayed as `a&lt;b` (measured, 2026-09-14).
    // marked 18 (pinned in index.html) passes a token; the string branch is for older versions.
    //
    // `text` is overridden for the same reason. After an inline <pre>, <code>, <kbd> or <script>
    // tag, marked's lexer treats the following text as raw, and its text renderer emits that text
    // unescaped (marked 18.0.13 src/Tokenizer.ts:704-707 and 1041, src/Renderer.ts:198-201). It
    // never passes through `html` above, so `Thu <kbd>x<y/z</kbd> va b>c` lost everything after
    // "x" (measured 2026-09-14). That raw text is escaped here. Every other text token returns
    // false, which falls back to marked's own renderer (src/Instance.ts:177-182).
    if (window.marked && window.marked.use) {
        window.marked.use({
            renderer: {
                html(token) {
                    return escapeHtml(typeof token === 'string' ? token : token.text);
                },
                text(token) {
                    if (token && typeof token === 'object' && token.escaped && !token.tokens) {
                        return escapeHtml(token.text);
                    }
                    return false;
                }
            }
        });
    }

    // Explicit allowlist for DOMPurify, applied to marked's output: formatting tags only.
    // Links are deliberately NOT allowed. marked turns markdown links, <url> autolinks, bare
    // URLs, www. hosts and email addresses into <a>, and a reply the child can steer could
    // then put a one-tap link off this site in front of a 6-10-year-old -- measured on the
    // live site, 2026-09-14, where tapping such a link navigated the chat tab away. With `a`
    // off the list DOMPurify drops the element but keeps its visible text: a bare URL still
    // reads as the address, a markdown link as its label only. `start` keeps a numbered list
    // that resumes after a paragraph numbered correctly.
    // MathJax builds its own elements AFTER this sanitising, directly in the DOM, so nothing
    // here restricts them: index.html restricts MathJax with its ui/safe extension instead.
    const SANITISE = {
        ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'blockquote',
                       'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr',
                       'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span'],
        ALLOWED_ATTR: ['start']
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

        let html;
        if (window.marked && window.marked.parse) {
            html = window.marked.parse(shielded, { breaks: true });
        } else {
            // No marked: show the text as it is, escaped exactly once by the browser.
            const div = document.createElement('div');
            div.textContent = shielded;
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
    // object from index.html (no `.typesetPromise`) when this file's other functions run. Once
    // the library loads, it augments that same object with `startup.promise`, a promise that
    // resolves when MathJax's own startup (input/output jax, document setup) is ready --
    // see https://docs.mathjax.org/en/latest/web/typeset.html. Poll for that property so every
    // caller below waits on the exact same readiness signal instead of each guessing whether
    // MathJax has loaded yet. (This poll is unbounded if the MathJax script never loads at all,
    // e.g. the CDN is unreachable -- a separately recorded minor issue, not changed here.)
    //
    // Readiness also means the maths is locked down; until it is, nothing typesets.
    // - index.html loads MathJax's ui/safe extension, but a safe.js that downloads and never runs
    //   (a truncated or corrupt body) would let MathJax start without it. So the document must
    //   actually carry `safe`.
    // - ui/safe does not filter fontfamily, fontweight or fontstyle, and MathJax copies those raw
    //   into a style string. `\mmlToken{mi}[fontfamily="x;position:fixed;..."]` and
    //   `\unicode[x;position:fixed;...]` covered the whole page, clear button included (measured
    //   2026-09-14). So a TeX post-filter deletes those three attributes from every node.
    // The filter runs at priority -5.4: after ui/safe's own filter (-5.5), and before MathJax
    // copies attributes down to child nodes (setInherited, -5), because the output reads
    // inherited values too (MathJax-src 3.2.2 ts/input/tex.ts:142-147,
    // ts/output/common/Wrapper.ts:439-453). The null guard is defensive: a token node's walkTree
    // skips its text children (ts/core/MmlTree/MmlNode.ts:879-887), and the empty nodes that hold
    // text have no attributes object (MmlNode.ts:1126). The filter must not return false,
    // which would stop the filters after it.
    // If the safe check fails, the promise never resolves and maths stays as plain text.
    function lockDownMathJax() {
        const doc = window.MathJax.startup.document;
        if (!doc || !doc.safe) return false;
        doc.inputJax.forEach((jax) => {
            if (jax.name !== 'TeX') return;
            jax.postFilters.add(({ data }) => {
                data.root.walkTree((node) => {
                    const attributes = node.attributes && node.attributes.getAllAttributes();
                    if (attributes) {
                        delete attributes.fontfamily;
                        delete attributes.fontweight;
                        delete attributes.fontstyle;
                    }
                });
            }, -5.4);
        });
        return true;
    }

    const mathJaxReadyPromise = new Promise((resolve) => {
        (function poll() {
            if (window.MathJax && window.MathJax.startup && window.MathJax.startup.promise) {
                window.MathJax.startup.promise.then(() => {
                    if (lockDownMathJax()) resolve();
                });
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

    // Fills `el` with markdown and maths, sanitised, and queues it for typesetting. Tutor replies,
    // Ghi nhớ bullets and practice questions all go through here.
    function fillRich(el, text) {
        if (window.DOMPurify && window.DOMPurify.sanitize) {
            // DOMPurify sanitises marked's output against an explicit allowlist before it reaches
            // innerHTML: marked itself does not sanitise, the child can steer the tutor's reply,
            // and it is replayed from localStorage on every future visit, so unsanitised HTML
            // here would run again and again. If DOMPurify is unavailable (its CDN script blocked
            // or failed to load), fail safe: plain text, never unsanitised innerHTML.
            el.innerHTML = window.DOMPurify.sanitize(renderMarkdown(text), SANITISE);
        } else {
            el.textContent = text;
        }
        typesetOnce(el);
    }

    function appendBubble(role, text, extraClass) {
        const div = document.createElement('div');
        div.className = 'msg ' + (extraClass || (role === 'user' ? 'user' : 'ai'));
        els.messages.appendChild(div);
        if (role === 'user') {
            // The child's own message is shown exactly as typed, never as markdown. A child
            // types `2*3*4` to multiply, and markdown turned it into 2<em>3</em>4, which read as
            // "234" (confirmed on the live site, 2026-09-15); lines starting "1.", "-" or "#"
            // likewise became lists or headings. textContent cannot carry HTML, and chat.css
            // keeps the child's line breaks. MathJax still typesets any maths the child typed,
            // under the same lock-down as every other bubble.
            div.textContent = text;
            typesetOnce(div);
        } else {
            fillRich(div, text);
        }
        return div;
    }

    // A card entry is drawn by js/lessons.js; a text entry is a bubble.
    function appendEntry(entry) {
        if (entry.card === undefined) return appendBubble(entry.role, entry.content);
        const card = window.Lessons.renderCard(entry, { fill: fillRich, act: onCardAction });
        if (card) els.messages.appendChild(card);
        return card;
    }

    // Saved entries are replayed from localStorage, so each is checked before it is drawn. A card
    // must still point at a lesson (and problem) in lessons.json.
    function isValidEntry(entry) {
        if (!entry || typeof entry !== 'object') return false;
        if (entry.card !== undefined) {
            return Boolean(window.Lessons && window.Lessons.isReady() && window.Lessons.isValidCard(entry));
        }
        return (entry.role === 'user' || entry.role === 'assistant') && typeof entry.content === 'string';
    }

    // What the tutor sees. The API takes { role, content } text only, so cards become the
    // sentences they show, and neighbouring messages from the same speaker are joined.
    function toApiMessages(entries) {
        const out = [];
        entries.forEach((entry) => {
            const parts = entry.card === undefined
                ? [{ role: entry.role, content: entry.content }]
                : window.Lessons.cardMessages(entry);
            parts.forEach((part) => {
                const last = out[out.length - 1];
                if (last && last.role === part.role) {
                    last.content += '\n\n' + part.content;
                } else {
                    out.push({ role: part.role, content: part.content });
                }
            });
        });
        return out;
    }

    function showTyping() {
        const div = document.createElement('div');
        div.className = 'typing';
        div.id = 'typing';
        // The animation is three dots, which conveys nothing to a screen reader.
        div.setAttribute('role', 'status');
        div.setAttribute('aria-label', TEXT.thinking);
        div.innerHTML = '<span></span><span></span><span></span>';
        els.messages.appendChild(div);
        scrollToBottom();
    }

    function hideTyping() {
        const el = document.getElementById('typing');
        if (el) el.remove();
    }

    // Home when there is no conversation and lessons.json loaded; otherwise the conversation.
    // If lessons.json could not load, this is the plain chat: greeting, ↻ button, no Home.
    function renderAll() {
        // Clear MathJax's bookkeeping for the content about to be discarded, then rebuild.
        // Each bubble typesets itself through appendBubble, the same as every other path --
        // there is no separate container-wide typeset here (see the comment above typesetOnce
        // for why that used to duplicate formulas).
        typesetClear(els.messages);
        els.messages.innerHTML = '';
        const lessonsReady = Boolean(window.Lessons && window.Lessons.isReady());
        const atHome = lessonsReady && history.length === 0;
        els.home.hidden = !atHome;
        els.messages.hidden = atHome;
        els.backBtn.hidden = !lessonsReady || atHome;
        els.clearBtn.hidden = lessonsReady;
        if (atHome) {
            window.Lessons.renderHome(els.home, startLesson);
        } else if (history.length === 0) {
            appendBubble('assistant', TEXT.greeting);
        } else {
            history.forEach(appendEntry);
        }
        scrollToBottom();
    }

    function startLesson(lessonId) {
        if (sending) return;
        history = [{ role: 'assistant', card: 'lesson', lessonId: lessonId }];
        save();
        renderAll();
        if (!window.Lessons.hasPractice(window.Lessons.find(lessonId))) els.input.focus();
    }

    // Adds a card under the conversation. Not while a reply is on its way: the reply would land
    // under the new card, answering something the child did not just ask.
    function pushEntry(entry) {
        if (sending) return;
        history.push(entry);
        save();
        const card = appendEntry(entry);
        const answer = card && card.querySelector('.answer-input');
        if (answer) answer.focus();
        scrollToBottom();
    }

    function onCardAction(action, entry) {
        const lessonId = entry.lessonId;
        if (action === 'ghiNho') {
            pushEntry({ role: 'assistant', card: 'ghiNho', lessonId: lessonId });
        } else if (action === 'practice') {
            pushEntry({ role: 'assistant', card: 'problem', lessonId: lessonId, index: 0, attempts: [], solved: false });
        } else if (action === 'next') {
            pushEntry({ role: 'assistant', card: 'problem', lessonId: lessonId, index: entry.index + 1, attempts: [], solved: false });
        } else if (action === 'attempt') {
            save();   // the card recorded the attempt on `entry`, which is the object in history
        } else if (action === 'hint') {
            send(window.Lessons.hintMessage(entry));
        } else if (action === 'home') {
            clearConversation();
        }
    }

    async function send(text) {
        const message = (text || '').trim();
        if (!message || sending || !ready) return;

        sending = true;
        els.sendBtn.disabled = true;
        els.input.value = '';
        autoGrow();

        history.push({ role: 'user', content: message });
        if (els.messages.hidden) {
            renderAll();                     // leaving Home: draws the conversation, this message included
        } else {
            appendBubble('user', message);   // typesets itself; see typesetOnce
        }
        scrollToBottom();
        showTyping();

        try {
            const res = await fetch(ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: toApiMessages(history.slice(-MAX_TURNS * 2)),
                    ground: true,
                    max_tokens: 220
                })
            });

            hideTyping();

            if (!res.ok) {
                appendBubble('assistant', TEXT.error, 'error');
                history.pop();      // drop the unanswered turn so a retry is clean
                return;
            }

            const data = await res.json();
            const reply = (data.choices && data.choices[0] && data.choices[0].message.content) || '';
            if (!reply.trim()) {
                appendBubble('assistant', TEXT.error, 'error');
                history.pop();
                return;
            }

            history.push({ role: 'assistant', content: reply });
            appendBubble('assistant', reply);   // typesets itself; see typesetOnce
            save();
        } catch {
            hideTyping();
            appendBubble('assistant', TEXT.error, 'error');
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
        if (sending) return;   // a reply on its way would otherwise land in the next conversation
        history = [];
        save();
        renderAll();
    }

    function init() {
        clearRetiredStorage();   // first, before load() reads the conversation (see RETIRED_KEYS)
        els.home = document.getElementById('home');
        els.messages = document.getElementById('messages');
        els.input = document.getElementById('input');
        els.sendBtn = document.getElementById('send-btn');
        els.composer = document.getElementById('composer');
        els.clearBtn = document.getElementById('clear-btn');
        els.backBtn = document.getElementById('back-btn');

        load();

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
        els.backBtn.addEventListener('click', clearConversation);

        // Cards need lessons.json, so nothing is drawn, and nothing can be sent, until it has
        // loaded or failed to.
        const lessonsLoaded = window.Lessons ? window.Lessons.load() : Promise.resolve(false);
        lessonsLoaded.then(() => {
            history = history.filter(isValidEntry);
            ready = true;
            els.sendBtn.disabled = false;
            renderAll();
        });
    }

    document.addEventListener('DOMContentLoaded', init);

    return { send: send, clear: clearConversation };
})();
