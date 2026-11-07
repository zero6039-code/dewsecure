import os, re, math, json, requests, zipfile
import numpy as np
import lightgbm as lgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score
from sklearn.linear_model import LogisticRegression

exec(open(os.path.join(os.path.dirname(__file__), "train_balanced.py")).read().split("def main():")[0])

def build_balanced_dataset():
    pos_urls = set()
    
    # 1. 从 GitHub 上的 Phishing.Database 拉取活跃钓鱼数据（无需 Token，极稳）
    try:
        print("⏳ 正在从 Phishing.Database 下载钓鱼样本 (GitHub 源)...")
        url = "https://raw.githubusercontent.com/Phishing-Database/Phishing.Database/master/phishing-links-ACTIVE.txt"
        r = requests.get(url, timeout=30)
        if r.status_code == 200:
            uh_urls = [u.strip() for u in r.text.splitlines() if u.strip().startswith('http')]
            # 截取最新的一部分，避免样本过大导致提取特征太久
            pos_urls.update(uh_urls[-10000:])
            print(f"✅ 从 Phishing.Database 抓取到 {len(uh_urls)} 条，选取最新 10000 条")
    except Exception as e:
        print(f"⚠️ Phishing.Database 获取失败: {e}")

    # 2. 注入本地马来西亚特色钓鱼样本
    local_phish = [
        "http://maybank2u.com-account-verify.tk/",
        "http://cimbclicks-login.xyz/secure",
        "http://touchngo-ewallet-update.top/login.php",
        "http://grab-rewards-claim.site/",
        "https://shopeepay-verify.ml/",
        "http://mybnm-alert.ga/update"
    ]
    pos_urls.update(local_phish)
    pos_urls = list(pos_urls)
    print(f"📊 共收集到正样本 (钓鱼): {len(pos_urls)} 条")

    # 3. 下载 Tranco 正常样本
    print("⏳ 正在下载 Tranco 正常样本...")
    r = requests.get("https://tranco-list.eu/top-1m.csv.zip")
    with open("/tmp/tranco.zip", "wb") as f: f.write(r.content)
    with zipfile.ZipFile("/tmp/tranco.zip", 'r') as z:
        with z.open(z.namelist()[0]) as f:
            lines = f.read().decode().splitlines()
    
    neg_urls = []
    # 10000 个域名 * 4 种变体 = 40000 条负样本，刚好能凑齐
    for l in lines[:10000]:
        domain = l.split(',')[1]
        neg_urls.append(f"https://{domain}")
        neg_urls.append(f"https://www.{domain}")
        neg_urls.append(f"http://{domain}")
        neg_urls.append(f"http://www.{domain}")

    # 强制 1:1 平衡
    max_len = min(len(pos_urls), len(neg_urls))
    print(f"📊 强制 1:1 平衡后 -> 正样本 {max_len} 条，负样本 {max_len} 条")
    return pos_urls[:max_len], neg_urls[:max_len]

def main():
    pos_urls, neg_urls = build_balanced_dataset()
    urls = pos_urls + neg_urls
    labels = [1] * len(pos_urls) + [0] * len(neg_urls)
    
    print(f"⏳ 正在提取特征 (总计 {len(urls)} 条样本)...")
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
    
    raw_scores_test = model.predict(X_test, raw_score=True).reshape(-1, 1)
    lr = LogisticRegression()
    lr.fit(raw_scores_test, y_test)
    platt_a, platt_b = float(lr.coef_[0][0]), float(lr.intercept_[0])
    print(f"📊 AUC: {roc_auc_score(y_test, model.predict(X_test)):.4f}")
    
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
    print(f"🎉 模型导出成功: {out_path}")

if __name__ == '__main__':
    main()
