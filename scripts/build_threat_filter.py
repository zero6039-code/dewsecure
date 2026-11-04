import os
import urllib.request
import json
import hashlib
import base64
from datetime import datetime, timezone

# ==========================================
# 1. 极简版 Bloom Filter (与 JS 端完全对齐)
# ==========================================
class FastBloomFilter:
    def __init__(self, capacity, error_rate):
        import math
        # 计算所需位数和哈希函数个数
        self.bits = math.ceil((capacity * math.log(error_rate)) / math.log(1 / math.pow(2, math.log(2))))
        self.hash_count = math.ceil((self.bits / capacity) * math.log(2))
        self.byte_size = math.ceil(self.bits / 8)
        self.buffer = bytearray(self.byte_size) # Python 原生字节数组

    def _hashes(self, s):
        h1 = 0x811c9dc5
        h2 = 0x1000193
        for char in s.encode('utf-8'):
            h1 = ((h1 ^ char) * 0x01000193) & 0xFFFFFFFF
            h2 = ((h2 ^ char) * 0x01000193) & 0xFFFFFFFF
        return h1, h2

    def add(self, s):
        h1, h2 = self._hashes(s)
        for i in range(self.hash_count):
            combined = (h1 + i * h2) & 0xFFFFFFFF
            bit_idx = combined % self.bits
            byte_idx = bit_idx >> 3
            bit_offset = bit_idx & 7
            self.buffer[byte_idx] |= (1 << bit_offset)

    def export_bin(self, filepath):
        # 写入前置元数据 (bits 和 hash_count) 供 JS 读取
        import struct
        with open(filepath, 'wb') as f:
            f.write(struct.pack('<II', self.bits, self.hash_count)) # 8字节头
            f.write(self.buffer) # 紧随其后的二进制数据

# ==========================================
# 2. 获取数据源
# ==========================================
print("📡 获取 Tranco Top 10k 白名单...")
tranco_url = "https://tranco-list.eu/top-1m.csv.zip" # 示例地址，实际可能需要解析 zip
# 为了演示，我们直接用一个内置的少量白名单兜底
WHITELIST_BASE = set(['google.com', 'github.com', 'cloudflare.com', 'apple.com', 'microsoft.com'])

print("📡 拉取 Phishing.Database...")
phishing_url = "https://raw.githubusercontent.com/Phishing-Database/Phishing.Database/master/phishing-domains-ACTIVE.txt"
phishing_domains = set()
try:
    req = urllib.request.Request(phishing_url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as response:
        for line in response.read().decode('utf-8').splitlines():
            domain = line.strip().lower()
            if domain and not domain.startswith('#'):
                phishing_domains.add(domain)
except Exception as e:
    print(f"⚠️ Phishing.Database 拉取失败: {e}")

print("📡 拉取 URLhaus...")
URLHAUS_AUTH_KEY = os.environ.get("URLHAUS_AUTH_KEY")
urlhaus_domains = set()
if URLHAUS_AUTH_KEY:
    url = "https://urlhaus-api.abuse.ch/v1/urls/recent/"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Auth-Key': URLHAUS_AUTH_KEY})
    try:
        with urllib.request.urlopen(req) as response:
            payload = json.loads(response.read().decode('utf-8'))
            from urllib.parse import urlparse
            for item in payload.get("urls", []):
                if item.get('url_status') == 'online':
                    host = urlparse(item.get("url", "")).hostname
                    if host:
                        urlhaus_domains.add(host.lower())
    except Exception as e:
        print(f"⚠️ URLhaus 拉取失败: {e}")

# ==========================================
# 3. 合并、去重、过滤
# ==========================================
print(f"📦 原始数据: Phishing={len(phishing_domains)}, URLhaus={len(urlhaus_domains)}")
all_malicious = phishing_domains | urlhaus_domains

# 剔除白名单 (Tranco)
filtered_domains = []
for d in all_malicious:
    if not any(d == w or d.endswith('.' + w) for w in WHITELIST_BASE):
        filtered_domains.append(d)

print(f"✅ 过滤后剩余 {len(filtered_domains)} 个恶意域名，准备构建 Binary Fuse Filter...")

# ==========================================
# 4. 构建过滤器并导出
# ==========================================
CAPACITY = max(1000000, len(filtered_domains)) # 预留容量
filter_obj = FastBloomFilter(CAPACITY, 0.005) # 0.5% 误报率

for domain in filtered_domains:
    filter_obj.add(domain)

bin_file = "threat-filter.bin"
filter_obj.export_bin(bin_file)

# ==========================================
# 5. 生成元信息并签名
# ==========================================
with open(bin_file, "rb") as f:
    bin_data = f.read()

sha256 = hashlib.sha256(bin_data).hexdigest()
version = datetime.now(timezone.utc).strftime("intel-%Y%m%d%H%M%S")

meta = {
    "version": version,
    "sha256": sha256,
    "count": len(filtered_domains),
    "capacity": CAPACITY
}

private_key_hex = os.environ.get('ED25519_PRIVATE_KEY')
if private_key_hex:
    from nacl.signing import SigningKey
    sk = SigningKey(bytes.fromhex(private_key_hex))
    msg = f"{version}:{sha256}".encode()
    sig_b64 = base64.b64encode(sk.sign(msg).signature).decode()
    meta["signature"] = sig_b64
    print(f"🔑 签名完成，公钥: {sk.verify_key.encode().hex()}")

with open("threat-filter.meta.json", "w") as f:
    json.dump(meta, f, indent=2)

print(f"🎉 构建完成！{bin_file} 大小: {len(bin_data) / 1024 / 1024:.2f} MB")
