import os
import re
import math
import json
import requests
import pandas as pd
import numpy as np
import lightgbm as lgb
from urllib.parse import urlparse
from sklearn.model_selection import train_test_split
from tldextract import extract

# ====== 复制你原来的特征提取配置 ======
SHORTENERS = set(['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'adf.ly', 'bit.do', 'mcaf.ee', 'su.pr', 'ity.im', 'q.gs', 'po.st', 'bc.vc', 'u.to', 'j.mp', 'buzurl.com', 'cutt.us', 'u.bb', 'yourls.org', 'x.co', 'prettylinkpro.com', 'scrnch.me', 'filourl.com', 'vzturl.com', 'qr.net', '1url.com', 'tweez.me', 'v.gd', 'tr.im'])
SUSPICIOUS_TLDS = set(['tk', 'ml', 'ga', 'cf', 'gq', 'xyz', 'top', 'work', 'click', 'link', 'country', 'stream', 'download', 'win', 'bid', 'loan', 'review', 'faith', 'party', 'science', 'gdn', 'racing', 'accountant', 'date', 'men', 'cricket'])
FREE_HOSTS = set(['000webhostapp.com', 'weebly.com', 'wixsite.com', 'blogspot.com', 'wordpress.com', 'github.io', 'netlify.app', 'vercel.app', 'herokuapp.com', 'firebaseapp.com', 'web.app', 'glitch.me', 'repl.co', 'ngrok.io', 'serveo.net', 'localtunnel.me', 'pagekite.me', 'tunnelto.dev'])
SUSPICIOUS_KEYWORDS = ['login', 'signin', 'verify', 'secure', 'account', 'update', 'banking', 'confirm', 'password', 'credential', 'wallet', 'billing', 'invoice', 'support', 'unlock', 'recover', 'alert', 'suspended', 'limited', 'webscr', 'cmd', 'paypal', 'apple', 'microsoft', 'google', 'amazon', 'netflix', 'facebook', 'instagram', 'whatsapp', 'maybank', 'cimb', 'grab', 'touchngo', 'boost', 'shopeepay']
OPEN_REDIRECT_PARAMS = ['url=', 'redirect=', 'next=', 'return=', 'goto=', 'dest=', 'r=', 'u=', 'link=', 'target=', 'redir=', 'redirect_uri=', 'callback=', 'continue=', 'window=', 'to=', 'out=', 'view=']

def fnv1a32(s):
    h = 0x811c9dc5
    for c in s:
        h ^= ord(c)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h

def shannon_entropy(s):
    if not s: return 0
    freq = {}
    for c in s: freq[c] = freq.get(c, 0) + 1
    ent = 0
    for count in freq.values():
        p = count / len(s)
        ent -= p * math.log2(p)
    return ent

def levenshtein(s1, s2):
    if len(s1) < len(s2): return levenshtein(s2, s1)
    if len(s2) == 0: return len(s1)
    previous_row = range(len(s2) + 1)
    for i, c1 in enumerate(s1):
        current_row = [i + 1]
        for j, c2 in enumerate(s2):
            insertions = previous_row[j + 1] + 1
            deletions = current_row[j] + 1
            substitutions = previous_row[j] + (c1 != c2)
            current_row.append(min(insertions, deletions, substitutions))
        previous_row = current_row
    return previous_row[-1]

def extract_features(raw_url):
    feats = np.zeros(579, dtype=np.float32)
    idx = 0
    try:
        u = urlparse(raw_url)
        host = u.hostname or ''
        path = u.path or ''
        query = u.query or ''
        proto = u.scheme or ''
        port = str(u.port) if u.port else ''
        full_url = raw_url.lower()
        ext = extract(host)
        domain = ext.registered_domain
        subdomain = ext.subdomain
        tld = ext.suffix
    except:
        return feats
    # 1-66 结构化特征 (与原版一致)
    feats[idx] = len(raw_url); idx += 1
    feats[idx] = raw_url.count('-'); idx += 1
    feats[idx] = sum(c.isdigit() for c in raw_url); idx += 1
    feats[idx] = len(subdomain.split('.')) if subdomain else 0; idx += 1
    feats[idx] = 1 if proto else 0; idx += 1
    feats[idx] = len(re.findall(r'[^a-zA-Z0-9]', raw_url)); idx += 1
    feats[idx] = shannon_entropy(raw_url); idx += 1
    feats[idx] = len([p for p in path.split('/') if p]); idx += 1
    feats[idx] = len(host); idx += 1
    feats[idx] = 1 if re.match(r'^\d{1,3}(\.\d{1,3}){3}$', host) else 0; idx += 1
    feats[idx] = 1 if '@' in raw_url else 0; idx += 1
    feats[idx] = 1 if '//' in raw_url[8:] else 0; idx += 1
    feats[idx] = len(tld); idx += 1
    feats[idx] = 1 if tld in ['com', 'org', 'net', 'gov', 'edu'] else 0; idx += 1
    feats[idx] = query.count('='); idx += 1
    feats[idx] = len(path); idx += 1
    feats[idx] = sum(1 for k in SUSPICIOUS_KEYWORDS if k in full_url); idx += 1
    feats[idx] = 1 if any(k in host for k in SUSPICIOUS_KEYWORDS) else 0; idx += 1
    feats[idx] = 1 if any(k in path for k in SUSPICIOUS_KEYWORDS) else 0; idx += 1
    feats[idx] = sum(1 for k in SUSPICIOUS_KEYWORDS if k in full_url); idx += 1
    feats[idx] = 1 if 'xn--' in host else 0; idx += 1
    feats[idx] = 1 if (port and port not in ['80', '443']) else 0; idx += 1
    feats[idx] = len(re.findall(r'%[0-9A-Fa-f]{2}', raw_url)); idx += 1
    feats[idx] = 1 if re.match(r'^0x[0-9a-f]+$', host, re.I) else 0; idx += 1
    feats[idx] = sum(c.isupper() for c in raw_url) / max(len(raw_url), 1); idx += 1
    feats[idx] = host.count('www'); idx += 1
    digits = re.findall(r'\d+', raw_url)
    feats[idx] = max(len(d) for d in digits) if digits else 0; idx += 1
    labels = host.split('.')
    feats[idx] = max(len(l) for l in labels) if labels else 0; idx += 1
    feats[idx] = len(labels); idx += 1
    feats[idx] = 1 if domain in path else 0; idx += 1
    feats[idx] = len(query); idx += 1
    feats[idx] = query.count('='); idx += 1
    feats[idx] = 1 if re.search(r'\.(php|asp|aspx|jsp|cgi|exe|scr|bat|cmd|msi|vbs|js)$', path, re.I) else 0; idx += 1
    feats[idx] = 1 if len(set(re.findall(r'\.[a-z]{2,}', host))) > 1 else 0; idx += 1
    feats[idx] = len(re.findall(r'([^a-zA-Z0-9])\1', raw_url)); idx += 1
    feats[idx] = 0; idx += 1 # homoglyph_count
    feats[idx] = 0; idx += 1 # has_homoglyph
    feats[idx] = sum(ord(c) > 127 for c in host); idx += 1
    feats[idx] = 1 if re.search(r'[\u0400-\u04FF]', host) else 0; idx += 1
    min_dist = 999
    for b in SUSPICIOUS_KEYWORDS:
        if b in host: min_dist = 0; break
        min_dist = min(min_dist, levenshtein(host, b))
    feats[idx] = min_dist; idx += 1
    feats[idx] = 1 if any(k in subdomain for k in SUSPICIOUS_KEYWORDS) else 0; idx += 1
    feats[idx] = 1 if domain in [k + '.' + tld for k in SUSPICIOUS_KEYWORDS] else 0; idx += 1
    feats[idx] = 1 if (any(k in subdomain for k in SUSPICIOUS_KEYWORDS) and not any(k in domain for k in SUSPICIOUS_KEYWORDS)) else 0; idx += 1
    feats[idx] = 1 if tld in SUSPICIOUS_TLDS else 0; idx += 1
    feats[idx] = 1 if tld in ['com', 'c0m', 'cm', 'co', 'om'] else 0; idx += 1
    feats[idx] = 1 if len(tld) == 2 else 0; idx += 1
    feats[idx] = host.count('.'); idx += 1
    feats[idx] = 1 if len(labels) > 3 else 0; idx += 1
    feats[idx] = len(domain); idx += 1
    first_sub = subdomain.split('.')[0] if subdomain else ''
    feats[idx] = len(first_sub); idx += 1
    feats[idx] = shannon_entropy(first_sub); idx += 1
    vowels = re.findall(r'[aeiou]', first_sub, re.I)
    feats[idx] = len(vowels) / max(len(first_sub), 1); idx += 1
    feats[idx] = 1 if (len(first_sub) > 12 and shannon_entropy(first_sub) > 3.5) else 0; idx += 1
    feats[idx] = sum(c.isdigit() for c in domain) / max(len(domain), 1); idx += 1
    feats[idx] = 1 if re.match(r'^0[0-7]+$', host) else 0; idx += 1
    feats[idx] = 1 if host.isdigit() else 0; idx += 1
    feats[idx] = 1 if re.match(r'^\d+$', host.replace('.', '')) else 0; idx += 1
    feats[idx] = 1 if proto not in ['http', 'https'] else 0; idx += 1
    feats[idx] = 1 if '@' in raw_url else 0; idx += 1
    feats[idx] = 1 if any(p in full_url for p in OPEN_REDIRECT_PARAMS) else 0; idx += 1
    feats[idx] = 1 if re.search(r'(https?%3A%2F%2F)', path, re.I) else 0; idx += 1
    feats[idx] = 1 if domain in FREE_HOSTS else 0; idx += 1
    feats[idx] = 1 if (domain in FREE_HOSTS and any(k in host for k in SUSPICIOUS_KEYWORDS)) else 0; idx += 1
    feats[idx] = len(re.findall(r'(.)\1', raw_url)); idx += 1
    feats[idx] = 1 if re.search(r'[\U0001F300-\U0001FAFF]', raw_url) else 0; idx += 1
    feats[idx] = 1 if any(k in query for k in SUSPICIOUS_KEYWORDS) else 0; idx += 1
    feats[idx] = 1 if domain in SHORTENERS else 0; idx += 1

    # 512 N-gram
    lower = raw_url.lower()
    for n in range(3, 6):
        for i in range(len(lower) - n + 1):
            gram = lower[i:i+n]
            h = fnv1a32(gram) % 512
            feats[67 + h] = 1
    feats[578] = 1 if domain in SHORTENERS else 0
    return feats

def download_data():
    print("正在下载 OpenPhish 钓鱼样本...")
    r = requests.get("https://openphish.com/feed.txt")
    pos_urls = [u.strip() for u in r.text.splitlines() if u.strip()][:10000]
    
    print("正在下载 Tranco 正常样本...")
    r = requests.get("https://tranco-list.eu/top-1m.csv.zip")
    with open("/tmp/tranco.zip", "wb") as f: f.write(r.content)
    import zipfile
    with zipfile.ZipFile("/tmp/tranco.zip", 'r') as z:
        with z.open(z.namelist()[0]) as f:
            lines = f.read().decode().splitlines()
    
    neg_urls = []
    # 增加更多变体，特别是常见的 http 和短域名
    for l in lines[:30000]: 
        domain = l.split(',')[1]
        neg_urls.append(f"https://{domain}")
        neg_urls.append(f"https://www.{domain}")
        neg_urls.append(f"http://{domain}")  # 加入 http
        
    # 补充一些类似 neverssl 的简单短域名
    neg_urls.extend(["http://neverssl.com/", "http://example.com/", "http://test.com/"])
    return pos_urls, neg_urls

def main():
    pos_urls, neg_urls = download_data()
    urls = pos_urls + neg_urls
    labels = [1] * len(pos_urls) + [0] * len(neg_urls)

    print(f"开始提取特征 ({len(urls)} 条)...")
    X = np.array([extract_features(u) for u in urls])
    y = np.array(labels)

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    train_data = lgb.Dataset(X_train, label=y_train)
    valid_data = lgb.Dataset(X_test, label=y_test, reference=train_data)

    print("正在训练（极度抑制过拟合）...")
    params = {
        'objective': 'binary',
        'metric': 'binary_logloss',
        'num_leaves': 7,            # 极浅的树，强制模型学习通用规则
        'max_depth': 3,             # 深度限制在 3
        'min_data_in_leaf': 100,    # 每个叶子至少 100 个样本
        'learning_rate': 0.03,      # 降学习率
        'lambda_l1': 1.0,
        'lambda_l2': 1.0,
        'verbose': -1
    }
    model = lgb.train(params, train_data, num_boost_round=150, valid_sets=[valid_data], callbacks=[lgb.early_stopping(10)])

    print("正在导出模型并计算 Platt 校准...")
    # 计算校准参数
    from sklearn.linear_model import LogisticRegression
    raw_scores = model.predict(X_test, raw_score=True).reshape(-1, 1)
    lr = LogisticRegression()
    lr.fit(raw_scores, y_test)
    a, b = float(lr.coef_[0][0]), float(lr.intercept_[0])
    
    dump = model.dump_model()
    feat, thr, left, right, def_left, val, roots = [], [], [], [], [], [], []
    for tree in dump['tree_info']:
        roots.append(len(feat))
        def walk(n):
            i = len(feat)
            feat.append(-1); thr.append(0.0); left.append(-1); right.append(-1); def_left.append(1); val.append(0.0)
            if 'leaf_value' in n: val[i] = float(n['leaf_value']); return i
            feat[i] = int(n['split_feature']); thr[i] = float(n['threshold'])
            def_left[i] = 1 if n.get('default_left', True) else 0
            left[i] = walk(n['left_child']); right[i] = walk(n['right_child'])
            return i
        walk(tree['tree_structure'])
        
    out_json = {
        'nFeatures': 579, 'roots': roots, 'feat': feat, 'thr': thr,
        'left': left, 'right': right, 'defLeft': def_left, 'val': val,
        'platt': {'a': a, 'b': b}
    }
    
    out_path = os.path.join(os.path.dirname(__file__), "..", "..", "extensions", "chrome", "src", "phishscout_local.json")
    with open(out_path, 'w') as f:
        json.dump(out_json, f)
    print(f"✅ 最终模型导出成功 (a={a:.2f}, b={b:.2f}): {out_path}")

if __name__ == '__main__':
    main()
