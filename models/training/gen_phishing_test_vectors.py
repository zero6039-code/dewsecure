"""
生成 T2（钓鱼检测）的 Python 端特征基准向量。

关键设计：
- 输入是**完整 URL**（https://...），与训练数据分布一致
- 直接 import train_phishscout_fixed.extract_features，不是抄一份
- 输出稠密 579 维数组（T2 是二值特征，稠密比稀疏更易读）

运行：
  cd ~/dewsecure
  python3 models/training/gen_phishing_test_vectors.py
"""
import sys
import os
import json
from unittest.mock import MagicMock

sys.path.insert(0, os.path.dirname(__file__))

# ⚠️ train_phishscout_fixed.py 顶层 import lightgbm，但 extract_features 不需要它。
# 用 MagicMock 绕过，避免为一个纯函数引入完整 ML 依赖链。
# 不影响 extract_features 的执行——它只用 numpy / re / math / tldextract / urllib。
# ⚠️ 不要 mock requests：tldextract 内部依赖真实的 requests + requests_file。
# 只 mock 训练函数才用到的 lightgbm / pandas / sklearn。
for _mod in ['lightgbm', 'pandas', 'sklearn', 'sklearn.model_selection']:
    if _mod not in sys.modules:
        sys.modules[_mod] = MagicMock()

from train_phishscout_fixed import extract_features

# 代表性测试集（全部带 scheme，与训练一致）
TEST_URLS = [
    # 正常大站（各种 scheme / www）
    "https://google.com",
    "https://www.google.com",
    "https://apple.com",
    "https://microsoft.com",
    "https://github.com",
    # 品牌 + 路径（正常）
    "https://paypal.com/login",
    "https://appleid.apple.com/signin",
    # 品牌仿冒 + 高风险 TLD
    "https://paypal-secure-login.xyz",
    "https://maybank2u-secure-login.top",
    # 同形字
    "https://xn--pypal-4ve.com",
    "https://xn--fiqu43as1hvqw.com",
    # IP 形式
    "http://127.0.0.1/login",
    "http://192.168.1.1/admin",
    # 深子域
    "https://a.b.c.d.e.f.g.h.i.j.k.com",
    # 超长
    "https://very-long-subdomain-that-should-be-truncated.very-long-domain-name-for-testing.com",
    # 短链
    "https://bit.ly/abc123",
    "https://tinyurl.com/xyz",
    # 免费主机
    "https://evil.github.io/login",
    "https://phish.netlify.app/",
    # 开放重定向
    "https://example.com/?url=https://evil.com",
    "https://example.com/redirect?next=//evil.xyz",
    # 二阶后缀（PSL）
    "https://example.co.uk/login",
    "https://test.com.my/account",
    # 可疑关键词在 path
    "https://example.com/secure/account/verify",
    # userinfo 混淆
    "https://paypal.com@evil.xyz/login",
]

def main():
    print(f"📊 生成 {len(TEST_URLS)} 条 T2 基准向量...")
    vectors = {}
    failed = 0

    for url in TEST_URLS:
        try:
            feats = extract_features(url)
            # np.ndarray -> list[float]
            vectors[url] = feats.tolist() if hasattr(feats, 'tolist') else list(feats)
            # 快速校验维度
            assert len(vectors[url]) == 579, f"{url} 维度不是 579"
            print(f"  ✅ {url:70s}  (非零 {sum(1 for x in vectors[url] if x != 0)})")
        except Exception as e:
            print(f"  ❌ {url}: {e}")
            failed += 1

    if failed:
        print(f"\n⚠️ {failed} 条失败，不写夹具")
        sys.exit(1)

    out_path = os.path.join(
        os.path.dirname(__file__), '..', '..', 'shared', 'fixtures', 'phishing-golden.json'
    )
    out_path = os.path.abspath(out_path)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    payload = {
        "_meta": {
            "source": "models/training/gen_phishing_test_vectors.py",
            "extractor": "models/training/train_phishscout_fixed.py:extract_features",
            "total_dim": 579,
            "input_contract": "full URL with scheme (https://... or http://...)",
            "note": "578 is overridden by shortener flag per Python impl (NOT pure n-gram)",
            "sample_count": len(vectors),
        },
        "vectors": vectors,
    }

    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    size_kb = os.path.getsize(out_path) / 1024
    print(f"\n✅ 写入 {out_path} ({size_kb:.1f} KB, {len(vectors)} 条)")

if __name__ == '__main__':
    main()
