// ==========================================
// 调试开关（生产环境必须 false）
// ==========================================
const DEBUG = false;
const log  = DEBUG ? console.log.bind(console)  : () => {};
const warn = DEBUG ? console.warn.bind(console) : () => {};

// ==========================================
// 1. 核心后台拦截与变量（绝对防御）
// ==========================================
// ==========================================
// 全局安全白名单（防止误伤官方主站与新建空白页）
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
        // 如果是平台官方页面且不带任何联盟/追踪参数，视为安全访问
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
    // --- Skidrow 诊断补充 ---
    'affiliate_id=', 'sub_id=scs', 'utm_source=InvolveAsia',
    'utm_source=open_api', 'uls_trackid=', 'chain_key=',
    'utm_source=adcash', 'trip_sub1=', 'ud1=',
];
const TARGET_BRANDS = [
    'generali.com.my', 'steampowered.com', 'store.steampowered.com',
    // --- 原有 ---
    'shopee.com.my', 'kkday.com', 'trip.com', 'my.trip.com', 'klook.com',
    'traveloka.com', 'tiktok.com', 'lazada.com.my', 'shein.com',
    'ragasstore.com', 'opera.com/partner', '1xlite', '1xbet', 'omguk.com',
    // --- 本次 Skidrow 诊断补充 ---
    's.shopee.com.my',
    'track.omguk.com',
    'www.trip.com',
    'www.kkday.com',
    'www.klook.com',
    'www.opera.com/partner',
    'adexchangerapid.com',
    'usrpubtrk.com',
    'ntwkbc21.com',
    'ntwkbc42.com',
];

// ===== 双保险 A：onCreatedNavigationTarget（原有）=====
chrome.webNavigation.onCreatedNavigationTarget.addListener((info) => {
    const url = info.url || '';
    const hasAdParam = AD_KEYS.some(k => url.includes(k));
    const isTargetBrand = TARGET_BRANDS.some(h => url.includes(h));
    
    if (hasAdParam || isTargetBrand) {
        warn('🛡️ [后台绞杀] 发现流氓跳转，正在强制关闭:', url);
        chrome.tabs.remove(info.tabId, () => {
            if (chrome.runtime.lastError) {}
        });
    }
});

// ===== 双保险 B：tabs.onUpdated（更早捕获 URL 变更）=====
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

// ===== 双保险 C：tabs.onCreated（标签页创建 0ms 立刻检查）=====
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
    dnrEnabled: true,
    antiHijackEnabled: true,
    phishingEnabled: true,
    aiFourEnabled: true,
    aiEnabled: true,
    antiBypassEnabled: true,
    blockTrackers: true,
    hideCookieNotices: true,
    hideAdPlaceholders: true,
    blockSocialTrackers: true,
    whitelist: [],
    tempWhitelist: [],
    dailyLimit: 50,
    dailyUsed: 0,
    lastResetDate: new Date().toDateString(),
    tier: 'free',
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
                    id: ruleId,
                    priority: 100000,
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
        if (logs.length > 1000) logs.shift(); // 保留最近1000条
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

// DNR 规则拦截监听
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
                if (!isWhitelisted) {
                    await recordBlock(host + '/dom-hidden', '内容隐藏');
                }
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
                await applySessionRuleForDomain(message.domain, true);
                return { ok: true };
            } catch (e) { return { ok: false, error: e.message }; }

        case 'REMOVE_TEMP_WHITELIST':
            try {
                const settings = await getSettings();
                settings.tempWhitelist = settings.tempWhitelist.filter(d => d !== message.domain);
                await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
                await applySessionRuleForDomain(message.domain, false);
                return { ok: true };
            } catch (e) { return { ok: false, error: e.message }; }

        case 'GET_STATS':
            let { [STATS_KEY]: rawStats } = await chrome.storage.local.get(STATS_KEY);
            let { [LOG_KEY]: allLogs = [] } = await chrome.storage.local.get(LOG_KEY);
            if (!Array.isArray(allLogs)) allLogs = [];
            
            const todayStr = new Date().toDateString();
            const todayCount = allLogs.filter(l => l.date === todayStr).length;
            const totalCount = (rawStats && rawStats.totalBlocked) ? rawStats.totalBlocked : allLogs.length;
            
            return { 
                stats: { todayBlocked: todayCount, totalBlocked: totalCount }, 
                settings: await getSettings() 
            };

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
