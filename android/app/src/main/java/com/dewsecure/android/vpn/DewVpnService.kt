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
import java.net.DatagramSocket
import java.util.Locale
import java.util.concurrent.Executors

class DewVpnService : VpnService() {

    private var vpnInterface: ParcelFileDescriptor? = null
    private var isRunning = false
    private val executor = Executors.newSingleThreadExecutor()
    private val packetPool = Executors.newFixedThreadPool(10) // D-3: 包处理线程池
    private var upstreamDns = "223.5.5.5"
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

        val cm = getSystemService(ConnectivityManager::class.java)
        if (cm != null) {
            refreshUpstreamDns(cm)
            if (networkCallback == null) {
                networkCallback = object : ConnectivityManager.NetworkCallback() {
                    override fun onAvailable(network: Network) {
                        refreshUpstreamDns(cm)
                        TcpDnsRelay.setUpstreamDns(upstreamDns)
                    }
                }
                try { cm.registerDefaultNetworkCallback(networkCallback!!) } catch (e: Exception) {}
            }
        }
        TcpDnsRelay.setUpstreamDns(upstreamDns)

        EngineBridge.init(aiEnabled = false)
        Log.i(TAG, "🔥 VPN 服务已成功启动，底层引擎初始化完毕")

        isRunning = true
        executor.execute { runVpnLoop() }
        return START_STICKY
    }

    private fun refreshUpstreamDns(cm: ConnectivityManager) {
        // D-4 修复：获取非 VPN 的底层网络，防止死循环
        val networks = cm.allNetworks
        var systemDns: String? = null
        for (network in networks) {
            val caps = cm.getNetworkCapabilities(network)
            if (caps != null && caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_VPN)) continue // 跳过 VPN
            val lp = cm.getLinkProperties(network)
            val dns = lp?.dnsServers?.firstOrNull { it is java.net.Inet4Address }?.hostAddress
            if (dns != null && dns != "10.0.0.1") {
                systemDns = dns
                break
            }
        }

        if (systemDns != null) {
            upstreamDns = systemDns
        } else {
            upstreamDns = if (Locale.getDefault().country.uppercase() == "CN") "223.5.5.5" else "1.1.1.1"
        }
    }

    private fun runVpnLoop() {
        try {
            vpnInterface = Builder()
                .addAddress("10.0.0.2", 24)
                .addAddress("fd00::2", 120)
                .addDnsServer("10.0.0.1")
                .addDnsServer("fd00::1")
                .addRoute("10.0.0.1", 32)
                .addRoute("fd00::1", 128)
                .setMtu(1500)
                .setBlocking(true)
                .establish()

            val fd = vpnInterface?.fileDescriptor ?: return
            val inStream = FileInputStream(fd)
            val outStream = FileOutputStream(fd)
            val packet = ByteArray(32768)
            val socket = DatagramSocket()
            protect(socket)

            while (isRunning) {
                try {
                    val length = inStream.read(packet)
                    if (length <= 0) continue
                    // D-3 修复：丢入线程池处理，不阻塞读包
                    val copyPacket = packet.copyOf(length)
                    packetPool.execute { 
                        try { handlePacket(copyPacket, length, outStream) } catch(e: Exception) { Log.w(TAG, "包处理异常", e) }
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "单次循环异常", e)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "VPN 循环整体异常", e)
        } finally {
            stopVpn()
        }
    }

    private fun handlePacket(packet: ByteArray, length: Int,
                             socket: DatagramSocket, outStream: FileOutputStream) {
        if (DnsPacketCodec.isTcpDns(packet, length)) {
            TcpDnsRelay.handle(packet, length, outStream, this)
            return
        }
        
        val domain = DnsPacketCodec.extractDomain(packet, length)
        
        // 探针：打印所有经过 VPN 的 DNS 请求
        if (domain != null) {
            if (BuildConfig.DEBUG) Log.d(TAG, "🔍 抓到 DNS 请求: $domain")
        } else {
            // 如果返回 null，可能是解析失败或非 UDP DNS
            return
        }

        val result = EngineBridge.shouldBlock(domain)
        if (result.decision != com.dewsecure.core.BlockDecision.ALLOW) {
            if (BuildConfig.DEBUG) Log.i(TAG, "🛑 拦截: $domain (${result.reason})")
            outStream.write(DnsPacketCodec.buildNxDomainResponse(packet, length))
        } else {
            if (BuildConfig.DEBUG) Log.d(TAG, "✅ 放行: $domain (原因: ${result.reason})")
            DnsForwarder.forward(packet, length, outStream, upstreamDns, ::protect)
        }
    }

    private fun stopVpn() {
        isRunning = false
        TcpDnsRelay.removeAll()
        TcpDnsRelay.releaseService()
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

    override fun onRevoke() {
        stopVpn()
        super.onRevoke()
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
