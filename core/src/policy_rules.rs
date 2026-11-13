use std::collections::HashSet;
use std::sync::RwLock;
use std::sync::OnceLock;

// 静态大厂白名单（可以随时扩充，不影响引擎代码）
const STATIC_BYPASS_LIST: &[&str] = &[
    // Google 全家桶 & CDN
    "google.com", "googleapis.com", "gstatic.com", "googleusercontent.com", 
    "ggpht.com", "youtube.com", "ytimg.com", "googlevideo.com", "gvt1.com", 
    "gvt2.com", "android.com", "play.google.com", "googletagmanager.com",
    // 百度 & 国内大厂
    "baidu.com", "bdstatic.com", "bdimg.com", "qq.com", "gtimg.cn", 
    "weixin.qq.com", "tencent.com", "wechat.com", "alicdn.com", "taobao.com",
    "tmall.com", "alipay.com", "jd.com", "360.cn", "sohu.com", "163.com",
    "lazada.com.my", "lazada.sg",
    // 华为 / 鸿蒙系统服务
    "huawei.com", "hicloud.com", "dbankcloud.com", "dbankcdn.com", 
    // 苹果 / 微软
    "apple.com", "icloud.com", "microsoft.com", "live.com", "office.com",
    // Facebook / 海外社交
    "facebook.com", "fbcdn.net", "whatsapp.net", "instagram.com", "twitter.com",
    // 常见 CDN 与基础设施
    "cloudflare.com", "jsdelivr.net", "cloudflare-dns.com", "akamaihd.net",
    "amazonaws.com", "azureedge.net", "azure.com", "github.com", "githubusercontent.com",
    // 自家官网（防止测试时被 MitM 干扰）
    "dewsecure.com"
];

// 动态学习的 Bypass 集合（内存级，App 重启后清空）
static AUTO_BYPASS_CACHE: OnceLock<RwLock<HashSet<String>>> = OnceLock::new();

fn get_cache() -> &'static RwLock<HashSet<String>> {
    AUTO_BYPASS_CACHE.get_or_init(|| RwLock::new(HashSet::new()))
}

/// 记录一个被判定为 MitM 失败的域名（下次直接放行）
pub fn mark_failed(domain: &str) {
    let mut cache = get_cache().write().unwrap();
    if cache.insert(domain.to_string()) {
        log::info!("⚠️ 记录自动 Bypass 域名: {}", domain);
    }
}

/// 判断是否需要直接透传（Bypass）
pub fn should_bypass_mitm(domain: &str) -> bool {
    // 1. 查静态大厂白名单
    for b in STATIC_BYPASS_LIST {
        if domain == *b || domain.ends_with(&format!(".{}", b)) {
            return true;
        }
    }
    
    // 2. 查动态学习缓存
    let cache = get_cache().read().unwrap();
    if cache.contains(domain) {
        return true;
    }
    
    false
}
