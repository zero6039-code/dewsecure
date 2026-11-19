import { STATS_KEY, LOG_KEY } from './settings.js';
import { addSavings } from './savings.js';

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

    // 2. 通用 webRequest 观察者模式（兼容商店版，无阻塞）
    if (chrome.webRequest?.onBeforeRequest) {
        try {
            chrome.webRequest.onBeforeRequest.addListener(
                (details) => {
                    if (details.url.includes('dewsecure.com') || details.tabId === -1) return;
                    
                    // Chrome / Whale 商店版：使用 testMatchOutcome 纯本地匹配
                    if (!navigator.userAgent.includes('Firefox') && chrome.declarativeNetRequest?.testMatchOutcome) {
                        const validTypes = ['main_frame', 'sub_frame', 'script', 'image', 'xmlhttprequest', 'stylesheet'];
                        if (!validTypes.includes(details.type)) return;

                        chrome.declarativeNetRequest.testMatchOutcome({
                            url: details.url,
                            type: details.type,
                            tabId: details.tabId,
                            initiator: details.initiator
                        }).then(res => {
                            if (res.matchedRules && res.matchedRules.length > 0) {
                                try {
                                    const host = new URL(details.url).hostname;
                                    recordBlock(details.url, 'dnr-intercept');
                                } catch (e) {}
                            }
                        }).catch(() => {});
                    } else if (navigator.userAgent.includes('Firefox')) {
                        // Firefox 旧版逻辑
                        try {
                            const host = new URL(details.url).hostname;
                            recordBlock(host + '/webRequest', 'webRequest');
                        } catch (e) {}
                    }
                },
                { urls: ["<all_urls>"] }
            );
        } catch (e) {
            console.warn('webRequest 监听注册失败', e);
        }
    }

    // 3. 兜底：开发版 onRuleMatchedDebug
    if (chrome.declarativeNetRequest?.onRuleMatchedDebug) {
        try {
            chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(async (info) => {
                if (info.request?.url && !info.request.url.includes('dewsecure.com')) {
                    await recordBlock(info.request.url, 'dnr-debug');
                }
            });
        } catch(e) {}
    }

    // 4. 游标与节流持久化，按规则过滤
    if (chrome.declarativeNetRequest?.getMatchedRules) {
        const BLOCK_RULESETS = new Set(['ads', 'trackers', 'malware']); // 补充 manifest 静态规则集
        const isBlockRule = ({ rulesetId, ruleId }) =>
            BLOCK_RULESETS.has(rulesetId) ||
            (rulesetId === '_dynamic' && ((ruleId >= 900000 && ruleId < 901000) || ruleId >= 1000000));

        let isFetching = false;
        const fetchDNRStats = async () => {
            if (isFetching) return;
            isFetching = true;
            try {
                const sess = await chrome.storage.session.get(['dnrStatCursor', 'dnrLastFetch']);
                let statCursor = sess.dnrStatCursor || 0;
                const lastFetch = sess.dnrLastFetch || 0;
                
                if (Date.now() - lastFetch < 5000) return;
                await chrome.storage.session.set({ dnrLastFetch: Date.now() });

                const queryTime = Date.now();
                const matched = await chrome.declarativeNetRequest.getMatchedRules({ minTimeStamp: statCursor + 1 });
                
                // 无论是否有匹配，都先推进游标到查询时间，防止空窗期漏算
                await chrome.storage.session.set({ dnrStatCursor: queryTime });

                if (matched?.rulesMatchedInfo?.length > 0) {
                    const newest = Math.max(...matched.rulesMatchedInfo.map(r => r.timeStamp));
                    await chrome.storage.session.set({ dnrStatCursor: newest }); // 有数据则推到最新时间

                    await ensureLoaded();
                    const todayStr = new Date().toDateString();

                    const newRulesMatched = matched.rulesMatchedInfo.filter(info => {
                        if (!isBlockRule(info.rule || {})) return false;
                        const url = info.request?.url;
                        if (!url || url.includes('dewsecure.com')) return false;
                        return !memoryLogs.some(l => l.url === url && l.ts >= statCursor);
                    });

                    if (newRulesMatched.length > 0) {
                        memoryStats.totalBlocked += newRulesMatched.length;
                        memoryStats.todayBlocked += newRulesMatched.length;

                        newRulesMatched.forEach(info => {
                            const url = info.request.url;
                            let domain = '未知';
                            try { domain = new URL(url).hostname; } catch (e) {}
                            memoryLogs.push({ domain, url, type: 'dnr-intercept', date: todayStr, ts: Date.now() });
                        });

                        if (memoryLogs.length > 1000) memoryLogs.splice(0, memoryLogs.length - 1000);
                        scheduleSave();

                        const details = newRulesMatched.map(info => ({
                            domain: (() => { try { return new URL(info.request.url).hostname; } catch { return '未知'; } })(),
                            url: info.request.url,
                            type: info.request.type || 'other'
                        }));
                        addSavings(newRulesMatched.length, details).catch(e => console.warn('Savings error:', e));
                    }
                }
            } catch (e) {
                if (e.message && e.message.includes('quota')) {
                    await chrome.storage.session.set({ dnrLastFetch: Date.now() + 30000 });
                }
            } finally {
                isFetching = false;
            }
        };

        // 触发时机 1：标签页加载状态改变
        chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
            if (changeInfo.status === 'complete') fetchDNRStats();
        });

        // 触发时机 2：主框架导航提交
        if (chrome.webNavigation?.onCommitted) {
            chrome.webNavigation.onCommitted.addListener((details) => {
                if (details.frameId === 0) fetchDNRStats();
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
    // 🛡️ 修复: 同步记录流量节省，防止 recordBlock 提前消耗日志导致 addSavings 饿死
    addSavings(1, [{ domain, url, type }]).catch(e => console.warn('Savings error:', e));
}
