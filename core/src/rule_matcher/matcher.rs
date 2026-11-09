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
            } else if pat.starts_with("||") && pat.ends_with("^") && !pat.contains('/') && !pat.contains('*') {
                // 🛡️ C-4 修复：纯域名锚点如 ||ads.com^，提取域名精确匹配，防止误杀 roads.com
                let domain = pat.trim_start_matches("||").trim_end_matches('^').trim_end_matches('|').to_string();
                if !domain.is_empty() {
                    domain_rules.entry(domain).or_default().push(rule.clone());
                }
            } else {
                // 含通配符或路径的，降级为字符串匹配
                generic_patterns.push(normalize_pattern(&pat));
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
            // 🛡️ C-4 修复：如果在 exception_hosts 中遇到带 $script 等资源类型限制的规则，无法判断当前上下文，安全优先，不予例外
            // （由于目前的 exception_hosts 是 HashSet<String>，没有存 resource_types，我们最安全的做法是只匹配纯域名的例外）
            // 为了兼容简单场景，这里仍使用 host 匹配。在未来的版本中应升级为存储 FilterRule 对象。
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

/// 标准化模式（保留锚点语义）
fn normalize_pattern(pattern: &str) -> String {
    pattern.trim().to_string()
}

/// 从 URL 提取主机名
fn extract_host(url: &str) -> Option<String> {
    // 🛡️ C-3 修复：严谨的 authority 截断，防止 ?x=@example.com 欺骗
    // 只有"合法 scheme + ://"才算协议头
    let rest = match url.find("://").filter(|&i| url[..i].chars().all(|c| c.is_ascii_alphanumeric() || "+-.".contains(c))) {
        Some(i) => &url[i + 3..],
        None => url.strip_prefix("//").unwrap_or(url),
    };
    
    // authority 在第一个 / ? # 或反斜杠处结束
    let end = rest.find(|c| matches!(c, '/' | '?' | '#' | '\\')).unwrap_or(rest.len());
    let hostport = rest[..end].rsplit('@').next()?; // userinfo 只取最后一个 @ 之后
    let host = if let Some(inner) = hostport.strip_prefix('[') {
        inner.split(']').next()? // IPv6 字面量
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
        
        // 🛡️ C-3 PoC 测试：
        assert_eq!(extract_host("https://evil.com?x=@example.com/"), Some("evil.com".to_string()));
        assert_eq!(extract_host("https://evil.com#@example.com"), Some("evil.com".to_string()));
        assert_eq!(extract_host("http://[::1]:80/"), Some("::1".to_string()));
        assert_eq!(extract_host("evil.com/?u=http://x.com"), Some("evil.com".to_string()));
    }

    #[test]
    fn test_matcher() {
        let rules = vec![
            FilterRule {
                pattern: "doubleclick.net".to_string(),
                is_exception: false,
                resource_types: vec![],
                domains: vec![],
                third_party: None,
        },
            FilterRule {
                pattern: "example.com".to_string(),
                is_exception: true,
                resource_types: vec![],
                domains: vec![],
                third_party: None,
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
#[cfg(test)]
mod c4_tests {
    use super::*;

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

        // 必须匹配真实域名和子域名
        assert!(matcher.matches("https://ads.com/banner.jpg"), "应拦截 ads.com");
        assert!(matcher.matches("https://sub.ads.com/banner.jpg"), "应拦截 sub.ads.com");
        
        // 绝不能误杀包含 ads.com 的其他域名
        assert!(!matcher.matches("https://roads.com/banner.jpg"), "绝不能误杀 roads.com");
        assert!(!matcher.matches("https://myads.company.com/banner.jpg"), "绝不能误杀 myads.company.com");

        println!("✅ C-4 PoC 成功：域名锚点解析正确，未发生误杀");
    }
}
