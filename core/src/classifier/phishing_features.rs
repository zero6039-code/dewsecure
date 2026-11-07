//! T2 钓鱼分类器特征提取（579 维）
//!
//! 严格对齐 `models/training/train_phishscout_fixed.py` 的 `extract_features`。
//!
//! 输入契约：**完整 URL**（必须带 `https://` 或 `http://`）。
//!   Android DNS 层拿到的域名必须拼上 `https://` 再传入。
//!
//! 与 T1 (`features_adblock.rs`) 完全独立：
//!   - hash：标准 FNV-1a 32（`0x811c9dc5` + `0x01000193`），非 T1 变体
//!   - n-gram：3、4、5 gram，二值（固定 1），非累加
//!   - 结构：67 维（非 34）
//!   - **索引 578 被短链标记覆盖**（Python 实车行为，必须复刻）
//!   - `is_ip` 只检查 host，不看完整 URL
//!
//! ⚠️ 已知与 `phishScoutFeatures.js` 的差异（6 处），以 **Python 为准**：
//!   1. 索引 578 = 短链标记（JS 是 n-gram）
//!   2. 索引 12/13/43/44/45/48/53/61/62/66 用 tldextract 语义（PSL），非简单 split
//!   3. 索引 30 = query 长度（JS 是 host 长度）
//!   4. 索引 31 = query 等号数（JS 是 IP 判定）
//!   5. 索引 32 = 危险扩展（JS 是子域深度）
//!   6. 索引 33 定义不同（多种后缀 vs 深子域）
//! 详见 `docs/tech-debt-t2-feature-drift.md`（待建）。

use crate::classifier::psl::PslSet;
use std::collections::HashSet;

pub const TOTAL_DIM: usize = 579;
const NGRAM_SIZE: usize = 512;
const STRUCT_SIZE: usize = 67;

const SHORTENERS: &[&str] = &[
    "bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly",
    "adf.ly", "bit.do", "mcaf.ee", "su.pr", "ity.im", "q.gs", "po.st",
    "bc.vc", "u.to", "j.mp", "buzurl.com", "cutt.us", "u.bb", "yourls.org",
    "x.co", "prettylinkpro.com", "scrnch.me", "filourl.com", "vzturl.com",
    "qr.net", "1url.com", "tweez.me", "v.gd", "tr.im",
];

const SUSPICIOUS_TLDS: &[&str] = &[
    "tk", "ml", "ga", "cf", "gq", "xyz", "top", "work", "click", "link",
    "country", "stream", "download", "win", "bid", "loan", "review", "faith",
    "party", "science", "gdn", "racing", "accountant", "date", "men", "cricket",
];

const FREE_HOSTS: &[&str] = &[
    "000webhostapp.com", "weebly.com", "wixsite.com", "blogspot.com",
    "wordpress.com", "github.io", "netlify.app", "vercel.app", "herokuapp.com",
    "firebaseapp.com", "web.app", "glitch.me", "repl.co", "ngrok.io",
    "serveo.net", "localtunnel.me", "pagekite.me", "tunnelto.dev",
];

const SUSPICIOUS_KEYWORDS: &[&str] = &[
    "login", "signin", "verify", "secure", "account", "update", "banking",
    "confirm", "password", "credential", "wallet", "billing", "invoice",
    "support", "unlock", "recover", "alert", "suspended", "limited", "webscr",
    "cmd", "paypal", "apple", "microsoft", "google", "amazon", "netflix",
    "facebook", "instagram", "whatsapp", "maybank", "cimb", "grab", "touchngo",
    "boost", "shopeepay",
];

const OPEN_REDIRECT_PARAMS: &[&str] = &[
    "url=", "redirect=", "next=", "return=", "goto=", "dest=", "r=", "u=",
    "link=", "target=", "redir=", "redirect_uri=", "callback=", "continue=",
    "window=", "to=", "out=", "view=",
];

// ───────────── 底层工具 ─────────────

#[inline]
fn fnv1a32_standard(s: &str) -> u32 {
    let mut h: u32 = 0x811c9dc5;
    for c in s.chars() {
        h ^= c as u32;
        h = h.wrapping_mul(0x01000193);
    }
    h
}

fn shannon_entropy(s: &str) -> f32 {
    if s.is_empty() {
        return 0.0;
    }
    let mut freq: std::collections::HashMap<char, u32> = std::collections::HashMap::new();
    let total = s.chars().count() as u32;
    for c in s.chars() {
        *freq.entry(c).or_insert(0) += 1;
    }
    let mut ent = 0.0f32;
    for &count in freq.values() {
        let p = count as f32 / total as f32;
        ent -= p * p.log2();
    }
    ent
}

fn levenshtein(s1: &str, s2: &str) -> usize {
    let a: Vec<char> = s1.chars().collect();
    let b: Vec<char> = s2.chars().collect();
    if a.is_empty() { return b.len(); }
    if b.is_empty() { return a.len(); }
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut cur = vec![0usize; b.len() + 1];
    for i in 1..=a.len() {
        cur[0] = i;
        for j in 1..=b.len() {
            let cost = if a[i - 1] == b[j - 1] { 0 } else { 1 };
            cur[j] = (prev[j] + 1).min(cur[j - 1] + 1).min(prev[j - 1] + cost);
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev[b.len()]
}

// ───────────── 正则模拟 ─────────────

fn is_ipv4_host(s: &str) -> bool {
    let parts: Vec<&str> = s.split('.').collect();
    if parts.len() != 4 { return false; }
    parts.iter().all(|p| {
        !p.is_empty() && p.len() <= 3 && p.chars().all(|c| c.is_ascii_digit())
    })
}

fn is_hex_ip(s: &str) -> bool {
    if s.len() < 3 { return false; }
    let b = s.as_bytes();
    if b[0] != b'0' || (b[1] != b'x' && b[1] != b'X') { return false; }
    b[2..].iter().all(|c| c.is_ascii_hexdigit())
}

fn is_octal(s: &str) -> bool {
    if s.len() < 2 { return false; }
    let b = s.as_bytes();
    if b[0] != b'0' { return false; }
    b[1..].iter().all(|c| (b'0'..=b'7').contains(c))
}

fn count_percent_encoding(s: &str) -> usize {
    let b = s.as_bytes();
    let mut n = 0;
    let mut i = 0;
    while i + 2 < b.len() {
        if b[i] == b'%' && b[i + 1].is_ascii_hexdigit() && b[i + 2].is_ascii_hexdigit() {
            n += 1;
            i += 3;
        } else {
            i += 1;
        }
    }
    n
}

fn longest_digit_run(s: &str) -> usize {
    let mut max = 0;
    let mut cur = 0;
    for c in s.chars() {
        if c.is_ascii_digit() {
            cur += 1;
            if cur > max { max = cur; }
        } else {
            cur = 0;
        }
    }
    max
}

fn count_repeated_nonalnum(s: &str) -> usize {
    let chars: Vec<char> = s.chars().collect();
    let mut n = 0;
    let mut i = 0;
    while i + 1 < chars.len() {
        let c = chars[i];
        if !c.is_ascii_alphanumeric() && c == chars[i + 1] {
            n += 1;
            i += 2;
        } else {
            i += 1;
        }
    }
    n
}

fn count_consecutive_repeats(s: &str) -> usize {
    let chars: Vec<char> = s.chars().collect();
    let mut n = 0;
    let mut i = 0;
    while i + 1 < chars.len() {
        if chars[i] == chars[i + 1] {
            n += 1;
            i += 2;
        } else {
            i += 1;
        }
    }
    n
}

fn distinct_suffix_count(host: &str) -> usize {
    let bytes = host.as_bytes();
    let mut set: HashSet<&[u8]> = HashSet::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'.' {
            let start = i + 1;
            let mut end = start;
            while end < bytes.len() && bytes[end].is_ascii_lowercase() {
                end += 1;
            }
            if end - start >= 2 {
                set.insert(&bytes[start..end]);
            }
            i = end;
        } else {
            i += 1;
        }
    }
    set.len()
}

fn path_has_dangerous_ext(path: &str) -> bool {
    let p = path.to_lowercase();
    ["php", "asp", "aspx", "jsp", "cgi", "exe", "scr", "bat", "cmd", "msi", "vbs", "js"]
        .iter()
        .any(|e| p.ends_with(&format!(".{}", e)))
}

fn path_has_encoded_url(path: &str) -> bool {
    let p = path.to_lowercase();
    p.contains("https%3a%2f%2f") || p.contains("http%3a%2f%2f")
}

fn has_cyrillic(s: &str) -> bool {
    s.chars().any(|c| ('\u{0400}'..='\u{04FF}').contains(&c))
}

fn has_emoji(s: &str) -> bool {
    s.chars().any(|c| ('\u{1F300}'..='\u{1FAFF}').contains(&c))
}

// ───────────── URL 解析（模拟 urlparse） ─────────────

struct ParsedUrl {
    scheme: String,
    hostname: String, // lowercase，模拟 urlparse.hostname
    path: String,     // 原 case
    query: String,    // 原 case，不含 ?
    port: Option<u32>,
}

fn parse_url(raw: &str) -> Option<ParsedUrl> {
    let (scheme, rest) = match raw.find("://") {
        Some(i) => (raw[..i].to_string(), &raw[i + 3..]),
        None => (String::new(), raw),
    };

    // 分离 fragment（但不保留，Python 的 path/query 不含 fragment）
    let before_frag = match rest.find('#') {
        Some(i) => &rest[..i],
        None => rest,
    };

    // authority vs 后续
    let (authority, after) = match before_frag.find(|c| c == '/' || c == '?') {
        Some(i) => (&before_frag[..i], &before_frag[i..]),
        None => (before_frag, ""),
    };

    // userinfo
    let host_part = match authority.rfind('@') {
        Some(i) => &authority[i + 1..],
        None => authority,
    };

    // 端口
    let (hostname, port) = match host_part.rfind(':') {
        Some(i) => {
            let ps = &host_part[i + 1..];
            if ps.is_empty() || !ps.chars().all(|c| c.is_ascii_digit()) {
                return None; // 端口非法（模拟 Python ValueError 分支走全 0）
            }
            let p = ps.parse::<u32>().ok()?;
            (host_part[..i].to_string(), Some(p))
        }
        None => (host_part.to_string(), None),
    };

    // path vs query
    let (path, query) = match after.find('?') {
        Some(i) => (after[..i].to_string(), after[i + 1..].to_string()),
        None => (after.to_string(), String::new()),
    };

    Some(ParsedUrl {
        scheme,
        hostname: hostname.to_lowercase(),
        path,
        query,
        port,
    })
}

// ───────────── 主入口 ─────────────

pub fn extract_features(raw_url: &str) -> [f32; TOTAL_DIM] {
    let mut feats = [0.0f32; TOTAL_DIM];

    let parsed = match parse_url(raw_url) {
        Some(p) => p,
        None => return feats, // 模拟 Python except: return zeros
    };
    let ParsedUrl { scheme, hostname, path, query, port } = parsed;

    let host = &hostname;
    let full_url = raw_url.to_lowercase();
    let (subdomain, domain, tld) = PslSet::global().split(host);

    let len_chars = |s: &str| s.chars().count() as f32;

    // 0: URL 长度
    feats[0] = len_chars(raw_url);
    // 1: '-' 数
    feats[1] = raw_url.matches('-').count() as f32;
    // 2: 数字数
    feats[2] = raw_url.chars().filter(|c| c.is_ascii_digit()).count() as f32;
    // 3: subdomain 层数
    feats[3] = if subdomain.is_empty() {
        0.0
    } else {
        subdomain.split('.').count() as f32
    };
    // 4: 有 scheme
    feats[4] = if scheme.is_empty() { 0.0 } else { 1.0 };
    // 5: 非字母数字数
    feats[5] = raw_url.chars().filter(|c| !c.is_ascii_alphanumeric()).count() as f32;
    // 6: 熵
    feats[6] = shannon_entropy(raw_url);
    // 7: path 非空段数
    feats[7] = path.split('/').filter(|s| !s.is_empty()).count() as f32;
    // 8: host 长度
    feats[8] = len_chars(host);
    // 9: IPv4
    feats[9] = if is_ipv4_host(host) { 1.0 } else { 0.0 };
    // 10: '@' 存在
    feats[10] = if raw_url.contains('@') { 1.0 } else { 0.0 };
    // 11: '//' in raw_url[8:]
    {
        let tail: String = raw_url.chars().skip(8).collect();
        feats[11] = if tail.contains("//") { 1.0 } else { 0.0 };
    }
    // 12: tld 长度
    feats[12] = len_chars(&tld);
    // 13: 常见 tld
    feats[13] = if matches!(tld.as_str(), "com" | "org" | "net" | "gov" | "edu") {
        1.0
    } else {
        0.0
    };
    // 14: query 等号数
    feats[14] = query.matches('=').count() as f32;
    // 15: path 长度
    feats[15] = len_chars(&path);
    // 16: 关键词数 in full_url
    let kw_count = SUSPICIOUS_KEYWORDS.iter().filter(|k| full_url.contains(*k)).count() as f32;
    feats[16] = kw_count;
    // 17: 品牌 in host（host 已 lowercase）
    feats[17] = if SUSPICIOUS_KEYWORDS.iter().any(|k| host.contains(k)) { 1.0 } else { 0.0 };
    // 18: 关键词 in path（原 case，与 Python 一致）
    feats[18] = if SUSPICIOUS_KEYWORDS.iter().any(|k| path.contains(k)) { 1.0 } else { 0.0 };
    // 19: 重复 16
    feats[19] = kw_count;
    // 20: punycode
    feats[20] = if host.contains("xn--") { 1.0 } else { 0.0 };
    // 21: 非标准端口
    feats[21] = match port {
        Some(p) if p != 80 && p != 443 => 1.0,
        _ => 0.0,
    };
    // 22: %XX 编码数
    feats[22] = count_percent_encoding(raw_url) as f32;
    // 23: hex IP
    feats[23] = if is_hex_ip(host) { 1.0 } else { 0.0 };
    // 24: 大写比例
    {
        let upper = raw_url.chars().filter(|c| c.is_ascii_uppercase()).count();
        let len = raw_url.chars().count().max(1);
        feats[24] = upper as f32 / len as f32;
    }
    // 25: host 里 'www' 出现次数
    feats[25] = host.matches("www").count() as f32;
    // 26: 最长数字串
    feats[26] = longest_digit_run(raw_url) as f32;
    // 27 / 28: label 相关
    let labels: Vec<&str> = host.split('.').collect();
    feats[27] = labels.iter().map(|l| l.chars().count()).max().unwrap_or(0) as f32;
    feats[28] = labels.len() as f32;
    // 29: domain in path（Python 语义：空 domain 也匹配，''.in 返回 True）
    {
        let d_lower = domain.to_lowercase();
        feats[29] = if path.to_lowercase().contains(&d_lower) { 1.0 } else { 0.0 };
    }
    // 30: query 长度（不是 host 长度！对齐 Python）
    feats[30] = len_chars(&query);
    // 31: query 等号数（重复 14）
    feats[31] = query.matches('=').count() as f32;
    // 32: 危险扩展
    feats[32] = if path_has_dangerous_ext(&path) { 1.0 } else { 0.0 };
    // 33: 多种后缀
    feats[33] = if distinct_suffix_count(host) > 1 { 1.0 } else { 0.0 };
    // 34: 非字母数字重复对数
    feats[34] = count_repeated_nonalnum(raw_url) as f32;
    // 35 / 36: 0（保留）
    // 37: 非 ASCII in host
    feats[37] = host.chars().filter(|c| (*c as u32) > 127).count() as f32;
    // 38: 西里尔
    feats[38] = if has_cyrillic(host) { 1.0 } else { 0.0 };
    // 39: min_levenshtein
    {
        let mut min_d = 999usize;
        for kw in SUSPICIOUS_KEYWORDS {
            if host.contains(kw) { min_d = 0; break; }
            let d = levenshtein(host, kw);
            if d < min_d { min_d = d; }
        }
        feats[39] = min_d as f32;
    }
    // 40: kw in subdomain
    feats[40] = if SUSPICIOUS_KEYWORDS.iter().any(|k| subdomain.contains(k)) { 1.0 } else { 0.0 };
    // 41: domain == kw.tld
    {
        let mut hit = false;
        for k in SUSPICIOUS_KEYWORDS {
            if format!("{}.{}", k, tld) == domain { hit = true; break; }
        }
        feats[41] = if hit { 1.0 } else { 0.0 };
    }
    // 42: kw in subdomain && !kw in domain
    {
        let kw_sub = SUSPICIOUS_KEYWORDS.iter().any(|k| subdomain.contains(k));
        let kw_dom = SUSPICIOUS_KEYWORDS.iter().any(|k| domain.contains(k));
        feats[42] = if kw_sub && !kw_dom { 1.0 } else { 0.0 };
    }
    // 43: 危险 tld
    feats[43] = if SUSPICIOUS_TLDS.contains(&tld.as_str()) { 1.0 } else { 0.0 };
    // 44: 形似 tld
    feats[44] = if matches!(tld.as_str(), "com" | "c0m" | "cm" | "co" | "om") {
        1.0
    } else {
        0.0
    };
    // 45: tld 长度 2
    feats[45] = if tld.chars().count() == 2 { 1.0 } else { 0.0 };
    // 46: dot 数
    feats[46] = host.matches('.').count() as f32;
    // 47: label 数 > 3
    feats[47] = if labels.len() > 3 { 1.0 } else { 0.0 };
    // 48: domain 长度
    feats[48] = len_chars(&domain);
    // 49: first_sub 长度
    let first_sub = subdomain.split('.').next().unwrap_or("");
    feats[49] = len_chars(first_sub);
    // 50: first_sub 熵
    feats[50] = shannon_entropy(first_sub);
    // 51: first_sub 元音比
    {
        let vowels = first_sub
            .chars()
            .filter(|c| matches!(c.to_ascii_lowercase(), 'a' | 'e' | 'i' | 'o' | 'u'))
            .count();
        let total = first_sub.chars().count().max(1);
        feats[51] = vowels as f32 / total as f32;
    }
    // 52: 长 + 高熵首子域
    feats[52] = if first_sub.chars().count() > 12 && shannon_entropy(first_sub) > 3.5 {
        1.0
    } else {
        0.0
    };
    // 53: domain 数字比
    {
        let digits = domain.chars().filter(|c| c.is_ascii_digit()).count();
        let total = domain.chars().count().max(1);
        feats[53] = digits as f32 / total as f32;
    }
    // 54: 八进制 IP
    feats[54] = if is_octal(host) { 1.0 } else { 0.0 };
    // 55: 纯数字 host
    feats[55] = if !host.is_empty() && host.chars().all(|c| c.is_ascii_digit()) {
        1.0
    } else {
        0.0
    };
    // 56: 去点后纯数字
    {
        let s: String = host.chars().filter(|c| *c != '.').collect();
        feats[56] = if !s.is_empty() && s.chars().all(|c| c.is_ascii_digit()) {
            1.0
        } else {
            0.0
        };
    }
    // 57: 非 http/https 协议
    feats[57] = if !matches!(scheme.as_str(), "http" | "https") { 1.0 } else { 0.0 };
    // 58: '@' 重复 10
    feats[58] = if raw_url.contains('@') { 1.0 } else { 0.0 };
    // 59: 开放重定向参数
    feats[59] = if OPEN_REDIRECT_PARAMS.iter().any(|p| full_url.contains(p)) {
        1.0
    } else {
        0.0
    };
    // 60: path 里编码 URL
    feats[60] = if path_has_encoded_url(&path) { 1.0 } else { 0.0 };
    // 61: 免费主机
    feats[61] = if FREE_HOSTS.contains(&domain.as_str()) { 1.0 } else { 0.0 };
    // 62: 免费主机 + 关键词
    {
        let is_free = FREE_HOSTS.contains(&domain.as_str());
        let kw_hit = SUSPICIOUS_KEYWORDS.iter().any(|k| host.contains(k));
        feats[62] = if is_free && kw_hit { 1.0 } else { 0.0 };
    }
    // 63: 相邻重复字符对数
    feats[63] = count_consecutive_repeats(raw_url) as f32;
    // 64: emoji
    feats[64] = if has_emoji(raw_url) { 1.0 } else { 0.0 };
    // 65: 关键词 in query（原 case）
    feats[65] = if SUSPICIOUS_KEYWORDS.iter().any(|k| query.contains(k)) { 1.0 } else { 0.0 };
    // 66: 短链
    feats[66] = if SHORTENERS.contains(&domain.as_str()) { 1.0 } else { 0.0 };

    // n-gram 3、4、5 gram，二值
    {
        let chars: Vec<char> = raw_url.to_lowercase().chars().collect();
        for n in 3..=5usize {
            if chars.len() < n { continue; }
            for i in 0..=(chars.len() - n) {
                let gram: String = chars[i..i + n].iter().collect();
                let h = fnv1a32_standard(&gram) as usize % NGRAM_SIZE;
                feats[STRUCT_SIZE + h] = 1.0;
            }
        }
    }

    // ⚠️ 索引 578 被短链标记覆盖（Python 实车行为）
    feats[TOTAL_DIM - 1] = if SHORTENERS.contains(&domain.as_str()) { 1.0 } else { 0.0 };

    feats
}

#[cfg(test)]
mod inline_tests {
    use super::*;

    #[test]
    fn fnv1a32_standard_known_values() {
        assert_eq!(fnv1a32_standard(""), 0x811c9dc5);
        assert_eq!(fnv1a32_standard("a"), 0xe40c292c);
        assert_eq!(fnv1a32_standard("foobar"), 0xbf9cf968);
    }

    #[test]
    fn levenshtein_basics() {
        assert_eq!(levenshtein("", ""), 0);
        assert_eq!(levenshtein("", "abc"), 3);
        assert_eq!(levenshtein("kitten", "sitting"), 3);
    }

    #[test]
    fn entropy_basics() {
        assert!((shannon_entropy("ab") - 1.0).abs() < 1e-6);
        assert!((shannon_entropy("aa") - 0.0).abs() < 1e-6);
    }

    #[test]
    fn parse_url_basics() {
        let p = parse_url("https://google.com/path?a=1").unwrap();
        assert_eq!(p.scheme, "https");
        assert_eq!(p.hostname, "google.com");
        assert_eq!(p.path, "/path");
        assert_eq!(p.query, "a=1");
        assert_eq!(p.port, None);

        let p = parse_url("http://127.0.0.1:8080/admin").unwrap();
        assert_eq!(p.hostname, "127.0.0.1");
        assert_eq!(p.port, Some(8080));

        let p = parse_url("https://paypal.com@evil.xyz/login").unwrap();
        assert_eq!(p.hostname, "evil.xyz");
    }
}
