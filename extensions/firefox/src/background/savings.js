// ==========================================
// 📊 流量节省估算模块 (V4 修复版)
// ==========================================
let priors = { sub_frame: 120_000, script: 28_000, image: 9_000, xmlhttprequest: 1_500, ping: 300, other: 3_000 };
const typeSeen = {};

function getLocalDateStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// 废弃旧版 webRequest.onErrorOccurred 监听，由 stats.js 的 DNR 统计统一驱动
export function initSavings() {
    // 留空，防止 background.js 报错
}

function avgBytes() {
    const total = Object.values(typeSeen).reduce((a, b) => a + b, 0);
    if (total < 20) return 14_000;
    return Object.entries(typeSeen).reduce((s, [t, n]) => s + (n / total) * (priors[t] ?? priors.other), 0);
}

export async function addSavings(nBlocked, details = []) {
    if (!nBlocked) return;
    try {
        const day = getLocalDateStr();
        const { savings = {}, savingsLogs = {} } = await chrome.storage.local.get(['savings', 'savingsLogs']);

        // 1. 更新总额
        const d = (savings[day] ||= { req: 0, bytes: 0 });
        d.req += nBlocked;
        
        let bytesToAdd = 0;
        if (details.length > 0) {
            details.forEach(item => {
                bytesToAdd += priors[item.type] || priors.other;
            });
        } else {
            bytesToAdd = Math.round(nBlocked * avgBytes());
        }
        d.bytes += bytesToAdd;

        for (const k of Object.keys(savings).sort().slice(0, -90)) {
            delete savings[k];
        }

        // 2. 同步更新明细日志 (解决明细不涨的问题)
        if (details.length > 0) {
            if (!savingsLogs[day]) savingsLogs[day] = [];
            const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            
            details.forEach(item => {
                savingsLogs[day].push({ 
                    domain: item.domain, 
                    time: timeStr, 
                    type: item.type, 
                    bytes: priors[item.type] || priors.other 
                });
            });
            
            if (savingsLogs[day].length > 1000) {
                savingsLogs[day].splice(0, savingsLogs[day].length - 1000);
            }
            const dates = Object.keys(savingsLogs).sort();
            for (let i = 0; i < dates.length - 30; i++) {
                delete savingsLogs[dates[i]];
            }
        }

        await chrome.storage.local.set({ savings, savingsLogs });
    } catch (e) {}
}
