package com.dewsecure.android.ui

import android.content.Context
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.fragment.app.Fragment
import com.dewsecure.android.R
import com.dewsecure.android.ui.view.HoneycombButton
import com.dewsecure.android.vpn.DewVpnService

class HomeFragment : Fragment() {

    private lateinit var btnToggleVpn: HoneycombButton
    private lateinit var tvStatus: TextView

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View? {
        return inflater.inflate(R.layout.fragment_home, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        
        btnToggleVpn = view.findViewById(R.id.btn_toggle_vpn)
        tvStatus = view.findViewById(R.id.tv_main_status)

        val prefs = requireContext().getSharedPreferences("vpn_state", Context.MODE_PRIVATE)
        val isVpnOn = prefs.getBoolean("is_running", false)
        
        // 初始化状态（同步视觉，不播放动画）
        btnToggleVpn.setInitialState(isVpnOn)
        updateUiState(isVpnOn)

        btnToggleVpn.setOnClickListener {
            // 播放蜂巢扩散/收缩动画
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
        
        view.findViewById<View>(R.id.btn_login).setOnClickListener {
            // TODO: 跳转登录
        }
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
