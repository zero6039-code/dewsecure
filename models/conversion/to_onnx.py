"""将三分类模型导出为 ONNX，并生成 SHA-256 校验和。"""

import os
import sys
import hashlib
import json
import numpy as np
import onnx
from onnx import helper, TensorProto

WEIGHTS_DIR = os.path.join(os.path.dirname(__file__), "..", "weights")


def compute_sha256(file_path):
    """计算文件的 SHA-256 校验和。"""
    sha256 = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha256.update(chunk)
    return sha256.hexdigest()


def export_onnx():
    weights_path = os.path.join(WEIGHTS_DIR, "classifier_weights.npz")
    if not os.path.exists(weights_path):
        print(f"❌ 权重文件不存在: {weights_path}")
        print("   请先运行: python training/train.py")
        sys.exit(1)

    data = np.load(weights_path)
    coef = data["coef"].astype(np.float32)
    intercept = data["intercept"].astype(np.float32)

    if coef.ndim != 2:
        print(f"❌ coef 维度错误: 期望 2D，实际 {coef.ndim}D")
        sys.exit(1)

    n_classes, feature_dim = coef.shape
    print(f"📊 类别数: {n_classes}, 特征维度: {feature_dim}")

    input_tensor = helper.make_tensor_value_info("input", TensorProto.FLOAT, [None, feature_dim])
    output_tensor = helper.make_tensor_value_info("output", TensorProto.FLOAT, [None, n_classes])

    weights_tensor = helper.make_tensor(
        "weights", TensorProto.FLOAT, dims=[feature_dim, n_classes],
        vals=coef.T.tobytes(), raw=True,
    )
    bias_tensor = helper.make_tensor(
        "bias", TensorProto.FLOAT, dims=[n_classes],
        vals=intercept.tobytes(), raw=True,
    )

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

    # INT8 量化
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

        # ⭐ 计算 SHA-256 并写入 meta
        sha256 = compute_sha256(quantized_path)
        print(f"🔐 SHA-256: {sha256}")

        meta_path = os.path.join(WEIGHTS_DIR, "model_meta.json")
        if os.path.exists(meta_path):
            with open(meta_path, "r") as f:
                meta = json.load(f)
            meta["sha256"] = sha256
            meta["modelSize"] = os.path.getsize(quantized_path)
            with open(meta_path, "w") as f:
                json.dump(meta, f, indent=2)
            print(f"✅ 校验和已写入: {meta_path}")
    except ImportError:
        print("⚠️ 跳过量化（未安装 onnxruntime）")


if __name__ == "__main__":
    export_onnx()
