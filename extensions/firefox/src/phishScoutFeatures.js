// ==========================================
// 🎣 PhishScout v2 特征提取器 (JS 版)
// ==========================================

const SHORTENERS = new Set([
    'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly',
    'adf.ly', 'bit.do', 'mcaf.ee', 'su.pr', 'ity.im', 'q.gs', 'po.st',
    'bc.vc', 'u.to', 'j.mp', 'buzurl.com', 'cutt.us', 'u.bb', 'yourls.org',
    'x.co', 'prettylinkpro.com', 'scrnch.me', 'filourl.com', 'vzturl.com',
    'qr.net', '1url.com', 'tweez.me', 'v.gd', 'tr.im'
]);
const SUSPICIOUS_TLDS = new Set(['tk', 'ml', 'ga', 'cf', 'gq', 'xyz', 'top', 'work', 'click', 'link', 'country', 'stream', 'download', 'win', 'bid', 'loan', 'review', 'faith', 'party', 'science', 'gdn', 'racing', 'accountant', 'date', 'men', 'cricket']);
const FREE_HOSTS = new Set(['000webhostapp.com', 'weebly.com', 'wixsite.com', 'blogspot.com', 'wordpress.com', 'github.io', 'netlify.app', 'vercel.app', 'herokuapp.com', 'firebaseapp.com', 'web.app', 'glitch.me', 'repl.co', 'ngrok.io', 'serveo.net', 'localtunnel.me', 'pagekite.me', 'tunnelto.dev']);
const SUSPICIOUS_KEYWORDS = ['login', 'signin', 'verify', 'secure', 'account', 'update', 'banking', 'confirm', 'password', 'credential', 'wallet', 'billing', 'invoice', 'support', 'unlock', 'recover', 'alert', 'suspended', 'limited', 'webscr', 'cmd', 'paypal', 'apple', 'microsoft', 'google', 'amazon', 'netflix', 'facebook', 'instagram', 'whatsapp', 'maybank', 'cimb', 'grab', 'touchngo', 'boost', 'shopeepay'];
const OPEN_REDIRECT_PARAMS = ['url=', 'redirect=', 'next=', 'return=', 'goto=', 'dest=', 'r=', 'u=', 'link=', 'target=', 'redir=', 'redirect_uri=', 'callback=', 'continue=', 'window=', 'to=', 'out=', 'view='];

function fnv1a32(str) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash;
}
function shannonEntropy(str) {
    if (!str) return 0;
    const freq = {};
    for (let i = 0; i < str.length; i++) freq[str[i]] = (freq[str[i]] || 0) + 1;
    let entropy = 0;
    for (const c in freq) { const p = freq[c] / str.length; entropy -= p * Math.log2(p); }
    return entropy;
}

// 🚀 P-2 优化：带剪枝的一维 Levenshtein
function levenshtein(a, b, cap) {
    // 长度差已经大于等于当前最小距离，直接返回 cap
    if (Math.abs(a.length - b.length) >= cap) return cap;
    
    let prev = Array.from({ length: a.length + 1 }, (_, j) => j);
    for (let i = 1; i <= b.length; i++) {
        const cur = [i];
        let rowMin = i;
        for (let j = 1; j <= a.length; j++) {
            const v = Math.min(prev[j - 1] + (b[i - 1] === a[j - 1] ? 0 : 1), cur[j - 1] + 1, prev[j] + 1);
            cur[j] = v;
            if (v < rowMin) rowMin = v;
        }
        if (rowMin >= cap) return cap; // 提前终止
        prev = cur;
    }
    return Math.min(prev[a.length], cap);
}

export function extractFeatures(rawUrl) {
    const features = new Float32Array(579);
    let idx = 0;
    let url;
    try { url = new URL(rawUrl); } catch { url = new URL(`https://${rawUrl}`); }

    const host = url.hostname;
    const path = url.pathname;
    const query = url.search;
    const proto = url.protocol;
    const port = url.port;
    const tld = host.split('.').pop() || '';
    const domainParts = host.split('.');
    const domain = domainParts.length > 1 ? domainParts.slice(-2).join('.') : host;
    const subdomain = domainParts.length > 2 ? domainParts.slice(0, -2).join('.') : '';
    const fullUrl = rawUrl.toLowerCase();

    // 🚀 P-2 优化：关键词命中只算一次
    let kwHits = 0;
    for (const k of SUSPICIOUS_KEYWORDS) {
        if (fullUrl.includes(k)) kwHits++;
    }

    // --- 1. 67 个结构化特征 (索引 0 - 66) ---
    features[idx++] = rawUrl.length;                               // 0
    features[idx++] = (rawUrl.match(/-/g) || []).length;           // 1
    features[idx++] = (rawUrl.match(/\d/g) || []).length;          // 2
    features[idx++] = subdomain ? subdomain.split('.').length : 0; // 3
    features[idx++] = proto ? 1 : 0;                               // 4
    features[idx++] = (rawUrl.match(/[^a-zA-Z0-9]/g) || []).length; // 5
    features[idx++] = shannonEntropy(rawUrl);                      // 6
    features[idx++] = path.split('/').filter(Boolean).length;      // 7
    features[idx++] = host.length;                                 // 8
    features[idx++] = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ? 1 : 0; // 9
    features[idx++] = rawUrl.includes('@') ? 1 : 0;                // 10
    features[idx++] = rawUrl.includes('//') && rawUrl.indexOf('//') !== rawUrl.indexOf('://') + 1 ? 1 : 0; // 11
    features[idx++] = tld.length;                                  // 12
    features[idx++] = ['com', 'org', 'net', 'gov', 'edu'].includes(tld) ? 1 : 0; // 13
    features[idx++] = (query.match(/=/g) || []).length;            // 14
    features[idx++] = path.length;                                 // 15
    features[idx++] = kwHits;                                      // 16 (复用)
    const brandInHost = SUSPICIOUS_KEYWORDS.some(k => host.includes(k)) ? 1 : 0;
    features[idx++] = brandInHost;                                 // 17
    features[idx++] = SUSPICIOUS_KEYWORDS.some(k => path.includes(k)) ? 1 : 0; // 18
    features[idx++] = kwHits;                                      // 19 (复用)
    features[idx++] = host.includes('xn--') ? 1 : 0;               // 20
    features[idx++] = (port && port !== '80' && port !== '443') ? 1 : 0; // 21
    features[idx++] = (rawUrl.match(/%[0-9A-Fa-f]{2}/g) || []).length; // 22
    features[idx++] = /^0x[0-9a-f]+$/i.test(host) ? 1 : 0;         // 23
    features[idx++] = rawUrl.length ? (rawUrl.match(/[A-Z]/g) || []).length / rawUrl.length : 0; // 24
    features[idx++] = (host.match(/www/g) || []).length;           // 25
    
    // 🚀 P-2 优化：替代 Math.max(...) 防止爆栈
    const digitRuns = rawUrl.match(/\d+/g) || [];
    let maxRun = 0;
    for (const r of digitRuns) if (r.length > maxRun) maxRun = r.length;
    features[idx++] = maxRun;                                      // 26
    
    const labels = host.split('.');
    let maxLabel = 0;
    for (const l of labels) if (l.length > maxLabel) maxLabel = l.length;
    features[idx++] = maxLabel;                                    // 27
    
    features[idx++] = labels.length;                               // 28
    features[idx++] = rawUrl.includes(domain) && path.includes(domain) ? 1 : 0; // 29
    features[idx++] = query.length;                                // 30
    features[idx++] = (query.match(/=/g) || []).length;            // 31
    features[idx++] = /\.(php|asp|aspx|jsp|cgi|exe|scr|bat|cmd|msi|vbs|js)$/i.test(path) ? 1 : 0; // 32
    features[idx++] = (host.split('.').length > 3) ? 1 : 0;        // 33
    features[idx++] = (rawUrl.match(/([^a-zA-Z0-9])\1/g) || []).length; // 34
    features[idx++] = 0;                                           // 35
    features[idx++] = 0;                                           // 36
    features[idx++] = (host.match(/[^\x00-\x7F]/g) || []).length;  // 37
    features[idx++] = /[\u0400-\u04FF]/.test(host) ? 1 : 0;        // 38
    
    // 🚀 P-2 优化：带剪枝的 Levenshtein
    let minDist = 999;
    for (const b of SUSPICIOUS_KEYWORDS) {
        if (host.includes(b)) { minDist = 0; break; }
        const d = levenshtein(host, b, minDist);
        if (d < minDist) minDist = d;
    }
    features[idx++] = minDist;                                     // 39
    
    features[idx++] = SUSPICIOUS_KEYWORDS.some(k => subdomain.includes(k)) ? 1 : 0; // 40
    features[idx++] = SUSPICIOUS_KEYWORDS.some(k => domain === k + '.' + tld || domain === k) ? 1 : 0; // 41
    features[idx++] = SUSPICIOUS_KEYWORDS.some(k => subdomain.includes(k)) && !SUSPICIOUS_KEYWORDS.some(k => domain === k) ? 1 : 0; // 42
    features[idx++] = SUSPICIOUS_TLDS.has(tld) ? 1 : 0;            // 43
    features[idx++] = ['com', 'c0m', 'cm', 'co', 'om'].includes(tld) ? 1 : 0; // 44
    features[idx++] = tld.length === 2 ? 1 : 0;                    // 45
    features[idx++] = (host.match(/\./g) || []).length;            // 46
    features[idx++] = labels.length > 3 ? 1 : 0;                   // 47
    features[idx++] = domain.length;                               // 48
    const firstSub = subdomain.split('.')[0] || '';
    features[idx++] = firstSub.length;                             // 49
    features[idx++] = shannonEntropy(firstSub);                    // 50
    const vowels = firstSub.match(/[aeiou]/gi) || [];
    features[idx++] = firstSub.length ? vowels.length / firstSub.length : 0; // 51
    features[idx++] = firstSub.length > 12 && shannonEntropy(firstSub) > 3.5 ? 1 : 0; // 52
    features[idx++] = domain.length ? (domain.match(/\d/g) || []).length / domain.length : 0; // 53
    features[idx++] = /^0[0-7]+$/.test(host) ? 1 : 0;              // 54
    features[idx++] = /^\d+$/.test(host) ? 1 : 0;                  // 55
    features[idx++] = /^\d+$/.test(host.replace(/\./g, '')) ? 1 : 0; // 56
    features[idx++] = proto && proto !== 'http:' && proto !== 'https:' ? 1 : 0; // 57
    features[idx++] = rawUrl.includes('@') ? 1 : 0;                // 58
    features[idx++] = OPEN_REDIRECT_PARAMS.some(p => fullUrl.includes(p)) ? 1 : 0; // 59
    features[idx++] = /(https?%3A%2F%2F)/i.test(path) ? 1 : 0;     // 60
    features[idx++] = FREE_HOSTS.has(domain) ? 1 : 0;              // 61
    features[idx++] = FREE_HOSTS.has(domain) && brandInHost ? 1 : 0; // 62
    features[idx++] = (rawUrl.match(/(.)\1/g) || []).length;       // 63
    features[idx++] = /[\u{1F300}-\u{1FAFF}]/u.test(rawUrl) ? 1 : 0; // 64
    features[idx++] = SUSPICIOUS_KEYWORDS.some(k => query.includes(k)) ? 1 : 0; // 65
    features[idx++] = SHORTENERS.has(domain) ? 1 : 0;              // 66

    // --- 2. 512 个字符级 N-gram (索引 67 - 578) ---
    const lower = rawUrl.toLowerCase();
    for (let n = 3; n <= 5; n++) {
        for (let i = 0; i <= lower.length - n; i++) {
            const gram = lower.substring(i, i + n);
            const hash = fnv1a32(gram) % 512;
            features[67 + hash] = 1;
        }
    }

    return features;
}
