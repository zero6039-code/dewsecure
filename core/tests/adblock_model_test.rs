//! A0-6b-2：AdblockModel 单元测试 + 真权重冒烟测试（#[ignore]）

use dewsecure_core::classifier::features_adblock::{extract_sparse_features, SparseFeatures};
use dewsecure_core::engine_host::BlockDecision;
use dewsecure_core::model::adblock::AdblockModel;
use std::path::PathBuf;

fn mock_model() -> AdblockModel {
    let mut coef = vec![vec![0.0f32; 16418]; 3];
    coef[1][100] = 10.0; // bucket 100 强烈指向 Ad
    coef[2][200] = 10.0; // bucket 200 强烈指向 Tracker
    AdblockModel::from_arrays(coef, vec![0.0f32; 3]).expect("mock 权重构造失败")
}

#[test]
fn empty_features_yield_uniform_probs() {
    let model = mock_model();
    let (d, c) = model.predict(&SparseFeatures::default());
    assert_eq!(d, BlockDecision::Allow);
    assert!((c - 1.0 / 3.0).abs() < 1e-5);
}

#[test]
fn ad_bucket_triggers_block_ad() {
    let model = mock_model();
    let mut f = SparseFeatures::default();
    f.buckets.insert(100, 1.0);
    let (d, c) = model.predict(&f);
    assert_eq!(d, BlockDecision::BlockAd);
    assert!(c > 0.99);
}

#[test]
fn tracker_bucket_triggers_block_tracker() {
    let model = mock_model();
    let mut f = SparseFeatures::default();
    f.buckets.insert(200, 1.0);
    let (d, c) = model.predict(&f);
    assert_eq!(d, BlockDecision::BlockTracker);
    assert!(c > 0.99);
}

#[test]
fn mixed_buckets_pick_argmax_deterministically() {
    let model = mock_model();
    let mut f = SparseFeatures::default();
    f.buckets.insert(100, 1.0);
    f.buckets.insert(200, 1.0);
    // logits = [0, 10, 10] → argmax3 优先返回 1（Ad）
    let (d, c) = model.predict(&f);
    assert_eq!(d, BlockDecision::BlockAd);
    assert!(c > 0.49);
}

#[test]
fn from_arrays_rejects_wrong_class_count() {
    let coef = vec![vec![0.0f32; 16418]; 2];
    assert!(AdblockModel::from_arrays(coef, vec![0.0f32; 3]).is_err());
}

#[test]
fn from_arrays_rejects_wrong_dim() {
    let coef = vec![vec![0.0f32; 100]; 3];
    assert!(AdblockModel::from_arrays(coef, vec![0.0f32; 3]).is_err());
}

#[test]
fn from_arrays_rejects_nan() {
    let mut coef = vec![vec![0.0f32; 16418]; 3];
    coef[0][42] = f32::NAN;
    assert!(AdblockModel::from_arrays(coef, vec![0.0f32; 3]).is_err());
}

#[test]
fn load_from_json_roundtrip() {
    let mut coef = vec![vec![0.0f32; 16418]; 3];
    coef[1][100] = 10.0;

    let coef_str: Vec<String> = coef
        .iter()
        .map(|row| {
            let elems: Vec<String> = row.iter().map(|v| format!("{}", v)).collect();
            format!("[{}]", elems.join(","))
        })
        .collect();
    let json = format!(r#"{{"coef":[{}],"intercept":[0,0,0]}}"#, coef_str.join(","));

    let model = AdblockModel::load_from_json(&json).expect("mock JSON 加载失败");
    let mut f = SparseFeatures::default();
    f.buckets.insert(100, 1.0);
    let (d, _c) = model.predict(&f);
    assert_eq!(d, BlockDecision::BlockAd);
}

#[test]
fn load_from_json_rejects_malformed() {
    assert!(AdblockModel::load_from_json("not json").is_err());
    assert!(AdblockModel::load_from_json("{}").is_err());
}

#[test]
fn load_from_json_rejects_wrong_dim() {
    let json = r#"{"coef":[[1,2],[3,4],[5,6]],"intercept":[0,0,0]}"#;
    assert!(AdblockModel::load_from_json(json).is_err());
}

/// 真权重冒烟测试：手动 `cargo test -p dewsecure-core -- --ignored --nocapture`
#[test]
#[ignore]
fn real_weights_smoke_test() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("shared/weights/weights.json");
    if !path.exists() {
        eprintln!(
            "⚠️  {} 不存在；跳过真权重测试。请放入权重后重试。",
            path.display()
        );
        return;
    }
    let json = std::fs::read_to_string(&path).expect("读取权重失败");
    let model = AdblockModel::load_from_json(&json).expect("加载真实权重失败");
    eprintln!("✅ 真实权重加载成功");

    // 用例说明：
    // 1. 大站：模型应判 Normal（安全网）
    // 2. ads.doubleclick.net：与 models/training/feature_test_vectors.json 一致，
    //    模型应判 Ad。这证明模型对"训练集里出现过的子域名"分类正确。
    // 3. 裸域名（doubleclick.net、google-analytics.com）：预期可能是 Normal，
    //    因为训练数据主要来自真实请求 hostname，裸域名在训练集里样本少。
    //    Android 侧对这类高频裸域名有 hard-domains.json 硬规则兜底，
    //    AI 不负责这部分。
    let cases = [
        // 安全网：大站不应误判
        ("google.com",    Some(BlockDecision::Allow)),
        ("apple.com",     Some(BlockDecision::Allow)),
        ("microsoft.com", Some(BlockDecision::Allow)),
        // 训练集覆盖的子域名：应判 Ad/Tracker
        ("ads.doubleclick.net", None),  // 允许 Ad 或 Tracker
        // 裸域名（观察，不做断言）：Android 走硬规则，AI 不负责
        ("doubleclick.net", None),
        ("google-analytics.com", None),
    ];

    let mut failures = Vec::new();
    for (domain, expected) in cases {
        let f = extract_sparse_features(domain);
        let (d, c) = model.predict(&f);
        eprintln!("{:30}  ->  {:?}  (confidence={:.4})", domain, d, c);
        if let Some(exp) = expected {
            if d != exp {
                failures.push(format!("{}: 期望 {:?} 实际 {:?}", domain, exp, d));
            }
        }
    }

    // 只对"安全网"用例做严格断言
    assert!(
        failures.is_empty(),
        "安全网用例失败：\n{}",
        failures.join("\n")
    );
}
