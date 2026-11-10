pub struct ParsedUrl {
    pub scheme: String,
    pub hostname: String,
    pub path: String,
    pub query: String,
    pub port: Option<u32>,
}

pub fn parse_url(raw: &str) -> Option<ParsedUrl> {
    let (scheme, rest) = match raw.find("://") {
        Some(i) => (raw[..i].to_string(), &raw[i + 3..]),
        None => (String::new(), raw),
    };
    let before_frag = match rest.find('#') {
        Some(i) => &rest[..i],
        None => rest,
    };
    let (authority, after) = match before_frag.find(|c| c == '/' || c == '?') {
        Some(i) => (&before_frag[..i], &before_frag[i..]),
        None => (before_frag, ""),
    };
    let host_part = match authority.rfind('@') {
        Some(i) => &authority[i + 1..],
        None => authority,
    };
    let (hostname, port) = match host_part.rfind(':') {
        Some(i) => {
            let ps = &host_part[i + 1..];
            if ps.is_empty() || !ps.chars().all(|c| c.is_ascii_digit()) { return None; }
            let p = ps.parse::<u32>().ok()?;
            (host_part[..i].to_string(), Some(p))
        }
        None => (host_part.to_string(), None),
    };
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

#[cfg(test)]
mod inline_tests {
    use super::*;
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
