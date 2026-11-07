import requests
import json

# 测试 1: 直接拉 URLhaus 的公开 Text 源（不需要 Token）
print("⏳ 测试 URLhaus 拉取...")
r = requests.get("https://urlhaus.abuse.ch/downloads/text/", timeout=20)
print(f"状态码: {r.status_code}, 返回长度: {len(r.text)}")
if r.status_code == 200:
    urls = [u for u in r.text.splitlines() if u.startswith('http') and not u.startswith('#')]
    print(f"✅ URLhaus 成功拉取 {len(urls)} 条 URL")

# 测试 2: 如果你非要用 R2 里的 threat-rules.json
# 你可以在本地装一下 boto3 测一下
# pip install boto3
