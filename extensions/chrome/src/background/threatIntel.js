import { getCurrentUser } from '../authManager.js';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { syncRules, RANGE } from './dnrOwner.js';

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));
const ED25519_PUBLIC_KEY_HEX = 'a21b4c875ab246b58adc225ddf66a054cfa7b79ed2093fcc2f97598fd1197631';
const CACHE_KEY = 'dewsecure_intel_cache';

// ==========================================
// 🚀 百万级本地过滤器 (Threat Filter)
// ==========================================
let threatFilter = null; 
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

class FastBloomFilter {
    constructor(arrayBuffer) {
        const view = new DataView(arrayBuffer);
        this.bits = view.getUint32(0, true); 
        this.hashCount = view.getUint32(4, true);
        this.buffer = new Uint8Array(arrayBuffer, 8); 
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
    } catch (e) {}
}

export function checkThreatFilter(host) {
    if (!threatFilter) return false;
    return threatFilter.has(host);
}

// ==========================================
// 独立下载并验证二进制过滤器
// ==========================================
async function updateThreatFilterBinary(userToken) {
    try {
        const baseUrl = 'https://api.dewsecure.com/api/intel';
        const headers = userToken ? { 'Authorization': `Bearer ${userToken}` } : {};
        
        const [binRes, metaRes] = await Promise.all([
            fetch(`${baseUrl}/threat-filter.bin`, { cache: 'no-store', headers }),
            fetch(`${baseUrl}/threat-filter.meta.json`, { cache: 'no-store', headers })
        ]);
        
        if (!binRes.ok || !metaRes.ok) {
            console.warn(`⚠️ [ThreatIntel] 下载过滤器失败 (HTTP ${binRes.status}/${metaRes.status})`);
            return;
        }
        
        const binBuffer = await binRes.arrayBuffer();
        const metaData = await metaRes.json();
        
        // 哈希校验
        const binHash = await crypto.subtle.digest('SHA-256', binBuffer).then(buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join(''));
        if (binHash !== metaData.sha256) {
            console.error('❌ [ThreatIntel] 过滤器哈希校验失败');
            return;
        }
        
        // 验签
        const msg = `${metaData.version}:${metaData.sha256}`;
        const sigBytes = Uint8Array.from(atob(metaData.signature.trim()), c => c.charCodeAt(0));
        const pubKeyBytes = new Uint8Array(ED25519_PUBLIC_KEY_HEX.match(/.{1,2}/g).map(b => parseInt(b, 16)));
        
        if (!(await ed.verifyAsync(sigBytes, new TextEncoder().encode(msg), pubKeyBytes))) {
            console.error('❌ [ThreatIntel] 过滤器签名校验失败');
            return;
        }
        
        // 检查本地版本，如果版本一致且内存有数据，直接跳过写入
        const cached = await loadFilterFromDB();
        if (cached && cached.meta && cached.meta.version === metaData.version && threatFilter) {
            return;
        }
        
        // 保存并加载
        await saveFilterToDB(binBuffer, metaData);
        threatFilter = new FastBloomFilter(binBuffer);
        console.log(`🛡️ [ThreatIntel] 成功更新百万级过滤器 (Version: ${metaData.version}, Size: ${(binBuffer.byteLength/1024/1024).toFixed(2)} MB)`);
        
    } catch (e) {
        console.warn('⚠️ [ThreatIntel] 更新二进制过滤器异常:', e);
    }
}

// ==========================================
// 🛡️ N-1 修复：情报规则只管理 RANGE.intel 段
// ==========================================
const HARD_SAFE = ['github.com', 'githubusercontent.com', 'github.io', 'gitlab.com', 'npmjs.com', 'cloudflare.com', 'microsoft.com', 'apple.com', 'dewsecure.com', 'google.com', 'youtube.com', 'facebook.com', 'dropbox.com', 'dropboxusercontent.com'];
const MAX_INTEL_RULES = 25000;   // 留 5000 余量给隐私/挖矿/豁免/AI 会话

async function applyRulesToDNR() {
    const user = await getCurrentUser();
    const isPro = user && user.tier !== 'free';
    const { dewsecure_settings: settings } = await chrome.storage.local.get('dewsecure_settings');
    const isEnabled = settings?.intelEnabled !== false;

    // 非 Pro 或关闭：只清空 intel 段，绝不动其他模块的规则
    if (!isPro || !isEnabled) {
        await syncRules(RANGE.intel, []);
        return;
    }

    const { [CACHE_KEY]: cache } = await chrome.storage.local.get(CACHE_KEY);
    if (!cache || !cache.rulesData) return;

    const newRules = [];
    for (const rule of cache.rulesData) {
        const domain = rule.condition?.requestDomains?.[0];
        if (!domain) continue; 
        if (HARD_SAFE.some(d => domain === d || domain.endsWith('.' + d))) continue;
        if (newRules.length >= MAX_INTEL_RULES) break;

        // 显式重映射 ID 到 RANGE.intel 段（不依赖服务端 id 策略），深拷贝 condition 防止改写缓存
        newRules.push({
            id: RANGE.intel[0] + newRules.length,
            priority: rule.priority ?? 2000000,
            action: { type: 'redirect', redirect: { extensionPath: `/warning.html?type=intel&domain=${encodeURIComponent(domain)}` } },
            condition: {
                ...rule.condition,
                resourceTypes: ["main_frame", "sub_frame"],
            },
        });
    }
    await syncRules(RANGE.intel, newRules);
}

// ==========================================
// 主入口
// ==========================================
export async function updateThreatIntel() {
    try {
        const user = await getCurrentUser();
        const isPro = user && user.tier !== 'free';
        const { dewsecure_settings: settings } = await chrome.storage.local.get('dewsecure_settings');
        const isEnabled = settings?.intelEnabled !== false;

        if (!isPro || !isEnabled) {
            await applyRulesToDNR();
            return;
        }

        console.log('📡 [ThreatIntel] 正在拉取云端最新情报...');
        
        // 🚀 1. 优先下载并更新百万级过滤器（独立逻辑，不受版本回放影响）
        await updateThreatFilterBinary(user?.token);

        // 🚀 2. 更新传统 DNR 规则
        const baseUrl = 'https://api.dewsecure.com/api/intel';
        const headers = user?.token ? { 'Authorization': `Bearer ${user.token}` } : {};
        const [rulesRes, sigRes] = await Promise.all([
            fetch(`${baseUrl}/threat-rules`, { cache: 'no-store', headers }),
            fetch(`${baseUrl}/threat-rules.sig`, { cache: 'no-store', headers })
        ]);

        if (!rulesRes.ok || !sigRes.ok) throw new Error(`HTTP Error`);

        const rulesBuffer = await rulesRes.arrayBuffer();
        const sigData = await sigRes.json();
        
        const actualHash = await crypto.subtle.digest('SHA-256', rulesBuffer).then(buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join(''));
        if (actualHash !== sigData.sha256) throw new Error('SHA-256 mismatch');

        const msgStr = `${sigData.version}:${sigData.sha256}`;
        const sigBytes = Uint8Array.from(atob(sigData.signature.trim()), c => c.charCodeAt(0));
        const pubKeyBytes = new Uint8Array(ED25519_PUBLIC_KEY_HEX.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

        if (!(await ed.verifyAsync(sigBytes, new TextEncoder().encode(msgStr), pubKeyBytes))) {
            throw new Error('Ed25519 signature invalid');
        }

        const { [CACHE_KEY]: localCache } = await chrome.storage.local.get(CACHE_KEY);
        if (localCache && localCache.sigData && localCache.sigData.version) {
            if (sigData.version <= localCache.sigData.version) {
                console.warn(`🛡️ [ThreatIntel] 拒绝回放：远端版本(${sigData.version}) <= 本地版本(${localCache.sigData.version})`);
                return; 
            }
        }

        console.log('✅ [ThreatIntel] 签名校验通过，写入本地缓存...');
        const rulesData = JSON.parse(new TextDecoder().decode(rulesBuffer));
        await chrome.storage.local.set({ [CACHE_KEY]: { rulesData, sigData } });
        await applyRulesToDNR();

    } catch (e) {
        console.warn('❌ [ThreatIntel] 拉取失败:', e);
        await applyRulesToDNR(); 
    }
}
