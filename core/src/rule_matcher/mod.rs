//! 规则匹配引擎
//!
//! 实现 Adblock 语法规则的解析和高效匹配。

mod parser;
mod matcher;

pub use matcher::RuleMatcher;
pub use parser::{parse_rule, parse_rules, ParseError};
