//! T2 钓鱼分类器特征提取（579 维）
//!
//! 严格对齐 `models/training/train_phishscout_fixed.py` 的 `extract_features`。
//! 输入契约：**完整 URL**（必须带 `https://` 或 `http://`）。
//! Android DNS 层拿到的域名必须拼上 `https://` 再传入。
//!
//! 与 T1 (`features_adblock.rs`) 完全独立：
//!   - hash：标准 FNV-1a 32，非 T1 变体
//!   - n-gram：3、4、5 gram，二值（固定 1），非累加
//!   - 结构：67 维
//!   - 索引 578 被短链标记覆盖（Python 实车行为，必须复刻）
//!   - is_ip 只检查 host，不看完整 URL

use crate::classifier::psl::PslSet;
use super::phishing_utils::*;
use super::phishing_url::{parse_url, ParsedUrl};

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

pub fn extract_features(raw_url: &str) -> [f32; TOTAL_DIM] {
    let raw_url = if raw_url.len() > 253 { &raw_url[..253] } else { raw_url };
    let mut feats = [0.0f32; TOTAL_DIM];

    let parsed = match parse_url(raw_url) {
        Some(p) => p,
        None => return feats,
    };
    let ParsedUrl { scheme, hostname, path, query, port } = parsed;

    let host = &hostname;
    let full_url = raw_url.to_lowercase();
    let (subdomain, domain, tld) = PslSet::global().split(host);
    let len_chars = |s: &str| s.chars().count() as f32;

    feats[0] = len_chars(raw_url);
    feats[1] = raw_url.matches('-').count() as f32;
    feats[2] = raw_url.chars().filter(|c| c.is_ascii_digit()).count() as f32;
    feats[3] = if subdomain.is_empty() { 0.0 } else { subdomain.split('.').count() as f32 };
    feats[4] = if scheme.is_empty() { 0.0 } else { 1.0 };
    feats[5] = raw_url.chars().filter(|c| !c.is_ascii_alphanumeric()).count() as f32;
    feats[6] = shannon_entropy(raw_url);
    feats[7] = path.split('/').filter(|s| !s.is_empty()).count() as f32;
    feats[8] = len_chars(host);
    feats[9] = if is_ipv4_host(host) { 1.0 } else { 0.0 };
    feats[10] = if raw_url.contains('@') { 1.0 } else { 0.0 };
    {
        let tail: String = raw_url.chars().skip(8).collect();
        feats[11] = if tail.contains("//") { 1.0 } else { 0.0 };
    }
    feats[12] = len_chars(&tld);
    feats[13] = if matches!(tld.as_str(), "com" | "org" | "net" | "gov" | "edu") { 1.0 } else { 0.0 };
    feats[14] = query.matches('=').count() as f32;
    feats[15] = len_chars(&path);
    let kw_count = SUSPICIOUS_KEYWORDS.iter().filter(|k| full_url.contains(*k)).count() as f32;
    feats[16] = kw_count;
    feats[17] = if SUSPICIOUS_KEYWORDS.iter().any(|k| host.contains(k)) { 1.0 } else { 0.0 };
    feats[18] = if SUSPICIOUS_KEYWORDS.iter().any(|k| path.contains(k)) { 1.0 } else { 0.0 };
    feats[19] = kw_count;
    feats[20] = if host.contains("xn--") { 1.0 } else { 0.0 };
    feats[21] = match port { Some(p) if p != 80 && p != 443 => 1.0, _ => 0.0 };
    feats[22] = count_percent_encoding(raw_url) as f32;
    feats[23] = if is_hex_ip(host) { 1.0 } else { 0.0 };
    {
        let upper = raw_url.chars().filter(|c| c.is_ascii_uppercase()).count();
        let len = raw_url.chars().count().max(1);
        feats[24] = upper as f32 / len as f32;
    }
    feats[25] = host.matches("www").count() as f32;
    feats[26] = longest_digit_run(raw_url) as f32;
    let labels: Vec<&str> = host.split('.').collect();
    feats[27] = labels.iter().map(|l| l.chars().count()).max().unwrap_or(0) as f32;
    feats[28] = labels.len() as f32;
    {
        let d_lower = domain.to_lowercase();
        feats[29] = if path.to_lowercase().contains(&d_lower) { 1.0 } else { 0.0 };
    }
    feats[30] = len_chars(&query);
    feats[31] = query.matches('=').count() as f32;
    feats[32] = if path_has_dangerous_ext(&path) { 1.0 } else { 0.0 };
    feats[33] = if distinct_suffix_count(host) > 1 { 1.0 } else { 0.0 };
    feats[34] = count_repeated_nonalnum(raw_url) as f32;
    feats[37] = host.chars().filter(|c| (*c as u32) > 127).count() as f32;
    feats[38] = if has_cyrillic(host) { 1.0 } else { 0.0 };
    {
        let mut min_d = 999usize;
        for kw in SUSPICIOUS_KEYWORDS {
            if host.contains(kw) { min_d = 0; break; }
            let d = levenshtein(host, kw);
            if d < min_d { min_d = d; }
        }
        feats[39] = min_d as f32;
    }
    feats[40] = if SUSPICIOUS_KEYWORDS.iter().any(|k| subdomain.contains(k)) { 1.0 } else { 0.0 };
    {
        let mut hit = false;
        for k in SUSPICIOUS_KEYWORDS {
            if format!("{}.{}", k, tld) == domain { hit = true; break; }
        }
        feats[41] = if hit { 1.0 } else { 0.0 };
    }
    {
        let kw_sub = SUSPICIOUS_KEYWORDS.iter().any(|k| subdomain.contains(k));
        let kw_dom = SUSPICIOUS_KEYWORDS.iter().any(|k| domain.contains(k));
        feats[42] = if kw_sub && !kw_dom { 1.0 } else { 0.0 };
    }
    feats[43] = if SUSPICIOUS_TLDS.contains(&tld.as_str()) { 1.0 } else { 0.0 };
    feats[44] = if matches!(tld.as_str(), "com" | "c0m" | "cm" | "co" | "om") { 1.0 } else { 0.0 };
    feats[45] = if tld.chars().count() == 2 { 1.0 } else { 0.0 };
    feats[46] = host.matches('.').count() as f32;
    feats[47] = if labels.len() > 3 { 1.0 } else { 0.0 };
    feats[48] = len_chars(&domain);
    let first_sub = subdomain.split('.').next().unwrap_or("");
    feats[49] = len_chars(first_sub);
    feats[50] = shannon_entropy(first_sub);
    {
        let vowels = first_sub.chars().filter(|c| matches!(c.to_ascii_lowercase(), 'a' | 'e' | 'i' | 'o' | 'u')).count();
        let total = first_sub.chars().count().max(1);
        feats[51] = vowels as f32 / total as f32;
    }
    feats[52] = if first_sub.chars().count() > 12 && shannon_entropy(first_sub) > 3.5 { 1.0 } else { 0.0 };
    {
        let digits = domain.chars().filter(|c| c.is_ascii_digit()).count();
        let total = domain.chars().count().max(1);
        feats[53] = digits as f32 / total as f32;
    }
    feats[54] = if is_octal(host) { 1.0 } else { 0.0 };
    feats[55] = if !host.is_empty() && host.chars().all(|c| c.is_ascii_digit()) { 1.0 } else { 0.0 };
    {
        let s: String = host.chars().filter(|c| *c != '.').collect();
        feats[56] = if !s.is_empty() && s.chars().all(|c| c.is_ascii_digit()) { 1.0 } else { 0.0 };
    }
    feats[57] = if !matches!(scheme.as_str(), "http" | "https") { 1.0 } else { 0.0 };
    feats[58] = if raw_url.contains('@') { 1.0 } else { 0.0 };
    feats[59] = if OPEN_REDIRECT_PARAMS.iter().any(|p| full_url.contains(p)) { 1.0 } else { 0.0 };
    feats[60] = if path_has_encoded_url(&path) { 1.0 } else { 0.0 };
    feats[61] = if FREE_HOSTS.contains(&domain.as_str()) { 1.0 } else { 0.0 };
    {
        let is_free = FREE_HOSTS.contains(&domain.as_str());
        let kw_hit = SUSPICIOUS_KEYWORDS.iter().any(|k| host.contains(k));
        feats[62] = if is_free && kw_hit { 1.0 } else { 0.0 };
    }
    feats[63] = count_consecutive_repeats(raw_url) as f32;
    feats[64] = if has_emoji(raw_url) { 1.0 } else { 0.0 };
    feats[65] = if SUSPICIOUS_KEYWORDS.iter().any(|k| query.contains(k)) { 1.0 } else { 0.0 };
    feats[66] = if SHORTENERS.contains(&domain.as_str()) { 1.0 } else { 0.0 };

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

    feats[TOTAL_DIM - 1] = if SHORTENERS.contains(&domain.as_str()) { 1.0 } else { 0.0 };
    feats
}
