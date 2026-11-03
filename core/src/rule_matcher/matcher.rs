//! 高效规则匹配器

use crate::FilterRule;
use aho_corasick::AhoCorasick;
use std::collections::{HashMap, HashSet};

pub struct RuleMatcher {
    /// 通用规则（使用 Aho-Corasick 加速）
    generic_ac: Option<AhoCorasick>,
    generic_patterns: Vec<String>,
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
            // H-7 修复：过滤 normalize 后的空模式
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
            } else {
                generic_patterns.push(pat);
            }
        }

        // 构建 Aho-Corasick 自动机
        let generic_ac = if generic_patterns.is_empty() {
            None
        } else {
            AhoCorasick::builder()
                .ascii_case_insensitive(true)
                .build(&generic_patterns)
                .ok() // 纯字符串构建，极难失败，保留 ok() 是安全的
        };

        Self {
            generic_ac,
            generic_patterns,
            domain_rules,
            exception_hosts,
            all_rules: rules,
        }
    }

    /// 判断 URL 是否匹配任何拦截规则
    pub fn matches(&self, url: &str) -> bool {
        // 1. 检查通用规则
        if let Some(ac) = &self.generic_ac {
            if ac.is_match(url) {
                return true;
            }
        }

        // 2. 检查域名限定规则
        if let Some(host) = extract_host(url) {
            for (domain, rules) in &self.domain_rules {
                if host_matches(&host, domain) {
                    for rule in rules {
                        // 如果规则本身有特殊 pattern（如路径），用原本逻辑
                        let pat = normalize_pattern(&rule.pattern);
                        if pat.is_empty() || url.contains(&pat) {
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
        // H-7 修复：例外规则仅针对 host 进行后缀匹配，禁止对整个 URL 做子串匹配
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
        } else if rule.domains.is_empty() {
            self.generic_patterns.push(pat);
            // 重新构建 Aho-Corasick
            self.generic_ac = AhoCorasick::builder()
                .ascii_case_insensitive(true)
                .build(&self.generic_patterns)
                .ok();
        } else {
            for domain in &rule.domains {
                self.domain_rules
                    .entry(domain.clone())
                    .or_default()
                    .push(rule.clone());
            }
        }
        self.all_rules.push(rule);
    }

    /// 获取所有规则
    pub fn get_rules(&self) -> Vec<FilterRule> {
        self.all_rules.clone()
    }

    /// 规则数量
    pub fn len(&self) -> usize {
        self.all_rules.len()
    }

    pub fn is_empty(&self) -> bool {
        self.all_rules.is_empty()
    }
}

/// 标准化模式（移除 Adblock 特有语法）
fn normalize_pattern(pattern: &str) -> String {
    pattern
        .trim_start_matches("||")
        .trim_end_matches('^')
        .trim_end_matches('|')
        .trim()
        .to_string()
}

/// 从 URL 提取主机名
fn extract_host(url: &str) -> Option<String> {
    // H-7 修复：先剥离协议，再处理 userinfo (user:pass@host)，最后去端口和路径
    let url_no_scheme = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .or_else(|| url.strip_prefix("//"))
        .unwrap_or(url);

    // 分离 userinfo 与 host
    let host_part = url_no_scheme.split('/').next()?;
    let host_no_user = host_part.split('@').last()?;
    let host = host_no_user.split(':').next()?;

    if host.is_empty() {
        None
    } else {
        Some(host.trim_end_matches('.').to_lowercase())
    }
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
        // H-7 测试新增：处理 userinfo
        assert_eq!(extract_host("https://user:pass@evil.com/path"), Some("evil.com".to_string()));
    }

    #[test]
    fn test_matcher() {
        let rules = vec![
            FilterRule {
                pattern: "doubleclick.net".to_string(),
                is_exception: false,
                resource_types: vec![],
                domains: vec![],
            },
            FilterRule {
                pattern: "example.com".to_string(),
                is_exception: true,
                resource_types: vec![],
                domains: vec![],
            },
        ];

        let matcher = RuleMatcher::new(rules);
        assert!(matcher.matches("https://doubleclick.net/ad"));
        assert!(matcher.is_exception("https://example.com/page"));
        assert!(matcher.is_exception("https://sub.example.com/page"));
        
        // H-7 测试新增：不能被 ?r=.example.com 绕过
        assert!(!matcher.is_exception("https://evil.com/?r=.example.com"));
    }
}
