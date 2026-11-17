import re
import shutil
import time
import os

def backup_and_fix():
    ts = time.strftime("%Y%m%d_%H%M%S")
    eb_path = "android/app/src/main/java/com/dewsecure/android/policy/EngineBridge.kt"
    hf_path = "android/app/src/main/java/com/dewsecure/android/ui/HomeFragment.kt"
    
    if os.path.exists(eb_path):
        shutil.copy(eb_path, f"{eb_path}.bak_a22_{ts}")
    if os.path.exists(hf_path):
        shutil.copy(hf_path, f"{hf_path}.bak_a22_{ts}")

    # 1. 修改 EngineBridge.kt：拆分读写，修复 1000 条卡死
    with open(eb_path, "r", encoding="utf-8") as f:
        eb_code = f.read()

    new_stats_func = '''    fun getStatsJson(context: android.content.Context? = null): String {
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

'''
    
    pattern_eb = re.compile(r"    fun getStatsJson\(context: android\.content\.Context\? = null\): String \{.*?// --- 6 大功能联动透传 ---", re.DOTALL)
    if pattern_eb.search(eb_code):
        eb_code = pattern_eb.sub(new_stats_func + "    // --- 6 大功能联动透传 ---", eb_code)
        with open(eb_path, "w", encoding="utf-8") as f:
            f.write(eb_code)
        print(f"✅ 成功修改 {eb_path}")
    else:
        print(f"❌ 未在 {eb_path} 中找到匹配的 getStatsJson，请检查")

    # 2. 修改 HomeFragment.kt：将落盘从 2 秒轮询改到 onPause
    with open(hf_path, "r", encoding="utf-8") as f:
        hf_code = f.read()

    old_onpause = '''    override fun onPause() {
        super.onPause()
        handler.removeCallbacks(updateRunnable)
    }'''
    
    new_onpause = '''    override fun onPause() {
        super.onPause()
        handler.removeCallbacks(updateRunnable)
        // [A-22 修复] 将统计写盘操作移到 onPause，避免每 2 秒高频写 SharedPreferences 造成卡顿
        EngineBridge.saveStatsCache(requireContext())
    }'''

    if old_onpause in hf_code:
        hf_code = hf_code.replace(old_onpause, new_onpause)
        with open(hf_path, "w", encoding="utf-8") as f:
            f.write(hf_code)
        print(f"✅ 成功修改 {hf_path}")
    else:
        print(f"❌ 未在 {hf_path} 中找到匹配的 onPause，请检查")

if __name__ == "__main__":
    backup_and_fix()
