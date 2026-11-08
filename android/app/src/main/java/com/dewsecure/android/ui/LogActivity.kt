package com.dewsecure.android.ui

import android.os.Bundle
import android.view.View
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.dewsecure.android.R
import com.dewsecure.android.policy.EngineBridge
import com.dewsecure.android.ui.adapter.LogAdapter

class LogActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_log)

        findViewById<View>(R.id.btn_back).setOnClickListener { finish() }

        val recycler = findViewById<RecyclerView>(R.id.recycler_logs)
        val tvEmpty = findViewById<TextView>(R.id.tv_empty)

        val logs = EngineBridge.getBlockLogs()

        if (logs.isEmpty()) {
            tvEmpty.visibility = View.VISIBLE
            recycler.visibility = View.GONE
        } else {
            tvEmpty.visibility = View.GONE
            recycler.visibility = View.VISIBLE
        }

        recycler.layoutManager = LinearLayoutManager(this)
        // 直接使用新的 LogAdapter，不再需要回调
        val adapter = LogAdapter(logs)
        recycler.adapter = adapter
    }
}
