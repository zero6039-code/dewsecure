package com.dewsecure.android.ui

import android.app.Activity
import android.content.Intent
import android.net.VpnService
import android.os.Bundle
import android.util.Log
import androidx.appcompat.app.AppCompatActivity
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.dewsecure.android.R
import com.dewsecure.android.policy.AuthManager
import com.dewsecure.android.policy.EngineBridge
import com.dewsecure.android.vpn.DewVpnService
import com.google.android.material.bottomnavigation.BottomNavigationView
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {

    private val homeFragment = HomeFragment()
    private val protectionFragment = ProtectionFragment()
    private val settingsFragment = SettingsFragment()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = getSharedPreferences("app_settings", MODE_PRIVATE)
        if (!prefs.contains("install_date")) {
            val sdf = java.text.SimpleDateFormat("d/M/yyyy", java.util.Locale.getDefault())
            prefs.edit().putString("install_date", sdf.format(java.util.Date())).apply()
        }
        setContentView(R.layout.activity_main)

        val bottomNav = findViewById<BottomNavigationView>(R.id.bottom_navigation)
        bottomNav.setOnItemSelectedListener { item ->
            when (item.itemId) {
                R.id.nav_home -> { loadFragment(homeFragment); true }
                R.id.nav_protection -> { loadFragment(protectionFragment); true }
                R.id.nav_settings -> { loadFragment(settingsFragment); true }
                else -> false
            }
        }

        if (savedInstanceState == null) {
            loadFragment(homeFragment)
        }

        // 自动同步云端白名单
        val userPrefs = getSharedPreferences("user_session", MODE_PRIVATE)
        val accessToken = userPrefs.getString("access_token", null)
        if (accessToken != null) {
            lifecycleScope.launch {
                val result = AuthManager.fetchCloudWhitelist(accessToken)
                if (result.isSuccess) {
                    val domains = result.getOrNull() ?: emptyList()
                    EngineBridge.loadUserWhitelist(domains)
                    Log.i("MainActivity", "云端白名单同步成功，共计 ${domains.size} 条")
                }
            }
        }
    }

    private fun loadFragment(fragment: Fragment) {
        supportFragmentManager.beginTransaction()
            .replace(R.id.fragment_container, fragment)
            .commit()
    }

    fun startVpn() {
        val intent = VpnService.prepare(this)
        if (intent != null) {
            startActivityForResult(intent, VPN_REQUEST_CODE)
        } else {
            onActivityResult(VPN_REQUEST_CODE, Activity.RESULT_OK, null)
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == VPN_REQUEST_CODE && resultCode == Activity.RESULT_OK) {
            startService(Intent(this, DewVpnService::class.java))
        }
    }

    companion object {
        const val VPN_REQUEST_CODE = 1001
    }
}
