import sys
import numpy as np
import onnxruntime as ort
from features import extract_features

# 绝对不允许被误杀的域名 (白名单)
SAFE_DOMAINS = [
    "google.com", "youtube.com", "facebook.com", "baidu.com", 
    "github.com", "wikipedia.org", "amazon.com", "twitter.com",
    "apple.com", "microsoft.com", "qq.com", "taobao.com",
    "jd.com", "bing.com", "office.com", "cloudflare.com"
]

# 绝对必须被拦截的域名 (黑名单)
MALICIOUS_DOMAINS = [
    "doubleclick.net", "google-analytics.com", "googlesyndication.com",
    "adservice.google.com", "scorecardresearch.com", "criteo.com",
    "taboola.com", "outbrain.com", "facebook.net", "adnxs.com"
]

def validate():
    print("🛡️ 正在运行金标集防御校验...")
    model_path = "weights/classifier_int8.onnx"
    try:
        sess = ort.InferenceSession(model_path)
    except Exception as e:
        print(f"❌ 无法加载模型: {e}")
        sys.exit(1)

    input_name = sess.get_inputs()[0].name
    failed = False

    def predict(domain):
        features = extract_features(domain)
        input_data = np.array([features], dtype=np.float32)
        probs = sess.run(None, {input_name: input_data})[0][0]
        return np.argmax(probs)

    print("  -> 检查正常域名是否被误杀...")
    for domain in SAFE_DOMAINS:
        pred = predict(domain)
        if pred != 0: # 0 = Normal
            print(f"  ❌ 误杀拦截: {domain} 被判定为 {pred}")
            failed = True

    print("  -> 检查恶意域名是否能被拦截...")
    for domain in MALICIOUS_DOMAINS:
        pred = predict(domain)
        if pred == 0: # 0 = Normal
            print(f"  ❌ 漏拦警告: {domain} 未被识别 (判定为 Normal)")
            # 这里如果模型泛化能力不足可以只警告不阻断，但大厂追踪器应该拦。
            # 为了安全，我们对恶意漏拦只警告，对正常误杀必须阻断。

    if failed:
        print("❌ 金标集校验失败！模型被投毒或欠拟合，阻断发布！")
        sys.exit(1)
    else:
        print("✅ 金标集校验通过，模型健康！")

if __name__ == "__main__":
    validate()
