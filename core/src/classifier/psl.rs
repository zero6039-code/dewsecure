//! 简化 PSL（Public Suffix List）匹配器。
//!
//! 对齐 Python `tldextract.extract()` 的语义：
//!   - `subdomain`      : 注册域之前的所有标签（点分隔）
//!   - `registered_domain` : `sld + '.' + suffix`
//!   - `suffix`         : 多标签后缀（如 `co.uk`）或单标签（如 `com`）
//!
//! 数据源：`shared/phishing/psl.json`（编译时 include_str，无运行时文件依赖）。
//! 只含常见二阶后缀，罕见后缀会误判为单标签 → 记录在 tech-debt。

use serde::Deserialize;
use std::collections::HashSet;
use std::sync::OnceLock;

pub struct PslSet {
    multi: HashSet<String>,
    max_suffix_len: usize, // 🛡️ C-10 修复：记录最长后缀标签数，防止 O(L²)
}

impl PslSet {
    fn from_json(json: &str) -> Result<Self, String> {
        #[derive(Deserialize)]
        struct File {
            multi_label_suffixes: Vec<String>,
        }
        let f: File =
            serde_json::from_str(json).map_err(|e| format!("PSL JSON 解析失败: {}", e))?;
        let mut max_suffix_len = 1;
        for s in &f.multi_label_suffixes {
            let len = s.split('.').count();
            if len > max_suffix_len {
                max_suffix_len = len;
            }
        }
        Ok(Self {
            multi: f.multi_label_suffixes.into_iter().collect(),
            max_suffix_len,
        })
    }

    pub fn global() -> &'static PslSet {
        static PSL: OnceLock<PslSet> = OnceLock::new();
        PSL.get_or_init(|| {
            const PSL_JSON: &str =
                include_str!("../../../shared/phishing/psl.json");
            Self::from_json(PSL_JSON).expect("PSL 解析失败")
        })
    }

    /// 返回 (subdomain, registered_domain, suffix)。
    /// 与 `tldextract.extract().subdomain/registered_domain/suffix` 一致。
    /// 空字符串表示不存在。
    pub fn split(&self, host: &str) -> (String, String, String) {
        // tldextract 5.x 对纯 IPv4 的特殊处理：subdomain='', domain=host, suffix=''
        // 参考 tldextract/tldextract.py 的 IP 分支，不走 PSL 匹配。
        // tldextract 5.x 对纯 IPv4 返回 (subdomain="", domain="", suffix="")，
        // 不是 (subdomain="", domain=host, suffix="")。
        // 从 golden 反推：dim[29] `domain in path` 对 `127.0.0.1` + path='/login'
        // 需为 1，只有 domain="" 满足（"" 是 path 的子串）。
        if is_ipv4(host) {
            return (String::new(), String::new(), String::new());
        }
        let labels: Vec<&str> = host.split('.').filter(|s| !s.is_empty()).collect();
        if labels.is_empty() {
            return (String::new(), String::new(), String::new());
        }
        if labels.len() == 1 {
            // 单标签：无后缀、无注册域
            return (String::new(), String::new(), String::new());
        }

        // 最长多标签后缀匹配
        let mut suffix_len = 1usize;
        // 🛡️ C-10 修复：最大只检查到 max_suffix_len，不再遍历整个 labels
        let check_limit = labels.len().min(self.max_suffix_len);
        for n in (2..=check_limit).rev() {
            let candidate = labels[labels.len() - n..].join(".");
            if self.multi.contains(&candidate) {
                suffix_len = n;
                break;
            }
        }

        if suffix_len >= labels.len() {
            return (String::new(), String::new(), labels.join("."));
        }

        let suffix = labels[labels.len() - suffix_len..].join(".");
        let sld = labels[labels.len() - suffix_len - 1];
        let registered = format!("{}.{}", sld, suffix);
        let subdomain = labels[..labels.len() - suffix_len - 1].join(".");
        (subdomain, registered, suffix)
    }
}

/// IPv4 检测（与 phishing_features::is_ipv4_host 语义一致）。
/// 只用于 PSL 内部的 IP 短路，不与 classifier 主逻辑共享。
fn is_ipv4(s: &str) -> bool {
    let parts: Vec<&str> = s.split('.').collect();
    if parts.len() != 4 {
        return false;
    }
    parts.iter().all(|p| {
        !p.is_empty()
            && p.len() <= 3
            && p.chars().all(|c| c.is_ascii_digit())
            && p.parse::<u32>().map_or(false, |n| n <= 255)
    })
}


#[cfg(test)]
#[path = "psl_test.rs"]
mod tests;
