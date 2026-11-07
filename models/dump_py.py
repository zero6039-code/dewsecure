import json
import numpy as np
from training.train_balanced import extract_features

url = 'https://www.baidu.com/'
feats = extract_features(url)
# 找出所有非零的特征索引
nonzero = {str(i): float(feats[i]) for i in np.nonzero(feats)[0]}
with open('/tmp/py_feats.json', 'w') as f:
    json.dump(nonzero, f)
print("Python 非零特征索引:", list(nonzero.keys()))
