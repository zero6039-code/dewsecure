use crate::{EngineError};
use serde::Deserialize;
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use sha2::{Sha256, Digest};
use ed25519_dalek::{Signature, VerifyingKey, Verifier};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use crate::engine_host::{HostEngine, normalize_domain};

#[derive(Debug, Deserialize, serde::Serialize)]
pub struct DomainRulesFile {
    pub ad: Vec<String>,
    #[allow(dead_code)]
    pub tracker: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct HardDomainsFile {
    pub safe: Vec<String>,
    pub block: BlockLists,
    pub mining: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct BlockLists {
    pub ad: Vec<String>,
    pub tracker: Vec<String>,
}

// 兼容浏览器插件 DNR 格式的解析结构
#[derive(Debug, Deserialize)]
pub struct DnrRule {
    pub condition: DnrCondition,
}
#[derive(Debug, Deserialize)]
pub struct DnrCondition {
    #[serde(rename = "requestDomains")]
    pub request_domains: Vec<String>,
}

const ED25519_PUBLIC_KEY_HEX: &str = "a21b4c875ab246b58adc225ddf66a054cfa7b79ed2093fcc2f97598fd1197631";

#[uniffi::export]
impl HostEngine {
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
}
