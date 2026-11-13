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

use super::device::{VpnDevice, spawn_tun_reader, TCP_443_CONNECTIONS};
use super::utils::extract_sni;

static MITM_ENABLED: AtomicBool = AtomicBool::new(false);
static RUNNING: AtomicBool = AtomicBool::new(true);

pub fn set_mitm_enabled(enabled: bool) {
    MITM_ENABLED.store(enabled, Ordering::Relaxed);
    info!("⚙️ Rust 侧 MitM 总开关已设置为: {}", enabled);
}

pub fn stop_vpn_engine() {
    RUNNING.store(false, Ordering::Relaxed);
    info!("🛑 收到停止信号，Rust 引擎正在异步退出，不再阻塞调用方...");
}

struct PendingWrite { data: Vec<u8>, offset: usize }

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
    pub fn new(tun_fd: RawFd, protector: Arc<dyn VpnProtector>) -> Self { Self { tun_fd, protector } }

    pub async fn start(self) {
        info!("🚀 初始化 Rust 侧 smoltcp 透明代理 (专家防死锁版)...");
        RUNNING.store(true, Ordering::Relaxed);

        let proxy = crate::mitm_proxy::MitmProxy::new();
        if let Err(e) = proxy.start().await { error!("❌ hudsucker 启动失败: {}", e); return; }

        let rx_queue = Arc::new(Mutex::new(VecDeque::new()));
        // 专家修改：不再 dup，直接使用同一个 FD，由 lib.rs 统一强制关闭
        let fd_read = self.tun_fd;
        let fd_write = self.tun_fd;
        spawn_tun_reader(fd_read, rx_queue.clone(), Arc::new(AtomicBool::new(true)));

        let mut device = VpnDevice { rx_queue, tx_fd: fd_write };
        let config = Config::new(smoltcp::wire::HardwareAddress::Ip);
        let mut iface = Interface::new(config, &mut device, Instant::now());
        iface.set_any_ip(true);
        iface.update_ip_addrs(|ip_addrs| {
            let _ = ip_addrs.push(IpCidr::new(IpAddress::Ipv4(Ipv4Address::new(10, 0, 0, 1)), 24));
            let _ = ip_addrs.push(IpCidr::new(IpAddress::Ipv6(Ipv6Address::new(0xfd00, 0, 0, 0, 0, 0, 0, 2)), 120));
        });

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
            
            iface.poll(Instant::now(), &mut device, &mut sockets);

            // 1. 补充 Listener
            let mut listen_count = 0;
            for (_, socket) in sockets.iter() {
                if let smoltcp::socket::Socket::Tcp(s) = socket {
                    if s.state() == tcp::State::Listen { listen_count += 1; }
                }
            }
            // 专家修复：降低缓存大小，且只固定补充到 64 个，防止爆内存
            for _ in listen_count..64 {
                let tcp_rx = tcp::SocketBuffer::new(vec![0u8; 16384]);
                let tcp_tx = tcp::SocketBuffer::new(vec![0u8; 16384]);
                let tcp_socket = tcp::Socket::new(tcp_rx, tcp_tx);
                let handle = sockets.add(tcp_socket);
                let socket = sockets.get_mut::<tcp::Socket>(handle);
                let _ = socket.listen(IpListenEndpoint { addr: None, port: 443 });
            }

            // 2. 诊断日志
            if last_report.elapsed().as_secs() >= 5 {
                info!("📊 [诊断] TCP_SYN={}, TCP_443_CONN={}, Listen={}", 
                    super::device::TCP_SYN_PACKETS.load(Ordering::Relaxed), 
                    TCP_443_CONNECTIONS.load(Ordering::Relaxed),
                    listen_count);
                last_report = std::time::Instant::now();
            }

            // 3. 处理已激活的 Socket
            let active_handles: Vec<SocketHandle> = sockets.iter()
                .filter_map(|(h, _)| { if sockets.get::<tcp::Socket>(h).is_active() { Some(h) } else { None } })
                .collect();

            let mut sent_any = false;

            for handle in active_handles {
                // 先做不可变查询
                // 专家修复：安全借用，避免直接 get() 导致 panic
                let is_closed = sockets.iter()
                    .find(|(h, _)| *h == handle)
                    .map(|(_, s)| {
                        if let smoltcp::socket::Socket::Tcp(tcp) = s {
                            tcp.state() == tcp::State::Closed
                        } else {
                            false
                        }
                    })
                    .unwrap_or(true);

                // 如果是 Closed 且 connections 里有，删掉
                if is_closed {
                    if connections.remove(&handle).is_some() {
                        info!("♻️ 释放残留的 Handle");
                    }
                }

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

                    // 专家修改：改为 unbounded_channel，永远不背压
                    let (tx_to_proxy, mut rx_from_tun) = mpsc::channel::<Bytes>(128);
                    let (tx_to_tun, rx_from_proxy) = mpsc::unbounded_channel::<Bytes>();
                    
                    connections.insert(handle, ConnectionState {
                        tx_to_proxy, rx_from_proxy, pending_writes: VecDeque::new(), pending_rx: VecDeque::new(), is_aborted: false,
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
                            
                            if !prot_clone.protect_fd(fd) { error!("❌ protect fd 失败"); return; }

                            let mut real_conn = match tokio::time::timeout(std::time::Duration::from_secs(3), socket.connect(target_addr.parse().unwrap())).await {
                                Ok(Ok(c)) => c,
                                Ok(Err(e)) => { error!("❌ 直连 {} 失败: {}", target_addr, e); return; },
                                Err(_) => { error!("❌ 直连 {} 超时，放弃连接", target_addr); return; }
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
                                            // 使用 unbounded send，不会阻塞，永远不会死锁
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

                // 4. 专家修改：一次性抽干 rx_from_proxy，绝不只取一条
                while let Ok(data) = conn_state.rx_from_proxy.try_recv() {
                    conn_state.pending_writes.push_back(PendingWrite { data: data.to_vec(), offset: 0 });
                }

                if conn_state.rx_from_proxy.is_closed() {
                    // 专家修复：发送 FIN 优雅关闭，不要直接 abort
                    if !conn_state.is_aborted {
                        info!("⚠️ 检测到代理端断开，执行优雅关闭");
                        tcp_socket.close();
                        conn_state.is_aborted = true;
                    }
                }

                // 5. 发送数据到 TUN
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

                // 6. 读取 TUN 数据发给代理
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

            // 7. 专家修改：等 Socket 进入 Closed 并排空发送队列后，才 remove
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

        info!("🛑 Rust 引擎主循环退出完毕");
    }
}
