package com.dewsecure.android.ui

import android.os.Bundle
import android.view.View
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.dewsecure.android.R
import com.dewsecure.android.policy.EngineBridge
import com.dewsecure.android.ui.adapter.TrafficAdapter
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class TrafficActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_traffic)

        findViewById<View>(R.id.btn_back).setOnClickListener { finish() }

        val tvTodayDetail = findViewById<TextView>(R.id.tv_traffic_today_detail)
        val tvTotalDetail = findViewById<TextView>(R.id.tv_traffic_total_detail)
        val tvTodayDate = findViewById<TextView>(R.id.tv_today_date)
        val tvTotalDate = findViewById<TextView>(R.id.tv_total_date)
        val recycler = findViewById<RecyclerView>(R.id.recycler_traffic)
        val tvEmpty = findViewById<TextView>(R.id.tv_empty_traffic)

        // 获取安装日期
        val prefs = getSharedPreferences("app_settings", MODE_PRIVATE)
        val installDate = prefs.getString("install_date", "未知") ?: "未知"

        // 获取今天日期
        val sdf = SimpleDateFormat("d/M/yyyy", Locale.getDefault())
        val todayDate = sdf.format(Date())

        // 设置日期文本
        tvTodayDate.text = todayDate
        tvTotalDate.text = "从 $installDate 到目前为止"

        // 获取数据
        val jsonStr = EngineBridge.getStatsJson()
        var todayCount = 0
        var totalCount = 0
        try {
            val json = JSONObject(jsonStr)
            todayCount = json.optInt("today_blocked", 0)
            totalCount = json.optInt("total_blocked", 0)
        } catch (e: Exception) {}

        // 格式化流量文本
        fun formatTraffic(count: Int): String {
            val mb = count * 0.05
            return if (mb < 1.0) String.format("%.0f KB", count * 50.0) else String.format("%.1f MB", mb)
        }

        tvTodayDetail.text = formatTraffic(todayCount)
        tvTotalDetail.text = formatTraffic(totalCount)

        // 获取列表数据
        val logs = EngineBridge.getBlockLogs()

        if (logs.isEmpty()) {
            tvEmpty.visibility = View.VISIBLE
            recycler.visibility = View.GONE
        } else {
            tvEmpty.visibility = View.GONE
            recycler.visibility = View.VISIBLE
        }

        recycler.layoutManager = LinearLayoutManager(this)
        recycler.adapter = TrafficAdapter(logs)
    }
}
