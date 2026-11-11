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

class TrafficAdapter(
    private val logs: List<EngineBridge.BlockLog>
) : RecyclerView.Adapter<TrafficAdapter.ViewHolder>() {

    class ViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val domain: TextView = view.findViewById(R.id.tv_domain)
        val time: TextView = view.findViewById(R.id.tv_time)
        val saved: TextView = view.findViewById(R.id.tv_saved)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_traffic_log, parent, false)
        return ViewHolder(view)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val log = logs[position]
        holder.domain.text = log.domain

        val sdf = SimpleDateFormat("HH:mm:ss", Locale.getDefault())
        holder.time.text = "${sdf.format(Date(log.timestamp))} · ${log.blockType}"
        
        // 如果合并了多次，按 50KB/次 累加显示
        val savedKb = log.count * 50
        holder.saved.text = "- $savedKb KB"
    }

    override fun getItemCount() = logs.size
}
