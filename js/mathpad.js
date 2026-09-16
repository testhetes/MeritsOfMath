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
    let pointerIsDown = false;

    // Closing the answer keypad moves the conversation: the keypad is taller than the chat box it
    // gives back. If that happened between a tap's press and its release, the release would land
    // on a different element and the tap would be lost (a child tapping the card's own "Kiểm tra"
    // or "Cô gợi ý" had to tap twice). So a close waits until the tap in progress has finished.
    function afterTap(fn) {
        if (!pointerIsDown) {
            setTimeout(fn, 0);
            return;
        }
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            document.removeEventListener('pointerup', finish, true);
            document.removeEventListener('pointercancel', finish, true);
            setTimeout(fn, 0);
        };
        document.addEventListener('pointerup', finish, true);
        document.addEventListener('pointercancel', finish, true);
    }

    // Keys and the toggle never take focus, so the field being typed into keeps its caret.
    function keepFocus(node) {
        node.addEventListener('pointerdown', (event) => event.preventDefault());
        node.addEventListener('mousedown', (event) => event.preventDefault());
    }

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
        keepFocus(node);
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
        // The answer box was removed from the page without a blur (not every browser fires one).
        if (answerInput && !answerInput.isConnected) release(answerInput);
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
            // Don't split an emoji typed on the phone keyboard (two UTF-16 code units).
            if (start > 0 && /[\uDC00-\uDFFF]/.test(field.value[start]) && /[\uD800-\uDBFF]/.test(field.value[start - 1])) {
                start -= 1;
            }
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
            if (input.disabled) return;
            lastValid = PARTIAL_ANSWER.test(input.value) ? input.value : '';
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
        if (answerInput !== input) return;
        answerInput = null;
        els.composer.hidden = false;
        if (chatOn) {
            render('chat');
        } else {
            hide();
        }
    }

    // Drops any answer box the keypad was typing into, for js/chat.js to call before it rebuilds the
    // conversation: the rebuilt cards are new elements, and the old box may never fire blur.
    function reset() {
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
        document.addEventListener('pointerdown', () => { pointerIsDown = true; }, true);
        document.addEventListener('pointerup', () => { pointerIsDown = false; }, true);
        document.addEventListener('pointercancel', () => { pointerIsDown = false; }, true);
        els.toggle.hidden = false;
        keepFocus(els.toggle);
        els.toggle.addEventListener('click', () => setChat(!chatOn));
    }

    return { init: init, attachAnswer: attachAnswer, release: release, reset: reset };
})();
