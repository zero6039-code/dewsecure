"""将训练好的模型导出为 TensorFlow Lite 格式。"""

import os
import numpy as np

WEIGHTS_DIR = os.path.join(os.path.dirname(__file__), "..", "weights")


def export_tflite():
    import tensorflow as tf

    data = np.load(os.path.join(WEIGHTS_DIR, "classifier_weights.npz"))
    coef = data["coef"].astype(np.float32)
    intercept = data["intercept"].astype(np.float32)

    feature_dim = coef.shape[0]

    # 构建 Keras 模型
    model = tf.keras.Sequential([
        tf.keras.layers.Input(shape=(feature_dim,)),
        tf.keras.layers.Dense(1, activation="sigmoid"),
    ])

    # 设置权重
    model.layers[0].set_weights([
        coef.reshape(-1, 1),
        intercept.reshape(1),
    ])

    # 转换为 TFLite
    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    tflite_model = converter.convert()

    output_path = os.path.join(WEIGHTS_DIR, "classifier.tflite")
    with open(output_path, "wb") as f:
        f.write(tflite_model)

    print(f"TFLite 模型已保存: {output_path}")
    print(f"  大小: {len(tflite_model) / 1024:.1f} KB")


if __name__ == "__main__":
    export_tflite()
