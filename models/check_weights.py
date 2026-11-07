import onnx
from onnx import helper
import json

model = onnx.load("phishscout_onnx/model.onnx")
for node in model.graph.node:
    if node.op_type == 'TreeEnsembleClassifier':
        attrs = {a.name: a for a in node.attribute}
        break

def get_vals(name):
    attr = attrs.get(name)
    if not attr: return []
    val = helper.get_attribute_value(attr)
    return list(val)

class_ids = get_vals('class_ids')
class_weights = get_vals('class_weights')
class_nodeids = get_vals('class_nodeids')
nodes_nodeids = get_vals('nodes_nodeids')
nodes_featureids = get_vals('nodes_featureids')
nodes_values = get_vals('nodes_values')

print(f"class_ids 唯一值: {set(class_ids)}")
print(f"class_weights 前 10 个: {class_weights[:10]}")
print(f"class_nodeids 前 10 个: {class_nodeids[:10]}")
print(f"nodes_nodeids 前 10 个: {nodes_nodeids[:10]}")
print(f"nodes_featureids 前 10 个: {nodes_featureids[:10]}")
print(f"nodes_values 前 10 个: {nodes_values[:10]}")
