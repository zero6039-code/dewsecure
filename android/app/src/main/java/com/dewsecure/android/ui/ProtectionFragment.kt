package com.dewsecure.android.ui

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.widget.SwitchCompat
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.dewsecure.android.R
import com.dewsecure.android.policy.AuthManager
import com.dewsecure.android.policy.EngineBridge
import com.dewsecure.android.policy.RootChecker
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class ProtectionFragment : Fragment() {

    private val features = listOf(
        Feature("dnr", "DNR Rule Blocking", "Blocks known malicious domains, ads & trackers", false, true),
        Feature("tracker", "Block Trackers", "Intercepts tracking scripts and pixels", false, true),
        Feature("social", "Block Social Trackers", "Blocks social media tracking buttons", false, true),
        Feature("intel", "Real-time Threat Intel", "Dynamically blocks newly emerged phishing domains", true, true),
        Feature("ai_phishing", "AI Phishing Detection", "Identifies malicious and phishing domains (Pro)", true, true),
        Feature("ai_zero_day", "AI Smart Real-time Detection", "AI dynamic blocking for zero-day ads (Pro)", true, true),
        Feature("mitm_browser", "MitM Browser Filtering", "HTTPS filtering for browsers (Install cert & choose 'VPN and app')", true, true),
        Feature("mitm_root", "MitM Full-App Filtering", "HTTPS filtering for all apps (Install cert & choose 'VPN and app', Requires Root)", true, true)
    )

    data class Feature(val id: String, val title: String, val desc: String, val isPro: Boolean, val isSupported: Boolean)

    private lateinit var container: LinearLayout

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View? {
        return inflater.inflate(R.layout.fragment_protection, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        container = view.findViewById(R.id.feature_container)
        initFeatureViews()
        updateUiState()
    }

    override fun onResume() {
        super.onResume()
        updateUiState()

        viewLifecycleOwner.lifecycleScope.launch {
            val oldTier = requireContext().getSharedPreferences("user_session", Context.MODE_PRIVATE).getString("tier", "free")
            val res = AuthManager.fetchUserProfile(requireContext())
            if (res.isSuccess) {
                val newTier = res.getOrNull() ?: "free"
                if (newTier != oldTier) {
                    updateUiState()
                }
            }
        }
    }

    private fun initFeatureViews() {
        container.removeAllViews()
        val density = resources.displayMetrics.density
        val marginPx = (16 * density).toInt()
        val heightPx = (1 * density).toInt().coerceAtLeast(1)

        val states = arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf(-android.R.attr.state_checked))
        val thumbColors = intArrayOf(Color.WHITE, Color.WHITE)
        val trackColors = intArrayOf(Color.parseColor("#00E5FF"), Color.parseColor("#424242"))
        val thumbTintList = ColorStateList(states, thumbColors)
        val trackTintList = ColorStateList(states, trackColors)

        for ((index, feature) in features.withIndex()) {
            val itemView = layoutInflater.inflate(R.layout.item_protection, container, false)
            itemView.findViewById<TextView>(R.id.tv_title).text = feature.title
            itemView.findViewById<TextView>(R.id.tv_desc).text = feature.desc
            if (feature.isPro) {
                itemView.findViewById<TextView>(R.id.tv_pro).visibility = View.VISIBLE
            }

            val switch = itemView.findViewById<SwitchCompat>(R.id.switch_feature)
            switch.thumbTintList = thumbTintList
            switch.trackTintList = trackTintList

            switch.setOnClickListener { v ->
                val isChecked = (v as SwitchCompat).isChecked
                if (v.isEnabled) {
                    if (feature.id == "mitm_browser" && isChecked) {
                        val prefs = requireContext().getSharedPreferences("app_settings", Context.MODE_PRIVATE)
                        val isCertInstalled = prefs.getBoolean("mitm_cert_installed", false)
                        
                        if (!isCertInstalled) {
                            (v as SwitchCompat).isChecked = false // 回弹
                            // 异步生成证书，防止主线程卡顿
                            viewLifecycleOwner.lifecycleScope.launch(Dispatchers.IO) {
                                val certPem = EngineBridge.getMitmCaCert()
                                withContext(Dispatchers.Main) {
                                    if (certPem.isEmpty()) {
                                        showCustomToast("生成证书失败，请查看日志")
                                    } else {
                                        showCertInstallDialog(certPem)
                                    }
                                }
                            }
                        } else {
                            // 已安装证书，直接记录状态并开启
                            prefs.edit().putBoolean("pref_v5_${feature.id}", true).apply()
                            updateEngineState(feature.id, true)
                            if (!com.dewsecure.android.vpn.DewVpnService.isRunningState) {
                                showCustomToast("MitM 已开启，正在为您启动网络净化...")
                                (activity as? MainActivity)?.startVpn()
                            }
                        }
                        return@setOnClickListener
                    }

                    if (feature.id == "mitm_root" && isChecked) {
                        if (!RootChecker.isDeviceRooted()) {
                            (v as SwitchCompat).isChecked = false // 强行回弹
                            showCustomToast("检测到您的系统非root，无法开启此功能")
                            return@setOnClickListener
                        } else {
                            showCustomToast("系统已 Root，正在准备证书模块...")
                        }
                    }

                    val prefs = requireContext().getSharedPreferences("app_settings", Context.MODE_PRIVATE)
                    prefs.edit().putBoolean("pref_v5_${feature.id}", isChecked).apply()
                    updateEngineState(feature.id, isChecked)
                }
            }

            container.addView(itemView)

            val isMitmGroupStart = (feature.id == "mitm_browser")
            val isMitmGroupEnd = (feature.id == "mitm_root")
            val isLastItem = (index == features.size - 1)

            if (!isLastItem) {
                if (!(isMitmGroupStart || isMitmGroupEnd)) {
                    addDivider(marginPx, heightPx)
                } else if (isMitmGroupStart) {
                    addDivider(marginPx, heightPx, "#33FFFFFF")
                }
            }
        }
    }

    private fun addDivider(marginPx: Int, heightPx: Int, colorHex: String = "#1AFFFFFF") {
        val divider = View(requireContext())
        val params = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, heightPx)
        params.setMargins(marginPx, 0, marginPx, 0)
        divider.layoutParams = params
        divider.setBackgroundColor(Color.parseColor(colorHex))
        container.addView(divider)
    }

    private fun updateUiState() {
        val prefs = requireContext().getSharedPreferences("app_settings", Context.MODE_PRIVATE)
        val userPrefs = requireContext().getSharedPreferences("user_session", Context.MODE_PRIVATE)
        val userTier = userPrefs.getString("tier", "free") ?: "free"
        val isUserPro = userTier in listOf("pro", "premium", "trial", "trial-pro", "family", "sub-family", "family_sub")

        for ((index, feature) in features.withIndex()) {
            val itemView = getItemViewForFeature(feature.id) ?: continue
            val switch = itemView.findViewById<SwitchCompat>(R.id.switch_feature)

            val defaultVal = when(feature.id) {
                "mitm_browser" -> false
                "mitm_root" -> false
                else -> true
            }
            val prefKey = "pref_v5_${feature.id}"
            val savedState = prefs.getBoolean(prefKey, defaultVal)

            if (!feature.isPro || isUserPro) {
                switch.isEnabled = true
                switch.isChecked = savedState
                itemView.alpha = 1.0f
                updateEngineState(feature.id, savedState)
            } else {
                switch.isEnabled = false
                switch.isChecked = false
                itemView.alpha = 0.5f
                updateEngineState(feature.id, false)
            }
        }
    }

    private fun getItemViewForFeature(id: String): View? {
        for (i in 0 until container.childCount) {
            val child = container.getChildAt(i)
            val title = child.findViewById<TextView>(R.id.tv_title)?.text?.toString()
            if (title == features.find { it.id == id }?.title) {
                return child
            }
        }
        return null
    }

    private fun updateEngineState(id: String, isChecked: Boolean) {
        when (id) {
            "dnr" -> EngineBridge.setEnableDnr(isChecked)
            "tracker" -> EngineBridge.setEnableTracker(isChecked)
            "social" -> EngineBridge.setEnableSocial(isChecked)
            "intel" -> EngineBridge.setEnableThreatIntel(isChecked)
            "ai_phishing" -> EngineBridge.setEnableAiPhishing(isChecked)
            "ai_zero_day" -> EngineBridge.setEnableAiZeroDay(isChecked)
        }
    }

    private fun showCustomToast(msg: String) {
        Toast.makeText(requireContext(), msg, Toast.LENGTH_LONG).show()
    }

    // 补充缺失的证书弹窗方法
    private fun showCertInstallDialog(certPem: String) {
        val dialog = android.app.AlertDialog.Builder(requireContext())
            .setTitle("安装 HTTPS 过滤证书")
            .setMessage("为了拦截浏览器内的 HTTPS 广告，系统需要信任 DewSecure 的本地证书。\n\n点击“一键安装”后，请按系统提示操作。\n\n⚠️ 重点：在“凭据用途”界面，请务必选择【VPN 和应用】，否则 HTTPS 过滤无法生效！")
            .setPositiveButton("一键安装") { _, _ ->
                try {
                    // 🌟 核心：直接唤起系统自带的证书安装意图
                    val intent = android.security.KeyChain.createInstallIntent()
                    val certBytes = android.util.Base64.decode(
                        certPem.replace("-----BEGIN CERTIFICATE-----", "")
                               .replace("-----END CERTIFICATE-----", "")
                               .replace("\n", "").replace("\r", ""),
                        android.util.Base64.DEFAULT
                    )
                    intent.putExtra(android.security.KeyChain.EXTRA_CERTIFICATE, certBytes)
                    intent.putExtra(android.security.KeyChain.EXTRA_NAME, "DewSecure Personal CA")
                    startActivity(intent)
                    
                    // 记录状态（用户虽然可能在系统界面取消，但大多数情况会安装）
                    requireContext().getSharedPreferences("app_settings", Context.MODE_PRIVATE)
                        .edit().putBoolean("mitm_cert_installed", true).apply()
                    
                } catch (e: Exception) {
                    showCustomToast("唤起安装失败: ${e.message}")
                }
            }
            .setNegativeButton("取消", null)
            .create()
        
        dialog.show()
    }
}
