use std::os::unix::io::{AsRawFd, RawFd};
use tokio::io::unix::AsyncFd;
use smoltcp::phy::{Device, DeviceCapabilities, Medium, RxToken, TxToken};
use smoltcp::time::Instant;
use std::sync::{Arc, Mutex};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use log::{info, error};
use super::dns::{extract_udp_dns, build_udp_dns_response};
use crate::VpnProtector;
use tokio::sync::mpsc;
use std::sync::OnceLock;
use std::collections::{HashMap, HashSet};
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};

pub static PENDING_TCP_PORTS: OnceLock<Mutex<HashSet<u16>>> = OnceLock::new();
pub fn get_pending_tcp_ports() -> &'static Mutex<HashSet<u16>> {
    PENDING_TCP_PORTS.get_or_init(|| Mutex::new(HashSet::new()))
}

type UdpSessionKey = (Ipv4Addr, u16, Ipv4Addr, u16);
static UDP_SESSIONS: OnceLock<Mutex<HashMap<UdpSessionKey, Arc<tokio::net::UdpSocket>>>> = OnceLock::new();
fn get_udp_sessions() -> &'static Mutex<HashMap<UdpSessionKey, Arc<tokio::net::UdpSocket>>> {
    UDP_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn ipv4_checksum(header: &[u8]) -> u16 {
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

fn parse_ipv4_udp(pkt: &[u8]) -> Option<(Ipv4Addr, u16, Ipv4Addr, u16, usize, usize)> {
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

fn build_ipv4_udp_response(original: &[u8], payload: &[u8]) -> Option<Vec<u8>> {
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

fn handle_udp_forward(
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




fn extract_dns_qname(payload: &[u8]) -> Option<String> {
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

fn build_block_dns_response(request: &[u8]) -> Vec<u8> {
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

pub static TUN_RX_PACKETS: AtomicUsize = AtomicUsize::new(0);
pub static DEVICE_RX_PACKETS: AtomicUsize = AtomicUsize::new(0);
pub static TCP_SYN_PACKETS: AtomicUsize = AtomicUsize::new(0);
pub static TCP_443_CONNECTIONS: AtomicUsize = AtomicUsize::new(0);
pub static DNS_INTERCEPTED: AtomicUsize = AtomicUsize::new(0);

pub struct TunFd(pub RawFd);
impl AsRawFd for TunFd {
    fn as_raw_fd(&self) -> RawFd { self.0 }
}

#[derive(Clone)]
pub struct TunWriter {
    tx: mpsc::UnboundedSender<Vec<u8>>,
}

impl TunWriter {
    pub fn new(fd: RawFd) -> Self {
        let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
        
        // 启动独立的阻塞写线程，彻底释放 smoltcp 主循环
        std::thread::spawn(move || {
            while let Some(buf) = rx.blocking_recv() {
                let mut written = 0;
                let buf_len = buf.len();
                while written < buf_len {
                    let n = unsafe {
                        libc::write(
                            fd,
                            buf[written..].as_ptr() as *const libc::c_void,
                            buf_len - written,
                        )
                    };
                    if n < 0 {
                        let err = std::io::Error::last_os_error();
                        if err.raw_os_error() != Some(libc::EAGAIN) {
                            error!("❌ TUN 独立写入线程失败: {}", err);
                            break;
                        }
                        std::thread::sleep(std::time::Duration::from_millis(1));
                        continue;
                    }
                    written += n as usize;
                }
            }
            unsafe { libc::close(fd); }
        });
        
        Self { tx }
    }

    pub fn write(&self, buf: Vec<u8>) {
        let _ = self.tx.send(buf);
    }
}

pub struct VpnDevice {
    pub rx_queue: Arc<Mutex<VecDeque<Vec<u8>>>>,
    pub tx_writer: TunWriter,
    pub protector: Arc<dyn VpnProtector>,
}

pub struct VpnRxToken(Vec<u8>);
impl RxToken for VpnRxToken {
    fn consume<R, F>(self, f: F) -> R where F: FnOnce(&mut [u8]) -> R {
        let mut buf = self.0;
        f(&mut buf)
    }
}

pub struct VpnTxToken(TunWriter);
impl TxToken for VpnTxToken {
    fn consume<R, F>(self, len: usize, f: F) -> R where F: FnOnce(&mut [u8]) -> R {
        let mut buf = vec![0u8; len];
        let result = f(&mut buf);
        self.0.write(buf); // 瞬间推入无界通道，主循环立刻返回
        result
    }
}

impl Device for VpnDevice {
    type RxToken<'a> = VpnRxToken;
    type TxToken<'a> = VpnTxToken;

    fn receive(&mut self, _timestamp: Instant) -> Option<(Self::RxToken<'_>, Self::TxToken<'_>)> {
        let mut queue = self.rx_queue.lock().unwrap();
        let mut valid_pkt = None;
        while let Some(pkt) = queue.pop_front() {
            if let Some((dns_payload, is_ipv6)) = extract_udp_dns(&pkt) {
                DNS_INTERCEPTED.fetch_add(1, Ordering::Relaxed);
                let writer = self.tx_writer.clone();
                let req = pkt.clone();
                let prot_clone = self.protector.clone();
                
                // 专家修复：仅代理 IPv4 的 DNS，彻底放弃 IPv6 DNS，防止死锁
                if is_ipv6 {
                    log::info!("📡 收到 IPv6 DNS 请求，直接放行/丢弃，防止卡死");
                    continue;
                }

                // 尝试解析域名并执行拦截
                let mut blocked = false;
                if let Some(domain) = extract_dns_qname(&dns_payload) {
                    if let Some(engine) = crate::engine_host::GLOBAL_HOST_ENGINE.get() {
                        let result = engine.should_block(domain.clone());
                        if result.decision != crate::engine_host::BlockDecision::Allow {
                            log::info!("🛡️ [DNS拦截] 阻断 {}: {}", domain, result.reason);
                            let block_resp = build_block_dns_response(&dns_payload);
                            let resp_pkt = build_udp_dns_response(&req, &block_resp, false);
                            writer.write(resp_pkt);
                            blocked = true;
                        }
                    }
                }

                if blocked { continue; }

                tokio::spawn(async move {
                    let socket = tokio::net::UdpSocket::bind("0.0.0.0:0").await.unwrap();
                    let fd = socket.as_raw_fd();
                    if !prot_clone.protect_fd(fd) {
                        log::error!("❌ DNS 上游 Socket protect 失败");
                        return;
                    }

                    let dns_server = "223.5.5.5:53";
                    let _ = socket.send_to(&dns_payload, dns_server).await;
                    let mut resp_buf = [0u8; 1500];
                    
                    // 加超时，防止 DNS 线程永久卡死
                    let recv_res = tokio::time::timeout(std::time::Duration::from_secs(2), socket.recv_from(&mut resp_buf)).await;
                    if let Ok(Ok((n, _))) = recv_res {
                        let resp_pkt = build_udp_dns_response(&req, &resp_buf[..n], false);
                        log::info!("📤 返回 IPv4 DNS 响应包，长度: {} 字节", resp_pkt.len());
                        writer.write(resp_pkt);
                    } else {
                        log::error!("⏰ DNS 上游查询超时");
                    }
                });
                continue;
            }
            // A-02: IPv4 UDP 非 DNS 透明转发
            if pkt.len() >= 20 && (pkt[0] >> 4) == 4 && pkt[9] == 17 {
                if let Some((src_ip, src_port, dst_ip, dst_port, payload_start, payload_end)) = parse_ipv4_udp(&pkt) {
                    if dst_port != 53 {
                        let payload = pkt[payload_start..payload_end].to_vec();
                        handle_udp_forward(pkt.clone(), src_ip, src_port, dst_ip, dst_port, payload, self.protector.clone(), self.tx_writer.clone());
                        continue;
                    }
                }
            }
            // A-02: 记录非 443 TCP 目标端口，通知 engine.rs 惰性建 listener
            if pkt.len() >= 20 && (pkt[0] >> 4) == 4 && pkt[9] == 6 {
                let ihl = ((pkt[0] & 0x0F) as usize) * 4;
                if pkt.len() >= ihl + 14 {
                    let flags = pkt[ihl + 13];
                    if (flags & 0x02) != 0 {
                        let dst_port = u16::from_be_bytes([pkt[ihl + 2], pkt[ihl + 3]]);
                        if dst_port != 443 {
                            get_pending_tcp_ports().lock().unwrap().insert(dst_port);
                        }
                    }
                }
            }
valid_pkt = Some(pkt);
            break;
        }
        let pkt = valid_pkt?;
        DEVICE_RX_PACKETS.fetch_add(1, Ordering::Relaxed);
        if pkt.len() >= 20 && (pkt[0] >> 4) == 4 {
            let ihl = (pkt[0] & 0x0F) as usize * 4;
            if pkt[9] == 6 && pkt.len() >= ihl + 14 {
                let flags = pkt[ihl + 13];
                if (flags & 0x02) != 0 { 
                    TCP_SYN_PACKETS.fetch_add(1, Ordering::Relaxed); 
                    // 专家要求的 TUN 层 SYN 日志
                    let _src_port = u16::from_be_bytes([pkt[ihl], pkt[ihl + 1]]);
                    let dst_port = u16::from_be_bytes([pkt[ihl + 2], pkt[ihl + 3]]);
                    let dst_ip = format!("{}.{}.{}.{}", pkt[16], pkt[17], pkt[18], pkt[19]);
                    log::info!("📥 [TUN RX] 收到 SYN: 目标 {}:{}", dst_ip, dst_port);
                }
            }
        }
        Some((VpnRxToken(pkt), VpnTxToken(self.tx_writer.clone())))
    }

    fn transmit(&mut self, _timestamp: Instant) -> Option<Self::TxToken<'_>> {
        Some(VpnTxToken(self.tx_writer.clone()))
    }

    fn capabilities(&self) -> DeviceCapabilities {
        let mut caps = DeviceCapabilities::default();
        caps.medium = Medium::Ip;
        caps.max_transmission_unit = 1500;
        caps
    }
}

pub fn spawn_tun_reader(fd_read: RawFd, rx_queue: Arc<Mutex<VecDeque<Vec<u8>>>>, running: Arc<AtomicBool>) {
    unsafe {
        let flags = libc::fcntl(fd_read, libc::F_GETFL);
        libc::fcntl(fd_read, libc::F_SETFL, flags | libc::O_NONBLOCK);
    }
    let async_fd = unsafe { AsyncFd::register(TunFd(fd_read)) }.expect("创建 AsyncFd 失败");

    tokio::spawn(async move {
        let mut buf = vec![0u8; 1500];
        loop {
            if !running.load(Ordering::Relaxed) { break; }
            if let Ok(mut guard) = async_fd.readable().await {
                let _ = guard.try_io(|inner| {
                    let fd = inner.get_ref().as_raw_fd();
                    let n = unsafe { libc::read(fd, buf.as_mut_ptr() as *mut libc::c_void, buf.len()) };
                    if n < 0 { Err(std::io::Error::last_os_error()) } else { Ok(n as usize) }
                }).map(|res| {
                    if let Ok(n) = res {
                        if n > 0 {
                            TUN_RX_PACKETS.fetch_add(1, Ordering::Relaxed);
                            rx_queue.lock().unwrap().push_back(buf[..n].to_vec());
                        }
                    }
                });
            }
        }
        info!("🛑 TUN 读取线程已安全退出");
    });
}
