import json
import os
import numpy as np
import sys

# 确保能导入同目录下的 features.py
sys.path.append(os.path.dirname(__file__))
from features import extract_features

# 选择包含各种极端情况的代表性域名
TEST_DOMAINS = [
    "google.com", "apple.com", "microsoft.com", 
    "ads.doubleclick.net", "google-analytics.com", 
    "paypal-secure-login.xyz", "xn--pypal-4ve.com", 
    "a.b.c.d.e.f.g.h.i.j.k.com", "127.0.0.1",
    "very-long-subdomain-that-should-be-truncated.very-long-domain-name-for-testing.com",
    "maybank2u-secure-login.top", "中文字符.com" # 测 IDN
]

def generate():
    print("🚀 正在生成 Python 端特征基准向量...")
    vectors = {}
    for d in TEST_DOMAINS:
        try:
            # 🛡️ 模拟真实浏览器行为：将中文域名转为 punycode
            try:
                if any(ord(c) > 127 for c in d):
                    parts = d.split('.')
                    d = '.'.join([p.encode('idna').decode('ascii') if any(ord(c) > 127 for c in p) else p for p in parts])
            except Exception:
                pass
            features = extract_features(d)
            # 兼容 list 和 numpy array 两种类型
            if hasattr(features, 'tolist'):
                vectors[d] = features.tolist()
            else:
                vectors[d] = list(features)
        except Exception as e:
            print(f"❌ 提取 {d} 失败: {e}")
    
    out_path = os.path.join(os.path.dirname(__file__), "feature_test_vectors.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(vectors, f, ensure_ascii=False, indent=2)
    print(f"✅ 已生成 {len(vectors)} 条基准向量，保存在: {out_path}")

if __name__ == "__main__":
    generate()
