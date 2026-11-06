import { STATS_KEY, LOG_KEY } from './settings.js';

let memoryStats = { totalBlocked: 0, todayBlocked: 0, date: '' };
let memoryLogs = [];
let loadPromise = null;
let saveTimeout = null;

// 🚀 优化 1：Promise 并发锁，防止同时触发多次读取
async function ensureLoaded() {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
        const res = await chrome.storage.local.get([STATS_KEY, LOG_KEY]);
        if (res[STATS_KEY]) memoryStats = res[STATS_KEY];
        if (res[LOG_KEY]) memoryLogs = res[LOG_KEY];
        
        const todayStr = new Date().toDateString();
        if (memoryStats.date !== todayStr) {
            memoryStats.todayBlocked = 0;
            memoryStats.date = todayStr;
        }
    })();
    return loadPromise;
}

// 🚀 优化 2：延长至 5 秒批量落盘，极大减少 IO 压力
function scheduleSave() {
    if (saveTimeout) return;
    saveTimeout = setTimeout(async () => {
        saveTimeout = null;
        await chrome.storage.local.set({
            [STATS_KEY]: memoryStats,
            [LOG_KEY]: memoryLogs
        });
    }, 5000); 
}

export function initStatsListener() {
    // 🚀 优化 3：正式版角标更新方案
    // 仅解压版可用 onRuleMatchedDebug。正式版靠底层直接显示 DNR 命中次数
    if (chrome.declarativeNetRequest && chrome.declarativeNetRequest.setExtensionActionOptions) {
        chrome.declarativeNetRequest.setExtensionActionOptions({
            displayActionCountAsBadgeText: true
        }).catch(e => console.warn('DNR 角标接管失败:', e));
    }

    // 仅开发环境用于记录详细日志
    if (chrome.declarativeNetRequest && chrome.declarativeNetRequest.onRuleMatchedDebug) {
        try {
            chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(async (info) => {
                try {
                    const { request } = info;
                    if (!request || !request.url) return;
                    const host = new URL(request.url).hostname;
                    if (host === 'api.dewsecure.com' || host.endsWith('.dewsecure.com')) return;
                    
                    await recordBlock(host + '/dnr', 'dnr');
                } catch (e) {}
            });
        } catch(e) {
            console.warn('onRuleMatchedDebug 不可用:', e);
        }
    }
}

export async function getMatchedStats() {
    await ensureLoaded();
    return { 
        totalBlocked: memoryStats.totalBlocked, 
        todayBlocked: memoryStats.todayBlocked 
    };
}

export async function recordBlock(url, type) {
    await ensureLoaded();
    
    const todayStr = new Date().toDateString();
    if (memoryStats.date !== todayStr) {
        memoryStats.todayBlocked = 0;
        memoryStats.date = todayStr;
    }
    
    memoryStats.totalBlocked += 1;
    memoryStats.todayBlocked += 1;
    
    let domain = '未知';
    try {
        if (url.startsWith('http')) {
            domain = new URL(url).hostname;
        } else {
            domain = url.split('/')[0];
        }
    } catch (e) {}

    memoryLogs.push({ domain, url, type, date: todayStr, ts: Date.now() });
    
    // 🚀 优化 4：取代连续 shift()，批量截断更高效
    if (memoryLogs.length > 1000) {
        memoryLogs.splice(0, memoryLogs.length - 1000);
    }
    
    scheduleSave();
    
    // 🚀 优化 5：移除了 chrome.action.setBadgeText，防止高频 DOM 操作卡死主线程
}
