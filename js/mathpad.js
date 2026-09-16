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
