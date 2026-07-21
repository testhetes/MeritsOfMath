// Lightweight i18n engine. Loads before every other script so window.I18n.t is
// available everywhere. Static markup carries data-i18n / data-i18n-ph attributes;
// dynamic strings call window.I18n.t('key', { vars }). Language persists in
// localStorage and defaults to Vietnamese (the product's primary audience).
window.I18n = (function () {
    const DICT = {
        // ---- Onboarding ----
        'ob.language': { en: 'Language', vi: 'Ngôn ngữ' },
        'ob.welcome': { en: 'Welcome to Merits of Math', vi: 'Chào mừng đến với Merits of Math' },
        'ob.namePrompt': { en: 'What shall we call you?', vi: 'Chúng tôi nên gọi bạn là gì?' },
        'ob.namePlaceholder': { en: 'Enter your name...', vi: 'Nhập tên của bạn...' },
        'ob.continue': { en: 'Continue', vi: 'Tiếp tục' },
        'ob.selectPath': { en: 'Select Your Path', vi: 'Chọn lộ trình của bạn' },
        'ob.selectPathSub': { en: 'Choose your current grade level to unlock the right curriculum.', vi: 'Chọn khối lớp hiện tại để mở khóa chương trình học phù hợp.' },
        'ob.priorKnowledge': { en: 'Prior Knowledge', vi: 'Kiến thức nền tảng' },
        'ob.priorSub': { en: 'Which curriculum module have you recently covered or mastered?', vi: 'Bạn đã học hoặc thành thạo phần kiến thức nào gần đây?' },
        'ob.algebraCalculus': { en: 'Algebra & Calculus', vi: 'Đại số & Giải tích' },
        'ob.logExp': { en: 'Logarithms & Exponents', vi: 'Logarit & Lũy thừa' },
        'ob.trig': { en: 'Trigonometry', vi: 'Lượng giác' },
        'ob.deriv': { en: 'Derivatives', vi: 'Đạo hàm' },
        'ob.multiSelect': { en: 'Multi-select the specific chapters you have already mastered:', vi: 'Chọn các chương cụ thể mà bạn đã thành thạo:' },
        'ob.back': { en: 'Back', vi: 'Quay lại' },
        'ob.next': { en: 'Next', vi: 'Tiếp theo' },
        'ob.confidence': { en: 'Math Confidence', vi: 'Mức độ tự tin' },
        'ob.confidenceSub': { en: 'How do you feel about Logarithms and Exponents right now?', vi: 'Bạn cảm thấy thế nào về Logarit và Lũy thừa lúc này?' },
        'ob.beginner': { en: 'Beginner', vi: 'Mới bắt đầu' },
        'ob.expert': { en: 'Expert', vi: 'Thành thạo' },
        'ob.level': { en: 'Level:', vi: 'Cấp độ:' },
        'ob.finish': { en: 'Finish Onboarding', vi: 'Hoàn tất' },
        'ob.needNameTitle': { en: 'Identify Yourself', vi: 'Hãy cho biết tên' },
        'ob.needNameMsg': { en: 'Please enter your name to proceed.', vi: 'Vui lòng nhập tên của bạn để tiếp tục.' },
        'ob.needNameBackMsg': { en: 'Please go back to Step 1 and enter your name.', vi: 'Vui lòng quay lại Bước 1 và nhập tên của bạn.' },

        // ---- Sidebar / nav ----
        'nav.dashboard': { en: 'Dashboard', vi: 'Bảng điều khiển' },
        'nav.skilltree': { en: 'Skill Tree', vi: 'Cây kỹ năng' },
        'nav.battle': { en: 'Battle Arena', vi: 'Đấu trường' },
        'nav.settings': { en: 'Settings', vi: 'Cài đặt' },
        'quest.title': { en: 'Daily 15-Min Quest', vi: 'Nhiệm vụ 15 phút mỗi ngày' },
        'quest.mins': { en: '{n} / 15 mins', vi: '{n} / 15 phút' },
        'quest.focus': { en: 'Focus: {name}', vi: 'Trọng tâm: {name}' },
        'quest.nextUp': { en: 'Next: {name}', vi: 'Tiếp theo: {name}' },
        'quest.allMastered': { en: 'All Mastered!', vi: 'Đã thành thạo tất cả!' },
        'user.student': { en: 'Student', vi: 'Học sinh' },
        'user.level': { en: 'Grade 11 — Lvl {n}', vi: 'Lớp 11 — Cấp {n}' },

        // ---- Dashboard ----
        'dash.welcomeBack': { en: 'Welcome back,', vi: 'Chào mừng trở lại,' },
        'dash.loadingProgress': { en: 'Loading your progress...', vi: 'Đang tải tiến trình của bạn...' },
        'dash.analyzing': { en: 'Analyzing Progress...', vi: 'Đang phân tích tiến trình...' },
        'dash.calcNext': { en: 'Calculating your next best step to mastery.', vi: 'Đang tính bước tiếp theo tốt nhất để bạn thành thạo.' },
        'dash.recentMastery': { en: 'Recent Mastery', vi: 'Thành thạo gần đây' },
        'dash.noConceptsYet': { en: 'No concepts practiced yet. Start a battle to begin!', vi: 'Chưa luyện tập khái niệm nào. Hãy bắt đầu một trận đấu!' },
        'dash.progressOverview': { en: 'Progress Overview', vi: 'Tổng quan tiến trình' },
        'dash.mastered': { en: 'Mastered', vi: 'Đã thành thạo' },
        'dash.totalXP': { en: 'Total XP', vi: 'Tổng XP' },
        'dash.accuracy': { en: 'Accuracy', vi: 'Độ chính xác' },
        'dash.smartRec': { en: 'Smart Recommendations', vi: 'Gợi ý thông minh' },
        'dash.nextUnlock': { en: 'Next Unlock:', vi: 'Mở khóa tiếp theo:' },
        'dash.focusArea': { en: 'Focus Area:', vi: 'Cần tập trung:' },
        'dash.loading': { en: 'Loading...', vi: 'Đang tải...' },
        'dash.startPractice': { en: 'Start practicing to see recommendations', vi: 'Bắt đầu luyện tập để nhận gợi ý' },
        'dash.readyToLearn': { en: '{name} is ready!', vi: '{name} đã sẵn sàng!' },
        'dash.masterFirst': { en: 'Master: {names}', vi: 'Cần thành thạo: {names}' },
        'dash.reqMet': { en: 'Requirement met!', vi: 'Đã đủ điều kiện!' },
        'dash.allUnlocked': { en: 'All skills unlocked!', vi: 'Đã mở khóa mọi kỹ năng!' },
        'dash.checkTree': { en: 'Welcome back! Check your tree.', vi: 'Chào mừng trở lại! Hãy xem cây kỹ năng của bạn.' },

        // ---- Dashboard recommendation card ----
        'rec.adaptivePriority': { en: 'Adaptive Priority', vi: 'Ưu tiên thích ứng' },
        'rec.patternTag': { en: 'Pattern-Based: {pct}%', vi: 'Theo mẫu: {pct}%' },
        'rec.adaptiveBody': { en: 'Intelligence analysis suggests prioritizing <strong>{name}</strong> to optimize your mastery path.', vi: 'Phân tích cho thấy nên ưu tiên <strong>{name}</strong> để tối ưu lộ trình thành thạo của bạn.' },
        'rec.beginBattle': { en: 'Begin Socratic Battle', vi: 'Bắt đầu trận Socratic' },
        'rec.oneAction': { en: 'You have 1 recommended action based on pattern analysis.', vi: 'Bạn có 1 hành động được gợi ý dựa trên phân tích.' },
        'rec.finalChallenge': { en: 'Final Challenge', vi: 'Thử thách cuối cùng' },
        'rec.unlocked': { en: 'UNLOCKED', vi: 'ĐÃ MỞ KHÓA' },
        'rec.finalBody': { en: 'Outstanding achievement! You have reached 100% mastery in all topics. You are now prepared for the <strong>Final Exam</strong>.', vi: 'Thành tích xuất sắc! Bạn đã đạt 100% ở tất cả chủ đề. Bạn đã sẵn sàng cho <strong>Bài thi cuối kỳ</strong>.' },
        'rec.startFinal': { en: 'Start Final Exam', vi: 'Bắt đầu thi cuối kỳ' },
        'rec.finalReady': { en: "It's time. The final assessment is ready for you.", vi: 'Đã đến lúc rồi. Bài thi cuối cùng đã sẵn sàng.' },
        'rec.getStarted': { en: 'Get Started', vi: 'Bắt đầu' },
        'rec.newTag': { en: 'New', vi: 'Mới' },
        'rec.welcomeBody': { en: 'Welcome! Start your journey by mastering <strong>{name}</strong> through a Socratic battle.', vi: 'Chào mừng! Hãy bắt đầu hành trình bằng cách thành thạo <strong>{name}</strong> qua một trận Socratic.' },
        'rec.startBattle': { en: 'Start Socratic Battle', vi: 'Bắt đầu trận Socratic' },
        'rec.beginFirst': { en: 'Begin your first challenge today.', vi: 'Hãy bắt đầu thử thách đầu tiên hôm nay.' },
        'rec.strengthen': { en: 'Strengthen Foundation', vi: 'Củng cố nền tảng' },
        'rec.partialTag': { en: 'Partial: {pct}%', vi: 'Một phần: {pct}%' },
        'rec.strengthenBody': { en: "You've made progress on <strong>{name}</strong>! Continue your Socratic battle to secure this foundation.", vi: 'Bạn đã tiến bộ với <strong>{name}</strong>! Tiếp tục trận Socratic để củng cố nền tảng này.' },
        'rec.continueLearning': { en: 'Continue Learning', vi: 'Tiếp tục học' },
        'rec.buildProgress': { en: 'You have progress to build upon.', vi: 'Bạn đã có tiến trình để phát triển thêm.' },
        'rec.refineMastery': { en: 'Refine Mastery', vi: 'Hoàn thiện kỹ năng' },
        'rec.reviewTag': { en: 'Review: {pct}%', vi: 'Ôn tập: {pct}%' },
        'rec.refineBody': { en: 'Excellent foundation in <strong>{name}</strong>. Practice now to achieve perfect 100% mastery.', vi: 'Nền tảng tuyệt vời ở <strong>{name}</strong>. Luyện tập ngay để đạt 100% thành thạo.' },
        'rec.refineSkill': { en: 'Refine This Skill', vi: 'Hoàn thiện kỹ năng này' },
        'rec.master': { en: 'Master of Logarithms', vi: 'Bậc thầy Logarit' },
        'rec.champion': { en: 'Champion', vi: 'Nhà vô địch' },
        'rec.masterBody': { en: 'Legendary! You have completed the curriculum at 100% proficiency. You can review any skill anytime!', vi: 'Huyền thoại! Bạn đã hoàn thành chương trình với 100% thành thạo. Bạn có thể ôn lại bất kỳ kỹ năng nào!' },
        'rec.reviewSkill': { en: 'Review a Skill', vi: 'Ôn lại một kỹ năng' },
        'rec.complete': { en: 'Curriculum complete. You have achieved peak mastery.', vi: 'Đã hoàn thành chương trình. Bạn đã đạt đỉnh cao thành thạo.' },

        // ---- Skill tree ----
        'tree.title': { en: 'Logarithmic Functions Mastery Map', vi: 'Bản đồ thành thạo Hàm số Logarit' },
        'tree.sub': { en: 'Click on any unlocked node to view its lesson content. Red nodes are critical gaps.', vi: 'Nhấp vào nút đã mở khóa để xem nội dung bài học. Nút đỏ là lỗ hổng quan trọng.' },
        'tree.status.mastered': { en: '✅ Mastered — {pct}%', vi: '✅ Đã thành thạo — {pct}%' },
        'tree.status.partial': { en: '⚠️ In Progress — {pct}%', vi: '⚠️ Đang học — {pct}%' },
        'tree.status.critical': { en: '🔴 Needs Work — {pct}%', vi: '🔴 Cần cải thiện — {pct}%' },
        'tree.status.locked': { en: '🔒 Locked', vi: '🔒 Đã khóa' },
        'tree.practiceSkill': { en: 'Practice This Skill', vi: 'Luyện kỹ năng này' },
        'tree.startBattle': { en: 'Start Socratic Battle', vi: 'Bắt đầu trận Socratic' },
        'tree.requires': { en: 'Requires mastery of: {names}', vi: 'Yêu cầu thành thạo: {names}' },
        'tree.finalLockedTitle': { en: 'Final Exam is LOCKED', vi: 'Bài thi cuối kỳ ĐANG KHÓA' },
        'tree.finalLockedMsg': { en: 'You must master all other concepts to 100% before taking the final assessment.', vi: 'Bạn phải thành thạo 100% mọi khái niệm khác trước khi làm bài thi cuối.' },

        // ---- Battle ----
        'battle.title': { en: 'Socratic Battle Arena', vi: 'Đấu trường Socratic' },
        'battle.topicLoading': { en: 'Topic Loading...', vi: 'Đang tải chủ đề...' },
        'battle.exit': { en: 'Exit Battle', vi: 'Thoát trận' },
        'battle.inputPlaceholder': { en: 'Explanation...', vi: 'Giải thích...' },
        'battle.socraticTitle': { en: 'Socratic Battle: {name}', vi: 'Trận Socratic: {name}' },
        'battle.topic': { en: 'Topic: {name}', vi: 'Chủ đề: {name}' },
        'battle.welcomeIntro': { en: '<p>🤖 Welcome to the <strong>Socratic Battle Arena</strong>!</p><p>Let\'s master this concept step-by-step. Here\'s your first challenge:</p>', vi: '<p>🤖 Chào mừng đến với <strong>Đấu trường Socratic</strong>!</p><p>Hãy cùng thành thạo khái niệm này từng bước. Đây là thử thách đầu tiên:</p>' },
        'battle.comingSoon': { en: '<p>Coming soon! No challenges available for this node yet.</p>', vi: '<p>Sắp có! Chưa có thử thách cho nút này.</p>' },
        'battle.nextChallenge': { en: 'Next Challenge', vi: 'Thử thách tiếp theo' },
        'battle.finishBattle': { en: 'Finish Battle', vi: 'Kết thúc trận' },
        'battle.excellentNext': { en: "<p>🤖 Excellent! Here's your next challenge:</p>", vi: '<p>🤖 Tuyệt vời! Đây là thử thách tiếp theo:</p>' },
        'battle.skip': { en: 'Too hard, Skip', vi: 'Quá khó, Bỏ qua' },
        'battle.rotate': { en: "<p>No worries! Let's rotate the battlefield to another concept:</p>", vi: '<p>Không sao! Hãy chuyển sang một khái niệm khác:</p>' },
        'battle.interrupted': { en: '<p>⚠️ Connection interrupted. Please try again.</p>', vi: '<p>⚠️ Kết nối bị gián đoạn. Vui lòng thử lại.</p>' },
        'battle.complete': { en: 'Battle Complete!', vi: 'Hoàn thành trận đấu!' },
        'battle.processing': { en: 'Processing your results and updating your mastery map...', vi: 'Đang xử lý kết quả và cập nhật bản đồ thành thạo của bạn...' },

        // ---- Settings ----
        'set.title': { en: 'AI Configuration', vi: 'Cấu hình AI' },
        'set.chooseProvider': { en: 'Choose your default provider for the Socratic Battle Arena.', vi: 'Chọn nhà cung cấp AI mặc định cho Đấu trường Socratic.' },
        'set.defaultProvider': { en: 'Default Provider', vi: 'Nhà cung cấp mặc định' },
        'set.cloud': { en: 'Cloud', vi: 'Đám mây' },
        'set.local': { en: 'Local', vi: 'Cục bộ' },
        'set.cloudConfig': { en: 'Cloud Configuration', vi: 'Cấu hình đám mây' },
        'set.groqKey': { en: 'Groq API Key', vi: 'Khóa API Groq' },
        'set.localConfig': { en: 'Local Configuration (Ollama)', vi: 'Cấu hình cục bộ (Ollama)' },
        'set.ollamaUrl': { en: 'Ollama Base URL', vi: 'URL cơ sở Ollama' },
        'set.ollamaModel': { en: 'Ollama Model Name', vi: 'Tên mô hình Ollama' },
        'set.save': { en: 'Save Configurations', vi: 'Lưu cấu hình' },

        // ---- Misc / toasts ----
        'toast.levelUp': { en: 'Level Up! You are now Lvl {n}', vi: 'Lên cấp! Bạn hiện ở Cấp {n}' },
        'aiTutor.busy': { en: '⚠️ The tutor is busy right now. Please wait a moment and try again.', vi: '⚠️ Gia sư đang bận. Vui lòng chờ một lát rồi thử lại.' },
        'aiTutor.notSetup': { en: "⚠️ The AI tutor isn't set up yet. Please configure it in Settings.", vi: '⚠️ Gia sư AI chưa được thiết lập. Vui lòng cấu hình trong Cài đặt.' }
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

    // Language toggle buttons work anywhere via delegation (onboarding + sidebar).
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
