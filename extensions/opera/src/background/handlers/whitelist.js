import { getSettings, SETTINGS_KEY } from '../settings.js';
import { getOrCreateRuleIdUnsafe, removeRuleIdMappingUnsafe, withLock } from '../dnrOwner.js';
import { cleanExpiredTempWhitelist, removeTempWhitelist } from '../tempWhitelistManager.js';
import { isValidWhitelistDomain } from './validators.js';

const SB_URL = 'https://uvbaioqqjqseapcancvi.supabase.co';
const SB_KEY = 'sb_publishable_xiiA-yt_jRKkzRdkYkoWJA_CVZjNjq8';

export async function handleAddWhitelist(message) {
    let curSettings = await getSettings();
    if (!isValidWhitelistDomain(message.domain)) return { ok: false, error: '格式非法或公共后缀' };
    if (!curSettings.whitelist.includes(message.domain)) {
        curSettings.whitelist.push(message.domain);
        await chrome.storage.local.set({ [SETTINGS_KEY]: curSettings });
        const { dewsecure_user: addUser } = await chrome.storage.local.get('dewsecure_user');
        if (addUser && addUser.token) {
            try {
                await fetch(`${SB_URL}/rest/v1/user_whitelists`, { method: 'POST', headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${addUser.token}`, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' }, body: JSON.stringify({ domain: message.domain }) });
            } catch(e) {}
        }
    }
    return { ok: true, whitelist: curSettings.whitelist };
}
export async function handleRemoveWhitelist(message) {
    let remSettings = await getSettings();
    remSettings.whitelist = remSettings.whitelist.filter(d => d !== message.domain);
    await chrome.storage.local.set({ [SETTINGS_KEY]: remSettings });
    const { dewsecure_user: remUser } = await chrome.storage.local.get('dewsecure_user');
    if (remUser && remUser.token) {
        try {
            await fetch(`${SB_URL}/rest/v1/user_whitelists?domain=eq.${message.domain}`, { method: 'DELETE', headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${remUser.token}` } });
        } catch(e) {}
    }
    return { ok: true, whitelist: remSettings.whitelist };
}
export async function handleAddTempWhitelist(message) {
    if (!isValidWhitelistDomain(message.domain)) return { ok: false, error: '格式非法或公共后缀' };
    return await withLock(async () => {
        try {
            let settings = await getSettings();
            settings = await cleanExpiredTempWhitelist(settings);
            if (!settings.tempWhitelistExpiry) settings.tempWhitelistExpiry = {};
            if (!settings.tempWhitelist.includes(message.domain)) settings.tempWhitelist.push(message.domain);
            settings.tempWhitelistExpiry[message.domain] = Date.now() + 24 * 60 * 60 * 1000;
            await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
            if (message.domain === 'dewsecure.com' || message.domain.endsWith('.dewsecure.com')) return { ok: true };
            const ruleId = await getOrCreateRuleIdUnsafe(message.domain);
            await chrome.declarativeNetRequest.updateSessionRules({
                removeRuleIds: [ruleId],
                addRules: [{ id: ruleId, priority: 2147483647, action: { type: 'allow' }, condition: { requestDomains: [message.domain], resourceTypes: ["main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "webtransport", "webbundle", "other"] } }]
            });
            return { ok: true };
        } catch (e) { return { ok: false, error: e.message }; }
    });
}
export async function handleRemoveTempWhitelist(message) {
    return await removeTempWhitelist(message.domain);
}
