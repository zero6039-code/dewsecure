use super::*;

fn make_engine() -> HostEngine {
    HostEngine::new(EngineConfig {
        rule_data: String::new(),
        model_path: String::new(),
        ai_enabled: false,
    }).expect("HostEngine::new 不应失败")
}

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
fn block_ad_domain() {
    let r = make_engine().should_block("doubleclick.net".to_string());
    assert_eq!(r.decision, BlockDecision::BlockAd);
    assert_eq!(r.reason, "hard_block_ad");
}

#[test]
fn user_allow_overrides_block() {
    let e = make_engine();
    e.user_allow("doubleclick.net".to_string());
    let r = e.should_block("doubleclick.net".to_string());
    assert_eq!(r.decision, BlockDecision::Allow);
    assert_eq!(r.reason, "user_allow");
}

#[test]
fn load_user_whitelist_replaces() {
    let e = make_engine();
    e.user_allow("old.com".to_string());
    e.load_user_whitelist(vec!["a.com".to_string(), "b.com".to_string()]);
    let list = e.get_user_allow_list();
    assert_eq!(list.len(), 2);
}

#[test]
fn ai_branch_blocks_with_loaded_model() {
    let e = make_engine();
    let mut coef = vec![vec![0.0f32; 16418]; 3];
    for x in coef[1].iter_mut() { *x = 100.0; }
    let model = AdblockModel::from_arrays(coef, vec![0.0f32; 3]).unwrap();
    *e.adblock_model.lock().unwrap_or_else(|err| err.into_inner()) = Some(model);

    let r = e.should_block("random-unblocked.test".to_string());
    assert_eq!(r.decision, BlockDecision::BlockAd);
    assert_eq!(r.reason, "ai_ad");
}
