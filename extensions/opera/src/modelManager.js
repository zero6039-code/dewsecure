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

        // 3. 获取版本信息
        const remoteVersion = modelResp.headers.get('X-Model-Version') || 'unknown';
        const remoteSha256 = modelResp.headers.get('X-Model-Sha256');

        // 4. 对比版本
        const localMeta = await dbGet(CACHE_META_KEY);
        if (localMeta && localMeta.trainedAt === remoteVersion && remoteVersion !== 'unknown') {
            console.log('[ModelManager] ✅ 已是最新版本:', remoteVersion);
            return { updated: false, meta: localMeta };
        }

        // 5. 下载并校验
        const modelBuffer = await modelResp.arrayBuffer();
        const actualHash = await computeSHA256(modelBuffer);
        if (remoteSha256 && actualHash !== remoteSha256) {
            console.error('[ModelManager] ❌ SHA-256 校验失败！');
            return { updated: false, meta: null, error: 'SHA-256 mismatch' };
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
