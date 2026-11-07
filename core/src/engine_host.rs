//! HostEngine：Android DNS 拦截的主入口（A0-6a MVP stub）
//!
//! A0-6a 目标：验证 UDL → Kotlin 绑定链路，不做实际判定。
//! 判定逻辑（T1 + 硬规则 + 用户白名单优先级）在 A0-6b 实现。
//!
//! 输入契约：`should_block(domain)` 接收纯域名（如 `google.com`），
//! 与 T1 特征提取器 `features_adblock::extract_sparse_features` 的输入一致。

use crate::{EngineConfig, EngineError};

/// 域名级拦截决策。与 UDL `enum BlockDecision` 一一对应。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BlockDecision {
    Allow,
    BlockAd,
    BlockTracker,
}

/// 拦截结果。与 UDL `dictionary BlockResult` 一一对应。
#[derive(Debug, Clone)]
pub struct BlockResult {
    pub decision: BlockDecision,
    /// 例："hard_safe" / "hard_block" / "mining" / "ai_ad" / "ai_tracker" / "user_allow" / "mvp_stub"
    pub reason: String,
    /// 硬规则为 1.0；AI 为 softmax 最大概率；未命中为 0.0
    pub confidence: f32,
}

/// Android DNS 拦截引擎。
pub struct HostEngine {
    // A0-6a 只保存 config；A0-6b 会加：
    // - user_whitelist: HashSet<String>
    // - hard_safe / hard_block / mining: HashSet<String>
    // - adblock_weights: Option<AdblockModel>
    _config: EngineConfig,
}

impl HostEngine {
    pub fn new(config: EngineConfig) -> Result<Self, EngineError> {
        tracing::info!("初始化 HostEngine（A0-6a MVP stub）");
        Ok(Self { _config: config })
    }

    /// A0-6a：固定返回 Allow，用于验证 UDL 绑定。
    /// A0-6b 会按 用户白名单 > 硬白名单 > 硬黑名单 > 挖矿 > T1 AI 的顺序判定。
    pub fn should_block(&self, domain: String) -> BlockResult {
        let _ = domain;
        BlockResult {
            decision: BlockDecision::Allow,
            reason: "mvp_stub".to_string(),
            confidence: 0.0,
        }
    }
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
    fn stub_always_allows() {
        let engine = make_engine();
        let r = engine.should_block("google.com".to_string());
        assert_eq!(r.decision, BlockDecision::Allow);
        assert_eq!(r.reason, "mvp_stub");
        assert_eq!(r.confidence, 0.0);
    }

    #[test]
    fn stub_does_not_panic_on_empty_domain() {
        let engine = make_engine();
        let r = engine.should_block(String::new());
        assert_eq!(r.decision, BlockDecision::Allow);
    }
}
