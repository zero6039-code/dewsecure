import onnx
from onnx import helper
import json
import os
import numpy as np
import onnxruntime as ort

print("正在加载官方 ONNX 模型...")
model = onnx.load("phishscout_onnx/model.onnx")

tree_node = None
for node in model.graph.node:
    if node.op_type == 'TreeEnsembleClassifier':
        tree_node = node
        break
attrs = {a.name: a for a in tree_node.attribute}

def get_attr_vals(name):
    if name not in attrs: return []
    attr = attrs[name]
    try:
        val = helper.get_attribute_value(attr)
        if isinstance(val, (list, tuple)): return list(val)
        if hasattr(val, 'tolist'): return val.tolist()
    except: pass
    if len(attr.ints) > 0: return list(attr.ints)
    if len(attr.floats) > 0: return list(attr.floats)
    return []

nodes_treeids = get_attr_vals('nodes_treeids')
nodes_nodeids = get_attr_vals('nodes_nodeids')
nodes_featureids = get_attr_vals('nodes_featureids')
nodes_values = get_attr_vals('nodes_values')
nodes_truenodeids = get_attr_vals('nodes_truenodeids')
nodes_falsenodeids = get_attr_vals('nodes_falsenodeids')
nodes_missing_value_tracks_true = get_attr_vals('nodes_missing_value_tracks_true')
class_treeids = get_attr_vals('class_treeids')
class_nodeids = get_attr_vals('class_nodeids')
class_weights = get_attr_vals('class_weights')

# 提取树结构
feat, thr, left, right, def_left, val, roots = [], [], [], [], [], [], []
num_trees = max(nodes_treeids) + 1
node_map = {}
tree_roots = {}

for i in range(len(nodes_treeids)):
    t_id = int(nodes_treeids[i]); n_id = int(nodes_nodeids[i])
    global_idx = len(feat); node_map[(t_id, n_id)] = global_idx
    if n_id == 0: tree_roots[t_id] = global_idx

    is_leaf = int(nodes_featureids[i]) == 0 and int(nodes_truenodeids[i]) == 0 and int(nodes_falsenodeids[i]) == 0
    if is_leaf:
        feat.append(-1); thr.append(0.0); left.append(-1); right.append(-1); def_left.append(1); val.append(0.0)
    else:
        feat.append(int(nodes_featureids[i])); thr.append(float(nodes_values[i]))
        left.append(-1); right.append(-1); def_left.append(int(nodes_missing_value_tracks_true[i]) if len(nodes_missing_value_tracks_true) > i else 1); val.append(0.0)

for i in range(len(nodes_treeids)):
    t_id = int(nodes_treeids[i]); n_id = int(nodes_nodeids[i]); global_idx = node_map[(t_id, n_id)]
    if feat[global_idx] != -1:
        left[global_idx] = node_map.get((t_id, int(nodes_truenodeids[i])), -1)
        right[global_idx] = node_map.get((t_id, int(nodes_falsenodeids[i])), -1)

for i in range(len(class_treeids)):
    global_idx = node_map.get((int(class_treeids[i]), int(class_nodeids[i])))
    if global_idx is not None:
        val[global_idx] = float(class_weights[i])

for t_id in range(num_trees):
    roots.append(tree_roots.get(t_id, 0))

# ==========================================
# 计算绝对精确的偏差补偿（核心！）
# ==========================================
print("正在校准偏差...")
# 用全零特征模拟一个基准，对比 ONNX 跑出来的结果和纯 JS 逻辑的差距
sess = ort.InferenceSession("phishscout_onnx/model.onnx")
input_name = sess.get_inputs()[0].name
dummy_x = np.zeros((1, 579), dtype=np.float32)

# ONNX 算出来的 Raw Logit
onnx_out = sess.run(None, {input_name: dummy_x})[1][0]
onnx_prob = onnx_out[1]
onnx_logit = np.log(onnx_prob / (1 - onnx_prob + 1e-9))

# 我们纯 JS 逻辑对全零特征算出来的 Raw Logit
js_raw = 0
for t in range(len(roots)):
    i = roots[t]
    while feat[i] >= 0:
        v = dummy_x[0][feat[i]]
        go_left = (def_left[i] == 1) if np.isnan(v) else (v <= thr[i])
        i = left[i] if go_left else right[i]
    js_raw += val[i]

# 计算差值，这就是我们需要补偿的 baseValue
base_value = onnx_logit - js_raw
print(f"✅ 计算得出精确的补偿偏置 baseValue = {base_value:.6f}")

out_json = {
    'nFeatures': 579, 'roots': roots, 'feat': feat, 'thr': thr,
    'left': left, 'right': right, 'defLeft': def_left, 'val': val,
    'baseValue': float(base_value),
    'platt': {'a': 1.0, 'b': 0.0}
}

out_path = os.path.join(os.path.dirname(__file__), "..", "extensions", "chrome", "src", "phishscout_local.json")
with open(out_path, 'w') as f:
    json.dump(out_json, f)
print(f"🎉 包含完美偏置的 JSON 模型导出成功！")
