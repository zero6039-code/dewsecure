/**
 * DewSecure 联邦学习客户端骨架
 *
 * 目标：用户设备本地收集信号，匿名上传，云端聚合后下发新模型。
 * 注意：这不是真正的"设备端训练"，而是"匿名信号收集 + 云端增量训练"。
 * 完整的设备端训练在 Android 版用 TFLite + FLandroid 实现。
 */

const FEEDBACK_KEY = 'dewsecure_feedback';
const UPLOAD_ENDPOINT = 'https://api.dewsecure.com/v1/feedback';
const UPLOAD_INTERVAL_HOURS = 24;
const MAX_BUFFER_SIZE = 1000;

/**
 * 记录一条反馈（拦截后用户手动放行、或 AI 分类的置信度信息）
 */
export async function recordFeedback({ url, predicted, confidence, action }) {
    const { [FEEDBACK_KEY]: buffer = [] } = await chrome.storage.local.get(FEEDBACK_KEY);

    buffer.push({
        // 不存储完整 URL，只存域名哈希
        domainHash: await hashDomain(extractDomain(url)),
        predicted,        // 'Ad' | 'Tracker' | 'Normal'
        confidence,       // 0-1
        action,           // 'blocked' | 'allowed' | 'whitelisted'
        timestamp: Date.now(),
    });

    // 限制缓冲区大小
    if (buffer.length > MAX_BUFFER_SIZE) {
        buffer.splice(0, buffer.length - MAX_BUFFER_SIZE);
    }

    await chrome.storage.local.set({ [FEEDBACK_KEY]: buffer });
}

/**
 * 定期上传（由 chrome.alarms 触发）
 */
export async function uploadFeedback() {
    const { [FEEDBACK_KEY]: buffer = [] } = await chrome.storage.local.get(FEEDBACK_KEY);
    if (buffer.length === 0) return;

    try {
        const response = await fetch(UPLOAD_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                deviceId: await getDeviceId(),
                clientVersion: chrome.runtime.getManifest().version,
                feedback: buffer,
            }),
        });

        if (response.ok) {
            const result = await response.json();
            console.log('✅ 反馈上传成功:', buffer.length, '条');

            // 清空缓冲区
            await chrome.storage.local.set({ [FEEDBACK_KEY]: [] });

            // 如果服务端返回新模型版本，触发更新
            if (result.newModelVersion) {
                await downloadNewModel(result.newModelVersion);
            }
        }
    } catch (e) {
        console.warn('反馈上传失败（下次重试）:', e);
    }
}

/**
 * 下载新模型
 */
async function downloadNewModel(version) {
    console.log('📥 下载新模型版本:', version);
    const url = `https://cdn.dewsecure.com/models/classifier_${version}_int8.onnx`;
    const response = await fetch(url);
    if (!response.ok) return;

    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();

    // 存储到 IndexedDB（模型文件较大，不适合 chrome.storage）
    const db = await openModelDB();
    const tx = db.transaction('models', 'readwrite');
    await tx.objectStore('models').put({ version, data: arrayBuffer, updatedAt: Date.now() });

    console.log('✅ 新模型已缓存，下次启动生效');
}

/**
 * 匿名设备 ID（一次性生成，存储在 chrome.storage）
 */
async function getDeviceId() {
    const KEY = 'dewsecure_device_id';
    const { [KEY]: id } = await chrome.storage.local.get(KEY);
    if (id) return id;

    const newId = crypto.randomUUID();
    await chrome.storage.local.set({ [KEY]: newId });
    return newId;
}

/**
 * 域名哈希（不可逆，保护隐私）
 */
async function hashDomain(domain) {
    const encoder = new TextEncoder();
    const data = encoder.encode(domain + '_dewsecure_salt_v1');
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
        .substring(0, 16);
}

function extractDomain(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return url;
    }
}

function openModelDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('dewsecure_models', 1);
        req.onupgradeneeded = () => {
            req.result.createObjectStore('models', { keyPath: 'version' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
