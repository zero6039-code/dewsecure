use std::os::unix::io::AsRawFd;
use std::sync::Arc;
use crate::VpnProtector;
use super::device::TunWriter;
use super::dns::build_udp_dns_response;

pub fn extract_dns_qname(payload: &[u8]) -> Option<String> {
    if payload.len() < 12 { return None; }
    let mut pos = 12;
    let mut domain_parts = Vec::new();

    while pos < payload.len() {
        let len = payload[pos] as usize;
        if len == 0 { break; }
        pos += 1;
        if pos + len > payload.len() { return None; }
        if let Ok(part) = std::str::from_utf8(&payload[pos..pos+len]) {
            domain_parts.push(part);
        } else {
            return None;
        }
        pos += len;
    }
    if domain_parts.is_empty() { None } else { Some(domain_parts.join(".")) }
}

pub fn build_block_dns_response(request: &[u8]) -> Vec<u8> {
    let mut q_end = 12;
    while q_end < request.len() && request[q_end] != 0 {
        q_end += request[q_end] as usize + 1;
    }
    q_end += 5;
    if q_end > request.len() { q_end = request.len(); }

    let mut resp = request[..q_end].to_vec();
    resp[2] = 0x81;
    resp[3] = 0x80;
    resp[6] = 0x00; resp[7] = 0x01;

    resp.extend_from_slice(&[
        0xC0, 0x0C, 0x00, 0x01, 0x00, 0x01,
        0x00, 0x00, 0x00, 0x05, 0x00, 0x04,
        0x00, 0x00, 0x00, 0x00,
    ]);
    resp
}

pub fn intercept_dns(
    dns_payload: &[u8],
    req: &[u8],
    writer: TunWriter,
    prot_clone: Arc<dyn VpnProtector>,
) -> bool {
    let mut blocked = false;
    let mut domain_for_mark = String::new();
    if let Some(domain) = extract_dns_qname(dns_payload) {
        if let Some(engine) = crate::engine_host::GLOBAL_HOST_ENGINE.get() {
            let result = engine.should_block(domain.clone());
            if result.decision != crate::engine_host::BlockDecision::Allow {
                log::info!("🛡️ [DNS拦截] 阻断 {}: {}", domain, result.reason);
                let block_resp = build_block_dns_response(dns_payload);
                let resp_pkt = build_udp_dns_response(req, &block_resp, false);
                writer.write(resp_pkt);
                blocked = true;
            }
        }
        domain_for_mark = domain;
    }

    if blocked { return true; }

    let domain_clone = domain_for_mark;
    let dns_payload_vec = dns_payload.to_vec();
    let req_vec = req.to_vec();
    tokio::spawn(async move {
        let socket = tokio::net::UdpSocket::bind("0.0.0.0:0").await.unwrap();
        let fd = socket.as_raw_fd();
        if !prot_clone.protect_fd(fd) {
            log::error!("❌ DNS 上游 Socket protect 失败");
            if !domain_clone.is_empty() { crate::policy_rules::mark_failed(&domain_clone); }
            return;
        }

        let dns_server = "223.5.5.5:53";
        let _ = socket.send_to(&dns_payload_vec, dns_server).await;
        let mut resp_buf = [0u8; 1500];

        let recv_res = tokio::time::timeout(std::time::Duration::from_secs(2), socket.recv_from(&mut resp_buf)).await;
        if let Ok(Ok((n, _))) = recv_res {
            let resp_pkt = build_udp_dns_response(&req_vec, &resp_buf[..n], false);
            log::info!("📤 返回 IPv4 DNS 响应包，长度: {} 字节", resp_pkt.len());
            writer.write(resp_pkt);
        } else {
            log::error!("⏰ DNS 上游查询超时");
            if !domain_clone.is_empty() { crate::policy_rules::mark_failed(&domain_clone); }
        }
    });
    false
}
