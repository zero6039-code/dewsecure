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
        // [A-01] 载荷大小上限
        if payload.len() > 8 * 1024 * 1024 {
            return Err(EngineError::InvalidRule("规则载荷过大".into()));
        }

        // 1. SHA-256 校验
        let mut hasher = Sha256::new();
        hasher.update(payload.as_bytes());
        let real_sha256 = hex::encode(hasher.finalize());
        if real_sha256 != expected_sha256 {
            return Err(EngineError::InvalidRule("SHA-256 校验失败".into()));
        }

        // 2. Ed25519 强制验签：任何失败都拒绝，绝不降级
        if !msg_str.ends_with(&format!(":{}", expected_sha256)) {
            return Err(EngineError::InvalidRule("被签消息未绑定载荷哈希".into()));
        }
        let pub_key_arr: [u8; 32] = hex::decode(ED25519_PUBLIC_KEY_HEX)
            .ok()
            .and_then(|v| v.try_into().ok())
            .ok_or_else(|| EngineError::InvalidRule("内置公钥无效".into()))?;
        let verifying_key = VerifyingKey::from_bytes(&pub_key_arr)
            .map_err(|_| EngineError::InvalidRule("内置公钥无效".into()))?;
        let sig_bytes = BASE64.decode(sig_b64.trim())
            .map_err(|_| EngineError::InvalidRule("签名编码无效".into()))?;
        let signature = Signature::from_slice(&sig_bytes)
            .map_err(|_| EngineError::InvalidRule("签名长度无效".into()))?;
        verifying_key.verify(msg_str.as_bytes(), &signature)
            .map_err(|_| EngineError::InvalidRule("Ed25519 验签失败".into()))?;

        // 3. 解析规则（兼容安卓的 ad/tracker 格式 或 云端的 DNR 格式）
        let mut ad_set = HashSet::new();

        if let Ok(rules) = serde_json::from_str::<DomainRulesFile>(&payload) {
            for d in rules.ad {
                ad_set.insert(normalize_domain(&d));
            }
        } else {
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

        // 4. 写入本地磁盘缓存（原子写盘：tmp + rename）
        let cloud_rules_path = Path::new(&self._config.base_dir).join("cloud_rules.json");
        let cache_struct = DomainRulesFile {
            ad: ad_set.iter().cloned().collect(),
            tracker: vec![],
        };
        if let Ok(json_str) = serde_json::to_string(&cache_struct) {
            let tmp_path = cloud_rules_path.with_extension("json.tmp");
            if let Err(e) = fs::write(&tmp_path, &json_str)
                .and_then(|_| fs::rename(&tmp_path, &cloud_rules_path))
            {
                tracing::warn!("规则缓存写盘失败: {}", e);
            }
        }

        // 5. 合并到内存中（绝不覆盖原有 FST 与 hard-domains）
        let mut ad_guard = self.block_ad.write().unwrap_or_else(|e| e.into_inner());
        ad_guard.extend(ad_set);

        tracing::info!("🔥 [ThreatIntel] 规则热更新成功");
        Ok(())
    }
}
