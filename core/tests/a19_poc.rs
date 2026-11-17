use dewsecure_core::engine_host::{HostEngine, BlockDecision};
use dewsecure_core::EngineConfig;

fn make_engine() -> HostEngine {
    HostEngine::new(EngineConfig {
        rule_data: String::new(),
        model_path: String::new(),
        ai_enabled: false,
        base_dir: std::env::temp_dir().to_string_lossy().into_owned(),
    }).expect("init")
}

#[test]
fn test_a19_mining_cannot_be_whitelisted() {
    let e = make_engine();
    e.user_allow("coinhive.com".to_string());
    let r = e.should_block("coinhive.com".to_string());
    // 恶意域名即使在白名单也必须被拦截
    assert_eq!(r.decision, BlockDecision::BlockMining);
}

#[test]
fn test_a19_user_allow_overrides_ad() {
    let e = make_engine();
    e.user_allow("doubleclick.net".to_string());
    let r = e.should_block("doubleclick.net".to_string());
    // 白名单可放行广告/追踪（保持原有语义）
    assert_eq!(r.decision, BlockDecision::Allow);
    assert_eq!(r.reason, "user_allow");
}

#[test]
fn test_a19_public_suffix_rejected() {
    let e = make_engine();
    e.load_user_whitelist(vec!["com".into(), "co.uk".into(), "ok.example.com".into()]);
    let list = e.get_user_allow_list();
    // 公共后缀应被丢弃，只保留合法域名
    assert_eq!(list.len(), 1);
    assert_eq!(list[0], "ok.example.com");
}
