package com.dewsecure.android.vpn

import java.nio.ByteBuffer

object DnsPacketCodec {

    /**
     * 从完整的 IPv4 UDP DNS 报文中提取域名。
     * 如果解析失败，返回 null，交由上游处理（放行）。
     */
    fun extractDomain(packet: ByteArray, length: Int): String? {
        try {
            // IPv4 Header 最小 20 字节，IHL 字段在低 4 位
            if (length < 28) return null
            val ihl = (packet[0].toInt() and 0x0F) * 4
            // 检查是否为 UDP 协议 (17)
            if (packet[9].toInt() != 17) return null
            
            // UDP Header 8 字节，DNS Payload 从 ihl + 8 开始
            val dnsOffset = ihl + 8
            
            // DNS Header 12 字节，QNAME 从第 12 字节开始
            var pos = dnsOffset + 12
            val sb = StringBuilder()
            
            while (pos < length) {
                val len = packet[pos].toInt() and 0xFF
                if (len == 0) break // 域名结束
                if (len >= 192) return null // 不支持压缩指针 (如指向前面的报文)
                if (pos + 1 + len > length) return null
                
                // 提取标签，并用 . 连接
                if (sb.isNotEmpty()) sb.append('.')
                sb.append(String(packet, pos + 1, len, Charsets.US_ASCII))
                pos += len + 1
            }
            return sb.toString().lowercase()
        } catch (e: Exception) {
            return null
        }
    }

    /**
     * 构造一个 DNS NXDOMAIN 响应包（告诉系统该域名不存在）。
     */
    fun buildNxDomainResponse(request: ByteArray, length: Int): ByteArray {
        val ihl = (request[0].toInt() and 0x0F) * 4
        val udpOffset = ihl
        val dnsOffset = udpOffset + 8
        val dnsLength = length - dnsOffset
        
        val response = request.copyOf(length)
        
        // 1. 交换 IP 源和目的地址 (各 4 字节)
        for (i in 0 until 4) {
            val tmp = response[12 + i]
            response[12 + i] = response[16 + i]
            response[16 + i] = tmp
        }
        
        // 2. 交换 UDP 源端口和目的端口
        val srcPort = ((response[udpOffset].toInt() and 0xFF) shl 8) or (response[udpOffset + 1].toInt() and 0xFF)
        val dstPort = ((response[udpOffset + 2].toInt() and 0xFF) shl 8) or (response[udpOffset + 3].toInt() and 0xFF)
        response[udpOffset] = (dstPort shr 8).toByte()
        response[udpOffset + 1] = (dstPort and 0xFF).toByte()
        response[udpOffset + 2] = (srcPort shr 8).toByte()
        response[udpOffset + 3] = (srcPort and 0xFF).toByte()

        // 3. 构造 DNS 响应头部
        // Flags: QR=1 (Response), RD=1 (copy from req), RA=1, RCODE=3 (NXDOMAIN)
        response[dnsOffset + 2] = 0x81.toByte() 
        response[dnsOffset + 3] = 0x83.toByte() // 1000 0011 (NXDOMAIN)
        
        // ANCOUNT, NSCOUNT, ARCOUNT 置 0
        response[dnsOffset + 6] = 0
        response[dnsOffset + 7] = 0
        response[dnsOffset + 8] = 0
        response[dnsOffset + 9] = 0
        response[dnsOffset + 10] = 0
        response[dnsOffset + 11] = 0

        // 4. 重新计算 IP 校验和
        response[10] = 0
        response[11] = 0
        var sum = 0
        for (i in 0 until ihl step 2) {
            sum += ((response[i].toInt() and 0xFF) shl 8) or (response[i + 1].toInt() and 0xFF)
        }
        while (sum shr 16 > 0) sum = (sum and 0xFFFF) + (sum shr 16)
        val checksum = sum.inv() and 0xFFFF
        response[10] = (checksum shr 8).toByte()
        response[11] = (checksum and 0xFF).toByte()

        return response
    }
}
