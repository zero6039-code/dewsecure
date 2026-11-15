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
import com.dewsecure.android.policy.RootUtils
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class ProtectionFragment : Fragment() {

    private val features = listOf(
        Feature("dnr", "DNR Rule Blocking", "Blocks known malicious domains, ads & trackers", false, true),
        Feature("tracker", "Block Trackers", "Intercepts tracking scripts and pixels", false, true),
        Feature("social", "Block Social Trackers", "Blocks social media tracking buttons", false, true),
        Feature("intel", "Real-time Threat Intel", "Dynamically blocks newly emerged phishing domains", true, true),
        Feature("ai_phishing", "AI Phishing Detection", "Identifies malicious and phishing domains (Pro)", true, true),
        Feature("ai_zero_day", "AI Smart Real-time Detection", "AI dynamic blocking for zero-day ads (Pro)", true, true),
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
                    

                    if (feature.id == "mitm_root") {
                        val prefs = requireContext().getSharedPreferences("app_settings", Context.MODE_PRIVATE)
                        if (isChecked) {
                            // 1. 检查 Root
                            if (!RootUtils.isRooted(requireContext())) {
                                (v as SwitchCompat).isChecked = false
                                showCustomToast("检测到您的系统未 Root，无法开启此功能")
                                return@setOnClickListener
                            }
                            
                            // 2. 检查 Pro 权限
                            val tier = requireContext().getSharedPreferences("user_session", Context.MODE_PRIVATE).getString("tier", "free") ?: "free"
                            val isPro = tier in listOf("pro", "premium", "trial", "trial-pro", "family", "sub-family", "family_sub")
                            if (!isPro) {
                                (v as SwitchCompat).isChecked = false
                                showCustomToast("此功能为 PRO 专属，请先升级账号")
                                return@setOnClickListener
                            }

                            // 3. 风险提示与证书安装
                            val dialog = android.app.AlertDialog.Builder(requireContext())
                                .setTitle("⚠️ 高风险操作")
                                .setMessage("开启后，DewSecure 将接管并解密所有 App 的 HTTPS 流量。\n\n请确保您的设备已 Root，且信任了 DewSecure 的 CA 证书。")
                                .setPositiveButton("继续并安装证书") { _, _ ->
                                    (v as SwitchCompat).isChecked = true
                                    prefs.edit().putBoolean("pref_mitm_full_app", true).apply()
                                    
                                    // 获取 Rust 引擎生成的证书并弹窗
                                    try {
                                        val certPem = com.dewsecure.core.getMitmCaCert()
                                        showCertInstallDialog(certPem)
                                    } catch (e: Exception) {
                                        showCustomToast("获取内置证书失败")
                                    }
                                    
                                    // 触发 VPN 重启
                                    triggerVpnRestart()
                                }
                                .setNegativeButton("取消") { _, _ ->
                                    (v as SwitchCompat).isChecked = false
                                }
                                .setCancelable(false)
                                .show()
                            
                            return@setOnClickListener

                        } else {
                            // 关闭 MitM
                            prefs.edit().putBoolean("pref_mitm_full_app", false).apply()
                            triggerVpnRestart()
                            showCustomToast("MitM 已关闭，正在恢复普通拦截...")
                            return@setOnClickListener
                        }
                    }

                    // 其他普通开关的逻辑
                    val prefs = requireContext().getSharedPreferences("app_settings", Context.MODE_PRIVATE)
                    prefs.edit().putBoolean("pref_v5_${feature.id}", isChecked).apply()
                    updateEngineState(feature.id, isChecked)
                }
            }

            container.addView(itemView)

            val isMitmGroupStart = false
            val isMitmGroupEnd = false
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
                "mitm_root" -> false
                else -> true
            }
            val prefKey = if (feature.id == "mitm_root") "pref_mitm_full_app" else "pref_v5_${feature.id}"
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
            // "mitm_root" 状态由 VPN 重启接管，无需在此时调用
        }
    }

    private fun triggerVpnRestart() {
        if (com.dewsecure.android.vpn.DewVpnService.isRunningState) {
            val intent = android.content.Intent(requireContext(), com.dewsecure.android.vpn.DewVpnService::class.java).apply {
                action = "ACTION_RESTART_VPN"
            }
            requireContext().startService(intent)
        }
    }

    private fun showCustomToast(msg: String) {
        Toast.makeText(requireContext(), msg, Toast.LENGTH_LONG).show()
    }

    private fun showCertInstallDialog(certPem: String) {
        val dialog = android.app.AlertDialog.Builder(requireContext())
            .setTitle("安装 HTTPS 过滤证书")
            .setMessage("为了拦截浏览器内的 HTTPS 广告，系统需要信任 DewSecure 的本地证书。\n\n点击“一键安装”后，请按系统提示操作。\n\n⚠️ 重点：在“凭据用途”界面，请务必选择【VPN 和应用】，否则 HTTPS 过滤无法生效！")
            .setPositiveButton("一键安装") { _, _ ->
                try {
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
                } catch (e: Exception) {
                    showCustomToast("唤起安装失败: ${e.message}")
                }
            }
            .setNegativeButton("取消", null)
            .create()
        
        dialog.show()
    }
}
