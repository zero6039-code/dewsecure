package com.dewsecure.android.vpn

/**
 * DNS 包编解码：IPv4/IPv6 + UDP/TCP 识别 + NXDOMAIN 构造。
 * 最小改动原则：现有 IPv4 逻辑一字未改，仅新增 v6 分支与内部辅助方法。
 */
object DnsPacketCodec {

    private const val PROTO_UDP = 17
    private const val PROTO_TCP = 6
    private const val DNS_PORT = 53

    /** 从完整 IP 包中提取 DNS QNAME。解析失败返回 null。 */
    fun extractDomain(packet: ByteArray, length: Int): String? {
        return try {
            if (length < 1) return null
            when ((packet[0].toInt() shr 4) and 0x0F) {
                4 -> extractFromIpv4Udp(packet, length)
                6 -> extractFromIpv6Udp(packet, length)
                else -> null
            }
        } catch (e: Exception) { null }
    }

    private fun extractFromIpv4Udp(packet: ByteArray, length: Int): String? {
        if (length < 28) return null
        if (packet[9].toInt() != PROTO_UDP) return null
        val ihl = (packet[0].toInt() and 0x0F) * 4
        if (length < ihl + 8) return null
        return parseQName(packet, ihl + 8, length)
    }

    private fun extractFromIpv6Udp(packet: ByteArray, length: Int): String? {
        if (length < 48) return null
        if (packet[6].toInt() != PROTO_UDP) return null
        return parseQName(packet, 40 + 8, length)
    }

    private fun parseQName(packet: ByteArray, dnsOffset: Int, length: Int): String? {
        if (dnsOffset + 12 > length) return null
        var pos = dnsOffset + 12
        val sb = StringBuilder()
        while (pos < length) {
            val len = packet[pos].toInt() and 0xFF
            if (len == 0) break
            if (len >= 192) return null
            if (pos + 1 + len > length) return null
            if (sb.isNotEmpty()) sb.append('.')
            sb.append(String(packet, pos + 1, len, Charsets.US_ASCII))
            pos += len + 1
        }
        return if (sb.isEmpty()) null else sb.toString().lowercase()
    }

    /** 判断是否为 TCP DNS（v4/v6 通用，目标端口 53）。 */
    fun isTcpDns(packet: ByteArray, length: Int): Boolean {
        if (length < 4) return false
        return when ((packet[0].toInt() shr 4) and 0x0F) {
            4 -> {
                if (length < 24 || packet[9].toInt() != PROTO_TCP) false
                else {
                    val ihl = (packet[0].toInt() and 0x0F) * 4
                    length >= ihl + 4 && readU16BE(packet, ihl + 2) == DNS_PORT
                }
            }
            6 -> length >= 44 && packet[6].toInt() == PROTO_TCP && readU16BE(packet, 42) == DNS_PORT
            else -> false
        }
    }

    /** 构造 NXDOMAIN 响应。v4/v6 自动分发。 */
    fun buildNxDomainResponse(request: ByteArray, length: Int): ByteArray {
        return try {
            if ((request[0].toInt() shr 4) and 0x0F == 6) buildNxDomainV6(request, length)
            else buildNxDomainV4(request, length)
        } catch (e: Exception) { request.copyOf(length) }
    }

    private fun buildNxDomainV4(request: ByteArray, length: Int): ByteArray {
        val ihl = (request[0].toInt() and 0x0F) * 4
        val udpOffset = ihl
        val dnsOffset = udpOffset + 8
        if (length < dnsOffset + 12) return request.copyOf(length)
        val response = request.copyOf(length)

        for (i in 0 until 4) {
            val t = response[12 + i]; response[12 + i] = response[16 + i]; response[16 + i] = t
        }
        val sp = readU16BE(response, udpOffset)
        val dp = readU16BE(response, udpOffset + 2)
        writeU16BE(response, udpOffset, dp); writeU16BE(response, udpOffset + 2, sp)

        val rdBit = (response[dnsOffset + 2].toInt() and 0xFF) and 0x01
        response[dnsOffset + 2] = (0x80 or rdBit).toByte()
        response[dnsOffset + 3] = 0x83.toByte()
        for (i in 6..11) response[dnsOffset + i] = 0

        writeU16BE(response, 10, 0)
        writeU16BE(response, 10, ipv4Checksum(response, 0, ihl))
        writeU16BE(response, udpOffset + 6, 0)
        return response
    }

    private fun buildNxDomainV6(request: ByteArray, length: Int): ByteArray {
        if (length < 60) return request.copyOf(length)
        val udpOffset = 40
        val dnsOffset = udpOffset + 8
        val response = request.copyOf(length)

        for (i in 0 until 16) {
            val t = response[8 + i]; response[8 + i] = response[24 + i]; response[24 + i] = t
        }
        val sp = readU16BE(response, udpOffset)
        val dp = readU16BE(response, udpOffset + 2)
        writeU16BE(response, udpOffset, dp); writeU16BE(response, udpOffset + 2, sp)

        val rdBit = (response[dnsOffset + 2].toInt() and 0xFF) and 0x01
        response[dnsOffset + 2] = (0x80 or rdBit).toByte()
        response[dnsOffset + 3] = 0x83.toByte()
        for (i in 6..11) response[dnsOffset + i] = 0

        val udpLen = length - udpOffset
        writeU16BE(response, udpOffset + 6, 0)
        val ck = udp6Checksum(response, udpOffset, udpLen)
        writeU16BE(response, udpOffset + 6, if (ck == 0) 0xFFFF else ck)
        return response
    }

    internal fun ipv4Checksum(buf: ByteArray, offset: Int, len: Int): Int {
        var sum = 0
        var i = offset
        val end = offset + len
        while (i + 1 < end) { sum += readU16BE(buf, i); i += 2 }
        if (i < end) sum += (buf[i].toInt() and 0xFF) shl 8
        while (sum shr 16 != 0) sum = (sum and 0xFFFF) + (sum shr 16)
        return sum.inv() and 0xFFFF
    }

    internal fun udp6Checksum(buf: ByteArray, udpOffset: Int, udpLen: Int): Int {
        var sum = 0L
        for (i in 8..23 step 2) sum += readU16BE(buf, i).toLong()
        for (i in 24..39 step 2) sum += readU16BE(buf, i).toLong()
        sum += (udpLen ushr 16) and 0xFFFF
        sum += udpLen and 0xFFFF
        sum += 0x0011
        var i = udpOffset
        val end = udpOffset + udpLen
        while (i + 1 < end) { sum += readU16BE(buf, i).toLong(); i += 2 }
        if (i < end) sum += ((buf[i].toInt() and 0xFF) shl 8).toLong()
        while (sum ushr 16 != 0L) sum = (sum and 0xFFFF) + (sum ushr 16)
        return sum.inv().toInt() and 0xFFFF
    }

    internal fun readU16BE(buf: ByteArray, off: Int): Int =
        ((buf[off].toInt() and 0xFF) shl 8) or (buf[off + 1].toInt() and 0xFF)

    internal fun writeU16BE(buf: ByteArray, off: Int, value: Int) {
        buf[off] = ((value shr 8) and 0xFF).toByte()
        buf[off + 1] = (value and 0xFF).toByte()
    }
}
