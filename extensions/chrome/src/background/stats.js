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
    if (navigator.userAgent.includes('Firefox') && chrome.webRequest?.onBeforeRequest) {
        try {
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
        } catch (e) {}
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

    // 4. 🌟 P-5 终极修复：由页面加载和完成事件驱动 getMatchedRules
    // 移除不可靠且容易超配额的 setInterval 轮询，避免 MV3 SW 休眠导致的统计中断
    if (chrome.declarativeNetRequest?.getMatchedRules) {
        let lastFetchTime = Date.now();
        let isFetching = false;

        // 节流执行函数
        const fetchDNRStats = async () => {
            if (isFetching) return;
            // 保证两次调用至少间隔 5 秒，防止频繁导航耗尽配额 (配额限制: 10分钟20次)
            if (Date.now() - lastFetchTime < 5000) return;
            isFetching = true;

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
            } catch (e) {
                // 如果是 429 Too Many Requests 配额错误，推迟下次执行时间
                if (e.message && e.message.includes('quota')) {
                    lastFetchTime = Date.now() + 30000;
                }
            } finally {
                isFetching = false;
            }
        };

        // 触发时机 1：标签页加载状态改变（complete 意味着页面及资源基本加载完毕）
        chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
            if (changeInfo.status === 'complete') {
                fetchDNRStats();
            }
        });

        // 触发时机 2：主框架导航提交（补足部分不触发 complete 的情况）
        if (chrome.webNavigation?.onCommitted) {
            chrome.webNavigation.onCommitted.addListener((details) => {
                if (details.frameId === 0) {
                    fetchDNRStats();
                }
            });
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

    if (memoryLogs.length > 1000) {
        memoryLogs.splice(0, memoryLogs.length - 1000);
    }

    scheduleSave();
}
