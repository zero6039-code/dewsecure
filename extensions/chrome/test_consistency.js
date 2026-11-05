import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==========================================
// 从 ai.js 原样复制的核心特征提取逻辑
// ==========================================
function fnv1a(str) {
    let hash = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    for (let i = 0; i < str.length; i++) {
        hash ^= BigInt(str.charCodeAt(i));
        hash = BigInt.asUintN(64, hash * prime);
    }
    return hash;
}

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

function isIpAddress(url) {
    const parts = url.split('/');
    if (parts.length < 3) return false;
    const host = parts[2].split(':')[0];
    const octets = host.split('.');
    if (octets.length !== 4) return false;
    return octets.every(o => /^\d+$/.test(o) && parseInt(o, 10) >= 0 && parseInt(o, 10) <= 255);
}

function extractFeaturesFromUrl(url) {
    const NGRAM_SIZE = 16384;
    const STRUCT_SIZE = 34;
    const features = new Float32Array(NGRAM_SIZE + STRUCT_SIZE);
    const url_lower = url.toLowerCase();

    for (let i = 0; i <= url_lower.length - 3; i++) {
        const ngram = url_lower.substring(i, i + 3);
        const hash = fnv1a(ngram);
        features[Number(hash % 16384n)] += 1.0;
    }

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
// 执行测试逻辑
// ==========================================
function runTest() {
    const VECTORS_PATH = path.join(__dirname, '../../models/training/feature_test_vectors.json');
    if (!fs.existsSync(VECTORS_PATH)) {
        console.error("❌ 找不到基准向量文件，请先运行 gen_test_vectors.py");
        process.exit(1);
    }

    console.log("🚀 正在运行 JS 与 Python 特征一致性校验...");
    const expectedVectors = JSON.parse(fs.readFileSync(VECTORS_PATH, 'utf8'));
    let failed = false;

    for (const [domain, expected] of Object.entries(expectedVectors)) {
        const actual = extractFeaturesFromUrl(domain);
        let domainFailed = false;
        for (let i = 0; i < expected.length; i++) {
            // 使用 1e-5 容差，防止 Float32Array 与 Python 浮点数精度的微小差异
            if (Math.abs(actual[i] - expected[i]) > 1e-5) {
                console.error(`❌ [数值偏差] ${domain} 维度[${i}]: JS=${actual[i]}, PY=${expected[i]}`);
                domainFailed = true;
                failed = true;
                break;
            }
        }
        if (!domainFailed) {
            console.log(`✅ ${domain} 特征完全一致`);
        }
    }

    if (failed) {
        console.error("\n🚨 特征一致性校验失败！请检查 features.py 与 ai.js 的哈希或特征提取逻辑是否一致。");
        process.exit(1);
    } else {
        console.log(`\n🎉 完美通过！所有域名的特征在 Python 与 JS 端完全一致。`);
    }
}

runTest();
