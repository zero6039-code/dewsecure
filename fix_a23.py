import re
import shutil
import time
import os

def backup_and_fix():
    ts = time.strftime("%Y%m%d_%H%M%S")
    files_to_backup = [
        "core/src/lib.rs",
        "core/src/vpn/device.rs",
        "core/src/vpn/engine.rs",
        "android/app/src/main/java/com/dewsecure/android/ui/controller/PrivacySettingsController.kt",
        "android/app/src/main/java/com/dewsecure/android/policy/DeviceManager.kt",
        "android/app/src/main/java/com/dewsecure/android/ui/HomeFragment.kt",
        "android/app/src/main/java/com/dewsecure/android/policy/WhitelistManager.kt"
    ]
    
    for f in files_to_backup:
        if os.path.exists(f):
            shutil.copy(f, f"{f}.bak_a23_{ts}")

    # 1. Rust: lib.rs 日志级别降级
    with open("core/src/lib.rs", "r", encoding="utf-8") as f:
        code = f.read()
    code = code.replace(
        ".with_max_level(log::LevelFilter::Trace)",
        ".with_max_level(if cfg!(debug_assertions) { log::LevelFilter::Trace } else { log::LevelFilter::Warn })"
    )
    with open("core/src/lib.rs", "w", encoding="utf-8") as f:
        f.write(code)
    print("✅ core/src/lib.rs 日志级别已修复")

    # 2. Rust: device.rs 屏蔽敏感日志
    with open("core/src/vpn/device.rs", "r", encoding="utf-8") as f:
        code = f.read()
    code = code.replace('log::info!("📥 [TUN RX] 收到 SYN: 目标 {}:{}", dst_ip, dst_port);',
                        'log::debug!("📥 [TUN RX] 收到 SYN: 目标 {}:{}", dst_ip, dst_port);')
    with open("core/src/vpn/device.rs", "w", encoding="utf-8") as f:
        f.write(code)
    print("✅ core/src/vpn/device.rs 敏感日志已降级")

    # 3. Rust: engine.rs 屏蔽敏感日志
    with open("core/src/vpn/engine.rs", "r", encoding="utf-8") as f:
        code = f.read()
    code = code.replace('info!("🔍 Socket {:?} 状态: {:?}", h, socket.state());',
                        'log::debug!("🔍 Socket {:?} 状态: {:?}", h, socket.state());')
    code = code.replace('info!("🔗 捕获 TCP 连接: {}:{}", ip_str, target_port);',
                        'log::debug!("🔗 捕获 TCP 连接: {}:{}", ip_str, target_port);')
    with open("core/src/vpn/engine.rs", "w", encoding="utf-8") as f:
        f.write(code)
    print("✅ core/src/vpn/engine.rs 敏感日志已降级")

    # 4. Kotlin: PrivacySettingsController.kt 默认关闭
    with open("android/app/src/main/java/com/dewsecure/android/ui/controller/PrivacySettingsController.kt", "r", encoding="utf-8") as f:
        code = f.read()
    code = code.replace(
        'switchShareThreat.isChecked = prefs.getBoolean("pref_share_threat_intel", true)',
        'switchShareThreat.isChecked = prefs.getBoolean("pref_share_threat_intel", false)'
    )
    with open("android/app/src/main/java/com/dewsecure/android/ui/controller/PrivacySettingsController.kt", "w", encoding="utf-8") as f:
        f.write(code)
    print("✅ PrivacySettingsController.kt 默认值改为关闭")

    # 5. Kotlin: DeviceManager.kt 接入开关 & 废除 ANDROID_ID
    with open("android/app/src/main/java/com/dewsecure/android/policy/DeviceManager.kt", "r", encoding="utf-8") as f:
        code = f.read()
    
    # 替换 getFingerprint
    new_fingerprint = '''private fun getFingerprint(context: Context): String {
        val prefs = context.getSharedPreferences("app_settings", Context.MODE_PRIVATE)
        var id = prefs.getString(INSTALLATION_KEY, null)
        if (id == null) {
            id = UUID.randomUUID().toString()
            prefs.edit().putString(INSTALLATION_KEY, id).apply()
        }
        return id
    }'''
    code = re.sub(r'private fun getFingerprint\(context: Context\): String \{.*?\n    \}', new_fingerprint, code, flags=re.DOTALL)

    # 插入隐私检查
    check_code = '''val prefs = context.getSharedPreferences("app_settings", Context.MODE_PRIVATE)

        if (!prefs.getBoolean("pref_share_threat_intel", false)) {
            Log.d(TAG, "用户关闭了威胁情报分享，跳过设备上报")
            return@withContext "OPT_OUT"
        }

        try {'''
    code = code.replace('val prefs = context.getSharedPreferences("app_settings", Context.MODE_PRIVATE)\n\n        try {', check_code)
    
    with open("android/app/src/main/java/com/dewsecure/android/policy/DeviceManager.kt", "w", encoding="utf-8") as f:
        f.write(code)
    print("✅ DeviceManager.kt 隐私开关已接线且去除了硬件指纹")

    # 6. Kotlin: HomeFragment.kt 域名正则校验
    with open("android/app/src/main/java/com/dewsecure/android/ui/HomeFragment.kt", "r", encoding="utf-8") as f:
        code = f.read()
    
    target = '''val domain = etDomain.text.toString().trim().lowercase()
            if (domain.isNotEmpty()) {'''
    
    replace = '''val domain = etDomain.text.toString().trim().lowercase()
            if (!domain.matches(Regex("^[a-zA-Z0-9.-]+\\\\.[a-zA-Z]{2,}$"))) {
                Toast.makeText(requireContext(), "域名格式不合法", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            if (domain.isNotEmpty()) {'''
    
    code = code.replace(target, replace)
    with open("android/app/src/main/java/com/dewsecure/android/ui/HomeFragment.kt", "w", encoding="utf-8") as f:
        f.write(code)
    print("✅ HomeFragment.kt 已加入域名格式校验")

    # 7. Kotlin: WhitelistManager.kt 防连发
    with open("android/app/src/main/java/com/dewsecure/android/policy/WhitelistManager.kt", "r", encoding="utf-8") as f:
        code = f.read()
    
    target_report = '''suspend fun submitReport(context: Context, type: String, domain: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {'''
    
    replace_report = '''suspend fun submitReport(context: Context, type: String, domain: String): Result<Unit> = withContext(Dispatchers.IO) {
        val ratePrefs = context.getSharedPreferences("report_rate_limit", Context.MODE_PRIVATE)
        val lastTime = ratePrefs.getLong("last_report_time", 0L)
        if (System.currentTimeMillis() - lastTime < 60_000L) {
            return@withContext Result.failure(Exception("操作太频繁，请 1 分钟后再试"))
        }
        ratePrefs.edit().putLong("last_report_time", System.currentTimeMillis()).apply()

        try {'''
    
    code = code.replace(target_report, replace_report)
    with open("android/app/src/main/java/com/dewsecure/android/policy/WhitelistManager.kt", "w", encoding="utf-8") as f:
        f.write(code)
    print("✅ WhitelistManager.kt 已加入 1 分钟防连发限制")

if __name__ == "__main__":
    backup_and_fix()
