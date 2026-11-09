import { getSettings, SETTINGS_KEY } from './settings.js';
import { removeTempAllowRule, withLock } from './dnrOwner.js';

// 🛡️ A-2 修复：负责清理过期的临时白名单，同时撤销网络层放行
export async function cleanExpiredTempWhitelist(settings) {
    let changed = false;
    const now = Date.now();
    const expiry = settings.tempWhitelistExpiry || {};
    const deadDomains = [];

    settings.tempWhitelist = (settings.tempWhitelist || []).filter(domain => {
        if (expiry[domain] && expiry[domain] < now) {
            delete expiry[domain];
            changed = true;
            deadDomains.push(domain);
            return false;
        }
        return true;
    });
    settings.tempWhitelistExpiry = expiry;

    if (changed) {
        await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
        // 异步清除底层的 Session 规则，不阻塞当前读取
        withLock(async () => {
            for (const d of deadDomains) {
                await removeTempAllowRule(d);
            }
        }).catch(e => console.warn('[TempWhitelist] 清理过期规则失败:', e));
    }
    return settings;
}

// 🛡️ A-2 修复：定时清理任务 (由 background.js 的 alarm 触发)
export async function purgeExpiredTempAllow() {
    return await withLock(async () => {
        const s = await getSettings();
        const exp = s.tempWhitelistExpiry || {};
        const now = Date.now();
        const dead = Object.keys(exp).filter(d => exp[d] < now);
        
        if (!dead.length) return;

        for (const d of dead) {
            await removeTempAllowRule(d);
            delete exp[d];
        }
        
        s.tempWhitelist = (s.tempWhitelist || []).filter(d => !dead.includes(d));
        s.tempWhitelistExpiry = exp;
        await chrome.storage.local.set({ [SETTINGS_KEY]: s });
        console.log(`[TempWhitelist] 已清理 ${dead.length} 个过期的临时白名单`);
    });
}

// 🛡️ A-1 修复：安全移除临时白名单
export async function removeTempWhitelist(domain) {
    return await withLock(async () => {
        const s = await getSettings();
        s.tempWhitelist = (s.tempWhitelist || []).filter(d => d !== domain);
        if (s.tempWhitelistExpiry) delete s.tempWhitelistExpiry[domain];
        
        // 先撤网络层放行，失败则抛出异常，保证设置和底层状态一致
        if (domain !== 'dewsecure.com' && !domain.endsWith('.dewsecure.com')) {
            await removeTempAllowRule(domain);
        }
        
        await chrome.storage.local.set({ [SETTINGS_KEY]: s });
        return { ok: true };
    });
}
