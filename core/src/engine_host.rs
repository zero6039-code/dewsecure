use crate::{EngineConfig, EngineError};
use serde::Deserialize;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use crate::model::adblock::AdblockModel;
use crate::stats::StatsEngine;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BlockDecision {
    Allow,
    BlockAd,
    BlockTracker,
    BlockMining,
}

#[derive(Debug, Clone)]
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

pub struct HostEngine {
    _config: EngineConfig,
    safe: HashSet<String>,
    block_ad: HashSet<String>,
    block_tracker: HashSet<String>,
    mining: HashSet<String>,
    user_allow: Arc<Mutex<HashSet<String>>>,
    adblock_model: Arc<Mutex<Option<AdblockModel>>>,
    stats_engine: Arc<StatsEngine>, // 新增统计数据引擎
}

const HARD_DOMAINS_JSON: &str = include_str!("../../shared/adblock/hard-domains.json");
const DOMAIN_RULES_JSON: &str = include_str!("../../shared/adblock/domain-rules.json");
const AI_CONFIDENCE_THRESHOLD: f32 = 0.8;

fn normalize_domain(s: &str) -> String {
    s.trim().trim_end_matches('.').to_lowercase()
}

impl HostEngine {
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

        // 🛡️ C-6 修复：拦截规则优先于 safe 列表，防止 ads.google.com 被 google.com 整域放行
        if matches_domain_or_subdomain(&self.block_ad, &host) {
            self.stats_engine.record_block(&host, "hard_block_ad");
            return BlockResult { decision: BlockDecision::BlockAd, reason: "hard_block_ad".into(), confidence: 1.0 };
        }

        if matches_domain_or_subdomain(&self.block_tracker, &host) {
            self.stats_engine.record_block(&host, "hard_block_tracker");
            return BlockResult { decision: BlockDecision::BlockTracker, reason: "hard_block_tracker".into(), confidence: 1.0 };
        }

        if matches_domain_or_subdomain(&self.mining, &host) {
            self.stats_engine.record_block(&host, "hard_mining");
            return BlockResult { decision: BlockDecision::BlockMining, reason: "hard_mining".into(), confidence: 1.0 };
        }

        // 拦截检查完毕，再判断是否为已知安全域
        if matches_domain_or_subdomain(&self.safe, &host) {
            return BlockResult { decision: BlockDecision::Allow, reason: "hard_safe".into(), confidence: 1.0 };
        }

        {
            let model_guard = self.adblock_model.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(model) = model_guard.as_ref() {
                let features = crate::classifier::features_adblock::extract_sparse_features(&host);
                let (decision, confidence) = model.predict(&features);
                if confidence >= AI_CONFIDENCE_THRESHOLD && decision != BlockDecision::Allow {
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

    /// 🛡️ C-1 修复：强制要求通过签名校验后才允许加载模型
    pub fn load_signed_adblock_model(
        &self,
        version: &str,
        sha256_hex: &str,
        sig_b64: &str,
        body: &str,
        model_type: &str,
        channel: &str,
        valid_until: u64,
        local_version: Option<&str>,
    ) -> Result<(), EngineError> {
        // 防 OOM
        if body.len() > 4 * 1024 * 1024 {
            return Err(EngineError::ModelLoadFailed("Model size exceeds 4MB limit".into()));
        }

        // 强制验签
        crate::model::bundle::verify(version, sha256_hex, sig_b64, body.as_bytes(), model_type, channel, valid_until, local_version)
            .map_err(|e| EngineError::ModelLoadFailed(format!("Signature verification failed: {:?}", e)))?;

        let model = AdblockModel::load_from_json(body).map_err(EngineError::ModelLoadFailed)?;
        let mut guard = self.adblock_model.lock().unwrap_or_else(|e| e.into_inner());
        *guard = Some(model);
        Ok(())
    }

    /// 暴露给 Kotlin 的获取统计数据接口
    pub fn get_stats(&self) -> String {
        self.stats_engine.get_stats_json()
    }
}

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
#[path = "engine_host_test.rs"]
mod tests;
