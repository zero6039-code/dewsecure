package com.dewsecure.android.ui.adapter

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.dewsecure.android.R
import com.dewsecure.android.policy.EngineBridge
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class LogAdapter(
    private val logs: List<EngineBridge.BlockLog>
) : RecyclerView.Adapter<LogAdapter.ViewHolder>() {
    private fun formatLogTime(timestamp: Long): String {
        if (timestamp <= 0) return ""
        val now = java.util.Calendar.getInstance()
        val logCal = java.util.Calendar.getInstance().apply { timeInMillis = timestamp }
        
        val isToday = now.get(java.util.Calendar.YEAR) == logCal.get(java.util.Calendar.YEAR) &&
                      now.get(java.util.Calendar.DAY_OF_YEAR) == logCal.get(java.util.Calendar.DAY_OF_YEAR)
                      
        val yesterday = java.util.Calendar.getInstance().apply { add(java.util.Calendar.DAY_OF_YEAR, -1) }
        val isYesterday = yesterday.get(java.util.Calendar.YEAR) == logCal.get(java.util.Calendar.YEAR) &&
                          yesterday.get(java.util.Calendar.DAY_OF_YEAR) == logCal.get(java.util.Calendar.DAY_OF_YEAR)

        return when {
            isToday -> java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.getDefault()).format(java.util.Date(timestamp))
            isYesterday -> "昨天 " + java.text.SimpleDateFormat("HH:mm", java.util.Locale.getDefault()).format(java.util.Date(timestamp))
            else -> java.text.SimpleDateFormat("yyyy/MM/dd HH:mm", java.util.Locale.getDefault()).format(java.util.Date(timestamp))
        }
    }


    class ViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val domain: TextView = view.findViewById(R.id.tv_domain)
        val time: TextView = view.findViewById(R.id.tv_time)
        val count: TextView = view.findViewById(R.id.tv_count)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_block_log, parent, false)
        return ViewHolder(view)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val log = logs[position]
        holder.domain.text = log.domain

        holder.time.text = "${formatLogTime(log.timestamp)} · ${log.blockType}"
        // 直接显示次数，不再加 x
        holder.count.text = log.count.toString()
    }

    override fun getItemCount() = logs.size
}
