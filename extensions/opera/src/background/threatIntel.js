import { getCurrentUser } from '../authManager.js';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));
const ED25519_PUBLIC_KEY_HEX = '259eab8b493845eb78e345a139584c6812272d7183c7da29f774dea2d443fe77';
const CACHE_KEY = 'dewsecure_intel_cache';

// 🌟 核心函数：只负责把规则应用到浏览器（不涉及网络）
async function applyRulesToDNR() {
    const user = await getCurrentUser();
    const isPro = user && user.tier !== 'free';
    const { dewsecure_settings: settings } = await chrome.storage.local.get('dewsecure_settings');
    const isEnabled = settings?.intelEnabled !== false;

    // 先清理现有的动态规则
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    if (existing.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: existing.map(r => r.id)
        });
    }

    // 如果未登录、非 PRO 或开关关闭，清空后直接返回（实现瞬间放行）
    if (!isPro || !isEnabled) {
        console.log('⏸️ [ThreatIntel] 开关已关闭或非 PRO，已清空拦截规则。');
        return;
    }

    // 如果是打开的，从本地缓存读取规则并注入
    const { [CACHE_KEY]: cache } = await chrome.storage.local.get(CACHE_KEY);
    if (cache && cache.rulesData) {
        // 将 block 改为 redirect
        const processedRules = cache.rulesData.map(rule => {
            if (rule.condition && rule.condition.resourceTypes) {
                rule.condition.resourceTypes = ["main_frame", "sub_frame"];
            }
            const domain = rule.condition.requestDomains[0];
            return {
                ...rule,
                action: {
                    type: 'redirect',
                    redirect: {
                        extensionPath: `/warning.html?type=intel&domain=${encodeURIComponent(domain)}`
                    }
                }
            };
        });

        await chrome.declarativeNetRequest.updateDynamicRules({
            addRules: processedRules
        });
        console.log(`✅ [ThreatIntel] 已从本地缓存恢复 ${processedRules.length} 条拦截规则！`);
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
        const baseUrl = 'https://dewsecure-api.zero6039.workers.dev/api/intel';
        
        const [rulesRes, sigRes] = await Promise.all([
            fetch(`${baseUrl}/threat-rules`, { cache: 'no-store' }),
            fetch(`${baseUrl}/threat-rules.sig`, { cache: 'no-store' })
        ]);

        if (!rulesRes.ok || !sigRes.ok) throw new Error(`HTTP Error`);

        const rulesData = await rulesRes.json();
        const sigData = await sigRes.json();

        // 验签
        const rulesText = JSON.stringify(rulesData, null, 2);
        const actualHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rulesText))
            .then(buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join(''));

        if (actualHash !== sigData.sha256) throw new Error('SHA-256 mismatch');

        const msgStr = `${sigData.version}:${sigData.sha256}`;
        const sigBytes = Uint8Array.from(atob(sigData.signature.trim()), c => c.charCodeAt(0));
        const pubKeyBytes = new Uint8Array(ED25519_PUBLIC_KEY_HEX.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

        if (!(await ed.verifyAsync(sigBytes, new TextEncoder().encode(msgStr), pubKeyBytes))) {
            throw new Error('Ed25519 signature invalid');
        }

        console.log('✅ [ThreatIntel] 签名校验通过，写入本地缓存...');
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
