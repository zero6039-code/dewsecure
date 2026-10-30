// 🔒 P-01 硬核钓鱼检测：品牌仿冒、同形字与防误杀优化 (V3)

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
    'github.com', 'google.com', 'youtube.com', 'facebook.com', 'twitter.com', 
    'x.com', 'instagram.com', 'linkedin.com', 'wikipedia.org', 'microsoft.com', 
    'apple.com', 'amazon.com', 'cloudflare.com', 'reddit.com'
];

export function detectBrandPhishing(url) {
    try {
        const u = new URL(url);
        let host = u.hostname.toLowerCase().replace(/^www\./, '');
        const pathAndSearch = (u.pathname + u.search).toLowerCase();
        
        // 🛡️ 安全网 1：对全球高信誉域名直接放行，绝不检查它们的路径（防 github.com/apple/verify 误杀）
        if (SAFE_HOSTS.some(safe => host === safe || host.endsWith('.' + safe))) {
            return false;
        }

        // 1. 拦截纯 IP 形式访问的登录页
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && (pathAndSearch.includes('login') || pathAndSearch.includes('admin'))) {
            return true;
        }

        // 2. 拦截包含 @ 的混淆 URL
        if (url.includes('@') && !url.includes('mailto:')) {
            return true;
        }

        // 3. 高风险 TLD 且包含诱导词
        const hasRiskTld = HIGH_RISK_TLDS.some(tld => host.endsWith(tld));
        const hasPhishKeyword = PHISH_KEYWORDS.some(kw => host.includes(kw) || pathAndSearch.includes(kw));
        if (hasRiskTld && hasPhishKeyword) {
            return true;
        }

        // 4. 品牌仿冒检测
        for (const brand of BRANDS) {
            const officialDomains = BRAND_DOMAINS[brand];
            
            // 4.1 官方域名直接跳过（如 paypal.me）
            const isOfficial = officialDomains.some(od => host === od || host.endsWith('.' + od));
            if (isOfficial) continue;

            // 4.2 同形字检测（如 paypa1 -> paypal）
            const deobfuscated = host.replace(/0/g, 'o').replace(/1/g, 'l').replace(/3/g, 'e').replace(/5/g, 's').replace(/rn/g, 'm');
            // 🔒 只有当原域名【不包含】品牌，但替换后【包含】品牌，才算同形字
            if (!host.includes(brand) && deobfuscated.includes(brand)) {
                return true; 
            }

            // 4.3 域名包含品牌词但非官方（防误杀 notpaypal.com, myappleblog.com）
            if (host.includes(brand)) {
                // 分离出品牌词前后的内容，例如 host = "apple-login.com", parts = ["", "-login.com"]
                const parts = host.split(brand);
                const prefix = parts[0];
                const suffix = parts[1] || '';
                
                // 只有品牌词前后有非字母字符（如 -_），或者带有诱导词（如 login），才拦截
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
