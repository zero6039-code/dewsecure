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
import kotlinx.coroutines.launch

class ProtectionFragment : Fragment() {

    private val features = listOf(
        Feature("dnr", "DNR Rule Blocking", "Blocks known malicious domains, ads & trackers", false, true),
        Feature("tracker", "Block Trackers", "Intercepts tracking scripts and pixels", false, true),
        Feature("social", "Block Social Trackers", "Blocks social media tracking buttons", false, true),
        Feature("intel", "Real-time Threat Intel", "Dynamically blocks newly emerged phishing domains", true, true),
        Feature("ai_phishing", "AI Phishing Detection", "Identifies malicious and phishing domains (Pro)", true, true),
        Feature("ai_zero_day", "AI Smart Real-time Detection", "AI dynamic blocking for zero-day ads (Pro)", true, true)
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

        val states = arrayOf(
            intArrayOf(android.R.attr.state_checked),
            intArrayOf(-android.R.attr.state_checked)
        )
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

            // 核心修复：改用 OnClickListener，只相信用户的真实点击
            switch.setOnClickListener { v ->
                val isChecked = (v as SwitchCompat).isChecked
                if (v.isEnabled) {
                    android.util.Log.d("ProtectionCheck", "👆 用户真实点击 $feature.id 为: $isChecked")
                    val prefs = requireContext().getSharedPreferences("app_settings", Context.MODE_PRIVATE)
                    prefs.edit().putBoolean("pref_v3_${feature.id}", isChecked).apply()
                    updateEngineState(feature.id, isChecked)
                }
            }

            container.addView(itemView)

            if (index < features.size - 1) {
                val divider = View(requireContext())
                val params = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, heightPx)
                params.setMargins(marginPx, 0, marginPx, 0)
                divider.layoutParams = params
                divider.setBackgroundColor(Color.parseColor("#1AFFFFFF"))
                container.addView(divider)
            }
        }
    }

    private fun updateUiState() {
        val prefs = requireContext().getSharedPreferences("app_settings", Context.MODE_PRIVATE)
        val userPrefs = requireContext().getSharedPreferences("user_session", Context.MODE_PRIVATE)
        val userTier = userPrefs.getString("tier", "free") ?: "free"

        val isUserPro = userTier in listOf("pro", "premium", "trial", "trial-pro", "family", "sub-family", "family_sub")

        for ((index, feature) in features.withIndex()) {
            val itemView = container.getChildAt(index * 2) ?: continue
            val switch = itemView.findViewById<SwitchCompat>(R.id.switch_feature)
            val prefKey = "pref_v3_${feature.id}"
            val savedState = prefs.getBoolean(prefKey, true)

            // 纯粹的状态更新，不加任何监听器，不会触发误写
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
}
