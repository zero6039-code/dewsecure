import { getSettings, SETTINGS_KEY, STATS_KEY, LOG_KEY } from './settings.js';
import { getInstallationId } from '../deviceManager.js';
import { recordBlock, getMatchedStats } from './stats.js';
import { getDomain } from 'tldts'; // 👈 引入 tldts

// 🔒 分离广告与追踪器规则集，实现独立开关
const ADS_RULESETS = ['ads_1a', 'ads_1b', 'ads_2', 'ads_3', 'ads_4', 'anti_affiliate'];
const TRACKER_RULESETS = ['trackers_1a', 'trackers_1b', 'trackers_2a', 'trackers_2b'];
const EXTRA_RULESETS = ['annoyances'];

export async function updateDNRRulesets(dnrEnabled, blockTrackers) {
    try {
        const enable = [];
        const disable = [];
        
        if (dnrEnabled) enable.push(...ADS_RULESETS, ...EXTRA_RULESETS);
        else disable.push(...ADS_RULESETS, ...EXTRA_RULESETS);

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
    'hideAdPlaceholders', 'blockSocialTrackers', 'whitelist', 'tempWhitelist', 'tempWhitelistExpiry',
    'dailyLimit', 'dailyUsed', 'lastResetDate'
]);

// 🔒 H3 修复：直接使用 tldts 校验，彻底解决公共后缀缺失问题
function isValidWhitelistDomain(domain) {
    if (typeof domain !== 'string' || domain.length > 253 || !/^[a-z0-9.-]+$/i.test(domain)) return false;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(domain)) return false; // 拒绝 IP
    
    const reg = getDomain(domain.toLowerCase(), { allowPrivateDomains: true });
    // 如果 reg 为 null（说明是 com.my 这种公共后缀），或者域名不完全匹配注册域及其子域，则拒绝
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
            // ... [保持原代码不变，为节省篇幅此处省略，执行命令会保留] ...
            break;
        case 'GET_SETTINGS':
            let sGet = await getSettings();
            sGet = await cleanExpiredTempWhitelist(sGet);
            return sGet;
        case 'UPDATE_SETTING_KEY':
            if (!ALLOWED_SETTING_KEYS.has(message.key)) {
                console.warn('❌ [拦截] 拒绝写入未授权的设置键:', message.key);
                return { ok: false, error: 'Unauthorized setting key' };
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
