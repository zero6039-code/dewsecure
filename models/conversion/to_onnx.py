"""将三分类模型导出为 ONNX。"""

import os
import sys
import numpy as np
import onnx
from onnx import helper, TensorProto

WEIGHTS_DIR = os.path.join(os.path.dirname(__file__), "..", "weights")


def export_onnx():
    weights_path = os.path.join(WEIGHTS_DIR, "classifier_weights.npz")
    if not os.path.exists(weights_path):
        print(f"❌ 权重文件不存在: {weights_path}")
        print("   请先运行: python training/train.py")
        sys.exit(1)

    data = np.load(weights_path)

    if "coef" not in data:
        print("❌ 权重文件缺少 'coef' 字段")
        sys.exit(1)

    coef = data["coef"].astype(np.float32)
    intercept = data["intercept"].astype(np.float32)

    # 安全校验：必须是 2D（多分类）
    if coef.ndim != 2:
        print(f"❌ coef 维度错误: 期望 2D，实际 {coef.ndim}D (shape={coef.shape})")
        print("   可能原因：权重文件是旧的二分类版本")
        print("   解决方案：重新运行 python training/train.py")
        sys.exit(1)

    n_classes, feature_dim = coef.shape
    if n_classes != 3:
        print(f"⚠️  类别数不是 3 (实际 {n_classes})，继续导出...")

    if intercept.ndim != 1 or intercept.shape[0] != n_classes:
        print(f"❌ intercept 形状不匹配: {intercept.shape} vs ({n_classes},)")
        sys.exit(1)

    print(f"📊 类别数: {n_classes}, 特征维度: {feature_dim}")

    input_tensor = helper.make_tensor_value_info("input", TensorProto.FLOAT, [None, feature_dim])
    output_tensor = helper.make_tensor_value_info("output", TensorProto.FLOAT, [None, n_classes])

    # 权重矩阵转置: (FEATURE_DIM, n_classes)
    weights_tensor = helper.make_tensor(
        "weights", TensorProto.FLOAT, dims=[feature_dim, n_classes],
        vals=coef.T.tobytes(), raw=True,
    )
    bias_tensor = helper.make_tensor(
        "bias", TensorProto.FLOAT, dims=[n_classes],
        vals=intercept.tobytes(), raw=True,
    )

    # 图: MatMul -> Add -> Softmax
    matmul = helper.make_node("MatMul", ["input", "weights"], ["matmul_out"])
    add = helper.make_node("Add", ["matmul_out", "bias"], ["logits"])
    softmax = helper.make_node("Softmax", ["logits"], ["output"], axis=1)

    graph = helper.make_graph(
        [matmul, add, softmax], "dewsecure_3class",
        [input_tensor], [output_tensor],
        initializer=[weights_tensor, bias_tensor],
    )

    model = helper.make_model(
        graph, producer_name="dewsecure",
        opset_imports=[helper.make_opsetid("", 13)],
    )
    model.ir_version = 8
    onnx.checker.check_model(model)

    output_path = os.path.join(WEIGHTS_DIR, "classifier.onnx")
    onnx.save(model, output_path)
    print(f"✅ ONNX 已保存: {output_path} ({os.path.getsize(output_path)/1024:.1f} KB)")

    try:
        from onnxruntime.quantization import quantize_dynamic, QuantType
        quantized_path = os.path.join(WEIGHTS_DIR, "classifier_int8.onnx")
        quantize_dynamic(output_path, quantized_path, weight_type=QuantType.QInt8)
        print(f"✅ INT8 已保存: {quantized_path} ({os.path.getsize(quantized_path)/1024:.1f} KB)")

        # 验证新模型
        import onnxruntime as ort
        sess = ort.InferenceSession(quantized_path)
        input_name = sess.get_inputs()[0].name
        test_input = np.zeros((1, feature_dim), dtype=np.float32)
        result = sess.run(None, {input_name: test_input})
        print(f"✅ 新模型输出形状: {result[0].shape} (期望 (1, {n_classes}))")
    except ImportError:
        print("⚠️ 跳过量化（未安装 onnxruntime）")


if __name__ == "__main__":
    export_onnx()
