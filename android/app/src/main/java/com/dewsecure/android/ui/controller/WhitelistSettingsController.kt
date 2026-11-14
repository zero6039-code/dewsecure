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
import org.json.JSONArray

class WhitelistSettingsController(
    private val fragment: Fragment
) {
    private lateinit var etDomain: EditText
    private lateinit var btnAdd: Button
    private lateinit var containerWhitelist: LinearLayout
    private lateinit var tvEmpty: TextView

    fun setup(rootView: View) {
        etDomain = rootView.findViewById(R.id.et_whitelist_domain)
        btnAdd = rootView.findViewById(R.id.btn_add_whitelist)
        containerWhitelist = rootView.findViewById(R.id.container_whitelist)
        tvEmpty = rootView.findViewById(R.id.tv_whitelist_empty)
        
        setupWhitelistLogic()
    }

    private fun setupWhitelistLogic() {
        val context = fragment.requireContext()
        val userPrefs = context.getSharedPreferences("user_session", Context.MODE_PRIVATE)
        val token = userPrefs.getString("access_token", null)

        if (token == null) {
            etDomain.isEnabled = false
            etDomain.hint = "请先登录账号以使用云端同步"
            btnAdd.isEnabled = false
            btnAdd.text = "需登录"
            btnAdd.backgroundTintList = ColorStateList.valueOf(Color.GRAY)
            etDomain.setOnClickListener {
                fragment.startActivity(Intent(context, LoginActivity::class.java))
            }
        } else {
            etDomain.isEnabled = true
            etDomain.hint = "example.com"
            btnAdd.isEnabled = true
            btnAdd.text = "Add"
            btnAdd.backgroundTintList = ColorStateList.valueOf(ContextCompat.getColor(context, R.color.green_on))
            btnAdd.setOnClickListener {
                val domain = etDomain.text.toString().trim().lowercase()
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
                    val mergedList = (localList + cloudList).distinct()
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
