package com.dewsecure.android.vpn

import android.content.Context
import android.util.Log
import com.dewsecure.android.policy.AuthManager
import kotlinx.coroutines.*

class VpnHeartbeatManager(
    private val context: Context,
    private val onDowngrade: () -> Unit
) {
    private val TAG = "VpnHeartbeat"
    private var heartbeatJob: Job? = null

    fun start() {
        if (heartbeatJob != null) return
        heartbeatJob = CoroutineScope(Dispatchers.IO).launch {
            while (isActive) {
                delay(6 * 60 * 60 * 1000L) // 每 6 小时
                Log.i(TAG, "💓 后台心跳校验：正在拉取最新权限...")
                val result = AuthManager.fetchUserProfile(context)
                
                if (result.isSuccess) {
                    val tier = result.getOrNull()
                    if (tier == "free") {
                        Log.w(TAG, "⏰ 试用期已到期或权限被降级，触发回调断开 VPN！")
                        withContext(Dispatchers.Main) { onDowngrade() }
                        break
                    } else {
                        Log.i(TAG, "💓 心跳校验通过，当前权限: $tier")
                    }
                } else {
                    Log.e(TAG, "💓 心跳校验失败（网络问题），维持现状")
                }
            }
        }
    }

    fun stop() {
        heartbeatJob?.cancel()
        heartbeatJob = null
    }
}
