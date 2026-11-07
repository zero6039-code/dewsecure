import json
import numpy as np
import onnxruntime as ort
# 复用 debug_onnx.py 里的特征提取，这里直接导入
import importlib.util
spec = importlib.util.spec_from_file_location("debug_onnx", "debug_onnx.py")
debug_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(debug_mod)

# 1. 官方 ONNX
sess = ort.InferenceSession("phishscout_onnx/model.onnx")
input_name = sess.get_inputs()[0].name
output_names = [o.name for o in sess.get_outputs()]

# 2. 我们转换的 JSON 纯 Python 推理
with open("../extensions/chrome/src/phishscout_local.json", "r") as f:
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
    return 1 / (1 + np.exp(-(m['platt']['a'] * raw + m['platt']['b'])))

urls = [
    "http://neverssl.com/",
    "https://www.baidu.com/",
    "http://paypal.com.security-update.xyz/login.php?user=12345",
    "http://maybank2u.com-account-verify.tk/"
]

print(f"{'URL':<50} | {'ONNX 概率':<12} | {'JSON 概率':<12}")
print("-" * 80)
for u in urls:
    feats = debug_mod.extract_features(u)
    onnx_prob = sess.run(output_names, {input_name: feats.reshape(1, -1)})[1][0][1]
    json_prob = predict_json(feats)
    print(f"{u[:48]:<50} | {onnx_prob:.6f}     | {json_prob:.6f}")
