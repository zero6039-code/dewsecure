import json
import re
import math
import numpy as np
from urllib.parse import urlparse
from tldextract import extract

# 提取自 train_phishscout_fixed.py 的常量和函数
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
    feats[idx] = 0; idx += 1
    feats[idx] = 0; idx += 1
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

    lower = raw_url.lower()
    for n in range(3, 6):
        for i in range(len(lower) - n + 1):
            gram = lower[i:i+n]
            h = fnv1a32(gram) % 512
            feats[67 + h] = 1
    feats[578] = 1 if domain in SHORTENERS else 0
    return feats

# 执行生成
urls = [l.strip() for l in open('golden_urls.txt') if l.strip()]
golden = []
for u in urls:
    feats = extract_features(u)
    golden.append({'url': u, 'feats': [float(x) for x in feats]})

out_path = 'golden_features.json'
with open(out_path, 'w') as f:
    json.dump(golden, f, indent=2)
print(f'✅ 成功生成 {out_path}，共 {len(golden)} 条基准数据')
