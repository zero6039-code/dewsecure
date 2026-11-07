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
}

impl PslSet {
    fn from_json(json: &str) -> Result<Self, String> {
        #[derive(Deserialize)]
        struct File {
            multi_label_suffixes: Vec<String>,
        }
        let f: File =
            serde_json::from_str(json).map_err(|e| format!("PSL JSON 解析失败: {}", e))?;
        Ok(Self {
            multi: f.multi_label_suffixes.into_iter().collect(),
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
        for n in (2..=labels.len()).rev() {
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
mod tests {
    use super::*;

    fn psl() -> &'static PslSet {
        PslSet::global()
    }

    #[test]
    fn psl_basics() {
        let (s, d, t) = psl().split("google.com");
        assert_eq!((s.as_str(), d.as_str(), t.as_str()), ("", "google.com", "com"));

        let (s, d, t) = psl().split("www.google.com");
        assert_eq!((s.as_str(), d.as_str(), t.as_str()), ("www", "google.com", "com"));

        let (s, d, t) = psl().split("a.b.c.example.com");
        assert_eq!((s.as_str(), d.as_str(), t.as_str()), ("a.b.c", "example.com", "com"));

        let (s, d, t) = psl().split("example.co.uk");
        assert_eq!((s.as_str(), d.as_str(), t.as_str()), ("", "example.co.uk", "co.uk"));

        let (s, d, t) = psl().split("www.example.co.uk");
        assert_eq!((s.as_str(), d.as_str(), t.as_str()), ("www", "example.co.uk", "co.uk"));

        let (s, d, t) = psl().split("test.com.my");
        assert_eq!((s.as_str(), d.as_str(), t.as_str()), ("", "test.com.my", "com.my"));
    }

    #[test]
    fn psl_edge_cases() {
        // 单标签
        let (s, d, t) = psl().split("localhost");
        assert_eq!((s.as_str(), d.as_str(), t.as_str()), ("", "", ""));

        // 空串
        let (s, d, t) = psl().split("");
        assert_eq!((s.as_str(), d.as_str(), t.as_str()), ("", "", ""));
    }

    #[test]
    fn psl_ipv4() {
        // tldextract 5.x：纯 IPv4 三段全空
        let (s, d, t) = psl().split("127.0.0.1");
        assert_eq!((s.as_str(), d.as_str(), t.as_str()), ("", "", ""));
        let (s, d, t) = psl().split("192.168.1.1");
        assert_eq!((s.as_str(), d.as_str(), t.as_str()), ("", "", ""));
        // 非法 IP（256 越界）走 PSL 路径，不被误判为 IP
        let (_s, d, _t) = psl().split("256.1.1.1");
        assert!(!d.is_empty(), "非法 IP 不应被短路，应走 PSL 匹配");
    }
}
