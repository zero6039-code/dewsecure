package com.dewsecure.android.vpn

import android.net.VpnService
import android.util.Log
import java.io.OutputStream
import java.util.concurrent.ConcurrentHashMap

/**
 * TCP DNS 完整代理入口：解析 TCP 段 + 分发到 TcpDnsSession + 构造回包。
 * 每个 TCP 连接由 TcpDnsSession 维护序号/握手状态。
 */
object TcpDnsRelay {
    private const val TAG = "TcpDnsRelay"
    private const val MAX_SESSIONS = 1000
    private val sessions = ConcurrentHashMap<SessionKey, TcpDnsSession>()

    @Volatile private var outputStream: OutputStream? = null
    @Volatile private var vpnService: VpnService? = null
    @Volatile private var upstreamDns: String = "223.5.5.5"

    fun setUpstreamDns(dns: String) { upstreamDns = dns }
    internal fun getUpstreamDns(): String = upstreamDns
    internal fun getVpnService(): VpnService? = vpnService

    fun handle(packet: ByteArray, length: Int, outStream: OutputStream, vpn: VpnService) {
        outputStream = outStream
        vpnService = vpn
        try {
            val info = parseTcpSegment(packet, length) ?: return
            val key = SessionKey(info.srcIp, info.srcPort, info.dstIp, info.dstPort)
            val payload = if (info.payloadLen > 0 &&
                info.payloadOffset + info.payloadLen <= length)
                packet.copyOfRange(info.payloadOffset, info.payloadOffset + info.payloadLen)
            else null
            if (!sessions.containsKey(key) && sessions.size >= MAX_SESSIONS) {
                Log.w(TAG, "TCP 会话数量已达上限 ($MAX_SESSIONS)，拒绝新连接")
                return
            }
            val session = sessions.getOrPut(key) { TcpDnsSession(key) }
            session.onPacket(info, payload)
        } catch (e: Exception) {
            Log.w(TAG, "处理 TCP DNS 包失败", e)
        }
    }

    fun removeSession(key: SessionKey) { sessions.remove(key) }
    fun releaseService() { vpnService = null }

    fun removeAll() {
        sessions.values.forEach { it.forceClose() }
        sessions.clear()
    }

    internal fun writeToTun(bytes: ByteArray, len: Int) {
        val os = outputStream ?: return
        synchronized(os) {
            try { os.write(bytes, 0, len) } catch (e: Exception) { Log.w(TAG, "写 TUN 失败", e) }
        }
    }

    data class SessionKey(
        val srcIp: ByteArray, val srcPort: Int, val dstIp: ByteArray, val dstPort: Int
    ) {
        override fun equals(other: Any?): Boolean = other is SessionKey &&
                srcPort == other.srcPort && dstPort == other.dstPort &&
                srcIp.contentEquals(other.srcIp) && dstIp.contentEquals(other.dstIp)
        override fun hashCode(): Int =
            srcIp.contentHashCode() * 31 + dstIp.contentHashCode() + srcPort * 17 + dstPort
    }

    class TcpInfo(
        val isIpv6: Boolean, val ipHeaderLen: Int,
        val srcIp: ByteArray, val dstIp: ByteArray,
        val srcPort: Int, val dstPort: Int,
        val seq: Long, val ack: Long,
        val flags: Int, val payloadOffset: Int, val payloadLen: Int
    )

    private fun parseTcpSegment(packet: ByteArray, length: Int): TcpInfo? {
        return try {
            when ((packet[0].toInt() shr 4) and 0x0F) {
                4 -> {
                    val ihl = (packet[0].toInt() and 0x0F) * 4
                    if (length < ihl + 20 || packet[9].toInt() != 6) return null
                    val t = ihl
                    val srcPort = readU16(packet, t)
                    val dstPort = readU16(packet, t + 2)
                    if (dstPort != 53) return null
                    val dataOff = ((packet[t + 12].toInt() shr 4) and 0x0F) * 4
                    val payloadLen = length - ihl - dataOff
                    TcpInfo(false, ihl, packet.copyOfRange(12, 16), packet.copyOfRange(16, 20),
                        srcPort, dstPort, readU32(packet, t + 4), readU32(packet, t + 8),
                        packet[t + 13].toInt() and 0xFF, ihl + dataOff, payloadLen)
                }
                6 -> {
                    if (length < 60 || packet[6].toInt() != 6) return null
                    val t = 40
                    val srcPort = readU16(packet, t)
                    val dstPort = readU16(packet, t + 2)
                    if (dstPort != 53) return null
                    val dataOff = ((packet[t + 12].toInt() shr 4) and 0x0F) * 4
                    val payloadLen = length - 40 - dataOff
                    TcpInfo(true, 40, packet.copyOfRange(8, 24), packet.copyOfRange(24, 40),
                        srcPort, dstPort, readU32(packet, t + 4), readU32(packet, t + 8),
                        packet[t + 13].toInt() and 0xFF, 40 + dataOff, payloadLen)
                }
                else -> null
            }
        } catch (e: Exception) { null }
    }

    /** 构造 TCP 段（自动处理 IP/UDP/TCP 头 + checksum）。 */
    internal fun buildTcpSegment(
        info: TcpInfo, seq: Long, ack: Long, flags: Int, payload: ByteArray?
    ): ByteArray {
        val payloadLen = payload?.size ?: 0
        val ipHeaderLen = if (info.isIpv6) 40 else 20
        val totalLen = ipHeaderLen + 20 + payloadLen
        val buf = ByteArray(totalLen)
        if (!info.isIpv6) {
            buf[0] = 0x45
            writeU16(buf, 2, totalLen)
            buf[8] = 64
            buf[9] = 6
            System.arraycopy(info.dstIp, 0, buf, 12, 4)
            System.arraycopy(info.srcIp, 0, buf, 16, 4)
        } else {
            buf[0] = 0x60
            writeU16(buf, 4, 20 + payloadLen)
            buf[6] = 6
            buf[7] = 64
            System.arraycopy(info.dstIp, 0, buf, 8, 16)
            System.arraycopy(info.srcIp, 0, buf, 24, 16)
        }
        val t = ipHeaderLen
        writeU16(buf, t, info.dstPort)
        writeU16(buf, t + 2, info.srcPort)
        writeU32(buf, t + 4, seq)
        writeU32(buf, t + 8, ack)
        buf[t + 12] = (5 shl 4).toByte()
        buf[t + 13] = flags.toByte()
        writeU16(buf, t + 14, 65535)
        writeU16(buf, t + 16, 0)
        if (payload != null) System.arraycopy(payload, 0, buf, t + 20, payload.size)

        val tcpLen = 20 + payloadLen
        val cksum = if (info.isIpv6) tcp6Checksum(buf, t, tcpLen) else tcp4Checksum(buf, t, tcpLen)
        writeU16(buf, t + 16, cksum)
        if (!info.isIpv6) writeU16(buf, 10, ipv4Checksum(buf, 0, ipHeaderLen))
        return buf
    }

    private fun ipv4Checksum(buf: ByteArray, off: Int, len: Int): Int {
        var sum = 0; var i = off; val end = off + len
        while (i + 1 < end) { sum += readU16(buf, i); i += 2 }
        while (sum shr 16 != 0) sum = (sum and 0xFFFF) + (sum shr 16)
        return sum.inv() and 0xFFFF
    }
    private fun tcp4Checksum(buf: ByteArray, t: Int, tcpLen: Int): Int {
        var sum = 0
        for (i in 12..19 step 2) sum += readU16(buf, i)
        sum += 6; sum += tcpLen
        var i = t; val end = t + tcpLen
        while (i + 1 < end) { sum += readU16(buf, i); i += 2 }
        if (i < end) sum += (buf[i].toInt() and 0xFF) shl 8
        while (sum shr 16 != 0) sum = (sum and 0xFFFF) + (sum shr 16)
        return sum.inv() and 0xFFFF
    }
    private fun tcp6Checksum(buf: ByteArray, t: Int, tcpLen: Int): Int {
        var sum = 0L
        for (i in 8..39 step 2) sum += readU16(buf, i).toLong()
        sum += tcpLen; sum += 6
        var i = t; val end = t + tcpLen
        while (i + 1 < end) { sum += readU16(buf, i).toLong(); i += 2 }
        if (i < end) sum += ((buf[i].toInt() and 0xFF) shl 8).toLong()
        while (sum ushr 16 != 0L) sum = (sum and 0xFFFF) + (sum ushr 16)
        return sum.inv().toInt() and 0xFFFF
    }

    internal fun readU16(b: ByteArray, o: Int): Int = ((b[o].toInt() and 0xFF) shl 8) or (b[o + 1].toInt() and 0xFF)
    internal fun writeU16(b: ByteArray, o: Int, v: Int) { b[o] = ((v shr 8) and 0xFF).toByte(); b[o + 1] = (v and 0xFF).toByte() }
    internal fun readU32(b: ByteArray, o: Int): Long =
        ((b[o].toLong() and 0xFF) shl 24) or ((b[o + 1].toLong() and 0xFF) shl 16) or
        ((b[o + 2].toLong() and 0xFF) shl 8) or (b[o + 3].toLong() and 0xFF)
    internal fun writeU32(b: ByteArray, o: Int, v: Long) {
        b[o] = ((v shr 24) and 0xFF).toByte(); b[o + 1] = ((v shr 16) and 0xFF).toByte()
        b[o + 2] = ((v shr 8) and 0xFF).toByte(); b[o + 3] = (v and 0xFF).toByte()
    }
}
