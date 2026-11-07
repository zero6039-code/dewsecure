import os, json, zipfile, requests
import numpy as np
import pandas as pd
import lightgbm as lgb
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split

# 1. 加载训练脚本中的特征提取函数和数据下载逻辑
exec(open("training/train_phishscout_fixed.py").read().split("# ==========================================\n# 3. 训练与导出")[0])

# 2. 重新获取数据并划分验证集
pos_urls, neg_urls = download_data()
urls = pos_urls + neg_urls
labels = [1] * len(pos_urls) + [0] * len(neg_urls)
X = np.array([extract_features(u) for u in urls])
y = np.array(labels)

X_train, X_val, y_train, y_val = train_test_split(X, y, test_size=0.2, random_state=42)

# 3. 重新训练模型（或者加载已有的 booster，这里为了简单直接重训）
params = {
    'objective': 'binary', 'metric': 'binary_logloss',
    'num_leaves': 15, 'max_depth': 5, 'min_data_in_leaf': 20,
    'learning_rate': 0.05, 'lambda_l1': 0.1, 'lambda_l2': 0.1, 'verbose': -1
}
model = lgb.train(params, lgb.Dataset(X_train, label=y_train), num_boost_round=100)

# 4. 在验证集上获取 raw scores（未经过 sigmoid 的原始得分）
raw_scores = model.predict(X_val, raw_score=True).reshape(-1, 1)

# 5. 用逻辑回归拟合 Platt 参数
lr = LogisticRegression()
lr.fit(raw_scores, y_val)
a = float(lr.coef_[0][0])
b = float(lr.intercept_[0])
print(f"✅ 拟合成功: a={a:.6f}, b={b:.6f}")

# 6. 更新到已有的 JSON 模型文件
json_path = os.path.join(os.path.dirname(__file__), "..", "..", "extensions", "chrome", "src", "phishscout_local.json")
with open(json_path, 'r') as f:
    model_data = json.load(f)

model_data['platt']['a'] = a
model_data['platt']['b'] = b

with open(json_path, 'w') as f:
    json.dump(model_data, f)
print("✅ 已更新 phishscout_local.json 的 Platt 参数")
