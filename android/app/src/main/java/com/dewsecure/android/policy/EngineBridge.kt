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
        var timestamp: Long,
        var count: Int = 1
    )

    fun init(ruleData: String = "", modelPath: String = "", aiEnabled: Boolean = true) {
        try {
            val config = EngineConfig(ruleData, modelPath, aiEnabled)
            engine = HostEngine(config)
            Log.i(TAG, "HostEngine 初始化成功")

            // 自检：强行测一下底层是不是坏的
            val testRes = engine?.shouldBlock("doubleclick.net")
            Log.i(TAG, "🧪 引擎自检 - doubleclick.net 结果: ${testRes?.decision} / ${testRes?.reason}")

        } catch (e: Throwable) {
            Log.e(TAG, "HostEngine 初始化失败 (可能缺少 .so 库)，降级为全放行", e)
            engine = null
        }
    }

    fun shouldBlock(domain: String): BlockResult {
        val e = engine ?: return fallbackAllow()
        return try {
            e.shouldBlock(domain)
        } catch (ex: Throwable) {
            Log.e(TAG, "调用 should_block 异常: $domain", ex)
            fallbackAllow()
        }
    }

    private fun fallbackAllow(): BlockResult {
        return BlockResult(BlockDecision.ALLOW, "fallback_allow", 0.0f)
    }

    fun userAllow(domain: String) {
        try { engine?.userAllow(domain) } catch (e: Throwable) { Log.e(TAG, "userAllow err", e) }
    }

    fun userRemoveAllow(domain: String) {
        try { engine?.userRemoveAllow(domain) } catch (e: Throwable) { Log.e(TAG, "userRemoveAllow err", e) }
    }

    fun loadUserWhitelist(domains: List<String>) {
        try {
            engine?.loadUserWhitelist(domains)
            Log.i(TAG, "加载用户白名单 ${domains.size} 条")
        } catch (e: Throwable) {
            Log.e(TAG, "loadUserWhitelist err", e)
        }
    }

    fun getUserAllowList(): List<String> {
        return try {
            engine?.getUserAllowList() ?: emptyList()
        } catch (e: Throwable) {
            Log.e(TAG, "getUserAllowList err", e)
            emptyList()
        }
    }

    fun getStatsJson(): String {
        return try {
            engine?.getStats() ?: "{}"
        } catch (e: Exception) {
            Log.e(TAG, "getStatsJson err", e)
            "{}"
        }
    }

    fun getBlockLogs(): List<BlockLog> {
        val jsonStr = getStatsJson()
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
        } catch (e: Exception) {
            Log.e(TAG, "解析日志失败", e)
        }

        val groupedMap = mutableMapOf<String, BlockLog>()
        for (log in rawList) {
            if (groupedMap.containsKey(log.domain)) {
                val existing = groupedMap[log.domain]!!
                existing.count += 1
                if (log.timestamp > existing.timestamp) {
                    existing.timestamp = log.timestamp
                }
            } else {
                groupedMap[log.domain] = log
            }
        }

        return groupedMap.values.sortedByDescending { it.timestamp }
    }
}
