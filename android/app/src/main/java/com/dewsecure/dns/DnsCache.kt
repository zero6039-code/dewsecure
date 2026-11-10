package com.dewsecure.dns

import java.util.LinkedHashMap

/**
 * 🚀 P-9 修复：带 TTL 的 LRU DNS 应答缓存
 * 自动淘汰最久未使用的记录，限制最大容量 2048 条，防止内存泄漏。
 */
class DnsCache(private val max: Int = 2048) {
    private data class Entry(val bytes: ByteArray, val expireAt: Long)
    
    private val map = object : LinkedHashMap<String, Entry>(256, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Entry>): Boolean {
            return size > max
        }
    }

    @Synchronized
    fun get(key: String): ByteArray? {
        val entry = map[key] ?: return null
        if (System.currentTimeMillis() >= entry.expireAt) {
            map.remove(key)
            return null
        }
        return entry.bytes
    }

    @Synchronized
    fun put(key: String, resp: ByteArray, ttlSec: Int) {
        // TTL 上限固定为 5 分钟 (300秒)，防止恶意超长 TTL 导致缓存僵死
        val finalTtl = minOf(ttlSec, 300).coerceAtLeast(10) // 保底 10 秒
        map[key] = Entry(resp, System.currentTimeMillis() + finalTtl * 1000L)
    }
}
