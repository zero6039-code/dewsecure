package com.dewsecure.android.ui

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
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

    private val handler = Handler(Looper.getMainLooper())
    private val updateRunnable = object : Runnable {
        override fun run() {
            updateStats()
            handler.postDelayed(this, 2000) // 维持 2 秒刷新
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

        val prefs = requireContext().getSharedPreferences("vpn_state", Context.MODE_PRIVATE)
        val isVpnOn = prefs.getBoolean("is_running", false)
        
        btnToggleVpn.setInitialState(isVpnOn)
        updateUiState(isVpnOn)

        btnToggleVpn.setOnClickListener {
            val wasOn = btnToggleVpn.isOn
            btnToggleVpn.toggle()
            val nowOn = btnToggleVpn.isOn
            
            if (nowOn) {
                // 🛡️ D-10 修复：假设 MainActivity.startVpn() 返回 Boolean 表示是否成功启动
                // 如果用户拒绝授权，返回 false，此时需要将 UI 状态回退
                val started = (activity as MainActivity).startVpn()
                if (!started) {
                    btnToggleVpn.setInitialState(false) // 回退 UI 动画
                    updateUiState(false)
                    return@setOnClickListener
                }
                prefs.edit().putBoolean("is_running", true).apply()
            } else {
                requireContext().stopService(Intent(requireContext(), DewVpnService::class.java))
                prefs.edit().putBoolean("is_running", false).apply()
            }
            updateUiState(nowOn)
        }

        // 绑定点击卡片跳转到新的日志页面
        val goToLogs = View.OnClickListener {
            startActivity(Intent(requireContext(), LogActivity::class.java))
        }
        view.findViewById<View>(R.id.tv_blocked_today).setOnClickListener(goToLogs)
        view.findViewById<View>(R.id.tv_blocked_total).setOnClickListener(goToLogs)

        // 🛡️ D-10 修复：为未接线的按钮绑定基础提示逻辑（后续可替换为真实 Activity 跳转）
        view.findViewById<View>(R.id.btn_login)?.setOnClickListener {
            android.widget.Toast.makeText(requireContext(), "登录功能开发中", android.widget.Toast.LENGTH_SHORT).show()
        }
        view.findViewById<View>(R.id.btn_whitelist)?.setOnClickListener {
            android.widget.Toast.makeText(requireContext(), "白名单管理开发中", android.widget.Toast.LENGTH_SHORT).show()
        }
        view.findViewById<View>(R.id.btn_feedback)?.setOnClickListener {
            android.widget.Toast.makeText(requireContext(), "反馈通道开发中", android.widget.Toast.LENGTH_SHORT).show()
        }
    }

    override fun onResume() {
        super.onResume()
        handler.post(updateRunnable)
    }

    override fun onPause() {
        super.onPause()
        handler.removeCallbacks(updateRunnable)
    }

    private fun updateStats() {
        val jsonStr = EngineBridge.getStatsJson()
        try {
            val json = JSONObject(jsonStr)
            val today = json.optInt("today_blocked", 0)
            val total = json.optInt("total_blocked", 0)
            tvBlockedToday.text = today.toString()
            tvBlockedTotal.text = total.toString()
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
