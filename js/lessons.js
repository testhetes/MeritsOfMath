// Lessons: the home screen's lesson picker, and the Ghi nhớ and practice cards inside a lesson.
// All content comes from lessons.json, written and checked by people; tests/test_lessons.py
// recomputes every answer. Nothing here calls the AI: answers are checked on the device.
// js/chat.js owns the conversation. It calls in here to draw cards, and to turn them into the
// plain text the tutor sees.
//
// Everything is built with DOM methods and textContent. Text that can hold markdown or maths
// (Ghi nhớ bullets, questions) goes through ctx.fill, which is js/chat.js's sanitising pipeline.
window.Lessons = (function () {
    const DATA_URL = 'lessons.json';
    const GRADE_KEY = 'meritsGrade';

    let data = null;
    const lessonsById = new Map();

    // ---- data ----

    function load() {
        return fetch(DATA_URL)
            .then((res) => (res.ok ? res.json() : null))
            .then((json) => {
                if (json && Array.isArray(json.grades)) {
                    lessonsById.clear();
                    json.grades.forEach((grade) => grade.lessons.forEach((lesson) => lessonsById.set(lesson.id, lesson)));
                    data = json;
                }
            })
            .catch(() => {})   // offline with no cached copy: the chat works without lessons
            .then(() => data !== null);
    }

    function isReady() {
        return data !== null;
    }

    function find(id) {
        return (typeof id === 'string' && lessonsById.get(id)) || null;
    }

    function hasPractice(lesson) {
        return Boolean(lesson) && Array.isArray(lesson.ghiNho) &&
            Array.isArray(lesson.problems) && lesson.problems.length > 0;
    }

    // ---- answers ----

    // A whole number or a fraction a/b, spaces ignored. At most 6 digits a part, so the
    // cross-multiplication below stays exact. Anything else, a zero denominator included, is null.
    function parseAnswer(text) {
        const match = String(text).replace(/\s+/g, '').match(/^(\d{1,6})(?:\/(\d{1,6}))?$/);
        if (!match) return null;
        const num = Number(match[1]);
        const den = match[2] === undefined ? 1 : Number(match[2]);
        return den === 0 ? null : { num: num, den: den };
    }

    function gcd(a, b) {
        while (b) {
            [a, b] = [b, a % b];
        }
        return a;
    }

    // An equivalent fraction is correct (6/8 for 3/4) unless the problem asks to simplify.
    function checkAnswer(text, problem) {
        const given = parseAnswer(text);
        if (!given) return 'invalid';
        const expected = parseAnswer(problem.answer);
        if (given.num * expected.den !== expected.num * given.den) return 'wrong';
        if (problem.simplest && gcd(given.num, given.den) !== 1) return 'not-simplest';
        return 'correct';
    }

    // ---- conversation entries ----

    // Cards are replayed from localStorage, so a card is drawn only if everything it points at
    // still exists and has the right shape.
    function isValidCard(entry) {
        if (!entry || entry.role !== 'assistant') return false;
        const lesson = find(entry.lessonId);
        if (!lesson) return false;
        if (entry.card === 'lesson') return true;
        if (!hasPractice(lesson)) return false;
        if (entry.card === 'ghiNho') return true;
        return entry.card === 'problem' &&
            Number.isInteger(entry.index) && entry.index >= 0 && entry.index < lesson.problems.length &&
            Array.isArray(entry.attempts) && entry.attempts.every((a) => typeof a === 'string') &&
            typeof entry.solved === 'boolean';
    }

    function introText(lesson) {
        return hasPractice(lesson)
            ? 'Hôm nay mình học bài «' + lesson.title + '» nhé. Em muốn làm gì trước?'
            : 'Mình cùng tìm hiểu bài «' + lesson.title + '» nhé. Em muốn hỏi cô điều gì?';
    }

    const RESULT_WORDS = { correct: 'đúng', 'not-simplest': 'đúng nhưng chưa rút gọn', wrong: 'chưa đúng' };

    // What the tutor is told a card said. The API takes text only.
    function cardMessages(entry) {
        const lesson = find(entry.lessonId);
        if (!lesson) return [];
        if (entry.card === 'lesson') {
            return [{ role: 'assistant', content: introText(lesson) }];
        }
        if (entry.card === 'ghiNho') {
            return [{ role: 'assistant', content: 'Ghi nhớ: ' + lesson.ghiNho.join(' ') }];
        }
        if (entry.card === 'problem') {
            const problem = lesson.problems[entry.index];
            const messages = [{ role: 'assistant', content: 'Bài ' + (entry.index + 1) + ': ' + problem.question }];
            const last = entry.attempts[entry.attempts.length - 1];
            if (last !== undefined) {
                const result = RESULT_WORDS[checkAnswer(last, problem)] || 'chưa đúng';
                messages.push({ role: 'user', content: 'Em trả lời: ' + last + (problem.unit ? ' ' + problem.unit : '') + ' (' + result + ')' });
            }
            return messages;
        }
        return [];
    }

    // The child's message when they tap "Cô gợi ý". The lesson title is in it because retrieval
    // searches the child's last two messages, and the title finds the right lesson.
    function hintMessage(entry) {
        const lesson = find(entry.lessonId);
        const problem = lesson.problems[entry.index];
        const last = entry.attempts[entry.attempts.length - 1];
        return 'Cô gợi ý cho em bài «' + lesson.title + '» với ạ: ' + problem.question + ' ' +
            (last !== undefined ? 'Em làm ra ' + last + (problem.unit ? ' ' + problem.unit : '') + '.' : 'Em chưa biết bắt đầu từ đâu.');
    }

    // ---- drawing ----

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function button(label, className, onClick) {
        const node = el('button', className, label);
        node.type = 'button';
        node.addEventListener('click', onClick);
        return node;
    }

    function reducedMotion() {
        return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    // Restarts a one-off animation class (a sticker's wiggle, the answer box's shake).
    function replayAnimation(node, className) {
        if (reducedMotion()) return;
        node.classList.remove(className);
        void node.offsetWidth;   // reflow, so re-adding the class starts the animation again
        node.classList.add(className);
    }

    // A burst of small bright squares from the answer box when an answer is right.
    function celebrate(card, from) {
        if (reducedMotion()) return;
        const originX = from.offsetLeft + from.offsetWidth / 2;
        const originY = from.offsetTop + from.offsetHeight / 2;
        for (let i = 0; i < 16; i++) {
            const bit = el('span', 'confetti-bit c' + (i % 7));
            const angle = (Math.PI * 2 * i) / 16 + Math.random() * 0.4;
            const distance = 50 + Math.random() * 60;
            bit.style.left = originX + 'px';
            bit.style.top = originY + 'px';
            bit.style.setProperty('--dx', Math.round(Math.cos(angle) * distance) + 'px');
            bit.style.setProperty('--dy', Math.round(Math.sin(angle) * distance) + 'px');
            card.appendChild(bit);
            setTimeout(() => bit.remove(), 950);
        }
    }

    const GRADE_TONES = { 1: 'coral', 2: 'orange', 3: 'yellow', 4: 'green', 5: 'blue' };
    const STICKERS = ['½', '×', '÷', '='];   // the fourth shows on desktop only (chat.css)

    function currentGrade() {
        let wanted = data.defaultGrade;
        try {
            const saved = Number(localStorage.getItem(GRADE_KEY));
            if (data.grades.some((grade) => grade.grade === saved)) wanted = saved;
        } catch {
            // Storage unavailable: use the default grade.
        }
        return data.grades.find((grade) => grade.grade === wanted) || data.grades[0];
    }

    function saveGrade(number) {
        try {
            localStorage.setItem(GRADE_KEY, String(number));
        } catch {
            // Storage unavailable: the choice lasts until the page reloads.
        }
    }

    function renderHome(container, onPick) {
        container.textContent = '';
        const grade = currentGrade();

        const top = el('div', 'home-top');
        top.appendChild(el('p', 'home-greeting', 'Chào em! Hôm nay em muốn học bài nào?'));
        top.appendChild(el('p', 'home-sub', 'Chọn lớp của em, rồi chọn một bài để bắt đầu.'));
        const stickers = el('div', 'stickers');
        stickers.setAttribute('aria-hidden', 'true');
        STICKERS.forEach((symbol) => {
            const sticker = el('span', 'sticker', symbol);
            sticker.addEventListener('click', () => replayAnimation(sticker, 'wiggle'));
            sticker.addEventListener('animationend', () => sticker.classList.remove('wiggle'));
            stickers.appendChild(sticker);
        });
        top.appendChild(stickers);
        container.appendChild(top);

        const chips = el('div', 'grade-chips');
        data.grades.forEach((g) => {
            const tone = GRADE_TONES[g.grade] || 'neutral';
            const chip = button('Lớp ' + g.grade, 'btn grade-chip tone-' + tone, () => {
                saveGrade(g.grade);
                renderHome(container, onPick);
            });
            chip.setAttribute('aria-pressed', String(g.grade === grade.grade));
            chips.appendChild(chip);
        });
        container.appendChild(chips);

        container.appendChild(el('h2', 'home-heading', 'Các bài học lớp ' + grade.grade));
        const list = el('div', 'lesson-list');
        practiceFirst(grade.lessons).forEach((lesson) => {
            const card = button(undefined, 'btn lesson-card', () => onPick(lesson.id));
            card.appendChild(el('span', 'lesson-title', lesson.title));
            card.appendChild(hasPractice(lesson)
                ? el('span', 'tag tone-orange', 'Ghi nhớ · Luyện tập')
                : el('span', 'tag tone-blue', 'Hỏi cô'));
            list.appendChild(card);
        });
        container.appendChild(list);
    }

    // Lessons with Ghi nhớ and practice come first; within each group, lessons.json's order.
    function practiceFirst(lessons) {
        return lessons.filter(hasPractice).concat(lessons.filter((lesson) => !hasPractice(lesson)));
    }

    function renderCard(entry, ctx) {
        const lesson = find(entry.lessonId);
        if (!lesson) return null;
        if (entry.card === 'lesson') return lessonCard(lesson, entry, ctx);
        if (entry.card === 'ghiNho') return ghiNhoCard(lesson, entry, ctx);
        if (entry.card === 'problem') return problemCard(lesson, entry, ctx);
        return null;
    }

    function lessonCard(lesson, entry, ctx) {
        const card = el('div', 'msg ai card lesson-card-msg');
        card.appendChild(el('p', 'card-text', introText(lesson)));
        if (hasPractice(lesson)) {
            const actions = el('div', 'card-actions');
            actions.appendChild(button('Những kiến thức phải nhớ', 'btn card-btn tone-blue', () => ctx.act('ghiNho', entry)));
            actions.appendChild(button('Cho em bài để luyện tập', 'btn card-btn tone-orange', () => ctx.act('practice', entry)));
            card.appendChild(actions);
        }
        return card;
    }

    function ghiNhoCard(lesson, entry, ctx) {
        const card = el('div', 'msg ai card ghinho-card');
        card.appendChild(el('p', 'tag tone-blue', 'Ghi nhớ · ' + lesson.title));
        const list = el('ul', 'ghinho-list');
        lesson.ghiNho.forEach((point) => {
            const item = el('li');
            ctx.fill(item, point);
            list.appendChild(item);
        });
        card.appendChild(list);
        const actions = el('div', 'card-actions');
        actions.appendChild(button('Cho em bài để luyện tập', 'btn card-btn tone-orange', () => ctx.act('practice', entry)));
        card.appendChild(actions);
        return card;
    }

    const FEEDBACK = {
        correct: 'Giỏi quá! Em làm đúng rồi.',
        'not-simplest': 'Đúng rồi, nhưng em rút gọn được nữa đấy.',
        wrong: 'Chưa đúng rồi, em thử lại nhé.',
        invalid: 'Em viết số hoặc phân số, ví dụ 3/4 nhé.'
    };

    function problemCard(lesson, entry, ctx) {
        const problem = lesson.problems[entry.index];
        const total = lesson.problems.length;
        const card = el('div', 'msg ai card problem-card');

        card.appendChild(el('p', 'tag tone-orange', 'Bài ' + (entry.index + 1) + '/' + total));
        const question = el('div', 'card-text');
        ctx.fill(question, problem.question);
        card.appendChild(question);

        const form = el('form', 'answer-row');
        const input = el('input', 'answer-input');
        input.type = 'text';
        input.inputMode = 'text';   // a fraction needs the "/" key, which numeric keypads lack
        input.autocomplete = 'off';
        input.maxLength = 20;
        input.setAttribute('aria-label', 'Câu trả lời của em');
        if (window.MathPad) window.MathPad.attachAnswer(input);
        form.appendChild(input);
        if (problem.unit) form.appendChild(el('span', 'answer-unit', problem.unit));
        const check = el('button', 'btn card-btn tone-green', 'Kiểm tra');
        check.type = 'submit';
        form.appendChild(check);
        card.appendChild(form);

        const feedback = el('p', 'feedback');
        feedback.setAttribute('role', 'status');
        card.appendChild(feedback);

        const actions = el('div', 'card-actions');
        const hint = button('Cô gợi ý', 'btn card-btn tone-lavender hint', () => ctx.act('hint', entry));
        actions.appendChild(hint);
        card.appendChild(actions);

        const done = el('div', 'card-done');
        const doneActions = el('div', 'card-actions');
        if (entry.index === total - 1) {
            done.appendChild(el('p', 'finish', 'Em đã làm hết ' + total + ' bài rồi. Giỏi quá!'));
            doneActions.appendChild(button('Những kiến thức phải nhớ', 'btn card-btn tone-blue', () => ctx.act('ghiNho', entry)));
            doneActions.appendChild(button('Chọn bài khác', 'btn card-btn tone-neutral', () => ctx.act('home', entry)));
        } else {
            doneActions.appendChild(button('Bài tiếp theo', 'btn card-btn tone-cyan', () => ctx.act('next', entry)));
        }
        done.appendChild(doneActions);
        card.appendChild(done);

        function show(result) {
            feedback.textContent = result ? FEEDBACK[result] : '';
            feedback.className = 'feedback' + (result ? ' ' + result : '');
            input.disabled = entry.solved;
            check.disabled = entry.solved;
            actions.hidden = entry.solved;   // the whole row, so no empty gap is left behind
            hint.classList.toggle('highlight', result === 'wrong');
            done.hidden = !entry.solved;
            card.classList.toggle('solved', entry.solved);
        }

        form.addEventListener('submit', (event) => {
            event.preventDefault();
            if (entry.solved) return;
            const result = checkAnswer(input.value, problem);
            if (result !== 'invalid') {
                entry.attempts.push(input.value.replace(/\s+/g, ''));
                entry.solved = result === 'correct';
                ctx.act('attempt', entry);
            }
            show(result);
            if (result === 'correct') celebrate(card, input);
            if (result === 'wrong') replayAnimation(input, 'shake');
            if (entry.solved && window.MathPad) window.MathPad.release(input);
        });
        input.addEventListener('animationend', () => input.classList.remove('shake'));

        // A saved card comes back with its last attempt in the box and that attempt's result.
        const last = entry.attempts[entry.attempts.length - 1];
        if (last !== undefined) input.value = last;
        show(last !== undefined ? checkAnswer(last, problem) : null);
        return card;
    }

    return {
        load: load,
        isReady: isReady,
        find: find,
        hasPractice: hasPractice,
        parseAnswer: parseAnswer,
        checkAnswer: checkAnswer,
        isValidCard: isValidCard,
        renderHome: renderHome,
        renderCard: renderCard,
        cardMessages: cardMessages,
        hintMessage: hintMessage
    };
})();
