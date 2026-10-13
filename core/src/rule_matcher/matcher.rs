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
    /// 例外规则
    exception_patterns: HashSet<String>,
    /// 所有规则
    all_rules: Vec<FilterRule>,
}

impl RuleMatcher {
    pub fn new(rules: Vec<FilterRule>) -> Self {
        let mut generic_patterns = Vec::new();
        let mut domain_rules: HashMap<String, Vec<FilterRule>> = HashMap::new();
        let mut exception_patterns = HashSet::new();

        for rule in &rules {
            if rule.is_exception {
                exception_patterns.insert(normalize_pattern(&rule.pattern));
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
                generic_patterns.push(normalize_pattern(&rule.pattern));
            }
        }

        // 构建 Aho-Corasick 自动机
        let generic_ac = if generic_patterns.is_empty() {
            None
        } else {
            AhoCorasick::builder()
                .ascii_case_insensitive(true)
                .build(&generic_patterns)
                .ok()
        };

        Self {
            generic_ac,
            generic_patterns,
            domain_rules,
            exception_patterns,
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
        let host = extract_host(url);
        if let Some(host) = host {
            // 检查所有可能的域名后缀
            for (domain, rules) in &self.domain_rules {
                if host.ends_with(domain.as_str()) || host == *domain {
                    for rule in rules {
                        if url.contains(&normalize_pattern(&rule.pattern)) {
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
        for pattern in &self.exception_patterns {
            if url.contains(pattern) {
                return true;
            }
        }
        false
    }

    /// 添加规则
    pub fn add_rule(&mut self, rule: FilterRule) {
        if rule.is_exception {
            self.exception_patterns
                .insert(normalize_pattern(&rule.pattern));
        } else if rule.domains.is_empty() {
            self.generic_patterns.push(normalize_pattern(&rule.pattern));
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
        .to_string()
}

/// 从 URL 提取主机名
fn extract_host(url: &str) -> Option<String> {
    let url = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .or_else(|| url.strip_prefix("//"))
        .unwrap_or(url);

    let host = url.split('/').next()?;
    let host = host.split(':').next()?;

    if host.is_empty() {
        None
    } else {
        Some(host.to_lowercase())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_host() {
        assert_eq!(
            extract_host("https://example.com/path"),
            Some("example.com".to_string())
        );
        assert_eq!(
            extract_host("http://sub.example.com:8080/"),
            Some("sub.example.com".to_string())
        );
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
    }
}
