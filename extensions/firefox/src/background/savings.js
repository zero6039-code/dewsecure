// ==========================================
// 📊 流量节省估算模块 (V3 完美版)
// ==========================================
let priors = { sub_frame: 120_000, script: 28_000, image: 9_000, xmlhttprequest: 1_500, ping: 300, other: 3_000 };
const typeSeen = {};

// 获取本地时区的日期字符串 YYYY-MM-DD
function getLocalDateStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export function initSavings() {
    if (chrome.webRequest?.onErrorOccurred) {
        chrome.webRequest.onErrorOccurred.addListener(async (d) => {
            if (d.error === 'net::ERR_BLOCKED_BY_CLIENT' && d.tabId >= 0) {
                // 1. 更新类型分布
                typeSeen[d.type] = (typeSeen[d.type] || 0) + 1;

                // 2. 记录详细明细 (用于详情页展示)
                try {
                    const domain = new URL(d.url).hostname;
                    const bytes = priors[d.type] || priors.other;
                    const today = getLocalDateStr();
                    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

                    const { savingsLogs = {} } = await chrome.storage.local.get('savingsLogs');
                    if (!savingsLogs[today]) savingsLogs[today] = [];
                    
                    savingsLogs[today].push({ domain, time: timeStr, type: d.type, bytes });
                    
                    // 每天最多存 1000 条明细
                    if (savingsLogs[today].length > 1000) {
                        savingsLogs[today].splice(0, savingsLogs[today].length - 1000);
                    }
                    // 只保留最近 30 天的明细日志
                    const dates = Object.keys(savingsLogs).sort();
                    for (let i = 0; i < dates.length - 30; i++) {
                        delete savingsLogs[dates[i]];
                    }

                    await chrome.storage.local.set({ savingsLogs });
                } catch(e) {}
            }
        }, { urls: ['<all_urls>'] });
    }
}

function avgBytes() {
    const total = Object.values(typeSeen).reduce((a, b) => a + b, 0);
    if (total < 20) return 14_000;
    return Object.entries(typeSeen).reduce((s, [t, n]) => s + (n / total) * (priors[t] ?? priors.other), 0);
}

export async function addSavings(nBlocked) {
    if (!nBlocked) return;
    try {
        const day = getLocalDateStr(); // 使用本地时间
        const { savings = {} } = await chrome.storage.local.get('savings');
        
        const d = (savings[day] ||= { req: 0, bytes: 0 });
        d.req += nBlocked;
        d.bytes += Math.round(nBlocked * avgBytes());
        
        for (const k of Object.keys(savings).sort().slice(0, -90)) {
            delete savings[k];
        }
        
        await chrome.storage.local.set({ savings });
    } catch (e) {}
}
