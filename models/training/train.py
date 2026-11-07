import numpy as np
import pandas as pd
import os
import json
from sklearn.linear_model import SGDClassifier
from sklearn.metrics import f1_score, classification_report
from sklearn.model_selection import train_test_split
from tqdm import tqdm
from scipy.sparse import csr_matrix
from features import extract_features

# 🛡️ 核心修复：动态获取脚本绝对路径，无论在云端还是本地，路径都绝对正确
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, "..", "data")
WEIGHTS_DIR = os.path.join(SCRIPT_DIR, "weights")

def prepare_dataset():
    print("📦 正在加载数据集...")
    # 使用绝对路径读取
    train_df = pd.read_csv(os.path.join(DATA_DIR, "train.csv"))
    test_df = pd.read_csv(os.path.join(DATA_DIR, "test.csv"))

    dynamic_seed = 42 
    
    # 读取金标数据
    hard_rules_path = os.path.join(SCRIPT_DIR, 'hard_rules.json')
    force_train = pd.DataFrame()
    if os.path.exists(hard_rules_path):
        with open(hard_rules_path, 'r', encoding='utf-8') as f:
            rules = json.load(f)
            hard_domains = set(rules.get("hard_safe", []) + rules.get("hard_block", []))
            force_train = train_df[train_df["domain"].isin(hard_domains)]
    
    # 合并数据集，重新按 label 分层切分
    all_df = pd.concat([train_df, test_df]).drop_duplicates(subset=["domain"]).reset_index(drop=True)
    train_df, test_df = train_test_split(
        all_df, test_size=0.2, random_state=dynamic_seed, stratify=all_df["label"]
    )
    
    # 强制注入金标数据到训练集
    train_df = pd.concat([train_df, force_train]).drop_duplicates(subset=["domain"]).reset_index(drop=True)
    
    # 清洗 NA 和浮点数
    train_df = train_df.dropna(subset=["domain", "label"]).copy()
    train_df["label"] = pd.to_numeric(train_df["label"], errors='coerce').fillna(0).astype(int)
    
    test_df = test_df.dropna(subset=["domain", "label"]).copy()
    test_df["label"] = pd.to_numeric(test_df["label"], errors='coerce').fillna(0).astype(int)
    
    print(f"📊 最终分层训练集: {len(train_df)}, 测试集: {len(test_df)}")
    return train_df, test_df

def train_model():
    train_df, test_df = prepare_dataset()

    CHUNK_SIZE = 5000
    EPOCHS = 10
    classes = np.array([0, 1, 2])

    def make_url(d):
        return f"https://{d}"

    # 平衡类别权重
    custom_weights = {0: 1.0, 1: 1.0, 2: 1.5}
    sample_weights = np.array([custom_weights[c] for c in train_df["label"].values])
    print(f"⚖️ 平衡类别权重: {custom_weights}")

    print("🚀 正在初始化 SGD 增量学习模型...")
    model = SGDClassifier(
        loss='log_loss', 
        penalty='l2', 
        alpha=1e-5, 
        learning_rate='adaptive',
        eta0=0.01,
        max_iter=100, 
        random_state=42
    )

    print(f"🏃 开始 {EPOCHS} 轮打乱顺序训练 (内存安全模式)...")
    
    train_domains = train_df["domain"].values
    train_labels = train_df["label"].values
    
    for epoch in range(EPOCHS):
        indices = np.random.permutation(len(train_df))
        print(f"🔄 第 {epoch+1} 轮训练...")
        
        total_chunks = (len(indices) + CHUNK_SIZE - 1) // CHUNK_SIZE
        for i in tqdm(range(total_chunks), desc=f"Epoch {epoch+1}"):
            start = i * CHUNK_SIZE
            end = min((i + 1) * CHUNK_SIZE, len(indices))
            
            chunk_idx = indices[start:end]
            chunk_domains = train_domains[chunk_idx]
            chunk_y = train_labels[chunk_idx]
            chunk_w = sample_weights[chunk_idx]

            chunk_X = csr_matrix([extract_features(make_url(d)) for d in chunk_domains])

            if epoch == 0 and i == 0:
                model.partial_fit(chunk_X, chunk_y, classes=classes, sample_weight=chunk_w)
            else:
                model.partial_fit(chunk_X, chunk_y, sample_weight=chunk_w)

    print("📈 正在评估模型...")
    y_pred = []
    test_domains = test_df["domain"].values
    total_test_chunks = (len(test_df) + CHUNK_SIZE - 1) // CHUNK_SIZE
    
    for i in tqdm(range(total_test_chunks), desc="Testing"):
        start = i * CHUNK_SIZE
        end = min((i + 1) * CHUNK_SIZE, len(test_df))
        chunk_domains = test_domains[start:end]
        chunk_X = csr_matrix([extract_features(make_url(d)) for d in chunk_domains])
        y_pred.extend(model.predict(chunk_X))

    y_test = test_df["label"].values
    target_names = ['Normal', 'Ad', 'Tracker']
    print(classification_report(y_test, y_pred, target_names=target_names, labels=classes, zero_division=0))

    macro_f1 = f1_score(y_test, y_pred, average='macro')
    
    # 🛡️ 核心修复：使用绝对路径保存模型权重
    os.makedirs(WEIGHTS_DIR, exist_ok=True)
    np.savez(os.path.join(WEIGHTS_DIR, "classifier_weights.npz"), coef=model.coef_, intercept=model.intercept_)
    
    label_dist = train_df["label"].value_counts().sort_index().to_dict()
    with open(os.path.join(WEIGHTS_DIR, "model_meta.json"), "w") as f:
        json.dump({
            "macroF1": float(macro_f1), 
            "trainedAt": pd.Timestamp.now().isoformat(),
            "nClasses": len(model.classes_),
            "nFeatures": 16418,
            "trainSize": len(train_df),
            "testSize": len(test_df),
            "labelDist": {str(k): int(v) for k, v in label_dist.items()},
            "featureSpecVersion": "v1.2.8-domain-aligned",
        }, f, indent=2)
        
    print(f"✅ 训练完成！Macro F1: {macro_f1:.4f}")

if __name__ == "__main__":
    train_model()
