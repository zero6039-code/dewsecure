import { getSettings, SETTINGS_KEY } from '../settings.js';
import { cleanExpiredTempWhitelist } from '../tempWhitelistManager.js';
import { SIMPLE_KEYS } from './validators.js';
import { updateDNRRulesets } from './ruleset.js';

const SB_URL = 'https://uvbaioqqjqseapcancvi.supabase.co';
const SB_KEY = 'sb_publishable_xiiA-yt_jRKkzRdkYkoWJA_CVZjNjq8';

export async function handleGetSettings() {
    let sGet = await getSettings();
    sGet = await cleanExpiredTempWhitelist(sGet);
    const { dewsecure_user: user } = await chrome.storage.local.get('dewsecure_user');
    if (user && user.token) {
        try {
            const res = await fetch(`${SB_URL}/rest/v1/user_whitelists?select=domain`, { headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${user.token}` } });
            if (res.ok) {
                const data = await res.json();
                const cloudDomains = data.map(item => item.domain);
                sGet.whitelist = [...new Set([...(sGet.whitelist || []), ...cloudDomains])];
                await chrome.storage.local.set({ [SETTINGS_KEY]: sGet });
                const localOnly = (sGet.whitelist || []).filter(d => !cloudDomains.includes(d));
                for (const d of localOnly) {
                    fetch(`${SB_URL}/rest/v1/user_whitelists`, { method: 'POST', headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${user.token}`, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' }, body: JSON.stringify({ domain: d }) }).catch(e => console.warn(e));
                }
            }
        } catch(e) {}
    }
    const { preferred_lang } = await chrome.storage.local.get('preferred_lang');
    let lang = preferred_lang || 'en';
    if (lang === 'zh_CN' || lang === 'zh-CN') lang = 'zh';
    sGet.preferred_lang = lang;
    try {
        const res = await fetch(chrome.runtime.getURL(`popup/locales/${lang}.json`));
        if (res.ok) sGet.i18n_dict = await res.json();
    } catch (e) {}
    return sGet;
}
export async function handleUpdateSettingKey(message) {
    if (!SIMPLE_KEYS.has(message.key) || typeof message.value !== 'boolean') return { ok: false, error: 'Unauthorized setting key or invalid type' };
    let s = await getSettings();
    s[message.key] = message.value;
    await chrome.storage.local.set({ [SETTINGS_KEY]: s });
    if (message.key === 'dnrEnabled' || message.key === 'blockTrackers') await updateDNRRulesets(s.dnrEnabled, s.blockTrackers);
    return { ok: true };
}
export async function handleUpdateSettings(message) {
    let currentSettings = await getSettings();
    let hasDnrChange = false;
    for (const key of Object.keys(message.settings)) {
        if (SIMPLE_KEYS.has(key) && typeof message.settings[key] === 'boolean') {
            currentSettings[key] = message.settings[key];
            if (key === 'dnrEnabled' || key === 'blockTrackers') hasDnrChange = true;
        }
    }
    await chrome.storage.local.set({ [SETTINGS_KEY]: currentSettings });
    if (hasDnrChange) await updateDNRRulesets(currentSettings.dnrEnabled, currentSettings.blockTrackers);
    return { ok: true };
}
