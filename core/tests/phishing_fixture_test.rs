//! A0-4 夹具对拍：Rust `extract_features` 与 `shared/fixtures/phishing-golden.json` 逐维对齐。

use dewsecure_core::classifier::phishing_features::{extract_features, TOTAL_DIM};
use serde::Deserialize;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
struct Fixture {
    #[serde(rename = "_meta")]
    meta: Meta,
    // key = URL，value = 579 维稠密向量
    vectors: HashMap<String, Vec<f32>>,
}

#[derive(Debug, Deserialize)]
struct Meta {
    total_dim: usize,
    sample_count: usize,
    input_contract: String,
}

fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("shared/fixtures/phishing-golden.json")
}

const TOL: f32 = 1e-5;

#[test]
fn fixture_matches_rust_extraction() {
    let path = fixture_path();
    let raw = fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("读取夹具失败 {}: {}", path.display(), e));
    let fixture: Fixture =
        serde_json::from_str(&raw).unwrap_or_else(|e| panic!("解析夹具失败: {}", e));

    assert_eq!(fixture.meta.total_dim, TOTAL_DIM, "meta.total_dim 不符");
    assert_eq!(
        fixture.vectors.len(),
        fixture.meta.sample_count,
        "样本数与 meta 声明不符"
    );
    assert!(
        fixture.meta.input_contract.contains("full URL"),
        "输入契约应为完整 URL，实际 meta: {}",
        fixture.meta.input_contract
    );

    let mut failures: Vec<String> = Vec::new();

    for (url, golden) in &fixture.vectors {
        if golden.len() != TOTAL_DIM {
            failures.push(format!("{}: golden 维度 {} != {}", url, golden.len(), TOTAL_DIM));
            continue;
        }
        let actual = extract_features(url);
        for i in 0..TOTAL_DIM {
            if (actual[i] - golden[i]).abs() >= TOL {
                failures.push(format!(
                    "{}: dim[{}] rust={} golden={}",
                    url, i, actual[i], golden[i]
                ));
                break; // 每个 URL 只报第一个偏差，输出可读
            }
        }
    }

    if !failures.is_empty() {
        panic!(
            "{} / {} 条对拍失败:\n{}",
            failures.len(),
            fixture.vectors.len(),
            failures.join("\n")
        );
    }
}
