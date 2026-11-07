//! HostEngine：Android DNS 拦截的主入口
//!
//! A0-6b-1：硬规则判定（用户白名单 > safe > block > mining > 默认放行）
//! AI 推理（T1）在 A0-6b-2 加入，用户白名单在 A0-6c 加入。
//!
//! 输入契约：`should_block(domain)` 接收纯域名（如 `google.com`）。
//! 内部做 lowercase + 去尾点 + 后缀匹配（`foo.doubleclick.net` 命中 `doubleclick.net`）。
//!
//! 数据来源：`shared/adblock/hard-domains.json` 编译期内嵌（include_str!）。

use crate::{EngineConfig, EngineError};
use serde::Deserialize;
use std::collections::HashSet;

/// 域名级拦截决策。与 UDL `enum BlockDecision` 一一对应。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BlockDecision {
    Allow,
    BlockAd,
    BlockTracker,
    BlockMining,
}

/// 拦截结果。与 UDL `dictionary BlockResult` 一一对应。
#[derive(Debug, Clone)]
pub struct BlockResult {
    pub decision: BlockDecision,
    /// 取值：`hard_safe` / `hard_block_ad` / `hard_block_tracker` / `hard_mining` / `default_allow`
    /// （A0-6b-2 加 `ai_ad` / `ai_tracker`，A0-6c 加 `user_allow`）
    pub reason: String,
    /// 硬规则为 1.0；AI 为 softmax 最大概率；默认放行为 0.0
    pub confidence: f32,
}

#[derive(Debug, Deserialize)]
struct HardDomainsFile {
    safe: Vec<String>,
    block: BlockLists,
    mining: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct BlockLists {
    ad: Vec<String>,
    tracker: Vec<String>,
}

/// Android DNS 拦截引擎。
pub struct HostEngine {
    // A0-6b-2 会加：adblock 权重 + ai_enabled 逻辑
    _config: EngineConfig,
    safe: HashSet<String>,
    block_ad: HashSet<String>,
    block_tracker: HashSet<String>,
    mining: HashSet<String>,
}

const HARD_DOMAINS_JSON: &str =
    include_str!("../../shared/adblock/hard-domains.json");

impl HostEngine {
    pub fn new(config: EngineConfig) -> Result<Self, EngineError> {
        tracing::info!("初始化 HostEngine（A0-6b-1 硬规则）");

        let parsed: HardDomainsFile = serde_json::from_str(HARD_DOMAINS_JSON)
            .map_err(|e| EngineError::InitializationFailed(format!(
                "hard-domains.json 解析失败: {}", e
            )))?;

        let normalize = |v: Vec<String>| -> HashSet<String> {
            v.into_iter()
                .map(|s| s.trim().trim_end_matches('.').to_lowercase())
                .filter(|s| !s.is_empty())
                .collect()
        };

        Ok(Self {
            _config: config,
            safe: normalize(parsed.safe),
            block_ad: normalize(parsed.block.ad),
            block_tracker: normalize(parsed.block.tracker),
            mining: normalize(parsed.mining),
        })
    }

    /// 硬规则判定。优先级：safe > block_ad > block_tracker > mining > 默认放行。
    /// AI（T1）将在 A0-6b-2 插入到 mining 之后、默认放行之前。
    pub fn should_block(&self, domain: String) -> BlockResult {
        let host = domain.trim().trim_end_matches('.').to_lowercase();

        if host.is_empty() {
            return BlockResult {
                decision: BlockDecision::Allow,
                reason: "default_allow".to_string(),
                confidence: 0.0,
            };
        }

        // 1. 硬白名单
        if matches_domain_or_subdomain(&self.safe, &host) {
            return BlockResult {
                decision: BlockDecision::Allow,
                reason: "hard_safe".to_string(),
                confidence: 1.0,
            };
        }

        // 2. 广告硬规则
        if matches_domain_or_subdomain(&self.block_ad, &host) {
            return BlockResult {
                decision: BlockDecision::BlockAd,
                reason: "hard_block_ad".to_string(),
                confidence: 1.0,
            };
        }

        // 3. 追踪硬规则
        if matches_domain_or_subdomain(&self.block_tracker, &host) {
            return BlockResult {
                decision: BlockDecision::BlockTracker,
                reason: "hard_block_tracker".to_string(),
                confidence: 1.0,
            };
        }

        // 4. 挖矿硬规则
        if matches_domain_or_subdomain(&self.mining, &host) {
            return BlockResult {
                decision: BlockDecision::BlockMining,
                reason: "hard_mining".to_string(),
                confidence: 1.0,
            };
        }

        // 5. 默认放行（A0-6b-2 会在这里插入 T1 AI 判定）
        BlockResult {
            decision: BlockDecision::Allow,
            reason: "default_allow".to_string(),
            confidence: 0.0,
        }
    }
}

/// `host` 是否等于 `set` 中的某个域名，或是其后缀子域。
/// 例：`foo.doubleclick.net` 对 `{doubleclick.net}` 返回 true。
/// `notdoubleclick.net` 对 `{doubleclick.net}` 返回 false。
fn matches_domain_or_subdomain(set: &HashSet<String>, host: &str) -> bool {
    if set.contains(host) {
        return true;
    }
    let mut start = 0;
    while let Some(pos) = host[start..].find('.') {
        let next = start + pos + 1;
        if set.contains(&host[next..]) {
            return true;
        }
        start = next;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_engine() -> HostEngine {
        HostEngine::new(EngineConfig {
            rule_data: String::new(),
            model_path: String::new(),
            ai_enabled: false,
        })
        .expect("HostEngine::new 不应失败")
    }

    #[test]
    fn engine_loads_hard_domains() {
        let e = make_engine();
        assert!(e.safe.contains("google.com"));
        assert!(e.block_ad.contains("doubleclick.net"));
        assert!(e.block_tracker.contains("google-analytics.com"));
        assert!(e.mining.contains("coinhive.com"));
    }

    #[test]
    fn safe_domain_allowed() {
        let e = make_engine();
        let r = e.should_block("google.com".to_string());
        assert_eq!(r.decision, BlockDecision::Allow);
        assert_eq!(r.reason, "hard_safe");
        assert_eq!(r.confidence, 1.0);
    }

    #[test]
    fn safe_subdomain_allowed() {
        let e = make_engine();
        let r = e.should_block("apis.google.com".to_string());
        assert_eq!(r.decision, BlockDecision::Allow);
        assert_eq!(r.reason, "hard_safe");
    }

    #[test]
    fn block_ad_domain() {
        let e = make_engine();
        let r = e.should_block("doubleclick.net".to_string());
        assert_eq!(r.decision, BlockDecision::BlockAd);
        assert_eq!(r.reason, "hard_block_ad");
        assert_eq!(r.confidence, 1.0);
    }

    #[test]
    fn block_ad_subdomain() {
        let e = make_engine();
        let r = e.should_block("ad.doubleclick.net".to_string());
        assert_eq!(r.decision, BlockDecision::BlockAd);
    }

    #[test]
    fn block_tracker_domain() {
        let e = make_engine();
        let r = e.should_block("google-analytics.com".to_string());
        assert_eq!(r.decision, BlockDecision::BlockTracker);
        assert_eq!(r.reason, "hard_block_tracker");
    }

    #[test]
    fn block_mining_domain() {
        let e = make_engine();
        let r = e.should_block("coinhive.com".to_string());
        assert_eq!(r.decision, BlockDecision::BlockMining);
        assert_eq!(r.reason, "hard_mining");
    }

    #[test]
    fn default_allow() {
        let e = make_engine();
        let r = e.should_block("example.com".to_string());
        assert_eq!(r.decision, BlockDecision::Allow);
        assert_eq!(r.reason, "default_allow");
        assert_eq!(r.confidence, 0.0);
    }

    #[test]
    fn safe_priority_over_block() {
        // google.com 在 safe 里，即使 block 里也有 google 系（googlesyndication）
        let e = make_engine();
        let r = e.should_block("google.com".to_string());
        assert_eq!(r.decision, BlockDecision::Allow);
        assert_eq!(r.reason, "hard_safe");
    }

    #[test]
    fn case_insensitive() {
        let e = make_engine();
        let r = e.should_block("DOUBLECLICK.NET".to_string());
        assert_eq!(r.decision, BlockDecision::BlockAd);
    }

    #[test]
    fn trailing_dot_stripped() {
        let e = make_engine();
        let r = e.should_block("doubleclick.net.".to_string());
        assert_eq!(r.decision, BlockDecision::BlockAd);
    }

    #[test]
    fn empty_domain_allowed() {
        let e = make_engine();
        let r = e.should_block(String::new());
        assert_eq!(r.decision, BlockDecision::Allow);
        assert_eq!(r.reason, "default_allow");
    }

    #[test]
    fn no_false_substring_match() {
        // notdoubleclick.net 不应命中 doubleclick.net
        let e = make_engine();
        let r = e.should_block("notdoubleclick.net".to_string());
        assert_eq!(r.decision, BlockDecision::Allow);
        assert_eq!(r.reason, "default_allow");
    }
}
