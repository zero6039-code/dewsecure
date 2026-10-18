import numpy as np
import pandas as pd
import os
import json
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score, classification_report
from tqdm import tqdm
from features import extract_features

def prepare_dataset():
    print("📦 正在加载数据集...")
    train_df = pd.read_csv("data/train.csv")
    test_df = pd.read_csv("data/test.csv")

    # 🔥 最优解：由于逻辑回归的全量计算太慢，为了保证 CI 不超时，我们采样 5 万条训练，1 万条测试。
    # 5 万条数据足以让 16K 维特征完美收敛。
    if len(train_df) > 50000:
        train_df = train_df.sample(n=50000, random_state=42)
    if len(test_df) > 10000:
        test_df = test_df.sample(n=10000, random_state=42)

    train_df = train_df.sample(frac=1, random_state=42).reset_index(drop=True)
    test_df = test_df.sample(frac=1, random_state=42).reset_index(drop=True)
    
    print(f"📊 最终训练集: {len(train_df)}, 测试集: {len(test_df)}")
    return train_df, test_df

def train_model():
    train_df, test_df = prepare_dataset()

    N_FEATURES = 16418
    CHUNK_SIZE = 15000

    print("🔬 正在分块提取特征 (uint8 矩阵，极致防 OOM)...")
    X_train = np.zeros((len(train_df), N_FEATURES), dtype=np.uint8)
    y_train = train_df["label"].values
    
    total_chunks = (len(train_df) + CHUNK_SIZE - 1) // CHUNK_SIZE
    for i in range(total_chunks):
        start = i * CHUNK_SIZE
        end = min((i + 1) * CHUNK_SIZE, len(train_df))
        chunk = train_df.iloc[start:end]
        for j, domain in enumerate(chunk["domain"]):
            X_train[start + j] = extract_features(domain)
        print(f"✅ 特征提取进度: Chunk {i+1}/{total_chunks}")

    print("🔬 正在提取测试集特征...")
    X_test = np.zeros((len(test_df), N_FEATURES), dtype=np.uint8)
    y_test = test_df["label"].values
    for i, domain in enumerate(tqdm(test_df["domain"], desc="Test")):
        X_test[i] = extract_features(domain)

    print("🚀 正在训练最优模型 (LogisticRegression)...")
    # 🔥 移除报错的 n_jobs 参数，其他保持全局最优
    model = LogisticRegression(
        C=10, 
        max_iter=1000, 
        solver="lbfgs", 
        class_weight="balanced" 
    )
    model.fit(X_train, y_train)

    print("📈 正在评估模型...")
    y_pred = model.predict(X_test)
    
    target_names = ['Normal', 'Ad', 'Tracker']
    try:
        print(classification_report(y_test, y_pred, target_names=target_names, zero_division=0))
    except:
        print(classification_report(y_test, y_pred, zero_division=0))
    
    macro_f1 = f1_score(y_test, y_pred, average='macro')
    
    os.makedirs("weights", exist_ok=True)
    np.savez("weights/classifier_weights.npz", coef=model.coef_, intercept=model.intercept_)
    
    with open("weights/model_meta.json", "w") as f:
        json.dump({
            "macroF1": float(macro_f1), 
            "trainedAt": pd.Timestamp.now().isoformat(),
            "nClasses": len(model.classes_),
            "nFeatures": N_FEATURES,
            "trainSize": len(train_df),
            "testSize": len(test_df)
        }, f)
        
    print(f"✅ 训练完成！Macro F1: {macro_f1:.4f}")

if __name__ == "__main__":
    train_model()
