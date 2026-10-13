"""特征提取（与 Rust 端保持一致）。"""

import math

NUM_BUCKETS = 16384
STRUCTURED_FEATURES = 34
FEATURE_DIM = NUM_BUCKETS + STRUCTURED_FEATURES


def fnv1a(data: bytes) -> int:
    """FNV-1a 64-bit 哈希。"""
    hash_val = 0xCBF29CE484222325
    for byte in data:
        hash_val ^= byte
        hash_val = (hash_val * 0x100000001B3) & 0xFFFFFFFFFFFFFFFF
    return hash_val


def contains_any(s: str, keywords) -> bool:
    return any(kw in s for kw in keywords)


def is_ip_address(url: str) -> bool:
    parts = url.split("/")
    if len(parts) < 3:
        return False
    host = parts[2].split(":")[0]
    octets = host.split(".")
    if len(octets) != 4:
        return False
    return all(o.isdigit() and 0 <= int(o) <= 255 for o in octets)


def calculate_entropy(s: str) -> float:
    if not s:
        return 0.0
    freq = {}
    for c in s:
        freq[c] = freq.get(c, 0) + 1
    length = len(s)
    entropy = 0.0
    for f in freq.values():
        p = f / length
        entropy -= p * math.log2(p)
    return entropy


def extract_features(url: str):
    """从 URL 提取特征向量。"""
    features = [0.0] * FEATURE_DIM
    url_lower = url.lower()

    # 哈希字符 n-gram（n=3）
    chars = list(url_lower)
    for i in range(len(chars) - 2):
        ngram = "".join(chars[i:i + 3]).encode("utf-8")
        h = fnv1a(ngram) % NUM_BUCKETS
        features[h] += 1.0

    # 结构化特征
    o = NUM_BUCKETS
    features[o] = float(len(url))
    features[o + 1] = url.count(".")
    features[o + 2] = url.count("/")
    features[o + 3] = url.count("-")
    features[o + 4] = url.count("_")
    features[o + 5] = url.count("?")
    features[o + 6] = url.count("=")
    features[o + 7] = url.count("&")
    features[o + 8] = url.count("%")

    features[o + 9] = 1.0 if contains_any(url_lower, ["ad", "ads", "advert"]) else 0.0
    features[o + 10] = 1.0 if contains_any(url_lower, ["track", "tracking"]) else 0.0
    features[o + 11] = 1.0 if contains_any(url_lower, ["analytics", "stats"]) else 0.0
    features[o + 12] = 1.0 if contains_any(url_lower, ["banner", "banners"]) else 0.0
    features[o + 13] = 1.0 if contains_any(url_lower, ["popup", "popunder"]) else 0.0
    features[o + 14] = 1.0 if contains_any(url_lower, ["click", "clicks"]) else 0.0
    features[o + 15] = 1.0 if contains_any(url_lower, ["pixel", "beacon"]) else 0.0
    features[o + 16] = 1.0 if contains_any(url_lower, ["doubleclick", "googlesyndication"]) else 0.0
    features[o + 17] = 1.0 if contains_any(url_lower, ["facebook", "fbcdn"]) else 0.0
    features[o + 18] = 1.0 if contains_any(url_lower, ["google", "gstatic"]) else 0.0

    features[o + 19] = 1.0 if url_lower.endswith(".com") else 0.0
    features[o + 20] = 1.0 if url_lower.endswith(".net") else 0.0
    features[o + 21] = 1.0 if url_lower.endswith(".org") else 0.0
    features[o + 22] = 1.0 if url_lower.endswith(".io") else 0.0
    features[o + 23] = 1.0 if url_lower.endswith(".cn") else 0.0

    features[o + 24] = 1.0 if url_lower.startswith("https") else 0.0
    features[o + 25] = 1.0 if url_lower.startswith("http://") else 0.0

    digit_count = sum(c.isdigit() for c in url)
    features[o + 26] = digit_count / max(len(url), 1)

    uppercase_count = sum(c.isupper() for c in url)
    features[o + 27] = uppercase_count / max(len(url), 1)

    features[o + 28] = float(url.count("/"))
    features[o + 29] = float(url.count("&") + url.count("?"))

    parts = url.split("/")
    if len(parts) > 2:
        host = parts[2].split(":")[0]
        features[o + 30] = float(len(host))
        features[o + 31] = 1.0 if is_ip_address(url) else 0.0
        features[o + 32] = float(max(0, host.count(".") - 1))
    else:
        features[o + 30] = 0.0
        features[o + 31] = 0.0
        features[o + 32] = 0.0

    features[o + 33] = calculate_entropy(url_lower)

    return features
