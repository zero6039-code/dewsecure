//! 高效规则匹配器

use crate::FilterRule;
use aho_corasick::AhoCorasick;
use std::collections::{HashMap, HashSet};

pub struct RuleMatcher {
    /// 通用规则（使用 Aho-Corasick 加速）
    generic_ac: Option<AhoCorasick>,
    /// 构建 AC 自动机时对应的源模式串
    generic_patterns: Vec<String>,
    /// 动态追加的通用规则（批次重建前暂存于此）
    dynamic_patterns: Vec<String>,
    /// 纯域名拦截 HashSet（O(1) 查找）
    blocked_hosts: HashSet<String>,
    /// 包含路径或参数限制的域名规则
    domain_rules: HashMap<String, Vec<FilterRule>>,
    /// 例外域名
    exception_hosts: HashSet<String>,
    /// 所有规则
    all_rules: Vec<FilterRule>,
}

impl RuleMatcher {
    pub fn new(rules: Vec<FilterRule>) -> Self {
        let mut generic_patterns = Vec::new();
        let mut domain_rules: HashMap<String, Vec<FilterRule>> = HashMap::new();
        let mut blocked_hosts = HashSet::new();
        let mut exception_hosts = HashSet::new();

        for rule in &rules {
            let pat = normalize_pattern(&rule.pattern);
            if pat.is_empty() {
                continue;
            }

            if rule.is_exception {
                exception_hosts.insert(pat);
                continue;
            }

            if !rule.domains.is_empty() {
                for domain in &rule.domains {
                    domain_rules
                        .entry(domain.clone())
                        .or_default()
                        .push(rule.clone());
                }
            } else if pat.starts_with("||") && pat.ends_with("^") && !pat.contains('/') && !pat.contains('*') {
                // 🛡️ P-7 优化：纯域名锚点直接扔进 HashSet，实现 O(1) 查找
                let domain = pat.trim_start_matches("||").trim_end_matches('^').trim_end_matches('|').to_string();
                if !domain.is_empty() {
                    blocked_hosts.insert(domain);
                }
            } else {
                generic_patterns.push(normalize_pattern(&pat));
            }
        }

        let generic_ac = if generic_patterns.is_empty() {
            None
        } else {
            Some(
                AhoCorasick::builder()
                    .ascii_case_insensitive(true)
                    .build(&generic_patterns)
                    .expect("FATAL: 核心通用规则自动机构建失败，无法继续提供防护")
            )
        };

        Self {
            generic_ac,
            generic_patterns,
            dynamic_patterns: Vec::new(),
            blocked_hosts,
            domain_rules,
            exception_hosts,
            all_rules: rules,
        }
    }

    /// 判断 URL 是否匹配任何拦截规则
    pub fn matches(&self, url: &str) -> bool {
        // 1. 检查静态通用规则
        if let Some(ac) = &self.generic_ac {
            if ac.is_match(url) {
                return true;
            }
        }

        // 2. 检查动态添加的通用规则 (未满一阈值前走线性)
        for pat in &self.dynamic_patterns {
            if url.contains(pat) {
                return true;
            }
        }

        // 3. 快速后缀匹配（零内存分配）
        if let Some(host) = extract_host(url) {
            // 3.1 先查纯域名 HashSet
            if self.blocked_hosts.contains(&host) {
                return true;
            }

            // 3.2 按标签从右向左走后缀
            let mut start_idx = 0;
            let len = host.len();
            for (i, c) in host.char_indices() {
                if c == '.' || i == len - 1 {
                    // 截取当前后缀并检查是否在 blocked_hosts 中
                    let suffix = &host[start_idx..];
                    if self.blocked_hosts.contains(suffix) {
                        return true;
                    }
                    // 检查 domain_rules (带路径)
                    if let Some(rules) = self.domain_rules.get(suffix) {
                        for rule in rules {
                            let pat = normalize_pattern(&rule.pattern);
                            let clean_pat = pat.trim_start_matches("||").trim_end_matches('^').trim_end_matches('|');
                            if clean_pat.is_empty() || url.contains(clean_pat) {
                                return true;
                            }
                        }
                    }
                    if c == '.' {
                        start_idx = i + 1;
                    }
                }
            }
        }
        false
    }

    /// 判断 URL 是否匹配例外规则
    pub fn is_exception(&self, url: &str) -> bool {
        if let Some(host) = extract_host(url) {
            return self.exception_hosts.iter().any(|d| host_matches(&host, d));
        }
        false
    }

    /// 添加规则
    pub fn add_rule(&mut self, rule: FilterRule) {
        let pat = normalize_pattern(&rule.pattern);
        if pat.is_empty() {
            return;
        }

        if rule.is_exception {
            self.exception_hosts.insert(pat);
        } else if !rule.domains.is_empty() {
            for domain in &rule.domains {
                self.domain_rules
                    .entry(domain.clone())
                    .or_default()
                    .push(rule.clone());
            }
        } else if pat.starts_with("||") && pat.ends_with("^") && !pat.contains('/') && !pat.contains('*') {
            let domain = pat.trim_start_matches("||").trim_end_matches('^').trim_end_matches('|').to_string();
            if !domain.is_empty() {
                self.blocked_hosts.insert(domain);
            }
        } else {
            // 🛡️ P-7 修复：动态规则积攒到一定阈值后，批量重建 Aho-Corasick
            self.dynamic_patterns.push(pat.clone());
            self.generic_patterns.push(pat);

            const REBUILD_THRESHOLD: usize = 50;
            if self.dynamic_patterns.len() >= REBUILD_THRESHOLD {
                // 重建 AC 自动机（一次性构建）
                self.generic_ac = Some(
                    AhoCorasick::builder()
                        .ascii_case_insensitive(true)
                        .build(&self.generic_patterns)
                        .expect("FATAL: 动态规则自动机重建失败")
                );
                self.dynamic_patterns.clear();
            }
        }
        self.all_rules.push(rule);
    }

    pub fn get_rules(&self) -> Vec<FilterRule> {
        self.all_rules.clone()
    }

    pub fn len(&self) -> usize {
        self.all_rules.len()
    }

    pub fn is_empty(&self) -> bool {
        self.all_rules.is_empty()
    }
}

/// 标准化模式（保留锚点语义）
fn normalize_pattern(pattern: &str) -> String {
    pattern.trim().to_string()
}

/// 从 URL 提取主机名
fn extract_host(url: &str) -> Option<String> {
    let rest = match url.find("://").filter(|&i| url[..i].chars().all(|c| c.is_ascii_alphanumeric() || "+-.".contains(c))) {
        Some(i) => &url[i + 3..],
        None => url.strip_prefix("//").unwrap_or(url),
    };
    let end = rest.find(|c| matches!(c, '/' | '?' | '#' | '\\')).unwrap_or(rest.len());
    let hostport = rest[..end].rsplit('@').next()?;
    let host = if let Some(inner) = hostport.strip_prefix('[') {
        inner.split(']').next()?
    } else {
        match hostport.rsplit_once(':') {
            Some((h, p)) if !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()) => h,
            _ => hostport,
        }
    };
    let host = host.trim_end_matches('.');
    (!host.is_empty()).then(|| host.to_ascii_lowercase())
}

/// 检查 host 是否等于域名或为其子域名
fn host_matches(host: &str, domain: &str) -> bool {
    let clean_domain = domain.trim_start_matches('.');
    host == clean_domain || host.ends_with(&format!(".{}", clean_domain))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_host() {
        assert_eq!(extract_host("https://example.com/path"), Some("example.com".to_string()));
        assert_eq!(extract_host("http://sub.example.com:8080/"), Some("sub.example.com".to_string()));
        assert_eq!(extract_host("https://user:pass@evil.com/path"), Some("evil.com".to_string()));
        assert_eq!(extract_host("https://evil.com?x=@example.com/"), Some("evil.com".to_string()));
        assert_eq!(extract_host("http://[::1]:80/"), Some("::1".to_string()));
    }

    #[test]
    fn test_c4_domain_anchor_prevents_false_positive() {
        let rules = vec![
            FilterRule {
                pattern: "||ads.com^".to_string(),
                is_exception: false,
                resource_types: vec![],
                domains: vec![],
                third_party: None,
            },
        ];
        let matcher = RuleMatcher::new(rules);

        assert!(matcher.matches("https://ads.com/banner.jpg"), "应拦截 ads.com");
        assert!(matcher.matches("https://sub.ads.com/banner.jpg"), "应拦截 sub.ads.com");
        assert!(!matcher.matches("https://roads.com/banner.jpg"), "绝不能误杀 roads.com");
        assert!(!matcher.matches("https://myads.company.com/banner.jpg"), "绝不能误杀 myads.company.com");
    }

    #[test]
    fn test_p7_dynamic_rebuild() {
        let mut matcher = RuleMatcher::new(vec![]);
        
        // 添加 60 条动态通用规则，触发自动机重建
        for i in 0..60 {
            matcher.add_rule(FilterRule {
                pattern: format!("malicious-tracker-{}.com/track", i),
                is_exception: false,
                resource_types: vec![],
                domains: vec![],
                third_party: None,
            });
        }

        // 第 50 条时已经合并进了 Aho-Corasick
        assert!(matcher.dynamic_patterns.len() < 50, "动态规则数量应低于阈值");
        
        // 匹配应能命中重建后的 AC
        assert!(matcher.matches("https://malicious-tracker-5.com/track?id=1"));
        assert!(!matcher.matches("https://safe.com/"));
    }
}
