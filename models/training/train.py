import numpy as np
import pandas as pd
import os
import json
from sklearn.linear_model import SGDClassifier
from sklearn.metrics import f1_score, classification_report
from tqdm import tqdm
from features import extract_features

def prepare_dataset():
    print("📦 正在加载数据集...")
    train_df = pd.read_csv("data/train.csv")
    test_df = pd.read_csv("data/test.csv")

    # 采用全量数据（11.7 万条），不截断
    train_df = train_df.sample(frac=1, random_state=42).reset_index(drop=True)
    test_df = test_df.sample(frac=1, random_state=42).reset_index(drop=True)
    
    print(f"📊 全量训练集: {len(train_df)}, 测试集: {len(test_df)}")
    return train_df, test_df

def train_model():
    train_df, test_df = prepare_dataset()

    N_FEATURES = 16418
    CHUNK_SIZE = 10000  # 每次只处理 1 万条，绝对防 OOM

    # 使用 SGDClassifier 支持增量训练（partial_fit）
    print("🚀 初始化增量训练模型 (SGDClassifier)...")
    model = SGDClassifier(
        loss='log_loss',       # 等价于逻辑回归
        penalty='l2',
        alpha=1e-5,
        max_iter=100,
        random_state=42,
        n_jobs=1,
        class_weight='balanced' # 自动处理 Tracker 样本偏少的问题
    )
    
    classes = np.array([0, 1, 2]) # Normal, Ad, Tracker

    print(f"🔬 开始分块提取并训练，Chunk Size: {CHUNK_SIZE}...")
    
    # 分块迭代训练
    total_chunks = (len(train_df) + CHUNK_SIZE - 1) // CHUNK_SIZE
    for i in range(total_chunks):
        start = i * CHUNK_SIZE
        end = min((i + 1) * CHUNK_SIZE, len(train_df))
        chunk = train_df.iloc[start:end]
        
        # 提取当前块的特征
        X_chunk = np.zeros((len(chunk), N_FEATURES), dtype=np.float32)
        for j, domain in enumerate(chunk["domain"]):
            X_chunk[j] = extract_features(domain)
        y_chunk = chunk["label"].values

        # 喂给模型（第一次需要传 classes）
        if i == 0:
            model.partial_fit(X_chunk, y_chunk, classes=classes)
        else:
            model.partial_fit(X_chunk, y_chunk)
            
        # 打印进度并强制清理内存
        print(f"✅ Chunk {i+1}/{total_chunks} 完成 (数据量: {len(chunk)})")
        del X_chunk, y_chunk, chunk

    print("🔬 正在提取测试集特征...")
    X_test = np.zeros((len(test_df), N_FEATURES), dtype=np.float32)
    y_test = test_df["label"].values
    for i, domain in enumerate(tqdm(test_df["domain"], desc="Test")):
        X_test[i] = extract_features(domain)

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
    # 注意：SGD 的权重保存格式与普通 LR 略有不同，仍然保存为 coef_ 和 intercept_
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
