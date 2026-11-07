// ==========================================
// 🎣 PhishScout v2 特征提取器 (JS 版)
// 对齐 HuggingFace saidutta69/PhishScout-v2 的 features.json
// 维度：66 结构化 + 512 N-gram + 1 短链接 = 579
// ==========================================

const SHORTENERS = new Set([
    'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly',
    'adf.ly', 'bit.do', 'mcaf.ee', 'su.pr', 'ity.im', 'q.gs', 'po.st',
    'bc.vc', 'u.to', 'j.mp', 'buzurl.com', 'cutt.us', 'u.bb', 'yourls.org',
    'x.co', 'prettylinkpro.com', 'scrnch.me', 'filourl.com', 'vzturl.com',
    'qr.net', '1url.com', 'tweez.me', 'v.gd', 'tr.im'
]);

const SUSPICIOUS_TLDS = new Set([
    'tk', 'ml', 'ga', 'cf', 'gq', 'xyz', 'top', 'work', 'click', 'link',
    'country', 'stream', 'download', 'win', 'bid', 'loan', 'review', 'faith',
    'party', 'science', 'gdn', 'racing', 'accountant', 'date', 'men', 'cricket'
]);

const FREE_HOSTS = new Set([
    '000webhostapp.com', 'weebly.com', 'wixsite.com', 'blogspot.com',
    'wordpress.com', 'github.io', 'netlify.app', 'vercel.app', 'herokuapp.com',
    'firebaseapp.com', 'web.app', 'glitch.me', 'repl.co', 'ngrok.io',
    'serveo.net', 'localtunnel.me', 'pagekite.me', 'tunnelto.dev'
]);

const SUSPICIOUS_KEYWORDS = [
    'login', 'signin', 'verify', 'secure', 'account', 'update', 'banking',
    'confirm', 'password', 'credential', 'wallet', 'billing', 'invoice',
    'support', 'unlock', 'recover', 'alert', 'suspended', 'limited',
    'webscr', 'cmd', 'paypal', 'apple', 'microsoft', 'google', 'amazon',
    'netflix', 'facebook', 'instagram', 'whatsapp', 'maybank', 'cimb',
    'grab', 'touchngo', 'boost', 'shopeepay'
];

const OPEN_REDIRECT_PARAMS = [
    'url=', 'redirect=', 'next=', 'return=', 'goto=', 'dest=', 'r=', 'u=',
    'link=', 'target=', 'redir=', 'redirect_uri=', 'callback=', 'continue=',
    'window=', 'to=', 'out=', 'view='
];

// FNV-1a 32-bit 哈希
function fnv1a32(str) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash;
}

// 香农熵
function shannonEntropy(str) {
    if (!str) return 0;
    const freq = {};
    for (let i = 0; i < str.length; i++) {
        const c = str[i];
        freq[c] = (freq[c] || 0) + 1;
    }
    let entropy = 0;
    const len = str.length;
    for (const c in freq) {
        const p = freq[c] / len;
        entropy -= p * Math.log2(p);
    }
    return entropy;
}

// 计算编辑距离
function levenshtein(a, b) {
    const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i]);
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b[i - 1] === a[j - 1]) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

// 主提取函数
export function extractFeatures(rawUrl) {
    const features = new Float32Array(579);
    let idx = 0;

    // --- 1. 基础解析 ---
    let url;
    try {
        url = new URL(rawUrl);
    } catch {
        url = new URL(`https://${rawUrl}`);
    }
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

    // --- 2. 66 个结构化特征 ---
    features[idx++] = rawUrl.length;                               // url_length
    features[idx++] = (rawUrl.match(/-/g) || []).length;           // hyphen_count
    features[idx++] = (rawUrl.match(/\d/g) || []).length;          // digit_count
    features[idx++] = subdomain ? subdomain.split('.').length : 0; // subdomain_count
    features[idx++] = proto ? 1 : 0;                               // protocol_exists
    features[idx++] = (rawUrl.match(/[^a-zA-Z0-9]/g) || []).length; // special_char_count
    features[idx++] = shannonEntropy(rawUrl);                      // entropy
    features[idx++] = path.split('/').filter(Boolean).length;      // path_depth
    features[idx++] = host.length;                                 // domain_length
    features[idx++] = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ? 1 : 0; // is_domain_ip
    features[idx++] = rawUrl.includes('@') ? 1 : 0;                // has_at_symbol
    features[idx++] = rawUrl.includes('//') && rawUrl.indexOf('//') !== rawUrl.indexOf('://') + 1 ? 1 : 0; // has_double_slash_redirect
    features[idx++] = tld.length;                                  // tld_length
    features[idx++] = ['com', 'org', 'net', 'gov', 'edu'].includes(tld) ? 1 : 0; // trusted_tld
    features[idx++] = (query.match(/=/g) || []).length;            // query_param_count
    features[idx++] = path.length;                                 // path_length
    features[idx++] = SUSPICIOUS_KEYWORDS.filter(k => fullUrl.includes(k)).length; // keyword_count
    const brandInHost = SUSPICIOUS_KEYWORDS.some(k => host.includes(k)) ? 1 : 0;
    features[idx++] = brandInHost;                                 // brand_in_host
    features[idx++] = SUSPICIOUS_KEYWORDS.some(k => path.includes(k)) ? 1 : 0; // brand_in_path
    features[idx++] = SUSPICIOUS_KEYWORDS.filter(k => fullUrl.includes(k)).length; // brand_count
    features[idx++] = host.includes('xn--') ? 1 : 0;               // has_punycode
    features[idx++] = (port && port !== '80' && port !== '443') ? 1 : 0; // has_nonstandard_port
    features[idx++] = (rawUrl.match(/%[0-9A-Fa-f]{2}/g) || []).length; // percent_encoding_count
    features[idx++] = /^0x[0-9a-f]+$/i.test(host) ? 1 : 0;         // has_hex_ip
    const upperCount = (rawUrl.match(/[A-Z]/g) || []).length;
    features[idx++] = rawUrl.length ? upperCount / rawUrl.length : 0; // uppercase_ratio
    features[idx++] = (host.match(/www/g) || []).length;           // www_count
    const digitRuns = rawUrl.match(/\d+/g) || [];
    features[idx++] = digitRuns.length ? Math.max(...digitRuns.map(r => r.length)) : 0; // max_digit_run
    const labels = host.split('.');
    features[idx++] = labels.length ? Math.max(...labels.map(l => l.length)) : 0; // max_label_len
    features[idx++] = labels.length;                               // host_label_count
    features[idx++] = rawUrl.includes(domain) && path.includes(domain) ? 1 : 0; // has_domain_in_path
    features[idx++] = query.length;                                // query_length
    features[idx++] = (query.match(/=/g) || []).length;            // equals_count
    features[idx++] = /\.(php|asp|aspx|jsp|cgi|exe|scr|bat|cmd|msi|vbs|js)$/i.test(path) ? 1 : 0; // sensitive_extension
    const tldMatches = host.match(/\.[a-z]{2,}/g) || [];
    features[idx++] = new Set(tldMatches).size > 1 ? 1 : 0;        // has_multiple_tlds
    features[idx++] = (rawUrl.match(/([^a-zA-Z0-9])\1/g) || []).length; // consecutive_punct
    features[idx++] = 0;                                           // homoglyph_count (简化处理)
    features[idx++] = 0;                                           // has_homoglyph (简化处理)
    features[idx++] = (host.match(/[^\x00-\x7F]/g) || []).length;  // host_nonascii_count
    features[idx++] = /[\u0400-\u04FF]/.test(host) ? 1 : 0;        // has_mixed_script
    let minDist = 999;
    for (const b of SUSPICIOUS_KEYWORDS) {
        if (host.includes(b)) { minDist = 0; break; }
        const d = levenshtein(host, b);
        if (d < minDist) minDist = d;
    }
    features[idx++] = minDist;                                     // brand_min_editdist
    features[idx++] = SUSPICIOUS_KEYWORDS.some(k => subdomain.includes(k)) ? 1 : 0; // brand_typo_in_subdomain
    features[idx++] = SUSPICIOUS_KEYWORDS.some(k => domain === k + '.' + tld || domain === k) ? 1 : 0; // brand_apex_match
    features[idx++] = SUSPICIOUS_KEYWORDS.some(k => subdomain.includes(k)) && !SUSPICIOUS_KEYWORDS.some(k => domain === k) ? 1 : 0; // brand_in_subdomain_not_apex
    features[idx++] = SUSPICIOUS_TLDS.has(tld) ? 1 : 0;            // tld_is_suspicious
    features[idx++] = ['com', 'c0m', 'cm', 'co', 'om'].includes(tld) ? 1 : 0; // tld_looks_like_com
    features[idx++] = tld.length === 2 ? 1 : 0;                    // tld_is_cctld
    features[idx++] = (host.match(/\./g) || []).length;            // num_dots
    features[idx++] = labels.length > 3 ? 1 : 0;                   // num_labels_gt3
    features[idx++] = domain.length;                               // registrable_domain_length
    features[idx++] = subdomain.split('.')[0]?.length || 0;        // leftmost_subdomain_len
    features[idx++] = shannonEntropy(subdomain.split('.')[0] || ''); // leftmost_subdomain_entropy
    const firstSub = subdomain.split('.')[0] || '';
    const vowels = firstSub.match(/[aeiou]/gi) || [];
    features[idx++] = firstSub.length ? vowels.length / firstSub.length : 0; // leftmost_subdomain_vowel_ratio
    features[idx++] = firstSub.length > 12 && shannonEntropy(firstSub) > 3.5 ? 1 : 0; // has_long_random_subdomain
    const digitCount = (domain.match(/\d/g) || []).length;
    features[idx++] = domain.length ? digitCount / domain.length : 0; // domain_digit_ratio
    features[idx++] = /^0[0-7]+$/.test(host) ? 1 : 0;              // has_octal_ip
    features[idx++] = /^\d+$/.test(host) ? 1 : 0;                  // has_decimal_ip
    features[idx++] = /^\d+$/.test(host.replace(/\./g, '')) ? 1 : 0; // has_dword_ip
    features[idx++] = proto && proto !== 'http:' && proto !== 'https:' ? 1 : 0; // scheme_is_nonthttp
    features[idx++] = rawUrl.includes('@') ? 1 : 0;                // has_userinfo
    features[idx++] = OPEN_REDIRECT_PARAMS.some(p => fullUrl.includes(p)) ? 1 : 0; // open_redirect_param
    features[idx++] = /(https?%3A%2F%2F)/i.test(path) ? 1 : 0;     // encoded_url_in_path
    features[idx++] = FREE_HOSTS.has(domain) ? 1 : 0;              // host_is_free_host
    features[idx++] = FREE_HOSTS.has(domain) && brandInHost ? 1 : 0; // brand_on_free_host
    features[idx++] = (rawUrl.match(/(.)\1/g) || []).length;       // consecutive_identical_chars
    features[idx++] = /[\u{1F300}-\u{1FAFF}]/u.test(rawUrl) ? 1 : 0; // emoji_in_url
    features[idx++] = SUSPICIOUS_KEYWORDS.some(k => query.includes(k)) ? 1 : 0; // query_has_suspicious_keyword
    features[idx++] = SHORTENERS.has(domain) ? 1 : 0;              // host_is_shortener

    // --- 3. 512 个字符级 N-gram 特征 ---
    const lower = rawUrl.toLowerCase();
    for (let n = 3; n <= 5; n++) {
        for (let i = 0; i <= lower.length - n; i++) {
            const gram = lower.substring(i, i + n);
            const hash = fnv1a32(gram) % 512;
            features[67 + hash] = 1; // 从索引 67 开始写入
        }
    }

    // --- 4. 短链接特征 (索引 578) ---
    features[578] = SHORTENERS.has(domain) ? 1 : 0;

    return features;
}

// 导出特征名列表，用于 Python/JS 一致性对拍
export const FEATURE_NAMES = [
    'url_length', 'hyphen_count', 'digit_count', 'subdomain_count', 'protocol_exists',
    'special_char_count', 'entropy', 'path_depth', 'domain_length', 'is_domain_ip',
    'has_at_symbol', 'has_double_slash_redirect', 'tld_length', 'trusted_tld', 'query_param_count',
    'path_length', 'keyword_count', 'brand_in_host', 'brand_in_path', 'brand_count',
    'has_punycode', 'has_nonstandard_port', 'percent_encoding_count', 'has_hex_ip', 'uppercase_ratio',
    'www_count', 'max_digit_run', 'max_label_len', 'host_label_count', 'has_domain_in_path',
    'query_length', 'equals_count', 'sensitive_extension', 'has_multiple_tlds', 'consecutive_punct',
    'homoglyph_count', 'has_homoglyph', 'host_nonascii_count', 'has_mixed_script', 'brand_min_editdist',
    'brand_typo_in_subdomain', 'brand_apex_match', 'brand_in_subdomain_not_apex', 'tld_is_suspicious', 'tld_looks_like_com',
    'tld_is_cctld', 'num_dots', 'num_labels_gt3', 'registrable_domain_length', 'leftmost_subdomain_len',
    'leftmost_subdomain_entropy', 'leftmost_subdomain_vowel_ratio', 'has_long_random_subdomain', 'domain_digit_ratio', 'has_octal_ip',
    'has_decimal_ip', 'has_dword_ip', 'scheme_is_nonthttp', 'has_userinfo', 'open_redirect_param',
    'encoded_url_in_path', 'host_is_free_host', 'brand_on_free_host', 'consecutive_identical_chars', 'emoji_in_url',
    'query_has_suspicious_keyword', 'host_is_shortener'
];
