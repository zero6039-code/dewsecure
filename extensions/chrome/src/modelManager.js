/**
 * DewSecure 模型管理器（云端 Worker 安全版）
 * 
 * 职责：
 * 1. 从 IndexedDB 加载缓存的模型
 * 2. 从 Worker API 安全拉取元数据和模型
 * 3. SHA-256 完整性校验
 * 
 * 安全：
 * - 彻底剔除 R2 密钥，全部交由 Worker 鉴权
 * - 依据设备 Token 请求模型
 */

const DB_NAME = 'dewsecure_models';
const DB_VERSION = 1;
const STORE_NAME = 'models';
const CACHE_META_KEY = 'latest_meta';

// 你的 Worker API 地址
const WORKER_API_URL = 'https://dewsecure-api.zero6039.workers.dev/api';
// 测试用的 Token（商业版上线后替换为真实的用户 JWT）
// 动态获取用户的 JWT Token（商业化后由 Supabase 注入）
async function getDeviceToken() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['dewsecure_user'], (res) => {
            resolve(res.dewsecure_user?.token || 'your_test_token_here');
        });
    });
}

// ============ IndexedDB ============

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

// ============ SHA-256 ============

async function computeSHA256(buffer) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ============ 公共 API ============

export async function getCachedModel() {
    try {
        const cached = await dbGet('current_model');
        const meta = await dbGet(CACHE_META_KEY);
        if (cached && meta) {
            return { buffer: cached, meta };
        }
    } catch (e) {
        console.warn('[ModelManager] 读取缓存失败:', e);
    }
    return null;
}

export async function checkAndUpdateModel() {
    try {
        console.log('[ModelManager] 🔍 检查模型更新...');
        
        const token = await getDeviceToken();
        const headers = { 'Authorization': `Bearer ${token}` };

        // 1. 发起 HEAD 请求检查是否有更新（也可以在 Worker 里专门开一个 /api/model-meta 接口，这里简化为拉取）
        // 由于我们目前的 Worker 只有 /download-model 接口，我们直接请求并对比。
        console.log('[ModelManager] 📥 尝试从云端下载最新模型...');
        const modelResp = await fetch(`${WORKER_API_URL}/download-model`, { 
            headers,
            cache: 'no-store'
        });

        if (!modelResp.ok) {
            console.warn('[ModelManager] 下载模型失败:', modelResp.status);
            return { updated: false, meta: null };
        }

        // 2. 获取版本信息 (从 Response Headers 里读取，Worker 应该加上 X-Model-Version 和 X-Model-Sha256)
        const remoteVersion = modelResp.headers.get('X-Model-Version') || 'unknown';
        const remoteSha256 = modelResp.headers.get('X-Model-Sha256');

        // 3. 对比版本
        const localMeta = await dbGet(CACHE_META_KEY);
        if (localMeta && localMeta.trainedAt === remoteVersion && remoteVersion !== 'unknown') {
            console.log('[ModelManager] ✅ 已是最新版本:', remoteVersion);
            return { updated: false, meta: localMeta };
        }

        // 4. 获取 ArrayBuffer
        const modelBuffer = await modelResp.arrayBuffer();
        console.log('[ModelManager] ✅ 模型已下载:', `(${(modelBuffer.byteLength / 1024).toFixed(1)} KB)`);

        // 5. SHA-256 校验
        const actualHash = await computeSHA256(modelBuffer);
        if (remoteSha256 && actualHash !== remoteSha256) {
            console.error('[ModelManager] ❌ SHA-256 校验失败！');
            console.error('   期望:', remoteSha256);
            console.error('   实际:', actualHash);
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

export async function getModelVersion() {
    const meta = await dbGet(CACHE_META_KEY);
    if (meta) {
        return { version: meta.trainedAt, source: 'cache' };
    }
    return { version: 'bundled', source: 'bundled' };
}
