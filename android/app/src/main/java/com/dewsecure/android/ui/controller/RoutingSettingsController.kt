package com.dewsecure.android.ui.controller

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.TextWatcher
import android.view.View
import android.widget.EditText
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.dewsecure.android.R
import com.dewsecure.android.ui.adapter.AppModel
import com.dewsecure.android.ui.adapter.AppRoutingAdapter
import com.dewsecure.android.vpn.DewVpnService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class RoutingSettingsController(
    private val fragment: Fragment,
    private val rootView: View
) {
    private lateinit var etSearchApp: EditText
    private lateinit var rvApps: RecyclerView
    private lateinit var appAdapter: AppRoutingAdapter
    private var allApps = listOf<AppModel>()

    fun setup() {
        etSearchApp = rootView.findViewById(R.id.et_search_app)
        rvApps = rootView.findViewById(R.id.rv_apps)

        rvApps.layoutManager = LinearLayoutManager(fragment.requireContext())
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
        val appContext = fragment.requireContext().applicationContext
        val myPackageName = appContext.packageName

        fragment.lifecycleScope.launch(Dispatchers.IO) {
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
                if (fragment.isAdded) {
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
        val context = fragment.requireContext()
        val prefs = context.getSharedPreferences("app_settings", Context.MODE_PRIVATE)
        prefs.edit().putBoolean("routing_$packageName", isBypassed).apply()

        if (DewVpnService.isRunningState) {
            Toast.makeText(context, "配置已保存，正在重启 VPN...", Toast.LENGTH_SHORT).show()
            // 🌟 核心修复：发送带有明确 Action 的指令，让 Service 内部安全重启
            val restartIntent = Intent(context, DewVpnService::class.java).apply {
                action = "ACTION_RESTART_VPN"
            }
            context.startService(restartIntent)
        } else {
            Toast.makeText(context, "配置已保存，将在下次启动 VPN 时生效", Toast.LENGTH_SHORT).show()
        }
    }
}
