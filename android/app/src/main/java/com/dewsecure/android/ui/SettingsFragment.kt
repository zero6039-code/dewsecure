package com.dewsecure.android.ui

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.dewsecure.android.R
import com.dewsecure.android.policy.AuthManager
import com.dewsecure.android.policy.EngineBridge
import kotlinx.coroutines.launch
import org.json.JSONArray

class SettingsFragment : Fragment() {

    private lateinit var etDomain: EditText
    private lateinit var btnAdd: Button
    private lateinit var containerWhitelist: LinearLayout
    private lateinit var tvEmpty: TextView

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View? {
        return inflater.inflate(R.layout.fragment_settings, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        etDomain = view.findViewById(R.id.et_whitelist_domain)
        btnAdd = view.findViewById(R.id.btn_add_whitelist)
        containerWhitelist = view.findViewById(R.id.container_whitelist)
        tvEmpty = view.findViewById(R.id.tv_whitelist_empty)

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
            etDomain.hint = "例如: example.com"
            btnAdd.isEnabled = true
            btnAdd.text = "添加"
            btnAdd.backgroundTintList = android.content.res.ColorStateList.valueOf(requireContext().getColor(R.color.green_on))

            btnAdd.setOnClickListener {
                val domain = etDomain.text.toString().trim().lowercase()
                if (domain.isNotEmpty()) {
                    addWhitelist(domain, token)
                }
            }
        }

        loadWhitelist(token)
    }

    private fun loadWhitelist(token: String?) {
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

        if (token != null) {
            lifecycleScope.launch {
                val result = AuthManager.uploadWhitelistDomain(requireContext(), token, domain)
                if (result.isSuccess) {
                    Toast.makeText(requireContext(), "已同步到云端", Toast.LENGTH_SHORT).show()
                } else {
                    Toast.makeText(requireContext(), "仅本地生效: ${result.exceptionOrNull()?.message}", Toast.LENGTH_LONG).show()
                }
                loadWhitelist(token)
            }
        } else {
            loadWhitelist(null)
        }
    }

    private fun removeWhitelist(domain: String) {
        val userPrefs = requireContext().getSharedPreferences("user_session", Context.MODE_PRIVATE)
        val token = userPrefs.getString("access_token", null)

        EngineBridge.userRemoveAllow(domain)

        val currentList = getLocalWhitelist().toMutableList()
        currentList.remove(domain)
        saveLocalWhitelist(currentList)

        if (token != null) {
            lifecycleScope.launch {
                AuthManager.deleteCloudWhitelistDomain(requireContext(), token, domain)
                loadWhitelist(token)
            }
        } else {
            loadWhitelist(null)
        }
    }

    // ==== 本地缓存工具 ====
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
