package com.dewsecure.android.ui

import android.content.res.Configuration
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
    companion object {
        private const val ESTIMATED_MB_PER_BLOCK = 0.08
        private const val ESTIMATED_KB_PER_BLOCK = 80.0
    }

    private lateinit var tvTodayDetail: TextView
    private lateinit var tvTotalDetail: TextView
    private lateinit var tvTodayDate: TextView
    private lateinit var tvTotalDate: TextView
    private lateinit var recycler: RecyclerView
    private lateinit var tvEmpty: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_traffic)

        findViewById<View>(R.id.btn_back).setOnClickListener { finish() }
        
        tvTodayDetail = findViewById(R.id.tv_traffic_today_detail)
        tvTotalDetail = findViewById(R.id.tv_traffic_total_detail)
        tvTodayDate = findViewById(R.id.tv_today_date)
        tvTotalDate = findViewById(R.id.tv_total_date)
        recycler = findViewById(R.id.recycler_traffic)
        tvEmpty = findViewById(R.id.tv_empty_traffic)

        updateUI()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        // 🌟 核心：当语言切换时，手动刷新 UI 文本
        updateUI()
    }

    private fun updateUI() {
        // 刷新 XML 里的静态文本
        findViewById<TextView>(R.id.tv_traffic_title)?.text = getString(R.string.traffic_title)
        findViewById<TextView>(R.id.tv_today_saved_label)?.text = getString(R.string.traffic_saved_today)
        findViewById<TextView>(R.id.tv_total_saved_label)?.text = getString(R.string.traffic_saved_total)

        // 获取安装日期
        val prefs = getSharedPreferences("app_settings", MODE_PRIVATE)
        val installDate = prefs.getString("install_date", getString(R.string.traffic_unknown_date)) ?: getString(R.string.traffic_unknown_date)

        // 获取今天日期
        val sdf = SimpleDateFormat("d/M/yyyy", Locale.getDefault())
        val todayDate = sdf.format(Date())

        // 设置日期文本
        tvTodayDate.text = todayDate
        tvTotalDate.text = getString(R.string.traffic_from_date, installDate)

        // 获取数据
        val jsonStr = EngineBridge.getStatsJson(this)
        var todayCount = 0
        var totalCount = 0
        try {
            val json = JSONObject(jsonStr)
            todayCount = json.optInt("today_blocked", 0)
            totalCount = json.optInt("total_blocked", 0)
        } catch (e: Exception) {}

        // 格式化流量文本
        fun formatTraffic(count: Int): String {
            val mb = count * ESTIMATED_MB_PER_BLOCK
            return if (mb < 1.0) String.format("%.0f KB", count * ESTIMATED_KB_PER_BLOCK) else String.format("%.1f MB", mb)
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
