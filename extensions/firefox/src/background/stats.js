import { STATS_KEY, LOG_KEY } from './settings.js';

// 内存缓存，避免 Service Worker 频繁休眠和读写存储导致的丢失
let memoryStats = { totalBlocked: 0, todayBlocked: 0, date: '' };
let memoryLogs = [];
let isLoaded = false;
let saveTimeout = null;

// 启动时从本地加载一次
async function ensureLoaded() {
    if (isLoaded) return;
    const res = await chrome.storage.local.get([STATS_KEY, LOG_KEY]);
    if (res[STATS_KEY]) memoryStats = res[STATS_KEY];
    if (res[LOG_KEY]) memoryLogs = res[LOG_KEY];
    
    const todayStr = new Date().toDateString();
    if (memoryStats.date !== todayStr) {
        memoryStats.todayBlocked = 0;
        memoryStats.date = todayStr;
    }
    isLoaded = true;
}

// 批量写入防抖（每秒最多写一次）
function scheduleSave() {
    if (saveTimeout) return;
    saveTimeout = setTimeout(async () => {
        saveTimeout = null;
        await chrome.storage.local.set({
            [STATS_KEY]: memoryStats,
            [LOG_KEY]: memoryLogs
        });
    }, 1000);
}

export function initStatsListener() {
    // 🛡️ Whale 等浏览器如果不支持 onRuleMatchedDebug 会自动跳过
    if (chrome.declarativeNetRequest && chrome.declarativeNetRequest.onRuleMatchedDebug) {
        try {
            chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(async (info) => {
                try {
                    const { request } = info;
                    if (!request || !request.url) return;
                    const host = new URL(request.url).hostname;
                    // 🛡️ 修复：忽略对自家后台 API 的拦截记录，防止统计面板被污染
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
    
    // 🛡️ M-6 修复：解析并写入 domain 字段，解决 UI 显示 undefined 的问题
    let domain = '未知';
    try {
        if (url.startsWith('http')) {
            domain = new URL(url).hostname;
        } else {
            // 兼容 host + '/dnr' 或 host + '/dom-hidden' 的格式
            domain = url.split('/')[0];
        }
    } catch (e) {}

    memoryLogs.push({
        domain, // 👈 新增 domain 字段
        url,
        type,
        date: todayStr,
        ts: Date.now()
    });
    if (memoryLogs.length > 1000) memoryLogs.shift();
    
    scheduleSave();
    
    // 实时更新角标
    if (chrome.action && chrome.action.setBadgeText) {
        chrome.action.setBadgeText({ text: memoryStats.todayBlocked.toString() });
        chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' });
    }
}
