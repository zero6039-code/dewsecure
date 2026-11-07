//! A0-3 夹具对拍：Rust `extract_sparse_features` 与 `shared/fixtures/adblock-golden.json`
//! 逐条 bit-for-bit 对齐。

use dewsecure_core::classifier::features_adblock::{extract_sparse_features, SparseFeatures};
use serde::Deserialize;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
struct Fixture {
    #[serde(rename = "_meta")]
    meta: Meta,
    vectors: HashMap<String, Vector>,
}

#[derive(Debug, Deserialize)]
struct Meta {
    total_dim: usize,
    struct_offset: u32,
    sample_count: usize,
}

#[derive(Debug, Deserialize)]
struct Vector {
    // fixtures 存 "bucket_idx" (字符串) -> count
    buckets: HashMap<String, f32>,
    // structs 存 [[abs_idx, val], ...]
    structs: Vec<(u32, f32)>,
}

fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("shared/fixtures/adblock-golden.json")
}

const TOL: f32 = 1e-5;

#[test]
fn fixture_matches_rust_extraction() {
    let path = fixture_path();
    let raw = fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("读取夹具失败 {}: {}", path.display(), e));
    let fixture: Fixture =
        serde_json::from_str(&raw).unwrap_or_else(|e| panic!("解析夹具失败: {}", e));

    assert_eq!(fixture.meta.total_dim, 16418, "fixture meta 维度不符");
    assert_eq!(fixture.meta.struct_offset, 16384, "fixture meta offset 不符");
    assert_eq!(
        fixture.vectors.len(),
        fixture.meta.sample_count,
        "fixture 声明样本数与实际不符"
    );

    let mut failures: Vec<String> = Vec::new();

    for (domain, expected) in &fixture.vectors {
        let actual = extract_sparse_features(domain);
        if let Err(e) = compare_buckets(domain, &expected.buckets, &actual) {
            failures.push(e);
            continue;
        }
        if let Err(e) = compare_structs(domain, &expected.structs, &actual) {
            failures.push(e);
        }
    }

    if !failures.is_empty() {
        panic!(
            "{} / {} 条夹具对拍失败:\n{}",
            failures.len(),
            fixture.vectors.len(),
            failures.join("\n")
        );
    }
}

fn compare_buckets(
    domain: &str,
    expected: &HashMap<String, f32>,
    actual: &SparseFeatures,
) -> Result<(), String> {
    let expected_map: HashMap<u32, f32> = expected
        .iter()
        .map(|(k, v)| (k.parse::<u32>().expect("bucket key 非数字"), *v))
        .collect();

    for (k, v) in &expected_map {
        match actual.buckets.get(k) {
            Some(a) if (a - v).abs() < TOL => {}
            Some(a) => {
                return Err(format!(
                    "{}: bucket[{}] 值不符 rust={} golden={}",
                    domain, k, a, v
                ))
            }
            None => {
                return Err(format!(
                    "{}: bucket[{}] 缺失 (golden={})",
                    domain, k, v
                ))
            }
        }
    }
    for k in actual.buckets.keys() {
        if !expected_map.contains_key(k) {
            return Err(format!(
                "{}: bucket[{}] 多余 (rust 有, golden 无)",
                domain, k
            ));
        }
    }
    Ok(())
}

fn compare_structs(
    domain: &str,
    expected: &[(u32, f32)],
    actual: &SparseFeatures,
) -> Result<(), String> {
    let expected_map: HashMap<u32, f32> = expected.iter().copied().collect();
    let actual_map: HashMap<u32, f32> = actual.structs.iter().copied().collect();

    // 遍历全部 34 个 struct 索引，缺失按 0 处理
    for idx in 16384u32..16418 {
        let exp = expected_map.get(&idx).copied().unwrap_or(0.0);
        let act = actual_map.get(&idx).copied().unwrap_or(0.0);
        if (exp - act).abs() >= TOL {
            return Err(format!(
                "{}: struct[{}] rust={} golden={}",
                domain, idx, act, exp
            ));
        }
    }
    Ok(())
}
