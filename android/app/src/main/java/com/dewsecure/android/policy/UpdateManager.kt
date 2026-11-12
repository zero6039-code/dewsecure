package com.dewsecure.android.policy

import android.content.Context
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

object UpdateManager {
    private const val TAG = "UpdateManager"
    private const val BASE_URL = "https://api.dewsecure.com/api/intel"
    private const val CACHE_KEY_RULES_VER = "cloud_rules_version"

    suspend fun checkForUpdates(context: Context) = withContext(Dispatchers.IO) {
        Log.i(TAG, "🚀 开始检查云端规则更新...")
        
        val prefs = context.getSharedPreferences("app_settings", Context.MODE_PRIVATE)
        val userPrefs = context.getSharedPreferences("user_session", Context.MODE_PRIVATE)
        val token = userPrefs.getString("access_token", null)

        try {
            val sigUrl = URL("$BASE_URL/threat-rules.sig")
            val sigConn = sigUrl.openConnection() as HttpURLConnection
            sigConn.requestMethod = "GET"
            sigConn.connectTimeout = 10000
            sigConn.readTimeout = 10000
            if (token != null) sigConn.setRequestProperty("Authorization", "Bearer $token")

            if (sigConn.responseCode !in 200..299) {
                Log.e(TAG, "❌ 拉取规则签名失败: HTTP ${sigConn.responseCode}")
                return@withContext
            }

            val sigDataStr = BufferedReader(InputStreamReader(sigConn.inputStream)).readText()
            val sigData = JSONObject(sigDataStr)
            
            // 🔒 核心修复：清理可能混入的不可见字符、回车、空格
            val remoteVersion = sigData.optString("version", "").trim()
            val expectedSha256 = sigData.optString("sha256", "").trim()
            val sigB64 = sigData.optString("signature", "").trim()
            val localVersion = (prefs.getString(CACHE_KEY_RULES_VER, "") ?: "").trim()

            if (remoteVersion == localVersion) {
                Log.d(TAG, "ℹ️ 本地规则已是最新版本: $localVersion")
                return@withContext
            }

            val rulesUrl = URL("$BASE_URL/threat-rules")
            val rulesConn = rulesUrl.openConnection() as HttpURLConnection
            rulesConn.requestMethod = "GET"
            if (token != null) rulesConn.setRequestProperty("Authorization", "Bearer $token")

            if (rulesConn.responseCode != 200) {
                Log.e(TAG, "❌ 下载规则失败: HTTP ${rulesConn.responseCode}")
                return@withContext
            }

            val rulesPayload = BufferedReader(InputStreamReader(rulesConn.inputStream)).readText()
            
            // 与 Python 脚本绝对对齐，并用 trim() 防止隐形字符
            val msgStr = "$remoteVersion:$expectedSha256"
            
            // 💡 打印字节长度帮助排查
            Log.i(TAG, "准备用于验签的明文: [$msgStr], 长度: ${msgStr.length}")

            val success = EngineBridge.verifyAndUpdateRules(rulesPayload, expectedSha256, msgStr, sigB64)

            if (success) {
                prefs.edit().putString(CACHE_KEY_RULES_VER, remoteVersion).apply()
                Log.i(TAG, "✅ 规则热更新成功，版本: $remoteVersion")
            } else {
                Log.e(TAG, "❌ 规则热更新失败：验签不通过")
            }

        } catch (e: Exception) {
            Log.e(TAG, "❌ 热更新网络异常", e)
        }
    }
}
