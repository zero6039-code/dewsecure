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
    private const val MODEL_BASE_URL = "https://cdn.dewsecure.com/canary"
    private const val CACHE_KEY_RULES_VER = "cloud_rules_version"

    suspend fun checkForUpdates(context: Context) = withContext(Dispatchers.IO) {
        val prefs = context.getSharedPreferences("app_settings", Context.MODE_PRIVATE)
        val userPrefs = context.getSharedPreferences("user_session", Context.MODE_PRIVATE)
        val token = userPrefs.getString("access_token", null)
        val cachedTier = userPrefs.getString("tier", "free") ?: "free"
        val isUserPro = cachedTier in listOf("pro", "premium", "trial", "trial-pro", "family", "sub-family", "family_sub")

        // 🛡️ 终极内部锁：即使代码被错误调用，非 Pro 用户也绝对不拉取
        if (!isUserPro) {
            Log.e(TAG, "🚫 拦截更新请求：当前为非 Pro 用户，无权拉取云端资源")
            return@withContext
        }

        Log.i(TAG, "🚀 开始检查云端规则更新...")

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
                // 🔥 即使规则最新，也要去检查模型是否有更新
                checkForModelUpdates(context, token)
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
            
            // 💡 紧接着检查 AI 模型更新
            checkForModelUpdates(context, token)

        } catch (e: Exception) {
            Log.e(TAG, "❌ 热更新网络异常", e)
        }
    }

    suspend fun checkForModelUpdates(context: Context, token: String?) = withContext(Dispatchers.IO) {
        Log.i(TAG, "🧠 开始检查 AI 模型更新 (CDN Canary)...")
        val prefs = context.getSharedPreferences("app_settings", Context.MODE_PRIVATE)
        val CACHE_KEY_MODEL_VER = "cloud_model_version"

        try {
            // 1. 拉取模型元数据
            val metaUrl = URL("$MODEL_BASE_URL/model_meta.json")
            val metaConn = metaUrl.openConnection() as HttpURLConnection
            metaConn.requestMethod = "GET"
            metaConn.connectTimeout = 10000
            metaConn.readTimeout = 10000

            if (metaConn.responseCode !in 200..299) {
                Log.e(TAG, "❌ 拉取模型元数据失败: HTTP ${metaConn.responseCode}")
                return@withContext
            }

            val metaStr = BufferedReader(InputStreamReader(metaConn.inputStream)).readText()
            val metaData = JSONObject(metaStr)

            // 从元数据中解析我们需要的字段
            val remoteVersion = metaData.optString("trainedAt", "unknown").trim() // 用训练时间做版本号
            val expectedSha256 = metaData.optString("jsonSha256", "").trim() // weights.json 的哈希
            val sigB64 = metaData.optString("jsonSignature", "").trim() // weights.json 的签名
            val modelType = "adblock"
            val channel = "canary"
            val validUntil = 9999999999L // 先写死，或者从服务器取
            
            val localVersion = (prefs.getString(CACHE_KEY_MODEL_VER, "") ?: "").trim()

            if (remoteVersion == localVersion) {
                Log.d(TAG, "ℹ️ 本地 AI 模型已是最新版本: $localVersion")
                return@withContext
            }

            Log.i(TAG, "⬇️ 发现新模型 [$remoteVersion]，开始下载主体 weights.json...")

            // 2. 拉取模型主体 weights.json
            val weightsUrl = URL("$MODEL_BASE_URL/weights.json")
            val weightsConn = weightsUrl.openConnection() as HttpURLConnection
            weightsConn.requestMethod = "GET"
            weightsConn.connectTimeout = 15000
            weightsConn.readTimeout = 15000

            if (weightsConn.responseCode != 200) {
                Log.e(TAG, "❌ 下载 weights.json 失败: HTTP ${weightsConn.responseCode}")
                return@withContext
            }

            val modelBody = BufferedReader(InputStreamReader(weightsConn.inputStream)).readText()

            // 3. 调用 Rust 侧接口加载模型
            val success = EngineBridge.loadSignedAdblockModel(
                remoteVersion, expectedSha256, sigB64, modelBody, 
                modelType, channel, validUntil, localVersion.ifEmpty { null }
            )

            if (success) {
                // 🌟 核心修复：物理落盘模型文件
                try {
                    val modelFile = java.io.File(context.filesDir, "cloud_weights.json")
                    modelFile.writeText(modelBody)
                    Log.i(TAG, "✅ AI 模型已成功写入本地: ${modelFile.absolutePath}")
                } catch (e: Exception) {
                    Log.e(TAG, "❌ 模型落盘失败", e)
                }
                
                prefs.edit().putString(CACHE_KEY_MODEL_VER, remoteVersion).apply()
                Log.i(TAG, "✅ AI 模型热更新成功，版本: $remoteVersion")
            } else {
                Log.e(TAG, "❌ AI 模型热更新失败：验签不通过或加载失败")
            }

        } catch (e: Exception) {
            Log.e(TAG, "❌ 模型更新网络异常", e)
        }
    }
}
