//! 特征提取
//!
//! 从 URL 提取用于 AI 分类器的特征向量。

/// 哈希桶数量（2^14 = 16384）
const NUM_BUCKETS: usize = 16384;

/// 结构化特征数量
const STRUCTURED_FEATURES: usize = 34;

/// 总特征维度
pub const FEATURE_DIM: usize = NUM_BUCKETS + STRUCTURED_FEATURES;

/// 从 URL 提取特征向量
pub fn extract_features(url: &str) -> Vec<f32> {
    let mut features = vec![0.0f32; FEATURE_DIM];

    // 1. 哈希字符 n-gram（n=3）
    let url_lower = url.to_lowercase();
    let chars: Vec<char> = url_lower.chars().collect();
    if chars.len() >= 3 {
        for window in chars.windows(3) {
            let ngram: String = window.iter().collect();
            let hash = fnv1a(ngram.as_bytes()) as usize % NUM_BUCKETS;
            features[hash] += 1.0;
        }
    }

    // 2. 结构化特征
    let offset = NUM_BUCKETS;
    features[offset] = url.len() as f32;
    features[offset + 1] = url.matches('.').count() as f32;
    features[offset + 2] = url.matches('/').count() as f32;
    features[offset + 3] = url.matches('-').count() as f32;
    features[offset + 4] = url.matches('_').count() as f32;
    features[offset + 5] = url.matches('?').count() as f32;
    features[offset + 6] = url.matches('=').count() as f32;
    features[offset + 7] = url.matches('&').count() as f32;
    features[offset + 8] = url.matches('%').count() as f32;

    // 关键词特征
    features[offset + 9] = contains_any(&url_lower, &["ad", "ads", "advert"]) as u8 as f32;
    features[offset + 10] = contains_any(&url_lower, &["track", "tracking"]) as u8 as f32;
    features[offset + 11] = contains_any(&url_lower, &["analytics", "stats"]) as u8 as f32;
    features[offset + 12] = contains_any(&url_lower, &["banner", "banners"]) as u8 as f32;
    features[offset + 13] = contains_any(&url_lower, &["popup", "popunder"]) as u8 as f32;
    features[offset + 14] = contains_any(&url_lower, &["click", "clicks"]) as u8 as f32;
    features[offset + 15] = contains_any(&url_lower, &["pixel", "beacon"]) as u8 as f32;
    features[offset + 16] = contains_any(&url_lower, &["doubleclick", "googlesyndication"]) as u8 as f32;
    features[offset + 17] = contains_any(&url_lower, &["facebook", "fbcdn"]) as u8 as f32;
    features[offset + 18] = contains_any(&url_lower, &["google", "gstatic"]) as u8 as f32;

    // TLD 特征
    features[offset + 19] = url_lower.ends_with(".com") as u8 as f32;
    features[offset + 20] = url_lower.ends_with(".net") as u8 as f32;
    features[offset + 21] = url_lower.ends_with(".org") as u8 as f32;
    features[offset + 22] = url_lower.ends_with(".io") as u8 as f32;
    features[offset + 23] = url_lower.ends_with(".cn") as u8 as f32;

    // 协议特征
    features[offset + 24] = url_lower.starts_with("https") as u8 as f32;
    features[offset + 25] = url_lower.starts_with("http://") as u8 as f32;

    // 数字特征
    let digit_count = url.chars().filter(|c| c.is_ascii_digit()).count();
    features[offset + 26] = digit_count as f32 / url.len().max(1) as f32;

    // 大小写特征
    let uppercase_count = url.chars().filter(|c| c.is_uppercase()).count();
    features[offset + 27] = uppercase_count as f32 / url.len().max(1) as f32;

    // 路径深度
    let path_depth = url.matches('/').count();
    features[offset + 28] = path_depth as f32;

    // 查询参数数量
    let query_count = url.matches('&').count() + url.matches('?').count();
    features[offset + 29] = query_count as f32;

    // 域名长度
    let host_len = url.split('/').nth(2).map(|h| h.len()).unwrap_or(0);
    features[offset + 30] = host_len as f32;

    // 是否包含 IP 地址
    features[offset + 31] = is_ip_address(url) as u8 as f32;

    // 子域名数量
    let subdomain_count = url
        .split('/')
        .nth(2)
        .map(|h| h.matches('.').count().saturating_sub(1))
        .unwrap_or(0);
    features[offset + 32] = subdomain_count as f32;

    // URL 熵（随机性指标）
    features[offset + 33] = calculate_entropy(&url_lower);

    features
}

/// FNV-1a 哈希
fn fnv1a(data: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in data {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn contains_any(s: &str, keywords: &[&str]) -> bool {
    keywords.iter().any(|kw| s.contains(kw))
}

fn is_ip_address(url: &str) -> bool {
    let host = url
        .split('/')
        .nth(2)
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("");
    host.split('.').count() == 4 && host.split('.').all(|p| p.parse::<u8>().is_ok())
}

fn calculate_entropy(s: &str) -> f32 {
    if s.is_empty() {
        return 0.0;
    }
    let mut freq = [0u32; 256];
    for b in s.bytes() {
        freq[b as usize] += 1;
    }
    let len = s.len() as f32;
    let mut entropy = 0.0;
    for &f in &freq {
        if f > 0 {
            let p = f as f32 / len;
            entropy -= p * p.log2();
        }
    }
    entropy
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_features() {
        let features = extract_features("https://doubleclick.net/ad");
        assert_eq!(features.len(), FEATURE_DIM);
        // 应该包含 "doubleclick" 关键词特征
        assert!(features[NUM_BUCKETS + 16] > 0.0);
    }

    #[test]
    fn test_feature_dimension() {
        let features = extract_features("https://example.com");
        assert_eq!(features.len(), FEATURE_DIM);
    }
}
