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
    whitelist: [],
    dailyLimit: 100,
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
                lastReset: new Date().toDateString(),
            },
        });
    }

    // 设置每日重置闹钟
    chrome.alarms.create('daily-reset', { periodInMinutes: 60 });
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
        stats.lastReset = today;
    }

    stats.totalBlocked++;
    stats.todayBlocked++;

    await chrome.storage.local.set({ [STATS_KEY]: stats });
    updateBadge(stats.todayBlocked);
}

function updateBadge(count) {
    const text = count > 999 ? '999+' : count.toString();
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
}

// ============ 每日重置 ============

chrome.alarms.onAlarm.addListener(async (alarm) => {
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

        default:
            return { error: '未知消息类型' };
    }
}

// ============ AI 分类器 ============

let classifierSession = null;

async function initClassifier() {
    if (classifierSession) return classifierSession;

    try {
        const ort = await import('onnxruntime-web');
        const modelUrl = chrome.runtime.getURL('models/classifier_int8.onnx');
        classifierSession = await ort.InferenceSession.create(modelUrl);
        console.log('AI 分类器已加载');
        return classifierSession;
    } catch (e) {
        console.warn('AI 分类器加载失败:', e);
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
    const session = await initClassifier();
    if (!session) return null;

    try {
        const ort = await import('onnxruntime-web');
        const tensor = new ort.Tensor('float32', features, [1, FEATURE_DIM]);
        const result = await session.run({ input: tensor });
        const prob = result.output.data[0];

        let classification = 'Normal';
        if (prob > 0.5) {
            // 区分广告和追踪器
            const offset = NUM_BUCKETS;
            const trackerScore =
                features[offset + 10] * 2.5 +
                features[offset + 11] * 1.5 +
                features[offset + 15] * 2.0;
            classification = trackerScore > 2.0 ? 'Tracker' : 'Ad';
        }

        return { classification, confidence: prob, source: 'ai' };
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
