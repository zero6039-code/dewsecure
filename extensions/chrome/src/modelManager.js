/**
 * DewSecure 模型管理器
 *
 * 职责：
 * 1. 从 IndexedDB 加载缓存的模型
 * 2. 后台检查 CDN 是否有新版本
 * 3. 下载新模型 + SHA-256 校验 + 缓存
 */

const CDN_BASE = 'https://cdn.dewsecure.com';
const META_URL = `${CDN_BASE}/latest/model_meta.json`;
const MODEL_URL = `${CDN_BASE}/latest/classifier_int8.onnx`;

const DB_NAME = 'dewsecure_models';
const DB_VERSION = 1;
const STORE_NAME = 'models';
const META_KEY = 'latest_meta';

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

/**
 * 计算 ArrayBuffer 的 SHA-256
 */
async function computeSHA256(buffer) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 获取本地缓存的模型
 */
export async function getCachedModel() {
    try {
        const cached = await dbGet('current_model');
        const meta = await dbGet(META_KEY);
        if (cached && meta) {
            return { buffer: cached, meta };
        }
    } catch (e) {
        console.warn('[ModelManager] 读取缓存失败:', e);
    }
    return null;
}

/**
 * 检查并更新模型
 */
export async function checkAndUpdateModel() {
    try {
        console.log('[ModelManager] 🔍 检查模型更新...');

        // 1. 拉取最新元信息
        const metaResp = await fetch(META_URL, { cache: 'no-cache' });
        if (!metaResp.ok) {
            console.warn('[ModelManager] 获取 meta 失败:', metaResp.status);
            return { updated: false, meta: null };
        }
        const remoteMeta = await metaResp.json();
        const remoteVersion = remoteMeta.trainedAt;

        // 2. 对比本地版本
        const localMeta = await dbGet(META_KEY);
        const localVersion = localMeta?.trainedAt;

        if (localVersion === remoteVersion) {
            console.log('[ModelManager] ✅ 已是最新版本:', localVersion);
            return { updated: false, meta: remoteMeta };
        }

        // 3. 下载新模型
        console.log('[ModelManager] 📥 发现新版本:', remoteVersion);
        const modelResp = await fetch(MODEL_URL, { cache: 'no-cache' });
        if (!modelResp.ok) {
            console.warn('[ModelManager] 下载模型失败:', modelResp.status);
            return { updated: false, meta: null };
        }
        const modelBuffer = await modelResp.arrayBuffer();

        // 4. ⭐ SHA-256 校验
        if (remoteMeta.sha256) {
            console.log('[ModelManager] 🔐 校验模型完整性...');
            const actualHash = await computeSHA256(modelBuffer);
            if (actualHash !== remoteMeta.sha256) {
                console.error('[ModelManager] ❌ SHA-256 校验失败！');
                console.error('   期望:', remoteMeta.sha256);
                console.error('   实际:', actualHash);
                return { updated: false, meta: null, error: 'SHA-256 mismatch' };
            }
            console.log('[ModelManager] ✅ SHA-256 校验通过');
        } else {
            console.warn('[ModelManager] ⚠️ 元信息缺少 sha256 字段，跳过校验');
        }

        // 5. 保存到 IndexedDB
        await dbPut('current_model', modelBuffer);
        await dbPut(META_KEY, remoteMeta);

        console.log(
            '[ModelManager] ✅ 模型已更新:',
            remoteVersion,
            `(${(modelBuffer.byteLength / 1024).toFixed(1)} KB)`
        );

        return { updated: true, meta: remoteMeta };
    } catch (e) {
        console.warn('[ModelManager] 检查更新失败:', e);
        return { updated: false, meta: null, error: String(e) };
    }
}

/**
 * 强制刷新
 */
export async function forceRefreshModel() {
    await dbPut(META_KEY, null);
    await dbPut('current_model', null);
    return checkAndUpdateModel();
}

/**
 * 清除缓存
 */
export async function clearModelCache() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * 获取当前模型版本
 */
export async function getModelVersion() {
    const meta = await dbGet(META_KEY);
    if (meta) {
        return {
            version: meta.trainedAt,
            source: 'cache',
            macroF1: meta.macroF1,
            sha256: meta.sha256,
        };
    }
    return { version: 'bundled', source: 'bundled' };
}
