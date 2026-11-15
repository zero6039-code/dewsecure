package com.dewsecure.android.vpn

import android.content.Context
import android.util.Log
import com.dewsecure.android.policy.EngineBridge
import java.io.File

object VpnEntitlementHelper {
    private const val TAG = "VpnEntitlement"
    private val PRO_TIERS = listOf("pro", "premium", "trial", "trial-pro", "family", "sub-family", "family_sub")

    fun isUserPro(context: Context): Boolean {
        val prefs = context.getSharedPreferences("user_session", Context.MODE_PRIVATE)
        val cachedTier = prefs.getString("tier", "free") ?: "free"
        return cachedTier in PRO_TIERS
    }

    fun clearLocalModelAndRules(context: Context) {
        Log.i(TAG, "🧹 执行本地 AI 缓存强制清理...")
        EngineBridge.unloadAdblockModel()
        
        val filesDir = context.filesDir
        val filesToDelete = listOf("cloud_rules.fst", "cloud_rules.json", "cloud_weights.json")
        for (fileName in filesToDelete) {
            val file = File(filesDir, fileName)
            if (file.exists()) {
                val res = file.delete()
                Log.i(TAG, "🧹 $fileName 删除结果: $res")
            }
        }

        context.getSharedPreferences("app_settings", Context.MODE_PRIVATE).edit()
            .remove("cloud_model_version")
            .remove("cloud_rules_version")
            .apply()
    }
}
