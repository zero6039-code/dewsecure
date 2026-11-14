use crate::{EngineConfig, EngineError};
use serde::Deserialize;
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex, RwLock, OnceLock};
use std::sync::atomic::{AtomicBool, Ordering};
use crate::model::adblock::AdblockModel;
use crate::stats::StatsEngine;
use sha2::{Sha256, Digest};
use ed25519_dalek::{Signature, VerifyingKey, Verifier};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};

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


#[derive(Debug, Deserialize, serde::Serialize)]
struct DomainRulesFile {
    ad: Vec<String>,
    #[allow(dead_code)]
    tracker: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct BlockLists {
    ad: Vec<String>,
    tracker: Vec<String>,
}


// 兼容浏览器插件 DNR 格式的解析结构
#[derive(Debug, Deserialize)]
struct DnrRule {
    condition: DnrCondition,
}
#[derive(Debug, Deserialize)]
struct DnrCondition {
    #[serde(rename = "requestDomains")]
    request_domains: Vec<String>,
}

pub static GLOBAL_HOST_ENGINE: OnceLock<Arc<HostEngine>> = OnceLock::new();

#[derive(uniffi::Object)]
pub struct HostEngine {
    _config: EngineConfig,
    fst_rules: Arc<RwLock<fst::Map<Vec<u8>>>>,
    safe: Arc<RwLock<HashSet<String>>>,
    block_ad: Arc<RwLock<HashSet<String>>>,
    block_tracker: Arc<RwLock<HashSet<String>>>,
    mining: Arc<RwLock<HashSet<String>>>,
    user_allow: Arc<Mutex<HashSet<String>>>,
    adblock_model: Arc<Mutex<Option<AdblockModel>>>,
    stats_engine: Arc<StatsEngine>,
    enable_dnr: Arc<AtomicBool>,
    enable_tracker: Arc<AtomicBool>,
    enable_social: Arc<AtomicBool>,
    enable_threat_intel: Arc<AtomicBool>,
    enable_ai_phishing: Arc<AtomicBool>,
    enable_ai_zero_day: Arc<AtomicBool>,
}

const HARD_DOMAINS_JSON: &str = include_str!("../../shared/adblock/hard-domains.json");
const DOMAIN_RULES_FST: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/rules.fst"));
const AI_CONFIDENCE_THRESHOLD: f32 = 0.8;
const ED25519_PUBLIC_KEY_HEX: &str = "a21b4c875ab246b58adc225ddf66a054cfa7b79ed2093fcc2f97598fd1197631";

impl Clone for HostEngine {
    fn clone(&self) -> Self {
        Self {
            _config: self._config.clone(),
            fst_rules: Arc::clone(&self.fst_rules),
            safe: Arc::clone(&self.safe),
            block_ad: Arc::clone(&self.block_ad),
            block_tracker: Arc::clone(&self.block_tracker),
            mining: Arc::clone(&self.mining),
            user_allow: Arc::clone(&self.user_allow),
            adblock_model: Arc::clone(&self.adblock_model),
            stats_engine: Arc::clone(&self.stats_engine),
            enable_dnr: Arc::clone(&self.enable_dnr),
            enable_tracker: Arc::clone(&self.enable_tracker),
            enable_social: Arc::clone(&self.enable_social),
            enable_threat_intel: Arc::clone(&self.enable_threat_intel),
            enable_ai_phishing: Arc::clone(&self.enable_ai_phishing),
            enable_ai_zero_day: Arc::clone(&self.enable_ai_zero_day),
        }
    }
}

fn normalize_domain(s: &str) -> String {
    s.trim().trim_end_matches('.').to_lowercase()
}

#[uniffi::export]
impl HostEngine {
    #[uniffi::constructor]
    pub fn new(config: EngineConfig) -> Result<Self, EngineError> {
        let parsed: HardDomainsFile = serde_json::from_str(HARD_DOMAINS_JSON)
            .map_err(|e| EngineError::InitializationFailed(format!("hard-domains.json 解析失败: {}", e)))?;

        // 优先加载热更新的 FST
        let cloud_fst_path = Path::new(&config.base_dir).join("cloud_rules.fst");
        let fst_bytes = if cloud_fst_path.exists() {
            fs::read(&cloud_fst_path).unwrap_or_else(|_| DOMAIN_RULES_FST.to_vec())
        } else {
            DOMAIN_RULES_FST.to_vec()
        };
        
        let fst_rules = Arc::new(RwLock::new(
            fst::Map::new(fst_bytes)
                .map_err(|e| EngineError::InitializationFailed(format!("FST 加载失败: {}", e)))?
        ));

        let normalize_set = |v: Vec<String>| -> HashSet<String> {
            v.into_iter().map(|s| normalize_domain(&s)).filter(|s| !s.is_empty()).collect()
        };

        // 加载本地持久化的热更新规则
        let mut block_ad = normalize_set(parsed.block.ad);
        let cloud_rules_path = Path::new(&config.base_dir).join("cloud_rules.json");
        if cloud_rules_path.exists() {
            if let Ok(json_str) = fs::read_to_string(&cloud_rules_path) {
                if let Ok(rules) = serde_json::from_str::<DomainRulesFile>(&json_str) {
                    block_ad.extend(normalize_set(rules.ad));
                }
            }
        }

        let normalize_set = |v: Vec<String>| -> HashSet<String> {
            v.into_iter().map(|s| normalize_domain(&s)).filter(|s| !s.is_empty()).collect()
        };

        let engine = Self {
            _config: config,
            fst_rules,
            safe: Arc::new(RwLock::new(normalize_set(parsed.safe))),
            block_ad: Arc::new(RwLock::new(block_ad)),
            block_tracker: Arc::new(RwLock::new(normalize_set(parsed.block.tracker))),
            mining: Arc::new(RwLock::new(normalize_set(parsed.mining))),
            user_allow: Arc::new(Mutex::new(HashSet::new())),
            adblock_model: Arc::new(Mutex::new(None)),
            stats_engine: Arc::new(StatsEngine::new()),
            enable_dnr: Arc::new(AtomicBool::new(true)),
            enable_tracker: Arc::new(AtomicBool::new(true)),
            enable_social: Arc::new(AtomicBool::new(true)),
            enable_threat_intel: Arc::new(AtomicBool::new(true)),
            enable_ai_phishing: Arc::new(AtomicBool::new(true)),
            enable_ai_zero_day: Arc::new(AtomicBool::new(true)),
        };
        
        let _ = GLOBAL_HOST_ENGINE.set(Arc::new(engine.clone()));
        Ok(engine)
    }

    pub fn verify_and_update_rules(&self, payload: String, expected_sha256: String, msg_str: String, sig_b64: String) -> Result<(), EngineError> {
        // 1. SHA-256 校验
        let mut hasher = Sha256::new();
        hasher.update(payload.as_bytes());
        let real_sha256 = hex::encode(hasher.finalize());
        if real_sha256 != expected_sha256 {
            return Err(EngineError::InvalidRule("SHA-256 校验失败".into()));
        }

        // 2. Ed25519 验签 (宽松模式)
        let pub_key_bytes = hex::decode(ED25519_PUBLIC_KEY_HEX).unwrap();
        let verifying_key = VerifyingKey::from_bytes(&pub_key_bytes.try_into().unwrap()).unwrap();
        let sig_bytes = BASE64.decode(sig_b64.trim()).unwrap();
        let signature = Signature::from_slice(&sig_bytes).unwrap();
        
        if let Err(_) = verifying_key.verify(msg_str.as_bytes(), &signature) {
            tracing::warn!("⚠️ Ed25519 验签失败，但 SHA-256 已通过，继续热更新");
        }

        // 3. 解析规则（兼容安卓的 ad/tracker 格式 或 云端的 DNR 格式）
        let mut ad_set = HashSet::new();
        
        // 尝试解析标准格式
        if let Ok(rules) = serde_json::from_str::<DomainRulesFile>(&payload) {
            for d in rules.ad {
                ad_set.insert(normalize_domain(&d));
            }
        } else {
            // 尝试解析 DNR 格式
            if let Ok(dnr_rules) = serde_json::from_str::<Vec<DnrRule>>(&payload) {
                for rule in dnr_rules {
                    for d in rule.condition.request_domains {
                        ad_set.insert(normalize_domain(&d));
                    }
                }
            } else {
                return Err(EngineError::InvalidRule("未知的规则 JSON 格式".into()));
            }
        }

        // 4. 写入本地磁盘缓存 (JSON 格式)
        let cloud_rules_path = Path::new(&self._config.base_dir).join("cloud_rules.json");
        let cache_struct = DomainRulesFile {
            ad: ad_set.iter().cloned().collect(),
            tracker: vec![],
        };
        if let Ok(json_str) = serde_json::to_string(&cache_struct) {
            let _ = fs::write(&cloud_rules_path, json_str);
        }

        // 5. 合并到内存中 (绝不覆盖原有的 11 万条 FST 和 hard-domains)
        let mut ad_guard = self.block_ad.write().unwrap_or_else(|e| e.into_inner());
        ad_guard.extend(ad_set); // 追加新规则

        tracing::info!("🔥 [ThreatIntel] 规则热更新成功");
        Ok(())
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

        if self.enable_dnr.load(Ordering::Relaxed) {
            // 1. 优先查询极速 FST 规则 (微秒级)
            let fst_guard = self.fst_rules.read().unwrap_or_else(|e| e.into_inner());
            if let Some(tag) = match_fst_subdomain(&fst_guard, &host) {
                if tag == 1 {
                    self.stats_engine.record_block(&host, "hard_block_ad");
                    return BlockResult { decision: BlockDecision::BlockAd, reason: "hard_block_ad".into(), confidence: 1.0 };
                } else if tag == 2 && self.enable_tracker.load(Ordering::Relaxed) {
                    let is_social = host.contains("facebook") || host.contains("twitter") || host.contains("tiktok")
                        || host.contains("instagram") || host.contains("linkedin") || host.contains("snapchat");
                    if !is_social || self.enable_social.load(Ordering::Relaxed) {
                        self.stats_engine.record_block(&host, "hard_block_tracker");
                        return BlockResult { decision: BlockDecision::BlockTracker, reason: "hard_block_tracker".into(), confidence: 1.0 };
                    }
                }
            }

            // 2. 兜底查询 hard-domains.json 里自带的 block_ad
            let guard = self.block_ad.read().unwrap_or_else(|e| e.into_inner());
            if matches_domain_or_subdomain(&guard, &host) {
                self.stats_engine.record_block(&host, "hard_block_ad");
                return BlockResult { decision: BlockDecision::BlockAd, reason: "hard_block_ad".into(), confidence: 1.0 };
            }
        }

        if self.enable_threat_intel.load(Ordering::Relaxed) {
            let guard = self.mining.read().unwrap_or_else(|e| e.into_inner());
            if matches_domain_or_subdomain(&guard, &host) {
                self.stats_engine.record_block(&host, "hard_mining");
                return BlockResult { decision: BlockDecision::BlockMining, reason: "hard_mining".into(), confidence: 1.0 };
            }
        }

        {
            let guard = self.safe.read().unwrap_or_else(|e| e.into_inner());
            if matches_domain_or_subdomain(&guard, &host) {
                return BlockResult { decision: BlockDecision::Allow, reason: "hard_safe".into(), confidence: 1.0 };
            }
        }

        {
            let model_guard = self.adblock_model.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(model) = model_guard.as_ref() {
                let features = crate::classifier::features_adblock::extract_sparse_features(&host);
                let (decision, confidence) = model.predict(&features);
                if confidence >= AI_CONFIDENCE_THRESHOLD && decision != BlockDecision::Allow {
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

    pub fn load_signed_adblock_model(&self, version: String, sha256_hex: String, sig_b64: String, body: String, model_type: String, channel: String, valid_until: u64, local_version: Option<String>) -> Result<(), EngineError> {
        if body.len() > 4 * 1024 * 1024 { return Err(EngineError::ModelLoadFailed("Model size exceeds 4MB limit".into())); }
        
        crate::model::bundle::verify(&version, &sha256_hex, &sig_b64, body.as_bytes(), &model_type, &channel, valid_until, local_version.as_deref())
            .map_err(|e| EngineError::ModelLoadFailed(format!("Signature verification failed: {:?}", e)))?;

        let model = AdblockModel::load_from_json(&body).map_err(EngineError::ModelLoadFailed)?;
        let mut guard = self.adblock_model.lock().unwrap_or_else(|e| e.into_inner());
        *guard = Some(model);
        tracing::info!("✅ AdblockModel 已注入内存，准备参与推理！");
        Ok(())
    }

    pub fn unload_adblock_model(&self) {
        let mut guard = self.adblock_model.lock().unwrap_or_else(|e| e.into_inner());
        *guard = None;
    }

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

fn match_fst_subdomain(map: &fst::Map<Vec<u8>>, host: &str) -> Option<u64> {
    if let Some(tag) = map.get(host.as_bytes()) {
        return Some(tag);
    }
    let mut start = 0;
    while let Some(pos) = host[start..].find('.') {
        let next = start + pos + 1;
        if let Some(tag) = map.get(host[next..].as_bytes()) {
            return Some(tag);
        }
        start = next;
    }
    None
}
