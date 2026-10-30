import { getSettings, SETTINGS_KEY } from './settings.js';

export async function applySessionRuleForDomain(domain, shouldAllow) {
    if (domain === 'dewsecure.com' || domain.endsWith('.dewsecure.com')) return;
    const ruleId = Math.floor(Math.abs(domain.split('').reduce((a,b)=>((a<<5)-a)+b.charCodeAt(0),0)) % 1000000) + 10000;
    try {
        if (shouldAllow) {
            await chrome.declarativeNetRequest.updateSessionRules({
                removeRuleIds: [ruleId],
                addRules: [{
                    id: ruleId, priority: 100000,
                    action: { type: 'allowAllRequests' },
                    condition: { requestDomains: [domain], resourceTypes: ['main_frame', 'sub_frame'] }
                }]
            });
        } else {
            await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] });
        }
    } catch (e) { console.warn('规则更新失败:', e); }
}

export async function restoreSessionRules() {
    const settings = await getSettings();
    if (settings.tempWhitelist && settings.tempWhitelist.length > 0) {
        for (const d of settings.tempWhitelist) {
            await applySessionRuleForDomain(d, true);
        }
    }
}
