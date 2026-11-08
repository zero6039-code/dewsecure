package com.dewsecure.android.vpn

import android.util.Log
import java.io.OutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.SocketTimeoutException

/**
 * 转发 DNS 到上游并构造响应包写回 TUN。
 * v4/v6 双路径，全失败时回 SERVFAIL（让系统快速重试而非傻等超时）。
 */
object DnsForwarder {
    private const val TAG = "DnsForwarder"

    fun forward(request: ByteArray, length: Int, socket: DatagramSocket,
                outStream: OutputStream, initialDns: String) {
        try {
            val version = (request[0].toInt() shr 4) and 0x0F
            val ok = when (version) {
                4 -> forwardV4(request, length, socket, outStream, initialDns)
                6 -> forwardV6(request, length, socket, outStream, initialDns)
                else -> false
            }
            if (!ok) outStream.write(buildServfailResponse(request, length))
        } catch (e: Exception) {
            Log.w(TAG, "forward 异常", e)
            try { outStream.write(buildServfailResponse(request, length)) } catch (_: Exception) {}
        }
    }

    private fun forwardV4(request: ByteArray, length: Int, socket: DatagramSocket,
                          outStream: OutputStream, initialDns: String): Boolean {
        var dnsToTry = initialDns
        for (attempt in 0..1) {
            try {
                val ihl = (request[0].toInt() and 0x0F) * 4
                if (length < ihl + 8) return false
                val dnsPayload = request.copyOfRange(ihl + 8, length)
                val upstreamAddr = InetAddress.getByName(dnsToTry)
                socket.soTimeout = 2000
                socket.send(DatagramPacket(dnsPayload, dnsPayload.size, upstreamAddr, 53))
                val recvBuf = ByteArray(4096)
                val recvPacket = DatagramPacket(recvBuf, recvBuf.size)
                socket.receive(recvPacket)
                val up = recvPacket.data.copyOfRange(recvPacket.offset, recvPacket.offset + recvPacket.length)

                val size = ihl + 8 + up.size
                val rp = ByteArray(size)
                System.arraycopy(request, 0, rp, 0, ihl + 8)
                System.arraycopy(up, 0, rp, ihl + 8, up.size)
                DnsPacketCodec.writeU16BE(rp, 2, size)
                DnsPacketCodec.writeU16BE(rp, ihl + 4, 8 + up.size)
                DnsPacketCodec.writeU16BE(rp, ihl + 6, 0)

                for (i in 0 until 4) {
                    val t = rp[12 + i]; rp[12 + i] = rp[16 + i]; rp[16 + i] = t
                }
                val sp = DnsPacketCodec.readU16BE(rp, ihl)
                val dp = DnsPacketCodec.readU16BE(rp, ihl + 2)
                DnsPacketCodec.writeU16BE(rp, ihl, dp)
                DnsPacketCodec.writeU16BE(rp, ihl + 2, sp)
                DnsPacketCodec.writeU16BE(rp, 10, 0)
                DnsPacketCodec.writeU16BE(rp, 10, DnsPacketCodec.ipv4Checksum(rp, 0, ihl))

                outStream.write(rp, 0, size)
                return true
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

    private fun forwardV6(request: ByteArray, length: Int, socket: DatagramSocket,
                          outStream: OutputStream, initialDns: String): Boolean {
        var dnsToTry = if (isIpv4(initialDns)) initialDns else "1.1.1.1"
        for (attempt in 0..1) {
            try {
                if (length < 48) return false
                val udpOffset = 40
                val dnsPayload = request.copyOfRange(udpOffset + 8, length)
                val upstreamAddr = InetAddress.getByName(dnsToTry)
                socket.soTimeout = 2000
                socket.send(DatagramPacket(dnsPayload, dnsPayload.size, upstreamAddr, 53))
                val recvBuf = ByteArray(4096)
                val recvPacket = DatagramPacket(recvBuf, recvBuf.size)
                socket.receive(recvPacket)
                val up = recvPacket.data.copyOfRange(recvPacket.offset, recvPacket.offset + recvPacket.length)

                val size = udpOffset + 8 + up.size
                val rp = ByteArray(size)
                System.arraycopy(request, 0, rp, 0, udpOffset + 8)
                System.arraycopy(up, 0, rp, udpOffset + 8, up.size)
                DnsPacketCodec.writeU16BE(rp, 4, 8 + up.size)
                DnsPacketCodec.writeU16BE(rp, udpOffset + 4, 8 + up.size)

                for (i in 0 until 16) {
                    val t = rp[8 + i]; rp[8 + i] = rp[24 + i]; rp[24 + i] = t
                }
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

    private fun isIpv4(host: String): Boolean = host.matches(Regex("^\\d+\\.\\d+\\.\\d+\\.\\d+$"))

    fun buildServfailResponse(request: ByteArray, length: Int): ByteArray {
        val response = request.copyOf(length)
        try {
            if ((response[0].toInt() shr 4) and 0x0F == 4) {
                val ihl = (response[0].toInt() and 0x0F) * 4
                val udpOffset = ihl
                val dnsOffset = udpOffset + 8
                if (length < dnsOffset + 12) return response
                for (i in 0 until 4) {
                    val t = response[12 + i]; response[12 + i] = response[16 + i]; response[16 + i] = t
                }
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
                for (i in 0 until 16) {
                    val t = response[8 + i]; response[8 + i] = response[24 + i]; response[24 + i] = t
                }
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
