"""数据准备：构建广告/非广告域名数据集。"""

import os
import requests
import pandas as pd
from tqdm import tqdm

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')


def download_ad_domains():
    """下载广告/追踪器域名列表。"""
    ad_domains = set()

    sources = [
        "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts",
        "https://adaway.org/hosts.txt",
        "https://raw.githubusercontent.com/AdguardTeam/cname-trackers/master/data/combined_disguised_trackers.txt",
    ]

    for url in sources:
        try:
            print(f"下载: {url}")
            response = requests.get(url, timeout=60)
            response.raise_for_status()
            for line in tqdm(response.text.split("\n"), desc=url.split("/")[-1]):
                line = line.strip()
                if not line or line.startswith("#") or line.startswith("!"):
                    continue
                # 解析 hosts 格式
                parts = line.split()
                if len(parts) >= 2:
                    domain = parts[1]
                else:
                    domain = parts[0]
                if domain and domain not in ("0.0.0.0", "127.0.0.1", "localhost"):
                    ad_domains.add(domain.lower())
        except Exception as e:
            print(f"下载失败 {url}: {e}")

    return ad_domains


def download_legit_domains(limit=100000):
    """下载合法域名列表（Majestic Million）。"""
    legit_domains = set()
    try:
        print("下载 Majestic Million...")
        response = requests.get(
            "https://downloads.majestic.com/majestic_million.csv",
            timeout=120,
        )
        response.raise_for_status()
        for i, line in enumerate(response.text.split("\n")):
            if i == 0 or i > limit:
                continue
            parts = line.split(",")
            if len(parts) > 2:
                legit_domains.add(parts[2].lower())
    except Exception as e:
        print(f"下载失败: {e}")
    return legit_domains


def build_dataset():
    """构建训练和测试数据集。"""
    os.makedirs(DATA_DIR, exist_ok=True)

    print("收集广告域名...")
    ad_domains = download_ad_domains()
    print(f"  → {len(ad_domains)} 个广告/追踪器域名")

    print("收集合法域名...")
    legit_domains = download_legit_domains(limit=len(ad_domains) * 2)
    print(f"  → {len(legit_domains)} 个合法域名")

    # 确保正负样本平衡
    min_size = min(len(ad_domains), len(legit_domains))
    ad_list = list(ad_domains)[:min_size]
    legit_list = list(legit_domains)[:min_size]

    df = pd.DataFrame({
        "domain": ad_list + legit_list,
        "label": [1] * len(ad_list) + [0] * len(legit_list),
    })

    # 去重、打乱
    df = df.drop_duplicates(subset="domain").sample(frac=1, random_state=42).reset_index(drop=True)

    # 分割
    split = int(len(df) * 0.8)
    train_df = df[:split]
    test_df = df[split:]

    train_df.to_csv(os.path.join(DATA_DIR, "train.csv"), index=False)
    test_df.to_csv(os.path.join(DATA_DIR, "test.csv"), index=False)

    print(f"\n训练集: {len(train_df)} 条")
    print(f"测试集: {len(test_df)} 条")
    return df


if __name__ == "__main__":
    build_dataset()
