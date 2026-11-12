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
import com.dewsecure.android.policy.UpdateManager
import com.dewsecure.android.policy.AuthManager
import com.dewsecure.android.ui.MainActivity
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.DatagramSocket
import java.util.Locale
import java.util.concurrent.Executors
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

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
        
        @Volatile var isRunningState = false
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
        
        
        // 🌟 权限冷启动校验：非 Pro 强制卸载 AI
        val userPrefs = getSharedPreferences("user_session", MODE_PRIVATE)
        val cachedTier = userPrefs.getString("tier", "free") ?: "free"
        val isUserPro = cachedTier in listOf("pro", "premium", "trial", "trial-pro", "family", "sub-family", "family_sub")
        if (!isUserPro) {
            EngineBridge.unloadAdblockModel()
            val modelDir = java.io.File(filesDir, "models")
            if (modelDir.exists()) modelDir.deleteRecursively()
        }

        // 从本地存储恢复开关状态并同步给 Rust 引擎
        val appPrefs = getSharedPreferences("app_settings", MODE_PRIVATE)
        EngineBridge.setEnableDnr(appPrefs.getBoolean("pref_v3_dnr", true))
        EngineBridge.setEnableTracker(appPrefs.getBoolean("pref_v3_tracker", true))
        EngineBridge.setEnableSocial(appPrefs.getBoolean("pref_v3_social", true))
        EngineBridge.setEnableThreatIntel(appPrefs.getBoolean("pref_v3_intel", true))
        EngineBridge.setEnableAiPhishing(appPrefs.getBoolean("pref_v3_ai_phishing", true))
        EngineBridge.setEnableAiZeroDay(appPrefs.getBoolean("pref_v3_ai_zero_day", true))
        
        // 恢复历史统计数据及日志
        val statsPrefs = getSharedPreferences("stats_cache", MODE_PRIVATE)
        val savedTotal = statsPrefs.getLong("total", 0)
        val savedToday = statsPrefs.getLong("today", 0)
        val savedLogs = statsPrefs.getString("logs_json", "[]") ?: "[]"
        EngineBridge.setInitialStats(savedTotal, savedToday, savedLogs)
        
        // 触发云端热更新 (后台静默进行)
        CoroutineScope(Dispatchers.IO).launch {
            UpdateManager.checkForUpdates(this@DewVpnService)
        }

        Log.i(TAG, "🔥 VPN 服务已成功启动，底层引擎初始化完毕，已恢复历史数据")
        isRunningState = true

        isRunning = true
        executor.execute { runVpnLoop() }
        return START_STICKY
    }


    private fun refreshUpstreamDns(cm: ConnectivityManager) {
        val linkProperties = cm.getLinkProperties(cm.activeNetwork)
        val systemDns = linkProperties?.dnsServers?.firstOrNull {
            it is java.net.Inet4Address && it.hostAddress != "10.0.0.1"
        }?.hostAddress

        if (systemDns != null && systemDns != "10.0.0.1") {
            upstreamDns = systemDns
        } else {
            upstreamDns = if (Locale.getDefault().country.uppercase() == "CN") "223.5.5.5" else "1.1.1.1"
        }
    }

    private fun runVpnLoop() {
        try {
            val builder = Builder()
                .addAddress("10.0.0.2", 24)
                .addAddress("fd00::2", 120)
                .addDnsServer("10.0.0.1")
                .addDnsServer("fd00::1")
                .addRoute("10.0.0.1", 32)
                .addRoute("fd00::1", 128)
                .addRoute("0.0.0.0", 0) // 接管所有 IPv4 流量
                .addRoute("::", 0)      // 接管所有 IPv6 流量
                .setMtu(1500)
                .setBlocking(false)

            // 🌟 核心：读取分应用路由配置，踢出勾选直连的 App
            val appPrefs = getSharedPreferences("app_settings", MODE_PRIVATE)
            val allKeys = appPrefs.all
            var bypassCount = 0
            for ((key, value) in allKeys) {
                if (key.startsWith("routing_") && value == true) {
                    val pkg = key.removePrefix("routing_")
                    try {
                        builder.addDisallowedApplication(pkg)
                        bypassCount++
                    } catch (e: Exception) {
                        Log.e(TAG, "无法绕过应用: $pkg", e)
                    }
                }
            }
            if (bypassCount > 0) {
                Log.i(TAG, "🛡️ 成功配置 $bypassCount 个应用绕过 VPN 直连")
            }

            vpnInterface = builder.establish()
            // 🌟 核心改动：提取原生文件描述符 (Int)，并彻底移交给 Rust
            val fdInt = vpnInterface?.detachFd() ?: return

            // 启动 Rust 侧的 VPN 引擎，传入 TUN 句柄
            val res = EngineBridge.startMitmVpnEngine(fdInt)
            Log.i(TAG, "Rust VPN Engine 启动状态: $res")

            // Kotlin 侧不再读取 TUN 数据，保持后台线程存活即可
            while (isRunning) {
                Thread.sleep(1000)
            }
        } catch (e: Exception) {
            Log.e(TAG, "VPN 循环整体异常", e)
        } finally {
            stopVpn()
        }
    }





    private fun stopVpn() {
        isRunning = false
        isRunningState = false
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
