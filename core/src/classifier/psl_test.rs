use super::*;

fn psl() -> &'static PslSet {
    PslSet::global()
}

#[test]
fn test_psl_basics() {
    let (s, d, t) = psl().split("google.com");
    assert_eq!((s.as_str(), d.as_str(), t.as_str()), ("", "google.com", "com"));

    let (s, d, t) = psl().split("www.google.com");
    assert_eq!((s.as_str(), d.as_str(), t.as_str()), ("www", "google.com", "com"));

    let (s, d, t) = psl().split("test.com.my");
    assert_eq!((s.as_str(), d.as_str(), t.as_str()), ("", "test.com.my", "com.my"));
}

#[test]
fn test_c10_long_hostname_dos_protection() {
    // 🛡️ C-10 PoC：构造一个包含 1000 个标签的极端恶意主机名
    let mut long_host = String::new();
    for _ in 0..1000 {
        long_host.push_str("a.");
    }
    long_host.push_str("com");

    let start = std::time::Instant::now();
    let (_s, d, t) = psl().split(&long_host);
    let duration = start.elapsed();

    // 即使有 1000 个标签，也必须瞬间完成（< 10 毫秒），且正确识别后缀
    assert_eq!(t, "com");
    assert!(d.ends_with("com"));
    assert!(duration.as_millis() < 10, "超长域名解析耗时过长，存在 O(L²) 风险: {:?}", duration);
    println!("✅ C-10 PoC 成功：超长域名解析耗时极短 ({:?})", duration);
}
