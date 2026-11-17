package com.dewsecure.android.policy

import android.content.Context
import org.json.JSONArray
import java.net.IDN

/**
 * A-19 修复：白名单统一存储与校验入口。
 * - normalize: IDN.toASCII + 标签校验 + 公共后缀黑名单（UI 层快速反馈）
 * - Rust 端 PslSet 会做二次防护（defense in depth）
 */
object WhitelistStore {
    private val LABEL_REGEX = Regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$")
    private val PUBLIC_SUFFIXES = setOf(
        "com","net","org","io","co","cn","uk","gov","edu","mil","int","info","biz",
        "dev","app","me","tv","xyz","top","site","online","club","shop","store",
        "tech","ai","cloud","live","link","pro","vip","win","loan","work","life",
        "world","today","space","website","fun","icu","cc","ws","am","fm","ly","to",
        "gg","so","sh","ac","la","in","us","ca","de","fr","jp","kr","ru","br","au",
        "nz","za","mx","es","it","nl","be","ch","at","se","no","dk","fi","pl","cz",
        "gr","pt","ie","co.uk","org.uk","ac.uk","gov.uk","com.cn","net.cn","org.cn",
        "gov.cn","com.hk","com.tw","co.jp","co.kr","com.au","net.au","org.au",
        "co.nz","com.br","com.mx","com.sg","com.my","co.in","co.id","co.th","co.za"
    )

    fun normalize(raw: String): String? {
        val d = runCatching {
            IDN.toASCII(raw.trim().lowercase().removePrefix("*.").trimEnd('.'))
        }.getOrNull() ?: return null
        val labels = d.split('.')
        if (d.length > 253 || labels.size < 2 || labels.any { !LABEL_REGEX.matches(it) }) return null
        if (PUBLIC_SUFFIXES.contains(d)) return null
        return d
    }

    fun readLocal(ctx: Context): List<String> {
        val prefs = ctx.getSharedPreferences("local_whitelist", Context.MODE_PRIVATE)
        val jsonStr = prefs.getString("domains", "[]") ?: "[]"
        val list = mutableListOf<String>()
        try {
            val array = JSONArray(jsonStr)
            for (i in 0 until array.length()) list.add(array.getString(i))
        } catch (_: Exception) {}
        return list
    }

    fun writeLocal(ctx: Context, list: List<String>) {
        val prefs = ctx.getSharedPreferences("local_whitelist", Context.MODE_PRIVATE)
        val array = JSONArray()
        for (item in list) array.put(item)
        prefs.edit().putString("domains", array.toString()).apply()
    }
}
