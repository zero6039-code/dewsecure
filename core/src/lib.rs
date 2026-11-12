#![allow(clippy::empty_line_after_doc_comments)]

//! DewSecure 核心引擎
//! 提供跨平台的广告拦截和内容优化能力。通过 UniFFI 导出为 Kotlin 和 Swift 绑定。

uniffi::setup_scaffolding!("dewsecure");

pub mod anti_bypass;
pub mod classifier;
pub mod model;
pub mod model_loader;
pub mod rule_matcher;
pub mod engine_host;
pub mod mitm_proxy;
pub mod stats;

pub use engine_host::{BlockDecision, BlockResult, HostEngine};

use std::sync::Arc;
use std::sync::Mutex;
use thiserror::Error;
use stats::StatsEngine;

#[derive(Debug, Error, uniffi::Error)]
pub enum EngineError {
    #[error("无效规则: {0}")]
    InvalidRule(String),
    #[error("模型加载失败: {0}")]
    ModelLoadFailed(String),
    #[error("初始化失败: {0}")]
    InitializationFailed(String),
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum Classification {
    Ad,
    Tracker,
    Normal,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum Decision {
    Allow,
    Block,
    Rewrite,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct EngineConfig {
    pub rule_data: String,
    pub model_path: String,
    pub ai_enabled: bool,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct FilterRule {
    pub pattern: String,
    pub is_exception: bool,
    pub resource_types: Vec<String>,
    pub domains: Vec<String>,
    pub third_party: Option<bool>, // 🛡️ C-4 修复：增加第三方标识支持
}

/// DewSecure 引擎 (主要供旧接口兼容或纯规则测试)
#[derive(uniffi::Object)]
pub struct DewEngine {
    rule_matcher: Arc<Mutex<rule_matcher::RuleMatcher>>,
    classifier: Option<Arc<Mutex<classifier::Classifier>>>,
    _config: EngineConfig,
    stats_engine: Arc<StatsEngine>,
}

#[uniffi::export]
impl DewEngine {
    #[uniffi::constructor]
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
            stats_engine: Arc::new(StatsEngine::new()),
        })
    }

    pub fn classify(&self, url: String, _headers: Vec<String>) -> Classification {
        let matcher = self.rule_matcher.lock().unwrap_or_else(|e| e.into_inner());
        if matcher.is_exception(&url) {
            return Classification::Normal;
        }

        if matcher.matches(&url) {
            let classification = if url.contains("track") || url.contains("analytics") {
                Classification::Tracker
            } else {
                Classification::Ad
            };
            return classification;
        }

        if let Some(classifier) = &self.classifier {
            let classifier = classifier.lock().unwrap_or_else(|e| e.into_inner());
            let clean_url = if url.starts_with("http") {
                let parts: Vec<&str> = url.split('/').collect();
                if parts.len() >= 3 { format!("{}://{}", parts[0], parts[2]) } else { url.clone() }
            } else {
                let parts: Vec<&str> = url.split('/').collect();
                format!("https://{}", parts[0])
            };

            let features = classifier::extract_features(&clean_url);
            let result = classifier.predict(&features);

            match result {
                classifier::Prediction::Ad => return Classification::Ad,
                classifier::Prediction::Tracker => return Classification::Tracker,
                classifier::Prediction::Normal => return Classification::Normal,
            }
        }
        Classification::Unknown
    }

    pub fn decide(&self, classification: Classification, url: String) -> Decision {
        match classification {
            Classification::Ad | Classification::Tracker => Decision::Block,
            Classification::Normal => Decision::Allow,
            Classification::Unknown => {
                if url.contains("/ad/") || url.contains("/ads/") || url.contains("banner=") {
                    Decision::Block
                } else {
                    Decision::Allow
                }
            }
        }
    }

    pub fn add_custom_rule(&self, rule: String) {
        let mut matcher = self.rule_matcher.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(parsed) = rule_matcher::parse_rule(&rule) {
            matcher.add_rule(parsed);
        }
    }

    pub fn get_rules(&self) -> Vec<FilterRule> {
        let matcher = self.rule_matcher.lock().unwrap_or_else(|e| e.into_inner());
        matcher.get_rules()
    }

    /// 修复：响应 UDL 中定义的 get_stats 方法
    pub fn set_initial_stats(&self, total: i64, today: i64) {
        self.stats_engine.set_initial_stats(total as u64, today as u64);
    }

    pub fn get_stats(&self) -> String {
        self.stats_engine.get_stats_json()
    }
}

/// 获取 MitM CA 证书 (PEM 格式)，供 Android 端下载安装
#[uniffi::export]
pub fn get_mitm_ca_cert() -> String {
    mitm_proxy::MitmProxy::get_ca_cert_pem()
}

/// 启动 MitM 代理 (异步)
#[uniffi::export]
pub fn start_mitm_proxy() -> String {
    let (tx, rx) = std::sync::mpsc::channel();
    
    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let res = rt.block_on(async {
            let proxy = mitm_proxy::MitmProxy::new();
            proxy.start().await
        });
        
        let _ = tx.send(res);
        loop { std::thread::park(); }
    });
    
    match rx.recv_timeout(std::time::Duration::from_secs(3)) {
        Ok(Ok(_)) => "OK".to_string(),
        Ok(Err(e)) => format!("ERR: {}", e),
        Err(_) => "TIMEOUT".to_string(),
    }
}
