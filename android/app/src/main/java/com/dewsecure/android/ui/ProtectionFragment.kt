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
import com.dewsecure.android.ui.base.LocaleAware
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class ProtectionFragment : Fragment() {

    private data class Feature(
        val id: String,
        val titleRes: Int,
        val descRes: Int,
        val isPro: Boolean,
        val isSupported: Boolean
    )

    private val features = listOf(
        Feature("dnr", R.string.protect_dnr_title, R.string.protect_dnr_desc, false, true),
        Feature("tracker", R.string.protect_tracker_title, R.string.protect_tracker_desc, false, true),
        Feature("social", R.string.protect_social_title, R.string.protect_social_desc, false, true),
        Feature("intel", R.string.protect_intel_title, R.string.protect_intel_desc, true, true),
        Feature("ai_phishing", R.string.protect_ai_phishing_title, R.string.protect_ai_phishing_desc, true, true),
        Feature("ai_zero_day", R.string.protect_ai_zero_day_title, R.string.protect_ai_zero_day_desc, true, true),
        Feature("mitm_root", R.string.protect_mitm_title, R.string.protect_mitm_desc, true, true)
    )

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
            // 🌟 使用 getString 动态读取
            itemView.findViewById<TextView>(R.id.tv_title).text = getString(feature.titleRes)
            itemView.findViewById<TextView>(R.id.tv_desc).text = getString(feature.descRes)
            
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
                            if (!RootUtils.isRooted(requireContext())) {
                                (v as SwitchCompat).isChecked = false
                                showCustomToast(getString(R.string.toast_root_req))
                                return@setOnClickListener
                            }

                            val tier = requireContext().getSharedPreferences("user_session", Context.MODE_PRIVATE).getString("tier", "free") ?: "free"
                            val isPro = tier in listOf("pro", "premium", "trial", "trial-pro", "family", "sub-family", "family_sub")
                            if (!isPro) {
                                (v as SwitchCompat).isChecked = false
                                showCustomToast(getString(R.string.toast_mitm_pro))
                                return@setOnClickListener
                            }

                            android.app.AlertDialog.Builder(requireContext())
                                .setTitle(getString(R.string.mitm_dialog_title))
                                .setMessage(getString(R.string.mitm_dialog_msg))
                                .setPositiveButton(getString(R.string.mitm_dialog_btn_continue)) { _, _ ->
                                    (v as SwitchCompat).isChecked = true
                                    prefs.edit().putBoolean("pref_mitm_full_app", true).apply()
                                    try {
                                        val certPem = com.dewsecure.core.getMitmCaCert()
                                        showCertInstallDialog(certPem)
                                    } catch (e: Exception) {
                                        showCustomToast(getString(R.string.mitm_cert_fail))
                                    }
                                    triggerVpnRestart()
                                }
                                .setNegativeButton(getString(R.string.mitm_dialog_btn_cancel)) { _, _ ->
                                    (v as SwitchCompat).isChecked = false
                                }
                                .setCancelable(false)
                                .show()
                            return@setOnClickListener
                        } else {
                            prefs.edit().putBoolean("pref_mitm_full_app", false).apply()
                            triggerVpnRestart()
                            showCustomToast(getString(R.string.toast_mitm_off))
                            return@setOnClickListener
                        }
                    }

                    val prefs = requireContext().getSharedPreferences("app_settings", Context.MODE_PRIVATE)
                    prefs.edit().putBoolean("pref_v5_${feature.id}", isChecked).apply()
                    updateEngineState(feature.id, isChecked)
                }
            }

            container.addView(itemView)

            val isLastItem = (index == features.size - 1)
            if (!isLastItem) {
                addDivider(marginPx, heightPx)
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

        for (feature in features) {
            val itemView = getItemViewForFeature(feature.id) ?: continue
            val switch = itemView.findViewById<SwitchCompat>(R.id.switch_feature)

            val defaultVal = if (feature.id == "mitm_root") false else true
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
            // 用资源ID对应的当前语言文本去匹配
            val targetFeature = features.find { it.id == id }
            if (targetFeature != null && title == getString(targetFeature.titleRes)) {
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
            .setTitle(getString(R.string.mitm_cert_install_title))
            .setMessage(getString(R.string.mitm_cert_install_msg))
            .setPositiveButton(getString(R.string.mitm_cert_btn_install)) { _, _ ->
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
                    showCustomToast(getString(R.string.mitm_cert_install_fail, e.message ?: ""))
                }
            }
            .setNegativeButton(getString(R.string.common_cancel), null)
            .create()

        dialog.show()
    }
}
