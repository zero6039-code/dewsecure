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
import com.dewsecure.android.R
import com.dewsecure.android.policy.EngineBridge
import com.dewsecure.android.ui.view.HoneycombButton
import com.dewsecure.android.vpn.DewVpnService
import org.json.JSONObject

class HomeFragment : Fragment() {

    private lateinit var btnToggleVpn: HoneycombButton
    private lateinit var tvStatus: TextView
    private lateinit var tvBlockedToday: TextView
    private lateinit var tvBlockedTotal: TextView
    private lateinit var tvTrafficToday: TextView
    private lateinit var tvTrafficTotal: TextView

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
        
        btnToggleVpn = view.findViewById(R.id.btn_toggle_vpn)
        tvStatus = view.findViewById(R.id.tv_main_status)
        tvBlockedToday = view.findViewById(R.id.tv_blocked_today)
        tvBlockedTotal = view.findViewById(R.id.tv_blocked_total)
        tvTrafficToday = view.findViewById(R.id.tv_traffic_today)
        tvTrafficTotal = view.findViewById(R.id.tv_traffic_total)

        val prefs = requireContext().getSharedPreferences("vpn_state", Context.MODE_PRIVATE)
        val isVpnOn = prefs.getBoolean("is_running", false)
        
        btnToggleVpn.setInitialState(isVpnOn)
        updateUiState(isVpnOn)

        btnToggleVpn.setOnClickListener {
            btnToggleVpn.toggle()
            val nowOn = btnToggleVpn.isOn
            if (nowOn) {
                (activity as MainActivity).startVpn()
                prefs.edit().putBoolean("is_running", true).apply()
            } else {
                requireContext().stopService(Intent(requireContext(), DewVpnService::class.java))
                prefs.edit().putBoolean("is_running", false).apply()
            }
            updateUiState(nowOn)
        }

        // Logo 点击跳转官网
        view.findViewById<View>(R.id.iv_logo).setOnClickListener {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://dewsecure.com"))
            startActivity(intent)
        }

        // 点击拦截卡片跳转日志
        val goToLogs = View.OnClickListener {
            startActivity(Intent(requireContext(), LogActivity::class.java))
        }
        view.findViewById<View>(R.id.tv_blocked_today).setOnClickListener(goToLogs)
        view.findViewById<View>(R.id.tv_blocked_total).setOnClickListener(goToLogs)

        // 点击流量卡片跳转流量详情
        view.findViewById<View>(R.id.card_traffic).setOnClickListener {
            startActivity(Intent(requireContext(), TrafficActivity::class.java))
        }

        view.findViewById<View>(R.id.btn_false_block).setOnClickListener {
            showGlassDialog("误报反馈", "请填写被误拦截导致无法访问的网站域名。\n(提交后需人工审核)", "false_positive")
        }

        view.findViewById<View>(R.id.btn_missed_ad).setOnClickListener {
            showGlassDialog("漏报反馈", "请填写仍有广告未被拦截的网站域名。", "false_negative")
        }
    }

    override fun onResume() {
        super.onResume()
        // 校验真实状态：如果底层服务不在运行，强制 UI 和缓存恢复为关闭
        val prefs = requireContext().getSharedPreferences("vpn_state", Context.MODE_PRIVATE)
        if (!DewVpnService.isRunningState) {
            prefs.edit().putBoolean("is_running", false).apply()
            btnToggleVpn.setInitialState(false)
            updateUiState(false)
        }
        handler.post(updateRunnable)
    }

    override fun onPause() {
        super.onPause()
        handler.removeCallbacks(updateRunnable)
    }

    private fun showGlassDialog(title: String, hint: String, reportType: String) {
        val dialog = Dialog(requireContext())
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)
        dialog.setContentView(R.layout.dialog_report)
        dialog.window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
        dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

        val tvTitle = dialog.findViewById<TextView>(R.id.tv_dialog_title)
        val tvHint = dialog.findViewById<TextView>(R.id.tv_dialog_hint)
        val etDomain = dialog.findViewById<EditText>(R.id.et_domain)
        val btnCancel = dialog.findViewById<TextView>(R.id.btn_cancel)
        val btnSubmit = dialog.findViewById<TextView>(R.id.btn_submit)

        tvTitle.text = title
        tvHint.text = hint

        btnCancel.setOnClickListener { dialog.dismiss() }
        btnSubmit.setOnClickListener {
            val domain = etDomain.text.toString().trim().lowercase()
            if (domain.isNotEmpty()) {
                submitReportToSupabase(reportType, domain)
                dialog.dismiss()
            } else {
                Toast.makeText(requireContext(), "域名不能为空", Toast.LENGTH_SHORT).show()
            }
        }
        dialog.show()
    }

    private fun submitReportToSupabase(reportType: String, domain: String) {
        Log.i("Report", "上报到 Supabase: type=$reportType, domain=$domain")
        Toast.makeText(requireContext(), "反馈已提交审核！\n如需立刻访问，请前往设置手动添加白名单。", Toast.LENGTH_LONG).show()
    }

    private fun updateStats() {
        val jsonStr = EngineBridge.getStatsJson()
        try {
            val json = JSONObject(jsonStr)
            val today = json.optInt("today_blocked", 0)
            val total = json.optInt("total_blocked", 0)
            
            tvBlockedToday.text = today.toString()
            tvBlockedTotal.text = total.toString()

            // 每次拦截预估 80KB
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
        if (isOn) {
            tvStatus.text = "已开启系统级保护"
            tvStatus.setTextColor(requireContext().getColor(R.color.green_on))
            btnToggleVpn.text = "关闭网络净化"
        } else {
            tvStatus.text = "未保护"
            tvStatus.setTextColor(requireContext().getColor(R.color.text_secondary))
            btnToggleVpn.text = "开启网络净化"
        }
    }
}
