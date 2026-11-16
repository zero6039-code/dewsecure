package com.dewsecure.android.ui

import android.app.Dialog
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.dewsecure.android.R
import com.dewsecure.android.policy.AuthManager
import com.dewsecure.android.policy.EngineBridge
import com.dewsecure.android.ui.view.HoneycombButton
import com.dewsecure.android.vpn.DewVpnService
import kotlinx.coroutines.launch
import org.json.JSONObject

class HomeFragment : Fragment() {

    private lateinit var btnToggleVpn: HoneycombButton
    private lateinit var tvStatus: TextView
    private lateinit var tvBlockedToday: TextView
    private lateinit var tvBlockedTotal: TextView
    private lateinit var tvTrafficToday: TextView
    private lateinit var tvTrafficTotal: TextView
    private lateinit var btnLogin: TextView


    private val handler = Handler(Looper.getMainLooper())
    private val updateRunnable = object : Runnable {
        override fun run() {
            updateStats()
            handler.postDelayed(this, 2000)
        }
    }

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View? {
        return inflater.inflate(R.layout.fragment_home, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        Log.e("LocaleDebug", "HomeFragment onViewCreated 执行")

        btnToggleVpn = view.findViewById(R.id.btn_toggle_vpn)
        tvStatus = view.findViewById(R.id.tv_main_status)
        tvBlockedToday = view.findViewById(R.id.tv_blocked_today)
        tvBlockedTotal = view.findViewById(R.id.tv_blocked_total)
        tvTrafficToday = view.findViewById(R.id.tv_traffic_today)
        tvTrafficTotal = view.findViewById(R.id.tv_traffic_total)
        btnLogin = view.findViewById(R.id.btn_login)
        

        val prefs = requireContext().getSharedPreferences("vpn_state", Context.MODE_PRIVATE)
        val isVpnOn = prefs.getBoolean("is_running", false)

        btnToggleVpn.setInitialState(isVpnOn)
        updateUiState(isVpnOn)
        setListeners(view)
    }

    private fun setListeners(view: View) {
        val prefs = requireContext().getSharedPreferences("vpn_state", Context.MODE_PRIVATE)
        btnToggleVpn.setOnClickListener {
            btnToggleVpn.toggle()
            val nowOn = btnToggleVpn.isOn
            if (nowOn) {
                (activity as MainActivity).startVpn()
                prefs.edit().putBoolean("is_running", true).apply()
            } else {
                val stopIntent = Intent(requireContext(), DewVpnService::class.java).apply {
                    action = "ACTION_STOP_VPN"
                }
                requireContext().startService(stopIntent)
                prefs.edit().putBoolean("is_running", false).apply()
            }
            updateUiState(nowOn)
        }

        view.findViewById<View>(R.id.iv_logo).setOnClickListener {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://dewsecure.com"))
            startActivity(intent)
        }

        btnLogin.setOnClickListener {
            val userPrefs = requireContext().getSharedPreferences("user_session", Context.MODE_PRIVATE)
            val email = userPrefs.getString("email", null)
            if (email != null) {
                startActivity(Intent(requireContext(), AccountActivity::class.java))
            } else {
                startActivity(Intent(requireContext(), LoginActivity::class.java))
            }
        }

        view.findViewById<View>(R.id.card_blocked_today).setOnClickListener {
            val intent = Intent(requireContext(), LogActivity::class.java)
            intent.putExtra("is_today", true)
            startActivity(intent)
        }

        view.findViewById<View>(R.id.card_blocked_total).setOnClickListener {
            val intent = Intent(requireContext(), LogActivity::class.java)
            intent.putExtra("is_today", false)
            startActivity(intent)
        }

        view.findViewById<View>(R.id.card_traffic).setOnClickListener {
            startActivity(Intent(requireContext(), TrafficActivity::class.java))
        }

        view.findViewById<View>(R.id.btn_false_block).setOnClickListener {
            showReportDialog(getString(R.string.report_false_title), getString(R.string.report_false_hint), "false_positive")
        }

        view.findViewById<View>(R.id.btn_missed_ad).setOnClickListener {
            showReportDialog(getString(R.string.report_missed_title), getString(R.string.report_missed_hint), "false_negative")
        }
    }

    private fun showReportDialog(title: String, hint: String, reportType: String) {
        val dialog = Dialog(requireContext())
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)
        dialog.setContentView(R.layout.dialog_report)
        dialog.window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
        // 🌟 核心修复：加上遮罩，防止背景字透底太严重，同时凸显毛玻璃质感
        dialog.window?.addFlags(android.view.WindowManager.LayoutParams.FLAG_DIM_BEHIND)
        dialog.window?.setDimAmount(0.6f)
        dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

        val tvTitle = dialog.findViewById<TextView>(R.id.tv_dialog_title)
        val tvHint = dialog.findViewById<TextView>(R.id.tv_dialog_hint)
        val etDomain = dialog.findViewById<EditText>(R.id.et_domain)
        val btnCancel = dialog.findViewById<TextView>(R.id.btn_cancel)
        val btnSubmit = dialog.findViewById<TextView>(R.id.btn_submit)

        tvTitle.text = title
        tvHint.text = hint
        btnCancel.text = getString(R.string.dialog_cancel)
        btnSubmit.text = getString(R.string.dialog_submit)

        btnCancel.setOnClickListener { dialog.dismiss() }

        btnSubmit.setOnClickListener {
            val domain = etDomain.text.toString().trim().lowercase()
            if (domain.isNotEmpty()) {
                dialog.dismiss()
                Toast.makeText(requireContext(), getString(R.string.report_submitting), Toast.LENGTH_SHORT).show()

                lifecycleScope.launch {
                    val result = AuthManager.submitReport(requireContext(), reportType, domain)
                    if (result.isSuccess) {
                        Toast.makeText(requireContext(), getString(R.string.report_success), Toast.LENGTH_LONG).show()
                    } else {
                        Toast.makeText(requireContext(), getString(R.string.report_fail), Toast.LENGTH_LONG).show()
                    }
                }
            } else {
                Toast.makeText(requireContext(), getString(R.string.report_empty_domain), Toast.LENGTH_SHORT).show()
            }
        }
        dialog.show()
    }

    override fun onResume() {
        super.onResume()
        val prefs = requireContext().getSharedPreferences("vpn_state", Context.MODE_PRIVATE)
        if (!DewVpnService.isRunningState) {
            prefs.edit().putBoolean("is_running", false).apply()
            btnToggleVpn.setInitialState(false)
            updateUiState(false)
        }

        val userPrefs = requireContext().getSharedPreferences("user_session", Context.MODE_PRIVATE)
        if (userPrefs.getString("email", null) != null) {
            btnLogin.text = getString(R.string.home_dashboard_btn)
        } else {
            btnLogin.text = getString(R.string.home_login_btn)
        }

        handler.post(updateRunnable)
    }

    override fun onPause() {
        super.onPause()
        handler.removeCallbacks(updateRunnable)
    }

    override fun onHiddenChanged(hidden: Boolean) {
        super.onHiddenChanged(hidden)
        if (hidden) {
            handler.removeCallbacks(updateRunnable)
        } else {
            updateStats()
            handler.post(updateRunnable)
        }
    }

    private fun formatNumber(num: Int): String {
        return String.format(java.util.Locale.US, "%,d", num)
    }

    private fun updateStats() {
        val jsonStr = EngineBridge.getStatsJson(requireContext())
        try {
            val json = JSONObject(jsonStr)
            val today = json.optInt("today_blocked", 0)
            val total = json.optInt("total_blocked", 0)

            val todayStr = formatNumber(today)
            val totalStr = formatNumber(total)

            if (tvBlockedToday.text.toString() != todayStr) {
                tvBlockedToday.text = todayStr
            }
            if (tvBlockedTotal.text.toString() != totalStr) {
                tvBlockedTotal.text = totalStr
            }

            val trafficTodayMb = today * 0.08
            val trafficTotalMb = total * 0.08

            if (trafficTodayMb < 1.0) {
                tvTrafficToday.text = String.format("%.0f KB", today * 80.0)
            } else {
                tvTrafficToday.text = String.format("%.1f MB", trafficTodayMb)
            }

            if (trafficTotalMb < 1.0) {
                tvTrafficTotal.text = String.format("%.0f KB", total * 80.0)
            } else {
                tvTrafficTotal.text = String.format("%.1f MB", trafficTotalMb)
            }

        } catch (e: Exception) {}
    }

    private fun updateUiState(isOn: Boolean) {
        val act = activity ?: return
        if (isOn) {
            tvStatus.text = act.getString(R.string.home_protected_on)
            tvStatus.setTextColor(requireContext().getColor(R.color.green_on))
            btnToggleVpn.text = act.getString(R.string.home_btn_stop)
        } else {
            tvStatus.text = act.getString(R.string.home_status_unprotected)
            tvStatus.setTextColor(requireContext().getColor(R.color.text_secondary))
            btnToggleVpn.text = act.getString(R.string.home_btn_start)
        }
    }

}
