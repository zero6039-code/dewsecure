// 🔒 P-01 硬核钓鱼检测：品牌仿冒、同形字与防误杀优化 (V5 修复 N-7)
// 兼容策略：对外保留 detectBrandPhishing(url): boolean，调用方零改动；
//           对内 assess(url) 返回 { flag, reasons }，供未来警告页显示理由。
import { parse } from 'tldts';

const BRAND_DOMAINS = {
    'paypal': ['paypal.com', 'paypal.me', 'paypalobjects.com'],
    'apple': ['apple.com', 'icloud.com'],
    'microsoft': ['microsoft.com', 'live.com', 'office.com', 'azure.com'],
    'google': ['google.com', 'gstatic.com', 'youtube.com', 'googleapis.com'],
    'facebook': ['facebook.com', 'fb.com', 'fbcdn.net'],
    'whatsapp': ['whatsapp.com', 'wa.me'],
    'amazon': ['amazon.com', 'amazon.co.uk', 'amazon.com.my', 'media-amazon.com'],
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
    'tencent': ['tencent.com'],
    'taobao': ['taobao.com', 'tmall.com'],
    'unionpay': ['unionpay.com', 'unionpayintl.com']
};

const BRANDS = Object.keys(BRAND_DOMAINS);

// N-7 修复：高风险 TLD 用 publicSuffix 精确判断，关键词只看 host，不看 path
const RISKY_SUFFIX = new Set([
    'xyz', 'top', 'cc', 'tk', 'ml', 'ga', 'cf', 'gq',
    'work', 'link', 'click', 'online', 'site'
]);
const KEYWORDS = ['login', 'signin', 'verify', 'secure', 'account',
                  'billing', 'recovery', 'unlock', 'confirm'];

// 豁免列表：绝对不会被品牌路径检测误杀的超级大站
const SAFE_HOSTS = [
    'dewsecure.com', 'dev.dewsecure.com',
    'github.com', 'google.com', 'youtube.com', 'facebook.com', 'twitter.com',
    'x.com', 'instagram.com', 'linkedin.com', 'wikipedia.org', 'microsoft.com',
    'apple.com', 'amazon.com', 'cloudflare.com', 'reddit.com',
    'dropbox.com', 'www.dropbox.com', 'dropboxusercontent.com'
];

// N-7 修复：真正的 ccTLD 后缀才信任（含 co.uk / com.my 这类二阶后缀）
// 显式排除 RISKY_SUFFIX，防止 paypal.xyz 被误信任
const isCcSuffix = (s) =>
    !RISKY_SUFFIX.has(s) &&
    /^([a-z]{2}|(co|com|net|org|ac|gov|edu)\.[a-z]{2})$/.test(s);

// 简单的 IDN (Punycode) 同形字解码处理函数（保留原逻辑）
function checkIdnHomograph(host) {
    if (!host.includes('xn--')) return false;
    const stripped = host.replace(/xn--/g, '');
    return BRANDS.some(brand => {
        const tail = brand.slice(1);
        return tail.length >= 3 && stripped.includes(tail);
    });
}

// 内部评估函数：返回 { flag, reasons }
export function assess(url) {
    const u = new URL(url);
    let host = u.hostname.toLowerCase().replace(/^www\./, '');
    const reasons = [];

    // 安全网 1：高信誉域名直接放行
    if (SAFE_HOSTS.some(safe => host === safe || host.endsWith('.' + safe))) {
        return { flag: false, reasons };
    }

    // 1. 纯 IP 形式访问的登录/管理页
    const pathAndSearch = (u.pathname + u.search).toLowerCase();
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) &&
        (pathAndSearch.includes('login') || pathAndSearch.includes('admin'))) {
        reasons.push('ip-login');
        return { flag: true, reasons };
    }

    // 2. userinfo 混淆 (https://paypal.com@evil.com) —— H-2 已正确，保留
    if (u.username && u.username.includes('.')) {
        reasons.push('userinfo-spoof');
        return { flag: true, reasons };
    }

    // 3. IDN 同形字 (xn--pple-43d.com)
    if (checkIdnHomograph(host)) {
        reasons.push('idn-homograph');
        return { flag: true, reasons };
    }

    const p = parse(host);
    if (!p.domain) return { flag: false, reasons };

    const label = p.domainWithoutSuffix || '';
    const sub = (p.subdomain || '').split('.').filter(Boolean);

    // 4. 品牌仿冒检测（N-7 重写：标签级匹配 + ccTLD 信任）
    for (const [brand, official] of Object.entries(BRAND_DOMAINS)) {
        if (official.includes(p.domain)) continue;              // 官方注册域放行
        if (label === brand && isCcSuffix(p.publicSuffix)) continue; // 品牌国家站放行

        const tokens = label.split('-');
        if (sub.some(l => l === brand || l.split('-').includes(brand))) {
            reasons.push('brand-in-subdomain:' + brand);
        } else if (tokens.includes(brand) && tokens.length > 1) {
            reasons.push('brand-token:' + brand);
        } else if (label === brand) {
            reasons.push('brand-wrong-suffix:' + brand);
        } else if (!label.includes(brand) &&
                   label.replace(/0/g, 'o').replace(/1/g, 'l')
                        .replace(/3/g, 'e').replace(/rn/g, 'm')
                        .includes(brand)) {
            reasons.push('lookalike:' + brand);
        }
    }

    // 5. 高风险 TLD + 关键词（只看 host，不看 path —— N-7 第 1 点）
    if (RISKY_SUFFIX.has(p.publicSuffix) && KEYWORDS.some(k => host.includes(k))) {
        reasons.push('risky-tld+keyword-in-host');
    }

    return { flag: reasons.length > 0, reasons };
}

// 对外兼容接口：保持原函数名与 boolean 返回，调用方零改动
export function detectBrandPhishing(url) {
    try {
        return assess(url).flag;
    } catch (e) {
        return false;
    }
}
