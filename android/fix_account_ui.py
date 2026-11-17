import re
import shutil
import time

def backup_and_fix():
    ts = time.strftime("%Y%m%d_%H%M%S")
    xml_path = "android/app/src/main/res/layout/activity_account.xml"
    kt_path = "android/app/src/main/java/com/dewsecure/android/ui/AccountActivity.kt"
    pm_path = "android/app/src/main/java/com/dewsecure/android/policy/ProfileManager.kt"
    
    for f in [xml_path, kt_path, pm_path]:
        shutil.copy(f, f"{f}.bak_a24_{ts}")

    # 1. 修复 XML 写死的数据，补充 ID
    with open(xml_path, "r", encoding="utf-8") as f:
        xml = f.read()

    xml = xml.replace(
        '<TextView android:id="@+id/tv_account_plan" android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="Family Plan" android:textColor="@color/pro_yellow" android:textStyle="bold" android:textSize="15sp"/>',
        '<TextView android:id="@+id/tv_account_plan" android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="Loading..." android:textColor="@color/pro_yellow" android:textStyle="bold" android:textSize="15sp"/>'
    )
    xml = xml.replace(
        '<TextView android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="2027-10-24" android:textColor="@color/text_primary" android:textSize="15sp"/>',
        '<TextView android:id="@+id/tv_account_expiry_value" android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="-" android:textColor="@color/text_primary" android:textSize="15sp"/>'
    )
    xml = xml.replace(
        '<TextView android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="Family" android:textColor="@color/accent_blue" android:textSize="15sp"/>',
        '<TextView android:id="@+id/tv_account_group_value" android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="-" android:textColor="@color/accent_blue" android:textSize="15sp"/>'
    )
    
    with open(xml_path, "w", encoding="utf-8") as f:
        f.write(xml)
    print("✅ XML 已去除假数据并补充 ID")

    # 2. 修改 ProfileManager 拉取真实的 subscription_ends_at 并存入缓存
    with open(pm_path, "r", encoding="utf-8") as f:
        pm_code = f.read()

    pm_code = pm_code.replace(
        '&select=tier,family_owner_id',
        '&select=tier,family_owner_id,subscription_ends_at'
    )
    
    pm_code = pm_code.replace(
        '''if (familyOwnerId.isNotEmpty() && familyOwnerId != "null") {
                        tier = "family"
                    }''',
        '''if (familyOwnerId.isNotEmpty() && familyOwnerId != "null") {
                        tier = "family"
                    }
                    val subEnds = p.optString("subscription_ends_at", "")
                    prefs.edit().putString("sub_ends_at", subEnds).apply()'''
    )

    with open(pm_path, "w", encoding="utf-8") as f:
        f.write(pm_code)
    print("✅ ProfileManager 已拉取并缓存到期时间")

    # 3. 修改 AccountActivity 动态更新 UI
    with open(kt_path, "r", encoding="utf-8") as f:
        kt_code = f.read()

    # 在 onCreate 末尾加上真实拉取
    kt_code = kt_code.replace(
        '''        updateUI()
        setupListeners()''',
        '''        updateUI()
        setupListeners()
        fetchRealProfile()'''
    )

    # 插入 fetchRealProfile 方法和更新 UI 的逻辑
    fetch_logic = '''
    private fun fetchRealProfile() {
        lifecycleScope.launch {
            val result = com.dewsecure.android.policy.ProfileManager.fetchUserProfile(this@AccountActivity, force = true)
            val prefs = getSharedPreferences("user_session", Context.MODE_PRIVATE)
            val tier = result.getOrDefault(prefs.getString("tier", "free") ?: "free")
            
            val tvPlan = findViewById<TextView>(R.id.tv_account_plan)
            val tvExpiry = findViewById<TextView>(R.id.tv_account_expiry_value)
            val tvGroup = findViewById<TextView>(R.id.tv_account_group_value)

            // 更新 Plan 文本和颜色
            when (tier) {
                "free" -> {
                    tvPlan.text = "Free Plan"
                    tvPlan.setTextColor(android.graphics.Color.WHITE)
                }
                "pro", "premium", "trial", "trial-pro" -> {
                    tvPlan.text = "Pro Plan"
                    tvPlan.setTextColor(getColor(R.color.pro_yellow))
                }
                "family", "sub-family", "family_sub" -> {
                    tvPlan.text = "Family Plan"
                    tvPlan.setTextColor(getColor(R.color.pro_yellow))
                    tvGroup.text = "Family"
                }
                else -> {
                    tvPlan.text = tier
                    tvPlan.setTextColor(getColor(R.color.pro_yellow))
                }
            }

            // 更新到期时间
            val subEnds = prefs.getString("sub_ends_at", "")
            if (!subEnds.isNullOrEmpty() && subEnds != "null") {
                // 格式化时间戳为 yyyy-MM-dd
                try {
                    val date = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", java.util.Locale.US).parse(subEnds.substring(0, 19))
                    tvExpiry.text = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(date!!)
                } catch (e: Exception) {
                    tvExpiry.text = subEnds.substring(0, 10)
                }
            } else {
                tvExpiry.text = "-"
            }
        }
    }
    '''
    
    kt_code = kt_code.replace(
        'override fun onConfigurationChanged(newConfig: Configuration) {',
        fetch_logic + '\n    override fun onConfigurationChanged(newConfig: Configuration) {'
    )

    with open(kt_path, "w", encoding="utf-8") as f:
        f.write(kt_code)
    print("✅ AccountActivity 已接入真实数据拉取并动态渲染")

if __name__ == "__main__":
    backup_and_fix()
