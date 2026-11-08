package com.dewsecure.android.policy

import android.util.Log
import com.dewsecure.core.*
import org.json.JSONObject

object EngineBridge {
    private const val TAG = "EngineBridge"
    private var engine: HostEngine? = null

    data class BlockLog(
        val domain: String,
        val blockType: String,
        val timestamp: Long,
        var isAllowed: Boolean = false
    )

    fun init(ruleData: String = "", modelPath: String = "", aiEnabled: Boolean = true) {
        try {
            val config = EngineConfig(ruleData, modelPath, aiEnabled)
            engine = HostEngine(config)
            Log.i(TAG, "HostEngine 初始化成功")
        } catch (e: Exception) {
            Log.e(TAG, "HostEngine 初始化失败，降级为全放行", e)
            engine = null
        }
    }

    fun shouldBlock(domain: String): BlockResult {
        val e = engine ?: return fallbackAllow()
        return try {
            e.shouldBlock(domain)
        } catch (ex: Exception) {
            Log.e(TAG, "调用 should_block 异常: $domain", ex)
            fallbackAllow()
        }
    }

    private fun fallbackAllow(): BlockResult {
        return BlockResult(BlockDecision.ALLOW, "fallback_allow", 0.0f)
    }

    fun userAllow(domain: String) {
        try { engine?.userAllow(domain) } catch (e: Exception) { Log.e(TAG, "userAllow err", e) }
    }

    fun userRemoveAllow(domain: String) {
        try { engine?.userRemoveAllow(domain) } catch (e: Exception) { Log.e(TAG, "userRemoveAllow err", e) }
    }

    fun getStatsJson(): String {
        return try {
            engine?.getStats() ?: "{}"
        } catch (e: Exception) {
            Log.e(TAG, "getStatsJson err", e)
            "{}"
        }
    }

    // 新增：解析日志列表
    fun getBlockLogs(): List<BlockLog> {
        val jsonStr = getStatsJson()
        val list = mutableListOf<BlockLog>()
        try {
            val json = JSONObject(jsonStr)
            val logs = json.optJSONArray("logs")
            if (logs != null) {
                for (i in 0 until logs.length()) {
                    val item = logs.getJSONObject(i)
                    list.add(BlockLog(
                        item.optString("domain", "未知"),
                        item.optString("block_type", "unknown"),
                        item.optLong("timestamp", 0L)
                    ))
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "解析日志失败", e)
        }
        return list
    }
}
