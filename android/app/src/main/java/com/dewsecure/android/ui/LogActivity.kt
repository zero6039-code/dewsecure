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
import org.json.JSONObject
import java.util.Calendar

class LogActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_log)

        // 🌟 修复：inset 加到带 bg_aurora 的根布局，消除状态栏/导航栏白条
        androidx.core.view.WindowCompat.setDecorFitsSystemWindows(window, false)
        val insetRoot = (findViewById<android.view.View>(android.R.id.content) as android.view.ViewGroup).getChildAt(0)
        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(insetRoot) { v, ins ->
            val bars = ins.getInsetsIgnoringVisibility(androidx.core.view.WindowInsetsCompat.Type.systemBars())
            v.setPadding(v.paddingLeft, bars.top, v.paddingRight, bars.bottom)
            ins
        }

        findViewById<View>(R.id.btn_back).setOnClickListener { finish() }

        val recycler = findViewById<RecyclerView>(R.id.recycler_logs)
        val tvEmpty = findViewById<TextView>(R.id.tv_empty)
        val tvTitle = findViewById<TextView>(R.id.tv_title)

        // 接收 Intent 传来的参数，判断是今日还是总计
        val isToday = intent.getBooleanExtra("is_today", false)

        // 直接把标记传给 Bridge，在 Bridge 内部先过滤时间，再合并聚合
        val displayLogs = EngineBridge.getBlockLogs(this, isTodayOnly = isToday)

        // 专家修复：标题的次数不再去读全局 Total，而是根据列表中真实展示的聚合次数来求和。
        // 这样用户看到的标题数字，就永远等于下方列表里各域名次数的总和，彻底消除困惑。
        var displayCount = 0
        for (log in displayLogs) {
            displayCount += log.count
        }
        
        if (isToday) {
            tvTitle.text = getString(R.string.log_today_title, displayCount)
        } else {
            tvTitle.text = getString(R.string.log_total_title, displayCount)
        }

        if (displayLogs.isEmpty()) {
            tvEmpty.visibility = View.VISIBLE
            recycler.visibility = View.GONE
        } else {
            tvEmpty.visibility = View.GONE
            recycler.visibility = View.VISIBLE
        }

        recycler.layoutManager = LinearLayoutManager(this)
        recycler.adapter = LogAdapter(displayLogs)
    }
}
