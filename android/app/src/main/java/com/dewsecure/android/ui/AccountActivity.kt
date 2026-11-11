package com.dewsecure.android.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.dewsecure.android.R

class AccountActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_account)

        val btnBack = findViewById<View>(R.id.btn_back)
        val tvEmail = findViewById<TextView>(R.id.tv_account_email)
        val btnManage = findViewById<View>(R.id.btn_manage_account)
        val btnLogout = findViewById<View>(R.id.btn_logout)

        val prefs = getSharedPreferences("user_session", Context.MODE_PRIVATE)
        val email = prefs.getString("email", "Unknown")

        tvEmail.text = email

        btnBack.setOnClickListener { finish() }

        btnManage.setOnClickListener {
            // 跳转到你的官网控制台
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://dewsecure.com/dashboard"))
            startActivity(intent)
        }

        btnLogout.setOnClickListener {
            prefs.edit().clear().apply()
            Toast.makeText(this, "已退出登录", Toast.LENGTH_SHORT).show()
            finish()
        }
    }
}
