import { getSettings, SETTINGS_KEY, STATS_KEY, LOG_KEY } from './settings.js';
import { getInstallationId } from '../deviceManager.js';
import { recordBlock, getMatchedStats } from './stats.js';

// 🔒 正确的 DNR 规则集列表（必须与 manifest.json 完全一致）
const ALL_DNR_RULESETS = [
    'ads_1a', 'ads_1b', 'ads_2', 'ads_3', 'ads_4',
    'trackers_1a', 'trackers_1b', 'trackers_2a', 'trackers_2b',
    'anti_affiliate', 'annoyances'
];

// 🔒 辅助函数：统一处理 DNR 规则的开启/关闭
async function updateDNRRulesets(isEnabled) {
    try {
        await chrome.declarativeNetRequest.updateEnabledRulesets({
            enableRulesetIds: isEnabled ? ALL_DNR_RULESETS : [],
            disableRulesetIds: isEnabled ? [] : ALL_DNR_RULESETS
        });
        console.log(`✅ [DNR] 规则集已${isEnabled ? '启用' : '禁用'}`);
    } catch (e) {
        console.warn('❌ [DNR] 规则集更新失败:', e);
    }
}

// 🔒 S-07: 允许通过 UPDATE_SETTING_KEY 修改的合法键
const ALLOWED_SETTING_KEYS = new Set([
    'dnrEnabled', 'antiHijackEnabled', 'phishingEnabled', 'aiFourEnabled', 
    'aiEnabled', 'antiBypassEnabled', 'blockTrackers', 'hideCookieNotices', 
    'hideAdPlaceholders', 'blockSocialTrackers', 'whitelist', 'tempWhitelist',
    'dailyLimit', 'dailyUsed', 'lastResetDate'
]);

export async function handleMessage(message, sender) {
    // 🔒 S-07: 拒绝非扩展内部发出的消息，防止恶意网页通过 content.js 篡改内部状态
    const isExtensionSender = sender?.id === chrome.runtime.id || 
                              (sender?.url && (sender.url.startsWith('chrome-extension://') || sender.url.startsWith('moz-extension://')));
    if (!isExtensionSender) {
        console.warn('❌ [拦截] 拒绝非扩展来源的消息:', message?.type, 'Sender:', sender?.url || sender?.id);
        return { error: 'Unauthorized sender' };
    }

    switch (message.type) {
        case 'DOM_AD_HIDDEN':
            try {
                const host = new URL(message.url).hostname;
                const settings = await getSettings();
                const isWhitelisted = (settings.whitelist || []).some(d => host === d || host.endsWith('.' + d)) ||
                                      (settings.tempWhitelist || []).some(d => host === d || host.endsWith('.' + d));
                if (!isWhitelisted) await recordBlock(host + '/dom-hidden', 'dom-hidden');
            } catch(e) {}
            return { ok: true };
        case 'GET_LOGS':
            let { [LOG_KEY]: rawLogs } = await chrome.storage.local.get(LOG_KEY);
            return Array.isArray(rawLogs) ? rawLogs : [];
        case 'ADD_TEMP_WHITELIST':
            // 🔒 S-07: 补全域名格式校验
            if (typeof message.domain !== 'string' || !/^[a-z0-9.-]+$/i.test(message.domain)) {
                return { ok: false, error: '格式非法' };
            }
            try {
                const settings = await getSettings();
                if (!settings.tempWhitelist.includes(message.domain)) {
                    settings.tempWhitelist.push(message.domain);
                    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
                }
                const ruleId = Math.floor(Math.abs(message.domain.split('').reduce((a,b)=>((a<<5)-a)+b.charCodeAt(0),0)) % 1000000) + 10000;
                await chrome.declarativeNetRequest.updateSessionRules({
                    removeRuleIds: [ruleId],
                    // 🔒 修复：只要发起方是白名单域名，其所有第三方请求直接全局放行（去除 requestDomains 限制）
                    addRules: [{ id: ruleId, priority: 1000000, action: { type: 'allowAllRequests' }, condition: { initiatorDomains: [message.domain], resourceTypes: ["main_frame"] } }]
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
            const stats = await getMatchedStats();
            return { stats: stats, settings: await getSettings() };
        case 'REPORT_FEEDBACK':
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (!tab || !tab.url) return { ok: false };
                const host = new URL(tab.url).hostname;
                
                // 🔒 S-02 隐私修复：提取 eTLD+1（注册域），剥离 path/query/hash
                const hostParts = host.split('.');
                const domainOnly = hostParts.length > 2 ? hostParts.slice(-2).join('.') : host;
                
                // 🔒 修复外键冲突：恢复真实的 userId 以便通过外键和 RLS 鉴权
                let userId = null;
                const { dewsecure_user: user } = await chrome.storage.local.get('dewsecure_user');
                if (user && user.token) {
                    try { const payload = JSON.parse(atob(user.token.split('.')[1])); userId = payload.sub; } catch (e) {}
                }

                const SUPABASE_URL = 'https://uvbaioqqjqseapcancvi.supabase.co';
                const SUPABASE_ANON_KEY = 'sb_publishable_xiiA-yt_jRKkzRdkYkoWJA_CVZjNjq8';
                
                // 🔒 如果用户已登录，使用用户 Token；如果未登录，使用纯匿名 Key
                const authHeader = user?.token ? `Bearer ${user.token}` : `Bearer ${SUPABASE_ANON_KEY}`;

                const res = await fetch(`${SUPABASE_URL}/rest/v1/reports`, {
                    method: 'POST',
                    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': authHeader, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
                    body: JSON.stringify({ 
                        user_id: userId, // 恢复真实 ID（如果没登录则为 null）
                        report_type: message.feedbackType === 'missed' ? 'false_negative' : 'false_positive', 
                        url: `https://${domainOnly}`, // 🔒 仅上报注册域（已脱敏）
                        domain: domainOnly, 
                        description: domainOnly, 
                        category: 'ai_feedback' 
                    })
                });
                return { ok: res.ok };
            } catch (err) { return { ok: false }; }
        case 'GET_SETTINGS':
            return await getSettings();
        case 'UPDATE_SETTING_KEY':
            // 🔒 S-07: 只允许修改白名单内的键，防止越权篡改 tier 等敏感数据
            if (!ALLOWED_SETTING_KEYS.has(message.key)) {
                console.warn('❌ [拦截] 拒绝写入未授权的设置键:', message.key);
                return { ok: false, error: 'Unauthorized setting key' };
            }
            let s = await getSettings();
            s[message.key] = message.value;
            await chrome.storage.local.set({ [SETTINGS_KEY]: s });
            
            // 如果修改的是总开关，同步更新 DNR 规则
            if (message.key === 'dnrEnabled') {
                await updateDNRRulesets(message.value);
            }
            return { ok: true };
        case 'UPDATE_SETTINGS':
            // 🔒 S-07: 过滤非白名单字段，保留原有的合法字段
            let currentSettings = await getSettings();
            for (const key of Object.keys(message.settings)) {
                if (ALLOWED_SETTING_KEYS.has(key)) {
                    currentSettings[key] = message.settings[key];
                }
            }
            await chrome.storage.local.set({ [SETTINGS_KEY]: currentSettings });
            if (message.settings.dnrEnabled !== undefined) {
                await updateDNRRulesets(message.settings.dnrEnabled);
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
