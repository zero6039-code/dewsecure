import { checkAndUpdateModel, forceRefreshModel, getModelVersion, getCachedModel } from './modelManager.js';
/**
 * DewSecure Service Worker
 *
 * 负责：
 * 1. 动态规则管理
 * 2. 拦截统计
 * 3. AI 分类器推理（对 DNR 未拦截的请求进行补充判断）
 */


const STATS_KEY = 'dewsecure_stats';
const SETTINGS_KEY = 'dewsecure_settings';

// 默认设置
const DEFAULT_SETTINGS = {
    aiEnabled: true,
    antiBypassEnabled: true,
    blockTrackers: true,
    blockAnnoyances: false,
    hideCookieNotices: true,
    hideAdPlaceholders: true,
    blockSocialTrackers: true,
    whitelist: [],
    dailyLimit: 50,
    dailyUsed: 0,
    lastResetDate: new Date().toDateString(),
    subscription: 'free', // free | premium
};

// ============ 初始化 ============

chrome.runtime.onInstalled.addListener(async (details) => {
    console.log('DewSecure 已安装', details.reason);

    // 初始化设置
    const { [SETTINGS_KEY]: settings } = await chrome.storage.local.get(SETTINGS_KEY);
    if (!settings) {
        await chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
    }

    // 初始化统计
    const { [STATS_KEY]: stats } = await chrome.storage.local.get(STATS_KEY);
    if (!stats) {
        await chrome.storage.local.set({
            [STATS_KEY]: {
                totalBlocked: 0,
                todayBlocked: 0,
                todayRuleBlocked: 0,
                todayAIBlocked: 0,
                lastReset: new Date().toDateString(),
            },
        });
    }

    // 设置每日重置闹钟
    chrome.alarms.create('daily-reset', { periodInMinutes: 60 });

    // 联邦学习：每 24 小时上报一次匿名反馈
    chrome.alarms.create('federated-upload', { periodInMinutes: 24 * 60 });

    // 模型更新：每 24 小时检查一次
    chrome.alarms.create('model-update-check', { periodInMinutes: 24 * 60 });

    // 立即检查一次
    checkAndUpdateModel().catch((e) => console.warn('初始模型检查失败:', e));
});

// ============ 拦截统计 ============

chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(async (info) => {
    await recordBlock(info.request.url);
});

async function recordBlock(url) {
    const { [STATS_KEY]: stats } = await chrome.storage.local.get(STATS_KEY);
    const today = new Date().toDateString();

    if (stats.lastReset !== today) {
        stats.todayBlocked = 0;
        stats.todayRuleBlocked = 0;
        stats.todayAIBlocked = 0;
        stats.lastReset = today;
    }

    stats.totalBlocked++;
    stats.todayBlocked++;
    stats.todayRuleBlocked = (stats.todayRuleBlocked || 0) + 1;

    await chrome.storage.local.set({ [STATS_KEY]: stats });
    updateBadge(stats.todayBlocked);
}

async function recordAIBlock() {
    const { [STATS_KEY]: stats } = await chrome.storage.local.get(STATS_KEY);
    stats.todayAIBlocked = (stats.todayAIBlocked || 0) + 1;
    await chrome.storage.local.set({ [STATS_KEY]: stats });
}

function updateBadge(count) {
    const text = count > 999 ? '999+' : count.toString();
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
}

// ============ 每日重置 ============

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'federated-upload') {
        await uploadFederatedFeedback();
    }
    if (alarm.name === 'model-update-check') {
        await checkAndUpdateModel();
    }
    if (alarm.name === 'model-update-check') {
        await checkAndUpdateModel();
    }
    if (alarm.name === 'daily-reset') {
        const { [SETTINGS_KEY]: settings } = await chrome.storage.local.get(SETTINGS_KEY);
        const today = new Date().toDateString();

        if (settings.lastResetDate !== today) {
            settings.dailyUsed = 0;
            settings.lastResetDate = today;
            await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
        }
    }
});

// ============ 消息处理 ============

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender).then(sendResponse);
    return true;
});

async function handleMessage(message, sender) {
    switch (message.type) {
        case 'GET_STATS':
            const { [STATS_KEY]: stats } = await chrome.storage.local.get(STATS_KEY);
            const { [SETTINGS_KEY]: settings } = await chrome.storage.local.get(SETTINGS_KEY);
            return { stats, settings };

        case 'GET_SETTINGS':
            const { [SETTINGS_KEY]: s } = await chrome.storage.local.get(SETTINGS_KEY);
            return s;

        case 'UPDATE_SETTINGS':
            await chrome.storage.local.set({ [SETTINGS_KEY]: message.settings });
            return { ok: true };

        case 'CLASSIFY_URL':
            return await classifyUrl(message.url);

        case 'ADD_WHITELIST':
            return await addToWhitelist(message.domain);

        case 'REMOVE_WHITELIST':
            return await removeFromWhitelist(message.domain);

        case 'GET_ANTI_BYPASS_SCRIPT':
            return { script: generateAntiBypassScript() };

        case 'REPORT_FEEDBACK':
            return await handleFeedbackReport(message);

        case 'CHECK_MODEL_UPDATE':
            return await checkAndUpdateModel();

        case 'FORCE_REFRESH_MODEL':
            return await forceRefreshModel();

        case 'GET_MODEL_VERSION':
            return await getModelVersion();

        default:
            return { error: '未知消息类型' };
    }
}

// ============ AI 分类器 ============

let classifierSession = null;

// ============ Offscreen Document 管理 ============

let offscreenReady = false;

async function ensureOffscreen() {
    if (offscreenReady) return true;

    // 尝试创建，如果已存在就忽略错误
    try {
        await chrome.offscreen.createDocument({
            url: 'src/offscreen.html',
            reasons: ['WORKERS'],
            justification: '运行 ONNX 模型推理（Service Worker 不允许 WASM + 动态 import）',
        });
        console.log('✅ Offscreen Document 已创建');
        // 首次创建时等待脚本加载
        await new Promise((r) => setTimeout(r, 800));
    } catch (e) {
        const msg = e?.message || String(e);
        if (msg.includes('Only a single offscreen') || msg.includes('already exists')) {
            console.log('ℹ️ Offscreen Document 已存在，直接复用');
        } else {
            console.warn('❌ Offscreen Document 创建失败:', e);
            return false;
        }
    }

    // 轮询 PING 确认 offscreen 的 message listener 已就绪
    for (let i = 0; i < 10; i++) {
        try {
            const pong = await chrome.runtime.sendMessage({
                target: 'offscreen',
                type: 'PING',
            });
            if (pong && pong.ok) {
                offscreenReady = true;
                return true;
            }
        } catch (err) {
            // ignore, retry
        }
        await new Promise((r) => setTimeout(r, 300));
    }

    console.warn('❌ Offscreen 未在预期时间内就绪');
    return false;
}

async function initClassifier() {
    const ok = await ensureOffscreen();
    if (!ok) {
        console.warn('❌ ensureOffscreen 失败');
        return null;
    }

    try {
        const response = await chrome.runtime.sendMessage({
            target: 'offscreen',
            type: 'INIT',
        });
        console.log('INIT 响应:', response);
        if (response && response.ok) {
            console.log('✅ AI 分类器已在 Offscreen 中加载');
            return true;
        }
        return null;
    } catch (e) {
        console.warn('❌ AI 分类器初始化失败:', e);
        return null;
    }
}

async function classifyUrl(url) {
    // 1. 检查白名单
    const settings = await getSettings();
    const host = new URL(url).hostname;
    if (settings.whitelist.some((d) => host.endsWith(d))) {
        return { classification: 'Normal', source: 'whitelist' };
    }

    // 2. 检查每日限额
    if (settings.subscription === 'free' && settings.dailyUsed >= settings.dailyLimit) {
        return { classification: 'Unknown', source: 'limit-reached' };
    }

    // 3. 使用 AI 分类器
    if (settings.aiEnabled) {
        const features = extractFeatures(url);
        const result = await runClassifier(features);
        if (result) {
            if (result.classification === 'Ad' || result.classification === 'Tracker') {
                settings.dailyUsed++;
                await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
            }
            return result;
        }
    }

    return { classification: 'Unknown', source: 'no-classifier' };
}

async function getSettings() {
    const { [SETTINGS_KEY]: settings } = await chrome.storage.local.get(SETTINGS_KEY);
    return settings || DEFAULT_SETTINGS;
}

// ============ 特征提取（与 Rust 端保持一致） ============

const NUM_BUCKETS = 16384;
const STRUCTURED_FEATURES = 34;
const FEATURE_DIM = NUM_BUCKETS + STRUCTURED_FEATURES;

function extractFeatures(url) {
    const features = new Float32Array(FEATURE_DIM);
    const urlLower = url.toLowerCase();

    // 哈希字符 n-gram（n=3）
    for (let i = 0; i <= urlLower.length - 3; i++) {
        const ngram = urlLower.substring(i, i + 3);
        const hash = fnv1a(ngram) % NUM_BUCKETS;
        features[hash] += 1.0;
    }

    // 结构化特征
    const offset = NUM_BUCKETS;
    features[offset] = url.length;
    features[offset + 1] = (url.match(/\./g) || []).length;
    features[offset + 2] = (url.match(/\//g) || []).length;
    features[offset + 3] = (url.match(/-/g) || []).length;
    features[offset + 4] = (url.match(/_/g) || []).length;
    features[offset + 5] = (url.match(/\?/g) || []).length;
    features[offset + 6] = (url.match(/=/g) || []).length;
    features[offset + 7] = (url.match(/&/g) || []).length;
    features[offset + 8] = (url.match(/%/g) || []).length;

    // 关键词特征
    features[offset + 9] = containsAny(urlLower, ['ad', 'ads', 'advert']) ? 1 : 0;
    features[offset + 10] = containsAny(urlLower, ['track', 'tracking']) ? 1 : 0;
    features[offset + 11] = containsAny(urlLower, ['analytics', 'stats']) ? 1 : 0;
    features[offset + 12] = containsAny(urlLower, ['banner', 'banners']) ? 1 : 0;
    features[offset + 13] = containsAny(urlLower, ['popup', 'popunder']) ? 1 : 0;
    features[offset + 14] = containsAny(urlLower, ['click', 'clicks']) ? 1 : 0;
    features[offset + 15] = containsAny(urlLower, ['pixel', 'beacon']) ? 1 : 0;
    features[offset + 16] = containsAny(urlLower, ['doubleclick', 'googlesyndication']) ? 1 : 0;
    features[offset + 17] = containsAny(urlLower, ['facebook', 'fbcdn']) ? 1 : 0;
    features[offset + 18] = containsAny(urlLower, ['google', 'gstatic']) ? 1 : 0;

    // TLD
    features[offset + 19] = urlLower.endsWith('.com') ? 1 : 0;
    features[offset + 20] = urlLower.endsWith('.net') ? 1 : 0;
    features[offset + 21] = urlLower.endsWith('.org') ? 1 : 0;
    features[offset + 22] = urlLower.endsWith('.io') ? 1 : 0;
    features[offset + 23] = urlLower.endsWith('.cn') ? 1 : 0;

    // 协议
    features[offset + 24] = urlLower.startsWith('https') ? 1 : 0;
    features[offset + 25] = urlLower.startsWith('http://') ? 1 : 0;

    // 数字比例
    const digitCount = (url.match(/\d/g) || []).length;
    features[offset + 26] = digitCount / Math.max(url.length, 1);

    // 大写比例
    const upperCount = (url.match(/[A-Z]/g) || []).length;
    features[offset + 27] = upperCount / Math.max(url.length, 1);

    // 路径深度
    features[offset + 28] = (url.match(/\//g) || []).length;

    // 查询参数
    features[offset + 29] = (url.match(/[&?]/g) || []).length;

    // 域名长度
    try {
        const host = new URL(url).hostname;
        features[offset + 30] = host.length;
        features[offset + 31] = isIpAddress(host) ? 1 : 0;
        features[offset + 32] = Math.max(0, host.split('.').length - 2);
    } catch {
        features[offset + 30] = 0;
        features[offset + 31] = 0;
        features[offset + 32] = 0;
    }

    // URL 熵
    features[offset + 33] = calculateEntropy(urlLower);

    return features;
}

function fnv1a(str) {
    let hash = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    for (let i = 0; i < str.length; i++) {
        hash ^= BigInt(str.charCodeAt(i));
        hash = BigInt.asUintN(64, hash * prime);
    }
    return Number(hash & 0xFFFFFFFFn);
}

function containsAny(s, keywords) {
    return keywords.some((kw) => s.includes(kw));
}

function isIpAddress(host) {
    const parts = host.split('.');
    return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && +p <= 255);
}

function calculateEntropy(s) {
    if (!s.length) return 0;
    const freq = {};
    for (const c of s) freq[c] = (freq[c] || 0) + 1;
    let entropy = 0;
    for (const f of Object.values(freq)) {
        const p = f / s.length;
        entropy -= p * Math.log2(p);
    }
    return entropy;
}

async function runClassifier(features) {
    const ok = await ensureOffscreen();
    if (!ok) return null;

    try {
        const response = await chrome.runtime.sendMessage({
            target: 'offscreen',
            type: 'CLASSIFY',
            features: Array.from(features),
        });

        if (!response || response.error) {
            console.warn('分类失败:', response?.error);
            return null;
        }

        const probs = response.probs;  // [p_normal, p_ad, p_tracker]
        const labels = ['Normal', 'Ad', 'Tracker'];
        let maxIdx = 0;
        for (let i = 1; i < probs.length; i++) {
            if (probs[i] > probs[maxIdx]) maxIdx = i;
        }
        const classification = labels[maxIdx];
        const confidence = probs[maxIdx];

        return { classification, confidence, source: 'ai', allProbs: probs };
    } catch (e) {
        console.warn('分类失败:', e);
        return null;
    }
}

// ============ 反反拦截 ============

function generateAntiBypassScript() {
    const seed = Date.now();
    const varName = `_0x${(seed & 0xFFFFFFFF).toString(16)}`;

    return `
(function() {
    'use strict';
    const ${varName} = {
        adBlock: false,
        adblock: false,
        adsBlocked: 0,
        isAdBlockActive: false,
        canRunAds: true,
        canShowAds: true,
        adblockDetected: false,
    };
    const props = ['adBlock', 'adblock', 'adsBlocked', 'isAdBlockActive',
                   'canRunAds', 'canShowAds', 'adblockDetected'];
    for (const p of props) {
        try {
            Object.defineProperty(window, p, {
                get: () => ${varName}[p],
                configurable: true,
            });
        } catch(e) {}
    }
})();
`;
}

// ============ 白名单 ============

async function addToWhitelist(domain) {
    const settings = await getSettings();
    if (!settings.whitelist.includes(domain)) {
        settings.whitelist.push(domain);
        await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    }
    return { ok: true, whitelist: settings.whitelist };
}

async function removeFromWhitelist(domain) {
    const settings = await getSettings();
    settings.whitelist = settings.whitelist.filter((d) => d !== domain);
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    return { ok: true, whitelist: settings.whitelist };
}

console.log('DewSecure Service Worker 已启动');

// ============ 调试入口（ES Module 函数默认不暴露到全局） ============
self.initClassifier = initClassifier;
self.classifyUrl = classifyUrl;
self.extractFeatures = extractFeatures;
self.runClassifier = runClassifier;
console.log('🔧 调试入口已挂载：initClassifier / classifyUrl / extractFeatures / runClassifier');


// ============ 用户反馈处理 ============

const FEEDBACK_BUFFER_KEY = 'dewsecure_feedback_buffer';
const MAX_FEEDBACK_BUFFER = 500;
const FEEDBACK_COOLDOWN_MS = 60 * 1000;  // 同一用户 1 分钟内只能报告一次
let lastFeedbackTime = 0;

async function handleFeedbackReport(message) {
    // 防滥用：冷却时间
    const now = Date.now();
    if (now - lastFeedbackTime < FEEDBACK_COOLDOWN_MS) {
        const remaining = Math.ceil((FEEDBACK_COOLDOWN_MS - (now - lastFeedbackTime)) / 1000);
        return { ok: false, error: `请等待 ${remaining} 秒后再试` };
    }
    lastFeedbackTime = now;

    try {
        // 提取域名（不含路径和查询参数，保护隐私）
        let domain = '';
        try {
            domain = new URL(message.url).hostname;
        } catch {
            domain = message.url;
        }

        // 域名哈希（SHA-256 加盐，不可逆）
        const domainHash = await hashDomain(domain);

        const feedback = {
            type: message.reportType,       // 'missed' | 'false_positive'
            domainHash,
            timestamp: message.timestamp,
            version: chrome.runtime.getManifest().version,
        };

        // 存入本地缓冲区
        const { [FEEDBACK_BUFFER_KEY]: buffer = [] } =
            await chrome.storage.local.get(FEEDBACK_BUFFER_KEY);

        buffer.push(feedback);

        // 限制缓冲区大小
        if (buffer.length > MAX_FEEDBACK_BUFFER) {
            buffer.splice(0, buffer.length - MAX_FEEDBACK_BUFFER);
        }

        await chrome.storage.local.set({ [FEEDBACK_BUFFER_KEY]: buffer });

        console.log('📝 反馈已记录:', feedback);

        // 如果有服务器端，尝试立即上传
        await tryUploadFeedback(feedback);

        return { ok: true };
    } catch (e) {
        console.warn('反馈处理失败:', e);
        return { ok: false, error: String(e) };
    }
}

async function tryUploadFeedback(feedback) {
    // 当前阶段没有服务器，只存本地
    // 未来切换到 R2 + Worker 后，改为 fetch 上传
    const UPLOAD_ENDPOINT = 'https://api.dewsecure.com/v1/feedback';
    try {
        const response = await fetch(UPLOAD_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(feedback),
        });
        if (response.ok) {
            console.log('✅ 反馈已上传');
        }
    } catch (e) {
        // 服务器未就绪，静默失败，数据留在本地缓冲区
        console.log('ℹ️ 反馈上传暂不可用（服务器未就绪）');
    }
}

async function hashDomain(domain) {
    const encoder = new TextEncoder();
    const data = encoder.encode(domain + '_dewsecure_salt_v1');
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
        .substring(0, 16);
}


// 注：getModelVersion 从 modelManager.js 导入


// ============ 保活机制 ============
// 定期发送一个空消息给 Offscreen Document，防止 Service Worker 被 Chrome 终止
setInterval(() => {
    chrome.runtime.sendMessage({ target: 'offscreen', type: 'PING' }).catch(() => {});
}, 20000);
console.log('🔧 保活机制已启动');

// ============ 调试入口（ES Module 函数默认不暴露到全局） ============
self.checkAndUpdateModel = checkAndUpdateModel;
self.getModelVersion = getModelVersion;
self.forceRefreshModel = forceRefreshModel;
self.getCachedModel = getCachedModel;
console.log('🔧 调试入口已挂载：checkAndUpdateModel / getModelVersion / forceRefreshModel / getCachedModel');
