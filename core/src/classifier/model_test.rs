use super::*;
use std::io::Write;

#[test]
fn test_c9_load_nonexistent_path_fails() {
    // 🛡️ C-9 PoC：加载不存在的文件必须报错，不能静默回退
    let res = Classifier::load("/tmp/this_file_does_not_exist_12345.model");
    assert!(res.is_err(), "加载不存在的路径必须失败");
    assert!(matches!(res.unwrap_err(), ModelError::NotFound(_)));
    println!("✅ C-9 PoC 成功：不存在的模型文件被正确拦截");
}

#[test]
fn test_c9_load_invalid_format_fails() {
    // 构造一个非法的短文件
    let tmp_path = "/tmp/invalid_test.model";
    let mut file = std::fs::File::create(tmp_path).unwrap();
    file.write_all(b"bad").unwrap(); // 只有 3 字节，小于 4 字节下限

    let res = Classifier::load(tmp_path);
    assert!(res.is_err(), "格式错误的文件必须失败");
    assert!(matches!(res.unwrap_err(), ModelError::InvalidFormat(_)));
    println!("✅ C-9 PoC 成功：畸形模型文件被正确拦截");
    std::fs::remove_file(tmp_path).unwrap();
}

#[test]
fn test_c9_load_valid_bytes_success() {
    // 构造一个符合 from_bytes 格式的合法字节流：4字节头 (N) + N个权重 + 1个bias
    let tmp_path = "/tmp/valid_test.model";
    let mut file = std::fs::File::create(tmp_path).unwrap();
    
    let weights = vec![0.5f32; 4];
    let bias = 1.0f32;
    let n = (weights.len() + 1) as u32; // 包含 bias
    
    file.write_all(&n.to_le_bytes()).unwrap();
    for w in weights {
        file.write_all(&w.to_le_bytes()).unwrap();
    }
    file.write_all(&bias.to_le_bytes()).unwrap();
    drop(file);

    let res = Classifier::load(tmp_path);
    assert!(res.is_ok(), "合法模型文件应当加载成功");
    println!("✅ C-9 PoC 成功：合法的二进制模型被正确解析");
    std::fs::remove_file(tmp_path).unwrap();
}
