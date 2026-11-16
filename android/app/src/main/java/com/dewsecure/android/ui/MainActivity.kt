package com.dewsecure.android.ui

import android.app.Activity
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
        
        // 🌟 核心：如果当前是 Release 包，立即执行签名校验
        if (!BuildConfig.DEBUG) {
            checkSignature()
        }
        
        val prefs = getSharedPreferences("app_settings", MODE_PRIVATE)
        if (!prefs.contains("install_date")) {
            val sdf = java.text.SimpleDateFormat("d/M/yyyy", java.util.Locale.getDefault())
            prefs.edit().putString("install_date", sdf.format(java.util.Date())).apply()
        }
        setContentView(R.layout.activity_main)

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

        // 🌟 启动时初始化引擎（加入幂等保护，防止语言重建时重复初始化）
        val enginePrefs = getSharedPreferences("engine_state", MODE_PRIVATE)
        if (!enginePrefs.getBoolean("is_engine_initialized", false)) {
            EngineBridge.init(this, aiEnabled = true)
            enginePrefs.edit().putBoolean("is_engine_initialized", true).apply()
        } else {
            Log.i("MainActivity", "引擎已初始化，跳过重复调用")
        }
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
                    EngineBridge.loadUserWhitelist(domains)
                    Log.i("MainActivity", "云端白名单同步成功，共计 ${domains.size} 条")
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
