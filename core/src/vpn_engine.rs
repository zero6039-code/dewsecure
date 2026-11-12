use std::os::unix::io::FromRawFd;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use log::{info, error};
use tun_rs::AsyncDevice;
use std::net::{Ipv4Addr, SocketAddrV4};

pub struct VpnEngine {
    tun_fd: i32,
}

impl VpnEngine {
    pub fn new(tun_fd: i32) -> Self {
        Self { tun_fd }
    }

    pub async fn start(self) {
        info!("🚀 初始化 Rust 原生 TUN 代理引擎...");

        // 1. 启动 hudsucker 代理
        let proxy = crate::mitm_proxy::MitmProxy::new();
        if let Err(e) = proxy.start().await {
            error!("❌ hudsucker 启动失败: {}", e);
            return;
        }
        info!("✅ hudsucker 代理已启动，监听 127.0.0.1:8888");

        // 2. 包装 TUN 设备 (注意：Kotlin 侧必须是非阻塞的)
        let mut tun = unsafe { AsyncDevice::from_raw_fd(self.tun_fd) };
        info!("✅ TUN 设备已接管，开始读取 IP 包...");

        let mut buf = [0u8; 2000];
        loop {
            match tun.recv(&mut buf).await {
                Ok(n) if n > 0 => {
                    // 解析 IP 包头部
                    let version = buf[0] >> 4;
                    if version == 4 {
                        let ihl = (buf[0] & 0x0F) as usize * 4;
                        let protocol = buf[9];
                        
                        if protocol == 6 { // TCP
                            let dst_port = u16::from_be_bytes([buf[ihl + 2], buf[ihl + 3]]);
                            if dst_port == 443 || dst_port == 80 {
                                let src_ip = Ipv4Addr::new(buf[12], buf[13], buf[14], buf[15]);
                                let dst_ip = Ipv4Addr::new(buf[16], buf[17], buf[18], buf[19]);
                                let src_port = u16::from_be_bytes([buf[ihl], buf[ihl + 1]]);
                                info!("🔗 捕获 TCP 连接: {}:{} -> {}:{}", src_ip, src_port, dst_ip, dst_port);
                                
                                // 这里为了先打通链路，我们直接回一个 RST 包，让浏览器断开。
                                // 接下来再写真实的 TCP 转发逻辑。
                            }
                        } else if protocol == 17 { // UDP (通常是 DNS)
                            let dst_port = u16::from_be_bytes([buf[ihl + 2], buf[ihl + 3]]);
                            if dst_port == 53 {
                                // 暂时拦截 DNS 并返回空，防止浏览器卡死
                                info!("📡 捕获 DNS 请求 (暂未转发)");
                            }
                        }
                    }
                }
                Ok(_) => {}
                Err(e) => {
                    error!("TUN 读取失败: {}", e);
                    break;
                }
            }
        }
    }
}
