import { getSettings, STATS_KEY, LOG_KEY } from './settings.js';

export async function recordDetailedBlock(url, type) {
    try {
        let safeUrl = url.substring(0, 100);
        let domain = '未知';
        try {
            const urlObj = new URL(url.startsWith('http') ? url : 'https://' + url);
            safeUrl = `${urlObj.hostname}${urlObj.pathname}`;
            domain = urlObj.hostname;
        } catch (e) {}
        let { [LOG_KEY]: logs } = await chrome.storage.local.get(LOG_KEY);
        if (!Array.isArray(logs)) logs = [];
        logs.push({ url: safeUrl, domain: domain, type: type, ts: Date.now(), date: new Date().toDateString() });
        if (logs.length > 1000) logs.shift();
        await chrome.storage.local.set({ [LOG_KEY]: logs });
    } catch (e) {}
}

export async function recordBlock(url, type = 'dnr') {
    await recordDetailedBlock(url, type);
    let { [STATS_KEY]: stats } = await chrome.storage.local.get(STATS_KEY);
    let safeStats = (stats && typeof stats === 'object') ? stats : {};
    safeStats.totalBlocked = Number(safeStats.totalBlocked) || 0;
    safeStats.todayBlocked = Number(safeStats.todayBlocked) || 0;
    const today = new Date().toDateString();
    if (safeStats.lastReset !== today) {
        safeStats.todayBlocked = 0;
        safeStats.lastReset = today;
    }
    safeStats.totalBlocked += 1;
    safeStats.todayBlocked += 1;
    await chrome.storage.local.set({ [STATS_KEY]: safeStats });
    
    if (chrome.action) {
        const text = safeStats.todayBlocked > 999 ? '999+' : safeStats.todayBlocked.toString();
        chrome.action.setBadgeText({ text });
        chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
    }
}

export function initStatsListener() {
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
