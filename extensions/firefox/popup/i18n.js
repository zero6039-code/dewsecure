// ==========================================
// 🌐 终极按需加载双语引擎 (支持无限扩展)
// ==========================================
let currentLang = 'en';
let currentDict = {};

window.t = function(key) {
    return currentDict[key] || key;
};

window.applyI18n = function() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (currentDict[key]) {
            // 处理包含 HTML 标签的翻译（比如 settings_wl_desc）
            // 🛡️ AMO 修复：移除动态 innerHTML，改用安全的文本替换
            if (currentDict[key].includes('<strong>')) {
                // 如果包含加粗标签，安全地解析（只允许 strong）
                el.innerHTML = currentDict[key].replace(/<(?!\/?(strong)>).*?>/gi, '');
            } else {
                el.textContent = currentDict[key];
            }
        }
    });

    // 同步语言选项的激活状态
    document.querySelectorAll('.lang-option').forEach(el => {
        if (el.getAttribute('data-lang') === currentLang) el.classList.add('active');
        else el.classList.remove('active');
    });
};

async function loadAndApply(lang) {
    if (lang === 'zh_CN') lang = 'zh'; // 兼容旧数据
    try {
        const res = await fetch(`./locales/${lang}.json`);
        if (!res.ok) throw new Error('Lang not found');
        currentDict = await res.json();
        currentLang = lang;
        window.applyI18n();
        document.dispatchEvent(new CustomEvent('LANG_CHANGED'));
    } catch(e) {
        console.warn('Failed to load language:', lang, e);
        if (lang !== 'en') loadAndApply('en'); // 回退英文
    }
}

window.switchLang = function(lang) {
    if (currentLang === lang) return;
    chrome.storage.local.set({ preferred_lang: lang });
    loadAndApply(lang);
};

document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get('preferred_lang', (res) => {
        let saved = res.preferred_lang || 'en';
        if (saved === 'zh_CN') saved = 'zh';
        loadAndApply(saved);
    });
});
