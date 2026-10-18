import numpy as np
import pandas as pd
import requests
import os
import urllib.parse
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score, classification_report
from tqdm import tqdm
from features import extract_features

tqdm.pandas()

def download_phishing_data():
    print("🌐 正在从 OpenPhish / 开源库下载钓鱼数据...")
    domains = set()
    # 使用更稳定的 GitHub 开源恶意域名库，防止 OpenPhish 屏蔽云端 IP
    urls = [
        "https://raw.githubusercontent.com/mitchellkrogza/Phishing.Database/master/phishing-domains-ACTIVE.txt",
        "https://openphish.com/feed.txt"
    ]
    for url in urls:
        try:
            resp = requests.get(url, timeout=10)
            if resp.status_code == 200:
                for line in resp.text.strip().split('\n'):
                    if line and not line.startswith('#'):
                        parsed = urllib.parse.urlparse(line if line.startswith('http') else 'http://' + line)
                        if parsed.netloc:
                            domains.add(parsed.netloc)
        except Exception as e:
            print(f"⚠️ 下载 {url} 失败: {e}")
            
    df = pd.DataFrame({"domain": list(domains)})
    df["label"] = 3  # Phishing 标签
    print(f"✅ 成功获取 {len(df)} 个钓鱼域名")
    return df

def prepare_dataset():
    train_df = pd.read_csv("data/train.csv")
    test_df = pd.read_csv("data/test.csv")

    phish_df = download_phishing_data()
    if not phish_df.empty:
        from sklearn.model_selection import train_test_split
        # 稍微调整比例，让钓鱼数据在测试集中有一定权重
        phish_train, phish_test = train_test_split(phish_df, test_size=0.2, random_state=42)
        train_df = pd.concat([train_df, phish_train], ignore_index=True)
        test_df = pd.concat([test_df, phish_test], ignore_index=True)
    
    # 如果原始数据里的 Tracker 太少，我们做一下过采样
    tracker_df = train_df[train_df['label'] == 2]
    if len(tracker_df) < 20000:
        tracker_upsampled = tracker_df.sample(n=20000, replace=True, random_state=42)
        train_df = pd.concat([train_df, tracker_upsampled], ignore_index=True)

    train_df = train_df.sample(frac=1, random_state=42).reset_index(drop=True)
    return train_df, test_df

def train_model():
    train_df, test_df = prepare_dataset()
    print(f"📊 训练集: {len(train_df)}, 测试集: {len(test_df)}")

    print("🔬 正在提取特征...")
    X_train = np.vstack(train_df["domain"].progress_apply(extract_features).values)
    y_train = train_df["label"].values
    X_test = np.vstack(test_df["domain"].progress_apply(extract_features).values)
    y_test = test_df["label"].values

    print("🚀 正在训练四分类模型...")
    model = LogisticRegression(C=10, max_iter=1000, solver="lbfgs", multi_class="multinomial", n_jobs=-1)
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    target_names = ['Normal', 'Ad', 'Tracker', 'Phishing']
    print(classification_report(y_test, y_pred, target_names=target_names, zero_division=0))
    
    macro_f1 = f1_score(y_test, y_pred, average='macro')
    os.makedirs("../weights", exist_ok=True)
    np.savez("../weights/classifier_weights.npz", coef=model.coef_, intercept=model.intercept_)
    print(f"✅ Macro F1: {macro_f1:.4f}")

if __name__ == "__main__":
    train_model()
