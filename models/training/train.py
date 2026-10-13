"""训练 DewSecure 分类器。"""

import os
import sys
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score, roc_auc_score, precision_score, recall_score
from tqdm import tqdm

sys.path.insert(0, os.path.dirname(__file__))
from features import extract_features, FEATURE_DIM

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
WEIGHTS_DIR = os.path.join(os.path.dirname(__file__), "..", "weights")


def load_data():
    train_df = pd.read_csv(os.path.join(DATA_DIR, "train.csv"))
    test_df = pd.read_csv(os.path.join(DATA_DIR, "test.csv"))
    return train_df, test_df


def featurize(df):
    X = np.zeros((len(df), FEATURE_DIM), dtype=np.float32)
    for i, domain in enumerate(tqdm(df["domain"], desc="特征提取")):
        X[i] = extract_features(domain)
    y = df["label"].values
    return X, y


def train():
    print("加载数据...")
    train_df, test_df = load_data()
    print(f"  训练集: {len(train_df)} 条, 测试集: {len(test_df)} 条")

    print("特征提取...")
    X_train, y_train = featurize(train_df)
    X_test, y_test = featurize(test_df)

    print("训练逻辑回归...")
    model = LogisticRegression(
        C=10.0,
        max_iter=1000,
        solver="liblinear",
        class_weight="balanced",
    )
    model.fit(X_train, y_train)

    # 评估
    y_pred = model.predict(X_test)
    y_prob = model.predict_proba(X_test)[:, 1]

    print("\n===== 评估结果 =====")
    print(f"F1 Score:      {f1_score(y_test, y_pred):.4f}")
    print(f"AUC-ROC:       {roc_auc_score(y_test, y_prob):.4f}")
    print(f"Precision:     {precision_score(y_test, y_pred):.4f}")
    print(f"Recall:        {recall_score(y_test, y_pred):.4f}")
    print(f"准确率:        {(y_pred == y_test).mean():.4f}")

    # 保存
    os.makedirs(WEIGHTS_DIR, exist_ok=True)
    weights_path = os.path.join(WEIGHTS_DIR, "classifier_weights.npz")
    np.savez(
        weights_path,
        coef=model.coef_[0],
        intercept=model.intercept_,
    )
    print(f"\n权重已保存: {weights_path}")

    return model


if __name__ == "__main__":
    train()
