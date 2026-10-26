import { getSettings, SETTINGS_KEY, STATS_KEY, LOG_KEY } from './settings.js';
import { recordBlock } from './stats.js';

export async function handleMessage(message, sender) {
    switch (message.type) {
        case 'DOM_AD_HIDDEN':
            try {
                const host = new URL(message.url).hostname;
                const settings = await getSettings();
                const isWhitelisted = (settings.whitelist || []).some(d => host === d || host.endsWith('.' + d)) ||
                                      (settings.tempWhitelist || []).some(d => host === d || host.endsWith('.' + d));
                if (!isWhitelisted) await recordBlock(host + '/dom-hidden', '内容隐藏');
            } catch(e) {}
            return { ok: true };
        case 'GET_LOGS':
            let { [LOG_KEY]: rawLogs } = await chrome.storage.local.get(LOG_KEY);
            return Array.isArray(rawLogs) ? rawLogs : [];
        case 'ADD_TEMP_WHITELIST':
            try {
                const settings = await getSettings();
                if (!settings.tempWhitelist.includes(message.domain)) {
                    settings.tempWhitelist.push(message.domain);
                    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
                }
                const ruleId = Math.floor(Math.abs(message.domain.split('').reduce((a,b)=>((a<<5)-a)+b.charCodeAt(0),0)) % 1000000) + 10000;
                await chrome.declarativeNetRequest.updateSessionRules({
                    removeRuleIds: [ruleId],
                    addRules: [{ id: ruleId, priority: 1000000, action: { type: 'allowAllRequests' }, condition: { initiatorDomains: [message.domain], requestDomains: [message.domain], resourceTypes: ["main_frame", "sub_frame"] } }]
                });
                return { ok: true };
            } catch (e) { return { ok: false, error: e.message }; }
        case 'REMOVE_TEMP_WHITELIST':
            try {
                const settings = await getSettings();
                settings.tempWhitelist = settings.tempWhitelist.filter(d => d !== message.domain);
                await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
                const ruleId = Math.floor(Math.abs(message.domain.split('').reduce((a,b)=>((a<<5)-a)+b.charCodeAt(0),0)) % 1000000) + 10000;
                await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] });
                return { ok: true };
            } catch (e) { return { ok: false, error: e.message }; }
        case 'GET_STATS':
            let { [STATS_KEY]: rawStats } = await chrome.storage.local.get(STATS_KEY);
            let { [LOG_KEY]: allLogs = [] } = await chrome.storage.local.get(LOG_KEY);
            if (!Array.isArray(allLogs)) allLogs = [];
            const todayStr = new Date().toDateString();
            const todayCount = allLogs.filter(l => l.date === todayStr).length;
            const totalCount = (rawStats && rawStats.totalBlocked) ? rawStats.totalBlocked : allLogs.length;
            return { stats: { todayBlocked: todayCount, totalBlocked: totalCount }, settings: await getSettings() };
        case 'REPORT_FEEDBACK':
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (!tab || !tab.url) return { ok: false };
                const host = new URL(tab.url).hostname;
                let userId = null;
                const { dewsecure_user: user } = await chrome.storage.local.get('dewsecure_user');
                if (user && user.token) {
                    try { const payload = JSON.parse(atob(user.token.split('.')[1])); userId = payload.sub; } catch (e) {}
                }
                const SUPABASE_URL = 'https://uvbaioqqjqseapcancvi.supabase.co';
                const SUPABASE_ANON_KEY = 'sb_publishable_xiiA-yt_jRKkzRdkYkoWJA_CVZjNjq8';
                const res = await fetch(`${SUPABASE_URL}/rest/v1/reports`, {
                    method: 'POST',
                    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': user?.token ? `Bearer ${user.token}` : `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
                    body: JSON.stringify({ user_id: userId, report_type: message.feedbackType === 'missed' ? 'false_negative' : 'false_positive', url: tab.url, description: host, category: 'ai_feedback' })
                });
                return { ok: res.ok };
            } catch (err) { return { ok: false }; }
        case 'GET_SETTINGS':
            return await getSettings();
        case 'UPDATE_SETTING_KEY':
            let s = await getSettings();
            s[message.key] = message.value;
            await chrome.storage.local.set({ [SETTINGS_KEY]: s });
            return { ok: true };
        case 'UPDATE_SETTINGS':
            await chrome.storage.local.set({ [SETTINGS_KEY]: message.settings });
            if (message.settings.dnrEnabled !== undefined) {
                try {
                    await chrome.declarativeNetRequest.updateEnabledRulesets({
                        enableRulesetIds: message.settings.dnrEnabled ? ['ads_1', 'ads_2', 'trackers_1', 'trackers_2'] : [],
                        disableRulesetIds: message.settings.dnrEnabled ? [] : ['ads_1', 'ads_2', 'trackers_1', 'trackers_2']
                    });
                } catch(e) {}
            }
            return { ok: true };
        case 'ADD_WHITELIST':
            let curSettings = await getSettings();
            if (!/^[a-z0-9.-]+$/i.test(message.domain)) return { ok: false, error: '格式非法' };
            if (!curSettings.whitelist.includes(message.domain)) {
                curSettings.whitelist.push(message.domain);
                await chrome.storage.local.set({ [SETTINGS_KEY]: curSettings });
            }
            return { ok: true, whitelist: curSettings.whitelist };
        case 'REMOVE_WHITELIST':
            let remSettings = await getSettings();
            remSettings.whitelist = remSettings.whitelist.filter(d => d !== message.domain);
            await chrome.storage.local.set({ [SETTINGS_KEY]: remSettings });
            return { ok: true, whitelist: remSettings.whitelist };
        default:
            return { error: '未知消息类型' };
    }
}
