import urllib.request
import json
import os
import hashlib
import base64
from datetime import datetime, timezone
from urllib.parse import urlparse

# URLhaus v1/urls/recent/ JSON 端点（需 Auth-Key，免费注册于 auth.abuse.ch）
# 单次最多返回 1000 条近期条目，低于动态规则 5000 上限，做每日动态补充
AUTH_KEY = os.environ.get("URLHAUS_AUTH_KEY")
if not AUTH_KEY:
    print("❌ 缺少环境变量 URLHAUS_AUTH_KEY（GitHub Secrets 中已配置则 CI 不受影响）")
    exit(1)

print("📡 正在从 URLhaus v1/urls/recent/ 拉取最新钓鱼 URL...")
url = "https://urlhaus-api.abuse.ch/v1/urls/recent/"
req = urllib.request.Request(url, headers={
    'User-Agent': 'Mozilla/5.0 DewSecure/1.0',
    'Auth-Key': AUTH_KEY,
})

try:
    with urllib.request.urlopen(req) as response:
        payload = json.loads(response.read().decode('utf-8'))
except Exception as e:
    print(f"❌ 下载失败: {e}")
    exit(1)

items = payload.get("urls", [])
print(f"📦 URLhaus 返回 {len(items)} 条近期条目")

domains = []           # 保序去重：URLhaus recent 最新在前
seen = set()

for item in items:
    raw_url = item.get("url")
    if not raw_url:
        continue
    try:
        host = urlparse(raw_url).hostname
        if host and host not in seen:
            seen.add(host)
            domains.append(host)
    except:
        pass

print(f"✅ 共提取 {len(domains)} 个活跃恶意域名")

# 生成 DNR 规则格式（限制最多 5000 条，满足 Chrome 动态规则上限）
# ID 段：1_000_000 ~ 1_005_000（固定段，避开静态规则 ID 区）
# priority 保持 2_000_000（优先于静态 EasyList 执行）
rules = []
for i, domain in enumerate(domains[:5000]):
    rules.append({
        "id": 1000000 + i,
        "priority": 2000000,
        "action": { "type": "block" },
        "condition": {
            "requestDomains": [domain],
            "resourceTypes": ["main_frame", "sub_frame", "script", "image", "xmlhttprequest"]
        }
    })

output_file = "threat-rules.json"
json_data = json.dumps(rules, indent=2)
with open(output_file, "w") as f:
    f.write(json_data)

print(f"✅ 已生成 {output_file}，准备上传 R2。")

# ==========================================
# Ed25519 签名（与模型签名同格式：{version}:{sha256}）
# ==========================================
sha256 = hashlib.sha256(json_data.encode('utf-8')).hexdigest()
version = datetime.now(timezone.utc).strftime("intel-%Y%m%d")

private_key_hex = os.environ.get('ED25519_PRIVATE_KEY')
if private_key_hex:
    from nacl.signing import SigningKey
    sk = SigningKey(bytes.fromhex(private_key_hex))
    msg = f"{version}:{sha256}".encode()
    sig_b64 = base64.b64encode(sk.sign(msg).signature).decode()

    sig_file = "threat-rules.json.sig"
    with open(sig_file, "w") as f:
        json.dump({
            "version": version,
            "sha256": sha256,
            "signature": sig_b64
        }, f, indent=2)

    print(f"🔑 [CI DEBUG] 公钥: {sk.verify_key.encode().hex()}")
    print(f"✅ 已生成 {sig_file}，version={version}, sha256={sha256[:10]}...")
else:
    print("⚠️ 未设置 ED25519_PRIVATE_KEY，跳过签名（仅本地调试用）")
    print(f"   当前 sha256={sha256[:10]}..., version={version}")
