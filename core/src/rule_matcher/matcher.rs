//! 高效规则匹配器

use crate::FilterRule;
use aho_corasick::AhoCorasick;
use std::collections::{HashMap, HashSet};

pub struct RuleMatcher {
    /// 通用规则（使用 Aho-Corasick 加速）
    generic_ac: Option<AhoCorasick>,
    /// 动态追加的通用规则（避免每次 add_rule 都重建整个 AC）
    dynamic_patterns: Vec<String>,
    /// 域名限定规则
    domain_rules: HashMap<String, Vec<FilterRule>>,
    /// 例外域名（H-7 修复：仅存纯域名）
    exception_hosts: HashSet<String>,
    /// 所有规则
    all_rules: Vec<FilterRule>,
}

impl RuleMatcher {
    pub fn new(rules: Vec<FilterRule>) -> Self {
        let mut generic_patterns = Vec::new();
        let mut domain_rules: HashMap<String, Vec<FilterRule>> = HashMap::new();
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
                // 🛡️ C-4 修复：纯域名锚点如 ||ads.com^，提取域名精确匹配，防止误杀 roads.com
                let domain = pat.trim_start_matches("||").trim_end_matches('^').trim_end_matches('|').to_string();
                if !domain.is_empty() {
                    domain_rules.entry(domain).or_default().push(rule.clone());
                }
            } else {
                generic_patterns.push(normalize_pattern(&pat));
            }
        }

        // 🛡️ C-5 修复：拒绝 Fail-Open，如果自动机构建失败，直接 panic（交由 UniFFI catch_unwind 捕获）
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
            dynamic_patterns: Vec::new(),
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
        
        // 2. 检查动态添加的通用规则
        for pat in &self.dynamic_patterns {
            if url.contains(pat) {
                return true;
            }
        }

        // 3. 🛡️ C-5 修复：O(域名层数) 快速后缀匹配，不再 O(N) 遍历整个 HashMap
        if let Some(host) = extract_host(url) {
            let mut current = String::new();
            // 从后往前拼接域名，如 sub.ads.com -> 依次检查 com, ads.com, sub.ads.com
            let parts: Vec<&str> = host.split('.').collect();
            for i in (0..parts.len()).rev() {
                if i == parts.len() - 1 {
                    current = parts[i].to_string();
                } else {
                    current = format!("{}.{}", parts[i], current);
                }
                
                if let Some(rules) = self.domain_rules.get(&current) {
                    for rule in rules {
                        let pat = normalize_pattern(&rule.pattern);
                        // 如果是纯域名锚点，直接命中
                        if pat.starts_with("||") && pat.ends_with("^") && !pat.contains('/') && !pat.contains('*') {
                            return true;
                        }
                        // 如果是路径匹配
                        let clean_pat = pat.trim_start_matches("||").trim_end_matches('^').trim_end_matches('|');
                        if clean_pat.is_empty() || url.contains(clean_pat) {
                            return true;
                        }
                    }
                }
            }
        }
        false
    }

    /// 判断 URL 是否匹配例外规则
    pub fn is_exception(&self, url: &str) -> bool {
        if let Some(host) = extract_host(url) {
            // C-4 修复说明保留，未来可升级为存储 FilterRule 对象
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
                self.domain_rules.entry(domain).or_default().push(rule.clone());
            }
        } else {
            // 🛡️ C-5 修复：动态规则不再触发全量重建 O(N²)，直接存入动态列表，在 matches 中线性检查
            self.dynamic_patterns.push(pat);
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
    fn test_c5_dynamic_add_rule_no_rebuild() {
        // 测试动态追加通用规则不会引发全量重建，且能正常生效
        let mut matcher = RuleMatcher::new(vec![]);
        
        // 添加一条动态通用规则
        matcher.add_rule(FilterRule {
            pattern: "malicious-tracker-xyz.com/track".to_string(),
            is_exception: false,
            resource_types: vec![],
            domains: vec![],
            third_party: None,
        });

        assert!(matcher.matches("https://malicious-tracker-xyz.com/track?id=1"));
        assert!(!matcher.matches("https://safe.com/"));
    }
}
