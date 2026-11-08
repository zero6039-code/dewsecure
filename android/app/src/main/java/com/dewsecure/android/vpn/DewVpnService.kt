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
                        Log.i(TAG, "网络切换，刷新上游 DNS...")
                        refreshUpstreamDns(cm)
                        TcpDnsRelay.setUpstreamDns(upstreamDns)
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
        TcpDnsRelay.setUpstreamDns(upstreamDns)

        EngineBridge.init(aiEnabled = false)

        isRunning = true
        executor.execute { runVpnLoop() }
        return START_STICKY
    }

    private fun refreshUpstreamDns(cm: ConnectivityManager) {
        val activeNetwork = cm.activeNetwork
        val linkProperties = if (activeNetwork != null) cm.getLinkProperties(activeNetwork) else null
        val systemDns = linkProperties?.dnsServers?.firstOrNull {
            it is java.net.Inet4Address && it.hostAddress != "10.0.0.1"
        }?.hostAddress

        if (systemDns != null && systemDns != "10.0.0.1") {
            upstreamDns = systemDns
            Log.i(TAG, "✅ 真实系统上游 DNS: $upstreamDns")
        } else {
            val country = Locale.getDefault().country.uppercase()
            upstreamDns = if (country == "CN") "223.5.5.5" else "1.1.1.1"
            Log.w(TAG, "⚠️ 回退到公共 DNS: $upstreamDns")
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
                    handlePacket(packet, length, socket, outStream)
                } catch (e: Exception) {
                    Log.w(TAG, "单次循环异常，继续运行", e)
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
        if (domain == null) {
            outStream.write(DnsForwarder.buildServfailResponse(packet, length))
            return
        }
        val result = EngineBridge.shouldBlock(domain)
        if (result.decision != com.dewsecure.core.BlockDecision.ALLOW) {
            Log.i(TAG, "🛑 拦截: $domain (${result.reason})")
            outStream.write(DnsPacketCodec.buildNxDomainResponse(packet, length))
        } else {
            DnsForwarder.forward(packet, length, socket, outStream, upstreamDns)
        }
    }

    private fun stopVpn() {
        isRunning = false
        TcpDnsRelay.removeAll()
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
