import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

// 🔒 核心修复：在 Service Worker 中必须显式注入 SHA-512 引擎，否则验签永远返回 false
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

// 🔒 S-03: Ed25519 公钥（32字节 hex 字符串，无 0x）
const ED25519_PUBLIC_KEY_HEX = '259eab8b493845eb78e345a139584c6812272d7183c7da29f774dea2d443fe77'; 

const DB_NAME = 'dewsecure_models';
const DB_VERSION = 1;
const STORE_NAME = 'models';
const CACHE_META_KEY = 'latest_meta';

const WORKER_API_URL = 'https://api.dewsecure.com/api';

let dbPromise = null;

function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains(STORE_NAME)) {
                req.result.createObjectStore(STORE_NAME);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return dbPromise;
}

async function dbGet(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function dbPut(key, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const req = tx.objectStore(STORE_NAME).put(value, key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

async function computeSHA256(buffer) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function getCachedModel() {
    try {
        const cached = await dbGet('current_model');
        const meta = await dbGet(CACHE_META_KEY);
        if (cached && meta) return { weights: cached, meta };
    } catch (e) {}
    return null;
}

export async function clearModelCache() {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {}
}

// 🔒 H-6 修复：确保 V100 >= V99
function parseVer(v) {
    if (!v) return 0;
    const m = String(v).match(/V?(\d+)/i);
    return m ? parseInt(m[1], 10) : 0;
}

// 🔒 M-8 修复：精确校验 {coef: [3][16418], intercept: [3]} 结构
function isValidModelShape(modelJson) {
    if (!modelJson || typeof modelJson !== 'object') return false;

    const coef = modelJson.coef;
    const intercept = modelJson.intercept;

    // 1. 检查 coef 是否存在且为数组
    if (!Array.isArray(coef) || coef.length !== 3) {
        console.warn('[ModelManager] coef 格式非法或缺失');
        return false;
    }

    // 2. 检查 intercept 是否存在且为数组
    if (!Array.isArray(intercept) || intercept.length !== 3) {
        console.warn('[ModelManager] intercept 格式非法或缺失');
        return false;
    }

    // 3. 检查每个类别的权重维度是否为 16418
    for (let i = 0; i < 3; i++) {
        if (!Array.isArray(coef[i]) || coef[i].length !== 16418) {
            console.warn(`[ModelManager] coef[${i}] 维度非法: 预期 16418, 实际 ${coef[i]?.length}`);
            return false;
        }
    }

    // 4. 抽样检查数值有限性（防止 NaN/Infinity 投毒）
    const isFiniteCheck = (arr) => {
        for (let i = 0; i < arr.length; i++) {
            if (!Number.isFinite(arr[i])) return false;
        }
        return true;
    };

    if (!intercept.every(Number.isFinite)) {
        console.warn('[ModelManager] intercept 包含非法数值');
        return false;
    }

    for (let i = 0; i < 3; i++) {
        if (!isFiniteCheck(coef[i])) {
            console.warn(`[ModelManager] coef[${i}] 包含 NaN/Infinity`);
            return false;
        }
    }

    return true;
}

export async function checkAndUpdateModel() {
    try {
        console.log('[ModelManager] 🔍 检查模型更新...');
        
        // 1. 获取当前用户的 Token (如果没有 Token，说明未登录)
        const { dewsecure_user: user } = await chrome.storage.local.get(['dewsecure_user']);
        if (!user || !user.token) {
            console.warn('🛡️ [ModelManager] 用户未登录，执行本地模型清理。');
            await clearModelCache();
            return { updated: false, meta: null };
        }
        
        if (user.tier === 'free') {
            console.warn('🛡️ [ModelManager] 免费版用户，无法拉取云端模型，执行清理。');
            await clearModelCache();
            return { updated: false, meta: null };
        }

        const token = user.token;
        const headers = { 'Authorization': `Bearer ${token}` };

        // 2. 携带 Token 请求 Worker（由云端决定权限）
        console.log('[ModelManager] 📥 请求云端验证授权并下载模型...');
        const modelResp = await fetch(`${WORKER_API_URL}/download-model?format=json`, {
            headers,
            cache: 'no-store'
        });

        const localMeta = await dbGet(CACHE_META_KEY);

        // 🔒 M-8 修复：仅在鉴权彻底失败 (401/403) 时清空本地缓存
        if (modelResp.status === 401 || modelResp.status === 403) {
            console.warn('🛡️ [ModelManager] 鉴权失败：Token 无效或已过期，执行清理。');
            await clearModelCache();
            return { updated: false, meta: null };
        }

        // 🔒 M-8 修复：其他网络错误保留本地已验签模型，防止 CDN 故障导致 AI 瘫痪
        if (!modelResp.ok) {
            console.warn('[ModelManager] 下载模型失败，保留本地模型:', modelResp.status);
            return { updated: false, meta: localMeta };
        }

        // 3. 获取版本、哈希与签名信息
        const remoteVersion = modelResp.headers.get('X-Model-Version') || 'unknown';
        const remoteSha256 = modelResp.headers.get('X-Model-Sha256');
        const signatureB64 = modelResp.headers.get('X-Model-Signature');
        const channel = modelResp.headers.get('X-Model-Channel') || 'latest';
        console.log(`[ModelManager] 📡 当前分配通道: ${channel}`);

        if (remoteVersion === 'unknown' || !remoteSha256 || !signatureB64) {
            console.error('[ModelManager] ❌ 拒绝更新：缺少版本号、哈希或签名头！(保留本地缓存)');
            return { updated: false, meta: localMeta, error: 'Missing security headers' };
        }

        // 🔒 H-6 修复：版本单调性检查（防降级攻击）
        if (localMeta && localMeta.trainedAt) {
            const remoteSeq = parseVer(remoteVersion);
            const localSeq = parseVer(localMeta.trainedAt);
            if (remoteSeq <= localSeq) {
                console.log(`[ModelManager] 🛡️ 拒绝降级：本地 (${localMeta.trainedAt}) >= 远程 (${remoteVersion})`);
                return { updated: false, meta: localMeta };
            }
        }

        // 4. 下载并校验哈希
        const modelBuffer = await modelResp.arrayBuffer();
        const actualHash = await computeSHA256(modelBuffer);
        if (actualHash !== remoteSha256) {
            console.error('[ModelManager] ❌ SHA-256 校验失败！(保留本地缓存)');
            return { updated: false, meta: localMeta, error: 'SHA-256 mismatch' };
        }
        
        // 🔧 解析 JSON 权重
        const modelText = new TextDecoder().decode(modelBuffer);
        const modelJson = JSON.parse(modelText);

        // 🔒 M-8 修复：校验权重形状和有效性
        if (!isValidModelShape(modelJson)) {
            console.error('[ModelManager] ❌ 模型权重格式非法或包含 NaN！(保留本地缓存)');
            return { updated: false, meta: localMeta, error: 'Invalid model shape' };
        }

        // 🔒 S-03 修复 C：Ed25519 签名校验
        try {
            console.log('[ModelManager] 🔐 开始验证 Ed25519 签名...');
            const msgStr = `${remoteVersion}:${remoteSha256}`;
            const msgBytes = new TextEncoder().encode(msgStr);
            
            const sigBytes = Uint8Array.from(atob(signatureB64.trim()), c => c.charCodeAt(0));
            const pubKeyBytes = new Uint8Array(ED25519_PUBLIC_KEY_HEX.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

            const isValid = await ed.verifyAsync(sigBytes, msgBytes, pubKeyBytes);
            if (!isValid) {
                console.error('[ModelManager] ❌ 签名校验失败！(保留本地缓存)');
                return { updated: false, meta: localMeta, error: 'Signature verification failed' };
            }
            console.log('[ModelManager] ✅ 签名校验通过！');
        } catch (sigErr) {
            console.error('[ModelManager] ❌ 签名解析异常:', sigErr);
            return { updated: false, meta: localMeta, error: 'Invalid signature format' };
        }

        // 6. 缓存
        const newMeta = { trainedAt: remoteVersion, sha256: actualHash };
        await dbPut('current_model', modelJson);
        await dbPut(CACHE_META_KEY, newMeta);

        console.log('[ModelManager] ✅ 模型已更新:', remoteVersion);
        return { updated: true, meta: newMeta };
    } catch (e) {
        console.warn('[ModelManager] 检查更新失败:', e);
        // 🔒 M-8 修复：发生异常时不再返回 null 并清空缓存
        const fallbackMeta = await dbGet(CACHE_META_KEY);
        return { updated: false, meta: fallbackMeta, error: String(e) };
    }
}
