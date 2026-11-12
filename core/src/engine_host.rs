use crate::{EngineConfig, EngineError};
use serde::Deserialize;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use crate::model::adblock::AdblockModel;
use crate::stats::StatsEngine;

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum BlockDecision {
    Allow,
    BlockAd,
    BlockTracker,
    BlockMining,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct BlockResult {
    pub decision: BlockDecision,
    pub reason: String,
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

#[derive(Debug, Deserialize)]
struct DomainRulesFile {
    ad: Vec<String>,
    tracker: Vec<String>,
}

#[derive(uniffi::Object)]
pub struct HostEngine {
    _config: EngineConfig,
    safe: HashSet<String>,
    block_ad: HashSet<String>,
    block_tracker: HashSet<String>,
    mining: HashSet<String>,
    user_allow: Arc<Mutex<HashSet<String>>>,
    adblock_model: Arc<Mutex<Option<AdblockModel>>>,
    stats_engine: Arc<StatsEngine>,
    
    // 6 大功能开关
    enable_dnr: Arc<AtomicBool>,
    enable_tracker: Arc<AtomicBool>,
    enable_social: Arc<AtomicBool>,
    enable_threat_intel: Arc<AtomicBool>,
    enable_ai_phishing: Arc<AtomicBool>,
    enable_ai_zero_day: Arc<AtomicBool>,
}

const HARD_DOMAINS_JSON: &str = include_str!("../../shared/adblock/hard-domains.json");
const DOMAIN_RULES_JSON: &str = include_str!("../../shared/adblock/domain-rules.json");
const AI_CONFIDENCE_THRESHOLD: f32 = 0.8;

fn normalize_domain(s: &str) -> String {
    s.trim().trim_end_matches('.').to_lowercase()
}

#[uniffi::export]
impl HostEngine {
    #[uniffi::constructor]
    pub fn new(config: EngineConfig) -> Result<Self, EngineError> {
        tracing::info!("初始化 HostEngine（包含统计模块）");
        let parsed: HardDomainsFile = serde_json::from_str(HARD_DOMAINS_JSON)
            .map_err(|e| EngineError::InitializationFailed(format!("hard-domains.json 解析失败: {}", e)))?;
        let parsed_domain_rules: DomainRulesFile = serde_json::from_str(DOMAIN_RULES_JSON)
            .map_err(|e| EngineError::InitializationFailed(format!("domain-rules.json 解析失败: {}", e)))?;

        let normalize_set = |v: Vec<String>| -> HashSet<String> {
            v.into_iter().map(|s| normalize_domain(&s)).filter(|s| !s.is_empty()).collect()
        };

        let mut all_ad = parsed.block.ad;
        all_ad.extend(parsed_domain_rules.ad);
        let mut all_tracker = parsed.block.tracker;
        all_tracker.extend(parsed_domain_rules.tracker);

        Ok(Self {
            _config: config,
            safe: normalize_set(parsed.safe),
            block_ad: normalize_set(all_ad),
            block_tracker: normalize_set(all_tracker),
            mining: normalize_set(parsed.mining),
            user_allow: Arc::new(Mutex::new(HashSet::new())),
            adblock_model: Arc::new(Mutex::new(None)),
            stats_engine: Arc::new(StatsEngine::new()),
            
            // 默认全开
            enable_dnr: Arc::new(AtomicBool::new(true)),
            enable_tracker: Arc::new(AtomicBool::new(true)),
            enable_social: Arc::new(AtomicBool::new(true)),
            enable_threat_intel: Arc::new(AtomicBool::new(true)),
            enable_ai_phishing: Arc::new(AtomicBool::new(true)),
            enable_ai_zero_day: Arc::new(AtomicBool::new(true)),
        })
    }

    pub fn should_block(&self, domain: String) -> BlockResult {
        let host = normalize_domain(&domain);
        if host.is_empty() {
            return BlockResult { decision: BlockDecision::Allow, reason: "default_allow".into(), confidence: 0.0 };
        }

        let user_allow_guard = self.user_allow.lock().unwrap_or_else(|e| e.into_inner());
        if matches_domain_or_subdomain(&user_allow_guard, &host) {
            return BlockResult { decision: BlockDecision::Allow, reason: "user_allow".into(), confidence: 1.0 };
        }

        // 1. DNR Rule Blocking
        if self.enable_dnr.load(Ordering::Relaxed) && matches_domain_or_subdomain(&self.block_ad, &host) {
            self.stats_engine.record_block(&host, "hard_block_ad");
            return BlockResult { decision: BlockDecision::BlockAd, reason: "hard_block_ad".into(), confidence: 1.0 };
        }

        // 2. Trackers & 3. Social Trackers
        if self.enable_tracker.load(Ordering::Relaxed) && matches_domain_or_subdomain(&self.block_tracker, &host) {
            let is_social = host.contains("facebook") || host.contains("twitter") || host.contains("tiktok") 
                || host.contains("instagram") || host.contains("linkedin") || host.contains("snapchat");
            
            if !is_social || self.enable_social.load(Ordering::Relaxed) {
                self.stats_engine.record_block(&host, "hard_block_tracker");
                return BlockResult { decision: BlockDecision::BlockTracker, reason: "hard_block_tracker".into(), confidence: 1.0 };
            }
        }

        // 4. Threat Intel (绑定目前的 mining 集合)
        if self.enable_threat_intel.load(Ordering::Relaxed) && matches_domain_or_subdomain(&self.mining, &host) {
            self.stats_engine.record_block(&host, "hard_mining");
            return BlockResult { decision: BlockDecision::BlockMining, reason: "hard_mining".into(), confidence: 1.0 };
        }

        if matches_domain_or_subdomain(&self.safe, &host) {
            return BlockResult { decision: BlockDecision::Allow, reason: "hard_safe".into(), confidence: 1.0 };
        }

        // AI 预测部分
        {
            let model_guard = self.adblock_model.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(model) = model_guard.as_ref() {
                let features = crate::classifier::features_adblock::extract_sparse_features(&host);
                let (decision, confidence) = model.predict(&features);
                
                if confidence >= AI_CONFIDENCE_THRESHOLD && decision != BlockDecision::Allow {
                    // 5. AI Phishing & 6. AI Zero-day 开关控制
                    let is_ai_enabled = match decision {
                        BlockDecision::BlockAd => self.enable_ai_zero_day.load(Ordering::Relaxed),
                        BlockDecision::BlockTracker => self.enable_ai_phishing.load(Ordering::Relaxed),
                        _ => true,
                    };
                    
                    if is_ai_enabled {
                        let reason = match decision {
                            BlockDecision::BlockAd => "ai_ad",
                            BlockDecision::BlockTracker => "ai_tracker",
                            _ => "ai_other",
                        };
                        self.stats_engine.record_block(&host, reason);
                        return BlockResult { decision, reason: reason.to_string(), confidence };
                    }
                }
            }
        }

        BlockResult { decision: BlockDecision::Allow, reason: "default_allow".into(), confidence: 0.0 }
    }

    pub fn user_allow(&self, domain: String) {
        let h = normalize_domain(&domain);
        if !h.is_empty() {
            let mut guard = self.user_allow.lock().unwrap_or_else(|e| e.into_inner());
            guard.insert(h);
        }
    }

    pub fn user_remove_allow(&self, domain: String) {
        let h = normalize_domain(&domain);
        let mut guard = self.user_allow.lock().unwrap_or_else(|e| e.into_inner());
        guard.remove(&h);
    }

    pub fn load_user_whitelist(&self, domains: Vec<String>) {
        let mut guard = self.user_allow.lock().unwrap_or_else(|e| e.into_inner());
        guard.clear();
        for d in domains {
            let h = normalize_domain(&d);
            if !h.is_empty() {
                guard.insert(h);
            }
        }
    }

    pub fn get_user_allow_list(&self) -> Vec<String> {
        let guard = self.user_allow.lock().unwrap_or_else(|e| e.into_inner());
        let mut v: Vec<String> = guard.iter().cloned().collect();
        v.sort();
        v
    }

    pub fn set_initial_stats(&self, total: i64, today: i64) {
        self.stats_engine.set_initial_stats(total as u64, today as u64);
    }

    /// 启动时同时恢复数字与历史日志列表
    pub fn set_initial_stats_with_logs(&self, total: i64, today: i64, logs_json: String) {
        self.stats_engine.set_initial_stats(total as u64, today as u64);
        if let Ok(items) = serde_json::from_str::<Vec<crate::stats::LogItem>>(&logs_json) {
            if let Ok(mut logs) = self.stats_engine.logs.lock() {
                logs.clear();
                for item in items {
                    logs.push_back(item);
                }
            }
        }
    }

    pub fn get_stats(&self) -> String {
        self.stats_engine.get_stats_json()
    }

    /// 权限降级时卸载 AI 模型，恢复纯规则拦截
    pub fn unload_adblock_model(&self) {
        let mut guard = self.adblock_model.lock().unwrap_or_else(|e| e.into_inner());
        *guard = None;
        tracing::info!("🔒 权限不足，AI 模型已被自动卸载");
    }

    // --- 6 大开关的 Setter/Getter ---
    pub fn set_enable_dnr(&self, enabled: bool) { self.enable_dnr.store(enabled, Ordering::Relaxed); }
    pub fn is_enable_dnr(&self) -> bool { self.enable_dnr.load(Ordering::Relaxed) }
    
    pub fn set_enable_tracker(&self, enabled: bool) { self.enable_tracker.store(enabled, Ordering::Relaxed); }
    pub fn is_enable_tracker(&self) -> bool { self.enable_tracker.load(Ordering::Relaxed) }
    
    pub fn set_enable_social(&self, enabled: bool) { self.enable_social.store(enabled, Ordering::Relaxed); }
    pub fn is_enable_social(&self) -> bool { self.enable_social.load(Ordering::Relaxed) }
    
    pub fn set_enable_threat_intel(&self, enabled: bool) { self.enable_threat_intel.store(enabled, Ordering::Relaxed); }
    pub fn is_enable_threat_intel(&self) -> bool { self.enable_threat_intel.load(Ordering::Relaxed) }
    
    pub fn set_enable_ai_phishing(&self, enabled: bool) { self.enable_ai_phishing.store(enabled, Ordering::Relaxed); }
    pub fn is_enable_ai_phishing(&self) -> bool { self.enable_ai_phishing.load(Ordering::Relaxed) }
    
    pub fn set_enable_ai_zero_day(&self, enabled: bool) { self.enable_ai_zero_day.store(enabled, Ordering::Relaxed); }
    pub fn is_enable_ai_zero_day(&self) -> bool { self.enable_ai_zero_day.load(Ordering::Relaxed) }
}

impl HostEngine {
    pub fn load_signed_adblock_model(
        &self, version: &str, sha256_hex: &str, sig_b64: &str, body: &str, model_type: &str, channel: &str, valid_until: u64, local_version: Option<&str>,
    ) -> Result<(), EngineError> {
        if body.len() > 4 * 1024 * 1024 { return Err(EngineError::ModelLoadFailed("Model size exceeds 4MB limit".into())); }
        crate::model::bundle::verify(version, sha256_hex, sig_b64, body.as_bytes(), model_type, channel, valid_until, local_version)
            .map_err(|e| EngineError::ModelLoadFailed(format!("Signature verification failed: {:?}", e)))?;
        let model = AdblockModel::load_from_json(body).map_err(EngineError::ModelLoadFailed)?;
        let mut guard = self.adblock_model.lock().unwrap_or_else(|e| e.into_inner());
        *guard = Some(model);
        Ok(())
    }
}

fn matches_domain_or_subdomain(set: &HashSet<String>, host: &str) -> bool {
    if set.contains(host) { return true; }
    let mut start = 0;
    while let Some(pos) = host[start..].find('.') {
        let next = start + pos + 1;
        if set.contains(&host[next..]) { return true; }
        start = next;
    }
    false
}

#[cfg(test)]
#[path = "engine_host_test.rs"]
mod tests;
