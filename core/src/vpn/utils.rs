pub fn calculate_checksum(data: &[u8]) -> u16 {
    let mut sum: u32 = 0;
    for i in (0..data.len()).step_by(2) {
        if i + 1 < data.len() {
            sum += ((data[i] as u32) << 8) | (data[i + 1] as u32);
        } else {
            sum += (data[i] as u32) << 8;
        }
    }
    while (sum >> 16) > 0 {
        sum = (sum & 0xFFFF) + (sum >> 16);
    }
    !sum as u16
}

pub fn find_headers_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n").map(|p| p + 4)
}

pub fn extract_sni(hello: &[u8]) -> Option<String> {
    if hello.len() < 5 || hello[0] != 0x16 { return None; }
    let mut pos = 5;
    if hello.get(pos)? != &1 { return None; }
    pos += 4;
    pos += 2 + 32;
    let session_id_len = *hello.get(pos)? as usize;
    pos += 1 + session_id_len;
    let cipher_suites_len = u16::from_be_bytes([*hello.get(pos)?, *hello.get(pos + 1)?]) as usize;
    pos += 2 + cipher_suites_len;
    let comp_len = *hello.get(pos)? as usize;
    pos += 1 + comp_len;
    if pos + 2 > hello.len() { return None; }
    let ext_len = u16::from_be_bytes([hello[pos], hello[pos + 1]]) as usize;
    pos += 2;
    let ext_end = (pos + ext_len).min(hello.len());
    while pos + 4 <= ext_end {
        let ext_type = u16::from_be_bytes([hello[pos], hello[pos + 1]]);
        let ext_size = u16::from_be_bytes([hello[pos + 2], hello[pos + 3]]) as usize;
        pos += 4;
        if ext_type == 0 {
            let mut sub_pos = pos + 2;
            let name_type = hello.get(sub_pos)?;
            sub_pos += 1;
            if *name_type == 0 {
                let name_len = u16::from_be_bytes([*hello.get(sub_pos)?, *hello.get(sub_pos + 1)?]) as usize;
                sub_pos += 2;
                if let Ok(domain) = std::str::from_utf8(&hello[sub_pos..sub_pos + name_len]) {
                    return Some(domain.to_string());
                }
            }
        }
        pos += ext_size;
    }
    None
}
