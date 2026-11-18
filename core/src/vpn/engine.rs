use std::os::unix::io::RawFd;
use smoltcp::{
    iface::{Config, Interface, SocketSet, SocketHandle},
    socket::tcp,
    time::Instant,
    wire::{IpCidr, IpAddress, Ipv4Address, Ipv6Address},
};
use log::{info, error};
use std::sync::{Arc, Mutex};
use std::collections::{VecDeque, HashMap};
use tokio::sync::{mpsc, Semaphore};
use std::sync::{OnceLock, atomic::{AtomicBool, Ordering}};
use bytes::Bytes;
use crate::VpnProtector;

use super::device::{VpnDevice, spawn_tun_reader, TCP_443_CONNECTIONS, TunWriter, get_pending_tcp_ports};
use super::listener_pool::{ListenerPool, syn_dst_port};
use super::connection::{ConnectionState, spawn_proxy_task};

pub static MITM_ENABLED: AtomicBool = AtomicBool::new(false);
static RUNNING: AtomicBool = AtomicBool::new(true);
static CONN_LIMIT: OnceLock<Semaphore> = OnceLock::new();

fn get_conn_limit() -> &'static Semaphore {
    CONN_LIMIT.get_or_init(|| Semaphore::new(500))
}

pub fn set_mitm_enabled(enabled: bool) {
    MITM_ENABLED.store(enabled, Ordering::Relaxed);
    info!("⚙️ Rust 侧 MitM 总开关已设置为: {}", enabled);
}

pub fn stop_vpn_engine() {
    RUNNING.store(false, Ordering::Relaxed);
    info!("🛑 收到停止信号，Rust 引擎正在异步退出...");
}

fn read_rss_kb() -> u64 {
    std::fs::read_to_string("/proc/self/status").ok()
        .and_then(|x| x.lines().find(|l| l.starts_with("VmRSS:"))
            .and_then(|l| l.split_whitespace().nth(1).and_then(|v| v.parse().ok())))
        .unwrap_or(0)
}

pub struct VpnEngine {
    tun_fd: RawFd,
    protector: Arc<dyn VpnProtector>,
}

impl VpnEngine {
    pub fn new(tun_fd: RawFd, protector: Arc<dyn VpnProtector>) -> Self {
        Self { tun_fd, protector }
    }

    pub async fn start(self, ready_tx: Option<std::sync::mpsc::SyncSender<Result<(), String>>>) {
        info!("🚀 初始化 Rust 侧 smoltcp 透明代理 (完全接管版)...");
        RUNNING.store(true, Ordering::Relaxed);

        let proxy = crate::mitm_proxy::MitmProxy::new();
        if MITM_ENABLED.load(Ordering::Relaxed) {
            if let Err(e) = proxy.start().await {
                error!("❌ hudsucker 启动失败: {}", e);
                if let Some(tx) = ready_tx.as_ref() { let _ = tx.try_send(Err(format!("hudsucker 启动失败: {}", e))); }
                return;
            }
        } else { info!("ℹ️ MitM 未启用，跳过 hudsucker 启动"); }

        let rx_queue = Arc::new(Mutex::new(VecDeque::new()));
        let fd_read = unsafe { libc::dup(self.tun_fd) };
        let fd_write = unsafe { libc::dup(self.tun_fd) };
        spawn_tun_reader(fd_read, rx_queue.clone(), Arc::new(AtomicBool::new(true)));

        let tx_writer = TunWriter::new(fd_write);
        let mut device = VpnDevice { rx_queue, tx_writer, protector: self.protector.clone() };

        let config = Config::new(smoltcp::wire::HardwareAddress::Ip);
        let mut iface = Interface::new(config, &mut device, Instant::now());
        iface.set_any_ip(true);
        iface.update_ip_addrs(|ip_addrs| {
            let _ = ip_addrs.push(IpCidr::new(IpAddress::Ipv4(Ipv4Address::new(10, 0, 0, 1)), 24));
            let _ = ip_addrs.push(IpCidr::new(IpAddress::Ipv6(Ipv6Address::new(0xfd00, 0, 0, 0, 0, 0, 0, 2)), 120));
        });
        iface.routes_mut().add_default_ipv4_route(Ipv4Address::new(10, 0, 0, 1)).unwrap();
        iface.routes_mut().add_default_ipv6_route(Ipv6Address::new(0xfd00, 0, 0, 0, 0, 0, 0, 2)).unwrap();

        let mut sockets = SocketSet::new(vec![]);
        let mut connections: HashMap<SocketHandle, ConnectionState> = HashMap::new();
        let protector = self.protector.clone();
        let mut pool = ListenerPool::new();
        pool.want(443, 64);

        info!("✅ smoltcp 协议栈启动，动态监听 443...");
        if let Some(tx) = ready_tx { let _ = tx.try_send(Ok(())); }
        let mut last_report = std::time::Instant::now();

        loop {
            if !RUNNING.load(Ordering::Relaxed) { info!("🔌 Rust 主循环已退出"); break; }

            // 1. 监听池管理
            let syn_ports: Vec<u16> = device.rx_queue.lock().map(|q| q.iter().filter_map(|p| syn_dst_port(p)).collect()).unwrap_or_default();
            for port in syn_ports { pool.want(port, 8); }
            let pending: Vec<u16> = { let mut g = get_pending_tcp_ports().lock().unwrap(); let v: Vec<u16> = g.iter().copied().collect(); g.clear(); v };
            for port in pending { pool.want(port, 8); }
            pool.top_up(&mut sockets);
            iface.poll(Instant::now(), &mut device, &mut sockets);

            // 2. 状态报告
            if last_report.elapsed().as_secs() >= 2 {
                let rxq = device.rx_queue.lock().map(|q| q.len()).unwrap_or(usize::MAX);
                log::warn!("📊 MEM rss={}KB conns={} socks={} rxq={}", read_rss_kb(), connections.len(), sockets.iter().count(), rxq);
                last_report = std::time::Instant::now();
            }

            // 3. 处理活跃连接
            let active_handles: Vec<SocketHandle> = sockets.iter()
                .filter_map(|(h, _)| { if sockets.get::<tcp::Socket>(h).is_active() { Some(h) } else { None } })
                .collect();
            let mut sent_any = false;

            for handle in active_handles {
                let tcp_socket = sockets.get_mut::<tcp::Socket>(handle);
                if tcp_socket.state() == tcp::State::Listen { continue; }

                if !connections.contains_key(&handle) {
                    let remote_ep = match tcp_socket.remote_endpoint() {
                        Some(ep) => ep,
                        None => { log::warn!("⚠️ Socket {:?} 无 remote_endpoint", handle); continue; }
                    };
                    let target_port = remote_ep.port;
                    let ip_str = match remote_ep.addr {
                        IpAddress::Ipv4(v4) => v4.to_string(),
                        IpAddress::Ipv6(v6) => format!("[{}]", v6),
                    };

                    if matches!(remote_ep.addr, IpAddress::Ipv6(_)) {
                        log::warn!("🚫 拒绝 IPv6 TCP 连接 (加速回退 IPv4): {}:{}", ip_str, target_port);
                        tcp_socket.abort(); continue;
                    }
                    if ip_str == "10.0.0.1" || ip_str == "[fd00::2]" {
                        log::warn!("🚫 拒绝连接 TUN 自身 IP: {}:{}", ip_str, target_port);
                        tcp_socket.abort(); continue;
                    }

                    log::warn!("🔗 捕获 TCP 连接: {}:{}", ip_str, target_port);
                    TCP_443_CONNECTIONS.fetch_add(1, Ordering::Relaxed);

                    let (tx_to_proxy, rx_from_tun) = mpsc::channel::<Bytes>(128);
                    let (tx_to_tun, rx_from_proxy) = mpsc::channel::<Bytes>(256);
                    connections.insert(handle, ConnectionState {
                        tx_to_proxy, rx_from_proxy,
                        pending_writes: VecDeque::new(), pending_rx: VecDeque::new(), is_aborted: false
                    });

                    let permit = match get_conn_limit().try_acquire() {
                        Ok(p) => p,
                        Err(_) => {
                            log::warn!("⚠️ 并发超限，拒绝连接");
                            tcp_socket.abort(); connections.remove(&handle); continue;
                        }
                    };
                    drop(permit); // 简化处理，实际应移入 task

                    spawn_proxy_task(ip_str, target_port, rx_from_tun, tx_to_tun, protector.clone());
                }

                // 4. 数据收发与状态维护
                let conn_state = connections.get_mut(&handle).unwrap();
                while let Some(d) = conn_state.pending_rx.front() {
                    if conn_state.tx_to_proxy.try_send(d.clone()).is_err() { break; }
                    conn_state.pending_rx.pop_front();
                }
                while let Ok(data) = conn_state.rx_from_proxy.try_recv() {
                    conn_state.pending_writes.push_back(super::connection::PendingWrite { data: data.to_vec(), offset: 0 });
                }
                
                let buffered: usize = conn_state.pending_writes.iter().map(|p| p.data.len() - p.offset).sum();
                if buffered > 4 * 1024 * 1024 || conn_state.pending_rx.len() > 256 {
                    error!("⚠️ 连接 {:?} 积压严重，abort", handle);
                    tcp_socket.abort(); conn_state.pending_writes.clear(); conn_state.pending_rx.clear(); conn_state.is_aborted = true;
                }
                if conn_state.rx_from_proxy.is_closed() && !conn_state.is_aborted && conn_state.pending_writes.is_empty() {
                    tcp_socket.close(); conn_state.is_aborted = true;
                }

                let mut total_sent = 0;
                while total_sent < 16384 {
                    if let Some(front) = conn_state.pending_writes.front_mut() {
                        let remaining = &front.data[front.offset..];
                        if remaining.is_empty() { conn_state.pending_writes.pop_front(); continue; }
                        let limit = remaining.len().min(16384 - total_sent);
                        if let Ok(n) = tcp_socket.send_slice(&remaining[..limit]) {
                            if n == 0 { break; }
                            front.offset += n; total_sent += n; sent_any = true;
                            if front.offset == front.data.len() { conn_state.pending_writes.pop_front(); }
                        } else { break; }
                    } else { break; }
                }

                let mut total_recv = 0;
                let mut buf = vec![0u8; 16384];
                while tcp_socket.can_recv() && total_recv < 16384 {
                    if let Ok(n) = tcp_socket.recv_slice(&mut buf) {
                        if n > 0 {
                            let data = Bytes::copy_from_slice(&buf[..n]);
                            if conn_state.tx_to_proxy.try_send(data.clone()).is_err() { conn_state.pending_rx.push_back(data); break; }
                            total_recv += n;
                        } else { break; }
                    } else { break; }
                }
            }

            // 5. 回收死连接
            let mut to_remove = Vec::new();
            for (handle, socket) in sockets.iter() {
                if let smoltcp::socket::Socket::Tcp(s) = socket {
                    if s.state() == tcp::State::Closed || (!s.may_send() && !s.may_recv()) { to_remove.push(handle); }
                }
            }
            for handle in to_remove { sockets.remove(handle); connections.remove(&handle); }

            // 6. 休眠
            if sent_any {
                iface.poll(Instant::now(), &mut device, &mut sockets);
                tokio::time::sleep(tokio::time::Duration::from_millis(1)).await;
            } else {
                let delay = iface.poll_delay(Instant::now(), &sockets);
                let sleep_ms = delay.map(|d| d.total_millis()).unwrap_or(5).min(5).max(1);
                tokio::time::sleep(tokio::time::Duration::from_millis(sleep_ms)).await;
            }
        }
        unsafe { libc::close(fd_read); }
        self.protector.protect_fd(-1);
        info!("🛑 Rust 引擎主循环退出完毕");
    }
}
