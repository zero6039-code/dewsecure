import { STATS_KEY, LOG_KEY } from './settings.js';

// 恢复原版依赖本地调试的统计方式，避免 store 版报错
export function initStatsListener() {
    if (chrome.declarativeNetRequest && chrome.declarativeNetRequest.onRuleMatchedDebug) {
        chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(async (info) => {
            try {
                const { request } = info;
                if (!request || !request.url) return;
                const host = new URL(request.url).hostname;
                await recordBlock(host + '/dnr', 'dnr');
            } catch (e) {}
        });
    }
}

export async function getMatchedStats() {
    let { [STATS_KEY]: stats } = await chrome.storage.local.get(STATS_KEY);
    if (!stats || typeof stats !== 'object') stats = { totalBlocked: 0, todayBlocked: 0 };
    
    const todayStr = new Date().toDateString();
    if (stats.date !== todayStr) {
        stats.todayBlocked = 0;
        stats.date = todayStr;
    }
    return stats;
}

export async function recordBlock(url, type) {
    const { [STATS_KEY]: stats = { totalBlocked: 0, todayBlocked: 0, date: '' } } = await chrome.storage.local.get(STATS_KEY);
    const { [LOG_KEY]: logs = [] } = await chrome.storage.local.get(LOG_KEY);
    
    const todayStr = new Date().toDateString();
    if (stats.date !== todayStr) {
        stats.todayBlocked = 0;
        stats.date = todayStr;
    }
    
    stats.totalBlocked = (stats.totalBlocked || 0) + 1;
    stats.todayBlocked = (stats.todayBlocked || 0) + 1;
    
    logs.push({
        url,
        type,
        date: todayStr,
        ts: Date.now()
    });
    if (logs.length > 1000) logs.splice(0, logs.length - 1000);
    
    await chrome.storage.local.set({
        [STATS_KEY]: stats,
        [LOG_KEY]: logs
    });
    
    // 更新图标角标
    if (chrome.action && chrome.action.setBadgeText) {
        chrome.action.setBadgeText({ text: stats.todayBlocked.toString() });
        chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' });
    }
}
