import { getSettings, SETTINGS_KEY } from './settings.js';

// 🔒 M-5 修复：持久化自增规则 ID 映射，避免哈希碰撞
async function getOrCreateRuleId(domain) {
    const { ruleIdMap = {}, nextRuleId = 10000 } = await chrome.storage.local.get(['ruleIdMap', 'nextRuleId']);
    if (ruleIdMap[domain]) return ruleIdMap[domain];
    
    const newId = nextRuleId;
    ruleIdMap[domain] = newId;
    await chrome.storage.local.set({ ruleIdMap, nextRuleId: newId + 1 });
    return newId;
}

export async function applySessionRuleForDomain(domain, shouldAllow) {
    if (domain === 'dewsecure.com' || domain.endsWith('.dewsecure.com')) return;
    
    try {
        const ruleId = await getOrCreateRuleId(domain);
        if (shouldAllow) {
            await chrome.declarativeNetRequest.updateSessionRules({
                removeRuleIds: [ruleId],
                addRules: [{
                    id: ruleId, 
                    priority: 2147483647, 
                    action: { type: 'allow' }, // 统一使用 allow（最高优先级 + 全资源放行）
                    condition: { 
                        requestDomains: [domain], 
                        resourceTypes: [
                            "main_frame", "sub_frame", "stylesheet", "script", "image", 
                            "font", "object", "xmlhttprequest", "ping", "csp_report", 
                            "media", "websocket", "webtransport", "webbundle", "other"
                        ] 
                    }
                }]
            });
        } else {
            await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] });
        }
    } catch (e) { console.warn('规则更新失败:', e); }
}

export async function restoreSessionRules() {
    let settings = await getSettings();
    let changed = false;
    const now = Date.now();
    const expiry = settings.tempWhitelistExpiry || {};
    
    // 🔒 H-3 修复：清理过期临时白名单
    if (settings.tempWhitelist) {
        settings.tempWhitelist = settings.tempWhitelist.filter(domain => {
            if (expiry[domain] && expiry[domain] < now) {
                delete expiry[domain];
                changed = true;
                return false;
            }
            return true;
        });
        settings.tempWhitelistExpiry = expiry;
        if (changed) {
            await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
        }
    }

    // 恢复所有未过期的临时白名单规则
    if (settings.tempWhitelist && settings.tempWhitelist.length > 0) {
        for (const d of settings.tempWhitelist) {
            await applySessionRuleForDomain(d, true);
        }
    }
}
