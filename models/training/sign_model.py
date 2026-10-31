import os, json, hashlib, base64
from nacl.signing import SigningKey

def main():
    onnx_path = 'weights/classifier_int8.onnx'
    json_path = 'weights/weights.json'
    meta_path = 'weights/model_meta.json'
    
    if not os.path.exists(onnx_path) or not os.path.exists(meta_path):
        print("❌ 模型或元信息文件不存在")
        return

    # 1. 计算 ONNX 哈希
    with open(onnx_path, 'rb') as f:
        onnx_sha256 = hashlib.sha256(f.read()).hexdigest()
        
    # 1.1 计算 JSON 哈希 (如果有)
    json_sha256 = None
    if os.path.exists(json_path):
        with open(json_path, 'rb') as f:
            json_sha256 = hashlib.sha256(f.read()).hexdigest()

    # 2. 获取私钥并签名
    private_key_hex = os.environ.get('ED25519_PRIVATE_KEY')
    if not private_key_hex:
        raise ValueError("缺少 ED25519_PRIVATE_KEY 环境变量")

    sk = SigningKey(bytes.fromhex(private_key_hex))
    version = os.environ.get('VERSION', 'unknown')
    
    # 签 ONNX
    onnx_message = f"{version}:{onnx_sha256}".encode()
    onnx_sig_b64 = base64.b64encode(sk.sign(onnx_message).signature).decode()
    
    # 签 JSON
    json_sig_b64 = None
    if json_sha256:
        json_message = f"{version}:{json_sha256}".encode()
        json_sig_b64 = base64.b64encode(sk.sign(json_message).signature).decode()

    # 3. 写入 meta
    with open(meta_path, 'r') as f:
        meta = json.load(f)
        
    meta['sha256'] = onnx_sha256
    meta['signature'] = onnx_sig_b64
    
    if json_sha256:
        meta['jsonSha256'] = json_sha256
        meta['jsonSignature'] = json_sig_b64
        
    meta['trainedAt'] = version

    with open(meta_path, 'w') as f:
        json.dump(meta, f)

    print(f"✅ 签名完成，版本: {version}, ONNX哈希: {onnx_sha256[:10]}...")
    if json_sha256:
        print(f"✅ JSON 签名完成, JSON哈希: {json_sha256[:10]}...")

if __name__ == "__main__":
    main()