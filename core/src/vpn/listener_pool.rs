use smoltcp::{
    iface::{SocketSet, SocketHandle},
    socket::tcp,
    wire::IpListenEndpoint,
};
use std::collections::HashMap;

/// 监听 socket 池：按端口维持固定数量的 Listen socket，被连接占用后自动补齐。
pub struct ListenerPool {
    by_port: HashMap<u16, (usize, Vec<SocketHandle>)>,
}

impl ListenerPool {
    const MAX_PORTS: usize = 256;
    pub fn new() -> Self { Self { by_port: HashMap::new() } }
    
    pub fn want(&mut self, port: u16, n: usize) {
        if port == 0 { return; }
        if !self.by_port.contains_key(&port) && self.by_port.len() >= Self::MAX_PORTS { return; }
        self.by_port.entry(port).or_insert((n, Vec::new()));
    }

    pub fn top_up(&mut self, sockets: &mut SocketSet<'_>) {
        let listening: std::collections::HashSet<SocketHandle> = sockets
            .iter()
            .filter_map(|(h, s)| match s {
                smoltcp::socket::Socket::Tcp(t) if t.state() == tcp::State::Listen => Some(h),
                _ => None,
            })
            .collect();
        for (port, (want, handles)) in self.by_port.iter_mut() {
            handles.retain(|h| listening.contains(h));
            while handles.len() < *want {
                let rx = tcp::SocketBuffer::new(vec![0u8; 16384]);
                let tx = tcp::SocketBuffer::new(vec![0u8; 16384]);
                let h = sockets.add(tcp::Socket::new(rx, tx));
                if sockets.get_mut::<tcp::Socket>(h).listen(IpListenEndpoint { addr: None, port: *port }).is_err() {
                    sockets.remove(h);
                    break;
                }
                handles.push(h);
            }
        }
    }
}

/// 若是 TCP SYN（非 ACK），返回目的端口。
pub fn syn_dst_port(pkt: &[u8]) -> Option<u16> {
    let (proto, off) = match pkt.first()? >> 4 {
        4 => (*pkt.get(9)?, ((*pkt.first()? & 0x0F) as usize) * 4),
        6 => (*pkt.get(6)?, 40),
        _ => return None,
    };
    if proto != 6 { return None; }
    let flags = *pkt.get(off + 13)?;
    if flags & 0x02 == 0 || flags & 0x10 != 0 { return None; }
    Some(u16::from_be_bytes([*pkt.get(off + 2)?, *pkt.get(off + 3)?]))
}

/// 首包不是 TLS 握手记录（0x16）就不要再等 SNI，立刻按直连处理。
pub fn needs_more_for_sni(first_chunk: &[u8]) -> bool {
    first_chunk.first() == Some(&0x16)
}
