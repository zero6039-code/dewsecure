package com.dewsecure.android.ui

import android.app.Activity
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import android.content.Intent
import android.net.VpnService
import android.os.Bundle
import android.util.Log
import androidx.appcompat.app.AppCompatActivity
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.dewsecure.android.BuildConfig
import com.dewsecure.android.R
import com.dewsecure.android.policy.AuthManager
import com.dewsecure.android.policy.EngineBridge
import com.dewsecure.android.policy.DeviceManager
import com.dewsecure.android.vpn.DewVpnService
import com.google.android.material.bottomnavigation.BottomNavigationView
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {

    private lateinit var homeFragment: HomeFragment
    private lateinit var protectionFragment: ProtectionFragment
    private lateinit var settingsFragment: SettingsFragment

    private fun recreateBottomNavIfNeeded() {
        // BottomNavigationView 的文字会自动从新资源加载，无需额外操作
    }

    override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
        super.onConfigurationChanged(newConfig)
        Log.i("LocaleEngine", "Configuration changed: ${newConfig.locales.toLanguageTags()}")

        // 获取当前显示的 Tab
        val bottomNav = findViewById<BottomNavigationView>(R.id.bottom_navigation)

        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(bottomNav) { v, insets ->
            val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            v.updatePadding(bottom = systemBars.bottom)
            insets
        }
        val selectedId = bottomNav.selectedItemId

        // 🌟 核心修复：彻底销毁并重建所有 Fragment，保证 100% 语言刷新，杜绝 View 重叠
        supportFragmentManager.beginTransaction().apply {
            supportFragmentManager.fragments.forEach { remove(it) }
            commitAllowingStateLoss()
        }

        homeFragment = HomeFragment()
        protectionFragment = ProtectionFragment()
        settingsFragment = SettingsFragment()

        supportFragmentManager.beginTransaction().apply {
            add(R.id.fragment_container, homeFragment, "HOME")
            add(R.id.fragment_container, protectionFragment, "PROTECTION")
            add(R.id.fragment_container, settingsFragment, "SETTINGS")

            when (selectedId) {
                R.id.nav_home -> { show(homeFragment); hide(protectionFragment); hide(settingsFragment) }
                R.id.nav_protection -> { hide(homeFragment); show(protectionFragment); hide(settingsFragment) }
                R.id.nav_settings -> { hide(homeFragment); hide(protectionFragment); show(settingsFragment) }
            }
            commitAllowingStateLoss()
        }

        refreshBottomNavigation()
    }

    private fun refreshBottomNavigation() {
        val bottomNav = findViewById<BottomNavigationView>(R.id.bottom_navigation) ?: return
        val menu = bottomNav.menu
        // 🌟 绝对不重新 inflate，只精准修改文本，保证状态和监听器不死锁
        menu.findItem(R.id.nav_home)?.title = getString(R.string.nav_home)
        menu.findItem(R.id.nav_protection)?.title = getString(R.string.nav_protection)
        menu.findItem(R.id.nav_settings)?.title = getString(R.string.nav_settings)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 🌟 清理 Native Crash 残留的僵尸通知
        val nm = getSystemService(NOTIFICATION_SERVICE) as android.app.NotificationManager
        nm.cancel(1001)
        // 同时清理所有渠道
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            nm.deleteNotificationChannel("dewsecure_vpn")
            com.dewsecure.android.vpn.VpnNotificationManager.createChannel(this)
        }
        android.util.Log.i("MainActivity", "🧹 僵尸通知已清理")

        // 🌟 清理由于 Native Crash 残留的僵尸通知
        if (!com.dewsecure.android.vpn.DewVpnService.isRunningState) {
            androidx.core.app.NotificationManagerCompat.from(this).cancel(1001)
            android.util.Log.i("MainActivity", "🧹 已清理可能残留的 VPN 通知")
        }
        
        
        val prefs = getSharedPreferences("app_settings", MODE_PRIVATE)
        if (!prefs.contains("install_date")) {
            val sdf = java.text.SimpleDateFormat("d/M/yyyy", java.util.Locale.getDefault())
            prefs.edit().putString("install_date", sdf.format(java.util.Date())).apply()
        }
        setContentView(R.layout.activity_main)

        // 🌟 顶部 inset 直接设在 fragment_container，用 ignoringVisibility 防 Honor 返回 0
        val fc = findViewById<android.view.View>(R.id.fragment_container)
        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(fc) { v, ins ->
            val top = ins.getInsetsIgnoringVisibility(WindowInsetsCompat.Type.statusBars()).top
            android.util.Log.w("InsetDebug", "fc.statusBars.top=" + top)
            v.setPadding(0, top, 0, 0)
            ins
        }

        // 🌟 动态处理 Edge-to-Edge 安全区，兼容华为/荣耀等各厂商
        androidx.core.view.WindowCompat.setDecorFitsSystemWindows(window, false)
        val rootView = findViewById<android.view.View>(android.R.id.content)
        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(rootView) { view, insets ->
            val systemBars = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars())
            val fragmentContainer = findViewById<android.view.View>(R.id.fragment_container)
            val bottomNav = findViewById<android.view.View>(R.id.bottom_navigation)
            
            // 顶部：防止顶进状态栏（时间/电量）
            android.util.Log.w("InsetDebug", "content.systemBars.top=" + systemBars.top)
            
            // 底部：使用 paddingBottom 确保内容不被系统导航栏遮挡，同时保持 View 贴底
            bottomNav.setPadding(0, 0, 0, systemBars.bottom)
            
            insets
        }


        val bottomNav = findViewById<BottomNavigationView>(R.id.bottom_navigation)
        
        // 首次初始化，把三个 Fragment 都 add 进去，但只显示 Home
        if (savedInstanceState == null) {
            homeFragment = HomeFragment()
            protectionFragment = ProtectionFragment()
            settingsFragment = SettingsFragment()
            supportFragmentManager.beginTransaction().apply {
                add(R.id.fragment_container, homeFragment, "HOME")
                add(R.id.fragment_container, protectionFragment, "PROTECTION").hide(protectionFragment)
                add(R.id.fragment_container, settingsFragment, "SETTINGS").hide(settingsFragment)
                commit()
            }
        } else {
            // 🌟 核心修复：当发生语言切换重建时，从 FragmentManager 里找回旧实例，防止黑屏
            homeFragment = supportFragmentManager.findFragmentByTag("HOME") as HomeFragment
            protectionFragment = supportFragmentManager.findFragmentByTag("PROTECTION") as ProtectionFragment
            settingsFragment = supportFragmentManager.findFragmentByTag("SETTINGS") as SettingsFragment
        }

        bottomNav.setOnItemSelectedListener { item ->
            when (item.itemId) {
                R.id.nav_home -> { switchFragment(homeFragment); true }
                R.id.nav_protection -> { switchFragment(protectionFragment); true }
                R.id.nav_settings -> { switchFragment(settingsFragment); true }
                else -> false
            }
        }

        // A-09: 引擎由 DewSecureApplication.onCreate 统一初始化
        val statsPrefs = getSharedPreferences("stats_cache", MODE_PRIVATE)
        val savedTotal = statsPrefs.getLong("total", 0)
        val savedToday = statsPrefs.getLong("today", 0)
        val savedLogs = statsPrefs.getString("logs_json", "[]") ?: "[]"
        EngineBridge.setInitialStats(savedTotal, savedToday, savedLogs)

        // 自动同步云端白名单
        val userPrefs = getSharedPreferences("user_session", MODE_PRIVATE)
        val accessToken = userPrefs.getString("access_token", null)
        if (accessToken != null) {
            lifecycleScope.launch {
                val result = AuthManager.fetchCloudWhitelist(this@MainActivity, accessToken)
                if (result.isSuccess) {
                    val domains = result.getOrNull() ?: emptyList()
                    // A-19 修复：云端白名单先校验 + 合并本地，避免覆盖与注入非法后缀
                    val valid = domains.mapNotNull { com.dewsecure.android.policy.WhitelistStore.normalize(it) }
                    val local = com.dewsecure.android.policy.WhitelistStore.readLocal(this@MainActivity)
                    val merged = (local + valid).distinct()
                    EngineBridge.loadUserWhitelist(merged)
                    com.dewsecure.android.policy.WhitelistStore.writeLocal(this@MainActivity, merged)
                    Log.i("MainActivity", "云端白名单同步成功，有效 ${valid.size}/${domains.size} 条，合并后共 ${merged.size} 条")
                }
            }
        }

        // 🚀 权限门禁：仅当已登录且本地判定为 Pro 时，才拉取云端模型和规则
        // 修复：必须同时满足 accessToken 不为空，且 email 不为空
        val isPro = userPrefs.getBoolean("is_pro", false)
        val userEmail = userPrefs.getString("email", null)
        
        if (accessToken != null && userEmail != null && isPro) {
            lifecycleScope.launch(kotlinx.coroutines.Dispatchers.IO) {
                com.dewsecure.android.policy.UpdateManager.checkForUpdates(this@MainActivity)
            }
        } else {
            // 未登录或非 Pro 用户：卸载模型，清空本地缓存
            Log.e("MainActivity", "当前为非 Pro 或未登录状态，已强制卸载 AI 模型")
            EngineBridge.unloadAdblockModel()
            getSharedPreferences("app_settings", MODE_PRIVATE).edit()
                .remove("cloud_model_version")
                .remove("cloud_rules_version")
                .apply()
        }

        // [A-25 修复] 动态申请 Android 13+ 通知权限
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            if (androidx.core.content.ContextCompat.checkSelfPermission(this, android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                androidx.core.app.ActivityCompat.requestPermissions(this, arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 1002)
            }
        }
    }



    private fun checkSignature() {
        val expectedSha256 = "466148368e4ac99e726c4cfdbef150a88df78370c5a846b14c9ab017ff22761c"
        
        try {
            val pm = packageManager
            val packageInfo = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                pm.getPackageInfo(packageName, android.content.pm.PackageManager.GET_SIGNING_CERTIFICATES)
            } else {
                @Suppress("DEPRECATION")
                pm.getPackageInfo(packageName, android.content.pm.PackageManager.GET_SIGNATURES)
            }
            
            val signatures = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                packageInfo.signingInfo?.apkContentsSigners
            } else {
                @Suppress("DEPRECATION")
                packageInfo.signatures
            }
            
            if (signatures.isNullOrEmpty()) {
                killApp()
                return
            }

            // 计算当前 APK 的 SHA-256
            val md = java.security.MessageDigest.getInstance("SHA-256")
            val publicKey = md.digest(signatures[0].toByteArray())
            val actualSha256 = publicKey.joinToString("") { "%02x".format(it) }
            
            if (actualSha256 != expectedSha256) {
                killApp()
            }
        } catch (e: Exception) {
            killApp()
        }
    }
    
    private fun killApp() {
        Log.e("Security", "🚨 签名校验失败，检测到二次打包！App 即将退出。")
        android.os.Process.killProcess(android.os.Process.myPid())
        System.exit(0)
    }

    private fun switchFragment(targetFragment: Fragment) {
        // 利用 hide / show 代替 replace，避免 View 被销毁重建导致数据闪烁
        supportFragmentManager.beginTransaction().apply {
            supportFragmentManager.fragments.forEach { 
                if (it != targetFragment) hide(it) 
            }
            show(targetFragment)
            commit()
        }
    }

    fun startVpn() {
        val intent = VpnService.prepare(this)
        if (intent != null) {
            startActivityForResult(intent, VPN_REQUEST_CODE)
        } else {
            onActivityResult(VPN_REQUEST_CODE, Activity.RESULT_OK, null)
        }
    }

    override fun onResume() {
        super.onResume()
        // 动态监听登录与 Pro 状态，如果刚刚登录，立刻拉取模型
        val userPrefs = getSharedPreferences("user_session", MODE_PRIVATE)
        val token = userPrefs.getString("access_token", null)
        val tier = userPrefs.getString("tier", "free")
        val isPro = tier in listOf("pro", "premium", "trial", "trial-pro", "family", "sub-family", "family_sub")
        
        if (token != null && isPro) {
            // 🌟 触发设备静默上报
            lifecycleScope.launch(kotlinx.coroutines.Dispatchers.IO) {
                val result = DeviceManager.reportDeviceSilently(this@MainActivity, token)
                if (result == "LIMIT_EXCEEDED") {
                    Log.e("MainActivity", "设备超限，请前往 Web 端解绑！")
                }
            }

            val appPrefs = getSharedPreferences("app_settings", MODE_PRIVATE)
            val localVersion = appPrefs.getString("cloud_model_version", "")
            if (localVersion.isNullOrEmpty()) {
                Log.i("MainActivity", "检测到 Pro 登录，且无本地模型，立刻触发下载")
                lifecycleScope.launch(kotlinx.coroutines.Dispatchers.IO) {
                    com.dewsecure.android.policy.UpdateManager.checkForUpdates(this@MainActivity)
                }
            }
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == VPN_REQUEST_CODE && resultCode == Activity.RESULT_OK) {
            startService(Intent(this, DewVpnService::class.java))
        }
    }

    companion object {
        const val VPN_REQUEST_CODE = 1001
    }
}
