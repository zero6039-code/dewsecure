import os, re, math, json, requests, zipfile
import numpy as np
import pandas as pd
import lightgbm as lgb
from urllib.parse import urlparse
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score, precision_score, recall_score
from sklearn.linear_model import LogisticRegression
from tldextract import extract

exec(open(os.path.join(os.path.dirname(__file__), "train_balanced.py")).read().split("def main():")[0])

def build_balanced_dataset():
    print("⏳ 正在下载 OpenPhish 钓鱼样本...")
    r = requests.get("https://openphish.com/feed.txt")
    pos_urls = [u.strip() for u in r.text.splitlines() if u.strip()][:10000]
    
    # 🌟 读取 R2 历史数据
    if os.path.exists('/tmp/r2_phish_urls.txt'):
        with open('/tmp/r2_phish_urls.txt', 'r') as f:
            r2_urls = [line.strip() for line in f if line.strip()]
            pos_urls.extend(r2_urls)
            print(f"✅ 已注入 {len(r2_urls)} 条 R2 历史钓鱼数据")

    # 注入本地化重点样本
    local_phish = [
        "http://maybank2u.com-account-verify.tk/",
        "http://cimbclicks-login.xyz/secure",
        "http://touchngo-ewallet-update.top/login.php"
    ]
    pos_urls.extend(local_phish)
    
    print("⏳ 正在下载 Tranco 正常样本...")
    r = requests.get("https://tranco-list.eu/top-1m.csv.zip")
    with open("/tmp/tranco.zip", "wb") as f: f.write(r.content)
    with zipfile.ZipFile("/tmp/tranco.zip", 'r') as z:
        with z.open(z.namelist()[0]) as f:
            lines = f.read().decode().splitlines()
    
    neg_urls = []
    for l in lines[:3000]: # 增加负样本多样性
        domain = l.split(',')[1]
        neg_urls.append(f"https://{domain}")
        neg_urls.append(f"https://www.{domain}")
        neg_urls.append(f"http://{domain}")
        neg_urls.append(f"http://www.{domain}")
    
    # 强制 1:1 平衡
    max_len = min(len(pos_urls), len(neg_urls))
    return pos_urls[:max_len], neg_urls[:max_len]

def main():
    pos_urls, neg_urls = build_balanced_dataset()
    urls = pos_urls + neg_urls
    labels = [1] * len(pos_urls) + [0] * len(neg_urls)
    
    print(f"⏳ 正在提取特征 ({len(urls)} 条样本)...")
    X = np.array([extract_features(u) for u in urls])
    y = np.array(labels)
    
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    
    print("🚀 正在训练 LightGBM 模型...")
    params = {
        'objective': 'binary', 'metric': 'binary_logloss',
        'num_leaves': 15, 'max_depth': 5, 'min_data_in_leaf': 50,
        'learning_rate': 0.05, 'lambda_l1': 0.5, 'lambda_l2': 0.5, 'verbose': -1
    }
    model = lgb.train(params, lgb.Dataset(X_train, label=y_train), num_boost_round=200)
    
    print("\n📊 正在评估模型指标...")
    raw_scores_test = model.predict(X_test, raw_score=True).reshape(-1, 1)
    lr = LogisticRegression()
    lr.fit(raw_scores_test, y_test)
    platt_a = float(lr.coef_[0][0])
    platt_b = float(lr.intercept_[0])
    
    print(f"   - AUC: {roc_auc_score(y_test, model.predict(X_test)):.4f}")
    
    print("⏳ 正在导出模型为 JS 格式...")
    dump = model.dump_model()
    feat, thr, left, right, def_left, val, roots = [], [], [], [], [], [], []
    
    for tree in dump['tree_info']:
        roots.append(len(feat))
        def walk(n):
            i = len(feat)
            feat.append(-1); thr.append(0.0); left.append(-1); right.append(-1); def_left.append(1); val.append(0.0)
            if 'leaf_value' in n: val[i] = float(n['leaf_value']); return i
            feat[i] = int(n['split_feature']); thr[i] = float(n['threshold'])
            def_left[i] = 1 if n.get('default_left', True) else 0
            left[i] = walk(n['left_child']); right[i] = walk(n['right_child'])
            return i
        walk(tree['tree_structure'])
        
    out_json = {
        'nFeatures': 579, 'roots': roots, 'feat': feat, 'thr': thr,
        'left': left, 'right': right, 'defLeft': def_left, 'val': val,
        'platt': {'a': platt_a, 'b': platt_b}
    }
    
    out_path = os.path.join(os.path.dirname(__file__), "..", "..", "extensions", "chrome", "src", "phishscout_local.json")
    with open(out_path, 'w') as f:
        json.dump(out_json, f)
    print(f"🎉 最终模型导出成功: {out_path}")

if __name__ == '__main__':
    main()
