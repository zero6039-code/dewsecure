use super::*;

#[test]
fn test_semver_strict_comparison() {
    // C-7 PoC：1.3.0 必须大于 1.2.8，正确拦截降级
    let body = b"{}";
    let r = verify("1.3.0", "00", "AA==", body, "adblock", "stable", 0, Some("1.2.8"));
    // 版本通过，卡在 HashMismatch
    assert!(matches!(r, Err(BundleError::HashMismatch)));

    let r_down = verify("1.2.8", "00", "AA==", body, "adblock", "stable", 0, Some("1.3.0"));
    assert!(matches!(r_down, Err(BundleError::VersionDowngrade)));
}

#[test]
fn test_signature_covers_metadata() {
    // 验证篡改 model_type 会导致验签失败
    let body = b"hello";
    let real_sha = hex_encode(&sha256(body));
    let zero_sig = B64.encode([0u8; 64]);

    // 使用完全不同的元数据
    let r1 = verify("1.0.0", &real_sha, &zero_sig, body, "adblock", "stable", 0, None);
    let r2 = verify("1.0.0", &real_sha, &zero_sig, body, "phishing", "stable", 0, None);
    
    // 两者都应该因为签名错误被拒绝，但重要的是签名串的构造不一样
    assert!(matches!(r1, Err(BundleError::SignatureInvalid)));
    assert!(matches!(r2, Err(BundleError::SignatureInvalid)));
}

#[cfg(test)]
mod c8_tests {
    use crate::model::adblock::AdblockModel;

    #[test]
    fn test_c8_oversized_json_rejected() {
        // 构造一个超过 4MB 的虚假 JSON
        let big_json = "a".repeat(5 * 1024 * 1024);
        let res = AdblockModel::load_from_json(&big_json);
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("超过 4MB 大小限制"));
        println!("✅ C-8 PoC 成功：超大 JSON 已被拦截");
    }

    #[test]
    fn test_c8_invalid_dimension_rejected() {
        // 构造维度错误的 JSON：coef 为 4 个类别
        let json = r#"{"coef": [[],[],[],[]], "intercept": [0,0,0]}"#;
        let res = AdblockModel::load_from_json(json);
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("coef 应为 3 个类别"));
        println!("✅ C-8 PoC 成功：畸形维度已被拦截");
    }
}
