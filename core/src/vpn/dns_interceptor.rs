use std::os::unix::io::AsRawFd;
use std::sync::Arc;
use crate::VpnProtector;
use super::device::TunWriter;
use super::dns::build_udp_dns_response;

async fn query_upstream(
    payload: &[u8],
    prot: &std::sync::Arc<dyn crate::VpnProtector>,
    server: std::net::SocketAddr,
) -> Result<Vec<u8>, String> {
    if payload.len() < 12 { return Err("query too short".into()); }
    let socket = tokio::net::UdpSocket::bind("0.0.0.0:0").await.map_err(|e| format!("bind: {e}"))?;
    if !prot.protect_fd(socket.as_raw_fd()) { return Err("protect_fd returned false".into()); }
    socket.connect(server).await.map_err(|e| format!("connect {server}: {e}"))?;
    socket.send(payload).await.map_err(|e| format!("send {server}: {e}"))?;
    let mut buf = vec![0u8; 4096];
    let n = tokio::time::timeout(std::time::Duration::from_millis(1500), socket.recv(&mut buf))
        .await
        .map_err(|_| format!("timeout {server} (local {:?})", socket.local_addr().ok()))?
        .map_err(|e| format!("recv {server}: {e}"))?;
    buf.truncate(n);
    if n < 12 || buf[0..2] != payload[0..2] || buf[2] & 0x80 == 0 {
        return Err(format!("invalid response from {server}"));
    }
    Ok(buf)
}

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
    is_ipv6: bool, // 🌟 新增：传递真实的 IP 版本
) -> bool {
    log::warn!("🚨 [ENTRY] intercept_dns called, payload_len={}", dns_payload.len());
    let mut blocked = false;
    let mut domain_for_mark = String::new();
    if let Some(domain) = extract_dns_qname(dns_payload) {
        if let Some(engine) = crate::engine_host::GLOBAL_HOST_ENGINE.get() {
            let result = engine.should_block(domain.clone());
            if result.decision != crate::engine_host::BlockDecision::Allow {
                log::info!("🛡️ [DNS拦截] 阻断 {}: {}", domain, result.reason);
                let block_resp = build_block_dns_response(dns_payload);
                let resp_pkt = build_udp_dns_response(req, &block_resp, is_ipv6); // 🌟 修复：阻断响应也需正确 IP 版本
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
        let servers = [
            std::net::SocketAddr::from(([1, 1, 1, 1], 53)),
            std::net::SocketAddr::from(([8, 8, 8, 8], 53)),
            std::net::SocketAddr::from(([223, 5, 5, 5], 53)),
        ];
        
        let mut last_err = String::new();
        let mut success = false;
        
        for server in servers {
            match query_upstream(&dns_payload_vec, &prot_clone, server).await {
                Ok(resp_buf) => {
                    let resp_pkt = build_udp_dns_response(&req_vec, &resp_buf, is_ipv6);
                    log::warn!("📤 成功返回 DNS 响应 (上游: {}), 长度: {} 字节", server, resp_pkt.len());
                    writer.write(resp_pkt);
                    success = true;
                    break;
                }
                Err(e) => {
                    last_err = format!("{} | {}", last_err, e);
                    log::warn!("⚠️ DNS 上游 {} 失败: {}", server, e);
                }
            }
        }
        
        if !success {
            log::error!("❌ DNS 全部上游失败 [{}]. 域名: {}", last_err.trim_start_matches(" | "), domain_clone);
            if !domain_clone.is_empty() { crate::policy_rules::mark_failed(&domain_clone); }
        }
    });
    false
}
