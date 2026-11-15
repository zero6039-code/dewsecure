package com.dewsecure.android.policy

import android.content.Context
import android.content.pm.PackageManager
import java.io.File

object RootUtils {
    /**
     * 极其严格的 Root 检测逻辑
     */
    fun isRooted(context: Context): Boolean {
        // 1. 检测常见的 su 二进制文件路径
        val paths = arrayOf(
            "/system/bin/su", "/system/xbin/su", "/sbin/su", "/data/local/su",
            "/data/local/bin/su", "/data/local/xbin/su", "/system/sd/xbin/su",
            "/system/bin/failsafe/su", "/system/xbin/daemonsu"
        )
        for (path in paths) {
            if (File(path).exists()) return true
        }

        // 2. 检测 Magisk 或其他 Root 管理器的包名
        val rootPackages = arrayOf(
            "com.topjohnwu.magisk", // Magisk
            "com.koushikdutta.superuser", // Superuser
            "com.noshufou.android.su", // SuperSU
            "eu.chainfire.supersu", // SuperSU
            "me.phh.superuser"
        )
        val pm = context.packageManager
        for (pkg in rootPackages) {
            try {
                pm.getPackageInfo(pkg, 0)
                return true // 找到了 Root 管理器
            } catch (e: PackageManager.NameNotFoundException) {
                // 忽略
            }
        }

        // 3. 检测系统签名是否为 test-keys (常用于开发版或 Root 固件)
        val buildTags = android.os.Build.TAGS
        if (buildTags != null && buildTags.contains("test-keys")) return true

        return false
    }
}
