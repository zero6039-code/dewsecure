import onnx
from onnx import helper
import json
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
    if name not in attrs: return []
    attr = attrs[name]
    try:
        val = helper.get_attribute_value(attr)
        if isinstance(val, (list, tuple)): return list(val)
        if hasattr(val, 'tolist'): return val.tolist()
        if isinstance(val, (int, float)): return [val]
    except Exception: pass
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

class_treeids = get_attr_vals('class_treeids')
class_nodeids = get_attr_vals('class_nodeids')
class_weights = get_attr_vals('class_weights')
base_values = get_attr_vals('base_values')
base_value = float(base_values[0]) if base_values else 0.0

print(f"✅ 提取到 base_values 初始偏置: {base_value}")

feat, thr, left, right, def_left, val, roots = [], [], [], [], [], [], []
num_trees = max(nodes_treeids) + 1
node_map = {}
tree_roots = {}

# 1. 分配索引，并使用正确的 is_leaf 判断逻辑
for i in range(len(nodes_treeids)):
    t_id = int(nodes_treeids[i])
    n_id = int(nodes_nodeids[i])
    global_idx = len(feat)
    node_map[(t_id, n_id)] = global_idx
    if n_id == 0: tree_roots[t_id] = global_idx

    # 核心修复：如果 true 节点和 false 节点是同一个，说明是叶子节点
    is_leaf = int(nodes_truenodeids[i]) == int(nodes_falsenodeids[i])
    
    if is_leaf:
        feat.append(-1); thr.append(0.0); left.append(-1); right.append(-1); def_left.append(1); val.append(0.0)
    else:
        feat.append(int(nodes_featureids[i])); thr.append(float(nodes_values[i]))
        left.append(-1); right.append(-1); def_left.append(int(nodes_missing_value_tracks_true[i]) if len(nodes_missing_value_tracks_true) > i else 1)
        val.append(0.0)

# 2. 填充左右子树
for i in range(len(nodes_treeids)):
    t_id = int(nodes_treeids[i]); n_id = int(nodes_nodeids[i])
    global_idx = node_map[(t_id, n_id)]
    if feat[global_idx] != -1:
        left[global_idx] = node_map.get((t_id, int(nodes_truenodeids[i])), -1)
        right[global_idx] = node_map.get((t_id, int(nodes_falsenodeids[i])), -1)

# 3. 填充叶子权重
for i in range(len(class_treeids)):
    t_id = int(class_treeids[i]); n_id = int(class_nodeids[i])
    global_idx = node_map.get((t_id, n_id))
    if global_idx is not None:
        val[global_idx] = float(class_weights[i])

for t_id in range(num_trees):
    roots.append(tree_roots.get(t_id, 0))

out_json = {
    'nFeatures': 579, 'roots': roots, 'feat': feat, 'thr': thr,
    'left': left, 'right': right, 'defLeft': def_left, 'val': val,
    'baseValue': base_value,
    'platt': {'a': 1.0, 'b': 0.0}
}

out_path = os.path.join(os.path.dirname(__file__), "..", "extensions", "chrome", "src", "phishscout_local.json")
with open(out_path, 'w') as f:
    json.dump(out_json, f)
print(f"🎉 包含完美树结构的 JSON 模型导出成功！")
