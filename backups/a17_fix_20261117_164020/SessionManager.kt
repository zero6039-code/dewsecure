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

object SessionManager {
    const val TAG = "SessionManager"
    const val SUPABASE_URL = "https://uvbaioqqjqseapcancvi.supabase.co"
    const val SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2YmFpb3FxanFzZWFwY2FuY3ZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0OTIyODAsImV4cCI6MjEwODA2ODI4MH0.jhEaDHBvp702biC7oqM1oV5YO7rzhvmXFH5pTRF17kQ"

    suspend fun refreshToken(context: Context): Result<String> = withContext(Dispatchers.IO) {
        try {
            val prefs = context.getSharedPreferences("user_session", Context.MODE_PRIVATE)
            val refreshToken = prefs.getString("refresh_token", null)
                ?: return@withContext Result.failure(Exception("no refresh_token"))

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
                Result.failure(Exception("refresh token failed"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    fun getUserIdFromToken(token: String): String? {
        return try {
            val parts = token.split(".")
            if (parts.size < 2) return null
            val payload = String(android.util.Base64.decode(parts[1], android.util.Base64.URL_SAFE or android.util.Base64.NO_PADDING or android.util.Base64.NO_WRAP))
            JSONObject(payload).optString("sub")
        } catch (e: Exception) { null }
    }
}
