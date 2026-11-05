import { getSettings, SETTINGS_KEY, STATS_KEY, LOG_KEY } from './settings.js';
import { getInstallationId } from '../deviceManager.js';
import { recordBlock, getMatchedStats } from './stats.js';
import { getDomain } from 'tldts';
import { jwtPayload } from '../authManager.js'; // 🔒 M-3 修复：引入安全解析工具

// 🔒 分离广告与追踪器规则集，实现独立开关
const ADS_RULESETS = ['ads_1a', 'ads_1b', 'ads_2', 'ads_3', 'ads_4', 'anti_affiliate'];
const TRACKER_RULESETS = ['trackers_1a', 'trackers_1b', 'trackers_2a', 'trackers_2b'];
const EXTRA_RULESETS = ['annoyances']; // 'privacy' 由 background.js 动态注入，不走静态规则集

export async function updateDNRRulesets(dnrEnabled, blockTrackers) {
    try {
        const enable = [];
        const disable = [];

        // 🛡️ B5 修复：检查 DNR 全局可用额度（精确比对，不再一刀切 30000）
        let hasEnoughQuota = true;
        if (dnrEnabled && chrome.declarativeNetRequest.getAvailableStaticRuleCount) {
            try {
                const quota = await chrome.declarativeNetRequest.getAvailableStaticRuleCount();
                // DewSecure 追踪器规则集约 40000 条，如果剩余额度不够加载它，再降级
                const neededTrackersQuota = 40000; 
                if (quota < neededTrackersQuota) {
                    hasEnoughQuota = false;
                    console.warn(`⚠️ [DNR] 全局可用额度 (${quota}) 不足以加载追踪器规则 (${neededTrackersQuota})，已静默降级。请提示用户关闭其他拦截插件。`);
                    blockTrackers = false; // 精确关闭
                }
            } catch (e) {
                console.warn('无法获取 DNR 额度，采用默认策略', e);
            }
        }

        if (dnrEnabled) enable.push(...ADS_RULESETS, ...EXTRA_RULESETS);
        else disable.push(...ADS_RULESETS, ...EXTRA_RULESETS);

        if (dnrEnabled && blockTrackers) enable.push(...TRACKER_RULESETS);
        else disable.push(...TRACKER_RULESETS);

        await chrome.declarativeNetRequest.updateEnabledRulesets({
            enableRulesetIds: enable,
            disableRulesetIds: disable
        });
        console.log(`✅ [DNR] 规则集已更新 (广告:${dnrEnabled}, 追踪器:${blockTrackers}, 额度充足:${hasEnoughQuota})`);
    } catch (e) {
        console.warn('❌ [DNR] 规则集更新失败:', e);
    }
}

// 🛡️ N-13 修复：仅允许通过 UPDATE_SETTING_KEY/UPDATE_SETTINGS 修改基础布尔开关
// whitelist、tempWhitelist、dailyUsed 等敏感数据必须走各自专用的消息路径（且需经 isValidWhitelistDomain）
const SIMPLE_KEYS = new Set([
    'dnrEnabled', 'antiHijackEnabled', 'phishingEnabled', 'intelEnabled', 'aiFourEnabled', 
    'aiEnabled', 'antiBypassEnabled', 'blockTrackers', 'hideCookieNotices', 
    'hideAdPlaceholders', 'blockSocialTrackers', 'shareThreatCandidates'
]);

// 🔒 H3 修复：直接使用 tldts 校验，彻底解决公共后缀缺失问题
function isValidWhitelistDomain(domain) {
    if (typeof domain !== 'string' || domain.length > 253 || !/^[a-z0-9.-]+$/i.test(domain)) return false;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(domain)) return false; // 拒绝 IP
    
    const parts = domain.split('.');
    // 拒绝单段域名，且 TLD 长度必须至少为 2（过滤掉 a.b 这种非法域名）
    if (parts.length < 2 || parts[parts.length - 1].length < 2) return false; 

    const reg = getDomain(domain.toLowerCase(), { allowPrivateDomains: true });
    return reg !== null && (domain === reg || domain.endsWith('.' + reg));
}

// 🔒 M2 修复：特权消息必须来自扩展内部页面
function isPrivilegedSender(sender) {
    if (!sender) return false;
    const extUrl = chrome.runtime.getURL('');
    return !!(sender.url && sender.url.startsWith(extUrl));
}

function isExtensionSender(sender) {
    if (!sender) return false;
    if (sender.id === chrome.runtime.id) return true;
    if (sender.url && (sender.url.startsWith('chrome-extension://') || sender.url.startsWith('moz-extension://'))) return true;
    return false;
}

function getETLD1(host) {
    if (!host) return host;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host;
    return getDomain(host, { allowPrivateDomains: true }) || host;
}

// 🔒 M-5 修复：持久化自增规则 ID 映射，避免哈希碰撞
async function getOrCreateRuleId(domain) {
    const { ruleIdMap = {}, nextRuleId = 10000 } = await chrome.storage.local.get(['ruleIdMap', 'nextRuleId']);
    if (ruleIdMap[domain]) return ruleIdMap[domain];
    
    const newId = nextRuleId;
    ruleIdMap[domain] = newId;
    await chrome.storage.local.set({ ruleIdMap, nextRuleId: newId + 1 });
    return newId;
}

// 🔒 H-3 修复：清理过期临时白名单
async function cleanExpiredTempWhitelist(settings) {
    let changed = false;
    const now = Date.now();
    const expiry = settings.tempWhitelistExpiry || {};
    
    settings.tempWhitelist = settings.tempWhitelist.filter(domain => {
        if (expiry[domain] && expiry[domain] < now) {
            delete expiry[domain];
            changed = true;
            return false;
        }
        return true;
    });
    settings.tempWhitelistExpiry = expiry;
    if (changed) {
        await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    }
    return settings;
}

export async function handleMessage(message, sender) {
    if (!isExtensionSender(sender)) {
        console.warn('❌ [拦截] 拒绝非扩展来源的消息:', message?.type, 'Sender:', sender?.url || sender?.id);
        return { error: 'Unauthorized sender' };
    }

    const privilegedTypes = [
        'UPDATE_SETTING_KEY', 'UPDATE_SETTINGS', 
        'ADD_WHITELIST', 'REMOVE_WHITELIST', 
        'ADD_TEMP_WHITELIST', 'REMOVE_TEMP_WHITELIST',
        'REPORT_FEEDBACK' // 🛡️ N-8 修复：要求特权来源
    ];
    if (privilegedTypes.includes(message.type) && !isPrivilegedSender(sender)) {
        console.warn('❌ [拦截] 拒绝非特权页面调用:', message.type);
        return { error: 'Privileged sender required' };
    }

    switch (message.type) {
        case 'DOM_AD_HIDDEN':
            try {
                const host = new URL(message.url).hostname;
                let settings = await getSettings();
                settings = await cleanExpiredTempWhitelist(settings);
                const isWhitelisted = (settings.whitelist || []).some(d => host === d || host.endsWith('.' + d)) ||
                                      (settings.tempWhitelist || []).some(d => host === d || host.endsWith('.' + d));
                if (!isWhitelisted) await recordBlock(host + '/dom-hidden', 'dom-hidden');
            } catch(e) {}
            return { ok: true };
        case 'GET_LOGS':
            let { [LOG_KEY]: rawLogs } = await chrome.storage.local.get(LOG_KEY);
            return Array.isArray(rawLogs) ? rawLogs : [];
        case 'ADD_TEMP_WHITELIST':
            if (!isValidWhitelistDomain(message.domain)) {
                return { ok: false, error: '格式非法或公共后缀' };
            }
            try {
                let settings = await getSettings();
                settings = await cleanExpiredTempWhitelist(settings);
                if (!settings.tempWhitelistExpiry) settings.tempWhitelistExpiry = {};

                if (!settings.tempWhitelist.includes(message.domain)) {
                    settings.tempWhitelist.push(message.domain);
                }
                // 默认放行 24 小时
                settings.tempWhitelistExpiry[message.domain] = Date.now() + 24 * 60 * 60 * 1000;
                await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
                
                if (message.domain === 'dewsecure.com' || message.domain.endsWith('.dewsecure.com')) return { ok: true };
                
                const ruleId = await getOrCreateRuleId(message.domain);
                await chrome.declarativeNetRequest.updateSessionRules({
                    removeRuleIds: [ruleId],
                    addRules: [{ 
                        id: ruleId, 
                        priority: 2147483647, 
                        action: { type: 'allow' }, // 统一使用 allow
                        condition: { 
                            requestDomains: [message.domain], 
                            resourceTypes: [
                                "main_frame", "sub_frame", "stylesheet", "script", "image", 
                                "font", "object", "xmlhttprequest", "ping", "csp_report", 
                                "media", "websocket", "webtransport", "webbundle", "other"
                            ] 
                        } 
                    }]
                });
                return { ok: true };
            } catch (e) { return { ok: false, error: e.message }; }
        case 'REMOVE_TEMP_WHITELIST':
            try {
                let settings = await getSettings();
                settings.tempWhitelist = settings.tempWhitelist.filter(d => d !== message.domain);
                if (settings.tempWhitelistExpiry) delete settings.tempWhitelistExpiry[message.domain];
                await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
                
                if (message.domain === 'dewsecure.com' || message.domain.endsWith('.dewsecure.com')) return { ok: true };
                
                const ruleId = await getOrCreateRuleId(message.domain);
                await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] });
                return { ok: true };
            } catch (e) { return { ok: false, error: e.message }; }
        case 'GET_STATS':
            const stats = await getMatchedStats();
            let sStats = await getSettings();
            sStats = await cleanExpiredTempWhitelist(sStats);
            return { stats: stats, settings: sStats };
        case 'REPORT_FEEDBACK':
            try {
                // 🔒 M1 修复：强制要求登录，阻断匿名刷接口
                const { dewsecure_user: user } = await chrome.storage.local.get('dewsecure_user');
                if (!user || !user.token) {
                    return { ok: false, error: 'Please login to report false positives/negatives' };
                }

                let host = message.domain;
                let tab = null; // 🛡️ N-8 修复：提升变量作用域
                if (!host) {
                    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                    if (!tab || !tab.url) return { ok: false };
                    host = new URL(tab.url).hostname;
                }
                
                // 🛡️ 修复误报逻辑：如果是在警告页（被拦截页面）触发的上报，必须提取真实的被拦截域名
                if (!message.domain && tab?.url && tab.url.includes('warning.html')) {
                    const urlParams = new URL(tab.url).searchParams;
                    const realDomain = urlParams.get('domain') || urlParams.get('url');
                    if (realDomain && realDomain !== 'Known Malicious Site') {
                        try {
                            host = new URL(realDomain.startsWith('http') ? realDomain : `https://${realDomain}`).hostname;
                        } catch(e) {
                            host = realDomain;
                        }
                    }
                }

                // 禁止上报扩展自身的 ID
                if (host === chrome.runtime.id || !host.includes('.')) {
                    console.warn('❌ [Report] 拒绝上报无效或扩展自身域名:', host);
                    return { ok: false, error: 'Invalid domain' };
                }

                // 🛡️ N-8 修复：增加域名合法性校验，防止恶意伪造乱码
                if (!isValidWhitelistDomain(getETLD1(host))) {
                    console.warn('❌ [Report] 拒绝上报非法域名:', host);
                    return { ok: false, error: 'Invalid domain' };
                }

                // 🔒 M1 修复：使用 getETLD1 精准提取，防止 shopee.com.my 被截断为 com.my
                const domainOnly = getETLD1(host);
                
                // 🔒 M-3 修复：使用统一的 jwtPayload 安全解析
                let userId = null;
                if (user && user.token) {
                    const payload = jwtPayload(user.token);
                    if (payload) userId = payload.sub;
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
            let sGet = await getSettings();
            sGet = await cleanExpiredTempWhitelist(sGet);
            return sGet;
        case 'UPDATE_SETTING_KEY':
            // 🛡️ N-13 修复：必须是简单键，且值必须是布尔型，杜绝数组/对象注入
            if (!SIMPLE_KEYS.has(message.key) || typeof message.value !== 'boolean') {
                console.warn('❌ [拦截] 拒绝写入未授权的设置键或非法类型:', message.key);
                return { ok: false, error: 'Unauthorized setting key or invalid type' };
            }
            let s = await getSettings();
            s[message.key] = message.value;
            await chrome.storage.local.set({ [SETTINGS_KEY]: s });
            if (message.key === 'dnrEnabled' || message.key === 'blockTrackers') {
                await updateDNRRulesets(s.dnrEnabled, s.blockTrackers);
            }
            return { ok: true };
        case 'UPDATE_SETTINGS':
            let currentSettings = await getSettings();
            let hasDnrChange = false;
            for (const key of Object.keys(message.settings)) {
                // 🛡️ N-13 修复：过滤敏感键与非布尔值
                if (SIMPLE_KEYS.has(key) && typeof message.settings[key] === 'boolean') {
                    currentSettings[key] = message.settings[key];
                    if (key === 'dnrEnabled' || key === 'blockTrackers') hasDnrChange = true;
                }
            }
            await chrome.storage.local.set({ [SETTINGS_KEY]: currentSettings });
            if (hasDnrChange) {
                await updateDNRRulesets(currentSettings.dnrEnabled, currentSettings.blockTrackers);
            }
            return { ok: true };
        case 'ADD_WHITELIST':
            let curSettings = await getSettings();
            if (!isValidWhitelistDomain(message.domain)) return { ok: false, error: '格式非法或公共后缀' };
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
