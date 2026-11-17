package com.dewsecure.android.policy

import android.util.Log
import com.dewsecure.core.*
import com.dewsecure.core.getMitmCaCert as rustGetMitmCaCert
import com.dewsecure.core.startMitmVpnEngine as rustStartMitmVpnEngine
import org.json.JSONObject

object EngineBridge {
    
    private const val TAG = "EngineBridge"
    private var engine: HostEngine? = null

    data class BlockLog(
        val domain: String,
        val blockType: String,
        var timestamp: Long,
        var count: Int = 1
    )

    @Synchronized
    fun init(context: android.content.Context? = null, ruleData: String = "", modelPath: String = "", aiEnabled: Boolean = true) {
        if (engine != null) {
            Log.w(TAG, "HostEngine 已存在，跳过重复初始化")
            return
        }
        try {
            val baseDir = context?.filesDir?.absolutePath ?: run {
                Log.e(TAG, "init 缺少 Context，拒绝初始化（禁止空 baseDir）")
                return
            }
            val config = EngineConfig(ruleData, modelPath, aiEnabled, baseDir)
            engine = HostEngine(config)
            Log.i(TAG, "HostEngine 初始化成功")

            val testRes = engine?.shouldBlock("doubleclick.net")
            Log.i(TAG, "🧪 引擎自检 - doubleclick.net 结果: ${testRes?.decision} / ${testRes?.reason}")

        } catch (e: Throwable) {
            Log.e(TAG, "HostEngine 初始化失败 (可能缺少 .so 库)，降级为全放行", e)
            engine = null
        }
    }

    fun setInitialStats(total: Long, today: Long, logsJson: String = "[]") {
        try {
            engine?.setInitialStatsWithLogs(total, today, logsJson)
            Log.i(TAG, "设置初始统计数据及日志: total=$total, today=$today")
        } catch (e: Throwable) { Log.e(TAG, "setInitialStats err", e) }
    }

    fun shouldBlock(domain: String): BlockResult {
        val e = engine ?: return fallbackAllow()
        return try { e.shouldBlock(domain) } catch (ex: Throwable) {
            Log.e(TAG, "调用 should_block 异常: $domain", ex); fallbackAllow()
        }
    }

    private fun fallbackAllow(): BlockResult = BlockResult(BlockDecision.ALLOW, "fallback_allow", 0.0f)

    fun userAllow(domain: String) { try { engine?.userAllow(domain) } catch (e: Throwable) { Log.e(TAG, "userAllow err", e) } }
    fun userRemoveAllow(domain: String) { try { engine?.userRemoveAllow(domain) } catch (e: Throwable) { Log.e(TAG, "userRemoveAllow err", e) } }
    fun loadUserWhitelist(domains: List<String>) { try { engine?.loadUserWhitelist(domains) } catch (e: Throwable) { Log.e(TAG, "loadUserWhitelist err", e) } }
    fun getUserAllowList(): List<String> { return try { engine?.getUserAllowList() ?: emptyList() } catch (e: Throwable) { emptyList() } }
    
    fun getStatsJson(context: android.content.Context? = null): String {
        return try {
            val jsonStr = engine?.getStats() ?: "{}"
            val json = JSONObject(jsonStr)

            // [A-22 修复] 移除用 logs 覆盖 total/today 的逻辑，完全信任 Rust 的计数，避免超 1000 卡死
            if (context != null) {
                val prefs = context.getSharedPreferences("stats_cache", android.content.Context.MODE_PRIVATE)
                val lastDate = prefs.getString("last_date", "") ?: ""
                val todayStr = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.getDefault()).format(java.util.Date())

                if (lastDate.isNotEmpty() && lastDate != todayStr) {
                    // 跨天：仅在 UI 返回今日 0，不写盘
                    json.put("today_blocked", 0)
                } else {
                    // 同一天。若 Rust logs 为空，尝试用缓存兜底展示
                    if (json.optJSONArray("logs")?.length() == 0) {
                        val cachedToday = prefs.getLong("today", 0)
                        val cachedTotal = prefs.getLong("total", 0)
                        if (cachedToday > json.optLong("today_blocked", 0)) json.put("today_blocked", cachedToday)
                        if (cachedTotal > json.optLong("total_blocked", 0)) json.put("total_blocked", cachedTotal)
                    }
                }
            }

            Log.d(TAG, "UI 获取到的 Stats JSON: $json")
            json.toString()
        } catch (e: Exception) {
            Log.e(TAG, "getStatsJson 解析异常", e)
            "{}"
        }
    }

    // [A-22 修复] 剥离高频写盘，由 UI 退到后台时统一调用
    fun saveStatsCache(context: android.content.Context) {
        try {
            val jsonStr = engine?.getStats() ?: return
            val json = JSONObject(jsonStr)
            val prefs = context.getSharedPreferences("stats_cache", android.content.Context.MODE_PRIVATE)
            val lastDate = prefs.getString("last_date", "") ?: ""
            val todayStr = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.getDefault()).format(java.util.Date())

            var saveToday = json.optLong("today_blocked", 0)
            var saveTotal = json.optLong("total_blocked", 0)
            val saveLogs = json.optJSONArray("logs")?.toString() ?: "[]"

            if (lastDate.isNotEmpty() && lastDate != todayStr) {
                saveToday = 0
            }

            prefs.edit()
                .putString("last_date", todayStr)
                .putLong("today", saveToday)
                .putLong("total", saveTotal)
                .putString("logs_json", saveLogs)
                .apply()
        } catch (e: Exception) {
            Log.e(TAG, "saveStatsCache 异常", e)
        }
    }

    // --- 6 大功能联动透传 ---
    fun setEnableDnr(enabled: Boolean) { try { engine?.setEnableDnr(enabled) } catch (e: Throwable) { Log.e(TAG, "setEnableDnr err", e) } }
    fun setEnableTracker(enabled: Boolean) { try { engine?.setEnableTracker(enabled) } catch (e: Throwable) { Log.e(TAG, "setEnableTracker err", e) } }
    fun setEnableSocial(enabled: Boolean) { try { engine?.setEnableSocial(enabled) } catch (e: Throwable) { Log.e(TAG, "setEnableSocial err", e) } }
    fun setEnableThreatIntel(enabled: Boolean) { try { engine?.setEnableThreatIntel(enabled) } catch (e: Throwable) { Log.e(TAG, "setEnableThreatIntel err", e) } }
    fun setEnableAiPhishing(enabled: Boolean) { try { engine?.setEnableAiPhishing(enabled) } catch (e: Throwable) { Log.e(TAG, "setEnableAiPhishing err", e) } }
    fun setEnableAiZeroDay(enabled: Boolean) { try { engine?.setEnableAiZeroDay(enabled) } catch (e: Throwable) { Log.e(TAG, "setEnableAiZeroDay err", e) } }

    fun unloadAdblockModel() {
        try {
            engine?.unloadAdblockModel()
            Log.i(TAG, "AI 模型已卸载")
        } catch (e: Throwable) { Log.e(TAG, "unloadAdblockModel err", e) }
    }

    fun loadSignedAdblockModel(version: String, sha256Hex: String, sigB64: String, body: String, modelType: String, channel: String, validUntil: Long, localVersion: String?): Boolean {
        return try {
            engine?.loadSignedAdblockModel(version, sha256Hex, sigB64, body, modelType, channel, validUntil.toULong(), localVersion)
            Log.i(TAG, "✅ AI 模型热更新成功")
            true
        } catch (e: Throwable) {
            Log.e(TAG, "AI 模型热更新失败", e)
            false
        }
    }

    fun getMitmCaCert(): String {
        return try {
            rustGetMitmCaCert()
        } catch (e: Throwable) {
            Log.e(TAG, "获取 CA 证书失败", e)
            ""
        }
    }

        fun stopMitmVpnEngine() {
        try {
            com.dewsecure.core.stopMitmVpnEngine()
            Log.i(TAG, "✅ 已通知 Rust 停止 VPN 引擎")
        } catch (e: Throwable) {
            Log.e(TAG, "stopMitmVpnEngine err", e)
        }
    }

    fun setMitmEnabled(enabled: Boolean) {
        try {
            com.dewsecure.core.setMitmEnabled(enabled)
            Log.i(TAG, "MitM 引擎总开关已设置为: $enabled")
        } catch (e: Throwable) {
            Log.e(TAG, "setMitmEnabled err", e)
        }
    }

    fun startMitmVpnEngine(tunFd: Int, baseDir: String, protector: com.dewsecure.core.VpnProtector): String {
        return try {
            val res = rustStartMitmVpnEngine(tunFd, baseDir, protector)
            if (res == "OK") {
                Log.i(TAG, "✅ Rust VPN Engine 启动成功，TUN fd=$tunFd")
            } else {
                Log.e(TAG, "❌ Rust VPN Engine 启动失败: $res")
            }
            res
        } catch (e: Throwable) {
            Log.e(TAG, "启动 Rust VPN Engine 异常", e)
            "EXCEPTION: ${e.message}"
        }
    }

    fun verifyAndUpdateRules(payload: String, expectedSha256: String, msgStr: String, sigB64: String): Boolean {
        // [A-01] 引擎未初始化时不得伪成功
        val eng = engine ?: run {
            Log.e(TAG, "引擎未初始化，拒绝规则更新")
            return false
        }
        return try {
            eng.verifyAndUpdateRules(payload, expectedSha256, msgStr, sigB64)
            Log.i(TAG, "✅ 云端规则热更新成功")
            true
        } catch (e: Throwable) {
            Log.e(TAG, "云端规则热更新失败", e)
            false
        }
    }

    fun getBlockLogs(context: android.content.Context? = null, isTodayOnly: Boolean = false): List<BlockLog> {
        val jsonStr = getStatsJson(context)
        val rawList = mutableListOf<BlockLog>()
        try {
            val json = JSONObject(jsonStr)
            val logs = json.optJSONArray("logs")
            if (logs != null) {
                for (i in 0 until logs.length()) {
                    val item = logs.getJSONObject(i)
                    rawList.add(BlockLog(
                        item.optString("domain", "未知"),
                        item.optString("block_type", "unknown"),
                        item.optLong("timestamp", 0L)
                    ))
                }
            }
        } catch (e: Exception) { Log.e(TAG, "解析日志失败", e) }

        val filteredList = if (isTodayOnly) {
            val todayStartMillis = java.util.Calendar.getInstance().apply {
                set(java.util.Calendar.HOUR_OF_DAY, 0)
                set(java.util.Calendar.MINUTE, 0)
                set(java.util.Calendar.SECOND, 0)
                set(java.util.Calendar.MILLISECOND, 0)
            }.timeInMillis
            rawList.filter { it.timestamp >= todayStartMillis }
        } else {
            rawList
        }

        val groupedMap = mutableMapOf<String, BlockLog>()
        for (log in filteredList) {
            if (groupedMap.containsKey(log.domain)) {
                val existing = groupedMap[log.domain]!!
                existing.count += 1
                if (log.timestamp > existing.timestamp) existing.timestamp = log.timestamp
            } else {
                groupedMap[log.domain] = log
            }
        }
        return groupedMap.values.sortedByDescending { it.timestamp }
    }
}
