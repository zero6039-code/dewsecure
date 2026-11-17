use crate::{EngineConfig, EngineError};
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex, RwLock, OnceLock};
use std::sync::atomic::{AtomicBool, Ordering};
use crate::model::adblock::AdblockModel;
use crate::stats::StatsEngine;
use crate::rules::HardDomainsFile;

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum BlockDecision {
    Allow,
    BlockAd,
    BlockTracker,
    BlockMining,
    BlockPhishing,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct BlockResult {
    pub decision: BlockDecision,
    pub reason: String,
    pub confidence: f32,
}

pub static GLOBAL_HOST_ENGINE: OnceLock<Arc<HostEngine>> = OnceLock::new();

pub const AI_CONFIDENCE_THRESHOLD: f32 = 0.8;

const HARD_DOMAINS_JSON: &str = include_str!("../../shared/adblock/hard-domains.json");
const DOMAIN_RULES_FST: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/rules.fst"));

#[derive(uniffi::Object)]
pub struct HostEngine {
    pub _config: EngineConfig,
    pub fst_rules: Arc<RwLock<fst::Map<Vec<u8>>>>,
    pub safe: Arc<RwLock<HashSet<String>>>,
    pub block_ad: Arc<RwLock<HashSet<String>>>,
    pub block_tracker: Arc<RwLock<HashSet<String>>>,
    pub mining: Arc<RwLock<HashSet<String>>>,
    pub user_allow: Arc<Mutex<HashSet<String>>>,
    pub adblock_model: Arc<Mutex<Option<AdblockModel>>>,
    pub stats_engine: Arc<StatsEngine>,
    pub enable_dnr: Arc<AtomicBool>,
    pub enable_tracker: Arc<AtomicBool>,
    pub enable_social: Arc<AtomicBool>,
    pub enable_threat_intel: Arc<AtomicBool>,
    pub enable_ai_phishing: Arc<AtomicBool>,
    pub enable_ai_zero_day: Arc<AtomicBool>,
}

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

const PUBLIC_SUFFIXES: &[&str] = &[
    "com","net","org","io","co","cn","uk","gov","edu","mil","int","info","biz",
    "dev","app","me","tv","xyz","top","site","online","club","shop","store",
    "tech","ai","cloud","live","link","pro","vip","win","loan","work","life",
    "world","today","space","website","fun","icu","cc","ws","am","fm","ly","to",
    "gg","so","sh","ac","la","in","us","ca","de","fr","jp","kr","ru","br","au",
    "nz","za","mx","es","it","nl","be","ch","at","se","no","dk","fi","pl","cz",
    "gr","pt","ie","co.uk","org.uk","ac.uk","gov.uk","com.cn","net.cn","org.cn",
    "gov.cn","com.hk","com.tw","co.jp","co.kr","com.au","net.au","org.au",
    "co.nz","com.br","com.mx","com.sg","com.my","co.in","co.id","co.th","co.za",
];

fn is_public_suffix(d: &str) -> bool {
    PUBLIC_SUFFIXES.contains(&d)
}

pub fn normalize_domain(s: &str) -> String {
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
                if let Ok(rules) = serde_json::from_str::<crate::rules::DomainRulesFile>(&json_str) {
                    block_ad.extend(normalize_set(rules.ad));
                }
            }
        }

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

    pub fn user_allow(&self, domain: String) {
        let h = normalize_domain(&domain);
        if h.is_empty() || is_public_suffix(&h) {
            return;
        }
        let mut guard = self.user_allow.lock().unwrap_or_else(|e| e.into_inner());
        guard.insert(h);
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
            if !h.is_empty() && !is_public_suffix(&h) {
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
