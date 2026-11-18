use std::os::unix::io::AsRawFd;
use bytes::Bytes;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::mpsc;
use crate::VpnProtector;
use super::listener_pool::needs_more_for_sni;
use super::utils::extract_sni;

pub struct PendingWrite {
    pub data: Vec<u8>,
    pub offset: usize
}

pub struct ConnectionState {
    pub tx_to_proxy: mpsc::Sender<Bytes>,
    pub rx_from_proxy: mpsc::Receiver<Bytes>,
    pub pending_writes: std::collections::VecDeque<PendingWrite>,
    pub pending_rx: std::collections::VecDeque<Bytes>,
    pub is_aborted: bool,
}

/// 将臃肿的代理/直连逻辑抽离到此处
pub fn spawn_proxy_task(
    ip_str: String,
    target_port: u16,
    mut rx_from_tun: mpsc::Receiver<Bytes>,
    tx_to_tun: mpsc::Sender<Bytes>,
    prot_clone: Arc<dyn VpnProtector>,
) {
    tokio::spawn(async move {
        let mut first_chunk = Vec::new();
        let target_domain = loop {
            let timeout_res = tokio::time::timeout(tokio::time::Duration::from_millis(2000), rx_from_tun.recv()).await;
            match timeout_res {
                Ok(Some(data)) => {
                    first_chunk.extend_from_slice(&data);
                    if !needs_more_for_sni(&first_chunk) { break String::new(); }
                    if let Some(domain) = extract_sni(&first_chunk) { break domain; }
                    if first_chunk.len() > 16384 { break String::new(); }
                }
                _ => break String::new(),
            }
        };

        let is_mitm_enabled = crate::vpn::engine::MITM_ENABLED.load(std::sync::atomic::Ordering::Relaxed);
        if target_domain.is_empty() || !is_mitm_enabled || crate::policy_rules::should_bypass_mitm(&target_domain) {
            log::warn!("🛡️ [Bypass] 域名 {} 准备直连 {}:{}", target_domain, ip_str, target_port);
            let target_addr = format!("{}:{}", ip_str, target_port);
            let is_ipv6 = target_addr.contains(':') && target_addr.starts_with('[');

            let socket = match if is_ipv6 { tokio::net::TcpSocket::new_v6() } else { tokio::net::TcpSocket::new_v4() } {
                Ok(s) => s,
                Err(e) => { log::error!("❌ 创建 socket 失败: {}", e); return; }
            };
            let fd = socket.as_raw_fd();

            if !prot_clone.protect_fd(fd) { log::error!("❌ protect fd 失败, fd={}", fd); return; }

            let mut real_conn = match tokio::time::timeout(
                std::time::Duration::from_secs(5),
                socket.connect(match target_addr.parse::<std::net::SocketAddr>() {
                    Ok(a) => a,
                    Err(e) => { log::error!("❌ 地址解析失败: {}", e); return; }
                })
            ).await {
                Ok(Ok(c)) => c,
                Ok(Err(e)) => { log::error!("❌ 直连失败: {}", e); return; },
                Err(_) => { log::error!("❌ 直连超时，放弃连接"); return; }
            };

            if !first_chunk.is_empty() {
                if real_conn.write_all(&first_chunk).await.is_err() { return; }
            }

            let (mut pr, mut pw) = tokio::io::split(real_conn);
            let send_task = async move {
                while let Some(data) = rx_from_tun.recv().await {
                    if pw.write_all(&data).await.is_err() { break; }
                }
                let _ = pw.shutdown().await;
            };
            let recv_task = async move {
                let mut buf = vec![0u8; 65535];
                loop {
                    match pr.read(&mut buf).await {
                        Ok(0) => break,
                        Ok(n) => { if tx_to_tun.send(Bytes::copy_from_slice(&buf[..n])).await.is_err() { break; } }
                        Err(_) => break,
                    }
                }
            };
            tokio::join!(send_task, recv_task);
            return;
        }

        // MitM 代理逻辑
        let proxy_addr = format!("127.0.0.1:{}", crate::mitm_proxy::get_proxy_port());
        let mut proxy_conn = match tokio::net::TcpStream::connect(&proxy_addr).await {
            Ok(c) => c,
            Err(e) => { log::error!("❌ 连接本地 MitM 代理失败: {}", e); return; }
        };

        let connect_req = format!("CONNECT {}:{} HTTP/1.1\r\nHost: {}:{}\r\n\r\n", ip_str, target_port, ip_str, target_port);
        if proxy_conn.write_all(connect_req.as_bytes()).await.is_err() { return; }
        if !first_chunk.is_empty() {
            if proxy_conn.write_all(&first_chunk).await.is_err() { return; }
        }

        let (mut pr, mut pw) = tokio::io::split(proxy_conn);
        let send_task = async move {
            while let Some(data) = rx_from_tun.recv().await {
                if pw.write_all(&data).await.is_err() { break; }
            }
            let _ = pw.shutdown().await;
        };
        let recv_task = async move {
            let mut buf = vec![0u8; 65535];
            loop {
                match pr.read(&mut buf).await {
                    Ok(0) => break,
                    Ok(n) => { if tx_to_tun.send(Bytes::copy_from_slice(&buf[..n])).await.is_err() { break; } }
                    Err(_) => break,
                }
            }
        };
        tokio::join!(send_task, recv_task);
    });
}
