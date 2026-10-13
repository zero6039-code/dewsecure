#![allow(clippy::empty_line_after_doc_comments)]

//! DewSecure 核心引擎
//!
//! 提供跨平台的广告拦截和内容优化能力。
//! 通过 UniFFI 导出为 Kotlin 和 Swift 绑定。

uniffi::include_scaffolding!("dewsecure");

pub mod anti_bypass;
pub mod classifier;
pub mod model_loader;
pub mod rule_matcher;

use std::sync::Arc;
use std::sync::Mutex;
use thiserror::Error;

/// 引擎错误类型
#[derive(Debug, Error)]
pub enum EngineError {
    #[error("无效规则: {0}")]
    InvalidRule(String),
    #[error("模型加载失败: {0}")]
    ModelLoadFailed(String),
    #[error("初始化失败: {0}")]
    InitializationFailed(String),
}

/// 分类结果
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Classification {
    Ad,
    Tracker,
    Normal,
    Unknown,
}

/// 决策结果
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    Allow,
    Block,
    Rewrite,
}

/// 引擎配置
#[derive(Debug, Clone)]
pub struct EngineConfig {
    pub rule_data: String,
    pub model_path: String,
    pub ai_enabled: bool,
}

/// 过滤规则
#[derive(Debug, Clone)]
pub struct FilterRule {
    pub pattern: String,
    pub is_exception: bool,
    pub resource_types: Vec<String>,
    pub domains: Vec<String>,
}

/// DewSecure 引擎
pub struct DewEngine {
    rule_matcher: Arc<Mutex<rule_matcher::RuleMatcher>>,
    classifier: Option<Arc<Mutex<classifier::Classifier>>>,
    _config: EngineConfig,
    stats: Arc<Mutex<EngineStats>>,
}

/// 引擎统计
#[derive(Debug, Default, Clone, serde::Serialize)]
pub struct EngineStats {
    pub total_requests: u64,
    pub blocked_ads: u64,
    pub blocked_trackers: u64,
    pub allowed: u64,
}

impl DewEngine {
    /// 创建新引擎
    pub fn new(config: EngineConfig) -> Result<Self, EngineError> {
        tracing::info!("初始化 DewSecure 引擎");

        let rules = rule_matcher::parse_rules(&config.rule_data)
            .map_err(|e| EngineError::InvalidRule(e.to_string()))?;

        let matcher = rule_matcher::RuleMatcher::new(rules);

        let classifier = if config.ai_enabled && !config.model_path.is_empty() {
            match classifier::Classifier::load(&config.model_path) {
                Ok(c) => Some(Arc::new(Mutex::new(c))),
                Err(e) => {
                    tracing::warn!("AI 分类器加载失败，仅使用规则匹配: {}", e);
                    None
                }
            }
        } else {
            None
        };

        Ok(Self {
            rule_matcher: Arc::new(Mutex::new(matcher)),
            classifier,
            _config: config,
            stats: Arc::new(Mutex::new(EngineStats::default())),
        })
    }

    /// 分类 URL
    pub fn classify(&self, url: String, _headers: Vec<String>) -> Classification {
        let mut stats = self.stats.lock().unwrap();
        stats.total_requests += 1;

        let matcher = self.rule_matcher.lock().unwrap();
        if matcher.is_exception(&url) {
            stats.allowed += 1;
            return Classification::Normal;
        }

        if matcher.matches(&url) {
            let classification = if url.contains("track") || url.contains("analytics") {
                stats.blocked_trackers += 1;
                Classification::Tracker
            } else {
                stats.blocked_ads += 1;
                Classification::Ad
            };
            return classification;
        }

        if let Some(classifier) = &self.classifier {
            let classifier = classifier.lock().unwrap();
            let features = classifier::extract_features(&url);
            let result = classifier.predict(&features);

            match result {
                classifier::Prediction::Ad => {
                    stats.blocked_ads += 1;
                    return Classification::Ad;
                }
                classifier::Prediction::Tracker => {
                    stats.blocked_trackers += 1;
                    return Classification::Tracker;
                }
                classifier::Prediction::Normal => {
                    stats.allowed += 1;
                    return Classification::Normal;
                }
            }
        }

        stats.allowed += 1;
        Classification::Unknown
    }

    /// 决策
    pub fn decide(&self, classification: Classification, url: String) -> Decision {
        match classification {
            Classification::Ad | Classification::Tracker => Decision::Block,
            Classification::Normal => Decision::Allow,
            Classification::Unknown => {
                if url.contains("ad") || url.contains("banner") {
                    Decision::Block
                } else {
                    Decision::Allow
                }
            }
        }
    }

    /// 添加自定义规则
    pub fn add_custom_rule(&self, rule: String) {
        let mut matcher = self.rule_matcher.lock().unwrap();
        if let Some(parsed) = rule_matcher::parse_rule(&rule) {
            matcher.add_rule(parsed);
        }
    }

    /// 获取所有规则
    pub fn get_rules(&self) -> Vec<FilterRule> {
        let matcher = self.rule_matcher.lock().unwrap();
        matcher.get_rules()
    }

    /// 获取统计信息
    pub fn get_stats(&self) -> String {
        let stats = self.stats.lock().unwrap();
        serde_json::to_string(&*stats).unwrap_or_default()
    }
}
