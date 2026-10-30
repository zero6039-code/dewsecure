"""数据准备：构建三分类（Ad / Tracker / Normal）数据集 + 融合用户真实反馈。"""

import os
import requests
import pandas as pd
from tqdm import tqdm
import json

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



def mark_feedbacks_as_processed():
    """训练数据提取完毕后，将 pending 状态标记为 processed"""
    supabase_url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    
    if not supabase_url or not service_key:
        print("⚠️ 未配置 SUPABASE_SERVICE_ROLE_KEY，跳过状态更新。")
        return

    print("🧹 正在将已处理的反馈标记为 processed...")
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
    }
    
    try:
        # 批量更新所有 pending 的数据为 processed
        res = requests.patch(
            f"{supabase_url}/rest/v1/reports?status=eq.pending",
            headers=headers,
            json={"status": "processed"},
            timeout=30
        )
        res.raise_for_status()
        print("✅ 状态标记完成，下周不会重复训练这批数据！")
    except Exception as e:
        print(f"❌ 标记状态失败: {e}")

def fetch_supabase_feedbacks():
    """从 Supabase 获取有效反馈数据"""
    supabase_url = os.environ.get("SUPABASE_URL")
    # 🔒 修复 401：必须使用 Service Role Key 才能突破视图的 RLS 限制
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") 
    
    if not supabase_url or not supabase_key:
        print("⚠️ 未配置 SUPABASE_SERVICE_ROLE_KEY，跳过用户反馈拉取。")
        return [], []

    print("📡 正在从 Supabase 拉取有效反馈...")
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}"
    }
    
    try:
        # 请求我们之前在 SQL 里建的视图
        res = requests.get(f"{supabase_url}/rest/v1/valid_ai_feedbacks", headers=headers, timeout=30)
        res.raise_for_status()
        data = res.json()
        
        missed_domains = []    # 漏拦 (需要加入黑名单)
        false_domains = []     # 误拦 (需要加入白名单)
        
        for row in data:
            domain = row.get("domain", "").strip().lower()
            report_type = row.get("report_type")
            if not domain: continue
            
            if report_type == "false_negative":
                missed_domains.append(domain)
            elif report_type == "false_positive":
                false_domains.append(domain)
                
        print(f"  → 收到漏拦反馈: {len(missed_domains)} 个域名")
        print(f"  → 收到误拦反馈: {len(false_domains)} 个域名")
        return missed_domains, false_domains
        
    except Exception as e:
        print(f"❌ 拉取 Supabase 反馈失败: {e}")
        return [], []


def build_dataset():
    os.makedirs(DATA_DIR, exist_ok=True)

    print("收集广告域名...")
    ad_domains = download_ad_domains()
    print(f"  → 基础恶意域名: {len(ad_domains)} 个")

    print("收集合法域名...")
    legit = download_legit_domains(limit=len(ad_domains) * 2)
    print(f"  → 基础合法域名: {len(legit)} 个")
    
    # 🌟 融合用户真实反馈
    missed_feedbacks, false_feedbacks = fetch_supabase_feedbacks()
    
    # 🔒 安全网 3：误拦的绝对保护，黑名单里绝对不能有
    for d in false_feedbacks:
        if d in ad_domains:
            ad_domains.remove(d)
        legit.add(d)
        
    # 🔒 安全网 4：漏拦逻辑
    for d in missed_feedbacks:
        # 如果这个域名同时出现在误拦里，说明有严重争议，直接放弃训练（宁可不拦，不可错杀）
        if d in false_feedbacks:
            print(f"⚠️ 争议域名，跳过训练: {d}")
            continue
            
        if d in legit:
            legit.remove(d)
        ad_domains.add(d)

    n = min(len(ad_domains), len(legit))
    ad_list = list(ad_domains)[:n]
    legit_list = list(legit)[:n]

    rows = []
    tracker_count = 0
    trackers_to_oversample = []
    
    for d in ad_list:
        label = classify_label(d)
        if label == 2:
            tracker_count += 1
            trackers_to_oversample.append({"domain": d, "label": label})
        rows.append({"domain": d, "label": label})
        
    for d in legit_list:
        rows.append({"domain": d, "label": 0})
        
    # 🔒 核心修复：数据过采样，把偏少的 Tracker 数据复制 5 倍，强行拉高占比
    if trackers_to_oversample:
        print(f"⚖️ 对 {len(trackers_to_oversample)} 个 Tracker 样本进行 5 倍过采样，提升模型召回率...")
        for _ in range(4): # 已经有一份了，再加 4 份
            rows.extend(trackers_to_oversample)

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

    # 🌟 提取并写入 CSV 成功后，标记数据库状态，防止重复训练
    mark_feedbacks_as_processed()


if __name__ == "__main__":
    build_dataset()
