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

        val sdf = SimpleDateFormat("HH:mm:ss", Locale.getDefault())
        holder.time.text = "${sdf.format(Date(log.timestamp))} · ${log.blockType}"
        holder.count.text = "x ${log.count}"
    }

    override fun getItemCount() = logs.size
}
