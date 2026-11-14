package com.dewsecure.android.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch

import com.dewsecure.android.R

class AccountActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_account)

        val btnBack = findViewById<View>(R.id.btn_back)
        val tvEmail = findViewById<TextView>(R.id.tv_account_email)
        val btnManage = findViewById<View>(R.id.btn_manage_account)
        val btnLogout = findViewById<View>(R.id.btn_logout)

        val prefs = getSharedPreferences("user_session", Context.MODE_PRIVATE)
        val email = prefs.getString("email", "Unknown")

        tvEmail.text = email

        btnBack.setOnClickListener { finish() }

        btnManage.setOnClickListener {
            // 🌟 核心修复：跳转前先强制刷新一次 Token，避免因为 Token 轮换导致第二次点击失败
            Toast.makeText(this, "正在获取安全凭证...", Toast.LENGTH_SHORT).show()
            
            lifecycleScope.launch {
                val refreshResult = com.dewsecure.android.policy.AuthManager.refreshToken(this@AccountActivity)
                
                if (refreshResult.isSuccess) {
                    // 刷新成功，从本地读取最新的 Token
                    val latestPrefs = getSharedPreferences("user_session", Context.MODE_PRIVATE)
                    val token = latestPrefs.getString("access_token", null)
                    val refreshToken = latestPrefs.getString("refresh_token", null)

                    if (token != null && refreshToken != null) {
                        val url = "https://dewsecure.com/dashboard#token=$token&refresh=$refreshToken&source=app"
                        android.util.Log.e("SSO_DEBUG", "🚀 刷新后跳转URL: $url")
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                        startActivity(intent)
                    } else {
                        Toast.makeText(this@AccountActivity, "凭证解析失败，请重试", Toast.LENGTH_SHORT).show()
                    }
                } else {
                    // 刷新失败（通常意味着用户已经在网页端登出，或者 Token 彻底过期）
                    android.util.Log.e("SSO_DEBUG", "刷新失败: ${refreshResult.exceptionOrNull()?.message}")
                    Toast.makeText(this@AccountActivity, "登录状态已失效，正在返回登录页...", Toast.LENGTH_SHORT).show()
                    
                    // 🌟 核心优化：清理本地脏数据
                    prefs.edit().clear().apply()
                    
                    // 🌟 自动跳转回 LoginActivity
                    val intent = Intent(this@AccountActivity, LoginActivity::class.java).apply {
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
                    }
                    startActivity(intent)
                    finish()
                }
            }
        }

        btnLogout.setOnClickListener {
            android.util.Log.e("AccountActivity", "🚪 触发登出，开始清理 AI 模型及规则")
            Toast.makeText(this, "正在清理并退出...", Toast.LENGTH_SHORT).show()
            
            // 1. 清除 Session
            prefs.edit().clear().apply()

            // 2. 卸载 Rust 内存中的 AI 模型
            com.dewsecure.android.policy.EngineBridge.unloadAdblockModel()

            // 3. 清除本地缓存版本号
            val appPrefs = getSharedPreferences("app_settings", Context.MODE_PRIVATE)
            appPrefs.edit().remove("cloud_model_version").remove("cloud_rules_version").apply()

            // 4. 物理删除本地缓存的 FST 规则文件和模型
            val weightsFile = java.io.File(filesDir, "cloud_weights.json")
            if (weightsFile.exists()) {
                val res = weightsFile.delete()
                android.util.Log.e("AccountActivity", "🚪 cloud_weights.json 删除结果: $res")
            }
            val fstFile = java.io.File(filesDir, "cloud_rules.fst")
            if (fstFile.exists()) {
                val res = fstFile.delete()
                android.util.Log.e("AccountActivity", "🚪 cloud_rules.fst 删除结果: $res")
            }
            val jsonFile = java.io.File(filesDir, "cloud_rules.json")
            if (jsonFile.exists()) {
                val res = jsonFile.delete()
                android.util.Log.e("AccountActivity", "🚪 cloud_rules.json 删除结果: $res")
            }

            Toast.makeText(this, "已退出登录，AI 模型已彻底清除", Toast.LENGTH_SHORT).show()
            finish()
        }
    }

    override fun onResume() {
        super.onResume()
        // 🛡️ 终极兜底：每次回到控制台，检查是否已登录 Pro 且未下载模型
        val userPrefs = getSharedPreferences("user_session", Context.MODE_PRIVATE)
        val token = userPrefs.getString("access_token", null)
        val tier = userPrefs.getString("tier", "free") ?: "free"
        val isPro = tier in listOf("pro", "premium", "trial", "trial-pro", "family", "sub-family", "family_sub")

        if (token != null && isPro) {
            val appPrefs = getSharedPreferences("app_settings", Context.MODE_PRIVATE)
            val localVersion = appPrefs.getString("cloud_model_version", "")
            if (localVersion.isNullOrEmpty()) {
                android.util.Log.i("AccountActivity", "🚀 检测到 Pro 登录且无本地模型，立刻触发模型下载！")
                lifecycleScope.launch(kotlinx.coroutines.Dispatchers.IO) {
                    com.dewsecure.android.policy.UpdateManager.checkForUpdates(this@AccountActivity)
                }
            }
        }
    }

}
