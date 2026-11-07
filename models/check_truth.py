import json
import numpy as np
import sys
sys.path.append('training')
from train_balanced import extract_features, build_balanced_dataset, lgb, train_test_split

with open('../extensions/chrome/src/phishscout_local.json', 'r') as f:
    m = json.load(f)

def predict_json(feats):
    raw = 0
    for t in range(len(m['roots'])):
        i = m['roots'][t]
        while m['feat'][i] >= 0:
            v = feats[m['feat'][i]]
            go_left = (m['defLeft'][i] == 1) if np.isnan(v) else (v <= m['thr'][i])
            i = m['left'][i] if go_left else m['right'][i]
        raw += m['val'][i]
    return raw

# 提取百度的特征
feats = extract_features('https://www.baidu.com/')
print(f"百度真实特征的前 10 个: {feats[:10]}")

# 用刚刚导出的 JSON 模型跑一下
raw_score = predict_json(feats)
print(f"JSON 模型计算出的原始得分 (Raw Score): {raw_score}")

# 看看这棵树到底在搞什么鬼
i = m['roots'][0]
print(f"第一棵树根节点: feat={m['feat'][i]}, thr={m['thr'][i]}, left={m['left'][i]}, right={m['right'][i]}")
left_i = m['left'][i]
right_i = m['right'][i]
print(f"左子节点: feat={m['feat'][left_i]}, val={m['val'][left_i]}")
print(f"右子节点: feat={m['feat'][right_i]}, val={m['val'][right_i]}")
