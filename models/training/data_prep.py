"""数据准备：构建三分类（Ad / Tracker / Normal）数据集 + 融合用户真实反馈。"""

import os
import requests
import pandas as pd
from tqdm import tqdm
import json
import time

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')
CACHE_DIR = os.path.join(DATA_DIR, 'cache')
os.makedirs(CACHE_DIR, exist_ok=True)

def fetch_with_cache(url, filename, expire_hours=24):
    """带 24 小时过期时间的文件缓存获取器"""
    filepath = os.path.join(CACHE_DIR, filename)
    # 检查缓存是否存在且未过期
    if os.path.exists(filepath):
        mtime = os.path.getmtime(filepath)
        if time.time() - mtime < expire_hours * 3600:
            print(f"  [缓存命中] 读取 {filename}")
            with open(filepath, 'r', encoding='utf-8') as f:
                return f.read()
    
    # 缓存未命中或已过期，发起网络请求
    print(f"  [网络下载] 拉取 {url}")
    r = requests.get(url, timeout=120)
    r.raise_for_status()
    text = r.text
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(text)
    return text

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
    """【保留·向后兼容】旧版纯关键词分类。新代码请用 classify_label_with_source。"""
    d = domain.lower()
    for kw in TRACKER_KEYWORDS:
        if kw in d:
            return 2
    return 1


# 🔧 P1-A: 混合标签来源（Disconnect 主判据 + 关键词兜底，兜底占比 ≤20% 为硬约束）
DISCONNECT_URL = "https://raw.githubusercontent.com/disconnectme/disconnect-tracking-protection/master/services.json"
DISCONNECT_TRACKER_CATS = {"Analytics", "Social", "FingerprintingInvasive", "Content"}
DISCONNECT_AD_CATS = {"Advertising", "Cryptomining"}


def _walk_disconnect_domains(val, cat_name, out, depth=0):
    """递归遍历 Disconnect services.json（结构可能是 dict/list/str 任意嵌套），提取域名。"""
    if depth > 6:
        return
    if isinstance(val, str):
        v = val.strip().lower()
        if not v:
            return
        if v.startswith(("http://", "https://")) or "/" in v:
            return  # 跳过 URL 和路径
        if "." in v and len(v) < 100 and not v.endswith("."):
            out[v] = cat_name
    elif isinstance(val, list):
        for item in val:
            _walk_disconnect_domains(item, cat_name, out, depth + 1)
    elif isinstance(val, dict):
        for k, v in val.items():
            _walk_disconnect_domains(k, cat_name, out, depth + 1)
            _walk_disconnect_domains(v, cat_name, out, depth + 1)


def download_disconnect_services():
    """下载 Disconnect.me 追踪服务列表，返回 {domain: category}。失败返回空 dict（回退纯关键词）。"""
    result = {}
    try:
        print("加载 Disconnect.me 追踪服务列表...")
        text = fetch_with_cache(DISCONNECT_URL, "disconnect.json", expire_hours=72)
        data = json.loads(text)
        categories = data.get("categories", {})
        for cat_name, val in categories.items():
            before = len(result)
            _walk_disconnect_domains(val, cat_name, result)
            print(f"    [{cat_name}] +{len(result) - before} 个域名")
        print(f"  → Disconnect 域名: {len(result)} 个")
    except Exception as e:
        print(f"⚠️ Disconnect 下载失败，回退到纯关键词: {e}")
    return result


def download_easyprivacy():
    """下载 EasyPrivacy 追踪域名列表（ABP 格式 ||domain^），返回 set。失败返回空 set。"""
    EASYPRIVACY_URL = "https://easylist.to/easylist/easyprivacy.txt"
    result = set()
    try:
        print("加载 EasyPrivacy 追踪列表...")
        text = fetch_with_cache(EASYPRIVACY_URL, "easyprivacy.txt", expire_hours=24)
        for line in text.split("\n"):
            line = line.strip()
            if not line or line.startswith("!") or line.startswith("["):
                continue
            if line.startswith("||"):
                body = line[2:]
                for sep in ("^", "$"):
                    idx = body.find(sep)
                    if idx != -1:
                        body = body[:idx]
                body = body.strip().rstrip(".")
                if body and "." in body and "/" not in body and len(body) < 100:
                    result.add(body.lower())
        print(f"  → EasyPrivacy 域名: {len(result)} 个")
    except Exception as e:
        print(f"⚠️ EasyPrivacy 下载失败，回退到 Disconnect+关键词: {e}")
    return result


def _match_domain_set(d, domain_set):
    """检查 d 或其任意父域是否在 domain_set 中。"""
    if d in domain_set:
        return True
    parts = d.split('.')
    for i in range(1, len(parts) - 1):
        parent = '.'.join(parts[i:])
        if parent in domain_set:
            return True
    return False


def classify_label_with_source(domain, disconnect_map, easyprivacy_set):
    """返回 (label, source)。source: disconnect / keyword / ad_default"""
    d = domain.lower()
    # 主判据 1: Disconnect 精确匹配
    if d in disconnect_map:
        cat = disconnect_map[d]
        if cat in DISCONNECT_TRACKER_CATS:
            return 2, 'disconnect'
        if cat in DISCONNECT_AD_CATS:
            return 1, 'disconnect'
    # 主判据 2: Disconnect 根域名匹配（处理子域名）
    parts = d.split('.')
    if len(parts) > 2:
        root = '.'.join(parts[-2:])
        if root in disconnect_map:
            cat = disconnect_map[root]
            if cat in DISCONNECT_TRACKER_CATS:
                return 2, 'disconnect'
            if cat in DISCONNECT_AD_CATS:
                return 1, 'disconnect'
    # 主判据 3: EasyPrivacy（追踪专用，命中即 Tracker）
    if _match_domain_set(d, easyprivacy_set):
        return 2, 'easyprivacy'
    # 兜底: 关键词（统计占比，>20% 警告）
    for kw in TRACKER_KEYWORDS:
        if kw in d:
            return 2, 'keyword'
    return 1, 'ad_default'


def download_ad_domains():
    ad_domains = set()
    sources = [
        "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts",
        "https://adaway.org/hosts.txt",
    ]
    for url in sources:
        try:
            filename = url.split("/")[-1] or "adlist.txt"
            text = fetch_with_cache(url, filename, expire_hours=24)
            for line in tqdm(text.split("\n"), desc=filename):
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
        print("加载 Majestic Million...")
        text = fetch_with_cache(
            "https://downloads.majestic.com/majestic_million.csv", 
            "majestic_million.csv", 
            expire_hours=72
        )
        for i, line in enumerate(text.split("\n")):
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
        print("✅ 状态标记完成，下次不会重复训练这批数据！")
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

    # 🔧 P2-D: 从正常类剔除已知大追踪方（Majestic Million 含 google/facebook 等）
    KNOWN_TRACKERS = {
        'google.com', 'googleapis.com', 'gstatic.com', 'googletagmanager.com',
        'google-analytics.com', 'doubleclick.net', 'googlesyndication.com',
        'googleadservices.com', 'facebook.com', 'fbcdn.net',
        'amazon-adsystem.com', 'adsrvr.org', 'adnxs.com', 'rubiconproject.com',
        'criteo.com', 'criteo.net', 'taboola.com', 'outbrain.com',
        'twitter.com', 'x.com', 'linkedin.com', 'tiktok.com',
        'yandex.ru', 'mc.yandex.ru', 'hotjar.com', 'mixpanel.com',
    }
    legit -= KNOWN_TRACKERS
    print(f"  → 剔除已知追踪方后: {len(legit)} 个")
    
    # 🛡️ S-09 修复：读取外部金标配置，防止哈希碰撞导致大厂被误杀
    hard_rules_path = os.path.join(os.path.dirname(__file__), 'hard_rules.json')
    if os.path.exists(hard_rules_path):
        with open(hard_rules_path, 'r', encoding='utf-8') as f:
            hard_rules = json.load(f)
            HARD_SAFE = set(hard_rules.get("hard_safe", []))
            HARD_BLOCK = set(hard_rules.get("hard_block", []))
            
        legit.update(HARD_SAFE)
        ad_domains.update(HARD_BLOCK)
        legit -= HARD_BLOCK
        ad_domains -= HARD_SAFE
        print(f"  → 已应用外部金标规则 (White: {len(HARD_SAFE)}, Black: {len(HARD_BLOCK)})")

    # 🌟 融合用户真实反馈
    missed_feedbacks, false_feedbacks = fetch_supabase_feedbacks()
    
    # 🚀 闭环：将误拦反馈写入 hard_rules.json，准备自动提 PR
    if false_feedbacks or missed_feedbacks:
        hard_rules_path = os.path.join(os.path.dirname(__file__), 'hard_rules.json')
        if os.path.exists(hard_rules_path):
            with open(hard_rules_path, 'r', encoding='utf-8') as f:
                rules = json.load(f)
            
            # 将新的误拦加入 safe，漏拦加入 block
            new_safe = set(rules.get("hard_safe", []))
            new_block = set(rules.get("hard_block", []))
            
            for fb in false_feedbacks:
                if fb not in new_safe:
                    new_safe.add(fb)
                    print(f"  [规则闭环] 自动加入白名单草稿: {fb}")
                    
            for mb in missed_feedbacks:
                if mb not in new_block:
                    new_block.add(mb)
                    print(f"  [规则闭环] 自动加入黑名单草稿: {mb}")
            
            # 重新写回
            rules["hard_safe"] = list(new_safe)
            rules["hard_block"] = list(new_block)
            with open(hard_rules_path, 'w', encoding='utf-8') as f:
                json.dump(rules, f, indent=2, ensure_ascii=False)
            print("  -> hard_rules.json 已更新，等待 Actions 提 PR")
    
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

    # 🔧 P2-E: 消除标签冲突（同一域名同时出现在 ad 和 legit，保留 ad 标签）
    overlap = ad_domains & legit
    if overlap:
        print(f"  → 消除 {len(overlap)} 个重叠域名（保留 ad 标签）")
        legit -= overlap

    n = min(len(ad_domains), len(legit))
    ad_list = list(ad_domains)[:n]
    legit_list = list(legit)[:n]

    # 🛡️ S-09 终极修复：强制把金标域名追加进 rows，防止被列表截断砍掉
    hard_rows = []
    for d in HARD_SAFE:
        hard_rows.append({"domain": d, "label": 0})
    for d in HARD_BLOCK:
        hard_rows.append({"domain": d, "label": 2}) # 🛡️ 强制黑名单为 Tracker(2)

    # 🔧 P1-A: 混合标签来源（Disconnect 主判据 + 关键词兜底）
    disconnect_map = download_disconnect_services()
    easyprivacy_set = download_easyprivacy()

    rows = []
    tracker_count = 0
    source_stats = {'disconnect': 0, 'easyprivacy': 0, 'keyword': 0, 'ad_default': 0}
    tracker_sources = {'disconnect': 0, 'easyprivacy': 0, 'keyword': 0}

    for d in ad_list:
        label, source = classify_label_with_source(d, disconnect_map, easyprivacy_set)
        source_stats[source] += 1
        if label == 2:
            tracker_count += 1
            tracker_sources[source] += 1
        rows.append({"domain": d, "label": label})

    for d in legit_list:
        rows.append({"domain": d, "label": 0})

    # 把刚才单独捏好的金标数据塞进去
    rows.extend(hard_rows)

    print(f"\n  Tracker 识别数: {tracker_count}")
    print(f"  全量标签来源: {source_stats}")
    print(f"  Tracker 来源分布: {tracker_sources}")
    kw_ratio = (tracker_sources['keyword'] / tracker_count) if tracker_count > 0 else 0.0
    print(f"  Tracker 关键词兜底占比: {kw_ratio:.1%}（目标 ≤ 20%）")
    if kw_ratio > 0.2:
        print(f"  ⚠️ 警告：Tracker 关键词兜底占比仍 > 20%，建议补充数据源（如 pgl.yoyo.org）")

    # 🔒 核心修复：先转 DataFrame 并去重
    df = pd.DataFrame(rows).drop_duplicates(subset="domain").reset_index(drop=True)

    # 🛡️ S-09 终极防线：金标数据拥有绝对覆盖权！
    # 无论前面怎么冲突去重，这里强制把金标标签刷写成正确值
    df.loc[df["domain"].isin(HARD_SAFE), "label"] = 0
    df.loc[df["domain"].isin(HARD_BLOCK), "label"] = 2
    print(f"  → 已强制执行金标覆写 (绝对保护)")
    
    # 找出所有的 Tracker 样本
    trackers_df = df[df['label'] == 2]
    if not trackers_df.empty:
        print(f"⚖️ 对 {len(trackers_df)} 个 Tracker 样本进行 5 倍过采样...")
        # 直接复制 4 份并拼接到原数据上
        for _ in range(4):
            df = pd.concat([df, trackers_df], ignore_index=True)
    
    # 打乱顺序
    df = df.sample(frac=1, random_state=42).reset_index(drop=True)

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
