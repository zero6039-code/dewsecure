import { getCurrentUser } from '../authManager.js';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));
const ED25519_PUBLIC_KEY_HEX = 'a21b4c875ab246b58adc225ddf66a054cfa7b79ed2093fcc2f97598fd1197631';
const CACHE_KEY = 'dewsecure_intel_cache';

// 🌟 核心函数：只负责把规则应用到浏览器（不涉及网络）
async function applyRulesToDNR() {
    const user = await getCurrentUser();
    const isPro = user && user.tier !== 'free';
    const { dewsecure_settings: settings } = await chrome.storage.local.get('dewsecure_settings');
    const isEnabled = settings?.intelEnabled !== false;

    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const existingIds = existing.map(r => r.id);

    // 如果未登录、非 PRO 或开关关闭，清空后直接返回
    if (!isPro || !isEnabled) {
        if (existingIds.length > 0) {
            await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existingIds });
        }
        console.log('⏸️ [ThreatIntel] 开关已关闭或非 PRO，已清空拦截规则。');
        return;
    }

    const { [CACHE_KEY]: cache } = await chrome.storage.local.get(CACHE_KEY);
    if (cache && cache.rulesData) {
        const HARD_SAFE = [
            'github.com', 'githubusercontent.com', 'github.io', 'gitlab.com', 
            'npmjs.com', 'cloudflare.com', 'microsoft.com', 'apple.com', 
            'dewsecure.com', 'google.com', 'youtube.com', 'facebook.com'
        ];

        const newRules = [];
        for (const rule of cache.rulesData) {
            try {
                // 🛡️ M4 修复：安全提取 domain，防止 undefined 抛异常
                const domain = rule.condition?.requestDomains?.[0];
                if (!domain) continue; 
                
                if (HARD_SAFE.some(d => domain === d || domain.endsWith('.' + d))) continue;
                
                rule.condition.resourceTypes = ["main_frame", "sub_frame"];
                newRules.push({
                    ...rule,
                    action: {
                        type: 'redirect',
                        redirect: {
                            extensionPath: `/warning.html?type=intel&domain=${encodeURIComponent(domain)}`
                        }
                    }
                });
            } catch (e) {
                console.warn('[ThreatIntel] 忽略一条异常规则:', e);
            }
        }

        // 🛡️ M4 修复：原子替换规则，防清空
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: existingIds,
            addRules: newRules
        });
        console.log(`✅ [ThreatIntel] 已原子替换 ${newRules.length} 条拦截规则！`);
    } else if (existingIds.length > 0) {
        // 如果没有缓存但有旧规则，清空
        await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existingIds });
    }
}

// 🌟 核心函数：负责去云端拉取最新数据并缓存
export async function updateThreatIntel() {
    try {
        const user = await getCurrentUser();
        const isPro = user && user.tier !== 'free';
        const { dewsecure_settings: settings } = await chrome.storage.local.get('dewsecure_settings');
        const isEnabled = settings?.intelEnabled !== false;

        if (!isPro || !isEnabled) {
            // 没权限或没开，直接清理 DNR 即可，不联网
            await applyRulesToDNR();
            return;
        }

        console.log('📡 [ThreatIntel] 正在拉取云端最新情报...');
        const baseUrl = 'https://api.dewsecure.com/api/intel';
        
        const headers = user?.token ? { 'Authorization': `Bearer ${user.token}` } : {};
        const [rulesRes, sigRes] = await Promise.all([
            fetch(`${baseUrl}/threat-rules`, { cache: 'no-store', headers }),
            fetch(`${baseUrl}/threat-rules.sig`, { cache: 'no-store', headers })
        ]);

        if (!rulesRes.ok || !sigRes.ok) throw new Error(`HTTP Error`);

        // 🛡️ M4 修复：对原始 arrayBuffer 计算哈希，防止 JSON 重新序列化导致验签失败
        const rulesBuffer = await rulesRes.arrayBuffer();
        const sigData = await sigRes.json();
        
        const actualHash = await crypto.subtle.digest('SHA-256', rulesBuffer)
            .then(buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join(''));

        if (actualHash !== sigData.sha256) throw new Error('SHA-256 mismatch');

        const msgStr = `${sigData.version}:${sigData.sha256}`;
        const sigBytes = Uint8Array.from(atob(sigData.signature.trim()), c => c.charCodeAt(0));
        const pubKeyBytes = new Uint8Array(ED25519_PUBLIC_KEY_HEX.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

        if (!(await ed.verifyAsync(sigBytes, new TextEncoder().encode(msgStr), pubKeyBytes))) {
            throw new Error('Ed25519 signature invalid');
        }

        console.log('✅ [ThreatIntel] 签名校验通过，写入本地缓存...');
        const rulesData = JSON.parse(new TextDecoder().decode(rulesBuffer));
        // 🌟 缓存到本地
        await chrome.storage.local.set({ [CACHE_KEY]: { rulesData, sigData } });
        
        // 应用规则
        await applyRulesToDNR();

    } catch (e) {
        console.warn('❌ [ThreatIntel] 拉取失败:', e);
        // 网络失败时，如果开关是开的，尽量恢复本地已有缓存
        await applyRulesToDNR(); 
    }
}
