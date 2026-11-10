use std::collections::HashSet;

#[inline]
pub fn fnv1a32_standard(s: &str) -> u32 {
    let mut h: u32 = 0x811c9dc5;
    for c in s.chars() {
        h ^= c as u32;
        h = h.wrapping_mul(0x01000193);
    }
    h
}

pub fn shannon_entropy(s: &str) -> f32 {
    if s.is_empty() { return 0.0; }
    let mut freq: std::collections::HashMap<char, u32> = std::collections::HashMap::new();
    let total = s.chars().count() as u32;
    for c in s.chars() { *freq.entry(c).or_insert(0) += 1; }
    let mut ent = 0.0f32;
    for &count in freq.values() {
        let p = count as f32 / total as f32;
        ent -= p * p.log2();
    }
    ent
}

pub fn levenshtein(s1: &str, s2: &str) -> usize {
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

pub fn is_ipv4_host(s: &str) -> bool {
    let parts: Vec<&str> = s.split('.').collect();
    if parts.len() != 4 { return false; }
    parts.iter().all(|p| !p.is_empty() && p.len() <= 3 && p.chars().all(|c| c.is_ascii_digit()))
}

pub fn is_hex_ip(s: &str) -> bool {
    if s.len() < 3 { return false; }
    let b = s.as_bytes();
    if b[0] != b'0' || (b[1] != b'x' && b[1] != b'X') { return false; }
    b[2..].iter().all(|c| c.is_ascii_hexdigit())
}

pub fn is_octal(s: &str) -> bool {
    if s.len() < 2 { return false; }
    let b = s.as_bytes();
    if b[0] != b'0' { return false; }
    b[1..].iter().all(|c| (b'0'..=b'7').contains(c))
}

pub fn count_percent_encoding(s: &str) -> usize {
    let b = s.as_bytes();
    let mut n = 0; let mut i = 0;
    while i + 2 < b.len() {
        if b[i] == b'%' && b[i + 1].is_ascii_hexdigit() && b[i + 2].is_ascii_hexdigit() {
            n += 1; i += 3;
        } else { i += 1; }
    }
    n
}

pub fn longest_digit_run(s: &str) -> usize {
    let mut max = 0; let mut cur = 0;
    for c in s.chars() {
        if c.is_ascii_digit() { cur += 1; if cur > max { max = cur; } } else { cur = 0; }
    }
    max
}

pub fn count_repeated_nonalnum(s: &str) -> usize {
    let chars: Vec<char> = s.chars().collect();
    let mut n = 0; let mut i = 0;
    while i + 1 < chars.len() {
        let c = chars[i];
        if !c.is_ascii_alphanumeric() && c == chars[i + 1] { n += 1; i += 2; } else { i += 1; }
    }
    n
}

pub fn count_consecutive_repeats(s: &str) -> usize {
    let chars: Vec<char> = s.chars().collect();
    let mut n = 0; let mut i = 0;
    while i + 1 < chars.len() {
        if chars[i] == chars[i + 1] { n += 1; i += 2; } else { i += 1; }
    }
    n
}

pub fn distinct_suffix_count(host: &str) -> usize {
    let bytes = host.as_bytes();
    let mut set: HashSet<&[u8]> = HashSet::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'.' {
            let start = i + 1; let mut end = start;
            while end < bytes.len() && bytes[end].is_ascii_lowercase() { end += 1; }
            if end - start >= 2 { set.insert(&bytes[start..end]); }
            i = end;
        } else { i += 1; }
    }
    set.len()
}

pub fn path_has_dangerous_ext(path: &str) -> bool {
    let p = path.to_lowercase();
    ["php", "asp", "aspx", "jsp", "cgi", "exe", "scr", "bat", "cmd", "msi", "vbs", "js"]
        .iter().any(|e| p.ends_with(&format!(".{}", e)))
}

pub fn path_has_encoded_url(path: &str) -> bool {
    let p = path.to_lowercase();
    p.contains("https%3a%2f%2f") || p.contains("http%3a%2f%2f")
}

pub fn has_cyrillic(s: &str) -> bool {
    s.chars().any(|c| ('\u{0400}'..='\u{04FF}').contains(&c))
}

pub fn has_emoji(s: &str) -> bool {
    s.chars().any(|c| ('\u{1F300}'..='\u{1FAFF}').contains(&c))
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
}
