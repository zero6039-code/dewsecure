package com.dewsecure.android.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import androidx.fragment.app.Fragment
import com.dewsecure.android.R
import com.google.android.material.switchmaterial.SwitchMaterial

class ProtectionFragment : Fragment() {

    private val features = listOf(
        // 免费版功能 (Free)
        Feature("DNR Rule Blocking", "Blocks known malicious domains, ads & trackers", false, true),
        Feature("Block Trackers", "Intercepts tracking scripts and pixels", false, true),
        Feature("Block Social Trackers", "Blocks social media tracking buttons", false, true), // 改为免费
        
        // 高级版功能 (Pro)
        Feature("Real-time Threat Intel", "Dynamically blocks newly emerged phishing domains", true, true),
        Feature("AI Phishing Detection", "Identifies malicious and phishing domains (Pro)", true, true),
        Feature("AI Smart Real-time Detection", "AI dynamic blocking for zero-day ads (Pro)", true, true)
    )

    data class Feature(val title: String, val desc: String, val isPro: Boolean, val isSupported: Boolean)

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View? {
        return inflater.inflate(R.layout.fragment_protection, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        val container = view.findViewById<LinearLayout>(R.id.feature_container)

        for (feature in features) {
            val itemView = layoutInflater.inflate(R.layout.item_protection, container, false)
            itemView.findViewById<TextView>(R.id.tv_title).text = feature.title
            itemView.findViewById<TextView>(R.id.tv_desc).text = feature.desc
            
            if (feature.isPro) {
                itemView.findViewById<TextView>(R.id.tv_pro).visibility = View.VISIBLE
            }

            val switch = itemView.findViewById<SwitchMaterial>(R.id.switch_feature)
            if (feature.isSupported) {
                switch.isChecked = true 
            } else {
                switch.isEnabled = false
                switch.isChecked = false
                itemView.alpha = 0.5f
            }

            container.addView(itemView)
        }
    }
}
