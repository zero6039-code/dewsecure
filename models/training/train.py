"""训练 DewSecure 三分类模型（Ad / Tracker / Normal）。"""

import os
import sys
import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score, classification_report, confusion_matrix
from tqdm import tqdm

sys.path.insert(0, os.path.dirname(__file__))
from features import extract_features, FEATURE_DIM

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
WEIGHTS_DIR = os.path.join(os.path.dirname(__file__), "..", "weights")

LABELS = {0: "Normal", 1: "Ad", 2: "Tracker"}


def featurize_sparse(domains):
    rows, cols, data = [], [], []
    for i, domain in enumerate(tqdm(domains, desc="特征提取")):
        features = extract_features(domain)
        for j, v in enumerate(features):
            if v != 0.0:
                rows.append(i)
                cols.append(j)
                data.append(v)
    return csr_matrix((data, (rows, cols)), shape=(len(domains), FEATURE_DIM), dtype=np.float32)


def balance_classes(X, y):
    """简单过采样：让每个类别的样本数接近最大类别。"""
    from scipy.sparse import vstack
    unique, counts = np.unique(y, return_counts=True)
    max_count = counts.max()

    X_parts, y_parts = [X], [y]
    for cls, cnt in zip(unique, counts):
        if cnt < max_count * 0.5:  # 只有明显偏少的类别才过采样
            deficit = max_count - cnt
            idx = np.where(y == cls)[0]
            # 随机重复采样（加噪声避免完全重复）
            sampled = np.random.choice(idx, size=deficit, replace=True)
            X_over = X[sampled]
            y_over = np.full(deficit, cls, dtype=y.dtype)
            X_parts.append(X_over)
            y_parts.append(y_over)
            print(f"  类别 {LABELS[cls]}: {cnt} → {cnt + deficit} (过采样 {deficit})")

    return vstack(X_parts).tocsr(), np.concatenate(y_parts)


def train():
    print("加载数据...")
    train_df = pd.read_csv(os.path.join(DATA_DIR, "train.csv"))
    test_df = pd.read_csv(os.path.join(DATA_DIR, "test.csv"))
    print(f"  训练集: {len(train_df)}, 测试集: {len(test_df)}")
    print(f"  训练集标签分布:\n{train_df['label'].value_counts().sort_index()}")

    print("特征提取...")
    X_train = featurize_sparse(train_df["domain"].tolist())
    y_train = train_df["label"].values
    X_test = featurize_sparse(test_df["domain"].tolist())
    y_test = test_df["label"].values

    print("\n平衡类别...")
    X_train, y_train = balance_classes(X_train, y_train)
    print(f"  过采样后: {X_train.shape[0]} 条")

    print("\n训练多分类逻辑回归...")
    # scikit-learn 1.5+ 移除了 multi_class 参数（默认 multinomial for lbfgs）
    model = LogisticRegression(
        C=10.0,
        max_iter=1000,
        solver="lbfgs",
        class_weight="balanced",
    )
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)

    print("\n===== 评估结果 =====")
    print(classification_report(
        y_test, y_pred,
        target_names=["Normal", "Ad", "Tracker"],
        digits=4,
    ))
    print(f"宏平均 F1: {f1_score(y_test, y_pred, average='macro'):.4f}")
    print(f"加权 F1:   {f1_score(y_test, y_pred, average='weighted'):.4f}")

    print("\n混淆矩阵 (行=真实, 列=预测):")
    print("              Normal     Ad  Tracker")
    cm = confusion_matrix(y_test, y_pred)
    for i, row in enumerate(cm):
        print(f"  {LABELS[i]:>8}  {row[0]:>8} {row[1]:>6} {row[2]:>8}")

    os.makedirs(WEIGHTS_DIR, exist_ok=True)
    weights_path = os.path.join(WEIGHTS_DIR, "classifier_weights.npz")
    np.savez(
        weights_path,
        coef=model.coef_,            # shape: (3, FEATURE_DIM)
        intercept=model.intercept_,  # shape: (3,)
        classes=model.classes_,      # [0, 1, 2]
    )
    print(f"\n权重已保存: {weights_path}")
    print(f"coef shape: {model.coef_.shape}")
    print(f"classes: {model.classes_}")

    # 保存模型元信息
    import json
    meta = {
        "trainedAt": pd.Timestamp.now().isoformat(),
        "nClasses": int(model.coef_.shape[0]),
        "nFeatures": int(model.coef_.shape[1]),
        "macroF1": float(f1_score(y_test, y_pred, average='macro')),
        "weightedF1": float(f1_score(y_test, y_pred, average='weighted')),
        "trainSize": int(X_train.shape[0]),
        "testSize": int(X_test.shape[0]),
    }
    with open(os.path.join(WEIGHTS_DIR, "model_meta.json"), "w") as f:
        json.dump(meta, f, indent=2)
    print(f"元信息已保存: {os.path.join(WEIGHTS_DIR, 'model_meta.json')}")


if __name__ == "__main__":
    train()
