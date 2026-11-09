import { STATS_KEY, LOG_KEY } from './settings.js';

let memoryStats = { totalBlocked: 0, todayBlocked: 0, date: '' };
let memoryLogs = [];
let loadPromise = null;
let saveTimeout = null;

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
    // 1. 角标接管（所有平台）
    if (chrome.declarativeNetRequest?.setExtensionActionOptions) {
        chrome.declarativeNetRequest.setExtensionActionOptions({ displayActionCountAsBadgeText: true }).catch(() => {});
    }

    // 2. 🦊 Firefox 主力：通过阻塞式 webRequest 实时统计
    // AdGuard 在 Firefox 上正是依赖此 API 来精确计数
    if (navigator.userAgent.includes('Firefox') && chrome.webRequest?.onBeforeRequest) {
        try {
            // 注意：这里不能传第三个参数 ["blocking"]，因为我们只监听不阻断，否则报错
            chrome.webRequest.onBeforeRequest.addListener(
                (details) => {
                    if (details.url.includes('dewsecure.com')) return;
                    try {
                        const host = new URL(details.url).hostname;
                        recordBlock(host + '/webRequest', 'webRequest');
                    } catch (e) {}
                },
                { urls: ["<all_urls>"] }
            );
            console.log('[DewSecure Stats] ✅ 已启用 webRequest 实时统计 (Firefox 主力方案)');
        } catch (e) {
            console.warn('[DewSecure Stats] ⚠️ webRequest 监听器注册失败:', e.message);
        }
    }

    // 3. 兜底：开发版 onRuleMatchedDebug
    if (chrome.declarativeNetRequest?.onRuleMatchedDebug) {
        try {
            chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(async (info) => {
                if (info.request?.url && !info.request.url.includes('dewsecure.com')) {
                    await recordBlock(new URL(info.request.url).hostname + '/dnr-debug', 'dnr-debug');
                }
            });
        } catch(e) {}
    }

    // 4. 辅助兜底：getMatchedRules 增量轮询
    if (chrome.declarativeNetRequest?.getMatchedRules) {
        let lastFetchTime = Date.now();
        const safeIntervalMs = 30000; 
        setInterval(async () => {
            try {
                const now = Date.now();
                const matched = await chrome.declarativeNetRequest.getMatchedRules({ minTimeStamp: lastFetchTime });
                if (matched?.rulesMatchedInfo?.length > 0) {
                    const count = matched.rulesMatchedInfo.length;
                    await ensureLoaded();
                    memoryStats.totalBlocked += count;
                    memoryStats.todayBlocked += count;
                    scheduleSave();
                }
                lastFetchTime = now;
            } catch (e) { /* 忽略配额错误 */ }
        }, safeIntervalMs);
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

    if (memoryLogs.length > 1000) {
        memoryLogs.splice(0, memoryLogs.length - 1000);
    }

    scheduleSave();
}
