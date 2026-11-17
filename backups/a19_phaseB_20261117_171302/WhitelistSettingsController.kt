package com.dewsecure.android.ui.controller

import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.dewsecure.android.R
import com.dewsecure.android.policy.AuthManager
import com.dewsecure.android.policy.EngineBridge
import com.dewsecure.android.ui.LoginActivity
import kotlinx.coroutines.launch
import java.net.IDN
import org.json.JSONArray

class WhitelistSettingsController(
    private val fragment: Fragment
) {
    private lateinit var etDomain: EditText
    private lateinit var btnAdd: Button
    private lateinit var containerWhitelist: LinearLayout
    private lateinit var tvEmpty: TextView

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

    fun normalizeWhitelist(raw: String): String? {
        val d = runCatching {
            IDN.toASCII(raw.trim().lowercase().removePrefix("*.").trimEnd('.'))
        }.getOrNull() ?: return null
        val labels = d.split('.')
        if (d.length > 253 || labels.size < 2 || labels.any { !LABEL_REGEX.matches(it) }) return null
        if (PUBLIC_SUFFIXES.contains(d)) return null
        return d
    }

    fun setup(rootView: View) {
        etDomain = rootView.findViewById(R.id.et_whitelist_domain)
        // 🌟 强制锁定字体大小，防止被 XML 覆盖
        etDomain.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 14f)
        btnAdd = rootView.findViewById(R.id.btn_add_whitelist)
        containerWhitelist = rootView.findViewById(R.id.container_whitelist)
        tvEmpty = rootView.findViewById(R.id.tv_whitelist_empty)
        
        refreshLoginState()
    }

    fun refreshLoginState() {
        val context = fragment.requireContext()
        val userPrefs = context.getSharedPreferences("user_session", Context.MODE_PRIVATE)
        val token = userPrefs.getString("access_token", null)

        // 🌟 强制修改字体大小
        etDomain.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 14f)
        
        if (token == null) {
            etDomain.isEnabled = false
            etDomain.hint = context.getString(R.string.settings_whitelist_hint)
            btnAdd.isEnabled = false
            btnAdd.text = context.getString(R.string.settings_whitelist_login_req)
            btnAdd.backgroundTintList = ColorStateList.valueOf(Color.GRAY)
            etDomain.setOnClickListener {
                fragment.startActivity(Intent(context, LoginActivity::class.java))
            }
            btnAdd.setOnClickListener {
                fragment.startActivity(Intent(context, LoginActivity::class.java))
            }
        } else {
            etDomain.isEnabled = true
            etDomain.hint = "example.com"
            btnAdd.isEnabled = true
            btnAdd.text = context.getString(R.string.settings_whitelist_add)
            btnAdd.backgroundTintList = ColorStateList.valueOf(ContextCompat.getColor(context, R.color.green_on))
            etDomain.setOnClickListener(null)
            btnAdd.setOnClickListener {
                val domain = normalizeWhitelist(etDomain.text.toString())
                if (domain == null) {
                    Toast.makeText(context, "Invalid domain or public suffix", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }
                if (domain.isNotEmpty()) {
                    addWhitelist(domain, token)
                }
            }
        }
    }

    fun loadWhitelistData() {
        val context = fragment.requireContext()
        val userPrefs = context.getSharedPreferences("user_session", Context.MODE_PRIVATE)
        val token = userPrefs.getString("access_token", null)
        val localList = getLocalWhitelist()
        EngineBridge.loadUserWhitelist(localList)
        updateUI(localList)

        if (token != null) {
            fragment.lifecycleScope.launch {
                val result = AuthManager.fetchCloudWhitelist(context, token)
                if (result.isSuccess) {
                    val cloudList = result.getOrNull() ?: emptyList()
                    val mergedList = (localList + cloudList.mapNotNull { normalizeWhitelist(it) }).distinct()
                    EngineBridge.loadUserWhitelist(mergedList)
                    saveLocalWhitelist(mergedList)
                    updateUI(mergedList)
                }
            }
        }
    }

    private fun updateUI(domains: List<String>) {
        if (!fragment.isAdded) return
        containerWhitelist.removeAllViews()
        if (domains.isEmpty()) {
            tvEmpty.visibility = View.VISIBLE
        } else {
            tvEmpty.visibility = View.GONE
            for (domain in domains) {
                val itemView = fragment.layoutInflater.inflate(R.layout.item_whitelist, containerWhitelist, false)
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
            fragment.lifecycleScope.launch {
                val result = AuthManager.uploadWhitelistDomain(fragment.requireContext(), token, domain)
                if (result.isSuccess) {
                    Toast.makeText(fragment.requireContext(), "Synced to cloud", Toast.LENGTH_SHORT).show()
                } else {
                    Toast.makeText(fragment.requireContext(), "Local only: ${result.exceptionOrNull()?.message}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun removeWhitelist(domain: String) {
        val context = fragment.requireContext()
        val userPrefs = context.getSharedPreferences("user_session", Context.MODE_PRIVATE)
        val token = userPrefs.getString("access_token", null)
        EngineBridge.userRemoveAllow(domain)
        val currentList = getLocalWhitelist().toMutableList()
        currentList.remove(domain)
        saveLocalWhitelist(currentList)
        updateUI(currentList)

        if (token != null) {
            fragment.lifecycleScope.launch {
                val result = AuthManager.deleteCloudWhitelistDomain(context, token, domain)
                if (!result.isSuccess) {
                    Toast.makeText(context, "Cloud delete failed", Toast.LENGTH_LONG).show()
                    loadWhitelistData()
                }
            }
        }
    }

    private fun getLocalWhitelist(): List<String> {
        val context = fragment.requireContext()
        val prefs = context.getSharedPreferences("local_whitelist", Context.MODE_PRIVATE)
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
        val context = fragment.requireContext()
        val prefs = context.getSharedPreferences("local_whitelist", Context.MODE_PRIVATE)
        val array = JSONArray()
        for (item in list) {
            array.put(item)
        }
        prefs.edit().putString("domains", array.toString()).apply()
    }
}
