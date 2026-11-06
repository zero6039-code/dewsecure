// ==========================================
// 🛡️ DewSecure AI 拦截规则配置文件
// ==========================================

// 1. 绝对放行（电商、大厂、CDN）
export const HARD_SAFE_DOMAINS = [
    'ziffstatic.com', 'cdnst.net', 'speedtest.net', 'ookla.com',
    'github.com', 'cloudflare.com', 'apple.com', 'microsoft.com', 'google.com', 'gstatic.com',
    'googleapis.com', 'forbes.com', 'forbesimg.com', 'cloudflareinsights.com', 'cnn.io',
    'discomax.com', 'max.com', 'dropbox.com', 'dropboxstatic.com', 'dropboxusercontent.com',
    'lazcdn.com', 'alicdn.com', 'mmstat.com', 'aliyuncs.com', 
    'shopee.com.my', 'tiktok.com', 'trip.com', 'lazada.com.my'
];

// 2. 绝对拦截（不需要模型推理，直接软隐藏）
export const HARD_BLOCK_DOMAINS = [
    'doubleclick.net', 'google-analytics.com', 'googlesyndication.com',
    'adservice.google.com', 'scorecardresearch.com', 'criteo.com',
    'taboola.com', 'outbrain.com', 'facebook.net', 'adnxs.com'
];

// 3. 允许注入 DNR 拦截的资源类型
// 注意：绝对不包含 stylesheet, image, font，防止网页白屏裸奔
export const AI_BLOCK_RESOURCE_TYPES = [
    "sub_frame", "script", "object", "xmlhttprequest", 
    "ping", "csp_report", "media", "websocket", "other"
];

// 4. 挖矿域名黑名单 (供 DNR 动态拦截)
export const MINING_DOMAINS = [
    'coinhive.com', 'coin-hive.com', 'authedmine.com', 'cryptoloot.pro', 'crypto-loot.com',
    'coinimp.com', 'webminepool.com', 'miner.pr0gramm.com', 'moneropool.com', 'minero.cc',
    'webmine.cz', 'coinerra.com', 'jsecoin.com', 'deepMiner.org', 'crypto-webminer.com',
    'nerohut.com', 'coinpot.co', 'mining.best'
];
