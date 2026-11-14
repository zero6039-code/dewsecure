package com.dewsecure.android.ui.controller

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.view.View
import android.widget.Toast
import androidx.appcompat.widget.SwitchCompat
import androidx.fragment.app.Fragment
import com.dewsecure.android.R

class PrivacySettingsController(
    private val fragment: Fragment,
    private val rootView: View
) {
    fun setup() {
        val switchShareThreat = rootView.findViewById<SwitchCompat>(R.id.switch_share_threat)
        val context = fragment.requireContext()
        val prefs = context.getSharedPreferences("app_settings", Context.MODE_PRIVATE)

        val states = arrayOf(
            intArrayOf(android.R.attr.state_checked),
            intArrayOf(-android.R.attr.state_checked)
        )
        val thumbColors = intArrayOf(Color.WHITE, Color.WHITE)
        val trackColors = intArrayOf(Color.parseColor("#00E5FF"), Color.parseColor("#424242"))

        switchShareThreat.thumbTintList = ColorStateList(states, thumbColors)
        switchShareThreat.trackTintList = ColorStateList(states, trackColors)
        switchShareThreat.isChecked = prefs.getBoolean("pref_share_threat_intel", true)

        switchShareThreat.setOnCheckedChangeListener { _, isChecked ->
            prefs.edit().putBoolean("pref_share_threat_intel", isChecked).apply()
            val msg = if (isChecked) "已开启：将匿名上报新型威胁" else "已关闭：停止匿名上报"
            Toast.makeText(context, msg, Toast.LENGTH_SHORT).show()
        }
    }
}
