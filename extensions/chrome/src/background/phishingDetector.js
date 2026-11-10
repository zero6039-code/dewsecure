import { parse } from 'tldts';

// 扩充官方域白名单
const BRAND_DOMAINS = {
    'paypal': ['paypal.com', 'paypal.me', 'paypalobjects.com'],
    'apple': ['apple.com', 'icloud.com', 'appleid.apple.com'],
    'microsoft': ['microsoft.com', 'live.com', 'office.com', 'azure.com', 'microsoftonline.com', 'windows.net'],
    'google': ['google.com', 'gstatic.com', 'youtube.com', 'googleapis.com', 'googleusercontent.com'],
    'facebook': ['facebook.com', 'fb.com', 'fbcdn.net', 'facebookmail.com'],
    'whatsapp': ['whatsapp.com', 'wa.me'],
    'amazon': ['amazon.com', 'amazon.co.uk', 'amazon.com.my', 'media-amazon.com', 'amazonaws.com'],
    'netflix': ['netflix.com', 'nflxvideo.net'],
    'binance': ['binance.com', 'binance.us'],
    'maybank': ['maybank2u.com.my', 'maybank.com.my'],
    'cimb': ['cimbclicks.com.my', 'cimb.com.my'],
    'publicbank': ['pbebank.com', 'publicbank.com.my'],
    'grab': ['grab.com', 'grab.com.my'],
    'shopee': ['shopee.com.my', 'shopee.sg', 'shopee.co.id'],
    'lazada': ['lazada.com.my', 'lazada.sg', 'lazada.co.id'],
    'alipay': ['alipay.com', 'alipayobjects.com'],
    'wechat': ['wechat.com', 'qq.com'],
    'tencent': ['tencent.com', 'tencentcloud.com'],
    'taobao': ['taobao.com', 'tmall.com'],
    'unionpay': ['unionpay.com', 'unionpayintl.com']
};

const RISKY_SUFFIX = new Set(['xyz', 'top', 'cc', 'tk', 'ml', 'ga', 'cf', 'gq', 'work', 'link', 'click', 'online', 'site']);
const KEYWORDS = ['login', 'signin', 'verify', 'secure', 'account', 'billing', 'recovery', 'unlock', 'confirm'];

const SAFE_HOSTS = [
    'dewsecure.com', 'dev.dewsecure.com', 'youtube.com', 'facebook.com',
    'twitter.com', 'x.com', 'instagram.com', 'linkedin.com', 'wikipedia.org',
    'cloudflare.com', 'reddit.com'
    // 移除 google.com, microsoft.com, apple.com, amazon.com，交由 BRAND_DOMAINS 官方域白名单处理
];

const UGC_HOSTS = [
    'stackexchange.com', 'fandom.com', 'slashdot.org', 'medium.com',
    'wordpress.com', 'blogspot.com', 'google.com', 'github.com',
    'github.io', 'dropbox.com', 'dropboxusercontent.com'
];

// 修复 IDN：只针对“混合文字”（西里尔/希腊 混用 拉丁字母）才报警
function checkIdnHomograph(host) {
    if (!host.includes('xn--')) return false;
    try {
        // 尝试将 punycode 转为 Unicode
        const unicodeHost = new URL(`http://${host}`).hostname;
        // 如果解码后包含西里尔、希腊字母，且包含拉丁字母，视为高危
        const hasCyrillic = /[\u0400-\u04FF]/.test(unicodeHost);
        const hasGreek = /[\u0370-\u03FF]/.test(unicodeHost);
        const hasLatin = /[a-z]/i.test(unicodeHost);
        if ((hasCyrillic || hasGreek) && hasLatin) return true;
    } catch (e) {}
    return false; // 纯中文、纯俄文等单一文字（如 xn--fiq228c.com）正常放行
}

export function assess(url) {
    const u = new URL(url);
    let host = u.hostname.toLowerCase().replace(/^www\./, '');
    const reasons = [];

    if (SAFE_HOSTS.some(safe => host === safe || host.endsWith('.' + safe))) {
        return { flag: false, reasons: [], score: 0 };
    }

    const pathAndSearch = (u.pathname + u.search).toLowerCase();
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && (pathAndSearch.includes('login') || pathAndSearch.includes('admin'))) {
        reasons.push('ip-login'); return { flag: true, reasons, score: 10 };
    }
    if (u.username && u.username.includes('.')) {
        reasons.push('userinfo-spoof'); return { flag: true, reasons, score: 10 };
    }
    if (checkIdnHomograph(host)) {
        reasons.push('idn-homograph'); return { flag: true, reasons, score: 10 };
    }

    const p = parse(host, { allowPrivateDomains: true });
    if (!p.domain) return { flag: false, reasons: [], score: 0 };

    const label = p.domainWithoutSuffix || '';
    const subLabels = (p.subdomain || '').split('.').filter(Boolean);
    const labelTokens = label.split('-').filter(Boolean);
    const pathTokens = u.pathname.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

    let score = 0;
    const isUgc = UGC_HOSTS.some(ugc => host === ugc || host.endsWith('.' + ugc));

    for (const [brand, official] of Object.entries(BRAND_DOMAINS)) {
        if (official.some(o => host === o || host.endsWith('.' + o))) continue;

        const inSub = subLabels.some(l => l === brand || l.split('-').includes(brand));
        const inSld = labelTokens.includes(brand);
        const inPath = pathTokens.includes(brand);

        if (inSub) {
            reasons.push('brand-in-subdomain:' + brand);
            score += 5;
        } else if (inSld) {
            reasons.push('brand-in-domain:' + brand);
            score += 4;
        } else if (inPath) {
            if (isUgc) {
                reasons.push('brand-in-path-on-platform:' + brand);
                score += 5; // UGC 平台路径带品牌词，直接 5 分强拦截
            } else {
                reasons.push('brand-in-path:' + brand);
                score += 1;
            }
        } else if (label === brand && !RISKY_SUFFIX.has(p.publicSuffix)) {
            reasons.push('brand-wrong-suffix:' + brand);
            score += 2;
        }
    }

    if (RISKY_SUFFIX.has(p.publicSuffix) && KEYWORDS.some(k => host.includes(k))) {
        reasons.push('risky-tld+keyword-in-host');
        score += 2;
    }

    // 总得分 >= 3 即拦截
    return { flag: score >= 3, reasons, score };
}

export function detectBrandPhishing(url) {
    try { return assess(url).flag; } catch (e) { return false; }
}
