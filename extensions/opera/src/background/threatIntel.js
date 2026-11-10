import { getCurrentUser } from '../authManager.js';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { sha256 } from '@noble/hashes/sha256';
import { parse } from 'tldts';
import { syncRules, RANGE } from './dnrOwner.js';
import { buildMergedRules } from './adHostRules.js';

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

// ==========================================
// 🛡️ N-3 修复：排序哈希前缀集合（零误报）
// 格式：'DEW1' + h(1B) + count(4B LE) + 排序的 h*count 字节 SHA-256 前缀
// ==========================================
class HashSetFilter {
    constructor(ab) {
        const dv = new DataView(ab);
        if (dv.getUint32(0, false) !== 0x44455731) throw new Error('bad magic');
        this.h = dv.getUint8(4);
        this.n = dv.getUint32(5, true);
        // 🛡️ A-7 修复：强制要求最小 6 字节（48位），避免 h=4 时百万级数据引发 0.023% 的误报率
        if (this.h < 6 || this.h > 8) throw new Error('bad h');
        if (ab.byteLength !== 9 + this.h * this.n) throw new Error('bad size');
        this.b = new Uint8Array(ab, 9);
    }
    has(host) {
        const key = sha256(new TextEncoder().encode(host)).subarray(0, this.h);
        let lo = 0, hi = this.n - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >>> 1, o = mid * this.h;
            let cmp = 0;
            for (let i = 0; i < this.h && cmp === 0; i++) cmp = this.b[o + i] - key[i];
            if (cmp === 0) return true;
            if (cmp < 0) lo = mid + 1; else hi = mid - 1;
        }
        return false;
    }
}

// 格式检测：前 4 字节 'DEW1' → v2；否则按 v1 Bloom 兼容
function detectFormat(ab) {
    if (ab.byteLength >= 9) {
        const dv = new DataView(ab);
        if (dv.getUint32(0, false) === 0x44455731) return 'v2';
    }
    return 'v1';
}

export async function initThreatFilter() {
    try {
        const cached = await loadFilterFromDB();
        if (cached && cached.buffer) {
            const fmt = detectFormat(cached.buffer);
            if (fmt === 'v2') {
                threatFilter = new HashSetFilter(cached.buffer);
                console.log(`⚡ [ThreatIntel] v2 哈希前缀过滤器已加载 (${cached.buffer.byteLength} bytes)`);
            } else {
                threatFilter = new FastBloomFilter(cached.buffer);
                console.log('⚡ [ThreatIntel] v1 Bloom 过滤器已加载 (兼容模式)');
            }
        }
    } catch (e) {
        console.warn('[ThreatIntel] 过滤器加载失败:', e);
        threatFilter = null;
    }
}

// 🛡️ B1 修复：统一主机名规范化（去尾随点、小写、去端口与 IPv6 方括号）
export function normalizeHost(input) {
    let h = String(input || '').trim().toLowerCase();
    if (!h) return '';
    if (h.includes('://')) {
        try { h = new URL(h).hostname; } catch { return ''; }
    }
    if (h.startsWith('[')) {
        const end = h.indexOf(']');
        return end > 0 ? h.slice(1, end) : '';
    }
    const colon = h.lastIndexOf(':');
    if (colon > -1 && h.indexOf(':') === colon) h = h.slice(0, colon);
    while (h.endsWith('.')) h = h.slice(0, -1);
    return h;
}

// 🛡️ N-3 修复：注册域回溯，防止子域绕过 (B1 升级：接入 normalizeHost)
export function checkThreatFilter(host) {
    if (!threatFilter) return false;
    host = normalizeHost(host);
    if (!host) return false;
    const p = parse(host);
    if (!p.domain || p.isIp) return threatFilter.has(host);
    const labels = host.split('.');
    const depth = labels.length - p.domain.split('.').length;
    for (let i = 0; i <= depth; i++) {
        if (threatFilter.has(labels.slice(i).join('.'))) return true;
    }
    return false;
}

// ==========================================
// 独立下载并验证二进制过滤器
// ==========================================
async function updateThreatFilterBinary(userToken) {
    try {
        const baseUrl = 'https://api.dewsecure.com/api/intel';
        const headers = userToken ? { 'Authorization': `Bearer ${userToken}` } : {};
        
        // N-2 修复：先拉元数据（几 KB），版本未变就跳过整份 bin 下载
        const metaRes = await fetch(`${baseUrl}/threat-filter.meta.json`, { cache: 'no-store', headers });
        if (!metaRes.ok) {
            // 严格模式：meta 失败直接跳过，不 fallback 到 bin
            console.warn(`⚠️ [ThreatIntel] meta 拉取失败 (HTTP ${metaRes.status})，跳过过滤器更新`);
            return;
        }
        const metaData = await metaRes.json();
        
        // 🛡️ B3 修复：二进制过滤器版本防回滚与有效期校验
        const cached = await loadFilterFromDB();
        
        // 🛡️ A-6 修复：强制要求 purpose 必填，防止中间人剥离 purpose 降级绕过
        if (!metaData.purpose || metaData.purpose !== 'dewsecure/filter/v1') {
            console.error('❌ [ThreatIntel] 缺少或未知的 purpose，拒绝加载:', metaData.purpose);
            return;
        }
        // 校验 valid_until (防冻结攻击)
        if (metaData.valid_until && Date.now() > metaData.valid_until) {
            console.error('❌ [ThreatIntel] 拒绝过期的过滤器元数据');
            return;
        }

        if (cached && cached.meta && threatFilter) {
            if (metaData.version < cached.meta.version) {
                console.warn(`🛡️ [ThreatIntel] 拒绝回滚：远端版本(${metaData.version}) < 本地版本(${cached.meta.version})`);
                return;
            }
            if (metaData.version === cached.meta.version) {
                return; // 版本相同，跳过下载
            }
        }
        
        // 版本有变（或首次安装），才下载整份 bin
        const binRes = await fetch(`${baseUrl}/threat-filter.bin`, { cache: 'no-store', headers });
        if (!binRes.ok) {
            console.warn(`⚠️ [ThreatIntel] bin 拉取失败 (HTTP ${binRes.status})`);
            return;
        }
        const binBuffer = await binRes.arrayBuffer();
        
        // 哈希校验
        const binHash = await crypto.subtle.digest('SHA-256', binBuffer).then(buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join(''));
        if (binHash !== metaData.sha256) {
            console.error('❌ [ThreatIntel] 过滤器哈希校验失败');
            return;
        }
        
        // 🛡️ A-6 修复：签名强绑定。如果服务端支持 sig_version >= 2，则使用域分隔且包含 valid_until 的强化格式
        let msg;
        if (metaData.sig_version >= 2) {
            msg = `${metaData.purpose}|${metaData.version}|${metaData.sha256}|${metaData.valid_until || 0}`;
        } else {
            msg = `${metaData.purpose}:${metaData.version}:${metaData.sha256}`; // 兼容旧格式，但已强制包含 purpose
        }
        const sigBytes = Uint8Array.from(atob(metaData.signature.trim()), c => c.charCodeAt(0));
        const pubKeyBytes = new Uint8Array(ED25519_PUBLIC_KEY_HEX.match(/.{1,2}/g).map(b => parseInt(b, 16)));
        
        if (!(await ed.verifyAsync(sigBytes, new TextEncoder().encode(msg), pubKeyBytes))) {
            console.error('❌ [ThreatIntel] 过滤器签名校验失败');
            return;
        }
        
        // 保存并加载（按格式选择实现）
        await saveFilterToDB(binBuffer, metaData);
        const fmt = detectFormat(binBuffer);
        if (fmt === 'v2') {
            threatFilter = new HashSetFilter(binBuffer);
            console.log(`🛡️ [ThreatIntel] 成功更新 v2 哈希前缀过滤器 (Version: ${metaData.version}, Size: ${(binBuffer.byteLength/1024/1024).toFixed(2)} MB)`);
        } else {
            threatFilter = new FastBloomFilter(binBuffer);
            console.log(`🛡️ [ThreatIntel] 成功更新 v1 Bloom 过滤器 (Version: ${metaData.version}, Size: ${(binBuffer.byteLength/1024/1024).toFixed(2)} MB)`);
        }
        
    } catch (e) {
        console.warn('⚠️ [ThreatIntel] 更新二进制过滤器异常:', e);
    }
}

// ==========================================
// 🛡️ N-1 修复：情报规则只管理 RANGE.intel 段
// ==========================================
// 🛡️ B4 修复：redirect 属于不安全规则，硬上限为 5000。
// 优先读取浏览器原生常量，回退到 4900（留 100 余量给隐私/挖矿等动态规则）。
const MAX_INTEL_RULES = (chrome.declarativeNetRequest && chrome.declarativeNetRequest.MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES) || 4900;

async function applyRulesToDNR() {
    const user = await getCurrentUser();
    const isPro = user && user.tier !== 'free';
    const { dewsecure_settings: settings } = await chrome.storage.local.get('dewsecure_settings');
    const isEnabled = settings?.intelEnabled !== false;

    // 非 Pro 或关闭：只清空 intel 段
    if (!isPro || !isEnabled) {
        await syncRules(RANGE.intel, []);
        return;
    }

    const { [CACHE_KEY]: cache } = await chrome.storage.local.get(CACHE_KEY);
    if (!cache || !cache.rulesData) return;

    // 🛡️ AD-1 修复：使用合批算法，单条规则承载 500 个域名
    const newRules = buildMergedRules(cache.rulesData, RANGE.intel[0], MAX_INTEL_RULES);
    
    await syncRules(RANGE.intel, newRules);
}

// ==========================================
// 🛡️ AD-5: Scriptlet 签名化注入骨架
// ==========================================
const ALLOWED_SCRIPTLETS = new Set(['noop-fn']);

async function syncScriptlets(verifiedBundle) {
    if (!verifiedBundle || !Array.isArray(verifiedBundle.scriptlets)) return;

    const scripts = [];
    for (let i = 0; i < verifiedBundle.scriptlets.length; i++) {
        const s = verifiedBundle.scriptlets[i];
        if (!s.use || !ALLOWED_SCRIPTLETS.has(s.use)) continue;
        if (!Array.isArray(s.match) || !s.match.every(m => /^\*:\/\/[\w*.-]+\/\*$/.test(m))) continue;

        scripts.push({
            id: `dew-sl-${s.use}-${i}`,
            matches: s.match,
            js: [`src/scriptlets/${s.use}.js`],
            world: 'MAIN',
            runAt: 'document_start',
            persistAcrossSessions: true
        });
    }

    try {
        const old = await chrome.scripting.getRegisteredContentScripts();
        const oldIds = old.filter(o => o.id.startsWith('dew-sl-')).map(o => o.id);
        if (oldIds.length) await chrome.scripting.unregisterContentScripts({ ids: oldIds });
        if (scripts.length) await chrome.scripting.registerContentScripts(scripts);
        console.log(`🛡️ [AD-5] 已注册 ${scripts.length} 个 scriptlet`);
    } catch (e) {
        console.warn('⚠️ [AD-5] scriptlet 注册失败:', e);
    }
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

        // 🚀 2. 更新传统 DNR 规则（N-2：先拉 .sig，版本未变则跳过整份 rules 下载）
        const baseUrl = 'https://api.dewsecure.com/api/intel';
        const headers = user?.token ? { 'Authorization': `Bearer ${user.token}` } : {};

        // 先拉签名元数据（几 KB）
        const sigRes = await fetch(`${baseUrl}/threat-rules.sig`, { cache: 'no-store', headers });
        if (!sigRes.ok) throw new Error(`sig HTTP ${sigRes.status}`);
        const sigData = await sigRes.json();

        // 🛡️ A-6 修复：强制要求 rules purpose 必填
        if (!sigData.purpose || sigData.purpose !== 'dewsecure/rules/v1') {
            console.error('❌ [ThreatIntel] 缺少或未知的 rules purpose，拒绝加载:', sigData.purpose);
            return;
        }
        if (sigData.valid_until && Date.now() > sigData.valid_until) {
            console.error('❌ [ThreatIntel] 拒绝过期的 rules 元数据');
            return;
        }

        const { [CACHE_KEY]: localCache } = await chrome.storage.local.get(CACHE_KEY);
        if (localCache && localCache.sigData && localCache.sigData.version) {
            if (sigData.version <= localCache.sigData.version) {
                console.warn(`🛡️ [ThreatIntel] 拒绝回放：远端版本(${sigData.version}) <= 本地版本(${localCache.sigData.version})`);
                return; 
            }
        }

        // 版本有变，才拉整份 rules
        const rulesRes = await fetch(`${baseUrl}/threat-rules`, { cache: 'no-store', headers });
        if (!rulesRes.ok) throw new Error(`rules HTTP ${rulesRes.status}`);
        const rulesBuffer = await rulesRes.arrayBuffer();
        
        const actualHash = await crypto.subtle.digest('SHA-256', rulesBuffer).then(buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join(''));
        if (actualHash !== sigData.sha256) throw new Error('SHA-256 mismatch');

        // 🛡️ A-6 修复：强绑定验证串
        let msgStr;
        if (sigData.sig_version >= 2) {
            msgStr = `${sigData.purpose}|${sigData.version}|${sigData.sha256}|${sigData.valid_until || 0}`;
        } else {
            msgStr = `${sigData.purpose}:${sigData.version}:${sigData.sha256}`;
        }
        const sigBytes = Uint8Array.from(atob(sigData.signature.trim()), c => c.charCodeAt(0));
        const pubKeyBytes = new Uint8Array(ED25519_PUBLIC_KEY_HEX.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

        if (!(await ed.verifyAsync(sigBytes, new TextEncoder().encode(msgStr), pubKeyBytes))) {
            throw new Error('Ed25519 signature invalid');
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
