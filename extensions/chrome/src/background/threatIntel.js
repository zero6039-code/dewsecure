import { getCurrentUser } from '../authManager.js';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));
const ED25519_PUBLIC_KEY_HEX = 'a21b4c875ab246b58adc225ddf66a054cfa7b79ed2093fcc2f97598fd1197631';
const CACHE_KEY = 'dewsecure_intel_cache';


// ==========================================
// 🚀 百万级本地过滤器 (Threat Filter)
// ==========================================
let threatFilter = null; // 内存中的过滤器实例

// 极简 IndexedDB 封装
const DB_NAME = 'dewsecure_threat_db';
const STORE_NAME = 'filters';
function getDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
async function saveFilterToDB(buffer, meta) {
    const db = await getDB();
    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put({ buffer, meta }, 'threat-filter');
        tx.oncomplete = () => resolve();
    });
}
async function loadFilterFromDB() {
    const db = await getDB();
    return new Promise((resolve) => {
        const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get('threat-filter');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
    });
}

// 与 Python 完全一致的 Bloom Filter 实现
class FastBloomFilter {
    constructor(arrayBuffer) {
        const view = new DataView(arrayBuffer);
        this.bits = view.getUint32(0, true); // 小端序
        this.hashCount = view.getUint32(4, true);
        this.buffer = new Uint8Array(arrayBuffer, 8); // 跳过前8字节
    }
    _hashes(str) {
        let h1 = 0x811c9dc5;
        let h2 = 0x1000193;
        for (let i = 0; i < str.length; i++) {
            const c = str.charCodeAt(i);
            h1 = Math.imul(h1 ^ c, 0x01000193);
            h2 = Math.imul(h2 ^ c, 0x01000193);
        }
        return [h1 >>> 0, h2 >>> 0];
    }
    has(str) {
        const [h1, h2] = this._hashes(str);
        for (let i = 0; i < this.hashCount; i++) {
            const combinedHash = (h1 + i * h2) >>> 0;
            const bitIndex = combinedHash % this.bits;
            const byteIndex = bitIndex >>> 3;
            const bitOffset = bitIndex & 7;
            if ((this.buffer[byteIndex] & (1 << bitOffset)) === 0) {
                return false;
            }
        }
        return true;
    }
}

export async function initThreatFilter() {
    try {
        const cached = await loadFilterFromDB();
        if (cached && cached.buffer) {
            threatFilter = new FastBloomFilter(cached.buffer);
            console.log('⚡ [ThreatIntel] 过滤器已从 IndexedDB 加载至内存');
        }
    } catch (e) {
        console.warn('加载本地过滤器失败', e);
    }
}

export function checkThreatFilter(host) {
    if (!threatFilter) return false;
    return threatFilter.has(host);
}


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
            'dewsecure.com', 'google.com', 'youtube.com', 'facebook.com',
            'dropbox.com', 'dropboxusercontent.com'
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
        // 🚀 新增：下载百万级过滤器
        try {
            const [binRes, metaRes] = await Promise.all([
                fetch(`${baseUrl}/threat-filter.bin`, { cache: 'no-store', headers }),
                fetch(`${baseUrl}/threat-filter.meta.json`, { cache: 'no-store', headers })
            ]);
            if (binRes.ok && metaRes.ok) {
                const binBuffer = await binRes.arrayBuffer();
                const metaData = await metaRes.json();
                const binHash = await crypto.subtle.digest('SHA-256', binBuffer).then(buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join(''));
                
                if (binHash === metaData.sha256) {
                    const msg = `${metaData.version}:${metaData.sha256}`;
                    const sigBytes = Uint8Array.from(atob(metaData.signature.trim()), c => c.charCodeAt(0));
                    const pubKeyBytes = new Uint8Array(ED25519_PUBLIC_KEY_HEX.match(/.{1,2}/g).map(b => parseInt(b, 16)));
                    
                    if (await ed.verifyAsync(sigBytes, new TextEncoder().encode(msg), pubKeyBytes)) {
                        await saveFilterToDB(binBuffer, metaData);
                        threatFilter = new FastBloomFilter(binBuffer);
                        console.log(`🛡️ [ThreatIntel] 成功更新百万级过滤器 (Version: ${metaData.version})`);
                    }
                }
            }
        } catch (e) {
            console.warn('过滤器下载或校验失败，保留现有内存数据', e);
        }

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

        // 🛡️ M-4 修复：版本单调性检查（防回放攻击）
        const { [CACHE_KEY]: localCache } = await chrome.storage.local.get(CACHE_KEY);
        if (localCache && localCache.sigData && localCache.sigData.version) {
            // 格式为 intel-YYYYMMDDHHMMSS，可直接按字符串比对
            if (sigData.version <= localCache.sigData.version) {
                console.warn(`🛡️ [ThreatIntel] 拒绝回放：远端版本(${sigData.version}) <= 本地版本(${localCache.sigData.version})`);
                return; // 直接退出，保留本地旧缓存
            }
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
