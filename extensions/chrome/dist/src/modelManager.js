import * as ed from '@noble/ed25519';

// 🔒 S-03: Ed25519 公钥（32字节 hex 字符串，无 0x）
// ⚠️ 请替换为你自己后端生成的正式公钥
const ED25519_PUBLIC_KEY_HEX = '259eab8b493845eb78e345a139584c6812272d7183c7da29f774dea2d443fe77'; 

/**
 * DewSecure 模型管理器（纯云端验证版）
 */
const DB_NAME = 'dewsecure_models';
const DB_VERSION = 1;
const STORE_NAME = 'models';
const CACHE_META_KEY = 'latest_meta';

const WORKER_API_URL = 'https://dewsecure-api.zero6039.workers.dev/api';

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
        if (cached && meta) return { buffer: cached, meta };
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
        const modelResp = await fetch(`${WORKER_API_URL}/download-model`, { 
            headers,
            cache: 'no-store'
        });

        if (modelResp.status === 401 || modelResp.status === 403) {
            console.warn('🛡️ [ModelManager] 鉴权失败：Token 无效或已过期，执行清理。');
            await clearModelCache();
            return { updated: false, meta: null };
        }

        if (!modelResp.ok) {
            console.warn('[ModelManager] 下载模型失败:', modelResp.status);
            return { updated: false, meta: null };
        }

        // 3. 获取版本、哈希与签名信息
        const remoteVersion = modelResp.headers.get('X-Model-Version') || 'unknown';
        const remoteSha256 = modelResp.headers.get('X-Model-Sha256');
        const signatureB64 = modelResp.headers.get('X-Model-Signature');

        // 🔒 S-03 修复 A：强制要求哈希和签名存在
        if (remoteVersion === 'unknown' || !remoteSha256 || !signatureB64) {
            console.error('[ModelManager] ❌ 拒绝更新：缺少版本号、哈希或签名头！');
            return { updated: false, meta: null, error: 'Missing security headers' };
        }

        // 🔒 S-03 修复 B：版本单调性检查（防降级攻击）
        const localMeta = await dbGet(CACHE_META_KEY);
        if (localMeta && localMeta.trainedAt) {
            // 简单的字符串/数字比较。如果是纯数字时间戳，直接比较大小；如果是版本字符串，确保严格递增
            if (remoteVersion <= localMeta.trainedAt) {
                console.log(`[ModelManager] 🛡️ 拒绝降级：本地 (${localMeta.trainedAt}) >= 远程 (${remoteVersion})`);
                return { updated: false, meta: localMeta };
            }
        }

        // 4. 下载并校验哈希
        const modelBuffer = await modelResp.arrayBuffer();
        const actualHash = await computeSHA256(modelBuffer);
        if (actualHash !== remoteSha256) {
            console.error('[ModelManager] ❌ SHA-256 校验失败！文件损坏或被篡改。');
            return { updated: false, meta: null, error: 'SHA-256 mismatch' };
        }

        // 🔒 S-03 修复 C：Ed25519 签名校验
        try {
            console.log('[ModelManager] 🔐 开始验证 Ed25519 签名...');
            const msgStr = `${remoteVersion}:${remoteSha256}`;
            const msgBytes = new TextEncoder().encode(msgStr);
            
            // 解析 Base64 签名
            const sigBytes = Uint8Array.from(atob(signatureB64), c => c.charCodeAt(0));
            
            // 解析 Hex 公钥
            const pubKeyBytes = new Uint8Array(ED25519_PUBLIC_KEY_HEX.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

            // 执行校验
            const isValid = await ed.verifyAsync(sigBytes, msgBytes, pubKeyBytes);
            if (!isValid) {
                console.error('[ModelManager] ❌ 签名校验失败！模型来源不可信。');
                return { updated: false, meta: null, error: 'Signature verification failed' };
            }
            console.log('[ModelManager] ✅ 签名校验通过！');
        } catch (sigErr) {
            console.error('[ModelManager] ❌ 签名解析异常:', sigErr);
            return { updated: false, meta: null, error: 'Invalid signature format' };
        }

        // 6. 缓存
        const newMeta = { trainedAt: remoteVersion, sha256: actualHash };
        await dbPut('current_model', modelBuffer);
        await dbPut(CACHE_META_KEY, newMeta);

        console.log('[ModelManager] ✅ 模型已更新:', remoteVersion);
        return { updated: true, meta: newMeta };
    } catch (e) {
        console.warn('[ModelManager] 检查更新失败:', e);
        return { updated: false, meta: null, error: String(e) };
    }
}
