use crate::engine_host::{HostEngine, BlockDecision, BlockResult, normalize_domain, AI_CONFIDENCE_THRESHOLD};
use std::sync::atomic::Ordering;

#[uniffi::export]
impl HostEngine {
    pub fn should_block(&self, domain: String) -> BlockResult {
        let host = normalize_domain(&domain);
        if host.is_empty() {
            return BlockResult { decision: BlockDecision::Allow, reason: "default_allow".into(), confidence: 0.0 };
        }

        // ── A-19 修复：恶意/钓鱼/挖矿先于用户放行；白名单仅覆盖广告/追踪 ──

        // 1) 恶意类：挖矿 / 威胁情报（先于 user_allow）
        if self.enable_threat_intel.load(Ordering::Relaxed) {
            let guard = self.mining.read().unwrap_or_else(|e| e.into_inner());
            if matches_domain_or_subdomain(&guard, &host) {
                self.stats_engine.record_block(&host, "hard_mining");
                return BlockResult { decision: BlockDecision::BlockMining, reason: "hard_mining".into(), confidence: 1.0 };
            }
        }

        // 2) 钓鱼启发式（先于 user_allow）
        if self.enable_ai_phishing.load(Ordering::Relaxed) {
            let parts: Vec<&str> = host.split('.').collect();
            if parts.len() >= 2 {
                let is_suspicious = host.contains("login") || host.contains("verify") || host.contains("secure") || host.contains("account") || host.contains("update");
                let has_many_hyphens = host.matches('-').count() > 2;
                let tld = parts.last().unwrap();
                let suspicious_tld = ["xyz", "top", "pw", "cc", "tk"].contains(tld);
                if is_suspicious && (has_many_hyphens || suspicious_tld) {
                    self.stats_engine.record_block(&host, "ai_phishing");
                    return BlockResult { decision: BlockDecision::BlockPhishing, reason: "ai_phishing_heuristic".into(), confidence: 0.85 };
                }
            }
        }

        // 3) 用户放行名单（仅对广告/追踪生效）
        {
            let user_allow_guard = self.user_allow.lock().unwrap_or_else(|e| e.into_inner());
            if matches_domain_or_subdomain(&user_allow_guard, &host) {
                return BlockResult { decision: BlockDecision::Allow, reason: "user_allow".into(), confidence: 1.0 };
            }
        }

        // 4) 广告 / 追踪（FST + hard-domains.json）
        if self.enable_dnr.load(Ordering::Relaxed) {
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
            let guard = self.block_ad.read().unwrap_or_else(|e| e.into_inner());
            if matches_domain_or_subdomain(&guard, &host) {
                self.stats_engine.record_block(&host, "hard_block_ad");
                return BlockResult { decision: BlockDecision::BlockAd, reason: "hard_block_ad".into(), confidence: 1.0 };
            }
        }

        // 5) 安全域名
        {
            let guard = self.safe.read().unwrap_or_else(|e| e.into_inner());
            if matches_domain_or_subdomain(&guard, &host) {
                return BlockResult { decision: BlockDecision::Allow, reason: "hard_safe".into(), confidence: 1.0 };
            }
        }

        // 6) AI 广告模型
        {
            let model_guard = self.adblock_model.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(model) = model_guard.as_ref() {
                let features = crate::classifier::features_adblock::extract_sparse_features(&host);
                let (decision, confidence) = model.predict(&features);
                if confidence >= AI_CONFIDENCE_THRESHOLD && decision != BlockDecision::Allow {
                    let is_ai_enabled = match decision {
                        BlockDecision::BlockAd => self.enable_ai_zero_day.load(Ordering::Relaxed),
                        BlockDecision::BlockTracker => self.enable_tracker.load(Ordering::Relaxed),
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
}

pub fn matches_domain_or_subdomain(set: &std::collections::HashSet<String>, host: &str) -> bool {
    if set.contains(host) { return true; }
    let mut start = 0;
    while let Some(pos) = host[start..].find('.') {
        let next = start + pos + 1;
        if set.contains(&host[next..]) { return true; }
        start = next;
    }
    false
}

pub fn match_fst_subdomain(map: &fst::Map<Vec<u8>>, host: &str) -> Option<u64> {
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
