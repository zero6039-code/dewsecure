import { getSettings, SETTINGS_KEY, STATS_KEY, LOG_KEY } from './settings.js';
import { getInstallationId } from '../deviceManager.js';
import { recordBlock, getMatchedStats } from './stats.js';

// 🔒 分离广告与追踪器规则集，实现独立开关
const ADS_RULESETS = ['ads_1a', 'ads_1b', 'ads_2', 'ads_3', 'ads_4', 'anti_affiliate'];
const TRACKER_RULESETS = ['trackers_1a', 'trackers_1b', 'trackers_2a', 'trackers_2b'];
const EXTRA_RULESETS = ['annoyances'];

export async function updateDNRRulesets(dnrEnabled, blockTrackers) {
    try {
        const enable = [];
        const disable = [];
        
        // 处理广告和额外规则
        if (dnrEnabled) enable.push(...ADS_RULESETS, ...EXTRA_RULESETS);
        else disable.push(...ADS_RULESETS, ...EXTRA_RULESETS);

        // 处理追踪器规则 (必须总开关开启且追踪器开关开启)
        if (dnrEnabled && blockTrackers) enable.push(...TRACKER_RULESETS);
        else disable.push(...TRACKER_RULESETS);

        await chrome.declarativeNetRequest.updateEnabledRulesets({
            enableRulesetIds: enable,
            disableRulesetIds: disable
        });
        console.log(`✅ [DNR] 规则集已更新 (广告:${dnrEnabled}, 追踪器:${blockTrackers})`);
    } catch (e) {
        console.warn('❌ [DNR] 规则集更新失败:', e);
    }
}

// 🔒 S-07: 允许通过 UPDATE_SETTING_KEY 修改的合法键
const ALLOWED_SETTING_KEYS = new Set([
    'dnrEnabled', 'antiHijackEnabled', 'phishingEnabled', 'intelEnabled', 'aiFourEnabled', 
    'aiEnabled', 'antiBypassEnabled', 'blockTrackers', 'hideCookieNotices', 
    'hideAdPlaceholders', 'blockSocialTrackers', 'whitelist', 'tempWhitelist',
    'dailyLimit', 'dailyUsed', 'lastResetDate'
]);


// 🔒 H3 修复：白名单域名格式与公共后缀严格校验
function isValidWhitelistDomain(domain) {
    if (typeof domain !== 'string' || !/^[a-z0-9.-]+$/i.test(domain)) return false;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(domain)) return false; // 拒绝 IP
    const parts = domain.split('.');
    if (parts.length < 2 || parts.some(p => p === '')) return false; // 拒绝单段、a..b
    const PUBLIC_SUFFIXES = new Set(['com','net','org','edu','gov','mil','int','io','co','ai','app','dev','xyz','info','biz','me','tv','cc','so','uk','cn','jp','de','fr','ru','br','au','ca','it','nl','se','no','es','mx','ch','at','be','dk','fi','gr','hk','hu','ie','il','in','kr','lt','lv','nz','pl','pt','ro','sg','sk','th','tr','tw','ua','za','co.uk','com.cn','net.cn','org.cn','gov.cn','edu.cn','co.jp','ne.jp','or.jp','com.au','net.au','org.au','co.nz','net.nz','org.nz','co.za','com.br','net.br','org.br']);
    if (PUBLIC_SUFFIXES.has(domain.toLowerCase())) return false;
    return true;
}


// 🔒 M2 修复：特权消息必须来自扩展内部页面（Popup / Sidepanel），不能来自内容脚本
function isPrivilegedSender(sender) {
    if (!sender) return false;
    const extUrl = chrome.runtime.getURL('');
    // 🔒 修复：去掉 !sender.tab 限制，因为 warning.html 也是以标签页打开的。
    // 只要是从扩展内部页面发出的消息即可信任；内容脚本的 URL 是 http/https 开头的，会被拦截。
    return !!(sender.url && sender.url.startsWith(extUrl));
}

function isExtensionSender(sender) {
    if (!sender) return false;
    if (sender.id === chrome.runtime.id) return true;
    if (sender.url && (sender.url.startsWith('chrome-extension://') || sender.url.startsWith('moz-extension://'))) return true;
    return false;
}

// 🔒 M1 修复：精准提取 eTLD+1（处理 .com.my 等多级后缀）
const MULTI_LEVEL_SUFFIXES = new Set([
    'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn',
    'co.uk', 'org.uk', 'me.uk', 'ltd.uk',
    'com.my', 'net.my', 'org.my', 'gov.my', 'edu.my',
    'com.au', 'net.au', 'org.au',
    'co.jp', 'ne.jp', 'or.jp',
    'co.nz', 'net.nz', 'org.nz',
    'com.br', 'net.br', 'org.br',
    'com.sg', 'net.sg', 'org.sg', 'edu.sg',
    'com.hk', 'net.hk', 'org.hk', 'edu.hk'
]);

function getETLD1(host) {
    if (!host) return host;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host; // IP 直接返回
    const parts = host.split('.');
    if (parts.length <= 2) return host;
    const lastTwo = parts.slice(-2).join('.');
    if (MULTI_LEVEL_SUFFIXES.has(lastTwo) && parts.length >= 3) {
        return parts.slice(-3).join('.');
    }
    return lastTwo;
}

export async function handleMessage(message, sender) {
    // 🔒 S-07: 拒绝非扩展内部发出的消息
    if (!isExtensionSender(sender)) {
        console.warn('❌ [拦截] 拒绝非扩展来源的消息:', message?.type, 'Sender:', sender?.url || sender?.id);
        return { error: 'Unauthorized sender' };
    }

    // 🔒 M2 修复：特权消息分级校验
    const privilegedTypes = [
        'UPDATE_SETTING_KEY', 'UPDATE_SETTINGS', 
        'ADD_WHITELIST', 'REMOVE_WHITELIST', 
        'ADD_TEMP_WHITELIST', 'REMOVE_TEMP_WHITELIST'
    ];
    if (privilegedTypes.includes(message.type) && !isPrivilegedSender(sender)) {
        console.warn('❌ [拦截] 拒绝非特权页面调用:', message.type);
        return { error: 'Privileged sender required' };
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
            if (!isValidWhitelistDomain(message.domain)) {
                return { ok: false, error: '格式非法或公共后缀' };
            }
            try {
                const settings = await getSettings();
                if (!settings.tempWhitelist.includes(message.domain)) {
                    settings.tempWhitelist.push(message.domain);
                    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
                }
                if (message.domain === 'dewsecure.com' || message.domain.endsWith('.dewsecure.com')) return;
                const ruleId = Math.floor(Math.abs(message.domain.split('').reduce((a,b)=>((a<<5)-a)+b.charCodeAt(0),0)) % 1000000) + 10000;
                await chrome.declarativeNetRequest.updateSessionRules({
                    removeRuleIds: [ruleId],
                    // 🔒 F-03 终极修复：摒弃容易失效的 allowAllRequests，改用最高优先级的全类型 allow
                    addRules: [{ 
                        id: ruleId, 
                        priority: 2147483647, 
                        action: { type: 'allow' }, 
                        condition: { 
                            // 🛡️ 核心修复：必须用 requestDomains 才能放行主框架（main_frame）
                            requestDomains: [message.domain], 
                            // 放行所有资源类型，彻底阻断静态规则的干扰
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
                const settings = await getSettings();
                settings.tempWhitelist = settings.tempWhitelist.filter(d => d !== message.domain);
                await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
                if (message.domain === 'dewsecure.com' || message.domain.endsWith('.dewsecure.com')) return;
                const ruleId = Math.floor(Math.abs(message.domain.split('').reduce((a,b)=>((a<<5)-a)+b.charCodeAt(0),0)) % 1000000) + 10000;
                await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] });
                return { ok: true };
            } catch (e) { return { ok: false, error: e.message }; }
        case 'GET_STATS':
            const stats = await getMatchedStats();
            return { stats: stats, settings: await getSettings() };
        case 'REPORT_FEEDBACK':
            try {
                // 🔒 M1 修复：强制要求登录，阻断匿名刷接口
                const { dewsecure_user: user } = await chrome.storage.local.get('dewsecure_user');
                if (!user || !user.token) {
                    return { ok: false, error: 'Please login to report false positives/negatives' };
                }

                let host = message.domain;
                if (!host) {
                    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                    if (!tab || !tab.url) return { ok: false };
                    host = new URL(tab.url).hostname;
                }
                
                // 🛡️ 修复误报逻辑：如果是在警告页（被拦截页面）触发的上报，必须提取真实的被拦截域名
                if (!message.domain && tab.url && tab.url.includes('warning.html')) {
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

                // 🔒 M1 修复：使用 getETLD1 精准提取，防止 shopee.com.my 被截断为 com.my
                const domainOnly = getETLD1(host);
                
                // 🔒 修复外键冲突：恢复真实的 userId 以便通过外键和 RLS 鉴权
                let userId = null;
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
            
            // 如果修改的是总开关或追踪器开关，同步更新 DNR 规则
            if (message.key === 'dnrEnabled' || message.key === 'blockTrackers') {
                await updateDNRRulesets(s.dnrEnabled, s.blockTrackers);
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
            if (message.settings.dnrEnabled !== undefined || message.settings.blockTrackers !== undefined) {
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
