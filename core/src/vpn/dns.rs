use super::utils::calculate_checksum;

pub fn extract_udp_dns(pkt: &[u8]) -> Option<(Vec<u8>, bool)> {
    if pkt.len() < 20 { return None; }
    let version = pkt[0] >> 4;
    if version == 4 && pkt[9] == 17 {
        let ihl = (pkt[0] & 0x0F) as usize * 4;
        if pkt.len() >= ihl + 8 {
            let dst_port = u16::from_be_bytes([pkt[ihl + 2], pkt[ihl + 3]]);
            if dst_port == 53 { return Some((pkt[ihl + 8..].to_vec(), false)); }
        }
    } else if version == 6 && pkt[6] == 17 {
        if pkt.len() >= 40 + 8 {
            let dst_port = u16::from_be_bytes([pkt[40 + 2], pkt[40 + 3]]);
            if dst_port == 53 { return Some((pkt[40 + 8..].to_vec(), true)); }
        }
    }
    None
}

pub fn build_udp_dns_response(request: &[u8], response_payload: &[u8], is_ipv6: bool) -> Vec<u8> {
    let mut buf;
    let udp_offset;

    if is_ipv6 {
        udp_offset = 40;
        let total_len = udp_offset + 8 + response_payload.len();
        buf = vec![0u8; total_len];
        buf[..40].copy_from_slice(&request[..40]);

        let payload_len = total_len - 40;
        buf[4] = ((payload_len >> 8) & 0xFF) as u8;
        buf[5] = (payload_len & 0xFF) as u8;

        // IPv6 源/目的地址交换
        for i in 0..16 {
            buf[8 + i] = request[24 + i];
            buf[24 + i] = request[8 + i];
        }
    } else {
        udp_offset = (request[0] & 0x0F) as usize * 4;
        let total_len = udp_offset + 8 + response_payload.len();
        buf = vec![0u8; total_len];
        buf[..udp_offset].copy_from_slice(&request[..udp_offset]);

        buf[2] = ((total_len >> 8) & 0xFF) as u8;
        buf[3] = (total_len & 0xFF) as u8;
        buf[9] = 17;

        for i in 0..4 {
            buf[12 + i] = request[16 + i];
            buf[16 + i] = request[12 + i];
        }

        // IPv4 Header Checksum
        buf[10] = 0;
        buf[11] = 0;
        let ip_checksum = calculate_checksum(&buf[0..udp_offset]);
        buf[10] = (ip_checksum >> 8) as u8;
        buf[11] = (ip_checksum & 0xFF) as u8;
    }

    // UDP 头部
    buf[udp_offset] = request[udp_offset + 2];
    buf[udp_offset + 1] = request[udp_offset + 3];
    buf[udp_offset + 2] = request[udp_offset];
    buf[udp_offset + 3] = request[udp_offset + 1];

    let udp_len = 8 + response_payload.len();
    buf[udp_offset + 4] = ((udp_len >> 8) & 0xFF) as u8;
    buf[udp_offset + 5] = (udp_len & 0xFF) as u8;
    buf[udp_offset + 6] = 0;
    buf[udp_offset + 7] = 0;

    buf[udp_offset + 8..].copy_from_slice(response_payload);

    // 专家修复：完整计算 UDP 校验和（IPv4 和 IPv6 伪首部）
    let mut pseudo_header = Vec::new();
    if is_ipv6 {
        pseudo_header.extend_from_slice(&buf[8..40]); // 源IP + 目的IP
        pseudo_header.extend_from_slice(&[0, 0, 0, (udp_len >> 8) as u8, (udp_len & 0xFF) as u8, 0, 0, 0, 17]);
    } else {
        pseudo_header.extend_from_slice(&buf[12..20]); // 源IP + 目的IP
        pseudo_header.extend_from_slice(&[0, 17, (udp_len >> 8) as u8, (udp_len & 0xFF) as u8]);
    }
    pseudo_header.extend_from_slice(&buf[udp_offset..udp_offset + udp_len]);

    let mut udp_checksum = calculate_checksum(&pseudo_header);
    if udp_checksum == 0 {
        udp_checksum = 0xFFFF; // 专家修复：校验和不能为 0
    }
    buf[udp_offset + 6] = (udp_checksum >> 8) as u8;
    buf[udp_offset + 7] = (udp_checksum & 0xFF) as u8;

    buf
}
