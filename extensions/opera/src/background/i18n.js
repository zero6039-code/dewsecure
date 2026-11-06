// ==========================================
// 🌐 Background 多语言引擎 (内存缓存)
// ==========================================
let bgDict = {};

export function getDict() {
    return bgDict;
}

export async function loadBgI18n() {
    try {
        const res = await chrome.storage.local.get('preferred_lang');
        let lang = res.preferred_lang || navigator.language.split('-')[0].toLowerCase() || 'en';
        if (lang === 'zh_CN') lang = 'zh';

        const url = chrome.runtime.getURL(`popup/locales/${lang}.json`);
        const response = await fetch(url);
        if (response.ok) {
            bgDict = await response.json();
        }
    } catch (e) {
        console.warn('[DewSecure] 后台语言包加载失败', e);
    }
}
