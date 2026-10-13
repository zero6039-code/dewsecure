"""训练 DewSecure 分类器（特征与推理端严格一致）。"""

import os
import sys
import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score, roc_auc_score, precision_score, recall_score
from tqdm import tqdm

sys.path.insert(0, os.path.dirname(__file__))
from features import extract_features, FEATURE_DIM

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
WEIGHTS_DIR = os.path.join(os.path.dirname(__file__), "..", "weights")


def featurize_sparse(domains):
    """使用 extract_features（与推理端完全一致）生成稀疏矩阵。"""
    rows, cols, data = [], [], []
    for i, domain in enumerate(tqdm(domains, desc="特征提取")):
        features = extract_features(domain)
        for j, v in enumerate(features):
            if v != 0.0:
                rows.append(i)
                cols.append(j)
                data.append(v)
    X = csr_matrix((data, (rows, cols)), shape=(len(domains), FEATURE_DIM), dtype=np.float32)
    return X


def train():
    print("加载数据...")
    train_df = pd.read_csv(os.path.join(DATA_DIR, "train.csv"))
    test_df = pd.read_csv(os.path.join(DATA_DIR, "test.csv"))
    print(f"  训练集: {len(train_df)} 条, 测试集: {len(test_df)} 条")

    print("特征提取（与推理端一致）...")
    X_train = featurize_sparse(train_df["domain"].tolist())
    y_train = train_df["label"].values
    X_test = featurize_sparse(test_df["domain"].tolist())
    y_test = test_df["label"].values

    print(f"  训练矩阵: {X_train.shape}, 非零元素: {X_train.nnz}")
    print(f"  测试矩阵: {X_test.shape}, 非零元素: {X_test.nnz}")

    print("训练逻辑回归...")
    model = LogisticRegression(
        C=10.0,
        max_iter=1000,
        solver="liblinear",
        class_weight="balanced",
    )
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    y_prob = model.predict_proba(X_test)[:, 1]

    print("\n===== 评估结果 =====")
    print(f"F1 Score:      {f1_score(y_test, y_pred):.4f}")
    print(f"AUC-ROC:       {roc_auc_score(y_test, y_prob):.4f}")
    print(f"Precision:     {precision_score(y_test, y_pred):.4f}")
    print(f"Recall:        {recall_score(y_test, y_pred):.4f}")
    print(f"准确率:        {(y_pred == y_test).mean():.4f}")

    os.makedirs(WEIGHTS_DIR, exist_ok=True)
    weights_path = os.path.join(WEIGHTS_DIR, "classifier_weights.npz")
    np.savez(weights_path, coef=model.coef_[0], intercept=model.intercept_)
    print(f"\n权重已保存: {weights_path}")
    print(f"权重维度: {model.coef_[0].shape}")
    return model


if __name__ == "__main__":
    train()
