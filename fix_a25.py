import os
import shutil
import time
import re

def fix_a25():
    ts = time.strftime("%Y%m%d_%H%M%S")
    manifest_path = "android/app/src/main/AndroidManifest.xml"
    main_act_path = "android/app/src/main/java/com/dewsecure/android/ui/MainActivity.kt"
    xml_dir = "android/app/src/main/res/xml"
    
    # 0. 删除指定备份文件
    old_bak = "backups/a19_phaseB_20261117_171302/MainActivity.kt"
    if os.path.exists(old_bak):
        os.remove(old_bak)
        print(f"✅ 已删除旧备份文件: {old_bak}")
    else:
        print(f"ℹ️ 未找到旧备份文件: {old_bak} (可能已删除)")

    # 备份现有文件
    if os.path.exists(manifest_path):
        shutil.copy(manifest_path, f"{manifest_path}.bak_a25_{ts}")
    if os.path.exists(main_act_path):
        shutil.copy(main_act_path, f"{main_act_path}.bak_a25_{ts}")

    os.makedirs(xml_dir, exist_ok=True)

    # 1. 创建网络安全配置
    nsc_path = os.path.join(xml_dir, "network_security_config.xml")
    with open(nsc_path, "w", encoding="utf-8") as f:
        f.write('''<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- 显式禁止明文流量，全局强制 HTTPS -->
    <base-config cleartextTrafficPermitted="false" />
</network-security-config>
''')
    print(f"✅ 已创建 {nsc_path}")

    # 2. 创建数据提取规则配置
    der_path = os.path.join(xml_dir, "data_extraction_rules.xml")
    with open(der_path, "w", encoding="utf-8") as f:
        f.write('''<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
    <cloud-backup>
        <!-- 彻底禁用云端备份 -->
        <exclude domain="root" path="." />
        <exclude domain="file" path="." />
        <exclude domain="database" path="." />
        <exclude domain="sharedpref" path="." />
        <exclude domain="external" path="." />
    </cloud-backup>
    <device-transfer>
        <!-- 彻底禁用 D2D 迁移 -->
        <exclude domain="root" path="." />
        <exclude domain="file" path="." />
        <exclude domain="database" path="." />
        <exclude domain="sharedpref" path="." />
        <exclude domain="external" path="." />
    </device-transfer>
</data-extraction-rules>
''')
    print(f"✅ 已创建 {der_path}")

    # 3. 修改 AndroidManifest.xml
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest_code = f.read()

    # 移除 QUERY_ALL_PACKAGES
    manifest_code = manifest_code.replace('    <uses-permission android:name="android.permission.QUERY_ALL_PACKAGES" />\n', '')
    
    # 插入 queries 和 application 属性
    queries_and_app = '''    <queries>
        <intent>
            <action android:name="android.intent.action.VIEW" />
            <data android:scheme="https" />
        </intent>
    </queries>

    <application
        android:name=".DewSecureApplication"
        android:allowBackup="false"
        android:dataExtractionRules="@xml/data_extraction_rules"
        android:networkSecurityConfig="@xml/network_security_config"
        android:icon="@drawable/dewsecure_icon"'''
    
    # 精确替换 <application ... 到 android:icon 的部分
    manifest_code = re.sub(
        r'<application\s+android:name="\.DewSecureApplication"\s+android:allowBackup="false"\s+android:icon="@drawable/dewsecure_icon"',
        queries_and_app,
        manifest_code
    )

    with open(manifest_path, "w", encoding="utf-8") as f:
        f.write(manifest_code)
    print(f"✅ 已更新 {manifest_path}")

    # 4. 修改 MainActivity.kt 动态申请通知权限
    with open(main_act_path, "r", encoding="utf-8") as f:
        main_code = f.read()

    # 定位 onCreate 末尾的 else 分支后插入权限请求
    target_str = '''            getSharedPreferences("app_settings", MODE_PRIVATE).edit()
                .remove("cloud_model_version")
                .remove("cloud_rules_version")
                .apply()
        }
    }'''
    
    permission_code = '''            getSharedPreferences("app_settings", MODE_PRIVATE).edit()
                .remove("cloud_model_version")
                .remove("cloud_rules_version")
                .apply()
        }

        // [A-25 修复] 动态申请 Android 13+ 通知权限
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            if (androidx.core.content.ContextCompat.checkSelfPermission(this, android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                androidx.core.app.ActivityCompat.requestPermissions(this, arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 1002)
            }
        }
    }'''

    if target_str in main_code:
        main_code = main_code.replace(target_str, permission_code)
        with open(main_act_path, "w", encoding="utf-8") as f:
            f.write(main_code)
        print(f"✅ 已更新 {main_act_path} (动态通知权限)")
    else:
        print(f"❌ 未在 {main_act_path} 找到匹配的 onCreate 尾部，请检查")

if __name__ == "__main__":
    fix_a25()
