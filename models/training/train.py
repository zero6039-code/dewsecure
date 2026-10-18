import numpy as np
import pandas as pd
import os
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score, classification_report
from tqdm import tqdm
from features import extract_features

tqdm.pandas()

def prepare_dataset():
    print("📦 正在加载数据集...")
    # 使用相对路径（适配 GitHub Actions 的工作目录）
    train_df = pd.read_csv("data/train.csv")
    test_df = pd.read_csv("data/test.csv")

    # 🔥 核心修复：限制数据量，防止内存溢出（取最多 5 万条训练，1 万条测试）
    if len(train_df) > 50000:
        print(f"⚠️ 数据量过大 ({len(train_df)})，为了适配免费服务器，随机截取 5 万条...")
        train_df = train_df.sample(n=50000, random_state=42)
    if len(test_df) > 10000:
        test_df = test_df.sample(n=10000, random_state=42)

    train_df = train_df.sample(frac=1, random_state=42).reset_index(drop=True)
    test_df = test_df.sample(frac=1, random_state=42).reset_index(drop=True)
    
    print(f"📊 训练集: {len(train_df)}, 测试集: {len(test_df)}")
    return train_df, test_df

def train_model():
    train_df, test_df = prepare_dataset()

    print("🔬 正在提取训练集特征（单线程运行，防死锁）...")
    # 取消多进程，直接使用 progress_apply，CI 环境下更稳定
    X_train = np.vstack(train_df["domain"].progress_apply(extract_features).values)
    y_train = train_df["label"].values

    print("🔬 正在提取测试集特征...")
    X_test = np.vstack(test_df["domain"].progress_apply(extract_features).values)
    y_test = test_df["label"].values

    print("🚀 正在训练模型...")
    model = LogisticRegression(C=10, max_iter=1000, solver="lbfgs", multi_class="multinomial", n_jobs=1) # 使用单核
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    target_names = ['Normal', 'Ad', 'Tracker']
    
    # 由于我们训练的是三分类，如果 tag 里只有三分类，保持原样
    try:
        print(classification_report(y_test, y_pred, target_names=target_names, zero_division=0))
    except:
        print(classification_report(y_test, y_pred, zero_division=0))
    
    macro_f1 = f1_score(y_test, y_pred, average='macro')
    os.makedirs("weights", exist_ok=True)
    np.savez("weights/classifier_weights.npz", coef=model.coef_, intercept=model.intercept_)
    
    # 保存 meta
    import json
    with open("weights/model_meta.json", "w") as f:
        json.dump({"macroF1": macro_f1, "trainedAt": pd.Timestamp.now().isoformat()}, f)
        
    print(f"✅ 训练完成！Macro F1: {macro_f1:.4f}")

if __name__ == "__main__":
    train_model()
