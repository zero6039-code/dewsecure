import os, json, hashlib, base64
from nacl.signing import SigningKey

def main():
    onnx_path = 'weights/classifier_int8.onnx'
    meta_path = 'weights/model_meta.json'
    
    if not os.path.exists(onnx_path) or not os.path.exists(meta_path):
        print("❌ 模型或元信息文件不存在")
        return

    # 1. 计算哈希
    with open(onnx_path, 'rb') as f:
        sha256 = hashlib.sha256(f.read()).hexdigest()

    # 2. 获取私钥并签名
    private_key_hex = os.environ.get('ED25519_PRIVATE_KEY')
    if not private_key_hex:
        raise ValueError("缺少 ED25519_PRIVATE_KEY 环境变量")

    sk = SigningKey(bytes.fromhex(private_key_hex))
    
    # 🔍 打印公钥，方便核对！
    print(f"🔑 [CI DEBUG] 使用的公钥 (请对比插件代码): {sk.verify_key.encode().hex()}")

    version = os.environ.get('VERSION', 'unknown')
    message = f"{version}:{sha256}".encode()
    sig_b64 = base64.b64encode(sk.sign(message).signature).decode()

    # 3. 写入 meta
    with open(meta_path, 'r') as f:
        meta = json.load(f)
    meta['signature'] = sig_b64
    meta['sha256'] = sha256
    meta['trainedAt'] = version  # 🔥 核心修复：必须把版本号写入 JSON！

    with open(meta_path, 'w') as f:
        json.dump(meta, f)

    print(f"✅ 签名完成，版本: {version}, 哈希: {sha256[:10]}...")

if __name__ == "__main__":
    main()
