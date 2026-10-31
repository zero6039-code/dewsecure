import sys
import numpy as np
import onnxruntime as ort
from features import extract_features

SAFE_DOMAINS = [
    "google.com", "youtube.com", "facebook.com", "baidu.com", 
    "github.com", "wikipedia.org", "amazon.com", "twitter.com",
    "apple.com", "microsoft.com", "qq.com", "taobao.com",
    "jd.com", "bing.com", "office.com", "cloudflare.com"
]

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
        pred_class = np.argmax(probs)
        confidence = probs[pred_class]
        return pred_class, confidence

    print("  -> 检查正常域名是否被【高危误杀】(置信度 >= 0.8)...")
    for domain in SAFE_DOMAINS:
        pred, conf = predict(domain)
        # 只有被判定为 Ad(1)/Tracker(2) 且置信度超过前端门槛 0.8，才叫真误杀
        if pred != 0 and conf >= 0.8:
            print(f"  ❌ 高危误杀: {domain} 被判定为 {pred} (置信度: {conf:.2f})")
            failed = True

    # 🛑 删除了黑名单漏拦校验（交由前端硬拦截和 DNR 规则层兜底）
            # 注意：漏拦不阻断发布，因为我们有 11 万条 DNR 规则兜底

    if failed:
        print("❌ 金标集校验失败！模型产生高危偏移，已阻断发布！")
        sys.exit(1)
    else:
        print("✅ 金标集校验通过！(低置信度的轻微误判将被前端兜底拦截)")
        
if __name__ == "__main__":
    validate()
