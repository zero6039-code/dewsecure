// 辅助函数：FNV-1a 哈希
function fnv1a(str) {
    let hash = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    for (let i = 0; i < str.length; i++) {
        hash ^= BigInt(str.charCodeAt(i));
        hash = BigInt.asUintN(64, hash * prime);
    }
    return hash;
}
// 辅助函数：计算熵值
function calculateEntropy(s) {
    if (!s) return 0.0;
    const freq = {};
    for (let i = 0; i < s.length; i++) freq[s[i]] = (freq[s[i]] || 0) + 1;
    let entropy = 0.0;
    for (const count of Object.values(freq)) {
        const p = count / s.length;
        entropy -= p * Math.log2(p);
    }
    return entropy;
}
// 辅助函数：IP 地址识别
function isIpAddress(url) {
    const parts = url.split('/');
    if (parts.length < 3) return false;
    const host = parts[2].split(':')[0];
    const octets = host.split('.');
    if (octets.length !== 4) return false;
    return octets.every(o => /^\d+$/.test(o) && parseInt(o, 10) >= 0 && parseInt(o, 10) <= 255);
}

export function extractFeaturesFromUrl(url) {
    const NGRAM_SIZE = 16384;
    const STRUCT_SIZE = 34;
    const features = new Float32Array(NGRAM_SIZE + STRUCT_SIZE);
    const url_lower = url.toLowerCase();

    // 1. 哈希字符 n-gram（n=3）
    for (let i = 0; i <= url_lower.length - 3; i++) {
        const ngram = url_lower.substring(i, i + 3);
        const hash = fnv1a(ngram);
        features[Number(hash % 16384n)] += 1.0;
    }

    // 2. 结构化特征 (严格对齐 features.py)
    const o = 16384;
    const count = (str, ch) => str.split(ch).length - 1;
    const containsAny = (s, kws) => kws.some(kw => s.includes(kw)) ? 1.0 : 0.0;

    features[o + 0] = url_lower.length;
    features[o + 1] = count(url_lower, ".");
    features[o + 2] = count(url_lower, "/");
    features[o + 3] = count(url_lower, "-");
    features[o + 4] = count(url_lower, "_");
    features[o + 5] = count(url_lower, "?");
    features[o + 6] = count(url_lower, "=");
    features[o + 7] = count(url_lower, "&");
    features[o + 8] = count(url_lower, "%");

    features[o + 9] = containsAny(url_lower, ["ad", "ads", "advert"]);
    features[o + 10] = containsAny(url_lower, ["track", "tracking"]);
    features[o + 11] = containsAny(url_lower, ["analytics", "stats"]);
    features[o + 12] = containsAny(url_lower, ["banner", "banners"]);
    features[o + 13] = containsAny(url_lower, ["popup", "popunder"]);
    features[o + 14] = containsAny(url_lower, ["click", "clicks"]);
    features[o + 15] = containsAny(url_lower, ["pixel", "beacon"]);
    features[o + 16] = containsAny(url_lower, ["doubleclick", "googlesyndication"]);
    features[o + 17] = containsAny(url_lower, ["facebook", "fbcdn"]);
    features[o + 18] = containsAny(url_lower, ["google", "gstatic"]);

    features[o + 19] = url_lower.endsWith(".com") ? 1.0 : 0.0;
    features[o + 20] = url_lower.endsWith(".net") ? 1.0 : 0.0;
    features[o + 21] = url_lower.endsWith(".org") ? 1.0 : 0.0;
    features[o + 22] = url_lower.endsWith(".io") ? 1.0 : 0.0;
    features[o + 23] = url_lower.endsWith(".cn") ? 1.0 : 0.0;

    features[o + 24] = url_lower.startsWith("https") ? 1.0 : 0.0;
    features[o + 25] = url_lower.startsWith("http://") ? 1.0 : 0.0;

    const digitCount = (url.match(/\d/g) || []).length;
    features[o + 26] = digitCount / Math.max(url_lower.length, 1);

    const upperCount = (url.match(/[A-Z]/g) || []).length;
    features[o + 27] = upperCount / Math.max(url_lower.length, 1);

    features[o + 28] = count(url_lower, "/");
    features[o + 29] = count(url_lower, "&") + count(url_lower, "?");

    const parts = url_lower.split("/");
    if (parts.length > 2) {
        const host = parts[2].split(":")[0];
        features[o + 30] = host.length;
        features[o + 31] = isIpAddress(url_lower) ? 1.0 : 0.0;
        features[o + 32] = Math.max(0, count(host, ".") - 1);
    } else {
        features[o + 30] = 0.0;
        features[o + 31] = 0.0;
        features[o + 32] = 0.0;
    }

    features[o + 33] = calculateEntropy(url_lower);

    return Array.from(features);
}

const AI_CHECKED_DOMAINS = new Set();
export async function runAICheck(url, tabId = null) {
    try {
        const domain = new URL(url).hostname;
        if (AI_CHECKED_DOMAINS.has(domain)) return;
        // 🔧 防御性微调：防止 Set 无限膨胀导致内存泄漏
        if (AI_CHECKED_DOMAINS.size > 5000) {
            AI_CHECKED_DOMAINS.clear();
        }
        AI_CHECKED_DOMAINS.add(domain);
        const features = extractFeaturesFromUrl(domain); // 🔧 P1-B Step1: 归一化为 hostname，对齐训练分布
        const response = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'CLASSIFY', features });
        if (!response || !response.probs) return;
        const probs = response.probs;
        const maxIdx = probs.indexOf(Math.max(...probs));
        const classes = ['Normal', 'Ad', 'Tracker']; // 🔒 P-01 修复：模型只有 3 类
        const classification = classes[maxIdx];
        
        // 🔒 安全网 1：如果网站在白名单里，直接放行
        const settings = await chrome.storage.local.get('dewsecure_settings').then(r => r.dewsecure_settings || {});
        const isWhitelisted = (settings.whitelist || []).some(d => domain === d || domain.endsWith('.' + d)) ||
                              (settings.tempWhitelist || []).some(d => domain === d || domain.endsWith('.' + d));
        if (isWhitelisted) {
            console.log(`🛡️ [AI安全网] ${domain} 在白名单中，跳过拦截。`);
            return;
        }

        // 🔒 P-01: 暂时移除 Phishing 分支，等待未来加入钓鱼训练数据
        if (classification === 'Ad' || classification === 'Tracker') {
            // 🔒 安全网 2：严禁拦截 main_frame (防止网页白屏死锁)
            // 只拦截高危子资源，且降低拦截概率，仅当置信度极高（>80%）时才拦截子资源
            const confidence = probs[maxIdx];
            if (confidence < 0.8) {
                console.log(`[AI] 置信度不足 (${confidence.toFixed(2)})，放弃拦截: ${domain}`);
                return;
            }
            
            // 🌟 防线 1：AI 拦截前置豁免检查
            if (domain === 'dewsecure.com' || domain.endsWith('.dewsecure.com') || domain.includes('zero6039')) {
                console.log('🛡️ [AI] 拦截命中官方域名，已强制放行。');
                return;
            }
            
            // 🌟 修复 S-08：通过传入的 tabId 精确投递，防止多标签并发时误杀
            let targetTabId = tabId;
            if (!targetTabId) {
                // 兜底：如果没有传 tabId，才去查 active tab
                const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tabs[0] && tabs[0].id) targetTabId = tabs[0].id;
            }
            
            if (targetTabId) {
                chrome.tabs.sendMessage(targetTabId, { 
                    type: 'HIDE_AI_AD', 
                    domain: domain 
                }).catch(() => {});
            }
            console.log(`🛡️ [AI] 已触发 DOM 软隐藏: ${domain} (绝不阻断网络)`);
        }
    } catch(e) {}
}

// 🌟 自动容错：如果模型首次下载失败（如网络波动），静默处理，下次再试
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'OFFSCREEN_ERROR') {
        console.warn('⚠️ [Offscreen] 模型加载失败，已静默忽略，等待下次心跳重试。');
    }
});
