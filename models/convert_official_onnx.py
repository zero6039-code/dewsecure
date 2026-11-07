import onnx
from onnx import helper
import json
import numpy as np
import os

print("正在加载官方 ONNX 模型...")
model = onnx.load("phishscout_onnx/model.onnx")

tree_node = None
for node in model.graph.node:
    if node.op_type == 'TreeEnsembleClassifier':
        tree_node = node
        break

attrs = {a.name: a for a in tree_node.attribute}

def get_attr_vals(name):
    if name not in attrs:
        return []
    attr = attrs[name]
    try:
        val = helper.get_attribute_value(attr)
        if isinstance(val, (list, tuple)): return list(val)
        if hasattr(val, 'tolist'): return val.tolist()
        if isinstance(val, (int, float)): return [val]
    except Exception:
        pass
    if len(attr.ints) > 0: return list(attr.ints)
    if len(attr.floats) > 0: return list(attr.floats)
    if attr.t and len(attr.t.int64_data) > 0: return list(attr.t.int64_data)
    if attr.t and len(attr.t.float_data) > 0: return list(attr.t.float_data)
    return []

nodes_treeids = get_attr_vals('nodes_treeids')
nodes_nodeids = get_attr_vals('nodes_nodeids')
nodes_featureids = get_attr_vals('nodes_featureids')
nodes_values = get_attr_vals('nodes_values')
nodes_truenodeids = get_attr_vals('nodes_truenodeids')
nodes_falsenodeids = get_attr_vals('nodes_falsenodeids')
nodes_missing_value_tracks_true = get_attr_vals('nodes_missing_value_tracks_true')

# 关键修复：直接提取 class 权重，不判断 class_ids
class_treeids = get_attr_vals('class_treeids')
class_nodeids = get_attr_vals('class_nodeids')
class_weights = get_attr_vals('class_weights')

feat, thr, left, right, def_left, val, roots = [], [], [], [], [], [], []
num_trees = max(nodes_treeids) + 1
node_map = {}
tree_roots = {}

for i in range(len(nodes_treeids)):
    t_id = int(nodes_treeids[i])
    n_id = int(nodes_nodeids[i])
    global_idx = len(feat)
    node_map[(t_id, n_id)] = global_idx
    
    if n_id == 0:
        tree_roots[t_id] = global_idx

    is_leaf = int(nodes_featureids[i]) == 0 and int(nodes_truenodeids[i]) == 0 and int(nodes_falsenodeids[i]) == 0

    if is_leaf:
        feat.append(-1)
        thr.append(0.0)
        left.append(-1)
        right.append(-1)
        def_left.append(1)
        val.append(0.0)
    else:
        feat.append(int(nodes_featureids[i]))
        thr.append(float(nodes_values[i]))
        left.append(-1)
        right.append(-1)
        def_left.append(int(nodes_missing_value_tracks_true[i]) if len(nodes_missing_value_tracks_true) > i else 1)
        val.append(0.0)

for i in range(len(nodes_treeids)):
    t_id = int(nodes_treeids[i])
    n_id = int(nodes_nodeids[i])
    global_idx = node_map[(t_id, n_id)]
    
    if feat[global_idx] != -1:
        true_nid = int(nodes_truenodeids[i])
        false_nid = int(nodes_falsenodeids[i])
        left[global_idx] = node_map.get((t_id, true_nid), -1)
        right[global_idx] = node_map.get((t_id, false_nid), -1)

# 直接映射所有权重
for i in range(len(class_treeids)):
    t_id = int(class_treeids[i])
    n_id = int(class_nodeids[i])
    global_idx = node_map.get((t_id, n_id))
    if global_idx is not None:
        val[global_idx] = float(class_weights[i])

for t_id in range(num_trees):
    roots.append(tree_roots.get(t_id, 0))

# 写死官方需要的 Logistic 校准参数
out_json = {
    'nFeatures': 579, 'roots': roots, 'feat': feat, 'thr': thr,
    'left': left, 'right': right, 'defLeft': def_left, 'val': val,
    'platt': {'a': 1.0, 'b': 0.0}
}

out_path = os.path.join(os.path.dirname(__file__), "..", "extensions", "chrome", "src", "phishscout_local.json")
with open(out_path, 'w') as f:
    json.dump(out_json, f)
print(f"✅ 修复版：提取 {num_trees} 棵树，{len(feat)} 个节点，写入非零权重 {sum(1 for v in val if v != 0.0)} 个")
