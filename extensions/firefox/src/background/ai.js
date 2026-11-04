import { getCachedModel } from '../modelManager.js';
import { HARD_SAFE_DOMAINS, HARD_BLOCK_DOMAINS, AI_BLOCK_RESOURCE_TYPES } from './aiConfig.js';

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

// 🚀 性能优化：32 位 FNV-1a 哈希（避免 BigInt 开销）
// 64 位 FNV-1a 对 16384 取模只取决于低 14 位，因此 32 位 Math.imul 模拟完全等价
function fnv1a32(str) {
    let hash = 0x84222325;
    for (let i = 0; i < str.length; i++) {
        hash = Math.imul(hash ^ str.charCodeAt(i), 0x1b3);
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

// ==========================================
// 🚀 性能优化：稀疏特征提取（M-7 稠密向量优化）
// 返回 { buckets: Map<bucketIdx, count>, structs: [[idx, val], ...] }
// 只包含非零项，避免构造 16418 维稠密数组与 Array.from
// 与 extractFeaturesFromUrl 输出在数学上等价（同一 n-gram 桶、同一结构特征索引）
// ==========================================
export function extractSparseFeatures(url) {
    const url_lower = url.toLowerCase();

    // 1. n-gram 桶计数（Map 聚合，同桶累加）
    const buckets = new Map();
    const maxI = url_lower.length - 3;
    for (let i = 0; i <= maxI; i++) {
        const ngram = url_lower.substring(i, i + 3);
        const hash = fnv1a32(ngram);
        const bucket = hash & 0x3FFF;
        buckets.set(bucket, (buckets.get(bucket) || 0) + 1);
    }

    // 2. 结构特征（严格对齐 features.py，偏移 o=16384）
    const structs = [];
    const o = 16384;
    const count = (str, ch) => str.split(ch).length - 1;
    const containsAny = (s, kws) => kws.some(kw => s.includes(kw)) ? 1.0 : 0.0;
    const push = (idx, val) => { if (val !== 0) structs.push([idx, val]); };

    push(o + 0, url_lower.length);
    push(o + 1, count(url_lower, "."));
    push(o + 2, count(url_lower, "/"));
    push(o + 3, count(url_lower, "-"));
    push(o + 4, count(url_lower, "_"));
    push(o + 5, count(url_lower, "?"));
    push(o + 6, count(url_lower, "="));
    push(o + 7, count(url_lower, "&"));
    push(o + 8, count(url_lower, "%"));

    push(o + 9,  containsAny(url_lower, ["ad", "ads", "advert"]));
    push(o + 10, containsAny(url_lower, ["track", "tracking"]));
    push(o + 11, containsAny(url_lower, ["analytics", "stats"]));
    push(o + 12, containsAny(url_lower, ["banner", "banners"]));
    push(o + 13, containsAny(url_lower, ["popup", "popunder"]));
    push(o + 14, containsAny(url_lower, ["click", "clicks"]));
    push(o + 15, containsAny(url_lower, ["pixel", "beacon"]));
    push(o + 16, containsAny(url_lower, ["doubleclick", "googlesyndication"]));
    push(o + 17, containsAny(url_lower, ["facebook", "fbcdn"]));
    push(o + 18, containsAny(url_lower, ["google", "gstatic"]));

    push(o + 19, url_lower.endsWith(".com") ? 1.0 : 0.0);
    push(o + 20, url_lower.endsWith(".net") ? 1.0 : 0.0);
    push(o + 21, url_lower.endsWith(".org") ? 1.0 : 0.0);
    push(o + 22, url_lower.endsWith(".io")  ? 1.0 : 0.0);
    push(o + 23, url_lower.endsWith(".cn")  ? 1.0 : 0.0);

    push(o + 24, url_lower.startsWith("https")  ? 1.0 : 0.0);
    push(o + 25, url_lower.startsWith("http://") ? 1.0 : 0.0);

    const digitCount = (url.match(/\d/g) || []).length;
    push(o + 26, digitCount / Math.max(url_lower.length, 1));

    const upperCount = (url.match(/[A-Z]/g) || []).length;
    push(o + 27, upperCount / Math.max(url_lower.length, 1));

    push(o + 28, count(url_lower, "/"));
    push(o + 29, count(url_lower, "&") + count(url_lower, "?"));

    const parts = url_lower.split("/");
    if (parts.length > 2) {
        const host = parts[2].split(":")[0];
        push(o + 30, host.length);
        push(o + 31, isIpAddress(url_lower) ? 1.0 : 0.0);
        push(o + 32, Math.max(0, count(host, ".") - 1));
    }

    push(o + 33, calculateEntropy(url_lower));

    return { buckets, structs };
}

const AI_CHECKED_DOMAINS = new Set();
// 📊 信号 3：记录该域名在多少个不同站点中被请求
const HOST_REF_COUNT = new Map();
export function recordHostRef(host) {
    HOST_REF_COUNT.set(host, (HOST_REF_COUNT.get(host) || 0) + 1);
    if (HOST_REF_COUNT.size > 5000) HOST_REF_COUNT.clear(); // 防内存泄漏
}


let cachedWeights = null;
let aiCheckedDomainsLoaded = false;
let saveDomainsTimer = null;

async function loadCheckedDomains() {
    if (aiCheckedDomainsLoaded) return;
    try {
        const res = await chrome.storage.session.get('ai_checked_domains');
        if (res && Array.isArray(res.ai_checked_domains)) {
            res.ai_checked_domains.forEach(d => AI_CHECKED_DOMAINS.add(d));
        }
    } catch (e) {}
    aiCheckedDomainsLoaded = true;
}

function scheduleSaveDomains() {
    if (saveDomainsTimer) return;
    saveDomainsTimer = setTimeout(() => {
        saveDomainsTimer = null;
        if (!chrome.storage.session) return;
        chrome.storage.session.set({ ai_checked_domains: Array.from(AI_CHECKED_DOMAINS) }).catch(() => {});
    }, 1000);
}

export function invalidateAIModelCache() {
    cachedWeights = null;
    console.log('🔄 [AI] 模型缓存已清除，等待下次加载');
} // 🚀 M-7 修复：内存级模型缓存
export async function runAICheck(url, tabId = null, isThirdParty = false) {
    try {
        await loadCheckedDomains(); // 🚀 恢复休眠前的状态
        const domain = isThirdParty ? url : new URL(url).hostname;
        if (AI_CHECKED_DOMAINS.has(domain)) return;
        // 🔧 防御性微调：防止 Set 无限膨胀导致内存泄漏
        if (AI_CHECKED_DOMAINS.size > 5000) {
            AI_CHECKED_DOMAINS.clear();
        }
        AI_CHECKED_DOMAINS.add(domain);
        scheduleSaveDomains(); // 🚀 异步落盘

        // 🛑 防线 0：前端硬拦截 (与规则层对齐，命中直接拦截，不消耗 AI 算力)
        
        if (HARD_BLOCK_DOMAINS.some(d => domain === d || domain.endsWith('.' + d))) {
            console.log(`🛑 [AI] 命中绝对黑名单，交由网络层/规则层处理: ${domain}`);
            return;
        }

        // 🚀 稀疏化：只取非零 n-gram 桶与结构特征，不建 16418 维稠密数组
        const { buckets, structs } = extractSparseFeatures(domain);

        // 🚀 M-7 修复：内存级缓存，避免每次从 IndexedDB 反序列化整份权重
        if (!cachedWeights) {
            const cached = await getCachedModel();
            if (!cached || !cached.weights) return;
            cachedWeights = cached.weights;
            console.log('⚡ [AI] 模型权重已加载至内存缓存');
        }

        const { coef, intercept } = cachedWeights;
        // 🚀 稀疏化：以 intercept 初始化，仅累加非零特征，无 16418 次全量扫描
        const logits = [intercept[0], intercept[1], intercept[2]];

        for (const [bucket, cnt] of buckets) {
            logits[0] += coef[0][bucket] * cnt;
            logits[1] += coef[1][bucket] * cnt;
            logits[2] += coef[2][bucket] * cnt;
        }
        for (const [idx, val] of structs) {
            logits[0] += coef[0][idx] * val;
            logits[1] += coef[1][idx] * val;
            logits[2] += coef[2][idx] * val;
        }

        // Softmax 转为概率
        const maxLogit = Math.max(...logits);
        const exps = logits.map(l => Math.exp(l - maxLogit));
        const sumExps = exps.reduce((a, b) => a + b, 0);
        const probs = exps.map(e => e / sumExps);
        const maxIdx = probs.indexOf(Math.max(...probs));
        const classes = ['Normal', 'Ad', 'Tracker']; // 🔒 P-01 修复：模型只有 3 类
        const classification = classes[maxIdx];

        // 🔒 安全网 1：如果开关关闭或网站在白名单里，直接放行
        const settings = await chrome.storage.local.get('dewsecure_settings').then(r => r.dewsecure_settings || {});
        if (settings.aiEnabled === false) return; // 尊重前端开关
        const isWhitelisted = (settings.whitelist || []).some(d => domain === d || domain.endsWith('.' + d)) ||
                              (settings.tempWhitelist || []).some(d => domain === d || domain.endsWith('.' + d));
        if (isWhitelisted) {
            return;
        }

        // 🔒 P-01: 暂时移除 Phishing 分支，等待未来加入钓鱼训练数据
        if (classification === 'Ad' || classification === 'Tracker') {
            // 🔒 安全网 2：严禁拦截 main_frame (防止网页白屏死锁)
            const confidence = probs[maxIdx];
            if (confidence < 0.8) {
                // console.log(`[AI] 置信度不足 (${confidence.toFixed(2)})，放弃拦截: ${domain}`);
                return;
            }

            // 🌟 防线 1：AI 拦截前置豁免检查 (绝对白名单)
            
            if (HARD_SAFE_DOMAINS.some(d => domain === d || domain.endsWith('.' + d))) return;
            if (domain === 'dewsecure.com' || domain.endsWith('.dewsecure.com')) return;

            // 🛡️ F1 修复：只对第三方请求执行拦截。
            if (!isThirdParty) {
                console.log(`🛡️ [AI] 发现可疑主页 (${domain})，但为防白屏，不执行拦截。`);
                return;
            }

            // ==========================================
            // 🚀 M-7 核心重构：多信号交叉验证 (3 种独立信号)
            // ==========================================
            const signals = ['模型置信度'];
            let finalConfidence = confidence;

            // 信号 2：跨站引用频率 (被 >= 3 个站点引用)
            const refCount = HOST_REF_COUNT.get(domain) || 0;
            if (refCount >= 3) {
                signals.push(`跨站引用(${refCount}次)`);
                finalConfidence = Math.min(1.0, finalConfidence + 0.05);
            }

            // 信号 3：威胁情报匹配 (如果在本地情报缓存中)
            // 由于这里没有直接的同步查库方法，暂时用简单的域名长度/特征做示意。
            // 实际落地可在此调用本地查表接口。
            if (domain.length > 15 && domain.includes('-')) { 
                signals.push('可疑特征匹配');
                finalConfidence = Math.min(1.0, finalConfidence + 0.05);
            }

            if (signals.length >= 3 && finalConfidence >= 0.95) {
                // 🛡️ 满足三信号交叉验证，执行硬拦截
                const hash = domain.split('').reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0);
                const ruleId = 8000000 + Math.abs(hash % 100000);

                await chrome.declarativeNetRequest.updateSessionRules({
                    removeRuleIds: [ruleId],
                    addRules: [{
                        id: ruleId,
                        priority: 2000000,
                        action: { type: 'block' },
                        condition: {
                            requestDomains: [domain],
                            resourceTypes: AI_BLOCK_RESOURCE_TYPES
                        }
                    }]
                }).catch(e => console.warn('[AI] DNR 规则注入失败:', e));

                console.log(`🛡️ [AI] 已对 ${domain} 实施硬拦截 (信号: ${signals.join(', ')} | 置信度: ${finalConfidence.toFixed(2)})`);
            } else {
                // 💡 置信度高，但信号不足，进入“建议规则”管线
                if (finalConfidence >= 0.95) {
                    console.log(`💡 [AI] 发现高度可疑域名 ${domain}，信号不足 (${signals.join(', ')})，转入人工审核建议。`);
                    chrome.storage.local.get('ai_suggested_rules').then(res => {
                        const list = res.ai_suggested_rules || [];
                        if (!list.some(r => r.domain === domain)) {
                            list.push({ domain, reason: signals.join(', '), score: finalConfidence, ts: Date.now() });
                            chrome.storage.local.set({ ai_suggested_rules: list.slice(-50) });
                        }
                    });
                } else {
                    console.log(`🛡️ [AI] 发现可疑第三方 (${domain})，置信度不足或信号不够，仅观察。`);
                }
            }
        }
    } catch(e) {}
}
