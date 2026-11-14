use std::env;
use std::fs::File;
use std::io::{BufWriter, Read};
use std::path::Path;
use serde_json::Value;
use std::collections::BTreeMap;

fn main() {
    // 1. 获取源文件路径
    let json_path = "../shared/adblock/domain-rules.json";
    
    // 2. 读取并解析 JSON
    let mut file = File::open(json_path).expect("无法打开 domain-rules.json");
    let mut contents = String::new();
    file.read_to_string(&mut contents).expect("无法读取 domain-rules.json");
    
    let parsed: Value = serde_json::from_str(&contents).expect("JSON 解析失败");
    
    // 3. 合并规则并排序 (BTreeMap 会自动按字母排序，FST 要求有序输入)
    let mut rules: BTreeMap<String, u64> = BTreeMap::new();
    
    if let Some(ads) = parsed.get("ad").and_then(|v| v.as_array()) {
        for ad in ads {
            if let Some(domain) = ad.as_str() {
                rules.insert(domain.to_lowercase(), 1); // 1 = Ad
            }
        }
    }
    
    if let Some(trackers) = parsed.get("tracker").and_then(|v| v.as_array()) {
        for tracker in trackers {
            if let Some(domain) = tracker.as_str() {
                rules.insert(domain.to_lowercase(), 2); // 2 = Tracker
            }
        }
    }
    
    // 4. 生成 FST 文件
    let out_dir = env::var("OUT_DIR").unwrap();
    let fst_path = Path::new(&out_dir).join("rules.fst");
    let fst_file = File::create(&fst_path).expect("无法创建 rules.fst");
    
    let mut builder = fst::MapBuilder::new(BufWriter::new(fst_file)).expect("FST Builder 创建失败");
    
    for (domain, tag) in rules {
        builder.insert(domain.as_bytes(), tag).expect("插入 FST 失败");
    }
    
    builder.finish().expect("FST 写入失败");
    
    // 5. 监听文件变化，变化时自动重编
    println!("cargo:rerun-if-changed={}", json_path);
}
