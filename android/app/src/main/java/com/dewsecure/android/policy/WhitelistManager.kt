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

object WhitelistManager {
    private const val TAG = "WhitelistManager"

    suspend fun fetchCloudWhitelist(context: Context, accessToken: String, retryCount: Int = 0): Result<List<String>> = withContext(Dispatchers.IO) {
        if (retryCount >= 1) return@withContext Result.failure(Exception("401 retry limit"))
        try {
            val url = URL("${SessionManager.SUPABASE_URL}/rest/v1/user_whitelists?select=domain")
            val conn = url.openConnection() as HttpURLConnection
            conn.connectTimeout = 15000
            conn.readTimeout = 15000
            conn.requestMethod = "GET"
            conn.setRequestProperty("apikey", SessionManager.SUPABASE_KEY)
            conn.setRequestProperty("Authorization", "Bearer $accessToken")

            if (conn.responseCode in 200..299) {
                val jsonArray = JSONArray(BufferedReader(InputStreamReader(conn.inputStream)).readText())
                val domains = mutableListOf<String>()
                for (i in 0 until jsonArray.length()) { domains.add(jsonArray.getJSONObject(i).optString("domain")) }
                Result.success(domains)
            } else if (conn.responseCode == 401) {
                val refreshResult = SessionManager.refreshToken(context)
                if (refreshResult.isSuccess) return@withContext fetchCloudWhitelist(context, refreshResult.getOrNull()!!, retryCount + 1)
                Result.failure(Exception("failed: 401"))
            } else {
                Result.failure(Exception("failed: ${conn.responseCode}"))
            }
        } catch (e: Exception) { Result.failure(e) }
    }

    suspend fun uploadWhitelistDomain(context: Context, accessToken: String, domain: String, retryCount: Int = 0): Result<Unit> = withContext(Dispatchers.IO) {
        if (retryCount >= 1) return@withContext Result.failure(Exception("401 retry limit"))
        try {
            val url = URL("${SessionManager.SUPABASE_URL}/rest/v1/user_whitelists")
            val conn = url.openConnection() as HttpURLConnection
            conn.connectTimeout = 15000
            conn.readTimeout = 15000
            conn.requestMethod = "POST"
            conn.setRequestProperty("apikey", SessionManager.SUPABASE_KEY)
            conn.setRequestProperty("Authorization", "Bearer $accessToken")
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Prefer", "resolution=merge-duplicates")
            conn.doOutput = true

            val body = JSONObject().apply { put("domain", domain) }.toString()
            val os = OutputStreamWriter(conn.outputStream); os.write(body); os.flush(); os.close()

            if (conn.responseCode in 200..299) {
                Result.success(Unit)
            } else if (conn.responseCode == 401) {
                val refreshResult = SessionManager.refreshToken(context)
                if (refreshResult.isSuccess) return@withContext uploadWhitelistDomain(context, refreshResult.getOrNull()!!, domain, retryCount + 1)
                Result.failure(Exception("upload failed: invalid token"))
            } else {
                val errorResponse = BufferedReader(InputStreamReader(conn.errorStream)).readText()
                Result.failure(Exception("upload failed: ${conn.responseCode} ($errorResponse)"))
            }
        } catch (e: Exception) { Result.failure(e) }
    }

    suspend fun deleteCloudWhitelistDomain(context: Context, accessToken: String, domain: String, retryCount: Int = 0): Result<Unit> = withContext(Dispatchers.IO) {
        if (retryCount >= 1) return@withContext Result.failure(Exception("401 retry limit"))
        try {
            val safeDomain = java.net.URLEncoder.encode(domain, "UTF-8")
            val url = URL("${SessionManager.SUPABASE_URL}/rest/v1/user_whitelists?domain=eq.$safeDomain")
            val conn = url.openConnection() as HttpURLConnection
            conn.connectTimeout = 15000
            conn.readTimeout = 15000
            conn.requestMethod = "DELETE"
            conn.setRequestProperty("apikey", SessionManager.SUPABASE_KEY)
            conn.setRequestProperty("Authorization", "Bearer $accessToken")

            if (conn.responseCode in 200..299) {
                Result.success(Unit)
            } else if (conn.responseCode == 401) {
                val refreshResult = SessionManager.refreshToken(context)
                if (refreshResult.isSuccess) return@withContext deleteCloudWhitelistDomain(context, refreshResult.getOrNull()!!, domain, retryCount + 1)
                Result.failure(Exception("delete failed: invalid token"))
            } else {
                Result.failure(Exception("delete failed: ${conn.responseCode}"))
            }
        } catch (e: Exception) { Result.failure(e) }
    }

    suspend fun submitReport(context: Context, type: String, domain: String): Result<Unit> = withContext(Dispatchers.IO) {
        val ratePrefs = context.getSharedPreferences("report_rate_limit", Context.MODE_PRIVATE)
        val lastTime = ratePrefs.getLong("last_report_time", 0L)
        if (System.currentTimeMillis() - lastTime < 60_000L) {
            return@withContext Result.failure(Exception("操作太频繁，请 1 分钟后再试"))
        }
        ratePrefs.edit().putLong("last_report_time", System.currentTimeMillis()).apply()

        try {
            val prefs = context.getSharedPreferences("user_session", Context.MODE_PRIVATE)
            val accessToken = prefs.getString("access_token", null)
            val authHeader = if (accessToken != null) "Bearer $accessToken" else "Bearer ${SessionManager.SUPABASE_KEY}"

            val url = URL("${SessionManager.SUPABASE_URL}/rest/v1/reports")
            val conn = url.openConnection() as HttpURLConnection
            conn.connectTimeout = 15000
            conn.readTimeout = 15000
            conn.requestMethod = "POST"
            conn.setRequestProperty("apikey", SessionManager.SUPABASE_KEY)
            conn.setRequestProperty("Authorization", authHeader)
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Prefer", "return=representation")
            conn.doOutput = true

            val body = JSONObject().apply {
                put("report_type", type)
                put("domain", domain)
                put("url", "https://$domain")
                put("category", "android_app")
                put("status", "pending")
            }.toString()

            val os = OutputStreamWriter(conn.outputStream); os.write(body); os.flush(); os.close()

            val responseCode = conn.responseCode
            if (responseCode in 200..299) {
                Result.success(Unit)
            } else {
                val errorStream = conn.errorStream
                val errorResponse = BufferedReader(InputStreamReader(errorStream)).readText()
                Log.e(TAG, "report failed: $responseCode, $errorResponse")
                Result.failure(Exception("report failed: $responseCode"))
            }
        } catch (e: Exception) {
            Log.e(TAG, "report exception", e)
            Result.failure(e)
        }
    }
}
