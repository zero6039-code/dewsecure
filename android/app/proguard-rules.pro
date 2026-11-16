# 1. 保留 UniFFI 生成的绑定类
-keep class com.dewsecure.core.** { *; }
-keep class uniffi.** { *; }

# 2. 保留 JNA 相关类（UniFFI 的 JNA 后端需要）
-keep class com.sun.jna.** { *; }
-keepclassmembers class * extends com.sun.jna.** { public *; }
-dontwarn java.awt.**

# 3. 保留 Native 方法名称
-keepclasseswithmembernames class * {
    native <methods>;
}

# 4. 保留 VpnProtector 接口
-keep interface com.dewsecure.core.VpnProtector { *; }

# 5. 保留 Supabase/Ktor 相关序列化类
-keepattributes Signature, InnerClasses, EnclosingMethod
-keepattributes *Annotation*
-dontwarn org.slf4j.**
-dontwarn io.ktor.**
-keep class io.ktor.** { *; }
-keep class io.github.jan_tennert.supabase.** { *; }
-keep class kotlinx.serialization.** { *; }

# 6. 保护数据模型类 (JSON 解析需要)
-keep class com.dewsecure.android.policy.** { *; }

# 7. 可选：移除日志
-assumenosideeffects class android.util.Log {
    public static int d(...);
    public static int v(...);
}


# A-05 修复：移除 Log.i 与 Log.w 防止 Token 泄漏
-assumenosideeffects class android.util.Log {
    public static int i(...);
    public static int w(...);
}
