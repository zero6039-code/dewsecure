package com.dewsecure.android.ui

import android.app.Activity
import android.content.Intent
import android.net.VpnService
import android.os.Bundle
import android.util.Log
import androidx.appcompat.app.AppCompatActivity
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.dewsecure.android.R
import com.dewsecure.android.policy.AuthManager
import com.dewsecure.android.policy.EngineBridge
import com.dewsecure.android.vpn.DewVpnService
import com.google.android.material.bottomnavigation.BottomNavigationView
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {

    private val homeFragment = HomeFragment()
    private val protectionFragment = ProtectionFragment()
    private val settingsFragment = SettingsFragment()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = getSharedPreferences("app_settings", MODE_PRIVATE)
        if (!prefs.contains("install_date")) {
            val sdf = java.text.SimpleDateFormat("d/M/yyyy", java.util.Locale.getDefault())
            prefs.edit().putString("install_date", sdf.format(java.util.Date())).apply()
        }
        setContentView(R.layout.activity_main)

        val bottomNav = findViewById<BottomNavigationView>(R.id.bottom_navigation)
        
        // 首次初始化，把三个 Fragment 都 add 进去，但只显示 Home
        if (savedInstanceState == null) {
            supportFragmentManager.beginTransaction().apply {
                add(R.id.fragment_container, homeFragment, "HOME")
                add(R.id.fragment_container, protectionFragment, "PROTECTION").hide(protectionFragment)
                add(R.id.fragment_container, settingsFragment, "SETTINGS").hide(settingsFragment)
                commit()
            }
        }

        bottomNav.setOnItemSelectedListener { item ->
            when (item.itemId) {
                R.id.nav_home -> { switchFragment(homeFragment); true }
                R.id.nav_protection -> { switchFragment(protectionFragment); true }
                R.id.nav_settings -> { switchFragment(settingsFragment); true }
                else -> false
            }
        }

        // 🌟 启动时立即初始化引擎并恢复缓存，防止首页显示为 0
        EngineBridge.init(this, aiEnabled = true)
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
