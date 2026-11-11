package com.dewsecure.android.policy

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

object AuthManager {
    private const val TAG = "AuthManager"
    // 从你的插件代码中提取的
    private const val SUPABASE_URL = "https://uvbaioqqjqseapcancvi.supabase.co"
    private const val SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2YmFpb3FxanFzZWFwY2FuY3ZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0OTIyODAsImV4cCI6MjEwODA2ODI4MH0.jhEaDHBvp702biC7oqM1oV5YO7rzhvmXFH5pTRF17kQ"

    // 发送 OTP
    suspend fun sendOTP(email: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val url = URL("$SUPABASE_URL/auth/v1/otp")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("apikey", SUPABASE_KEY)
            conn.setRequestProperty("Content-Type", "application/json")
            conn.doOutput = true

            val body = JSONObject().apply {
                put("email", email)
                put("create_user", true)
            }.toString()

            val os = OutputStreamWriter(conn.outputStream)
            os.write(body)
            os.flush()
            os.close()

            val responseCode = conn.responseCode
            if (responseCode in 200..299) {
                Result.success(Unit)
            } else {
                val errorStream = conn.errorStream
                val reader = BufferedReader(InputStreamReader(errorStream))
                val errorResponse = reader.readText()
                Log.e(TAG, "Send OTP Error: $errorResponse")
                val msg = try { JSONObject(errorResponse).optString("msg", "发送失败") } catch (e: Exception) { "发送失败" }
                Result.failure(Exception(msg))
            }
        } catch (e: Exception) {
            Log.e(TAG, "Network Error", e)
            Result.failure(Exception("网络异常，请稍后重试"))
        }
    }

    // 验证 OTP 并获取 Token
    suspend fun verifyOTP(email: String, token: String): Result<String> = withContext(Dispatchers.IO) {
        try {
            val url = URL("$SUPABASE_URL/auth/v1/verify")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("apikey", SUPABASE_KEY)
            conn.setRequestProperty("Content-Type", "application/json")
            conn.doOutput = true

            val body = JSONObject().apply {
                put("type", "email")
                put("email", email)
                put("token", token)
            }.toString()

            val os = OutputStreamWriter(conn.outputStream)
            os.write(body)
            os.flush()
            os.close()

            val responseCode = conn.responseCode
            if (responseCode in 200..299) {
                val reader = BufferedReader(InputStreamReader(conn.inputStream))
                val response = reader.readText()
                val json = JSONObject(response)
                val accessToken = json.optString("access_token")
                Result.success(accessToken)
            } else {
                val reader = BufferedReader(InputStreamReader(conn.errorStream))
                val errorResponse = reader.readText()
                Log.e(TAG, "Verify OTP Error: $errorResponse")
                val msg = try { JSONObject(errorResponse).optString("msg", "验证码错误或已过期") } catch (e: Exception) { "验证码错误或已过期" }
                Result.failure(Exception(msg))
            }
        } catch (e: Exception) {
            Log.e(TAG, "Network Error", e)
            Result.failure(Exception("网络异常，请稍后重试"))
        }
    }
}
