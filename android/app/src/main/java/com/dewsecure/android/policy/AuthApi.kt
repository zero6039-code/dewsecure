package com.dewsecure.android.policy

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

object AuthApi {
    suspend fun getUserInfo(accessToken: String): Result<JSONObject> = withContext(Dispatchers.IO) {
        try {
            val url = URL("${SessionManager.SUPABASE_URL}/auth/v1/user")
            val conn = url.openConnection() as HttpURLConnection
            conn.connectTimeout = 15000
            conn.readTimeout = 15000
            conn.requestMethod = "GET"
            conn.setRequestProperty("apikey", SessionManager.SUPABASE_KEY)
            conn.setRequestProperty("Authorization", "Bearer $accessToken")

            if (conn.responseCode in 200..299) {
                Result.success(JSONObject(BufferedReader(InputStreamReader(conn.inputStream)).readText()))
            } else {
                Result.failure(Exception("get user failed"))
            }
        } catch (e: Exception) { Result.failure(e) }
    }

    suspend fun exchangeCodeForSession(code: String, verifier: String): Result<Pair<String, String>> = withContext(Dispatchers.IO) {
        try {
            val url = URL("${SessionManager.SUPABASE_URL}/auth/v1/token?grant_type=pkce")
            val conn = url.openConnection() as HttpURLConnection
            conn.connectTimeout = 15000
            conn.readTimeout = 15000
            conn.requestMethod = "POST"
            conn.setRequestProperty("apikey", SessionManager.SUPABASE_KEY)
            conn.setRequestProperty("Content-Type", "application/json")
            conn.doOutput = true
            val body = JSONObject().apply {
                put("auth_code", code)
                put("code_verifier", verifier)
            }.toString()
            val os = OutputStreamWriter(conn.outputStream); os.write(body); os.flush(); os.close()
            if (conn.responseCode in 200..299) {
                val json = JSONObject(BufferedReader(InputStreamReader(conn.inputStream)).readText())
                Result.success(Pair(json.optString("access_token").takeIf { it.isNotEmpty() } ?: "", json.optString("refresh_token")))
            } else {
                val msg = try { JSONObject(BufferedReader(InputStreamReader(conn.errorStream)).readText()).optString("msg", "failed") } catch (e: Exception) { "failed" }
                Result.failure(Exception(msg))
            }
        } catch (e: Exception) { Result.failure(Exception("network error")) }
    }

    suspend fun sendOTP(email: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val url = URL("${SessionManager.SUPABASE_URL}/auth/v1/otp")
            val conn = url.openConnection() as HttpURLConnection
            conn.connectTimeout = 15000
            conn.readTimeout = 15000
            conn.requestMethod = "POST"
            conn.setRequestProperty("apikey", SessionManager.SUPABASE_KEY)
            conn.setRequestProperty("Content-Type", "application/json")
            conn.doOutput = true
            val body = JSONObject().apply { put("email", email); put("create_user", true) }.toString()
            val os = OutputStreamWriter(conn.outputStream); os.write(body); os.flush(); os.close()
            if (conn.responseCode in 200..299) Result.success(Unit)
            else {
                val msg = try { JSONObject(BufferedReader(InputStreamReader(conn.errorStream)).readText()).optString("msg", "failed") } catch (e: Exception) { "failed" }
                Result.failure(Exception(msg))
            }
        } catch (e: Exception) { Result.failure(Exception("network error")) }
    }

    suspend fun verifyOTP(email: String, token: String): Result<Pair<String, String>> = withContext(Dispatchers.IO) {
        try {
            val url = URL("${SessionManager.SUPABASE_URL}/auth/v1/verify")
            val conn = url.openConnection() as HttpURLConnection
            conn.connectTimeout = 15000
            conn.readTimeout = 15000
            conn.requestMethod = "POST"
            conn.setRequestProperty("apikey", SessionManager.SUPABASE_KEY)
            conn.setRequestProperty("Content-Type", "application/json")
            conn.doOutput = true
            val body = JSONObject().apply { put("type", "email"); put("email", email); put("token", token) }.toString()
            val os = OutputStreamWriter(conn.outputStream); os.write(body); os.flush(); os.close()
            if (conn.responseCode in 200..299) {
                val json = JSONObject(BufferedReader(InputStreamReader(conn.inputStream)).readText())
                Result.success(Pair(json.optString("access_token").takeIf { it.isNotEmpty() } ?: "", json.optString("refresh_token")))
            } else {
                val msg = try { JSONObject(BufferedReader(InputStreamReader(conn.errorStream)).readText()).optString("msg", "invalid code") } catch (e: Exception) { "invalid code" }
                Result.failure(Exception(msg))
            }
        } catch (e: Exception) { Result.failure(Exception("network error")) }
    }

    suspend fun logout(context: Context): Result<Unit> = withContext(Dispatchers.IO) {
        val prefs = context.getSharedPreferences("user_session", Context.MODE_PRIVATE)
        val token = prefs.getString("access_token", null)
        if (token != null) {
            try {
                val url = URL("${SessionManager.SUPABASE_URL}/auth/v1/logout")
                val conn = url.openConnection() as HttpURLConnection
                conn.connectTimeout = 15000
            conn.readTimeout = 15000
            conn.requestMethod = "POST"
                conn.setRequestProperty("apikey", SessionManager.SUPABASE_KEY)
                conn.setRequestProperty("Authorization", "Bearer $token")
                if (conn.responseCode in 200..299) Result.success(Unit) else Result.failure(Exception("Logout failed"))
            } catch (e: Exception) { Result.failure(e) }
        } else Result.success(Unit)
    }

    suspend fun getHandoffCode(context: Context): Result<String> = withContext(Dispatchers.IO) {
        val prefs = context.getSharedPreferences("user_session", Context.MODE_PRIVATE)
        val token = prefs.getString("access_token", null) ?: return@withContext Result.failure(Exception("No token"))
        try {
            val url = URL("${SessionManager.SUPABASE_URL}/functions/v1/handoff")
            val conn = url.openConnection() as HttpURLConnection
            conn.connectTimeout = 15000
            conn.readTimeout = 15000
            conn.requestMethod = "POST"
            conn.setRequestProperty("apikey", SessionManager.SUPABASE_KEY)
            conn.setRequestProperty("Authorization", "Bearer $token")
            if (conn.responseCode in 200..299) {
                val json = JSONObject(BufferedReader(InputStreamReader(conn.inputStream)).readText())
                Result.success(json.optString("code"))
            } else {
                Result.failure(Exception("Handoff failed: ${conn.responseCode}"))
            }
        } catch (e: Exception) { Result.failure(e) }
    }
}
