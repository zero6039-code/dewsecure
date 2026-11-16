// A-01 动态 POC：验签失败必须 Err，且不 panic
use dewsecure_core::engine_host::HostEngine;
use dewsecure_core::{EngineConfig, EngineError};
use std::fs;

fn make_engine(dir: &str) -> HostEngine {
    HostEngine::new(EngineConfig {
        rule_data: String::new(),
        model_path: String::new(),
        ai_enabled: false,
        base_dir: dir.to_string(),
    })
    .expect("engine init")
}

fn sha_of(s: &str) -> String {
    use sha2::{Sha256, Digest};
    let mut h = Sha256::new();
    h.update(s.as_bytes());
    hex::encode(h.finalize())
}

#[test]
fn t1_sha256_mismatch_rejected() {
    let tmp = std::env::temp_dir().join("poc_a01_t1");
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).unwrap();
    let e = make_engine(tmp.to_str().unwrap());
    let r = e.verify_and_update_rules(
        "[]".into(),
        "deadbeef".repeat(8),
        "v1:abc".into(),
        "AAAA".into(),
    );
    assert!(matches!(r, Err(EngineError::InvalidRule(_))));
    assert!(!tmp.join("cloud_rules.json").exists(), "不应写盘");
}

#[test]
fn t2_malformed_sig_no_panic() {
    let tmp = std::env::temp_dir().join("poc_a01_t2");
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).unwrap();
    let e = make_engine(tmp.to_str().unwrap());
    let sha = sha_of("[]");
    let msg = format!("v1:{}", sha);
    let r = e.verify_and_update_rules("[]".into(), sha, msg, "!!notbase64!!".into());
    assert!(matches!(r, Err(EngineError::InvalidRule(_))), "不得 panic");
}

#[test]
fn t3_msg_not_bound_to_hash() {
    let tmp = std::env::temp_dir().join("poc_a01_t3");
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).unwrap();
    let e = make_engine(tmp.to_str().unwrap());
    let payload = "[]";
    let sha = sha_of(payload);
    let r = e.verify_and_update_rules(payload.into(), sha, "v1:other".into(), "AAAA".into());
    assert!(matches!(r, Err(EngineError::InvalidRule(_))));
}

#[test]
fn t4_payload_too_large_rejected() {
    let tmp = std::env::temp_dir().join("poc_a01_t4");
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).unwrap();
    let e = make_engine(tmp.to_str().unwrap());
    let big = "a".repeat(8 * 1024 * 1024 + 1);
    let sha = sha_of(&big);
    let msg = format!("v1:{}", sha);
    let r = e.verify_and_update_rules(big, sha, msg, "AAAA".into());
    assert!(matches!(r, Err(EngineError::InvalidRule(_))));
}
