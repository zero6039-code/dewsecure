"""将训练好的模型导出为 ONNX 格式。"""

import os
import sys
import numpy as np
import onnx
from onnx import helper, TensorProto

WEIGHTS_DIR = os.path.join(os.path.dirname(__file__), "..", "weights")


def export_onnx():
    # 加载权重
    data = np.load(os.path.join(WEIGHTS_DIR, "classifier_weights.npz"))
    coef = data["coef"].astype(np.float32)  # shape: (FEATURE_DIM,)
    intercept = data["intercept"].astype(np.float32)  # shape: (1,)

    feature_dim = coef.shape[0]

    # 构建 ONNX 图
    input_tensor = helper.make_tensor_value_info(
        "input", TensorProto.FLOAT, [None, feature_dim]
    )
    output_tensor = helper.make_tensor_value_info(
        "output", TensorProto.FLOAT, [None, 1]
    )

    # 权重常量
    weights_tensor = helper.make_tensor(
        "weights",
        TensorProto.FLOAT,
        dims=[feature_dim, 1],
        vals=coef.tobytes(),
        raw=True,
    )
    bias_tensor = helper.make_tensor(
        "bias",
        TensorProto.FLOAT,
        dims=[1],
        vals=intercept.tobytes(),
        raw=True,
    )

    # 节点：MatMul → Add → Sigmoid
    matmul_node = helper.make_node("MatMul", ["input", "weights"], ["matmul_out"])
    add_node = helper.make_node("Add", ["matmul_out", "bias"], ["add_out"])
    sigmoid_node = helper.make_node("Sigmoid", ["add_out"], ["output"])

    graph = helper.make_graph(
        [matmul_node, add_node, sigmoid_node],
        "dewsecure_classifier",
        [input_tensor],
        [output_tensor],
        initializer=[weights_tensor, bias_tensor],
    )

    model = helper.make_model(
        graph,
        producer_name="dewsecure",
        opset_imports=[helper.make_opsetid("", 13)],
    )
    model.ir_version = 8

    # 检查模型
    onnx.checker.check_model(model)

    # 保存
    output_path = os.path.join(WEIGHTS_DIR, "classifier.onnx")
    onnx.save(model, output_path)
    print(f"ONNX 模型已保存: {output_path}")
    print(f"  大小: {os.path.getsize(output_path) / 1024:.1f} KB")

    # 尝试量化
    try:
        from onnxruntime.quantization import quantize_dynamic, QuantType
        quantized_path = os.path.join(WEIGHTS_DIR, "classifier_int8.onnx")
        quantize_dynamic(
            output_path,
            quantized_path,
            weight_type=QuantType.QInt8,
        )
        print(f"INT8 量化模型已保存: {quantized_path}")
        print(f"  大小: {os.path.getsize(quantized_path) / 1024:.1f} KB")
    except ImportError:
        print("跳过量化（未安装 onnxruntime）")


if __name__ == "__main__":
    export_onnx()
