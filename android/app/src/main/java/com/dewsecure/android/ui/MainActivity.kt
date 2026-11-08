package com.dewsecure.android.ui

import android.app.Activity
import android.content.Intent
import android.net.VpnService
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.dewsecure.android.policy.EngineBridge
import com.dewsecure.android.vpn.DewVpnService

class MainActivity : AppCompatActivity() {

    private val VPN_REQUEST_CODE = 1001

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        EngineBridge.init(aiEnabled = false) 

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(50, 100, 50, 50)
        }

        val tv = TextView(this).apply {
            text = "DewSecure Android MVP\n\n引擎已就绪。\n点击下方按钮启动 VPN 拦截。"
            textSize = 18f
        }

        val btn = Button(this).apply {
            text = "启动 VPN 拦截"
            setOnClickListener {
                val intent = VpnService.prepare(this@MainActivity)
                if (intent != null) {
                    startActivityForResult(intent, VPN_REQUEST_CODE)
                } else {
                    onActivityResult(VPN_REQUEST_CODE, Activity.RESULT_OK, null)
                }
            }
        }

        layout.addView(tv)
        layout.addView(btn)
        setContentView(layout)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == VPN_REQUEST_CODE) {
            if (resultCode == Activity.RESULT_OK) {
                // 启动我们的 VPN 服务
                val serviceIntent = Intent(this, DewVpnService::class.java)
                startForegroundService(serviceIntent)
                Toast.makeText(this, "DewSecure 防护已开启", Toast.LENGTH_SHORT).show()
            } else {
                Toast.makeText(this, "用户拒绝了 VPN 权限", Toast.LENGTH_SHORT).show()
            }
        }
    }
}
