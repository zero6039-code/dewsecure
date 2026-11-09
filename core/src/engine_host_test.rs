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

#[cfg(test)]
mod c6_tests {
    use super::*;
    use crate::EngineConfig;

    #[test]
    fn test_c6_safe_list_does_not_bypass_blocks() {
        let config = EngineConfig {
            rule_data: "".to_string(),
            model_path: "".to_string(),
            ai_enabled: false,
        };
        let engine = HostEngine::new(config).unwrap();

        // 1. ads.google.com 虽然在 google.com(safe) 下，但属于广告域，必须拦截
        let res_ad = engine.should_block("ads.google.com".to_string());
        assert!(matches!(res_ad.decision, BlockDecision::BlockAd), "ads.google.com 必须被拦截，不能因 safe 绕过");

        // 2. pixel.facebook.com 虽然在 facebook.com(safe) 下，但属于追踪域，必须拦截
        let res_trk = engine.should_block("pixel.facebook.com".to_string());
        assert!(matches!(res_trk.decision, BlockDecision::BlockTracker), "pixel.facebook.com 必须被拦截");

        // 3. 正常子域应该被放行 (如 www.google.com)
        let res_safe = engine.should_block("www.google.com".to_string());
        assert!(matches!(res_safe.decision, BlockDecision::Allow), "www.google.com 应该被放行");

        // 4. 之前被移除的 UGC 域，不再拥有最高豁免权（视规则情况拦截或查AI）
        let res_ugc = engine.should_block("aliyuncs.com".to_string());
        assert!(!matches!(res_ugc.reason.as_str(), "hard_safe"), "aliyuncs.com 不能因为是 UGC 平台就无条件放行");

        println!("✅ C-6 PoC 成功：优先级修正生效，safe 列表无法包庇恶意子域");
    }
}
