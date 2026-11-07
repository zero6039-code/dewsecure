//! HostEngine：Android DNS 拦截的主入口
//!
//! A0-6c：在 A0-6b-1 硬规则之上加入用户白名单。
//! 优先级：user_allow > safe > block_ad > block_tracker > mining > 默认放行。
//! AI 推理（T1）在 A0-6b-2 加入，插在 mining 之后、默认放行之前。
//!
//! 输入契约：`should_block(domain)` 接收纯域名（如 `google.com`）。
//! 内部做 lowercase + 去尾点 + 后缀匹配。
//!
//! 数据来源：`shared/adblock/hard-domains.json` 编译期内嵌。
//! 用户白名单不持久化——Kotlin 侧负责存储（SharedPreferences），
//! 启动时通过 `load_user_whitelist` 批量注入。

use crate::{EngineConfig, EngineError};
use serde::Deserialize;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use crate::model::adblock::AdblockModel;

/// 域名级拦截决策。与 UDL `enum BlockDecision` 一一对应。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BlockDecision {
    Allow,
    BlockAd,
    BlockTracker,
    BlockMining,
}

/// 拦截结果。与 UDL `dictionary BlockResult` 一一对应。
#[derive(Debug, Clone)]
pub struct BlockResult {
    pub decision: BlockDecision,
    /// 取值：`user_allow` / `hard_safe` / `hard_block_ad` / `hard_block_tracker` / `hard_mining` / `default_allow`
    /// （A0-6b-2 加 `ai_ad` / `ai_tracker`）
    pub reason: String,
    /// 硬规则为 1.0；AI 为 softmax 最大概率；默认放行为 0.0
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

/// domain-rules.json 的结构（DNR 导出的纯域名列表）
#[derive(Debug, Deserialize)]
struct DomainRulesFile {
    ad: Vec<String>,
    tracker: Vec<String>,
}

/// Android DNS 拦截引擎。
pub struct HostEngine {
    _config: EngineConfig,
    safe: HashSet<String>,
    block_ad: HashSet<String>,
    block_tracker: HashSet<String>,
    mining: HashSet<String>,
    /// 用户白名单。优先级最高，由 Kotlin 侧存储和注入。
    /// 用 Arc<Mutex<_>> 因为 UniFFI include_scaffolding! 模式只支持 &self 方法，
    /// 与现有 DewEngine::add_custom_rule 的模式一致。
    user_allow: Arc<Mutex<HashSet<String>>>,
    /// T1 模型（可选，运行时通过 `set_adblock_model` 加载）
    adblock_model: Arc<Mutex<Option<AdblockModel>>>,
}

const HARD_DOMAINS_JSON: &str =
    include_str!("../../shared/adblock/hard-domains.json");
const DOMAIN_RULES_JSON: &str =
    include_str!("../../shared/adblock/domain-rules.json");

/// T1 AI 拦截阈值（与 ai.js 的 0.8 对齐）
const AI_CONFIDENCE_THRESHOLD: f32 = 0.8;

/// 统一规范化：trim + 去尾点 + lowercase。
fn normalize_domain(s: &str) -> String {
    s.trim().trim_end_matches('.').to_lowercase()
}

impl HostEngine {
    pub fn new(config: EngineConfig) -> Result<Self, EngineError> {
        tracing::info!("初始化 HostEngine（A0-6c 硬规则 + 用户白名单）");

        let parsed: HardDomainsFile = serde_json::from_str(HARD_DOMAINS_JSON)
            .map_err(|e| EngineError::InitializationFailed(format!(
                "hard-domains.json 解析失败: {}", e
            )))?;

        let parsed_domain_rules: DomainRulesFile = serde_json::from_str(DOMAIN_RULES_JSON)
            .map_err(|e| EngineError::InitializationFailed(format!(
                "domain-rules.json 解析失败: {}", e
            )))?;

        let normalize_set = |v: Vec<String>| -> HashSet<String> {
            v.into_iter()
                .map(|s| normalize_domain(&s))
                .filter(|s| !s.is_empty())
                .collect()
        };

        // 合并手工硬规则和 DNR 导出的域名规则
        let mut all_ad = parsed.block.ad;
        all_ad.extend(parsed_domain_rules.ad);

        let mut all_tracker = parsed.block.tracker;
        all_tracker.extend(parsed_domain_rules.tracker);

        tracing::info!(
            "加载规则完成: safe={}, block_ad={}, block_tracker={}, mining={}",
            parsed.safe.len(), all_ad.len(), all_tracker.len(), parsed.mining.len()
        );

        Ok(Self {
            _config: config,
            safe: normalize_set(parsed.safe),
            block_ad: normalize_set(all_ad),
            block_tracker: normalize_set(all_tracker),
            mining: normalize_set(parsed.mining),
            user_allow: Arc::new(Mutex::new(HashSet::new())),
            adblock_model: Arc::new(Mutex::new(None)),
        })
    }

    /// 硬规则 + 用户白名单判定。
    /// 优先级：user_allow > safe > block_ad > block_tracker > mining > 默认放行。
    /// AI（T1）将在 A0-6b-2 插入到 mining 之后、默认放行之前。
    pub fn should_block(&self, domain: String) -> BlockResult {
        let host = normalize_domain(&domain);

        if host.is_empty() {
            return BlockResult {
                decision: BlockDecision::Allow,
                reason: "default_allow".to_string(),
                confidence: 0.0,
            };
        }

        // 0. 用户白名单（最高优先级）
        let user_allow_guard = self.user_allow.lock().unwrap_or_else(|e| e.into_inner());
        if matches_domain_or_subdomain(&user_allow_guard, &host) {
            return BlockResult {
                decision: BlockDecision::Allow,
                reason: "user_allow".to_string(),
                confidence: 1.0,
            };
        }

        // 1. 硬白名单
        if matches_domain_or_subdomain(&self.safe, &host) {
            return BlockResult {
                decision: BlockDecision::Allow,
                reason: "hard_safe".to_string(),
                confidence: 1.0,
            };
        }

        // 2. 广告硬规则
        if matches_domain_or_subdomain(&self.block_ad, &host) {
            return BlockResult {
                decision: BlockDecision::BlockAd,
                reason: "hard_block_ad".to_string(),
                confidence: 1.0,
            };
        }

        // 3. 追踪硬规则
        if matches_domain_or_subdomain(&self.block_tracker, &host) {
            return BlockResult {
                decision: BlockDecision::BlockTracker,
                reason: "hard_block_tracker".to_string(),
                confidence: 1.0,
            };
        }

        // 4. 挖矿硬规则
        if matches_domain_or_subdomain(&self.mining, &host) {
            return BlockResult {
                decision: BlockDecision::BlockMining,
                reason: "hard_mining".to_string(),
                confidence: 1.0,
            };
        }

        // 5. T1 AI 推理（如果模型已加载）
        {
            let model_guard = self.adblock_model.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(model) = model_guard.as_ref() {
                let features =
                    crate::classifier::features_adblock::extract_sparse_features(&host);
                let (decision, confidence) = model.predict(&features);
                if confidence >= AI_CONFIDENCE_THRESHOLD && decision != BlockDecision::Allow {
                    let reason = match decision {
                        BlockDecision::BlockAd => "ai_ad",
                        BlockDecision::BlockTracker => "ai_tracker",
                        _ => "ai_other",
                    };
                    return BlockResult {
                        decision,
                        reason: reason.to_string(),
                        confidence,
                    };
                }
            }
        }

        // 6. 默认放行
        BlockResult {
            decision: BlockDecision::Allow,
            reason: "default_allow".to_string(),
            confidence: 0.0,
        }
    }

    // ───────── A0-6c：用户白名单管理 ─────────

    /// 添加用户白名单。空字符串或纯空白会被忽略。
    pub fn user_allow(&self, domain: String) {
        let h = normalize_domain(&domain);
        if !h.is_empty() {
            let mut guard = self.user_allow.lock().unwrap_or_else(|e| e.into_inner());
            guard.insert(h);
        }
    }

    /// 移除用户白名单。不存在的域名静默忽略。
    pub fn user_remove_allow(&self, domain: String) {
        let h = normalize_domain(&domain);
        let mut guard = self.user_allow.lock().unwrap_or_else(|e| e.into_inner());
        guard.remove(&h);
    }

    /// 批量加载用户白名单（替换现有内容）。
    /// App 启动时从 SharedPreferences 读出 Vec<String> 调用此方法。
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

    /// 返回当前用户白名单（排序后，便于 UI 显示）。
    pub fn get_user_allow_list(&self) -> Vec<String> {
        let guard = self.user_allow.lock().unwrap_or_else(|e| e.into_inner());
        let mut v: Vec<String> = guard.iter().cloned().collect();
        v.sort();
        v
    }

    /// A0-6b-2：运行时加载/替换 T1 模型（不在 UDL 中暴露）。
    ///
    /// - 本地开发：`cargo test -- --ignored` 前置加载
    /// - 生产环境：A0-7 Kotlin 验签通过后调用
    pub fn set_adblock_model(&self, json: &str) -> Result<(), EngineError> {
        let model = AdblockModel::load_from_json(json)
            .map_err(EngineError::ModelLoadFailed)?;
        let mut guard = self.adblock_model.lock().unwrap_or_else(|e| e.into_inner());
        *guard = Some(model);
        Ok(())
    }
}

/// `host` 是否等于 `set` 中的某个域名，或是其后缀子域。
/// `foo.doubleclick.net` 对 `{doubleclick.net}` 返回 true。
/// `notdoubleclick.net` 对 `{doubleclick.net}` 返回 false。
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

    // ───────── A0-6b-1 硬规则测试（原 13 个，保留） ─────────

    #[test]
    fn engine_loads_hard_domains() {
        let e = make_engine();
        assert!(e.safe.contains("google.com"));
        assert!(e.block_ad.contains("doubleclick.net"));
        assert!(e.block_tracker.contains("google-analytics.com"));
        assert!(e.mining.contains("coinhive.com"));
    }

    #[test]
    fn safe_domain_allowed() {
        let r = make_engine().should_block("google.com".to_string());
        assert_eq!(r.decision, BlockDecision::Allow);
        assert_eq!(r.reason, "hard_safe");
    }

    #[test]
    fn safe_subdomain_allowed() {
        let r = make_engine().should_block("apis.google.com".to_string());
        assert_eq!(r.decision, BlockDecision::Allow);
        assert_eq!(r.reason, "hard_safe");
    }

    #[test]
    fn block_ad_domain() {
        let r = make_engine().should_block("doubleclick.net".to_string());
        assert_eq!(r.decision, BlockDecision::BlockAd);
        assert_eq!(r.reason, "hard_block_ad");
    }

    #[test]
    fn block_ad_subdomain() {
        let r = make_engine().should_block("ad.doubleclick.net".to_string());
        assert_eq!(r.decision, BlockDecision::BlockAd);
    }

    #[test]
    fn block_tracker_domain() {
        let r = make_engine().should_block("google-analytics.com".to_string());
        assert_eq!(r.decision, BlockDecision::BlockTracker);
        assert_eq!(r.reason, "hard_block_tracker");
    }

    #[test]
    fn block_mining_domain() {
        let r = make_engine().should_block("coinhive.com".to_string());
        assert_eq!(r.decision, BlockDecision::BlockMining);
        assert_eq!(r.reason, "hard_mining");
    }

    #[test]
    fn default_allow() {
        let r = make_engine().should_block("example.com".to_string());
        assert_eq!(r.decision, BlockDecision::Allow);
        assert_eq!(r.reason, "default_allow");
        assert_eq!(r.confidence, 0.0);
    }

    #[test]
    fn safe_priority_over_block() {
        let r = make_engine().should_block("google.com".to_string());
        assert_eq!(r.decision, BlockDecision::Allow);
        assert_eq!(r.reason, "hard_safe");
    }

    #[test]
    fn case_insensitive() {
        let r = make_engine().should_block("DOUBLECLICK.NET".to_string());
        assert_eq!(r.decision, BlockDecision::BlockAd);
    }

    #[test]
    fn trailing_dot_stripped() {
        let r = make_engine().should_block("doubleclick.net.".to_string());
        assert_eq!(r.decision, BlockDecision::BlockAd);
    }

    #[test]
    fn empty_domain_allowed() {
        let r = make_engine().should_block(String::new());
        assert_eq!(r.decision, BlockDecision::Allow);
        assert_eq!(r.reason, "default_allow");
    }

    #[test]
    fn no_false_substring_match() {
        let r = make_engine().should_block("notdoubleclick.net".to_string());
        assert_eq!(r.decision, BlockDecision::Allow);
        assert_eq!(r.reason, "default_allow");
    }

    // ───────── A0-6c 用户白名单测试（新增 13 个） ─────────

    #[test]
    fn user_allow_overrides_block() {
        let e = make_engine();
        e.user_allow("doubleclick.net".to_string());
        let r = e.should_block("doubleclick.net".to_string());
        assert_eq!(r.decision, BlockDecision::Allow);
        assert_eq!(r.reason, "user_allow");
    }

    #[test]
    fn user_allow_overrides_mining() {
        let e = make_engine();
        e.user_allow("coinhive.com".to_string());
        let r = e.should_block("coinhive.com".to_string());
        assert_eq!(r.decision, BlockDecision::Allow);
        assert_eq!(r.reason, "user_allow");
    }

    #[test]
    fn user_allow_overrides_tracker() {
        let e = make_engine();
        e.user_allow("google-analytics.com".to_string());
        let r = e.should_block("google-analytics.com".to_string());
        assert_eq!(r.reason, "user_allow");
    }

    #[test]
    fn user_remove_allow_restores_block() {
        let e = make_engine();
        e.user_allow("doubleclick.net".to_string());
        e.user_remove_allow("doubleclick.net".to_string());
        let r = e.should_block("doubleclick.net".to_string());
        assert_eq!(r.decision, BlockDecision::BlockAd);
        assert_eq!(r.reason, "hard_block_ad");
    }

    #[test]
    fn user_allow_subdomain_matches() {
        let e = make_engine();
        e.user_allow("example.com".to_string());
        // sub.example.com 也受 user_allow 保护
        let r = e.should_block("sub.example.com".to_string());
        assert_eq!(r.decision, BlockDecision::Allow);
        assert_eq!(r.reason, "user_allow");
    }

    #[test]
    fn user_allow_case_insensitive() {
        let e = make_engine();
        e.user_allow("EXAMPLE.COM".to_string());
        let r = e.should_block("example.com".to_string());
        assert_eq!(r.reason, "user_allow");
    }

    #[test]
    fn user_allow_empty_string_ignored() {
        let e = make_engine();
        e.user_allow(String::new());
        e.user_allow("   ".to_string());
        assert!(e.get_user_allow_list().is_empty());
    }

    #[test]
    fn load_user_whitelist_replaces() {
        let e = make_engine();
        e.user_allow("old.com".to_string());
        e.load_user_whitelist(vec!["a.com".to_string(), "b.com".to_string()]);
        let list = e.get_user_allow_list();
        assert_eq!(list.len(), 2);
        assert!(list.contains(&"a.com".to_string()));
        assert!(list.contains(&"b.com".to_string()));
        assert!(!list.contains(&"old.com".to_string()));
    }

    #[test]
    fn load_user_whitelist_empty_clears() {
        let e = make_engine();
        e.user_allow("a.com".to_string());
        e.load_user_whitelist(vec![]);
        assert!(e.get_user_allow_list().is_empty());
    }

    #[test]
    fn get_user_allow_list_sorted() {
        let e = make_engine();
        e.user_allow("z.com".to_string());
        e.user_allow("a.com".to_string());
        e.user_allow("m.com".to_string());
        let list = e.get_user_allow_list();
        assert_eq!(list, vec!["a.com", "m.com", "z.com"]);
    }

    #[test]
    fn get_user_allow_list_empty() {
        let e = make_engine();
        assert!(e.get_user_allow_list().is_empty());
    }

    #[test]
    fn user_allow_then_get_list_consistent() {
        let e = make_engine();
        e.user_allow("x.com".to_string());
        let list = e.get_user_allow_list();
        assert_eq!(list, vec!["x.com"]);
    }

    #[test]
    fn get_user_allow_list_immutable_snapshot() {
        let e = make_engine();
        e.user_allow("a.com".to_string());
        let mut list = e.get_user_allow_list();
        list.push("injected.com".to_string());
        // 修改返回值不应影响内部状态
        let list2 = e.get_user_allow_list();
        assert_eq!(list2, vec!["a.com"]);
    }

    // ───────── A0-6b-2：T1 AI 分支 ─────────

    fn install_all_ad_model(e: &HostEngine) {
        // 让 Ad 类恒占优的 mock 模型：coef[1] 全 100
        let mut coef = vec![vec![0.0f32; 16418]; 3];
        for x in coef[1].iter_mut() {
            *x = 100.0;
        }
        let model = AdblockModel::from_arrays(coef, vec![0.0f32; 3])
            .expect("mock 模型构造失败");
        *e.adblock_model.lock().unwrap_or_else(|err| err.into_inner()) = Some(model);
    }

    #[test]
    fn ai_skipped_when_no_model_loaded() {
        let e = make_engine();
        let r = e.should_block("random-unblocked.test".to_string());
        assert_eq!(r.decision, BlockDecision::Allow);
        assert_eq!(r.reason, "default_allow");
    }

    #[test]
    fn ai_branch_blocks_with_loaded_model() {
        let e = make_engine();
        install_all_ad_model(&e);

        let r = e.should_block("random-unblocked.test".to_string());
        assert_eq!(r.decision, BlockDecision::BlockAd);
        assert_eq!(r.reason, "ai_ad");
        assert!(r.confidence > 0.99);
    }

    #[test]
    fn ai_branch_does_not_override_hard_safe() {
        let e = make_engine();
        install_all_ad_model(&e);

        // google.com 在 hard_safe，硬规则优先于 AI
        let r = e.should_block("google.com".to_string());
        assert_eq!(r.decision, BlockDecision::Allow);
        assert_eq!(r.reason, "hard_safe");
    }

    #[test]
    fn hard_block_takes_priority_over_ai() {
        // 证明生产路径：doubleclick.net 即使 AI 误判 Normal，
        // 也会被 hard_block_ad 提前拦截
        let e = make_engine();
        // 装一个"全判 Normal"的模型：coef 全 0 → logits = intercept 全 0
        // → softmax 均分 → argmax = 0 (Normal)
        let coef = vec![vec![0.0f32; 16418]; 3];
        let model = AdblockModel::from_arrays(coef, vec![0.0f32; 3]).unwrap();
        *e.adblock_model.lock().unwrap_or_else(|err| err.into_inner()) = Some(model);

        let r = e.should_block("doubleclick.net".to_string());
        assert_eq!(r.decision, BlockDecision::BlockAd);
        assert_eq!(r.reason, "hard_block_ad");
    }
}
