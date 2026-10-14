"""数据准备：构建三分类（Ad / Tracker / Normal）数据集。"""

import os
import requests
import pandas as pd
from tqdm import tqdm

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')

# 大幅扩展的 Tracker 关键词（覆盖主流追踪服务）
TRACKER_KEYWORDS = [
    # 通用
    'track', 'tracking', 'tracker',
    'analytics', 'stats', 'statistic',
    'pixel', 'beacon', 'telemetry', 'metric',
    'audit', 'audience', 'measure',
    # 具体服务
    'google-analytics', 'googletagmanager', 'gtag',
    'scorecardresearch', 'quantserve', 'comscore',
    'hotjar', 'mixpanel', 'segment.io', 'segment.com',
    'amplitude', 'fullstory', 'heap.io', 'heapanalytics',
    'mouseflow', 'crazyegg', 'clicktale', 'luckyorange',
    'kissmetrics', 'matomo', 'piwik', 'plausible',
    'newrelic', 'datadog', 'sentry', 'bugsnag',
    'branch.io', 'adjust.com', 'appsflyer', 'kochava',
    'firebase', 'firebaseio',
    'demdex', 'omtrdc', '2o7.net', 'everesttech',
    'adobedtm', 'moatads', 'chartbeat', 'parsely',
    'nr-data', 'nrdp', 'newrelic',
    'snowplowanalytics', 'bluekai', 'krxd', 'exelator',
    'adsymptotic', 'agkn', 'tapad', 'crwdcntrl',
    'addthis', 'sharethis', 'addtoany',
    'onesignal', 'pushengage', 'pushcrew',
    'cdn.onesignal', 'cdn.mxpnl',
]


def classify_label(domain: str) -> int:
    """把广告域名细分为 Ad(1) 或 Tracker(2)，正常为 0。"""
    d = domain.lower()
    # Tracker 优先匹配（比 Ad 更具体）
    for kw in TRACKER_KEYWORDS:
        if kw in d:
            return 2
    return 1


def download_ad_domains():
    ad_domains = set()
    sources = [
        "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts",
        "https://adaway.org/hosts.txt",
    ]
    for url in sources:
        try:
            print(f"下载: {url}")
            r = requests.get(url, timeout=60)
            r.raise_for_status()
            for line in tqdm(r.text.split("\n"), desc=url.split("/")[-1]):
                line = line.strip()
                if not line or line.startswith("#") or line.startswith("!"):
                    continue
                parts = line.split()
                domain = parts[1] if len(parts) >= 2 else parts[0]
                if domain and domain not in ("0.0.0.0", "127.0.0.1", "localhost"):
                    ad_domains.add(domain.lower())
        except Exception as e:
            print(f"下载失败 {url}: {e}")
    return ad_domains


def download_legit_domains(limit=100000):
    legit = set()
    try:
        print("下载 Majestic Million...")
        r = requests.get(
            "https://downloads.majestic.com/majestic_million.csv", timeout=120
        )
        r.raise_for_status()
        for i, line in enumerate(r.text.split("\n")):
            if i == 0 or i > limit:
                continue
            parts = line.split(",")
            if len(parts) > 2:
                legit.add(parts[2].lower())
    except Exception as e:
        print(f"下载失败: {e}")
    return legit


def build_dataset():
    os.makedirs(DATA_DIR, exist_ok=True)

    print("收集广告域名...")
    ad_domains = download_ad_domains()
    print(f"  → {len(ad_domains)} 个")

    print("收集合法域名...")
    legit = download_legit_domains(limit=len(ad_domains) * 2)
    print(f"  → {len(legit)} 个")

    n = min(len(ad_domains), len(legit))
    ad_list = list(ad_domains)[:n]
    legit_list = list(legit)[:n]

    rows = []
    tracker_count = 0
    for d in ad_list:
        label = classify_label(d)
        if label == 2:
            tracker_count += 1
        rows.append({"domain": d, "label": label})
    for d in legit_list:
        rows.append({"domain": d, "label": 0})

    print(f"\n  Tracker 识别数: {tracker_count}")

    df = pd.DataFrame(rows).drop_duplicates(subset="domain").sample(
        frac=1, random_state=42
    ).reset_index(drop=True)

    split = int(len(df) * 0.8)
    df[:split].to_csv(os.path.join(DATA_DIR, "train.csv"), index=False)
    df[split:].to_csv(os.path.join(DATA_DIR, "test.csv"), index=False)

    print(f"\n训练集: {len(df[:split])} 条")
    print(f"测试集: {len(df[split:])} 条")
    print(f"标签分布:\n{df['label'].value_counts().sort_index()}")


if __name__ == "__main__":
    build_dataset()
