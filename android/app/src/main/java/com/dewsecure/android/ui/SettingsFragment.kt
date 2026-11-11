package com.dewsecure.android.ui

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.dewsecure.android.R
import com.dewsecure.android.policy.AuthManager
import com.dewsecure.android.policy.EngineBridge
import kotlinx.coroutines.launch
import org.json.JSONArray

class SettingsFragment : Fragment() {

    private lateinit var tabLang: LinearLayout
    private lateinit var tabWhitelist: LinearLayout
    private lateinit var tabPrivacy: LinearLayout
    
    private lateinit var paneLang: View
    private lateinit var paneWhitelist: View
    private lateinit var panePrivacy: View

    private lateinit var etDomain: EditText
    private lateinit var btnAdd: Button
    private lateinit var containerWhitelist: LinearLayout
    private lateinit var tvEmpty: TextView

    // 语言配置
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

        // 默认选中白名单页
        switchTab("whitelist")
    }

    private fun initViews(view: View) {
        tabLang = view.findViewById(R.id.tab_lang)
        tabWhitelist = view.findViewById(R.id.tab_whitelist)
        tabPrivacy = view.findViewById(R.id.tab_privacy)

        paneLang = view.findViewById(R.id.pane_lang)
        paneWhitelist = view.findViewById(R.id.pane_whitelist)
        panePrivacy = view.findViewById(R.id.pane_privacy)

        etDomain = view.findViewById(R.id.et_whitelist_domain)
        btnAdd = view.findViewById(R.id.btn_add_whitelist)
        containerWhitelist = view.findViewById(R.id.container_whitelist)
        tvEmpty = view.findViewById(R.id.tv_whitelist_empty)
    }

    private fun setupTabs() {
        tabLang.setOnClickListener { switchTab("lang") }
        tabWhitelist.setOnClickListener { switchTab("whitelist") }
        tabPrivacy.setOnClickListener { switchTab("privacy") }
    }

    private fun switchTab(tab: String) {
        // 重置所有状态
        tabLang.setBackgroundResource(R.drawable.bg_glass_tab_inactive)
        tabWhitelist.setBackgroundResource(R.drawable.bg_glass_tab_inactive)
        tabPrivacy.setBackgroundResource(R.drawable.bg_glass_tab_inactive)
        paneLang.visibility = View.GONE
        paneWhitelist.visibility = View.GONE
        panePrivacy.visibility = View.GONE

        // 激活对应状态
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
        }
    }

    private fun setupLanguageGrid() {
        val grid = view?.findViewById<GridLayout>(R.id.grid_language) ?: return
        
        // 读取当前缓存的语言
        val prefs = requireContext().getSharedPreferences("app_settings", Context.MODE_PRIVATE)
        val currentLang = prefs.getString("language", "en") ?: "en"

        for ((name, code) in languages) {
            val btn = TextView(requireContext())
            btn.text = name
            btn.gravity = Gravity.CENTER
            btn.textSize = 13f
            btn.setPadding(16, 16, 16, 16)
            
            // 设置布局参数，3列等宽
            val params = GridLayout.LayoutParams()
            params.width = 0
            params.height = GridLayout.LayoutParams.WRAP_CONTENT
            params.columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f)
            params.setMargins(8, 8, 8, 8)
            btn.layoutParams = params

            // 状态更新
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

            // 初始化状态
            updateState(code == currentLang)

            // 点击事件
            btn.setOnClickListener {
                // 更新所有按钮状态
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
                
                // 保存语言设置（实际切换语言需要更新 App 的 Locale，这里只做展示和持久化）
                prefs.edit().putString("language", code).apply()
                Toast.makeText(requireContext(), "Language switched to $name", Toast.LENGTH_SHORT).show()
            }

            grid.addView(btn)
        }
    }

    // ==========================================
    // 白名单同步逻辑
    // ==========================================
    private fun setupWhitelistLogic() {
        val userPrefs = requireContext().getSharedPreferences("user_session", Context.MODE_PRIVATE)
        val token = userPrefs.getString("access_token", null)

        if (token == null) {
            etDomain.isEnabled = false
            etDomain.hint = "请先登录账号以使用云端同步"
            btnAdd.isEnabled = false
            btnAdd.text = "需登录"
            btnAdd.backgroundTintList = android.content.res.ColorStateList.valueOf(Color.GRAY)
            etDomain.setOnClickListener {
                startActivity(Intent(requireContext(), LoginActivity::class.java))
            }
        } else {
            etDomain.isEnabled = true
            etDomain.hint = "example.com"
            btnAdd.isEnabled = true
            btnAdd.text = "Add"
            btnAdd.backgroundTintList = android.content.res.ColorStateList.valueOf(ContextCompat.getColor(requireContext(), R.color.green_on))
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
}
