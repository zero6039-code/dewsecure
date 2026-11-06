#!/usr/bin/env python3
# ==========================================
# Threat Filter 构建脚本（N-3 修复）
# 格式：DEW1 + h(1B) + count(4B LE) + 排序的 h*count 字节 SHA-256 前缀
# ==========================================
import os
import sys
import json
import struct
import hashlib
import base64
import urllib.request
from datetime import datetime, timezone
from urllib.parse import urlparse

H = 5                                   # 5 字节 = 40 bit 前缀，误报约 N/2^40
MAGIC = b'DEW1'
MIN_DOMAINS = 50_000                    # 低于此条数视为异常
MAX_DROP_RATIO = 0.30                   # 相比上一版下降超 30% 视为异常

# 共享托管平台根域（攻击者可在子域自由部署，整域不能标记恶意）
# 注意：只剔除根域本身；子域（如 evil.github.io）依然可以作为恶意条目
SHARED_HOSTING_ROOTS = {
    'github.io', 'gitlab.io', 'netlify.app', 'vercel.app', 'pages.dev',
    'blogspot.com', 'wordpress.com', 'wixsite.com', 'weebly.com',
    'herokuapp.com', 'azurewebsites.net', 'cloudfront.net', 'amazonaws.com',
    'firebaseapp.com', 'web.app', 'glitch.me', 'replit.dev', 'repl.co',
    'surge.sh', 'ngrok.io', 'ngrok-free.app', 'trycloudflare.com',
    'duckdns.org', 'no-ip.org', 'hopto.org', 'ddns.net',
    '000webhostapp.com', 'weeblysite.com', 'webflow.io', 'fly.dev',
    'onrender.com', 'railway.app', 'deno.dev', 'workers.dev',
}

def h40(s: str) -> bytes:
    return hashlib.sha256(s.encode('utf-8')).digest()[:H]

def fetch_phishing_db() -> set:
    url = "https://raw.githubusercontent.com/Phishing-Database/Phishing.Database/master/phishing-domains-ACTIVE.txt"
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=60) as r:
            text = r.read().decode('utf-8')
        return {ln.strip().lower() for ln in text.splitlines()
                if ln.strip() and not ln.startswith('#')}
    except Exception as e:
        print(f"❌ Phishing.Database 拉取失败: {e}")
        sys.exit(1)

def fetch_urlhaus() -> set:
    key = os.environ.get("URLHAUS_AUTH_KEY")
    if not key:
        print("⚠️ URLHAUS_AUTH_KEY 未设置，跳过 URLhaus")
        return set()
    url = "https://urlhaus-api.abuse.ch/v1/urls/recent/"
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Auth-Key': key})
        with urllib.request.urlopen(req, timeout=60) as r:
            payload = json.loads(r.read().decode('utf-8'))
        out = set()
        for item in payload.get("urls", []):
            if item.get('url_status') == 'online':
                host = urlparse(item.get("url", "")).hostname
                if host:
                    out.add(host.lower())
        return out
    except Exception as e:
        print(f"❌ URLhaus 拉取失败: {e}")
        sys.exit(1)

def load_baseline():
    """从环境变量 BASELINE_META 读上一版的 meta（CI 从 R2 下载后传入）"""
    p = os.environ.get("BASELINE_META")
    if not p or not os.path.exists(p):
        return None
    try:
        with open(p) as f:
            return json.load(f)
    except Exception:
        return None

def is_shared_root(d: str) -> bool:
    # 只剔除根域本身；子域允许
    return d in SHARED_HOSTING_ROOTS

def main():
    print("📡 拉取 Phishing.Database...")
    phishing = fetch_phishing_db()
    if not phishing:
        print("❌ Phishing.Database 返回空集合，拒绝构建")
        sys.exit(1)
    print(f"   → {len(phishing)} 条")

    print("📡 拉取 URLhaus...")
    urlhaus = fetch_urlhaus()
    print(f"   → {len(urlhaus)} 条")

    all_malicious = phishing | urlhaus

    # 共享托管根域剔除
    before = len(all_malicious)
    all_malicious = {d for d in all_malicious if not is_shared_root(d)}
    if before != len(all_malicious):
        print(f"🔍 共享托管根域剔除 {before - len(all_malicious)} 条")

    # sanity 1：条数下限
    if len(all_malicious) < MIN_DOMAINS:
        print(f"❌ 过滤后条数异常偏少: {len(all_malicious)} < {MIN_DOMAINS}")
        sys.exit(1)

    # sanity 2：相比上一版下降超 30%
    baseline = load_baseline()
    if baseline and 'count' in baseline:
        prev = baseline['count']
        if len(all_malicious) < prev * (1 - MAX_DROP_RATIO):
            print(f"❌ 相比上一版下降超过 {int(MAX_DROP_RATIO*100)}%: {prev} → {len(all_malicious)}")
            sys.exit(1)

    # 排序去重哈希前缀
    hs = sorted({h40(d) for d in all_malicious})
    print(f"📦 构建 {len(hs)} 条前缀（{len(all_malicious)} 域名去重）")

    bin_file = "threat-filter.bin"
    with open(bin_file, "wb") as f:
        f.write(MAGIC)
        f.write(struct.pack('<BI', H, len(hs)))
        f.write(b''.join(hs))
    size = os.path.getsize(bin_file)
    print(f"✅ 写出 {bin_file} ({size/1024/1024:.2f} MB)")

    # 元信息 + 签名
    with open(bin_file, "rb") as f:
        sha256_hex = hashlib.sha256(f.read()).hexdigest()
    version = datetime.now(timezone.utc).strftime("intel-%Y%m%d%H%M%S")

    meta = {
        "version": version,
        "sha256": sha256_hex,
        "count": len(all_malicious),
        "unique_prefixes": len(hs),
        "format": "DEW1",
        "hash_bytes": H,
    }

    key_hex = os.environ.get('ED25519_PRIVATE_KEY')
    if not key_hex:
        print("❌ ED25519_PRIVATE_KEY 未设置，拒绝发布未签名过滤器")
        sys.exit(1)
    try:
        from nacl.signing import SigningKey
    except ImportError:
        print("❌ 缺少 pynacl，pip install pynacl")
        sys.exit(1)
    sk = SigningKey(bytes.fromhex(key_hex))
    msg = f"{version}:{sha256_hex}".encode()
    meta["signature"] = base64.b64encode(sk.sign(msg).signature).decode()

    with open("threat-filter.meta.json", "w") as f:
        json.dump(meta, f, indent=2)
    print(f"🎉 完成，版本 {version}")

if __name__ == '__main__':
    main()
