use std::os::unix::io::{RawFd, AsRawFd};
use smoltcp::iface::{Config, Interface, SocketSet, SocketHandle};
use smoltcp::socket::tcp;
use smoltcp::time::Instant;
use smoltcp::wire::{IpCidr, IpListenEndpoint, IpAddress, Ipv4Address, Ipv6Address};
use log::{info, error};
use std::sync::{Arc, Mutex};
use std::collections::{VecDeque, HashMap};
use tokio::sync::mpsc;
use bytes::Bytes;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use crate::VpnProtector;

use super::device::{VpnDevice, spawn_tun_reader, TCP_443_CONNECTIONS, TunWriter};
use super::utils::extract_sni;

static MITM_ENABLED: AtomicBool = AtomicBool::new(false);
static RUNNING: AtomicBool = AtomicBool::new(true);

pub fn set_mitm_enabled(enabled: bool) {
    MITM_ENABLED.store(enabled, Ordering::Relaxed);
    info!("⚙️ Rust 侧 MitM 总开关已设置为: {}", enabled);
}

pub fn stop_vpn_engine() {
    RUNNING.store(false, Ordering::Relaxed);
    info!("🛑 收到停止信号，Rust 引擎正在异步退出...");
}

struct PendingWrite { 
    data: Vec<u8>, 
    offset: usize 
}

struct ConnectionState {
    tx_to_proxy: mpsc::Sender<Bytes>,
    rx_from_proxy: mpsc::UnboundedReceiver<Bytes>,
    pending_writes: VecDeque<PendingWrite>,
    pending_rx: VecDeque<Bytes>,
    is_aborted: bool,
}

pub struct VpnEngine {
    tun_fd: RawFd,
    protector: Arc<dyn VpnProtector>,
}

impl VpnEngine {
    pub fn new(tun_fd: RawFd, protector: Arc<dyn VpnProtector>) -> Self { 
        Self { tun_fd, protector } 
    }

    pub async fn start(self) {
        info!("🚀 初始化 Rust 侧 smoltcp 透明代理 (完全接管版)...");
        RUNNING.store(true, Ordering::Relaxed);

        let proxy = crate::mitm_proxy::MitmProxy::new();
        if let Err(e) = proxy.start().await { 
            error!("❌ hudsucker 启动失败: {}", e); 
            return; 
        }

        let rx_queue = Arc::new(Mutex::new(VecDeque::new()));
        let fd_read = unsafe { libc::dup(self.tun_fd) };
        let fd_write = self.tun_fd; // 写端直接用原始 fd，由 TunWriter 接管
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
        
        // 专家核心配置：默认路由网关指向自身
        iface.routes_mut().add_default_ipv4_route(Ipv4Address::new(10, 0, 0, 1)).unwrap();
        iface.routes_mut().add_default_ipv6_route(Ipv6Address::new(0xfd00, 0, 0, 0, 0, 0, 0, 2)).unwrap();

        let mut sockets = SocketSet::new(vec![]);
        let mut connections: HashMap<SocketHandle, ConnectionState> = HashMap::new();
        let protector = self.protector.clone();

        info!("✅ smoltcp 协议栈启动，动态监听 443...");
        let mut last_report = std::time::Instant::now();

        loop {
            if !RUNNING.load(Ordering::Relaxed) {
                info!("🔌 Rust 主循环已退出");
                break;
            }
            
            // 1. 补充 Listener
            let mut listen_count = 0;
            for (_, socket) in sockets.iter() {
                if let smoltcp::socket::Socket::Tcp(s) = socket {
                    if s.state() == tcp::State::Listen { listen_count += 1; }
                }
            }
            
            for _ in listen_count..64 {
                let tcp_rx = tcp::SocketBuffer::new(vec![0u8; 65535]);
                let tcp_tx = tcp::SocketBuffer::new(vec![0u8; 65535]);
                let tcp_socket = tcp::Socket::new(tcp_rx, tcp_tx);
                let handle = sockets.add(tcp_socket);
                let socket = sockets.get_mut::<tcp::Socket>(handle);
                if let Err(e) = socket.listen(IpListenEndpoint { addr: None, port: 443 }) {
                    error!("监听 443 端口失败: {:?}", e);
                }
            }

            // 2. 核心 poll
            iface.poll(Instant::now(), &mut device, &mut sockets);

            // 3. 实时状态打印（每 2 秒）
            if last_report.elapsed().as_secs() >= 2 {
                for (h, s) in sockets.iter() {
                    if let smoltcp::socket::Socket::Tcp(socket) = s {
                        if socket.state() != tcp::State::Listen && socket.state() != tcp::State::Closed {
                            info!("🔍 Socket {:?} 状态: {:?}", h, socket.state());
                        }
                    }
                }
                last_report = std::time::Instant::now();
            }

            let active_handles: Vec<SocketHandle> = sockets.iter()
                .filter_map(|(h, _)| { if sockets.get::<tcp::Socket>(h).is_active() { Some(h) } else { None } })
                .collect();

            let mut sent_any = false;

            for handle in active_handles {
                let tcp_socket = sockets.get_mut::<tcp::Socket>(handle);
                if tcp_socket.state() == tcp::State::Listen { continue; }

                if !connections.contains_key(&handle) {
                    let local_ep = tcp_socket.local_endpoint().unwrap();
                    let ip_str = match local_ep.addr {
                        IpAddress::Ipv4(v4) => v4.to_string(),
                        IpAddress::Ipv6(v6) => format!("[{}]", v6),
                    };

                    info!("🔗 捕获 TCP 连接: {}", ip_str);
                    TCP_443_CONNECTIONS.fetch_add(1, Ordering::Relaxed);

                    let (tx_to_proxy, mut rx_from_tun) = mpsc::channel::<Bytes>(128);
                    let (tx_to_tun, rx_from_proxy) = mpsc::unbounded_channel::<Bytes>();
                    connections.insert(handle, ConnectionState { 
                        tx_to_proxy, 
                        rx_from_proxy, 
                        pending_writes: VecDeque::new(), 
                        pending_rx: VecDeque::new(), 
                        is_aborted: false 
                    });

                    let tx_to_tun_clone = tx_to_tun.clone();
                    let prot_clone = protector.clone();
                    let ip_str_clone = ip_str.clone();

                    tokio::spawn(async move {
                        let mut first_chunk = Vec::new();
                        let target_domain = loop {
                            let timeout_res = tokio::time::timeout(tokio::time::Duration::from_millis(2000), rx_from_tun.recv()).await;
                            match timeout_res {
                                Ok(Some(data)) => {
                                    first_chunk.extend_from_slice(&data);
                                    if let Some(domain) = extract_sni(&first_chunk) { break domain; }
                                    if first_chunk.len() > 16384 { return; }
                                }
                                _ => return,
                            }
                        };

                        let is_mitm_enabled = MITM_ENABLED.load(Ordering::Relaxed);
                        if !is_mitm_enabled || crate::policy_rules::should_bypass_mitm(&target_domain) {
                            info!("🛡️ [Bypass] 域名 {} 准备直连", target_domain);
                            let target_addr = format!("{}:443", ip_str_clone);
                            let is_ipv6 = target_addr.contains(':') && target_addr.starts_with('[');
                            
                            let socket = if is_ipv6 { tokio::net::TcpSocket::new_v6().unwrap() } else { tokio::net::TcpSocket::new_v4().unwrap() };
                            let fd = socket.as_raw_fd();
                            
                            if !prot_clone.protect_fd(fd) { error!("protect fd 失败"); return; }

                            let mut real_conn = match tokio::time::timeout(
                                std::time::Duration::from_secs(5), 
                                socket.connect(target_addr.parse().unwrap())
                            ).await {
                                Ok(Ok(c)) => c,
                                Ok(Err(e)) => { error!("直连失败: {}", e); return; },
                                Err(_) => { error!("直连超时，放弃连接"); return; }
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
                                        Ok(n) => {
                                            if tx_to_tun_clone.send(Bytes::copy_from_slice(&buf[..n])).is_err() { break; }
                                        }
                                        Err(_) => break,
                                    }
                                }
                            };
                            
                            tokio::join!(send_task, recv_task);
                            return;
                        }
                        
                        // MitM 逻辑...
                    });
                }

                let conn_state = connections.get_mut(&handle).unwrap();

                while let Ok(data) = conn_state.rx_from_proxy.try_recv() {
                    conn_state.pending_writes.push_back(PendingWrite { data: data.to_vec(), offset: 0 });
                }

                if conn_state.rx_from_proxy.is_closed() && !conn_state.is_aborted {
                    tcp_socket.close();
                    conn_state.is_aborted = true;
                }

                let mut total_sent = 0;
                while total_sent < 16384 {
                    if let Some(front) = conn_state.pending_writes.front_mut() {
                        let remaining = &front.data[front.offset..];
                        if remaining.is_empty() { conn_state.pending_writes.pop_front(); continue; }
                        let limit = remaining.len().min(16384 - total_sent);
                        if let Ok(n) = tcp_socket.send_slice(&remaining[..limit]) {
                            if n == 0 { break; }
                            front.offset += n;
                            total_sent += n;
                            sent_any = true;
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
                            if conn_state.tx_to_proxy.try_send(data.clone()).is_err() {
                                conn_state.pending_rx.push_back(data);
                                break;
                            }
                            total_recv += n;
                        } else { break; }
                    } else { break; }
                }
            }

            let mut to_remove = Vec::new();
            for (handle, socket) in sockets.iter() {
                if let smoltcp::socket::Socket::Tcp(s) = socket {
                    if s.state() == tcp::State::Closed && !s.may_send() {
                        to_remove.push(handle);
                    }
                }
            }
            for handle in to_remove {
                sockets.remove(handle);
                connections.remove(&handle);
                info!("♻️ 回收 Socket");
            }

            if sent_any {
                iface.poll(Instant::now(), &mut device, &mut sockets);
                tokio::time::sleep(tokio::time::Duration::from_millis(1)).await;
            } else {
                tokio::time::sleep(tokio::time::Duration::from_millis(5)).await;
            }
        }

        // 强制关闭所有 fd，让系统彻底释放 TUN
        unsafe { 
            libc::close(self.tun_fd); 
            libc::close(fd_read);
            libc::close(fd_write);
        }
        info!("🛑 Rust 引擎主循环退出完毕，所有 FD 已彻底释放");
    }
}
