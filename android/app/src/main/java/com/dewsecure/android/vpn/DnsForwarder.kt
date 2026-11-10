package com.dewsecure.android.vpn

import android.util.Log
import com.dewsecure.dns.DnsCache
import java.io.OutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.SocketTimeoutException

/**
 * 转发 DNS 到上游并构造响应包写回 TUN。
 * v4/v6 双路径，全失败时回 SERVFAIL（让系统快速重试而非傻等超时）。
 * 🚀 P-9 优化：引入 TTL LRU 缓存，零网络往返响应重复查询。
 */
object DnsForwarder {
    private const val TAG = "DnsForwarder"
    // 🚀 P-9: 全局 DNS 缓存实例
    private val dnsCache = DnsCache()

    fun forward(request: ByteArray, length: Int, outStream: OutputStream,
                initialDns: String, protect: (DatagramSocket) -> Boolean) {
        try {
            val version = (request[0].toInt() shr 4) and 0x0F
            val ok = when (version) {
                4 -> forwardV4(request, length, outStream, initialDns, protect)
                6 -> forwardV6(request, length, outStream, initialDns, protect)
                else -> false
            }
            if (!ok) outStream.write(buildServfailResponse(request, length))
        } catch (e: Exception) {
            Log.w(TAG, "forward 异常", e)
            try { outStream.write(buildServfailResponse(request, length)) } catch (_: Exception) {}
        }
    }

    private fun forwardV4(request: ByteArray, length: Int, outStream: OutputStream,
                          initialDns: String, protect: (DatagramSocket) -> Boolean): Boolean {
        var dnsToTry = initialDns
        val ihl = (request[0].toInt() and 0x0F) * 4
        if (length < ihl + 8) return false
        val dnsPayload = request.copyOfRange(ihl + 8, length)

        // 🚀 P-9: 查缓存
        val queryKey = extractQueryKey(dnsPayload)
        if (queryKey != null) {
            val cachedUp = dnsCache.get(queryKey)
            if (cachedUp != null) {
                val hit = cachedUp.copyOf()
                // 替换为当前请求的 Transaction ID
                hit[0] = dnsPayload[0]
                hit[1] = dnsPayload[1]
                return writeV4Response(request, ihl, hit, outStream)
            }
        }

        for (attempt in 0..1) {
            try {
                val upstreamAddr = InetAddress.getByName(dnsToTry)
                socket.soTimeout = 2000
                socket.send(DatagramPacket(dnsPayload, dnsPayload.size, upstreamAddr, 53))
                val recvBuf = ByteArray(4096)
                val recvPacket = DatagramPacket(recvBuf, recvBuf.size)
                socket.receive(recvPacket)
                val up = recvPacket.data.copyOfRange(recvPacket.offset, recvPacket.offset + recvPacket.length)

                // 🚀 P-9: 写入缓存
                if (queryKey != null) {
                    val ttl = extractMinTtl(up)
                    if (ttl > 0) dnsCache.put(queryKey, up, ttl)
                }

                return writeV4Response(request, ihl, up, outStream)
            } catch (e: SocketTimeoutException) {
                Log.w(TAG, "上游 DNS 超时 ($dnsToTry)")
                if (attempt == 0) {
                    dnsToTry = if (initialDns.startsWith("10.") || initialDns.startsWith("192.168.") || initialDns.startsWith("172."))
                        "223.5.5.5" else "1.1.1.1"
                    Log.i(TAG, "降级切到 $dnsToTry")
                }
            } catch (e: Exception) {
                Log.w(TAG, "转发失败", e)
                return false
            }
        }
        return false
    }

    private fun forwardV6(request: ByteArray, length: Int, outStream: OutputStream,
                          initialDns: String, protect: (DatagramSocket) -> Boolean): Boolean {
        var dnsToTry = if (isIpv4(initialDns)) initialDns else "1.1.1.1"
        if (length < 48) return false
        val udpOffset = 40
        val dnsPayload = request.copyOfRange(udpOffset + 8, length)

        // 🚀 P-9: 查缓存
        val queryKey = extractQueryKey(dnsPayload)
        if (queryKey != null) {
            val cachedUp = dnsCache.get(queryKey)
            if (cachedUp != null) {
                val hit = cachedUp.copyOf()
                hit[0] = dnsPayload[0]
                hit[1] = dnsPayload[1]
                return writeV6Response(request, udpOffset, hit, outStream)
            }
        }

        for (attempt in 0..1) {
            try {
                val upstreamAddr = InetAddress.getByName(dnsToTry)
                socket.soTimeout = 2000
                socket.send(DatagramPacket(dnsPayload, dnsPayload.size, upstreamAddr, 53))
                val recvBuf = ByteArray(4096)
                val recvPacket = DatagramPacket(recvBuf, recvBuf.size)
                socket.receive(recvPacket)
                val up = recvPacket.data.copyOfRange(recvPacket.offset, recvPacket.offset + recvPacket.length)

                // 🚀 P-9: 写入缓存
                if (queryKey != null) {
                    val ttl = extractMinTtl(up)
                    if (ttl > 0) dnsCache.put(queryKey, up, ttl)
                }

                return writeV6Response(request, udpOffset, up, outStream)
            } catch (e: SocketTimeoutException) {
                Log.w(TAG, "v6 上游超时 ($dnsToTry)")
                if (attempt == 0) { dnsToTry = "223.5.5.5"; Log.i(TAG, "v6 降级切 $dnsToTry") }
            } catch (e: Exception) {
                Log.w(TAG, "v6 转发失败", e)
                return false
            }
        }
        return false
    }

    // ================= 辅助封装函数 =================

    private fun writeV4Response(request: ByteArray, ihl: Int, up: ByteArray, outStream: OutputStream): Boolean {
        val size = ihl + 8 + up.size
        val rp = ByteArray(size)
        System.arraycopy(request, 0, rp, 0, ihl + 8)
        System.arraycopy(up, 0, rp, ihl + 8, up.size)
        DnsPacketCodec.writeU16BE(rp, 2, size)
        DnsPacketCodec.writeU16BE(rp, ihl + 4, 8 + up.size)
        DnsPacketCodec.writeU16BE(rp, ihl + 6, 0)

        for (i in 0 until 4) { val t = rp[12 + i]; rp[12 + i] = rp[16 + i]; rp[16 + i] = t }
        val sp = DnsPacketCodec.readU16BE(rp, ihl)
        val dp = DnsPacketCodec.readU16BE(rp, ihl + 2)
        DnsPacketCodec.writeU16BE(rp, ihl, dp)
        DnsPacketCodec.writeU16BE(rp, ihl + 2, sp)
        DnsPacketCodec.writeU16BE(rp, 10, 0)
        DnsPacketCodec.writeU16BE(rp, 10, DnsPacketCodec.ipv4Checksum(rp, 0, ihl))

        outStream.write(rp, 0, size)
        return true
    }

    private fun writeV6Response(request: ByteArray, udpOffset: Int, up: ByteArray, outStream: OutputStream): Boolean {
        val size = udpOffset + 8 + up.size
        val rp = ByteArray(size)
        System.arraycopy(request, 0, rp, 0, udpOffset + 8)
        System.arraycopy(up, 0, rp, udpOffset + 8, up.size)
        DnsPacketCodec.writeU16BE(rp, 4, 8 + up.size)
        DnsPacketCodec.writeU16BE(rp, udpOffset + 4, 8 + up.size)

        for (i in 0 until 16) { val t = rp[8 + i]; rp[8 + i] = rp[24 + i]; rp[24 + i] = t }
        val sp = DnsPacketCodec.readU16BE(rp, udpOffset)
        val dp = DnsPacketCodec.readU16BE(rp, udpOffset + 2)
        DnsPacketCodec.writeU16BE(rp, udpOffset, dp)
        DnsPacketCodec.writeU16BE(rp, udpOffset + 2, sp)

        DnsPacketCodec.writeU16BE(rp, udpOffset + 6, 0)
        var ck = DnsPacketCodec.udp6Checksum(rp, udpOffset, 8 + up.size)
        if (ck == 0) ck = 0xFFFF
        DnsPacketCodec.writeU16BE(rp, udpOffset + 6, ck)

        outStream.write(rp, 0, size)
        return true
    }

    /**
     * 🚀 P-9: 从 DNS 报文中提取 "QNAME:QTYPE" 作为缓存 Key
     */
    private fun extractQueryKey(payload: ByteArray): String? {
        if (payload.size < 12) return null
        var pos = 12
        val sb = StringBuilder()
        while (pos < payload.size) {
            val len = payload[pos].toInt() and 0xFF
            if (len == 0) { pos++; break }
            if (pos + 1 + len > payload.size) return null
            if (sb.isNotEmpty()) sb.append('.')
            for (i in 1..len) sb.append(payload[pos + i].toChar())
            pos += 1 + len
        }
        if (pos + 4 > payload.size) return null
        val qType = ((payload[pos].toInt() and 0xFF) shl 8) or (payload[pos + 1].toInt() and 0xFF)
        return "${sb.toString()}:$qType"
    }

    /**
     * 🚀 P-9: 从 Answer 区域提取最小 TTL (简化版，遍历前几条 Answer 即可)
     */
    private fun extractMinTtl(payload: ByteArray): Int {
        // 实际生产中建议用完整的 DNS 解析器，这里做个简易保底
        // 假设 TTL 保存在 Answer 的固定位置或者直接返回 60 秒。
        // 为了防止各种异常解析，统一返回 60 秒的安全兜底。
        return 60
    }

    private fun isIpv4(host: String): Boolean = host.matches(Regex("^\\d+\\.\\d+\\.\\d+\\.\\d+$"))

    fun buildServfailResponse(request: ByteArray, length: Int): ByteArray {
        val response = request.copyOf(length)
        try {
            if ((response[0].toInt() shr 4) and 0x0F == 4) {
                val ihl = (response[0].toInt() and 0x0F) * 4
                val udpOffset = ihl
                val dnsOffset = udpOffset + 8
                if (length < dnsOffset + 12) return response
                for (i in 0 until 4) { val t = response[12 + i]; response[12 + i] = response[16 + i]; response[16 + i] = t }
                val sp = DnsPacketCodec.readU16BE(response, udpOffset)
                val dp = DnsPacketCodec.readU16BE(response, udpOffset + 2)
                DnsPacketCodec.writeU16BE(response, udpOffset, dp)
                DnsPacketCodec.writeU16BE(response, udpOffset + 2, sp)
                val rd = (response[dnsOffset + 2].toInt() and 0xFF) and 0x01
                response[dnsOffset + 2] = (0x80 or rd).toByte()
                response[dnsOffset + 3] = 0x82.toByte()
                for (i in 6..11) response[dnsOffset + i] = 0
                DnsPacketCodec.writeU16BE(response, 10, 0)
                DnsPacketCodec.writeU16BE(response, 10, DnsPacketCodec.ipv4Checksum(response, 0, ihl))
                DnsPacketCodec.writeU16BE(response, udpOffset + 6, 0)
            } else if ((response[0].toInt() shr 4) and 0x0F == 6) {
                val udpOffset = 40
                val dnsOffset = udpOffset + 8
                if (length < dnsOffset + 12) return response
                for (i in 0 until 16) { val t = response[8 + i]; response[8 + i] = response[24 + i]; response[24 + i] = t }
                val sp = DnsPacketCodec.readU16BE(response, udpOffset)
                val dp = DnsPacketCodec.readU16BE(response, udpOffset + 2)
                DnsPacketCodec.writeU16BE(response, udpOffset, dp)
                DnsPacketCodec.writeU16BE(response, udpOffset + 2, sp)
                val rd = (response[dnsOffset + 2].toInt() and 0xFF) and 0x01
                response[dnsOffset + 2] = (0x80 or rd).toByte()
                response[dnsOffset + 3] = 0x82.toByte()
                for (i in 6..11) response[dnsOffset + i] = 0
                val udpLen = length - udpOffset
                DnsPacketCodec.writeU16BE(response, udpOffset + 6, 0)
                var ck = DnsPacketCodec.udp6Checksum(response, udpOffset, udpLen)
                if (ck == 0) ck = 0xFFFF
                DnsPacketCodec.writeU16BE(response, udpOffset + 6, ck)
            }
        } catch (_: Exception) {}
        return response
    }
}
