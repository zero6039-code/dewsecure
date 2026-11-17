use std::os::unix::io::{AsRawFd, RawFd};
use tokio::io::unix::AsyncFd;
use smoltcp::phy::{Device, DeviceCapabilities, Medium, RxToken, TxToken};
use smoltcp::time::Instant;
use std::sync::{Arc, Mutex};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use log::{info, error};
use super::dns::extract_udp_dns;
use crate::VpnProtector;
use tokio::sync::mpsc;
use std::sync::OnceLock;
use std::collections::HashSet;
use super::udp_forwarder;
use super::dns_interceptor;

pub static PENDING_TCP_PORTS: OnceLock<Mutex<HashSet<u16>>> = OnceLock::new();
pub fn get_pending_tcp_ports() -> &'static Mutex<HashSet<u16>> {
    PENDING_TCP_PORTS.get_or_init(|| Mutex::new(HashSet::new()))
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
    tx: mpsc::Sender<Vec<u8>>,
}

impl TunWriter {
    pub fn new(fd: RawFd) -> Self {
        let (tx, mut rx) = mpsc::channel::<Vec<u8>>(1024);

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
        if self.tx.try_send(buf).is_err() {
                static DROP_COUNT: AtomicUsize = AtomicUsize::new(0);
                DROP_COUNT.fetch_add(1, Ordering::Relaxed);
            }
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

                if is_ipv6 {
                    log::info!("📡 收到 IPv6 DNS 请求，直接放行/丢弃，防止卡死");
                    continue;
                }

                // 统一交由 dns_interceptor 模块处理
                dns_interceptor::intercept_dns(&dns_payload, &req, writer, prot_clone);
                continue;
            }
            
            // A-02: IPv4 UDP 非 DNS 透明转发
            if pkt.len() >= 20 && (pkt[0] >> 4) == 4 && pkt[9] == 17 {
                if let Some((src_ip, src_port, dst_ip, dst_port, payload_start, payload_end)) = udp_forwarder::parse_ipv4_udp(&pkt) {
                    if dst_port != 53 {
                        let payload = pkt[payload_start..payload_end].to_vec();
                        udp_forwarder::handle_udp_forward(pkt.clone(), src_ip, src_port, dst_ip, dst_port, payload, self.protector.clone(), self.tx_writer.clone());
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
