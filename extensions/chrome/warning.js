const params = new URLSearchParams(window.location.search);
const badUrl = params.get('url');
const isPro = params.get('isPro') === 'true';

document.getElementById('danger-url').textContent = badUrl || 'Unknown URL';
if (!isPro) document.getElementById('pro-tip').style.display = 'block';

// 🌟 多语言引擎 (精准对齐 i18n.js 逻辑)
async function applyI18n() {
    try {
        const storage = await chrome.storage.local.get('preferred_lang');
        let targetLang = storage.preferred_lang || 'en';
        
        // 兼容旧版
        if (targetLang === 'zh_CN') targetLang = 'zh';
        
        console.log(`[Warning Page] 当前语言: ${targetLang}`);

        const url = chrome.runtime.getURL(`popup/locales/${targetLang}.json`);
        const res = await fetch(url);
        
        if (!res.ok) throw new Error('Lang not found');
        
        const data = await res.json();

        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (data[key]) {
                el.textContent = data[key];
            } else {
                console.warn(`[Warning Page] 缺少语言键: ${key}`);
            }
        });
    } catch (e) {
        console.warn('[Warning Page] i18n load failed, fallback to en', e);
    }
}
applyI18n();

document.getElementById('btn-close').onclick = () => {
    chrome.tabs.getCurrent(tab => {
        if (tab) chrome.tabs.remove(tab.id);
    });
};

document.getElementById('btn-continue').onclick = () => {
    if (badUrl) window.location.href = badUrl;
};
