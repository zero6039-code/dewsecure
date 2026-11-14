package com.dewsecure.android.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import androidx.fragment.app.Fragment
import com.dewsecure.android.R
import com.dewsecure.android.ui.controller.LangSettingsController
import com.dewsecure.android.ui.controller.PrivacySettingsController
import com.dewsecure.android.ui.controller.RoutingSettingsController
import com.dewsecure.android.ui.controller.WhitelistSettingsController

class SettingsFragment : Fragment() {

    private lateinit var tabLang: LinearLayout
    private lateinit var tabWhitelist: LinearLayout
    private lateinit var tabPrivacy: LinearLayout
    private lateinit var tabRouting: LinearLayout

    private lateinit var paneLang: View
    private lateinit var paneWhitelist: View
    private lateinit var panePrivacy: View
    private lateinit var paneRouting: View

    private lateinit var whitelistController: WhitelistSettingsController

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View? {
        return inflater.inflate(R.layout.fragment_settings, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        initViews(view)
        setupTabs()

        // 初始化控制器并注入业务逻辑
        LangSettingsController(this, view).setup()
        PrivacySettingsController(this, view).setup()
        RoutingSettingsController(this, view).setup()
        
        whitelistController = WhitelistSettingsController(this)
        whitelistController.setup(view)

        // 默认选中语言页
        switchTab("lang")
    }

    private fun initViews(view: View) {
        tabLang = view.findViewById(R.id.tab_lang)
        tabWhitelist = view.findViewById(R.id.tab_whitelist)
        tabPrivacy = view.findViewById(R.id.tab_privacy)
        tabRouting = view.findViewById(R.id.tab_routing)

        paneLang = view.findViewById(R.id.pane_lang)
        paneWhitelist = view.findViewById(R.id.pane_whitelist)
        panePrivacy = view.findViewById(R.id.pane_privacy)
        paneRouting = view.findViewById(R.id.pane_routing)
    }

    private fun setupTabs() {
        tabLang.setOnClickListener { switchTab("lang") }
        tabWhitelist.setOnClickListener { switchTab("whitelist") }
        tabPrivacy.setOnClickListener { switchTab("privacy") }
        tabRouting.setOnClickListener { switchTab("routing") }
    }

    private fun switchTab(tab: String) {
        tabLang.setBackgroundResource(R.drawable.bg_glass_tab_inactive)
        tabWhitelist.setBackgroundResource(R.drawable.bg_glass_tab_inactive)
        tabPrivacy.setBackgroundResource(R.drawable.bg_glass_tab_inactive)
        tabRouting.setBackgroundResource(R.drawable.bg_glass_tab_inactive)

        paneLang.visibility = View.GONE
        paneWhitelist.visibility = View.GONE
        panePrivacy.visibility = View.GONE
        paneRouting.visibility = View.GONE

        when (tab) {
            "lang" -> {
                tabLang.setBackgroundResource(R.drawable.bg_glass_tab_active)
                paneLang.visibility = View.VISIBLE
            }
            "whitelist" -> {
                tabWhitelist.setBackgroundResource(R.drawable.bg_glass_tab_active)
                paneWhitelist.visibility = View.VISIBLE
                whitelistController.loadWhitelistData()
            }
            "privacy" -> {
                tabPrivacy.setBackgroundResource(R.drawable.bg_glass_tab_active)
                panePrivacy.visibility = View.VISIBLE
            }
            "routing" -> {
                tabRouting.setBackgroundResource(R.drawable.bg_glass_tab_active)
                paneRouting.visibility = View.VISIBLE
            }
        }
    }
}
