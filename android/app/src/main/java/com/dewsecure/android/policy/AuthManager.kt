package com.dewsecure.android.policy

import android.content.Context
import android.util.Log
import kotlinx.coroutines.Dispatchers
import com.dewsecure.android.policy.EngineBridge
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

object AuthManager {
    private const val TAG = "AuthManager"
    const val SUPABASE_URL = "https://uvbaioqqjqseapcancvi.supabase.co"
    const val SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2YmFpb3FxanFzZWFwY2FuY3ZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0OTIyODAsImV4cCI6MjEwODA2ODI4MH0.jhEaDHBvp702biC7oqM1oV5YO7rzhvmXFH5pTRF17kQ"

    // 刷新 Token
    suspend fun refreshToken(context: Context): Result<String> = withContext(Dispatchers.IO) {
        try {
            val prefs = context.getSharedPreferences("user_session", Context.MODE_PRIVATE)
            val refreshToken = prefs.getString("refresh_token", null)
                ?: return@withContext Result.failure(Exception("无 refresh_token"))

            val url = URL("$SUPABASE_URL/auth/v1/token?grant_type=refresh_token")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("apikey", SUPABASE_KEY)
            conn.setRequestProperty("Content-Type", "application/json")
            conn.doOutput = true

            val body = JSONObject().apply { put("refresh_token", refreshToken) }.toString()
            val os = OutputStreamWriter(conn.outputStream); os.write(body); os.flush(); os.close()

            if (conn.responseCode in 200..299) {
                val reader = BufferedReader(InputStreamReader(conn.inputStream))
                val json = JSONObject(reader.readText())
                val newAccess = json.optString("access_token")
                val newRefresh = json.optString("refresh_token")

                prefs.edit().putString("access_token", newAccess).putString("refresh_token", newRefresh).apply()
                Result.success(newAccess)
            } else {
                Result.failure(Exception("刷新 Token 失败"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    // 获取用户信息
    suspend fun getUserInfo(accessToken: String): Result<JSONObject> = withContext(Dispatchers.IO) {
        try {
            val url = URL("$SUPABASE_URL/auth/v1/user")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            conn.setRequestProperty("apikey", SUPABASE_KEY)
            conn.setRequestProperty("Authorization", "Bearer $accessToken")

            if (conn.responseCode in 200..299) {
                Result.success(JSONObject(BufferedReader(InputStreamReader(conn.inputStream)).readText()))
            } else {
                Result.failure(Exception("获取用户信息失败"))
            }
        } catch (e: Exception) { Result.failure(e) }
    }

    // 发送 OTP
    suspend fun sendOTP(email: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val url = URL("$SUPABASE_URL/auth/v1/otp")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("apikey", SUPABASE_KEY)
            conn.setRequestProperty("Content-Type", "application/json")
            conn.doOutput = true
            val body = JSONObject().apply { put("email", email); put("create_user", true) }.toString()
            val os = OutputStreamWriter(conn.outputStream); os.write(body); os.flush(); os.close()
            if (conn.responseCode in 200..299) Result.success(Unit)
            else {
                val msg = try { JSONObject(BufferedReader(InputStreamReader(conn.errorStream)).readText()).optString("msg", "发送失败") } catch (e: Exception) { "发送失败" }
                Result.failure(Exception(msg))
            }
        } catch (e: Exception) { Result.failure(Exception("网络异常，请稍后重试")) }
    }

    // 验证 OTP
    suspend fun verifyOTP(email: String, token: String): Result<Pair<String, String>> = withContext(Dispatchers.IO) {
        try {
            val url = URL("$SUPABASE_URL/auth/v1/verify")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("apikey", SUPABASE_KEY)
            conn.setRequestProperty("Content-Type", "application/json")
            conn.doOutput = true
            val body = JSONObject().apply { put("type", "email"); put("email", email); put("token", token) }.toString()
            val os = OutputStreamWriter(conn.outputStream); os.write(body); os.flush(); os.close()
            if (conn.responseCode in 200..299) {
                val json = JSONObject(BufferedReader(InputStreamReader(conn.inputStream)).readText())
                Result.success(Pair(json.optString("access_token"), json.optString("refresh_token")))
            } else {
                val msg = try { JSONObject(BufferedReader(InputStreamReader(conn.errorStream)).readText()).optString("msg", "验证码错误") } catch (e: Exception) { "验证码错误" }
                Result.failure(Exception(msg))
            }
        } catch (e: Exception) { Result.failure(Exception("网络异常，请稍后重试")) }
    }

    // 拉取白名单
    suspend fun fetchCloudWhitelist(context: Context, accessToken: String): Result<List<String>> = withContext(Dispatchers.IO) {
        try {
            val url = URL("$SUPABASE_URL/rest/v1/user_whitelists?select=domain")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            conn.setRequestProperty("apikey", SUPABASE_KEY)
            conn.setRequestProperty("Authorization", "Bearer $accessToken")

            if (conn.responseCode in 200..299) {
                val jsonArray = JSONArray(BufferedReader(InputStreamReader(conn.inputStream)).readText())
                val domains = mutableListOf<String>()
                for (i in 0 until jsonArray.length()) { domains.add(jsonArray.getJSONObject(i).optString("domain")) }
                Result.success(domains)
            } else if (conn.responseCode == 401) {
                // Token 过期，刷新后重试
                val refreshResult = refreshToken(context)
                if (refreshResult.isSuccess) return@withContext fetchCloudWhitelist(context, refreshResult.getOrNull()!!)
                Result.failure(Exception("拉取失败: 401"))
            } else {
                Result.failure(Exception("拉取失败: ${conn.responseCode}"))
            }
        } catch (e: Exception) { Result.failure(e) }
    }

    // 上传白名单
    suspend fun uploadWhitelistDomain(context: Context, accessToken: String, domain: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val url = URL("$SUPABASE_URL/rest/v1/user_whitelists")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("apikey", SUPABASE_KEY)
            conn.setRequestProperty("Authorization", "Bearer $accessToken")
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Prefer", "resolution=merge-duplicates")
            conn.doOutput = true

            val body = JSONObject().apply { put("domain", domain) }.toString()
            val os = OutputStreamWriter(conn.outputStream); os.write(body); os.flush(); os.close()

            if (conn.responseCode in 200..299) {
                Result.success(Unit)
            } else if (conn.responseCode == 401) {
                val refreshResult = refreshToken(context)
                if (refreshResult.isSuccess) return@withContext uploadWhitelistDomain(context, refreshResult.getOrNull()!!, domain)
                Result.failure(Exception("上传失败: Token 无效"))
            } else {
                val errorResponse = BufferedReader(InputStreamReader(conn.errorStream)).readText()
                Result.failure(Exception("上传失败: ${conn.responseCode} ($errorResponse)"))
            }
        } catch (e: Exception) { Result.failure(e) }
    }

    // 删除白名单
    suspend fun deleteCloudWhitelistDomain(context: Context, accessToken: String, domain: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val url = URL("$SUPABASE_URL/rest/v1/user_whitelists?domain=eq.$domain")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "DELETE"
            conn.setRequestProperty("apikey", SUPABASE_KEY)
            conn.setRequestProperty("Authorization", "Bearer $accessToken")

            if (conn.responseCode in 200..299) {
                Result.success(Unit)
            } else if (conn.responseCode == 401) {
                val refreshResult = refreshToken(context)
                if (refreshResult.isSuccess) return@withContext deleteCloudWhitelistDomain(context, refreshResult.getOrNull()!!, domain)
                Result.failure(Exception("删除失败: Token 无效"))
            } else {
                Result.failure(Exception("删除失败: ${conn.responseCode}"))
            }
        } catch (e: Exception) { Result.failure(e) }
    }

    // 提交反馈报告
    suspend fun submitReport(context: Context, type: String, domain: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val prefs = context.getSharedPreferences("user_session", Context.MODE_PRIVATE)
            val accessToken = prefs.getString("access_token", null)
            val authHeader = if (accessToken != null) "Bearer $accessToken" else "Bearer $SUPABASE_KEY"

            val url = URL("$SUPABASE_URL/rest/v1/reports")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("apikey", SUPABASE_KEY)
            conn.setRequestProperty("Authorization", authHeader)
            conn.setRequestProperty("Content-Type", "application/json")
            // 修改点：让 Supabase 返回插入的数据
            conn.setRequestProperty("Prefer", "return=representation")
            conn.doOutput = true

            val body = JSONObject().apply {
                put("report_type", type)
                put("domain", domain)
                put("url", "https://$domain")
                put("category", "android_app")
                put("status", "pending")
            }.toString()
            
            Log.d(TAG, "提交的报告数据: $body")

            val os = OutputStreamWriter(conn.outputStream)
            os.write(body)
            os.flush()
            os.close()

            val responseCode = conn.responseCode
            if (responseCode in 200..299) {
                val responseText = BufferedReader(InputStreamReader(conn.inputStream)).readText()
                Log.i(TAG, "上报成功! 返回数据: $responseText")
                Result.success(Unit)
            } else {
                val errorStream = conn.errorStream
                val errorResponse = BufferedReader(InputStreamReader(errorStream)).readText()
                Log.e(TAG, "上报失败! 状态码: $responseCode, 错误信息: $errorResponse")
                Result.failure(Exception("上报失败: $responseCode"))
            }
        } catch (e: Exception) {
            Log.e(TAG, "上报异常", e)
            Result.failure(e)
        }
    }

    // 解析 JWT 获取 userId
    fun getUserIdFromToken(token: String): String? {
        return try {
            val parts = token.split(".")
            if (parts.size < 2) return null
            val payload = String(android.util.Base64.decode(parts[1], android.util.Base64.URL_SAFE or android.util.Base64.NO_PADDING or android.util.Base64.NO_WRAP))
            JSONObject(payload).optString("sub")
        } catch (e: Exception) { null }
    }

    // 拉取用户 Profile 权限并保存到本地（带详细日志排查）
    suspend fun fetchUserProfile(context: Context): Result<String> = withContext(Dispatchers.IO) {
        try {
            val prefs = context.getSharedPreferences("user_session", Context.MODE_PRIVATE)
            val token = prefs.getString("access_token", null) ?: return@withContext Result.failure(Exception("No token"))
            val userId = getUserIdFromToken(token) ?: return@withContext Result.failure(Exception("Invalid JWT"))

            Log.d(TAG, "fetchUserProfile: userId=$userId")

            val url = URL("$SUPABASE_URL/rest/v1/profiles?id=eq.$userId&select=tier,family_owner_id")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            conn.setRequestProperty("apikey", SUPABASE_KEY)
            conn.setRequestProperty("Authorization", "Bearer $token")

            if (conn.responseCode in 200..299) {
                val resText = BufferedReader(InputStreamReader(conn.inputStream)).readText()
                Log.d(TAG, "fetchUserProfile response: $resText")
                
                val jsonArray = JSONArray(resText)
                if (jsonArray.length() > 0) {
                    val p = jsonArray.getJSONObject(0)
                    var tier = p.optString("tier", "free")
                    val familyOwnerId = p.optString("family_owner_id", "")
                    
                    // 如果有 family_owner_id，说明是家庭组成员，直接给 family 权限
                    if (familyOwnerId.isNotEmpty() && familyOwnerId != "null") {
                        tier = "family"
                    }
                    
                    Log.i(TAG, "fetchUserProfile: 最终解析 Tier = $tier")
                    val isPro = tier in listOf("pro", "premium", "trial", "trial-pro", "family", "sub-family", "family_sub")
                    if (!isPro) {
                        // 🌟 权限降级或 Free 用户：强制卸载 Rust 内存中的模型
                        EngineBridge.unloadAdblockModel()
                        
                        // 🌟 强制删除本地缓存的模型文件
                        val weightsFile = java.io.File(context.filesDir, "cloud_weights.json")
                          if (weightsFile.exists()) weightsFile.delete()
                          val fstFile = java.io.File(context.filesDir, "cloud_rules.fst")
                          if (fstFile.exists()) fstFile.delete()
                          val jsonFile = java.io.File(context.filesDir, "cloud_rules.json")
                          if (jsonFile.exists()) jsonFile.delete()
                          context.getSharedPreferences("app_settings", Context.MODE_PRIVATE).edit()
                              .remove("cloud_model_version").remove("cloud_rules_version").apply()
                          Log.e(TAG, "🧹 权限为 Free，已彻底清理本地模型与规则")
                          prefs.edit().putString("tier", "free").apply()
                        Result.success("free")
                    } else {
                        prefs.edit().putString("tier", tier).commit()
                          Log.e(TAG, "🔥 权限确认为 Pro ($tier)，准备触发模型下载")
                          
                          // 1. 直接原地触发模型下载
                          UpdateManager.checkForUpdates(context)
                          
                          // 2. 如果 VPN 正在运行，立刻发广播让它也刷新
                          try {
                              val intent = android.content.Intent(context, com.dewsecure.android.vpn.DewVpnService::class.java).apply {
                                  action = "ACTION_ENTITLEMENTS_CHANGED"
                              }
                              context.startService(intent)
                              Log.e(TAG, "📡 已向 VPN 服务发送权限变更广播")
                          } catch (e: Exception) {
                              Log.e(TAG, "发送广播失败", e)
                          }
                          
                          Result.success(tier)
                    }
                } else {
                    Log.w(TAG, "fetchUserProfile: 结果为空，默认 free")
                    EngineBridge.unloadAdblockModel()
                    val weightsFile = java.io.File(context.filesDir, "cloud_weights.json")
                          if (weightsFile.exists()) weightsFile.delete()
                          val fstFile = java.io.File(context.filesDir, "cloud_rules.fst")
                          if (fstFile.exists()) fstFile.delete()
                          val jsonFile = java.io.File(context.filesDir, "cloud_rules.json")
                          if (jsonFile.exists()) jsonFile.delete()
                          context.getSharedPreferences("app_settings", Context.MODE_PRIVATE).edit()
                              .remove("cloud_model_version").remove("cloud_rules_version").apply()
                          Log.e(TAG, "🧹 权限为 Free，已彻底清理本地模型与规则")
                          prefs.edit().putString("tier", "free").apply()
                    Result.success("free")
                }
            } else {
                val err = conn.errorStream?.let { BufferedReader(InputStreamReader(it)).readText() }
                Log.e(TAG, "fetchUserProfile failed: code=${conn.responseCode}, err=$err")
                Result.failure(Exception("HTTP ${conn.responseCode}"))
            }
        } catch (e: Exception) { 
            Log.e(TAG, "fetchUserProfile exception", e)
            Result.failure(e) 
        }
    }
}
