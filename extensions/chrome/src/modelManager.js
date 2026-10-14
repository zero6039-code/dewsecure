/**
 * DewSecure 模型管理器（预签名 URL 版本）
 *
 * 职责：
 * 1. 从 IndexedDB 加载缓存的模型
 * 2. 用预签名 URL 从 R2 检查/下载新版本
 * 3. SHA-256 完整性校验
 *
 * 安全：
 * - 预签名 URL 有效期 60 秒
 * - URL 动态生成，不暴露到静态文件
 * - SHA-256 校验防篡改
 */

import { AwsClient } from 'aws4fetch';
import { R2_CONFIG } from './r2-config.js';

const S3_ENDPOINT = `https://${R2_CONFIG.accountId}.r2.cloudflarestorage.com`;
const BUCKET = R2_CONFIG.bucket;
const META_KEY = 'latest/model_meta.json';
const MODEL_KEY = 'latest/classifier_int8.onnx';

const DB_NAME = 'dewsecure_models';
const DB_VERSION = 1;
const STORE_NAME = 'models';
const CACHE_META_KEY = 'latest_meta';

// ============ R2 客户端 ============

const r2Client = new AwsClient({
    accessKeyId: R2_CONFIG.accessKeyId,
    secretAccessKey: R2_CONFIG.secretAccessKey,
    service: 's3',
    region: 'auto',
});

/**
 * 生成预签名 URL
 * @param {string} key - 对象 key（如 latest/classifier_int8.onnx）
 * @param {number} expiresIn - 有效期（秒）
 * @returns {string} 预签名 URL
 */
async function getPresignedUrl(key, expiresIn = R2_CONFIG.presignedUrlExpiry) {
    const url = new URL(`${S3_ENDPOINT}/${BUCKET}/${key}`);
    url.searchParams.set('X-Amz-Expires', expiresIn.toString());

    const signed = await r2Client.sign(url.toString(), {
        aws: { signQuery: true },
    });

    return signed.url;
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

/**
 * 获取本地缓存的模型
 */
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

/**
 * 检查并更新模型（用预签名 URL）
 */
export async function checkAndUpdateModel() {
    try {
        console.log('[ModelManager] 🔍 检查模型更新...');
        console.log('[ModelManager] 🔐 生成预签名 URL...');

        // 1. 生成 meta 的预签名 URL
        const metaUrl = await getPresignedUrl(META_KEY);
        console.log('[ModelManager] ✅ Meta URL 已生成（有效期 60 秒）');

        // 2. 拉取 meta
        const metaResp = await fetch(metaUrl, { cache: 'no-store' });
        if (!metaResp.ok) {
            console.warn('[ModelManager] 获取 meta 失败:', metaResp.status);
            return { updated: false, meta: null };
        }
        const remoteMeta = await metaResp.json();
        const remoteVersion = remoteMeta.trainedAt;

        // 3. 对比版本
        const localMeta = await dbGet(CACHE_META_KEY);
        const localVersion = localMeta?.trainedAt;

        if (localVersion === remoteVersion) {
            console.log('[ModelManager] ✅ 已是最新版本:', localVersion);
            return { updated: false, meta: remoteMeta };
        }

        // 4. 生成模型的预签名 URL（只在需要下载时生成）
        console.log('[ModelManager] 📥 发现新版本:', remoteVersion);
        console.log('[ModelManager] 🔐 生成模型预签名 URL...');
        const modelUrl = await getPresignedUrl(MODEL_KEY);
        console.log('[ModelManager] ✅ 模型 URL 已生成（有效期 60 秒）');

        // 5. 下载模型
        const modelResp = await fetch(modelUrl, { cache: 'no-store' });
        if (!modelResp.ok) {
            console.warn('[ModelManager] 下载模型失败:', modelResp.status);
            return { updated: false, meta: null };
        }
        const modelBuffer = await modelResp.arrayBuffer();
        console.log('[ModelManager] ✅ 模型已下载:', `(${(modelBuffer.byteLength / 1024).toFixed(1)} KB)`);

        // 6. SHA-256 校验
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
            console.warn('[ModelManager] ⚠️ 缺少 sha256 字段，跳过校验');
        }

        // 7. 缓存
        await dbPut('current_model', modelBuffer);
        await dbPut(CACHE_META_KEY, remoteMeta);

        console.log('[ModelManager] ✅ 模型已更新:', remoteVersion);
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
    await dbPut(CACHE_META_KEY, null);
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
    const meta = await dbGet(CACHE_META_KEY);
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
