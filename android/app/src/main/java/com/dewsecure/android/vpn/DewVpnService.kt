package com.dewsecure.android.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import com.dewsecure.android.policy.EngineBridge
import com.dewsecure.android.ui.MainActivity
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.util.Locale
import java.util.concurrent.Executors

class DewVpnService : VpnService() {

    private var vpnInterface: ParcelFileDescriptor? = null
    private var isRunning = false
    private val executor = Executors.newSingleThreadExecutor()
    private var upstreamDns = "223.5.5.5" // 默认上游，会被动态覆盖
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    companion object {
        private const val TAG = "DewVpnService"
        private const val CHANNEL_ID = "dewsecure_vpn"
        private const val NOTIFICATION_ID = 1001
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (isRunning) return START_STICKY

        startForeground(NOTIFICATION_ID, buildNotification())

        // 安全获取 ConnectivityManager，增加空指针保护
        val cm = getSystemService(ConnectivityManager::class.java)
        if (cm != null) {
            refreshUpstreamDns(cm)
            
            // 注册网络切换监听
            if (networkCallback == null) {
                networkCallback = object : ConnectivityManager.NetworkCallback() {
                    override fun onAvailable(network: Network) {
                        Log.i(TAG, "网络发生切换，刷新上游 DNS...")
                        refreshUpstreamDns(cm)
                    }
                }
                try {
                    cm.registerDefaultNetworkCallback(networkCallback!!)
                } catch (e: Exception) {
                    Log.e(TAG, "注册网络监听失败: ${e.message}")
                }
            }
        } else {
            Log.w(TAG, "无法获取 ConnectivityManager")
        }
        
        Log.i(TAG, "上游 DNS 最终配置: $upstreamDns")

        EngineBridge.init(aiEnabled = false)

        isRunning = true
        executor.execute { runVpnLoop() }
        return START_STICKY
    }

    /**
     * 动态刷新上游 DNS
     */
    private fun refreshUpstreamDns(cm: ConnectivityManager) {
        val activeNetwork = cm.activeNetwork
        val linkProperties = if (activeNetwork != null) cm.getLinkProperties(activeNetwork) else null
        
        // 优先使用当前系统网络的 IPv4 DNS（必须排除我们自己伪造的 10.0.0.1）
        val systemDns = linkProperties?.dnsServers?.firstOrNull { 
            it is java.net.Inet4Address && it.hostAddress != "10.0.0.1" 
        }?.hostAddress
        
        if (systemDns != null && systemDns != "10.0.0.1") {
            upstreamDns = systemDns
            Log.i(TAG, "✅ 成功获取真实系统上游 DNS: $upstreamDns")
        } else {
            // 兜底策略：如果抓到的只有 VPN 自身的虚拟 IP 或者抓取失败，使用公共 DNS
            val country = Locale.getDefault().country.uppercase()
            upstreamDns = if (country == "CN") "223.5.5.5" else "1.1.1.1"
            Log.w(TAG, "⚠️ 拦截到虚拟 DNS 或获取失败，强制启用回退: $upstreamDns")
        }
    }

    private fun runVpnLoop() {
        try {
            vpnInterface = Builder()
                .addAddress("10.0.0.2", 24)
                .addDnsServer("10.0.0.1")
                .addRoute("10.0.0.1", 32)
                .setMtu(1500)
                .setBlocking(true)
                .establish()

            val fd = vpnInterface?.fileDescriptor ?: return
            val inStream = FileInputStream(fd)
            val outStream = FileOutputStream(fd)
            val packet = ByteArray(32768)
            val socket = DatagramSocket()
            protect(socket) // 逃逸 VPN 路由，防止死循环

            while (isRunning) {
                val length = inStream.read(packet)
                if (length <= 0) continue

                val domain = DnsPacketCodec.extractDomain(packet, length)
                if (domain == null) continue

                val result = EngineBridge.shouldBlock(domain)
                if (result.decision != com.dewsecure.core.BlockDecision.ALLOW) {
                    Log.d(TAG, "🛑 拦截: $domain (${result.reason})")
                    val response = DnsPacketCodec.buildNxDomainResponse(packet, length)
                    outStream.write(response, 0, length)
                } else {
                    forwardToUpstream(packet, length, socket, outStream)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "VPN 循环异常", e)
        } finally {
            stopVpn()
        }
    }

    private fun forwardToUpstream(request: ByteArray, length: Int, socket: DatagramSocket, outStream: FileOutputStream) {
        var dnsToTry = upstreamDns
        
        // 尝试最多两次：第一次系统 DNS，第二次备用公共 DNS
        for (attempt in 0..1) {
            try {
                val ihl = (request[0].toInt() and 0x0F) * 4
                val dnsPayload = request.copyOfRange(ihl + 8, length)
                val upstreamAddr = InetAddress.getByName(dnsToTry)
                val sendPacket = DatagramPacket(dnsPayload, dnsPayload.size, upstreamAddr, 53)
                
                socket.soTimeout = 2000
                socket.send(sendPacket)

                val recvBuf = ByteArray(4096)
                val recvPacket = DatagramPacket(recvBuf, recvBuf.size)
                socket.receive(recvPacket)

                val upstreamDnsPayload = recvPacket.data.copyOfRange(recvPacket.offset, recvPacket.offset + recvPacket.length)
                
                // 1. 动态计算新包长度并分配空间
                val responsePacketSize = ihl + 8 + upstreamDnsPayload.size
                val responsePacket = ByteArray(responsePacketSize)
                
                // 2. 复制原来的 IP 头和 UDP 头
                System.arraycopy(request, 0, responsePacket, 0, ihl + 8)
                
                // 3. 复制上游返回的 DNS payload
                System.arraycopy(upstreamDnsPayload, 0, responsePacket, ihl + 8, upstreamDnsPayload.size)

                // 4. 更新 IP 头总长度 (偏移 2-3 字节)
                responsePacket[2] = ((responsePacketSize shr 8) and 0xFF).toByte()
                responsePacket[3] = (responsePacketSize and 0xFF).toByte()
                
                // 5. 更新 UDP 头长度 (偏移 ihl+4 到 ihl+5 字节)
                val udpLength = 8 + upstreamDnsPayload.size
                responsePacket[ihl + 4] = ((udpLength shr 8) and 0xFF).toByte()
                responsePacket[ihl + 5] = (udpLength and 0xFF).toByte()
                
                // 6. 将 UDP 校验和置 0（IPv4下表示不校验）
                responsePacket[ihl + 6] = 0
                responsePacket[ihl + 7] = 0

                // 7. 交换 IP 源和目的
                for (i in 0 until 4) {
                    val tmp = responsePacket[12 + i]
                    responsePacket[12 + i] = responsePacket[16 + i]
                    responsePacket[16 + i] = tmp
                }
                
                // 8. 交换 UDP 源端口和目的端口（完整 2 字节）
                val udpOffset = ihl
                val srcPortHigh = responsePacket[udpOffset]
                val srcPortLow = responsePacket[udpOffset + 1]
                responsePacket[udpOffset] = responsePacket[udpOffset + 2]
                responsePacket[udpOffset + 1] = responsePacket[udpOffset + 3]
                responsePacket[udpOffset + 2] = srcPortHigh
                responsePacket[udpOffset + 3] = srcPortLow

                // 9. 重新计算 IP 头校验和
                responsePacket[10] = 0
                responsePacket[11] = 0
                var sum = 0
                for (i in 0 until ihl step 2) {
                    sum += ((responsePacket[i].toInt() and 0xFF) shl 8) or (responsePacket[i + 1].toInt() and 0xFF)
                }
                while (sum shr 16 > 0) sum = (sum and 0xFFFF) + (sum shr 16)
                val checksum = sum.inv() and 0xFFFF
                responsePacket[10] = (checksum shr 8).toByte()
                responsePacket[11] = (checksum and 0xFF).toByte()

                // 10. 使用动态长度写入
                outStream.write(responsePacket, 0, responsePacketSize)
                return // 成功发送并接收，结束函数
            } catch (e: java.net.SocketTimeoutException) {
                Log.w(TAG, "上游 DNS 超时 ($dnsToTry)")
                if (attempt == 0) {
                    // 如果是局域网私有地址超时，优先切到国内公共 DNS，否则切国际
                    dnsToTry = if (upstreamDns.startsWith("10.") || upstreamDns.startsWith("192.168.") || upstreamDns.startsWith("172.")) {
                        "223.5.5.5"
                    } else {
                        "1.1.1.1"
                    }
                    Log.i(TAG, "降级切换至备用 DNS: $dnsToTry")
                } else {
                    Log.e(TAG, "备用 DNS 也超时，放弃本次请求")
                }
            } catch (e: Exception) {
                Log.w(TAG, "上游转发失败: $e")
                return // 其他异常直接结束
            }
        }
    }

    private fun stopVpn() {
        isRunning = false
        vpnInterface?.close()
        vpnInterface = null
        
        networkCallback?.let {
            val cm = getSystemService(ConnectivityManager::class.java)
            cm?.unregisterNetworkCallback(it)
            networkCallback = null
        }
        
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        stopVpn()
        super.onDestroy()
    }

    private fun buildNotification(): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("DewSecure 运行中")
            .setContentText("正在拦截广告与追踪域名")
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setContentIntent(pendingIntent)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID, "DewSecure VPN",
                NotificationManager.IMPORTANCE_LOW
            )
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }
}
