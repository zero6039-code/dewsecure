use std::os::unix::io::{AsRawFd, RawFd};
use tokio::io::unix::AsyncFd;
use smoltcp::phy::{Device, DeviceCapabilities, Medium, RxToken, TxToken};
use smoltcp::time::Instant;
use std::sync::{Arc, Mutex};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use log::info;
use super::dns::{extract_udp_dns, build_udp_dns_response};

pub static TUN_RX_PACKETS: AtomicUsize = AtomicUsize::new(0);
pub static DEVICE_RX_PACKETS: AtomicUsize = AtomicUsize::new(0);
pub static TCP_SYN_PACKETS: AtomicUsize = AtomicUsize::new(0);
pub static TCP_443_CONNECTIONS: AtomicUsize = AtomicUsize::new(0);
pub static DNS_INTERCEPTED: AtomicUsize = AtomicUsize::new(0);

pub struct TunFd(pub RawFd);
impl AsRawFd for TunFd {
    fn as_raw_fd(&self) -> RawFd { self.0 }
}

pub struct VpnDevice {
    pub rx_queue: Arc<Mutex<VecDeque<Vec<u8>>>>,
    pub tx_fd: RawFd,
}

pub struct VpnRxToken(Vec<u8>);
impl RxToken for VpnRxToken {
    fn consume<R, F>(self, f: F) -> R where F: FnOnce(&mut [u8]) -> R {
        let mut buf = self.0;
        f(&mut buf)
    }
}

pub struct VpnTxToken(RawFd);
impl TxToken for VpnTxToken {
    fn consume<R, F>(self, len: usize, f: F) -> R where F: FnOnce(&mut [u8]) -> R {
        let mut buf = vec![0u8; len];
        let result = f(&mut buf);
        let written = unsafe { libc::write(self.0, buf.as_ptr() as *const libc::c_void, buf.len()) };
        if written < 0 {
            let err = std::io::Error::last_os_error();
            if err.raw_os_error() != Some(libc::EAGAIN) {
                log::error!("❌ TUN 写入失败: {}", err);
            }
        } else if (written as usize) < len {
            log::error!("❌ TUN 部分写入: {}/{}", written, len);
        }
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
                let tx = self.tx_fd;
                let req = pkt.clone();
                tokio::spawn(async move {
                    let bind_addr = if is_ipv6 { "[::]:0" } else { "0.0.0.0:0" };
                    let socket = tokio::net::UdpSocket::bind(bind_addr).await.unwrap();
                    let dns_server = if is_ipv6 { "[2400:3200::1]:53" } else { "223.5.5.5:53" };
                    let _ = socket.send_to(&dns_payload, dns_server).await;
                    let mut resp_buf = [0u8; 1500];
                    if let Ok((n, _)) = socket.recv_from(&mut resp_buf).await {
                        let resp_pkt = build_udp_dns_response(&req, &resp_buf[..n], is_ipv6);
                        unsafe { libc::write(tx, resp_pkt.as_ptr() as *const libc::c_void, resp_pkt.len()); }
                    }
                });
                continue;
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
                if (flags & 0x02) != 0 { TCP_SYN_PACKETS.fetch_add(1, Ordering::Relaxed); }
            }
        }
        Some((VpnRxToken(pkt), VpnTxToken(self.tx_fd)))
    }

    fn transmit(&mut self, _timestamp: Instant) -> Option<Self::TxToken<'_>> {
        Some(VpnTxToken(self.tx_fd))
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
