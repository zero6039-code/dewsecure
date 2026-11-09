package com.dewsecure.android.vpn

import android.util.Log
import com.dewsecure.android.policy.EngineBridge
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.random.Random

/**
 * 单个 TCP DNS 连接的状态机。
 * 三次握手 + 数据双向透传到上游 TCP 53 + 优雅关闭。
 * 只做字节流搬运，不解析 DNS 内容（长度前缀由上游处理）。
 */
class TcpDnsSession(private val key: TcpDnsRelay.SessionKey) {

    companion object {
        private const val TAG = "TcpDnsSession"
        private const val FLAG_FIN = 0x01
        private const val FLAG_SYN = 0x02
        private const val FLAG_RST = 0x04
        private const val FLAG_PSH = 0x08
        private const val FLAG_ACK = 0x10
        private const val TIMEOUT_MS = 15_000L
    }

    private val closed = AtomicBoolean(false)
    private val myIsn = Random.nextLong(1L, 0xFFFFFFFFL)
    private var mySeq = 0L
    private var expectClientSeq = 0L
    private var established = false
    private var upstream: Socket? = null
    private var lastActive = System.currentTimeMillis()

    fun onPacket(info: TcpDnsRelay.TcpInfo, payload: ByteArray?) {
        if (closed.get()) return
        lastActive = System.currentTimeMillis()
        // 移除死代码，超时逻辑交由 Socket soTimeout 控制

        when {
            (info.flags and FLAG_RST) != 0 -> forceClose()
            (info.flags and FLAG_SYN) != 0 && (info.flags and FLAG_ACK) == 0 -> handleSyn(info)
            established && (info.flags and FLAG_FIN) != 0 -> handleFin(info)
            established && payload != null && payload.isNotEmpty() -> handleData(info, payload)
            // 纯 ACK / 握手第三步，忽略
        }
    }

    private fun handleSyn(info: TcpDnsRelay.TcpInfo) {
        if (established) return
        expectClientSeq = (info.seq + 1) and 0xFFFFFFFFL
        mySeq = (myIsn + 1) and 0xFFFFFFFFL

        val vpn = TcpDnsRelay.getVpnService()
        if (vpn == null) { forceClose(); return }
        try {
            val sock = Socket()
            vpn.protect(sock)
            sock.connect(InetSocketAddress(TcpDnsRelay.getUpstreamDns(), 53), 3000)
            sock.soTimeout = TIMEOUT_MS.toInt()
            upstream = sock
        } catch (e: Exception) {
            Log.w(TAG, "上游连接失败", e)
            sendSegment(info, myIsn, 0, FLAG_RST or FLAG_ACK, null)
            forceClose()
            return
        }

        sendSegment(info, myIsn, expectClientSeq, FLAG_SYN or FLAG_ACK, null)
        established = true
        Thread({ readLoop(info) }, "TcpDnsReader-${info.srcPort}").start()
        Log.d(TAG, "TCP DNS 连接建立: ${info.srcPort} -> ${TcpDnsRelay.getUpstreamDns()}")
    }

    private fun handleData(info: TcpDnsRelay.TcpInfo, payload: ByteArray) {
        // D-7 修复：严格校验序列号，不匹配则回 ACK 丢弃
        if (info.seq != expectClientSeq) {
            sendSegment(info, mySeq, expectClientSeq, FLAG_ACK, null)
            return
        }

        // D-1 修复：解析 TCP DNS 并执行阻断
        if (payload.size > 2) {
            val len = ((payload[0].toInt() and 0xFF) shl 8) or (payload[1].toInt() and 0xFF)
            if (len == payload.size - 2) {
                val dnsMsg = payload.copyOfRange(2, payload.size)
                val domain = DnsPacketCodec.extractDomain(dnsMsg, dnsMsg.size)
                if (domain != null && EngineBridge.shouldBlock(domain).decision != com.dewsecure.core.BlockDecision.ALLOW) {
                    Log.i(TAG, "🛑 TCP DNS 拦截: $domain")
                    val nx = DnsPacketCodec.buildNxDomainResponse(dnsMsg, dnsMsg.size)
                    val framed = byteArrayOf((nx.size shr 8).toByte(), nx.size.toByte()) + nx
                    sendSegment(info, mySeq, expectClientSeq, FLAG_ACK or FLAG_PSH, framed)
                    mySeq = (mySeq + framed.size) and 0xFFFFFFFFL
                    return // 阻断，不发给上游
                }
            }
        }

        val os = upstream?.getOutputStream() ?: run { forceClose(); return }
        try {
            os.write(payload)
            os.flush()
            expectClientSeq = (expectClientSeq + payload.size) and 0xFFFFFFFFL
            sendSegment(info, mySeq, expectClientSeq, FLAG_ACK, null)
        } catch (e: Exception) {
            Log.w(TAG, "转发 payload 到上游失败", e)
            forceClose()
        }
    }

    private fun readLoop(info: TcpDnsRelay.TcpInfo) {
        val ins = upstream?.getInputStream() ?: return
        val buf = ByteArray(1400) // D-7 修复：防止超出 TUN MTU
        try {
            while (!closed.get()) {
                val n = ins.read(buf)
                if (n <= 0) break
                val payload = buf.copyOfRange(0, n)
                sendSegment(info, mySeq, expectClientSeq, FLAG_ACK or FLAG_PSH, payload)
                mySeq = (mySeq + n) and 0xFFFFFFFFL
            }
        } catch (e: Exception) {
            if (!closed.get()) Log.w(TAG, "上游读取失败", e)
        } finally {
            if (!closed.get() && established) {
                sendSegment(info, mySeq, expectClientSeq, FLAG_FIN or FLAG_ACK, null)
                mySeq = (mySeq + 1) and 0xFFFFFFFFL
            }
            forceClose()
        }
    }

    private fun handleFin(info: TcpDnsRelay.TcpInfo) {
        expectClientSeq = (expectClientSeq + 1) and 0xFFFFFFFFL
        sendSegment(info, mySeq, expectClientSeq, FLAG_FIN or FLAG_ACK, null)
        mySeq = (mySeq + 1) and 0xFFFFFFFFL
        forceClose()
    }

    fun forceClose() {
        if (!closed.compareAndSet(false, true)) return
        try { upstream?.close() } catch (_: Exception) {}
        upstream = null
        TcpDnsRelay.removeSession(key)
        Log.d(TAG, "TCP DNS 连接关闭: ${key.srcPort}")
    }

    private fun sendSegment(info: TcpDnsRelay.TcpInfo, seq: Long, ack: Long,
                            flags: Int, payload: ByteArray?) {
        try {
            val seg = TcpDnsRelay.buildTcpSegment(info, seq, ack, flags, payload)
            TcpDnsRelay.writeToTun(seg, seg.size)
        } catch (e: Exception) {
            Log.w(TAG, "构造/写回 TCP 段失败", e)
        }
    }
}
