package com.dewsecure.android.policy

import android.content.Context
import android.os.Build
import android.provider.Settings
import android.util.Log
import android.widget.Toast
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

object DeviceManager {
    private const val TAG = "DeviceManager"
    private const val INSTALLATION_KEY = "dewsecure_installation_id"
    private const val LAST_REPORT_KEY = "dewsecure_last_device_report"

    // 获取设备唯一指纹 (优先 Android ID，其次本地 UUID)
    private fun getFingerprint(context: Context): String {
        val prefs = context.getSharedPreferences("app_settings", Context.MODE_PRIVATE)
        var id = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
        
        if (id.isNullOrEmpty() || id == "9774d56d682e549c") {
            id = prefs.getString(INSTALLATION_KEY, null)
            if (id == null) {
                id = UUID.randomUUID().toString()
                prefs.edit().putString(INSTALLATION_KEY, id).apply()
            }
        }
        return id
    }

    // 解析设备名称 (如: Google Pixel 7 - Android 14)
    private fun parseDeviceInfo(): String {
        val manufacturer = Build.MANUFACTURER.replaceFirstChar { it.uppercase() }
        val model = Build.MODEL
        val osVersion = "Android ${Build.VERSION.RELEASE}"
        return "$manufacturer $model - $osVersion"
    }

    // 静默上报设备（带 24 小时防刷机制）
    suspend fun reportDeviceSilently(context: Context, token: String, force: Boolean = false): String = withContext(Dispatchers.IO) {
        val prefs = context.getSharedPreferences("app_settings", Context.MODE_PRIVATE)
        
        try {
            val fingerprint = getFingerprint(context)
            val deviceName = parseDeviceInfo()
            val userId = AuthManager.getUserIdFromToken(token) ?: return@withContext "AUTH_ERROR"

            // 🌟 核心修复：使用 userId 生成专属的防刷 Key，实现按账号隔离
            val userSpecificReportKey = "${LAST_REPORT_KEY}_$userId"

            if (!force) {
                val lastReport = prefs.getLong(userSpecificReportKey, 0)
                if (System.currentTimeMillis() - lastReport < 24 * 60 * 60 * 1000) {
                    Log.d(TAG, "⏳ 24小时内已上报过设备 ($userId)，跳过本次上报")
                    return@withContext "SUCCESS"
                }
            }

            val url = URL("${AuthManager.SUPABASE_URL}/rest/v1/devices?on_conflict=user_id,fingerprint")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("apikey", AuthManager.SUPABASE_KEY)
            conn.setRequestProperty("Authorization", "Bearer $token")
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Prefer", "resolution=merge-duplicates")
            conn.doOutput = true

            val body = JSONObject().apply {
                put("user_id", userId)
                put("fingerprint", fingerprint)
                put("device_name", deviceName)
                put("browser", "Android App")
                put("last_seen_at", java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US).apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }.format(java.util.Date()))
            }.toString()

            val os = OutputStreamWriter(conn.outputStream)
            os.write(body)
            os.flush()
            os.close()

            val responseCode = conn.responseCode
            if (responseCode in 200..299) {
                prefs.edit().putLong(userSpecificReportKey, System.currentTimeMillis()).apply()
                Log.i(TAG, "✅ 设备静默上报成功: $deviceName")
                "SUCCESS"
            } else {
                val errorText = conn.errorStream?.let { BufferedReader(InputStreamReader(it)).readText() } ?: ""
                Log.e(TAG, "❌ 设备上报失败: $responseCode, $errorText")
                
                if (responseCode == 401) {
                    val refreshResult = AuthManager.refreshToken(context)
                    if (refreshResult.isSuccess) {
                        return@withContext reportDeviceSilently(context, refreshResult.getOrNull()!!, true)
                    }
                    "AUTH_ERROR"
                } else if (responseCode == 400 || errorText.contains("DEVICE_LIMIT_EXCEEDED") || errorText.contains("duplicate key value")) {
                    // 这里根据你的 Supabase 实际返回判断，如果触发了超限逻辑
                    if (errorText.contains("DEVICE_LIMIT_EXCEEDED")) {
                        Log.w(TAG, "⚠️ 设备数量超限！")
                        withContext(Dispatchers.Main) {
                            Toast.makeText(context, "设备数量已达上限，请在网页端解绑多余设备！", Toast.LENGTH_LONG).show()
                        }
                        "LIMIT_EXCEEDED"
                    } else {
                        "SUCCESS" // 如果是其他 400，可能也是重复插入，暂时放过
                    }
                } else {
                    "ERROR"
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "设备上报异常", e)
            "ERROR"
        }
    }
}
