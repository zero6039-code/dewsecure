import { getCurrentUser } from '../authManager.js';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

// 🔒 核心修复：在 Service Worker 中必须显式注入 SHA-512 引擎，否则验签永远返回 false
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

// 🔒 与模型下发使用同一把公钥
const ED25519_PUBLIC_KEY_HEX = '259eab8b493845eb78e345a139584c6812272d7183c7da29f774dea2d443fe77';

// 动态威胁情报拉取
export async function updateThreatIntel() {
    try {
        const user = await getCurrentUser();
        const isPro = user && user.tier !== 'free';
        
        const { dewsecure_settings: settings } = await chrome.storage.local.get('dewsecure_settings');
        const isEnabled = settings?.intelEnabled !== false;

        // 1. 权限与开关双重拦截
        if (!isPro || !isEnabled) {
            console.log('⏸️ [ThreatIntel] 非 PRO 用户或开关已关闭，跳过拉取。');
            return;
        }

        console.log('📡 [ThreatIntel] 正在拉取云端威胁情报及签名...');
        
        // 2. 并行拉取 JSON 规则和签名文件
        const baseUrl = 'https://dewsecure-api.zero6039.workers.dev/api/intel';
        const [rulesRes, sigRes] = await Promise.all([
            fetch(`${baseUrl}/threat-rules`, { cache: 'default' }),
            fetch(`${baseUrl}/threat-rules.sig`, { cache: 'default' })
        ]);

        if (rulesRes.status === 304 || sigRes.status === 304) {
            console.log('✅ [ThreatIntel] 规则未变动 (命中 ETag 缓存)，跳过更新。');
            return;
        }
        
        if (!rulesRes.ok || !sigRes.ok) {
            throw new Error(`HTTP Error: Rules ${rulesRes.status}, Sig ${sigRes.status}`);
        }

        const rulesData = await rulesRes.json();
        const sigData = await sigRes.json(); // { version, sha256, signature }

        // 3. 验签：计算实际内容的 sha256
        const rulesText = JSON.stringify(rulesData, null, 2); // 必须与 CI 生成的格式完全一致
        const actualHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rulesText))
            .then(buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join(''));

        if (actualHash !== sigData.sha256) {
            console.error('❌ [ThreatIntel] SHA-256 校验失败！文件可能被篡改。');
            return;
        }

        // 4. 验签：Ed25519
        const msgStr = `${sigData.version}:${sigData.sha256}`;
        const msgBytes = new TextEncoder().encode(msgStr);
        const sigBytes = Uint8Array.from(atob(sigData.signature.trim()), c => c.charCodeAt(0));
        const pubKeyBytes = new Uint8Array(ED25519_PUBLIC_KEY_HEX.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

        const isValid = await ed.verifyAsync(sigBytes, msgBytes, pubKeyBytes);
        if (!isValid) {
            console.error('❌ [ThreatIntel] Ed25519 签名校验失败！来源不可信，拒绝更新。');
            return; // 直接 return，保留内存中已有的旧规则
        }

        console.log('✅ [ThreatIntel] 签名校验通过，准备更新动态规则...');

        // 5. 清除旧规则并应用新规则
        const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
        const existingIds = existingRules.map(r => r.id);

        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: existingIds,
            addRules: rulesData
        });
        console.log(`✅ [ThreatIntel] 已成功加载 ${rulesData.length} 条最新拦截规则！`);
        
    } catch (e) {
        console.warn('❌ [ThreatIntel] 更新失败:', e);
    }
}
