package com.dewsecure.android.policy

import android.content.Context
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

object ProfileManager {
    private const val TAG = "ProfileManager"
    private var lastProfileFetchTime = 0L

    suspend fun fetchUserProfile(context: Context, force: Boolean = false): Result<String> = withContext(Dispatchers.IO) {
        try {
            if (!force && System.currentTimeMillis() - lastProfileFetchTime < 30_000) {
                val cachedTier = context.getSharedPreferences("user_session", Context.MODE_PRIVATE).getString("tier", "free") ?: "free"
                return@withContext Result.success(cachedTier)
            }
            lastProfileFetchTime = System.currentTimeMillis()

            val prefs = context.getSharedPreferences("user_session", Context.MODE_PRIVATE)
            val token = prefs.getString("access_token", null) ?: return@withContext Result.failure(Exception("No token"))
            val userId = SessionManager.getUserIdFromToken(token) ?: return@withContext Result.failure(Exception("Invalid JWT"))

            val url = URL("${SessionManager.SUPABASE_URL}/rest/v1/profiles?id=eq.$userId&select=tier,family_owner_id")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
              conn.connectTimeout = 15000
              conn.readTimeout = 15000
            conn.setRequestProperty("apikey", SessionManager.SUPABASE_KEY)
            conn.setRequestProperty("Authorization", "Bearer $token")

            if (conn.responseCode in 200..299) {
                val resText = BufferedReader(InputStreamReader(conn.inputStream)).readText()
                val jsonArray = JSONArray(resText)
                if (jsonArray.length() > 0) {
                    val p = jsonArray.getJSONObject(0)
                    var tier = p.optString("tier", "free")
                    val familyOwnerId = p.optString("family_owner_id", "")

                    if (familyOwnerId.isNotEmpty() && familyOwnerId != "null") {
                        tier = "family"
                    }

                    val isPro = tier in listOf("pro", "premium", "trial", "trial-pro", "family", "sub-family", "family_sub")
                    if (!isPro) {
                        EngineBridge.unloadAdblockModel()
                        val weightsFile = java.io.File(context.filesDir, "cloud_weights.json")
                        if (weightsFile.exists()) weightsFile.delete()
                        val fstFile = java.io.File(context.filesDir, "cloud_rules.fst")
                        if (fstFile.exists()) fstFile.delete()
                        val jsonFile = java.io.File(context.filesDir, "cloud_rules.json")
                        if (jsonFile.exists()) jsonFile.delete()
                        context.getSharedPreferences("app_settings", Context.MODE_PRIVATE).edit()
                            .remove("cloud_model_version").remove("cloud_rules_version").apply()
                        prefs.edit().putString("tier", "free").apply()
                        Result.success("free")
                    } else {
                        prefs.edit().putString("tier", tier).commit()
                        UpdateManager.checkForUpdates(context)
                        try {
                            val intent = android.content.Intent(context, com.dewsecure.android.vpn.DewVpnService::class.java).apply {
                                action = "ACTION_ENTITLEMENTS_CHANGED"
                            }
                            context.startService(intent)
                        } catch (e: Exception) {
                            Log.e(TAG, "broadcast failed", e)
                        }
                        Result.success(tier)
                    }
                } else {
                    EngineBridge.unloadAdblockModel()
                    val weightsFile = java.io.File(context.filesDir, "cloud_weights.json")
                    if (weightsFile.exists()) weightsFile.delete()
                    val fstFile = java.io.File(context.filesDir, "cloud_rules.fst")
                    if (fstFile.exists()) fstFile.delete()
                    val jsonFile = java.io.File(context.filesDir, "cloud_rules.json")
                    if (jsonFile.exists()) jsonFile.delete()
                    context.getSharedPreferences("app_settings", Context.MODE_PRIVATE).edit()
                        .remove("cloud_model_version").remove("cloud_rules_version").apply()
                    prefs.edit().putString("tier", "free").apply()
                    Result.success("free")
                }
            } else {
                val err = conn.errorStream?.let { BufferedReader(InputStreamReader(it)).readText() }
                Result.failure(Exception("HTTP ${conn.responseCode}"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
