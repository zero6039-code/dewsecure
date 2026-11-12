package com.dewsecure.android.ui

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Color
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.appcompat.widget.SwitchCompat
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.dewsecure.android.R
import com.dewsecure.android.policy.AuthManager
import com.dewsecure.android.policy.EngineBridge
import com.dewsecure.android.ui.adapter.AppModel
import com.dewsecure.android.ui.adapter.AppRoutingAdapter
import com.dewsecure.android.vpn.DewVpnService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray

class SettingsFragment : Fragment() {

    private lateinit var tabLang: LinearLayout
    private lateinit var tabWhitelist: LinearLayout
    private lateinit var tabPrivacy: LinearLayout
    private lateinit var tabRouting: LinearLayout

    private lateinit var paneLang: View
    private lateinit var paneWhitelist: View
    private lateinit var panePrivacy: View
    private lateinit var paneRouting: View

    private lateinit var etDomain: EditText
    private lateinit var btnAdd: Button
    private lateinit var containerWhitelist: LinearLayout
    private lateinit var tvEmpty: TextView

    // 分应用路由相关
    private lateinit var etSearchApp: EditText
    private lateinit var rvApps: RecyclerView
    private lateinit var appAdapter: AppRoutingAdapter
    private var allApps = listOf<AppModel>()

    private val languages = listOf(
        "English" to "en", "简体中文" to "zh", "日本語" to "ja",
        "한국어" to "ko", "Melayu" to "ms", "Español" to "es",
        "Português" to "pt", "Deutsch" to "de", "Français" to "fr"
    )

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View? {
        return inflater.inflate(R.layout.fragment_settings, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        initViews(view)
        setupTabs()
        setupLanguageGrid()
        setupWhitelistLogic()
        setupPrivacyLogic(view)
        setupRoutingLogic(view)

        // 默认选中语言页
        switchTab("lang")
    }

    private fun initViews(view: View) {
        tabLang = view.findViewById(R.id.tab_lang)
        tabWhitelist = view.findViewById(R.id.tab_whitelist)
        tabPrivacy = view.findViewById(R.id.tab_privacy)
        tabRouting = view.findViewById(R.id.tab_routing)

        paneLang = view.findViewById(R.id.pane_lang)
        paneWhitelist = view.findViewById(R.id.pane_whitelist)
        panePrivacy = view.findViewById(R.id.pane_privacy)
        paneRouting = view.findViewById(R.id.pane_routing)

        etDomain = view.findViewById(R.id.et_whitelist_domain)
        btnAdd = view.findViewById(R.id.btn_add_whitelist)
        containerWhitelist = view.findViewById(R.id.container_whitelist)
        tvEmpty = view.findViewById(R.id.tv_whitelist_empty)

        etSearchApp = view.findViewById(R.id.et_search_app)
        rvApps = view.findViewById(R.id.rv_apps)
    }

    private fun setupTabs() {
        tabLang.setOnClickListener { switchTab("lang") }
        tabWhitelist.setOnClickListener { switchTab("whitelist") }
        tabPrivacy.setOnClickListener { switchTab("privacy") }
        tabRouting.setOnClickListener { switchTab("routing") }
    }

    private fun switchTab(tab: String) {
        tabLang.setBackgroundResource(R.drawable.bg_glass_tab_inactive)
        tabWhitelist.setBackgroundResource(R.drawable.bg_glass_tab_inactive)
        tabPrivacy.setBackgroundResource(R.drawable.bg_glass_tab_inactive)
        tabRouting.setBackgroundResource(R.drawable.bg_glass_tab_inactive)

        paneLang.visibility = View.GONE
        paneWhitelist.visibility = View.GONE
        panePrivacy.visibility = View.GONE
        paneRouting.visibility = View.GONE

        when (tab) {
            "lang" -> {
                tabLang.setBackgroundResource(R.drawable.bg_glass_tab_active)
                paneLang.visibility = View.VISIBLE
            }
            "whitelist" -> {
                tabWhitelist.setBackgroundResource(R.drawable.bg_glass_tab_active)
                paneWhitelist.visibility = View.VISIBLE
                loadWhitelistData()
            }
            "privacy" -> {
                tabPrivacy.setBackgroundResource(R.drawable.bg_glass_tab_active)
                panePrivacy.visibility = View.VISIBLE
            }
            "routing" -> {
                tabRouting.setBackgroundResource(R.drawable.bg_glass_tab_active)
                paneRouting.visibility = View.VISIBLE
            }
        }
    }

    // ==========================================
    // 分应用路由逻辑
    // ==========================================
    private fun setupRoutingLogic(view: View) {
        rvApps.layoutManager = LinearLayoutManager(requireContext())
        appAdapter = AppRoutingAdapter(emptyList()) { app, isChecked ->
            saveAppRouting(app.packageName, isChecked)
        }
        rvApps.adapter = appAdapter

        etSearchApp.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                filterApps(s.toString())
            }
            override fun afterTextChanged(s: Editable?) {}
        })

        loadInstalledApps()
    }

    private fun loadInstalledApps() {
        // 在进入异步之前，安全地获取 Context 引用，防止协程执行期间 Fragment 被销毁导致闪退
        val appContext = requireContext().applicationContext
        val myPackageName = appContext.packageName

        lifecycleScope.launch(Dispatchers.IO) {
            val pm = appContext.packageManager
            val packages = pm.getInstalledApplications(PackageManager.GET_META_DATA)
            val prefs = appContext.getSharedPreferences("app_settings", Context.MODE_PRIVATE)

            val list = mutableListOf<AppModel>()
            for (info in packages) {
                if (info.packageName == myPackageName) continue
                if ((info.flags and ApplicationInfo.FLAG_SYSTEM) != 0 && pm.getLaunchIntentForPackage(info.packageName) == null) continue

                val name = pm.getApplicationLabel(info).toString()
                val icon = info.loadIcon(pm)
                val isBypassed = prefs.getBoolean("routing_${info.packageName}", false)
                list.add(AppModel(name, info.packageName, icon, isBypassed))
            }

            val sortedList = list.sortedWith(compareByDescending<AppModel> { it.isBypassed }.thenBy { it.name })

            withContext(Dispatchers.Main) {
                // 回到主线程时，必须检查 Fragment 是否还活着
                if (isAdded && view != null) {
                    allApps = sortedList
                    appAdapter.updateData(allApps)
                }
            }
        }
    }

    private fun filterApps(query: String) {
        if (query.isEmpty()) {
            appAdapter.updateData(allApps)
        } else {
            val filtered = allApps.filter {
                it.name.contains(query, ignoreCase = true) || it.packageName.contains(query, ignoreCase = true)
            }
            appAdapter.updateData(filtered)
        }
    }

    private fun saveAppRouting(packageName: String, isBypassed: Boolean) {
        val prefs = requireContext().getSharedPreferences("app_settings", Context.MODE_PRIVATE)
        prefs.edit().putBoolean("routing_$packageName", isBypassed).apply()

        if (DewVpnService.isRunningState) {
            Toast.makeText(requireContext(), "配置已保存，正在重启 VPN...", Toast.LENGTH_SHORT).show()
            val intent = Intent(requireContext(), DewVpnService::class.java)
            requireContext().stopService(intent)
            // 延迟 200ms 启动，避免系统来不及清理旧的 VPN 句柄
            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                requireContext().startService(intent)
            }, 200)
        } else {
            Toast.makeText(requireContext(), "配置已保存，将在下次启动 VPN 时生效", Toast.LENGTH_SHORT).show()
        }
    }

    // ==========================================
    // 下面保留原有的：语言、白名单、隐私逻辑
    // ==========================================
    private fun setupLanguageGrid() {
        val grid = view?.findViewById<GridLayout>(R.id.grid_language) ?: return
        val prefs = requireContext().getSharedPreferences("app_settings", Context.MODE_PRIVATE)
        val currentLang = prefs.getString("language", "en") ?: "en"

        for ((name, code) in languages) {
            val btn = TextView(requireContext())
            btn.text = name
            btn.gravity = Gravity.CENTER
            btn.textSize = 13f
            btn.setPadding(16, 16, 16, 16)

            val params = GridLayout.LayoutParams()
            params.width = 0
            params.height = GridLayout.LayoutParams.WRAP_CONTENT
            params.columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f)
            params.setMargins(8, 8, 8, 8)
            btn.layoutParams = params

            fun updateState(isSelected: Boolean) {
                if (isSelected) {
                    btn.setBackgroundResource(R.drawable.bg_glass_tab_active)
                    btn.setTextColor(ContextCompat.getColor(requireContext(), R.color.green_on))
                    btn.setTypeface(null, android.graphics.Typeface.BOLD)
                } else {
                    btn.setBackgroundResource(R.drawable.bg_glass_card)
                    btn.setTextColor(ContextCompat.getColor(requireContext(), R.color.text_primary))
                    btn.setTypeface(null, android.graphics.Typeface.NORMAL)
                }
            }

            updateState(code == currentLang)

            btn.setOnClickListener {
                for (i in 0 until grid.childCount) {
                    val child = grid.getChildAt(i) as TextView
                    val childLang = languages[i].second
                    if (childLang == code) {
                        child.setBackgroundResource(R.drawable.bg_glass_tab_active)
                        child.setTextColor(ContextCompat.getColor(requireContext(), R.color.green_on))
                        child.setTypeface(null, android.graphics.Typeface.BOLD)
                    } else {
                        child.setBackgroundResource(R.drawable.bg_glass_card)
                        child.setTextColor(ContextCompat.getColor(requireContext(), R.color.text_primary))
                        child.setTypeface(null, android.graphics.Typeface.NORMAL)
                    }
                }
                prefs.edit().putString("language", code).apply()
                Toast.makeText(requireContext(), "Language switched to $name", Toast.LENGTH_SHORT).show()
            }
            grid.addView(btn)
        }
    }

    private fun setupWhitelistLogic() {
        val userPrefs = requireContext().getSharedPreferences("user_session", Context.MODE_PRIVATE)
        val token = userPrefs.getString("access_token", null)

        if (token == null) {
            etDomain.isEnabled = false
            etDomain.hint = "请先登录账号以使用云端同步"
            btnAdd.isEnabled = false
            btnAdd.text = "需登录"
            btnAdd.backgroundTintList = ColorStateList.valueOf(Color.GRAY)
            etDomain.setOnClickListener {
                startActivity(Intent(requireContext(), LoginActivity::class.java))
            }
        } else {
            etDomain.isEnabled = true
            etDomain.hint = "example.com"
            btnAdd.isEnabled = true
            btnAdd.text = "Add"
            btnAdd.backgroundTintList = ColorStateList.valueOf(ContextCompat.getColor(requireContext(), R.color.green_on))
            btnAdd.setOnClickListener {
                val domain = etDomain.text.toString().trim().lowercase()
                if (domain.isNotEmpty()) {
                    addWhitelist(domain, token)
                }
            }
        }
    }

    private fun loadWhitelistData() {
        val userPrefs = requireContext().getSharedPreferences("user_session", Context.MODE_PRIVATE)
        val token = userPrefs.getString("access_token", null)
        val localList = getLocalWhitelist()
        EngineBridge.loadUserWhitelist(localList)
        updateUI(localList)

        if (token != null) {
            lifecycleScope.launch {
                val result = AuthManager.fetchCloudWhitelist(requireContext(), token)
                if (result.isSuccess) {
                    val cloudList = result.getOrNull() ?: emptyList()
                    val mergedList = (localList + cloudList).distinct()
                    EngineBridge.loadUserWhitelist(mergedList)
                    saveLocalWhitelist(mergedList)
                    updateUI(mergedList)
                }
            }
        }
    }

    private fun updateUI(domains: List<String>) {
        if (!isAdded) return
        containerWhitelist.removeAllViews()
        if (domains.isEmpty()) {
            tvEmpty.visibility = View.VISIBLE
        } else {
            tvEmpty.visibility = View.GONE
            for (domain in domains) {
                val itemView = layoutInflater.inflate(R.layout.item_whitelist, containerWhitelist, false)
                itemView.findViewById<TextView>(R.id.tv_domain).text = domain
                itemView.findViewById<View>(R.id.btn_delete).setOnClickListener {
                    removeWhitelist(domain)
                }
                containerWhitelist.addView(itemView)
            }
        }
    }

    private fun addWhitelist(domain: String, token: String?) {
        EngineBridge.userAllow(domain)
        val currentList = getLocalWhitelist().toMutableList()
        if (!currentList.contains(domain)) {
            currentList.add(domain)
            saveLocalWhitelist(currentList)
        }
        etDomain.text.clear()
        updateUI(currentList)

        if (token != null) {
            lifecycleScope.launch {
                val result = AuthManager.uploadWhitelistDomain(requireContext(), token, domain)
                if (result.isSuccess) {
                    Toast.makeText(requireContext(), "Synced to cloud", Toast.LENGTH_SHORT).show()
                } else {
                    Toast.makeText(requireContext(), "Local only: ${result.exceptionOrNull()?.message}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun removeWhitelist(domain: String) {
        val userPrefs = requireContext().getSharedPreferences("user_session", Context.MODE_PRIVATE)
        val token = userPrefs.getString("access_token", null)
        EngineBridge.userRemoveAllow(domain)
        val currentList = getLocalWhitelist().toMutableList()
        currentList.remove(domain)
        saveLocalWhitelist(currentList)
        updateUI(currentList)

        if (token != null) {
            lifecycleScope.launch {
                val result = AuthManager.deleteCloudWhitelistDomain(requireContext(), token, domain)
                if (!result.isSuccess) {
                    Toast.makeText(requireContext(), "Cloud delete failed", Toast.LENGTH_LONG).show()
                    loadWhitelistData()
                }
            }
        }
    }

    private fun getLocalWhitelist(): List<String> {
        val prefs = requireContext().getSharedPreferences("local_whitelist", Context.MODE_PRIVATE)
        val jsonStr = prefs.getString("domains", "[]") ?: "[]"
        val list = mutableListOf<String>()
        try {
            val array = JSONArray(jsonStr)
            for (i in 0 until array.length()) {
                list.add(array.getString(i))
            }
        } catch (e: Exception) {}
        return list
    }

    private fun saveLocalWhitelist(list: List<String>) {
        val prefs = requireContext().getSharedPreferences("local_whitelist", Context.MODE_PRIVATE)
        val array = JSONArray()
        for (item in list) {
            array.put(item)
        }
        prefs.edit().putString("domains", array.toString()).apply()
    }

    private fun setupPrivacyLogic(view: View) {
        val switchShareThreat = view.findViewById<SwitchCompat>(R.id.switch_share_threat)
        val prefs = requireContext().getSharedPreferences("app_settings", Context.MODE_PRIVATE)

        val states = arrayOf(
            intArrayOf(android.R.attr.state_checked),
            intArrayOf(-android.R.attr.state_checked)
        )
        val thumbColors = intArrayOf(Color.WHITE, Color.WHITE)
        val trackColors = intArrayOf(Color.parseColor("#00E5FF"), Color.parseColor("#424242"))

        switchShareThreat.thumbTintList = ColorStateList(states, thumbColors)
        switchShareThreat.trackTintList = ColorStateList(states, trackColors)

        switchShareThreat.isChecked = prefs.getBoolean("pref_share_threat_intel", true)

        switchShareThreat.setOnCheckedChangeListener { _, isChecked ->
            prefs.edit().putBoolean("pref_share_threat_intel", isChecked).apply()
            val msg = if (isChecked) "已开启：将匿名上报新型威胁" else "已关闭：停止匿名上报"
            Toast.makeText(requireContext(), msg, Toast.LENGTH_SHORT).show()
        }
    }
}
