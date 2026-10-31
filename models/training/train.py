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
    dynamic_seed = int(time.time()) % 100000 
    
    # 🛡️ 核心修复 1：修正路径读取
    hard_rules_path = os.path.join(os.path.dirname(__file__), 'hard_rules.json')
    force_train = pd.DataFrame()
    if os.path.exists(hard_rules_path):
        with open(hard_rules_path, 'r', encoding='utf-8') as f:
            rules = json.load(f)
            hard_domains = set(rules.get("hard_safe", []) + rules.get("hard_block", []))
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
    CHUNK_SIZE = 10000

    print("🔬 正在分块提取训练集特征...")
    X_train = np.zeros((len(train_df), N_FEATURES), dtype=np.float32)
    # 🛡️ 核心修复：强制转为整数，防止 pandas 把 label 推断为浮点数导致 sklearn 报错
    y_train = train_df["label"].astype(int).values
    
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

    print("🚀 正在初始化 SGD 增量学习模型...")
    classes = np.array([0, 1, 2])
    
    # 🛡️ 核心修复：防止因抽样导致某个类别完全缺失，强行注入一根假数据补齐
    missing_classes = set(classes) - set(np.unique(y_train))
    if missing_classes:
        print(f"⚠️ 警告：训练集中缺少类别 {missing_classes}，强制补齐防崩溃")
        for c_miss in missing_classes:
            y_train = np.append(y_train, c_miss)
            X_train = np.vstack([X_train, np.zeros(N_FEATURES, dtype=np.float32)])
            
    class_weights_arr = compute_class_weight('balanced', classes=classes, y=y_train)
    class_weight_dict = {cls: weight for cls, weight in zip(classes, class_weights_arr)}
    
    model = SGDClassifier(
        loss='log_loss', 
        penalty='l2', 
        alpha=1e-5, 
        max_iter=100, 
        random_state=42, # 模型内部迭代依然固定，保证收敛稳定
        class_weight=class_weight_dict
    )

    # 🔥 关键神技：多轮 Epoch + 每轮随机洗牌 (Shuffle)
    # 这彻底打破了数据固定顺序带来的过拟合，让模型学到更普适的规律！
    EPOCHS = 5 
    print(f"🏃 开始 {EPOCHS} 轮打乱顺序训练...")
    
    for epoch in range(EPOCHS):
        print(f"🔄 第 {epoch+1} 轮训练...")
        # 每一轮都打乱数据索引，让模型忘记上一轮的死板顺序
        indices = np.random.permutation(len(X_train))
        X_shuffled = X_train[indices]
        y_shuffled = y_train[indices]
        
        # 分块喂给模型
        for i in range(0, len(X_shuffled), CHUNK_SIZE):
            X_chunk = X_shuffled[i:i+CHUNK_SIZE]
            y_chunk = y_shuffled[i:i+CHUNK_SIZE]
            
            if epoch == 0 and i == 0:
                model.partial_fit(X_chunk, y_chunk, classes=classes)
            else:
                model.partial_fit(X_chunk, y_chunk)
                
        # 释放临时变量
        del X_shuffled, y_shuffled

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
    
    # 🔧 P2-C: 记录真实标签分布，README 不再宣称 98.75%
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
