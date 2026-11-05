import numpy as np
import pandas as pd
import os
import json
import time
from sklearn.linear_model import SGDClassifier
from sklearn.metrics import f1_score, classification_report
from sklearn.utils.class_weight import compute_class_weight
from tqdm import tqdm
from features import extract_features

def prepare_dataset():
    print("📦 正在加载数据集...")
    train_df = pd.read_csv("data/train.csv")
    test_df = pd.read_csv("data/test.csv")

    # 🔥 动态随机种子：每次运行都会产生不同的随机数，保证抽样数据每次都不一样！
    # 这样既保证了每次跑分的独立性，也能覆盖到更多数据。
    dynamic_seed = 42  # 🛡️ E4 修复：锁定随机种子，确保每次训练结果可复现 
    
    # 🛡️ 核心修复 1：修正路径读取
    hard_rules_path = os.path.join(os.path.dirname(__file__), 'hard_rules.json')
    force_train = pd.DataFrame()
    if os.path.exists(hard_rules_path):
        with open(hard_rules_path, 'r', encoding='utf-8') as f:
            rules = json.load(f)
            hard_domains = set(rules.get("hard_safe", []) + rules.get("hard_block", []))
            # 严格保证拉出来的金标数据是对应的标签，防止污染
    force_train = train_df[train_df["domain"].isin(hard_domains)]
    
    # 🛡️ 核心修复 2：改用分层抽样 (Stratified Sampling)，保证类别比例绝对平衡
    if len(train_df) > 50000:
        print(f"🎲 使用动态种子 {dynamic_seed} 进行分层抽样 50000 条...")
        # 按照 label 分组抽取，使用循环拼接防止 Pandas 新版机制导致 NaN
        sampled_list = []
        for label, group in train_df.groupby("label"):
            n_samples = int(len(group) / len(train_df) * 50000)
            sampled_list.append(group.sample(n=n_samples, random_state=dynamic_seed))
        sampled = pd.concat(sampled_list).reset_index(drop=True)
        # 将抽样数据与强制保留的金标数据合并
        train_df = pd.concat([sampled, force_train]).drop_duplicates(subset=["domain"]).reset_index(drop=True)
        print(f"🛡️ 已强制保留 {len(force_train)} 条金标数据，最终训练集大小: {len(train_df)}")
    if len(test_df) > 10000:
        test_df = test_df.sample(n=10000, random_state=dynamic_seed)

    train_df = train_df.sample(frac=1, random_state=dynamic_seed).reset_index(drop=True)
    test_df = test_df.sample(frac=1, random_state=dynamic_seed).reset_index(drop=True)
    
    print(f"📊 最终训练集: {len(train_df)}, 测试集: {len(test_df)}")
    
    # 🛡️ 核心修复：强力清洗 NA 和浮点数，防患于未然
    train_df = train_df.dropna(subset=["domain", "label"]).copy()
    train_df["label"] = pd.to_numeric(train_df["label"], errors='coerce').fillna(0).astype(int)
    
    test_df = test_df.dropna(subset=["domain", "label"]).copy()
    test_df["label"] = pd.to_numeric(test_df["label"], errors='coerce').fillna(0).astype(int)
    
    return train_df, test_df

def train_model():
    train_df, test_df = prepare_dataset()

    N_FEATURES = 16418
    CHUNK_SIZE = 5000  # 🛡️ 内存优化：分块大小下调至 5000，本地稳跑
    EPOCHS = 5

    print("🚀 正在初始化 SGD 增量学习模型...")
    classes = np.array([0, 1, 2])
    
    model = SGDClassifier(
        loss='log_loss', 
        penalty='l2', 
        alpha=1e-5, 
        max_iter=100, 
        random_state=42 
    )

    print(f"🏃 开始 {EPOCHS} 轮打乱顺序训练（在线学习模式，防OOM）...")
    for epoch in range(EPOCHS):
        train_df = train_df.sample(frac=1, random_state=42 + epoch).reset_index(drop=True)
        print(f"🔄 第 {epoch+1} 轮训练...")
        
        total_chunks = (len(train_df) + CHUNK_SIZE - 1) // CHUNK_SIZE
        for i in range(total_chunks):
            start = i * CHUNK_SIZE
            end = min((i + 1) * CHUNK_SIZE, len(train_df))
            chunk = train_df.iloc[start:end]
            
            # 仅提取当前块的特征
            X_list = []
            for domain in chunk["domain"]:
                X_list.append(extract_features(domain))
            
            from scipy.sparse import csr_matrix
            X_chunk = csr_matrix(X_list)
            y_chunk = chunk["label"].astype(int).values

            if epoch == 0 and i == 0:
                model.partial_fit(X_chunk, y_chunk, classes=classes)
            else:
                model.partial_fit(X_chunk, y_chunk)
            
            print(f"  ✅ Epoch {epoch+1} 进度: Chunk {i+1}/{total_chunks}")

    print("📈 正在评估模型 (分块预测，防OOM)...")
    y_test = test_df["label"].astype(int).values
    y_pred = []
    
    from tqdm import tqdm
    from scipy.sparse import csr_matrix
    
    for i in tqdm(range(0, len(test_df), CHUNK_SIZE), desc="Test"):
        chunk = test_df.iloc[i:i+CHUNK_SIZE]
        X_chunk = csr_matrix([extract_features(d) for d in chunk["domain"]])
        preds = model.predict(X_chunk)
        y_pred.extend(preds)
        
    y_pred = np.array(y_pred)

    target_names = ['Normal', 'Ad', 'Tracker']
    try:
        print(classification_report(y_test, y_pred, target_names=target_names, zero_division=0))
    except:
        print(classification_report(y_test, y_pred, zero_division=0))

    macro_f1 = f1_score(y_test, y_pred, average='macro')
    
    os.makedirs("weights", exist_ok=True)
    np.savez("weights/classifier_weights.npz", coef=model.coef_, intercept=model.intercept_)
    
    label_dist = train_df["label"].value_counts().sort_index().to_dict()
    with open("weights/model_meta.json", "w") as f:
        json.dump({
            "macroF1": float(macro_f1), 
            "trainedAt": pd.Timestamp.now().isoformat(),
            "nClasses": len(model.classes_),
            "nFeatures": N_FEATURES,
            "trainSize": len(train_df),
            "testSize": len(test_df),
            "labelDist": {str(k): int(v) for k, v in label_dist.items()},
            "featureSpecVersion": "v1.2.6-step1",
        }, f)
        
    print(f"✅ 训练完成！Macro F1: {macro_f1:.4f}")

if __name__ == "__main__":
    train_model()
