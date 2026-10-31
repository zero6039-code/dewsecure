//! Adblock 规则解析器

use crate::FilterRule;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ParseError {
    #[error("规则格式无效: {0}")]
    InvalidFormat(String),
    #[error("正则表达式无效: {0}")]
    InvalidRegex(String),
}

/// 解析规则文本（多行）
pub fn parse_rules(text: &str) -> Result<Vec<FilterRule>, ParseError> {
    let mut rules = Vec::new();

    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('!') || line.starts_with('[') {
            continue;
        }
        if let Some(rule) = parse_rule(line) {
            rules.push(rule);
        }
    }

    tracing::info!("解析了 {} 条规则", rules.len());
    Ok(rules)
}

/// 解析单条规则
pub fn parse_rule(line: &str) -> Option<FilterRule> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('!') || line.contains("##") || line.contains("#@#") {
        return None;
    }

    // 检查例外规则
    let (is_exception, line) = if let Some(stripped) = line.strip_prefix("@@") {
        (true, stripped)
    } else {
        (false, line)
    };

    // 分离 pattern 和 options
    let (pattern, options) = if let Some(idx) = line.rfind('$') {
        let (p, o) = line.split_at(idx);
        (p, Some(&o[1..]))
    } else {
        (line, None)
    };

    // 解析 options
    let mut resource_types = Vec::new();
    let mut domains = Vec::new();

    if let Some(opts) = options {
        for opt in opts.split(',') {
            let opt = opt.trim();
            if let Some(domain_list) = opt.strip_prefix("domain=") {
                for d in domain_list.split('|') {
                    domains.push(d.to_string());
                }
            } else if is_resource_type(opt) {
                resource_types.push(opt.to_string());
            }
        }
    }

    Some(FilterRule {
        pattern: pattern.to_string(),
        is_exception,
        resource_types,
        domains,
    })
}

fn is_resource_type(s: &str) -> bool {
    matches!(
        s,
        "script"
            | "image"
            | "stylesheet"
            | "object"
            | "xmlhttprequest"
            | "subdocument"
            | "document"
            | "font"
            | "media"
            | "websocket"
            | "ping"
            | "other"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_rule() {
        let rule = parse_rule("||doubleclick.net^").unwrap();
        assert_eq!(rule.pattern, "||doubleclick.net^");
        assert!(!rule.is_exception);
    }

    #[test]
    fn test_parse_exception_rule() {
        let rule = parse_rule("@@||example.com^").unwrap();
        assert!(rule.is_exception);
    }

    #[test]
    fn test_parse_rule_with_options() {
        let rule = parse_rule("||ads.com^$script,image,domain=example.com").unwrap();
        assert_eq!(rule.pattern, "||ads.com^");
        assert!(rule.resource_types.contains(&"script".to_string()));
        assert!(rule.domains.contains(&"example.com".to_string()));
    }
}
