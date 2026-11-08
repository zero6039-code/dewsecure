package com.dewsecure.android.policy

import android.util.Log
import com.dewsecure.core.*
import java.lang.Exception

/**
 * Kotlin 到 Rust 引擎的唯一桥梁。
 * 所有调用必须包裹 try/catch，异常时一律降级为 Allow，绝不阻断用户网络。
 */
object EngineBridge {
    private const val TAG = "EngineBridge"
    private var engine: HostEngine? = null

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
        val e = engine ?: return fallbackAllow(domain)
        return try {
            val result = e.shouldBlock(domain)
            // 如果 Rust 返回的 confidence 极低，且我们不确信，保险起见放行
            result
        } catch (ex: Exception) {
            Log.e(TAG, "调用 should_block 异常: $domain", ex)
            fallbackAllow(domain)
        }
    }

    private fun fallbackAllow(domain: String): BlockResult {
        return BlockResult(BlockDecision.ALLOW, "fallback_allow", 0.0f)
    }

    // A0-6c 用户白名单接口（供后续 UI 调用）
    fun userAllow(domain: String) {
        try { engine?.userAllow(domain) } catch (e: Exception) { Log.e(TAG, "userAllow err", e) }
    }

    fun userRemoveAllow(domain: String) {
        try { engine?.userRemoveAllow(domain) } catch (e: Exception) { Log.e(TAG, "userRemoveAllow err", e) }
    }
}
