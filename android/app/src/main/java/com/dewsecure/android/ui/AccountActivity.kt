package com.dewsecure.android.ui

import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.dewsecure.android.R
import kotlinx.coroutines.launch

class AccountActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_account)

        // 🌟 修复：inset 加到带 bg_aurora 的根布局，消除状态栏/导航栏白条
        androidx.core.view.WindowCompat.setDecorFitsSystemWindows(window, false)
        val insetRoot = (findViewById<android.view.View>(android.R.id.content) as android.view.ViewGroup).getChildAt(0)
        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(insetRoot) { v, ins ->
            val bars = ins.getInsetsIgnoringVisibility(androidx.core.view.WindowInsetsCompat.Type.systemBars())
            v.setPadding(v.paddingLeft, bars.top, v.paddingRight, bars.bottom)
            ins
        }

        val prefs = getSharedPreferences("user_session", Context.MODE_PRIVATE)
        val email = prefs.getString("email", "Unknown")
        findViewById<TextView>(R.id.tv_account_email).text = email

        updateUI()
        setupListeners()
        fetchRealProfile()
    }

    
    private fun fetchRealProfile() {
        lifecycleScope.launch {
            val result = com.dewsecure.android.policy.ProfileManager.fetchUserProfile(this@AccountActivity, force = true)
            val prefs = getSharedPreferences("user_session", Context.MODE_PRIVATE)
            val tier = result.getOrDefault(prefs.getString("tier", "free") ?: "free")
            
            val tvPlan = findViewById<TextView>(R.id.tv_account_plan)
            val tvExpiry = findViewById<TextView>(R.id.tv_account_expiry_value)
            val tvGroup = findViewById<TextView>(R.id.tv_account_group_value)

            // 更新 Plan 文本和颜色
            when (tier) {
                "free" -> {
                    tvPlan.text = "Free Plan"
                    tvPlan.setTextColor(android.graphics.Color.WHITE)
                }
                "pro", "premium", "trial", "trial-pro" -> {
                    tvPlan.text = "Pro Plan"
                    tvPlan.setTextColor(getColor(R.color.pro_yellow))
                }
                "family", "sub-family", "family_sub" -> {
                    tvPlan.text = "Family Plan"
                    tvPlan.setTextColor(getColor(R.color.pro_yellow))
                    tvGroup.text = "Family"
                }
                else -> {
                    tvPlan.text = tier
                    tvPlan.setTextColor(getColor(R.color.pro_yellow))
                }
            }

            // 更新到期时间
            val subEnds = prefs.getString("sub_ends_at", "")
            if (!subEnds.isNullOrEmpty() && subEnds != "null") {
                // 格式化时间戳为 yyyy-MM-dd
                try {
                    val date = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", java.util.Locale.US).parse(subEnds.substring(0, 19))
                    tvExpiry.text = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(date!!)
                } catch (e: Exception) {
                    tvExpiry.text = subEnds.substring(0, 10)
                }
            } else {
                tvExpiry.text = "-"
            }
        }
    }
    
    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        updateUI()
    }

    private fun updateUI() {
        // 🌟 所有静态文本全部手动刷新
        findViewById<TextView>(R.id.tv_account_header_title)?.text = getString(R.string.account_header_title)
        findViewById<TextView>(R.id.tv_account_logged_in)?.text = getString(R.string.account_logged_in)
        findViewById<TextView>(R.id.tv_account_sub_title)?.text = getString(R.string.account_sub_title)
        findViewById<TextView>(R.id.tv_account_expiry)?.text = getString(R.string.account_expiry)
        findViewById<TextView>(R.id.tv_account_group)?.text = getString(R.string.account_group)
        findViewById<TextView>(R.id.btn_manage_account)?.text = getString(R.string.account_manage_btn)
        findViewById<TextView>(R.id.btn_logout)?.text = getString(R.string.account_logout_btn)
    }

    private fun setupListeners() {
        val prefs = getSharedPreferences("user_session", Context.MODE_PRIVATE)
        val btnBack = findViewById<View>(R.id.btn_back)
        val btnManage = findViewById<View>(R.id.btn_manage_account)
        val btnLogout = findViewById<View>(R.id.btn_logout)

        btnBack.setOnClickListener { finish() }

        btnManage.setOnClickListener {
            Toast.makeText(this, getString(R.string.toast_getting_cred), Toast.LENGTH_SHORT).show()

            lifecycleScope.launch {
                val refreshResult = com.dewsecure.android.policy.AuthManager.refreshToken(this@AccountActivity)

                if (refreshResult.isSuccess) {
                    val codeResult = com.dewsecure.android.policy.AuthManager.getHandoffCode(this@AccountActivity)
                    if (codeResult.isSuccess) {
                        val code = codeResult.getOrNull()!!
                        val url = "https://dewsecure.com/dashboard?code=$code"
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                        startActivity(intent)
                    } else {
                        Toast.makeText(this@AccountActivity, "获取交接码失败，请稍后重试", Toast.LENGTH_SHORT).show()
                    }
                } else {
                    Toast.makeText(this@AccountActivity, getString(R.string.toast_session_expired), Toast.LENGTH_SHORT).show()
                    prefs.edit().clear().apply()
                    // A-19 修复：Session 过期时同步清理本地白名单与引擎内存
                    getSharedPreferences("local_whitelist", Context.MODE_PRIVATE).edit().clear().apply()
                    com.dewsecure.android.policy.EngineBridge.loadUserWhitelist(emptyList())
                    val intent = Intent(this@AccountActivity, LoginActivity::class.java).apply {
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
                    }
                    startActivity(intent)
                    finish()
                }
            }
        }

        btnLogout.setOnClickListener {
            Toast.makeText(this, getString(R.string.toast_logout_cleaning), Toast.LENGTH_SHORT).show()
            lifecycleScope.launch {
                // 1. 吊销服务端 Token
                runCatching { com.dewsecure.android.policy.AuthManager.logout(this@AccountActivity) }
                // 2. 清理 Session
                prefs.edit().clear().apply()
                // 3. 清理模型引擎
                com.dewsecure.android.policy.EngineBridge.unloadAdblockModel()
                // 4. 清理本地配置和模型文件
                val appPrefs = getSharedPreferences("app_settings", Context.MODE_PRIVATE)
                appPrefs.edit().remove("cloud_model_version").remove("cloud_rules_version").apply()

                val weightsFile = java.io.File(filesDir, "cloud_weights.json")
                if (weightsFile.exists()) weightsFile.delete()
                val fstFile = java.io.File(filesDir, "cloud_rules.fst")
                if (fstFile.exists()) fstFile.delete()
                val jsonFile = java.io.File(filesDir, "cloud_rules.json")
                if (jsonFile.exists()) jsonFile.delete()

                // 5. 清理本地白名单与统计数据
                getSharedPreferences("local_whitelist", Context.MODE_PRIVATE).edit().clear().apply()
                // A-19 修复：同步清空引擎内存中的 user_allow 集合
                com.dewsecure.android.policy.EngineBridge.loadUserWhitelist(emptyList())
                getSharedPreferences("stats_cache", Context.MODE_PRIVATE).edit().clear().apply()

                Toast.makeText(this@AccountActivity, getString(R.string.toast_logout_success), Toast.LENGTH_SHORT).show()
                finish()
            }
        }
    }

    override fun onResume() {
        super.onResume()
        val userPrefs = getSharedPreferences("user_session", Context.MODE_PRIVATE)
        val token = userPrefs.getString("access_token", null)
        val tier = userPrefs.getString("tier", "free") ?: "free"
        val isPro = tier in listOf("pro", "premium", "trial", "trial-pro", "family", "sub-family", "family_sub")

        if (token != null && isPro) {
            val appPrefs = getSharedPreferences("app_settings", Context.MODE_PRIVATE)
            val localVersion = appPrefs.getString("cloud_model_version", "")
            if (localVersion.isNullOrEmpty()) {
                lifecycleScope.launch(kotlinx.coroutines.Dispatchers.IO) {
                    com.dewsecure.android.policy.UpdateManager.checkForUpdates(this@AccountActivity)
                }
            }
        }
    }
}
