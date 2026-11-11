package com.dewsecure.android.policy

import android.content.Context
import android.util.Log
import kotlinx.coroutines.Dispatchers
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
}
