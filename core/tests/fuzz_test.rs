use proptest::prelude::*;

// 模拟审计报告中提到的解析函数
// 请确保你的 core/src/rule_matcher/matcher.rs 中有对应的 pub fn extract_host
// 这里为了演示，直接调用它。如果函数名或路径不同，请在此处调整。
use dewsecure_core::rule_matcher::extract_host;

proptest! {
    #[test]
    fn fuzz_extract_host_no_panic(s in "\\PC*") {
        // 无论输入什么随机字符串，解析器都不应该 panic
        let _ = extract_host(&s);
    }
    
    #[test]
    fn fuzz_extract_host_valid_invariants(s in "\\PC*") {
        if let Some(h) = extract_host(&s) {
            // 如果返回了 host，它不应该包含 userinfo 或路径分隔符
            prop_assert!(!h.contains('@'), "Host 不应包含 @");
            prop_assert!(!h.contains('/'), "Host 不应包含 /");
            prop_assert!(!h.contains('\\'), "Host 不应包含 \\");
        }
    }
}
