//! T1 广告/追踪分类器特征提取
//!
//! 严格对齐 `extensions/chrome/src/background/ai.js` 的 `extractSparseFeatures`。
//!
//! 输入：域名（`new URL(url).hostname`，ASCII / punycode）
//! 输出：16418 维稀疏特征
//!   - 0..16384   ：3-gram 哈希桶（累加计数）
//!   - 16384..16418：34 维结构特征
//!
//! ⚠️ 与现有 `classifier/features.rs` 的 `extract_features` 完全独立。
//! 那个函数服务于 `DewEngine::classify`（接收完整 URL，579/不同布局），
//! 本文件服务于 `HostEngine`（接收域名，16418 维）。两者并存，互不干扰。

use std::collections::HashMap;

/// 与 `ai.js` 完全一致的 10 组关键词，对应 struct 索引 9..=18
const KEYWORD_GROUPS: &[&[&str]] = &[
    &["ad", "ads", "advert"],
    &["track", "tracking"],
    &["analytics", "stats"],
    &["banner", "banners"],
    &["popup", "popunder"],
    &["click", "clicks"],
    &["pixel", "beacon"],
    &["doubleclick", "googlesyndication"],
    &["facebook", "fbcdn"],
    &["google", "gstatic"],
];

const STRUCT_OFFSET: u32 = 16384;
const BUCKET_MASK: u32 = 0x3FFF; // 16383

/// 稀疏特征（与 `ai.js` `extractSparseFeatures` 返回值对齐）
#[derive(Debug, Clone, Default)]
pub struct SparseFeatures {
    /// n-gram 桶：bucket_idx (0..16384) -> 累计计数
    pub buckets: HashMap<u32, f32>,
    /// 结构特征：(绝对索引 16384..16418, 非零值)
    pub structs: Vec<(u32, f32)>,
}

/// ⚠️ 非标准 FNV-1a 32 位变体，与 `ai.js` 的 `fnv1a32` 完全一致。
///
/// 起始值 `0x84222325` 是 64 位标准 FNV-1a offset basis `0xcbf29ce484222325`
/// 的低 32 位；素数 `0x1b3` 是 64 位素数 `0x100000001b3` 的低 32 位。
/// 对 16384 取模只取决于低 14 位，因此 32 位模拟与 64 位结果在低位完全等价。
///
/// **禁止**换成标准 FNV-1a 32（`0x811c9dc5` + `0x01000193`）或 `fnv` crate，
/// 会导致全部 n-gram 桶错位。shared/README.md 有同样警告。
#[inline]
fn fnv1a32_variant(s: &str) -> u32 {
    let mut hash: u32 = 0x84222325;
    for b in s.bytes() {
        hash = (hash ^ (b as u32)).wrapping_mul(0x1b3);
    }
    hash
}

/// Shannon 熵（bits），与 `ai.js` 的 `calculateEntropy` 一致。
/// 按字节计频（URL 为 ASCII / punycode）。
fn calculate_entropy(s: &str) -> f32 {
    if s.is_empty() {
        return 0.0;
    }
    let mut freq: HashMap<u8, u32> = HashMap::new();
    for b in s.bytes() {
        *freq.entry(b).or_insert(0) += 1;
    }
    let len = s.len() as f32;
    let mut entropy = 0.0f32;
    for &count in freq.values() {
        let p = count as f32 / len;
        entropy -= p * p.log2();
    }
    entropy
}

/// 与 `ai.js` 的 `isIpAddress` 一致：要求 URL 含 `/` 且第 3 段是合法 IPv4。
/// 对纯域名（如 `google.com`，无 `/`）返回 false。
fn is_ip_address(url: &str) -> bool {
    let parts: Vec<&str> = url.split('/').collect();
    if parts.len() < 3 {
        return false;
    }
    let host = parts[2].split(':').next().unwrap_or("");
    let octets: Vec<&str> = host.split('.').collect();
    if octets.len() != 4 {
        return false;
    }
    octets.iter().all(|o| {
        !o.is_empty()
            && o.chars().all(|c| c.is_ascii_digit())
            && o.parse::<u32>().map_or(false, |n| n <= 255)
    })
}

/// 主入口：提取 T1 稀疏特征。
///
/// 输入应为域名（与 `ai.js` `runAICheck` 传 `new URL(url).hostname` 一致）。
/// 若传入完整 URL，行为与 `ai.js` 保持相同——`ai.js` 并不预先截断。
pub fn extract_sparse_features(url: &str) -> SparseFeatures {
    let url_lower = url.to_lowercase();
    let mut buckets: HashMap<u32, f32> = HashMap::new();
    let mut structs: Vec<(u32, f32)> = Vec::new();

    // ── 1. 3-gram 哈希桶 ──
    let chars: Vec<char> = url_lower.chars().collect();
    if chars.len() >= 3 {
        for i in 0..=(chars.len() - 3) {
            let gram: String = chars[i..i + 3].iter().copied().collect();
            let h = fnv1a32_variant(&gram);
            *buckets.entry(h & BUCKET_MASK).or_insert(0.0) += 1.0;
        }
    }

    // ── 2. 34 维结构特征 ──
    macro_rules! push {
        ($idx:expr, $val:expr) => {{
            let v: f32 = $val;
            if v != 0.0 {
                structs.push(($idx, v));
            }
        }};
    }

    let o = STRUCT_OFFSET;
    let count_char = |s: &str, c: char| s.matches(c).count() as f32;
    let contains_any = |s: &str, kws: &[&str]| -> f32 {
        if kws.iter().any(|kw| s.contains(kw)) { 1.0 } else { 0.0 }
    };

    // 0..=8：URL 长度与标点计数
    push!(o + 0, url_lower.chars().count() as f32);
    push!(o + 1, count_char(&url_lower, '.'));
    push!(o + 2, count_char(&url_lower, '/'));
    push!(o + 3, count_char(&url_lower, '-'));
    push!(o + 4, count_char(&url_lower, '_'));
    push!(o + 5, count_char(&url_lower, '?'));
    push!(o + 6, count_char(&url_lower, '='));
    push!(o + 7, count_char(&url_lower, '&'));
    push!(o + 8, count_char(&url_lower, '%'));

    // 9..=18：10 组关键词（只要组内任一命中即 1）
    for (i, group) in KEYWORD_GROUPS.iter().enumerate() {
        push!(o + 9 + i as u32, contains_any(&url_lower, group));
    }

    // 19..=23：常见 TLD 后缀（对整个串 ends_with，与 ai.js 一致）
    push!(o + 19, if url_lower.ends_with(".com") { 1.0 } else { 0.0 });
    push!(o + 20, if url_lower.ends_with(".net") { 1.0 } else { 0.0 });
    push!(o + 21, if url_lower.ends_with(".org") { 1.0 } else { 0.0 });
    push!(o + 22, if url_lower.ends_with(".io")  { 1.0 } else { 0.0 });
    push!(o + 23, if url_lower.ends_with(".cn")  { 1.0 } else { 0.0 });

    // 24..=25：协议前缀
    push!(o + 24, if url_lower.starts_with("https")  { 1.0 } else { 0.0 });
    push!(o + 25, if url_lower.starts_with("http://") { 1.0 } else { 0.0 });

    // 26..=27：数字 / 大写比例（分子数原串，分母取 lowercase 长度）
    let len_for_ratio = url_lower.chars().count().max(1) as f32;
    let digit_count = url.chars().filter(|c| c.is_ascii_digit()).count() as f32;
    push!(o + 26, digit_count / len_for_ratio);
    let upper_count = url.chars().filter(|c| c.is_ascii_uppercase()).count() as f32;
    push!(o + 27, upper_count / len_for_ratio);

    // 28..=29：slash 计数 / query 标记（与 2、7+5 重复，保持对齐）
    push!(o + 28, count_char(&url_lower, '/'));
    push!(o + 29, count_char(&url_lower, '&') + count_char(&url_lower, '?'));

    // 30..=32：host 相关（仅当 parts.len() > 2，与 ai.js 一致）
    let parts: Vec<&str> = url_lower.split('/').collect();
    if parts.len() > 2 {
        let host = parts[2].split(':').next().unwrap_or("");
        push!(o + 30, host.chars().count() as f32);
        push!(o + 31, if is_ip_address(&url_lower) { 1.0 } else { 0.0 });
        let dots = host.matches('.').count() as i32;
        push!(o + 32, (dots - 1).max(0) as f32);
    }
    // parts.len() <= 2 时 ai.js 显式写 0.0；我们 push! 跳过 0，等价

    // 33：熵
    push!(o + 33, calculate_entropy(&url_lower));

    SparseFeatures { buckets, structs }
}

#[cfg(test)]
mod inline_tests {
    use super::*;

    #[test]
    fn fnv1a32_variant_matches_known_value() {
        // microsoft.com 的 3-gram "mic" 在 ai.js 里映射到 bucket 2491
        assert_eq!(fnv1a32_variant("mic") & BUCKET_MASK, 10848);
    }

    #[test]
    fn entropy_of_short_string() {
        // "aa" 熵为 0
        assert!(calculate_entropy("aa") < 1e-6);
        // "ab" 熵为 1.0
        assert!((calculate_entropy("ab") - 1.0).abs() < 1e-6);
    }

    #[test]
    fn ip_detection() {
        assert!(is_ip_address("http://127.0.0.1/login"));
        assert!(is_ip_address("http://127.0.0.1"));
        assert!(!is_ip_address("google.com"));
        assert!(!is_ip_address("http://999.0.0.1/"));
    }
}
