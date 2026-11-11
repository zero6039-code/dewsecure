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
        renderFeatures()
    }

    override fun onResume() {
        super.onResume()
        renderFeatures()

        viewLifecycleOwner.lifecycleScope.launch {
            val res = AuthManager.fetchUserProfile(requireContext())
            if (res.isSuccess) {
                renderFeatures()
            }
        }
    }

    private fun renderFeatures() {
        container.removeAllViews()
        val prefs = requireContext().getSharedPreferences("app_settings", Context.MODE_PRIVATE)
        val userPrefs = requireContext().getSharedPreferences("user_session", Context.MODE_PRIVATE)
        val userTier = userPrefs.getString("tier", "free") ?: "free"
        
        val isUserPro = userTier in listOf("pro", "premium", "trial", "trial-pro", "family", "sub-family", "family_sub")

        val density = resources.displayMetrics.density
        val marginPx = (16 * density).toInt()
        val heightPx = (1 * density).toInt().coerceAtLeast(1)

        // 颜色状态定义
        val states = arrayOf(
            intArrayOf(android.R.attr.state_checked),
            intArrayOf(-android.R.attr.state_checked)
        )
        // 滑块：统一纯白
        val thumbColors = intArrayOf(Color.WHITE, Color.WHITE)
        // 轨道：开启时青色(#00E5FF)，关闭时暗灰(#424242)
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
            
            // 设置自定义颜色
            switch.thumbTintList = thumbTintList
            switch.trackTintList = trackTintList

            // ⚠️ 修复默认值：加上 v2_ 前缀强制重置本地存储，默认一律开启 (true)
            val prefKey = "pref_v2_${feature.id}"
            val savedState = prefs.getBoolean(prefKey, true)

            if (!feature.isPro || isUserPro) {
                switch.isEnabled = true
                switch.isChecked = savedState
                updateEngineState(feature.id, savedState)
            } else {
                // 没有权限，强制关闭并置灰
                switch.isEnabled = false
                switch.isChecked = false
                itemView.alpha = 0.5f
                itemView.setOnClickListener {
                    Toast.makeText(requireContext(), "需要 Pro 订阅才能启用此功能", Toast.LENGTH_SHORT).show()
                }
                updateEngineState(feature.id, false)
            }

            switch.setOnCheckedChangeListener { _, isChecked ->
                if (switch.isEnabled) {
                    prefs.edit().putBoolean(prefKey, isChecked).apply()
                    updateEngineState(feature.id, isChecked)
                }
            }

            container.addView(itemView)

            // 添加浅色分割线 (最后一个不加)
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
