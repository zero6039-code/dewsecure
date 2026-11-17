package com.dewsecure.android.vpn

import android.app.PendingIntent
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import com.dewsecure.android.policy.EngineBridge
import com.dewsecure.core.VpnProtector
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
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

class DewVpnService : VpnService() {

    inner class ProtectorImpl : VpnProtector {
        override fun protectFd(fd: Int): Boolean {
            if (fd == -1) {
                Log.e(TAG, "🚨 收到 Rust 引擎死亡信号，正在紧急停止 VPN...")
                CoroutineScope(Dispatchers.IO).launch { stopVpn() }
                return true
            }
            return this@DewVpnService.protect(fd)
        }
    }

    private var vpnInterface: ParcelFileDescriptor? = null
    private var isRunning = false
    private val executor = Executors.newSingleThreadExecutor()
    private var upstreamDns = "223.5.5.5"
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var isStopping = false
    private val restartHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private val heartbeatManager by lazy { VpnHeartbeatManager(this) { stopVpn() } }

    companion object {
        private const val TAG = "DewVpnService"
        private const val CHANNEL_ID = "dewsecure_vpn"
        private const val NOTIFICATION_ID = 1001
        
        @Volatile var isRunningState = false
    }

    override fun onCreate() {
        super.onCreate()
        VpnNotificationManager.createChannel(this)
    }

        override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i(TAG, "🔥 onStartCommand 被调用，action: ${intent?.action}")
        
        // 🌟 处理热重启指令（用于分应用路由配置变更）
        if (intent?.action == "ACTION_RESTART_VPN") {
            Log.i(TAG, "🔄 收到热重启指令，正在安全重建 VPN...")
            stopVpn() // 清理旧 TUN 并彻底关闭当前服务
            
            // 延迟 2 秒，等系统彻底回收资源后再重新拉起
            restartHandler.postDelayed({
                if (!isStopping) {
                    isStopping = false // 重置状态准备新一次启动
                    val restartIntent = Intent(this@DewVpnService, DewVpnService::class.java)
                    androidx.core.content.ContextCompat.startForegroundService(this@DewVpnService, restartIntent)
                }
            }, 2000)
            return START_NOT_STICKY
        }

        if (intent?.action == "ACTION_STOP_VPN" || intent?.action == "STOP_DEW_SECURE_VPN") {
            Log.i(TAG, "🛑 收到关闭指令，开始销毁 VPN")
            // 🌟 强行重置所有标记，清空未执行的延迟任务，确保 TUN 必死无疑
            isStopping = false 
            restartHandler.removeCallbacksAndMessages(null)
            stopVpn()
            return START_NOT_STICKY
        }

        // 🌟 核心补丁：处理权限变更，不重启 TUN，直接热更新
        if (intent?.action == "ACTION_ENTITLEMENTS_CHANGED") {
            Log.i(TAG, "🔄 收到权限变更指令，重新检查云端模型...")
            val prefs = getSharedPreferences("user_session", MODE_PRIVATE)
            val cachedTier = prefs.getString("tier", "free") ?: "free"
            val isUserPro = cachedTier in listOf("pro", "premium", "trial", "trial-pro", "family", "sub-family", "family_sub")
            
            if (isUserPro) {
                Log.i(TAG, "✅ 权限确认为 Pro ($cachedTier)，触发模型拉取")
                CoroutineScope(Dispatchers.IO).launch {
                    UpdateManager.checkForUpdates(this@DewVpnService)
                }
            } else {
                Log.i(TAG, "🚫 权限变更为 Free，开始清理本地模型")
                EngineBridge.unloadAdblockModel()
                val fstFile = java.io.File(filesDir, "cloud_rules.fst")
                if (fstFile.exists()) fstFile.delete()
                val jsonFile = java.io.File(filesDir, "cloud_rules.json")
                if (jsonFile.exists()) jsonFile.delete()
                val weightsFile = java.io.File(filesDir, "cloud_weights.json")
                if (weightsFile.exists()) weightsFile.delete()
                
                getSharedPreferences("app_settings", MODE_PRIVATE).edit()
                    .remove("cloud_model_version")
                    .remove("cloud_rules_version")
                    .apply()
            }
            // 🌟 核心修复：如果收到刷新指令时 VPN 根本没在运行，更新完模型直接滚蛋，绝不建立 TUN！
            if (!isRunning) {
                Log.i(TAG, "🛑 VPN 未运行，处理完权限更新后自动销毁服务")
                stopSelf()
                return START_NOT_STICKY
            }
            return START_STICKY
        }

        if (isRunning) return START_STICKY
        startForeground(VpnNotificationManager.NOTIFICATION_ID, VpnNotificationManager.buildNotification(this))

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

        // A-09: 引擎由 DewSecureApplication.onCreate 统一初始化
        
        
        // 🌟 权限冷启动校验：非 Pro 强制卸载 AI
        val userPrefs = getSharedPreferences("user_session", MODE_PRIVATE)
        val cachedTier = userPrefs.getString("tier", "free") ?: "free"
        val isUserPro = cachedTier in listOf("pro", "premium", "trial", "trial-pro", "family", "sub-family", "family_sub")
        if (!isUserPro) {
            EngineBridge.unloadAdblockModel()
            
            Log.i(TAG, "🧹 [VPN冷启动] 判定为免费用户，执行本地 AI 缓存强制清理...")
            val fstFile = java.io.File(filesDir, "cloud_rules.fst")
            if (fstFile.exists()) {
                val res = fstFile.delete()
                Log.i(TAG, "🧹 cloud_rules.fst 删除结果: $res")
            }
            val jsonFile = java.io.File(filesDir, "cloud_rules.json")
            if (jsonFile.exists()) {
                val res = jsonFile.delete()
                Log.i(TAG, "🧹 cloud_rules.json 删除结果: $res")
            }
            
            getSharedPreferences("app_settings", MODE_PRIVATE).edit()
                .remove("cloud_model_version")
                .remove("cloud_rules_version")
                .apply()
        }

        // 从本地存储恢复开关状态并同步给 Rust 引擎
        val appPrefs = getSharedPreferences("app_settings", MODE_PRIVATE)
        EngineBridge.setEnableDnr(appPrefs.getBoolean("pref_v3_dnr", true))
        EngineBridge.setEnableTracker(appPrefs.getBoolean("pref_v3_tracker", true))
        EngineBridge.setEnableSocial(appPrefs.getBoolean("pref_v3_social", true))
        EngineBridge.setEnableThreatIntel(appPrefs.getBoolean("pref_v3_intel", true))
        EngineBridge.setEnableAiPhishing(appPrefs.getBoolean("pref_v3_ai_phishing", true))
        EngineBridge.setEnableAiZeroDay(appPrefs.getBoolean("pref_v3_ai_zero_day", true))

        // 🌟 初始化 MitM 总开关 (默认关闭，仅 Root 用户手动开启 Full-App Filtering 时生效)
        val isMitmFullAppEnabled = appPrefs.getBoolean("pref_mitm_full_app", false)
        EngineBridge.setMitmEnabled(isMitmFullAppEnabled)
        
        // 恢复历史统计数据及日志
        val statsPrefs = getSharedPreferences("stats_cache", MODE_PRIVATE)
        val savedTotal = statsPrefs.getLong("total", 0)
        val savedToday = statsPrefs.getLong("today", 0)
        val savedLogs = statsPrefs.getString("logs_json", "[]") ?: "[]"
        EngineBridge.setInitialStats(savedTotal, savedToday, savedLogs)
        
        // 触发云端热更新 (后台静默进行)
        // 🛡️ 修复：只有 Pro 用户才允许在 VPN 启动时拉取
        if (isUserPro) {
            CoroutineScope(Dispatchers.IO).launch {
                UpdateManager.checkForUpdates(this@DewVpnService)
            }
        } else {
            Log.i(TAG, "🚫 免费用户，跳过云端热更新拉取")
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
                .setMtu(1400)
                .setBlocking(false)

            val appPrefs = getSharedPreferences("app_settings", MODE_PRIVATE)
            val isDnsOnlyMode = appPrefs.getBoolean("pref_v3_dns_only", false)
            // A-02: 全隧道 vs DNS-only
            if (isDnsOnlyMode) {
                builder.addRoute("10.0.0.1", 32)
            } else {
                builder.addRoute("0.0.0.0", 0)
            }
            // 🌟 核心：读取分应用路由配置，踢出勾选直连的 App
            val allKeys = appPrefs.all
            var bypassCount = 0
            
            for ((key, value) in allKeys) {
                if (key.startsWith("routing_") && value is Boolean && value) {
                    val pkgName = key.removePrefix("routing_")
                    try {
                        builder.addDisallowedApplication(pkgName)
                        bypassCount++
                    } catch (e: Exception) {
                        Log.e(TAG, "添加绕过应用失败: $pkgName", e)
                    }
                }
            }
            
            if (bypassCount > 0) {
                Log.i(TAG, "🛡️ 成功配置 $bypassCount 个应用绕过 VPN 直连")
            } else {
                Log.i(TAG, "🛡️ 当前无应用需要绕过 VPN")
            }

            // P0-E: 排除自身进程，避免 hudsucker/DNS 出站被 VPN 再次捕获
            builder.addDisallowedApplication(packageName)

            vpnInterface = builder.establish()
            // 🌟 核心改动：提取原生文件描述符 (Int)，并彻底移交给 Rust
            val fdInt = vpnInterface?.fd ?: return

            // 启动 Rust 侧的 VPN 引擎，传入 TUN 句柄和 filesDir
            val filesDir = applicationContext.filesDir.absolutePath
            val res = EngineBridge.startMitmVpnEngine(fdInt, filesDir, ProtectorImpl())
            Log.i(TAG, "Rust VPN Engine 启动状态: $res")

              // A-03: 校验启动结果，防止 UI 虚报已保护
              if (res != "OK") {
                  Log.e(TAG, "❌ Rust VPN 引擎启动失败，强制停止服务: $res")
                  stopVpn()
                  return
              }

            // 🌟 启动后台心跳
            heartbeatManager.start()

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
        if (isStopping) return
        isStopping = true
        Log.i(TAG, "🛑 [强杀] 收到停止命令，立即销毁 VPN")
        
        // 核心：清除所有未执行的延迟任务（包括幽灵重启）
        restartHandler.removeCallbacksAndMessages(null)
        isRunning = false
        isRunningState = false
        heartbeatManager.stop()
        TcpDnsRelay.removeAll()

        // 1. 通知 Rust 立即释放资源（异步）
        Thread {
            try {
                EngineBridge.stopMitmVpnEngine()
                Log.i(TAG, "✅ [强杀] Rust 引擎退出信号已发送")
            } catch (e: Throwable) {}
        }.start()

        // 2. 强行关闭 Kotlin 侧的 TUN 接口
        try {
            vpnInterface?.close()
            Log.i(TAG, "✅ [强杀] TUN 接口已关闭")
        } catch (e: Exception) {
            Log.e(TAG, "关闭 TUN 失败", e)
        }
        vpnInterface = null

        // 3. 清理网络回调
        networkCallback?.let {
            val cm = getSystemService(ConnectivityManager::class.java)
            try { cm?.unregisterNetworkCallback(it) } catch (e: Exception) {}
            networkCallback = null
        }

        // 4. 强制销毁 Service
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        Log.i(TAG, "✅ [强杀] VPN 服务已彻底销毁")
    }


    override fun onRevoke() {
        Log.w(TAG, "⚠️ VPN 权限被系统或其他 VPN 抢占，正在紧急关闭...")
        stopVpn()
        super.onRevoke()
    }

    override fun onDestroy() {
        stopVpn()
        isStopping = false // 重置
        super.onDestroy()
    }

} // 类的结尾大括号

