import { getSettings, STATS_KEY, LOG_KEY } from './settings.js';

// 🛡️ F-06 修复：内存缓存与防抖写入
let memoryLogs = null;
let memoryStats = null;
let flushTimer = null;

async function loadFromStorage() {
    if (memoryLogs === null || memoryStats === null) {
        const res = await chrome.storage.local.get([LOG_KEY, STATS_KEY]);
        memoryLogs = Array.isArray(res[LOG_KEY]) ? res[LOG_KEY] : [];
        memoryStats = res[STATS_KEY] || { totalBlocked: 0, todayBlocked: 0, lastReset: '' };
    }
}

async function flushToStorage() {
    if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }
    if (memoryLogs !== null && memoryStats !== null) {
        await chrome.storage.local.set({
            [LOG_KEY]: memoryLogs,
            [STATS_KEY]: memoryStats
        });
    }
}

function scheduleFlush() {
    if (!flushTimer) {
        flushTimer = setTimeout(flushToStorage, 2000); // 2秒节流批量落盘
    }
}

export async function recordDetailedBlock(url, type) {
    try {
        await loadFromStorage();
        let domain = '未知';
        try {
            const urlObj = new URL(url.startsWith('http') ? url : 'https://' + url);
            domain = urlObj.hostname; // 🛡️ 修复：只保留域名，不存路径
        } catch (e) {}

        memoryLogs.push({
            url: domain, // UI 显示用
            domain: domain,
            type: type,
            ts: Date.now(),
            date: new Date().toDateString()
        });

        if (memoryLogs.length > 1000) {
            memoryLogs.splice(0, memoryLogs.length - 1000);
        }
        scheduleFlush();
    } catch (e) {}
}

export async function recordBlock(url, type = 'dnr') {
    await recordDetailedBlock(url, type);
    await loadFromStorage();

    const today = new Date().toDateString();
    if (memoryStats.lastReset !== today) {
        memoryStats.todayBlocked = 0;
        memoryStats.lastReset = today;
    }
    memoryStats.totalBlocked += 1;
    memoryStats.todayBlocked += 1;
    
    // 移除了 chrome.action.setBadgeText，交给 DNR 原生接管
    scheduleFlush();
}

export function initStatsListener() {
    // DNR 原生接管角标显示
    if (chrome.declarativeNetRequest && chrome.declarativeNetRequest.setExtensionActionOptions) {
        chrome.declarativeNetRequest.setExtensionActionOptions({
            displayActionCountAsBadgeText: true
        }).catch(e => console.warn('DNR 角标接管失败:', e));
    }

    if (chrome.declarativeNetRequest && chrome.declarativeNetRequest.onRuleMatchedDebug) {
        chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(async (info) => {
            try {
                const urlObj = new URL(info.request.url);
                const host = urlObj.hostname;
                const settings = await getSettings();
                if ((settings.whitelist || []).some(d => host === d || host.endsWith('.' + d)) ||
                    (settings.tempWhitelist || []).some(d => host === d || host.endsWith('.' + d))) return;
                
                let type = 'dnr';
                if (info.rule && info.rule.rulesetId && info.rule.rulesetId.includes('tracker')) type = 'tracker';
                else if (info.rule && info.rule.rulesetId && info.rule.rulesetId.includes('ads')) type = 'ad';
                await recordBlock(info.request.url, type);
            } catch(e) {}
        });
    }
}

export async function getMatchedStats() {
    await loadFromStorage();
    return {
        todayBlocked: memoryStats.todayBlocked || 0,
        totalBlocked: memoryStats.totalBlocked || 0
    };
}
