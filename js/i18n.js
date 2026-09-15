// Lightweight i18n engine. Loads before every other script so window.I18n.t is
// available everywhere. Static markup carries data-i18n / data-i18n-ph attributes;
// dynamic strings call window.I18n.t('key', { vars }). Language persists in
// localStorage and defaults to Vietnamese (the product's primary audience).
window.I18n = (function () {
    // Only the chat's strings. The retired skill-tree game's onboarding, dashboard, battle and
    // Settings strings were removed with it; index.html and js/chat.js use chat.* keys only.
    const DICT = {
        'chat.title': { en: 'Merits of Math', vi: 'Merits of Math' },
        'chat.subtitle': { en: 'Your maths tutor', vi: 'Gia sư toán của em' },
        'chat.placeholder': { en: 'Ask me about maths...', vi: 'Hỏi cô về toán...' },
        'chat.send': { en: 'Send', vi: 'Gửi' },
        'chat.greeting': { en: "Hello! I'm here to help you think through maths problems. What are you working on?", vi: 'Chào em! Cô ở đây để giúp em tự tìm ra lời giải. Hôm nay em đang học bài gì?' },
        'chat.suggest1': { en: 'I don\'t understand carrying', vi: 'Em không hiểu phép cộng có nhớ' },
        'chat.suggest2': { en: 'What is a fraction?', vi: 'Phân số là gì ạ?' },
        'chat.suggest3': { en: 'Help me with times tables', vi: 'Giúp em học bảng nhân' },
        'chat.thinking': { en: 'Thinking...', vi: 'Đang suy nghĩ...' },
        'chat.error': { en: 'The tutor is busy. Please try again in a moment.', vi: 'Gia sư đang bận. Em thử lại sau giây lát nhé.' },
        'chat.clear': { en: 'New conversation', vi: 'Cuộc trò chuyện mới' },
    };

    let lang = localStorage.getItem('meritsLang') || 'vi';

    function t(key, vars) {
        const entry = DICT[key];
        let str = entry ? (entry[lang] != null ? entry[lang] : entry.en) : key;
        if (vars) {
            Object.keys(vars).forEach((k) => {
                str = str.split('{' + k + '}').join(vars[k]);
            });
        }
        return str;
    }

    function apply(root) {
        root = root || document;
        root.querySelectorAll('[data-i18n]').forEach((el) => {
            el.textContent = t(el.getAttribute('data-i18n'));
        });
        root.querySelectorAll('[data-i18n-ph]').forEach((el) => {
            el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
        });
        document.documentElement.lang = lang;
        document.querySelectorAll('[data-lang-btn]').forEach((btn) => {
            btn.classList.toggle('lang-active', btn.getAttribute('data-lang-btn') === lang);
        });
    }

    function setLang(l) {
        lang = (l === 'en') ? 'en' : 'vi';
        localStorage.setItem('meritsLang', lang);
        apply();
        document.dispatchEvent(new CustomEvent('langchange', { detail: { lang: lang } }));
    }

    function getLang() { return lang; }

    // Language toggle buttons (the header's VI / EN buttons) work via delegation.
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-lang-btn]');
        if (btn) {
            e.preventDefault();
            setLang(btn.getAttribute('data-lang-btn'));
        }
    });

    // Apply the saved language as soon as the DOM is ready (this script loads first).
    document.addEventListener('DOMContentLoaded', () => apply());

    return { t: t, apply: apply, setLang: setLang, getLang: getLang, DICT: DICT };
})();
