package com.dewsecure.android.ui

import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.fragment.app.Fragment
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.dewsecure.android.R
import com.dewsecure.android.policy.EngineBridge
import com.dewsecure.android.ui.adapter.LogAdapter
import com.dewsecure.android.ui.view.HoneycombButton
import com.dewsecure.android.vpn.DewVpnService
import com.google.android.material.bottomsheet.BottomSheetDialog
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
            btnToggleVpn.toggle()
            val nowOn = btnToggleVpn.isOn
            if (nowOn) {
                (activity as MainActivity).startVpn()
                prefs.edit().putBoolean("is_running", true).apply()
            } else {
                requireContext().stopService(android.content.Intent(requireContext(), DewVpnService::class.java))
                prefs.edit().putBoolean("is_running", false).apply()
            }
            updateUiState(nowOn)
        }

        // 绑定点击卡片显示拦截日志
        view.findViewById<View>(R.id.tv_blocked_today).setOnClickListener { showLogsDialog() }
        view.findViewById<View>(R.id.tv_blocked_total).setOnClickListener { showLogsDialog() }
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

    private fun showLogsDialog() {
        val logs = EngineBridge.getBlockLogs().toMutableList()
        val dialog = BottomSheetDialog(requireContext())
        val view = layoutInflater.inflate(R.layout.dialog_block_logs, null)
        dialog.setContentView(view)

        val recycler = view.findViewById<RecyclerView>(R.id.recycler_logs)
        val tvEmpty = view.findViewById<TextView>(R.id.tv_empty_logs)

        if (logs.isEmpty()) {
            tvEmpty.visibility = View.VISIBLE
            recycler.visibility = View.GONE
        } else {
            tvEmpty.visibility = View.GONE
            recycler.visibility = View.VISIBLE
        }

        recycler.layoutManager = LinearLayoutManager(requireContext())
        val adapter = LogAdapter(logs) { position, log ->
            // 点击“放行”
            EngineBridge.userAllow(log.domain)
            log.isAllowed = true
            recycler.adapter?.notifyItemChanged(position)
            // 提示一下
            android.widget.Toast.makeText(requireContext(), "已放行: ${log.domain}", android.widget.Toast.LENGTH_SHORT).show()
        }
        recycler.adapter = adapter
        dialog.show()
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
