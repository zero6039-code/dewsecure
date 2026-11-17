use std::os::unix::io::AsRawFd;
use std::sync::{Arc, Mutex};
use std::sync::OnceLock;
use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use crate::VpnProtector;
use super::device::TunWriter;

type UdpSessionKey = (Ipv4Addr, u16, Ipv4Addr, u16);
static UDP_SESSIONS: OnceLock<Mutex<HashMap<UdpSessionKey, Arc<tokio::net::UdpSocket>>>> = OnceLock::new();
pub fn get_udp_sessions() -> &'static Mutex<HashMap<UdpSessionKey, Arc<tokio::net::UdpSocket>>> {
    UDP_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn ipv4_checksum(header: &[u8]) -> u16 {
    let mut sum: u32 = 0;
    let mut i = 0;
    while i + 1 < header.len() {
        sum += ((header[i] as u32) << 8) | header[i + 1] as u32;
        i += 2;
    }
    if i < header.len() {
        sum += (header[i] as u32) << 8;
    }
    while (sum >> 16) != 0 {
        sum = (sum & 0xFFFF) + (sum >> 16);
    }
    !(sum as u16)
}

pub fn parse_ipv4_udp(pkt: &[u8]) -> Option<(Ipv4Addr, u16, Ipv4Addr, u16, usize, usize)> {
    if pkt.len() < 28 || (pkt[0] >> 4) != 4 { return None; }
    let ihl = ((pkt[0] & 0x0F) as usize) * 4;
    if ihl < 20 || pkt.len() < ihl + 8 { return None; }
    if pkt[9] != 17 { return None; }
    let src_ip = Ipv4Addr::new(pkt[12], pkt[13], pkt[14], pkt[15]);
    let dst_ip = Ipv4Addr::new(pkt[16], pkt[17], pkt[18], pkt[19]);
    let src_port = u16::from_be_bytes([pkt[ihl], pkt[ihl + 1]]);
    let dst_port = u16::from_be_bytes([pkt[ihl + 2], pkt[ihl + 3]]);
    let udp_len = u16::from_be_bytes([pkt[ihl + 4], pkt[ihl + 5]]) as usize;
    if udp_len < 8 || ihl + udp_len > pkt.len() { return None; }
    Some((src_ip, src_port, dst_ip, dst_port, ihl + 8, ihl + udp_len))
}

pub fn build_ipv4_udp_response(original: &[u8], payload: &[u8]) -> Option<Vec<u8>> {
    if original.len() < 28 { return None; }
    let ihl = ((original[0] & 0x0F) as usize) * 4;
    if original.len() < ihl + 8 { return None; }
    let mut resp = vec![0u8; 20 + 8 + payload.len()];
    resp[0] = 0x45;
    let total_len = (20 + 8 + payload.len()) as u16;
    resp[2] = (total_len >> 8) as u8;
    resp[3] = total_len as u8;
    resp[8] = 64;
    resp[9] = 17;
    resp[12..16].copy_from_slice(&original[16..20]);
    resp[16..20].copy_from_slice(&original[12..16]);
    let cksum = ipv4_checksum(&resp[0..20]);
    resp[10] = (cksum >> 8) as u8;
    resp[11] = cksum as u8;
    resp[20..22].copy_from_slice(&original[ihl + 2..ihl + 4]);
    resp[22..24].copy_from_slice(&original[ihl..ihl + 2]);
    let udp_len = (8 + payload.len()) as u16;
    resp[24] = (udp_len >> 8) as u8;
    resp[25] = udp_len as u8;
    resp[28..].copy_from_slice(payload);
    Some(resp)
}

pub fn handle_udp_forward(
    original_pkt: Vec<u8>,
    src_ip: Ipv4Addr,
    src_port: u16,
    dst_ip: Ipv4Addr,
    dst_port: u16,
    payload: Vec<u8>,
    protector: Arc<dyn VpnProtector>,
    tx_writer: TunWriter,
) {
    let key = (src_ip, src_port, dst_ip, dst_port);
    let existing = {
        let guard = get_udp_sessions().lock().unwrap();
        guard.get(&key).cloned()
    };
    if let Some(sock) = existing {
        tokio::spawn(async move {
            let _ = sock.send_to(&payload, SocketAddr::V4(SocketAddrV4::new(dst_ip, dst_port))).await;
        });
        return;
    }
    tokio::spawn(async move {
        let sock = match tokio::net::UdpSocket::bind("0.0.0.0:0").await {
            Ok(s) => s,
            Err(e) => { log::error!("UDP bind 失败: {}", e); return; }
        };
        let fd = sock.as_raw_fd();
        if !protector.protect_fd(fd) {
            log::error!("❌ UDP socket protect 失败");
            return;
        }
        let sock = Arc::new(sock);
        {
            let mut guard = get_udp_sessions().lock().unwrap();
            if guard.len() > 2048 { guard.clear(); }
            guard.insert(key, sock.clone());
        }
        let _ = sock.send_to(&payload, SocketAddr::V4(SocketAddrV4::new(dst_ip, dst_port))).await;
        let mut buf = vec![0u8; 65535];
        loop {
            let timeout = std::time::Duration::from_secs(30);
            match tokio::time::timeout(timeout, sock.recv_from(&mut buf)).await {
                Ok(Ok((n, _))) => {
                    if let Some(resp) = build_ipv4_udp_response(&original_pkt, &buf[..n]) {
                        tx_writer.write(resp);
                    }
                }
                _ => break,
            }
        }
        get_udp_sessions().lock().unwrap().remove(&key);
    });
}
