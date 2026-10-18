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

    train_df = train_df.sample(frac=1, random_state=42).reset_index(drop=True)
    test_df = test_df.sample(frac=1, random_state=42).reset_index(drop=True)
    
    print(f"📊 全量训练集: {len(train_df)}, 测试集: {len(test_df)}")
    return train_df, test_df

def train_model():
    train_df, test_df = prepare_dataset()

    N_FEATURES = 16418
    CHUNK_SIZE = 15000  # 稍微大一点，提取更快

    print("🔬 正在分块提取训练集特征 (极致防 OOM)...")
    # 预分配一个巨大的空矩阵，只占 7GB 左右的极限内存在临界点，但我们用 float32 减半内存
    X_train = np.zeros((len(train_df), N_FEATURES), dtype=np.float32)
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
    X_test = np.zeros((len(test_df), N_FEATURES), dtype=np.float32)
    y_test = test_df["label"].values
    for i, domain in enumerate(tqdm(test_df["domain"], desc="Test")):
        X_test[i] = extract_features(domain)

    print("🚀 正在训练全局最优模型 (LogisticRegression)...")
    # 使用全局逻辑回归，彻底告别 SGD 的过拟合
    model = LogisticRegression(
        C=10, 
        max_iter=1000, 
        solver="lbfgs", 
        multi_class="multinomial", 
        class_weight="balanced", # 恢复优雅的 balanced
        n_jobs=1
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
    
    # 保存产物
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
        
    print(f"✅ 全量训练完成！Macro F1: {macro_f1:.4f}")

if __name__ == "__main__":
    train_model()
