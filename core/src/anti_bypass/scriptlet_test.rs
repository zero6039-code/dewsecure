use super::*;

#[test]
fn test_generate_scriptlet_differs_by_seed() {
    let s1 = generate_scriptlet(ScriptletType::Noop, 12345);
    let s2 = generate_scriptlet(ScriptletType::Noop, 67890);
    // 不同种子应该生成不同的变量名
    assert_ne!(s1, s2);
}

#[test]
fn test_c11_deterministic_hash_across_versions() {
    // 🛡️ C-11 PoC：验证同一个 seed 必须永远生成完全一样的字符串
    // 修复前，DefaultHasher 可能导致不同版本 Rust 计算出不同的结果
    // 修复后，FNV-1a 算法是数学确定的，永远不会变
    let name1 = generate_var_name(42, 100);
    let name2 = generate_var_name(42, 100);
    
    assert_eq!(name1, name2);
    
    // 这里我们直接验证具体的十六进制输出，防止算法未来被意外修改
    // 42 (0x2A), 100 (0x64) 对应的 FNV-1a 结果
    assert_eq!(name1, "_0x77b659eb"); // 如果这里报错，说明哈希算法被篡改了
    println!("✅ C-11 PoC 成功：哈希算法完全确定且跨平台一致");
}

#[test]
fn test_anti_bypass_script() {
    let script = generate_anti_bypass_script(42);
    assert!(script.contains("adBlock"));
    assert!(script.contains("Object.defineProperty"));
}
