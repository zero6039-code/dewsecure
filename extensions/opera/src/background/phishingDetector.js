// 🔒 P-01 硬核钓鱼检测：品牌仿冒、同形字与防误杀优化 (V4 修复 H-2)
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

const HIGH_RISK_TLDS = ['.xyz', '.top', '.cc', '.tk', '.ml', '.ga', '.cf', '.gq', '.work', '.link', '.click', '.online', '.site'];
const PHISH_KEYWORDS = ['login', 'signin', 'verify', 'secure', 'update', 'account', 'billing', 'support', 'auth', 'recovery', 'unlock', 'confirm'];

// 豁免列表：绝对不会被品牌路径检测误杀的超级大站
const SAFE_HOSTS = [
    'dewsecure.com', 'dev.dewsecure.com',
    'github.com', 'google.com', 'youtube.com', 'facebook.com', 'twitter.com', 
    'x.com', 'instagram.com', 'linkedin.com', 'wikipedia.org', 'microsoft.com', 
    'apple.com', 'amazon.com', 'cloudflare.com', 'reddit.com'
];

// 简单的 IDN (Punycode) 同形字解码处理函数
function checkIdnHomograph(host) {
    if (!host.includes('xn--')) return false;
    // 对于 Punycode 域名，若去掉 xn-- 后包含品牌词的后缀（如 xn--pple-43d -> pple），判定为 IDN 伪装
    // 合法的 IDN（如中文 xn--fiqs8s）通常不包含长串英文，因此不会误杀
    const stripped = host.replace(/xn--/g, '');
    return BRANDS.some(brand => {
        const tail = brand.slice(1);
        return tail.length >= 3 && stripped.includes(tail);
    });
}

export function detectBrandPhishing(url) {
    try {
        const u = new URL(url);
        let host = u.hostname.toLowerCase().replace(/^www\./, '');
        const pathAndSearch = (u.pathname + u.search).toLowerCase();
        
        // 🛡️ 安全网 1：对全球高信誉域名直接放行，绝不检查它们的路径
        if (SAFE_HOSTS.some(safe => host === safe || host.endsWith('.' + safe))) {
            return false;
        }

        // 1. 拦截纯 IP 形式访问的登录页
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && (pathAndSearch.includes('login') || pathAndSearch.includes('admin'))) {
            return true;
        }

        // 2. [H-2 修复] 精准拦截 userinfo 混淆 (如 https://paypal.com@evil.com)
        // 使用 URL 解析的 username 属性，绝不误杀 medium.com/@user
        if (u.username && u.username.includes('.')) {
            return true;
        }

        // 3. 高风险 TLD 且包含诱导词
        const hasRiskTld = HIGH_RISK_TLDS.some(tld => host.endsWith(tld));
        const hasPhishKeyword = PHISH_KEYWORDS.some(kw => host.includes(kw) || pathAndSearch.includes(kw));
        if (hasRiskTld && hasPhishKeyword) {
            return true;
        }

        // [H-2 修复] 预解析注册域与子域
        const domainInfo = parse(host);
        const registeredDomain = domainInfo.domain;
        const subdomain = domainInfo.subdomain || '';

        // 4. 品牌仿冒检测
        for (const brand of BRANDS) {
            const officialDomains = BRAND_DOMAINS[brand];
            
            // 4.1 官方注册域直接跳过 (如登录页 login.paypal.com，注册域是 paypal.com)
            const isOfficialReg = officialDomains.some(od => registeredDomain === od || (registeredDomain && registeredDomain.endsWith('.' + od)));
            if (isOfficialReg) continue;

            // 4.2 [H-2 修复] 子域欺骗检测 (如 paypal.com.evil-site.net)
            if (registeredDomain && subdomain) {
                const subLabels = subdomain.split('.');
                if (subLabels.some(label => label === brand || label.startsWith(brand + '-'))) {
                    return true;
                }
            }

            // 4.3 IDN 同形字检测 (如 xn--pple-43d.com)
            if (checkIdnHomograph(host)) {
                return true;
            }

            // 4.4 传统同形字检测（如 paypa1 -> paypal）
            const deobfuscated = host.replace(/0/g, 'o').replace(/1/g, 'l').replace(/3/g, 'e').replace(/5/g, 's').replace(/rn/g, 'm');
            if (!host.includes(brand) && deobfuscated.includes(brand)) {
                return true; 
            }

            // 4.5 域名包含品牌词但非官方（防误杀 notpaypal.com, myappleblog.com）
            if (host.includes(brand)) {
                const parts = host.split(brand);
                const prefix = parts[0];
                const suffix = parts[1] || '';
                
                const isSuspiciousPrefix = /[-_@.]/.test(prefix) || PHISH_KEYWORDS.some(kw => prefix.includes(kw));
                const isSuspiciousSuffix = /^[-_]/.test(suffix) || PHISH_KEYWORDS.some(kw => suffix.includes(kw));
                
                if (isSuspiciousPrefix || isSuspiciousSuffix) {
                    return true;
                }
            }
        }

        return false;
    } catch (e) {
        return false;
    }
}
