// 启用点击图标打开侧边栏 (Side Panel)
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.warn);
}

import { checkAndUpdateModel } from './modelManager.js';
import { reportDeviceSilently } from './deviceManager.js';

// ==========================================
// 调试开关（生产环境必须 false）
// ==========================================
const DEBUG = false;
const log  = DEBUG ? console.log.bind(console)  : () => {};
const warn = DEBUG ? console.warn.bind(console) : () => {};

// ==========================================
// 1. 核心后台拦截与变量（绝对防御）
// ==========================================
const SAFE_OFFICIAL_DOMAINS = [
    'trip.com', 'shopee.com.my', 'tiktok.com', 'kkday.com', 'klook.com',
    'lazada.com.my', 'opera.com', 'traveloka.com', 'shein.com'
];

function isSafeNavigation(url) {
    if (!url) return true;
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:') || url.startsWith('edge://')) return true;
    try {
        const u = new URL(url);
        const host = u.hostname.replace(/^www\./, '');
        const isOfficial = SAFE_OFFICIAL_DOMAINS.some(d => host === d || host.endsWith('.' + d));
        const hasAdParam = /[?&](mmp_pid|Allianceid|uls_trackid|affiliate_id|chain_key|trip_sub1|utm_source=an_|utm_source=InvolveAsia|utm_source=adcash|aid=api|ud1)=/i.test(u.search);
        if (isOfficial && !hasAdParam) return true;
    } catch(_) {}
    return false;
}

const AD_KEYS = [
    'a_aid=', 'a_bid=', 'gsid=', 'gsc=', 'data1=', 'data2=',
    'mmp_pid=', 'Allianceid=', 'utm_source=an_', 'clickref=',
    'partner_id=', 'aid=api|', 'banid=', 'campid=',
    'affiliate_id=', 'sub_id=scs', 'utm_source=InvolveAsia',
    'utm_source=open_api', 'uls_trackid=', 'chain_key=',
    'utm_source=adcash', 'trip_sub1=', 'ud1=',
];
const TARGET_BRANDS = [
    'generali.com.my', 'steampowered.com', 'store.steampowered.com',
    'shopee.com.my', 'kkday.com', 'trip.com', 'my.trip.com', 'klook.com',
    'traveloka.com', 'tiktok.com', 'lazada.com.my', 'shein.com',
    'ragasstore.com', 'opera.com/partner', '1xlite', '1xbet', 'omguk.com',
    's.shopee.com.my', 'track.omguk.com', 'www.trip.com', 'www.kkday.com',
    'www.klook.com', 'www.opera.com/partner', 'adexchangerapid.com',
    'usrpubtrk.com', 'ntwkbc21.com', 'ntwkbc42.com',
];

// ===== 双保险 A =====
chrome.webNavigation.onCreatedNavigationTarget.addListener((info) => {
    const url = info.url || '';
    const hasAdParam = AD_KEYS.some(k => url.includes(k));
    const isTargetBrand = TARGET_BRANDS.some(h => url.includes(h));
    
    if (hasAdParam || isTargetBrand) {
        warn('🛡️ [后台绞杀] 发现流氓跳转，正在强制关闭:', url);
        chrome.tabs.remove(info.tabId, () => { if (chrome.runtime.lastError) {} });
    }
});

// ===== 双保险 B =====
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const url = changeInfo.url || tab.url || '';
    if (!url || isSafeNavigation(url)) return;

    const hasAdParam = AD_KEYS.some(k => url.includes(k));
    const isTargetBrand = TARGET_BRANDS.some(h => url.includes(h));

    if (hasAdParam || isTargetBrand) {
        warn('🛡️ [tabs.onUpdated] 关闭广告标签页:', url);
        chrome.tabs.remove(tabId, () => { if (chrome.runtime.lastError) {} });
    }
});

// ===== 双保险 C =====
chrome.tabs.onCreated.addListener((tab) => {
    const url = tab.pendingUrl || tab.url || '';
    if (!url || isSafeNavigation(url)) return;

    const hasAdParam = AD_KEYS.some(k => url.includes(k));
    const isTargetBrand = TARGET_BRANDS.some(k => url.includes(k));

    if (hasAdParam || isTargetBrand) {
        warn('🛡️ [tabs.onCreated] 关闭广告标签页:', url);
        chrome.tabs.remove(tab.id, () => { if (chrome.runtime.lastError) {} });
    }
});

// ==========================================
// 2. 基础设置与常量
// ==========================================
const STATS_KEY = 'dewsecure_stats';
const LOG_KEY = 'dewsecure_logs';
const SETTINGS_KEY = 'dewsecure_settings';

const DEFAULT_SETTINGS = {
    dnrEnabled: true, antiHijackEnabled: true, phishingEnabled: true,
    aiFourEnabled: true, aiEnabled: true, antiBypassEnabled: true,
    blockTrackers: true, hideCookieNotices: true, hideAdPlaceholders: true,
    blockSocialTrackers: true, whitelist: [], tempWhitelist: [], dailyLimit: 50,
    dailyUsed: 0, lastResetDate: new Date().toDateString(), tier: 'free',
};

async function getSettings() {
    let { [SETTINGS_KEY]: settings } = await chrome.storage.local.get(SETTINGS_KEY);
    if (!settings || typeof settings !== 'object') settings = {};
    settings = { ...DEFAULT_SETTINGS, ...settings };
    if (!Array.isArray(settings.whitelist)) settings.whitelist = [];
    if (!Array.isArray(settings.tempWhitelist)) settings.tempWhitelist = [];
    return settings;
}

async function initSettings() {
    const { [SETTINGS_KEY]: settings } = await chrome.storage.local.get(SETTINGS_KEY);
    if (!settings) {
        await chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
    } else {
        const merged = { ...DEFAULT_SETTINGS, ...settings };
        if (!Array.isArray(merged.tempWhitelist)) merged.tempWhitelist = [];
        if (!Array.isArray(merged.whitelist)) merged.whitelist = [];
        await chrome.storage.local.set({ [SETTINGS_KEY]: merged });
    }
}
initSettings();
chrome.action.setBadgeText({ text: '' });

// ==========================================
// 3. 白名单与放行规则
// ==========================================
async function applySessionRuleForDomain(domain, shouldAllow) {
    const ruleId = Math.floor(Math.abs(domain.split('').reduce((a,b)=>((a<<5)-a)+b.charCodeAt(0),0)) % 1000000) + 10000;
    try {
        if (shouldAllow) {
            await chrome.declarativeNetRequest.updateSessionRules({
                removeRuleIds: [ruleId],
                addRules: [{
                    id: ruleId, priority: 100000,
                    action: { type: 'allowAllRequests' },
                    condition: { requestDomains: [domain], resourceTypes: ['main_frame', 'sub_frame'] }
                }]
            });
        } else {
            await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] });
        }
    } catch (e) { warn('规则更新失败:', e); }
}

async function restoreSessionRules() {
    const settings = await getSettings();
    if (settings.tempWhitelist && settings.tempWhitelist.length > 0) {
        for (const d of settings.tempWhitelist) {
            await applySessionRuleForDomain(d, true);
        }
    }
}
restoreSessionRules();

// ==========================================
// 4. 记录拦截日志与统计
// ==========================================
async function recordDetailedBlock(url, type) {
    try {
        let safeUrl = url.substring(0, 100);
        let domain = '未知';
        try {
            const urlObj = new URL(url.startsWith('http') ? url : 'https://' + url);
            safeUrl = `${urlObj.hostname}${urlObj.pathname}`;
            domain = urlObj.hostname;
        } catch (e) {}
        let { [LOG_KEY]: logs } = await chrome.storage.local.get(LOG_KEY);
        if (!Array.isArray(logs)) logs = [];
        logs.push({ url: safeUrl, domain: domain, type: type, ts: Date.now(), date: new Date().toDateString() });
        if (logs.length > 1000) logs.shift();
        await chrome.storage.local.set({ [LOG_KEY]: logs });
    } catch (e) {}
}

async function recordBlock(url, type = 'DNR规则') {
    let { [STATS_KEY]: stats } = await chrome.storage.local.get(STATS_KEY);
    let safeStats = (stats && typeof stats === 'object') ? stats : {};
    safeStats.totalBlocked = Number(safeStats.totalBlocked) || 0;
    safeStats.todayBlocked = Number(safeStats.todayBlocked) || 0;
    const today = new Date().toDateString();
    if (safeStats.lastReset !== today) {
        safeStats.todayBlocked = 0;
        safeStats.lastReset = today;
    }
    safeStats.totalBlocked += 1;
    safeStats.todayBlocked += 1;
    await chrome.storage.local.set({ [STATS_KEY]: safeStats });
    
    if (chrome.action) {
        const text = safeStats.todayBlocked > 999 ? '999+' : safeStats.todayBlocked.toString();
        chrome.action.setBadgeText({ text });
        chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
    }
    await recordDetailedBlock(url, type);
}

chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(async (info) => {
    try {
        const urlObj = new URL(info.request.url);
        const host = urlObj.hostname;
        const settings = await getSettings();
        const isWhitelisted = (settings.whitelist || []).some(d => host === d || host.endsWith('.' + d)) ||
                              (settings.tempWhitelist || []).some(d => host === d || host.endsWith('.' + d));
        if (isWhitelisted) return;

        let type = 'DNR规则';
        if (info.rule && info.rule.rulesetId && info.rule.rulesetId.includes('tracker')) type = '追踪器';
        else if (info.rule && info.rule.rulesetId && info.rule.rulesetId.includes('ads')) type = '广告';
        
        await recordBlock(info.request.url, type);
    } catch(e) {}
});

// ==========================================
// 5. 消息处理中心
// ==========================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender).then(sendResponse);
    return true;
});

async function handleMessage(message, sender) {
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
                    addRules: [{
                        id: ruleId, priority: 1000000, action: { type: 'allow' },
                        condition: { initiatorDomains: [message.domain] }
                    }]
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

// ==========================================
// 云端模型自动同步机制
// ==========================================
setTimeout(() => {
    checkAndUpdateModel().then(res => {
        if (res && res.updated) console.log('🚀 后台模型已静默更新至最新版本');
    }).catch(console.warn);
}, 5000);

chrome.alarms.create('dewsecure_model_update', { periodInMinutes: 1440 });
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'dewsecure_model_update') {
        console.log('⏰ 定时任务触发：检查云端模型更新...');
        checkAndUpdateModel().catch(console.warn);
    }
});

// ==========================================
// 真实特征提取 (与 Python 端对齐, 16,418 维)
// ==========================================
function extractFeaturesFromUrl(url) {
    const NGRAM_SIZE = 16384;
    const STRUCT_SIZE = 34;
    const features = new Float32Array(NGRAM_SIZE + STRUCT_SIZE);

    for (let i = 0; i <= url.length - 3; i++) {
        const ngram = url.substring(i, i + 3);
        let hash = 0xcbf29ce484222325n;
        const prime = 0x100000001b3n;
        for (let j = 0; j < 3; j++) {
            hash ^= BigInt(ngram.charCodeAt(j));
            hash = BigInt.asUintN(64, hash * prime);
        }
        const bucket = Number(hash % 16384n);
        features[bucket] += 1.0;
    }

    const S = 16384;
    features[S + 0] = url.length;
    const count = (str, ch) => str.split(ch).length - 1;
    features[S + 1] = count(url, '.');
    features[S + 2] = count(url, '-');
    features[S + 3] = count(url, '_');
    features[S + 4] = count(url, '/');
    features[S + 5] = count(url, '?');
    features[S + 6] = count(url, '=');
    features[S + 7] = count(url, '&');
    features[S + 8] = count(url, '%');
    features[S + 9] = count(url, ':');
    features[S + 10] = url.replace(/[^0-9]/g, '').length;
    features[S + 11] = url.replace(/[^a-zA-Z]/g, '').length;

    const kw = ['ad','ads','track','click','banner','popup','sponsor','promo','doubleclick','google','facebook','analytics','pixel','tracker','affiliate','utm','redirect','link','aff','campaign','partner','stat','counter','log','media','advert','serve','sync'];
    for (let i = 0; i < kw.length && i < 22; i++) {
        features[S + 12 + i] = url.toLowerCase().includes(kw[i]) ? 1.0 : 0.0;
    }
    return Array.from(features);
}

// ==========================================
// AI 异步研判中枢
// ==========================================
const AI_CHECKED_DOMAINS = new Set();

async function runAICheck(url) {
    try {
        const domain = new URL(url).hostname;
        if (AI_CHECKED_DOMAINS.has(domain)) return;
        AI_CHECKED_DOMAINS.add(domain);

        const features = extractFeaturesFromUrl(url);
        const response = await chrome.runtime.sendMessage({
            target: 'offscreen', type: 'CLASSIFY', features: features
        });

        if (!response || !response.probs) return;

        const probs = response.probs;
        const maxIdx = probs.indexOf(Math.max(...probs));
        const classes = ['Normal', 'Ad', 'Tracker', 'Phishing'];
        const classification = classes[maxIdx];

        if (classification === 'Phishing') {
            console.warn('🚨 [AI] 发现钓鱼网站:', domain);
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0] && tabs[0].id) {
                    chrome.tabs.sendMessage(tabs[0].id, { type: 'PHISHING_DETECTED', url });
                }
            });
        } else if (classification === 'Ad' || classification === 'Tracker') {
            console.warn('🛡️ [AI] 发现未知广告/追踪器:', domain);
            const ruleId = Math.floor(Math.abs(domain.split('').reduce((a,b)=>((a<<5)-a)+b.charCodeAt(0),0)) % 1000000) + 50000;
            await chrome.declarativeNetRequest.updateSessionRules({
                removeRuleIds: [ruleId],
                addRules: [{
                    id: ruleId, priority: 10000, action: { type: 'block' },
                    condition: { requestDomains: [domain], resourceTypes: ["main_frame", "sub_frame", "script", "image", "xmlhttprequest"] }
                }]
            });
        }
    } catch(e) {
        console.error('AI 研判出错:', e);
    }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'CHECK_URL_AI') {
        runAICheck(msg.url);
        sendResponse({ ok: true });
        return true;
    }
});

// ==========================================
// 监听登录/登出状态变更，立刻执行模型校验 & 设备上报
// ==========================================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'AUTH_STATE_CHANGED') {
        console.log('🔄 账号状态变更，立刻重新校验模型权限...');
        checkAndUpdateModel().catch(console.warn);
        
        // 🌟 新增：触发设备上报
        import('./authManager.js').then(async ({ getCurrentUser }) => {
            const user = await getCurrentUser();
            if (user && user.token) reportDeviceSilently(user.token);
        }).catch(e => console.warn(e));

        sendResponse({ ok: true });
        return true;
    }
});

// ==========================================
// 监听来自官网 (dewsecure.com) 的外部消息
// ==========================================
import { saveExternalAuth, logoutUser } from './authManager.js';

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    console.log('📩 收到来自官网的通信:', message.type);

    if (message.type === 'SYNC_AUTH') {
        saveExternalAuth(message.payload).then(res => {
            sendResponse({ ok: res.ok });
        });
        return true; // 保持消息通道开启（异步）
    }

    if (message.type === 'LOGOUT') {
        logoutUser().then(() => {
            sendResponse({ ok: true });
        });
        return true;
    }
});
