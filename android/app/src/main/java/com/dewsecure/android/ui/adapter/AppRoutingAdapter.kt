package com.dewsecure.android.ui.adapter

import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.Drawable
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.appcompat.widget.SwitchCompat
import androidx.recyclerview.widget.RecyclerView
import com.dewsecure.android.R

data class AppModel(
    val name: String,
    val packageName: String,
    
    val isBypassed: Boolean
)

object IconLoader {
    private val cache = android.util.LruCache<String, Drawable>(100)
    private val mainHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private val executor = java.util.concurrent.Executors.newFixedThreadPool(4)

    fun load(imageView: ImageView, packageName: String) {
        val cached = cache.get(packageName)
        if (cached != null) {
            imageView.setImageDrawable(cached)
            return
        }
        imageView.setImageDrawable(null)
        imageView.tag = packageName
        val context = imageView.context
        
        executor.execute {
            val icon = try {
                context.packageManager.getApplicationIcon(packageName)
            } catch (e: Exception) { null }
            if (icon != null) {
                cache.put(packageName, icon)
                mainHandler.post {
                    if (imageView.tag == packageName) imageView.setImageDrawable(icon)
                }
            }
        }
    }
}

class AppRoutingAdapter(
    private var apps: List<AppModel>,
    private val onSwitchChanged: (AppModel, Boolean) -> Unit
) : RecyclerView.Adapter<AppRoutingAdapter.ViewHolder>() {

    class ViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val ivAppIcon: ImageView = view.findViewById(R.id.iv_app_icon)
        val tvAppName: TextView = view.findViewById(R.id.tv_app_name)
        val tvPackageName: TextView = view.findViewById(R.id.tv_package_name)
        val switchBypass: SwitchCompat = view.findViewById(R.id.switch_bypass)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_app_routing, parent, false)
        return ViewHolder(view)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val app = apps[position]
        IconLoader.load(holder.ivAppIcon, app.packageName)
        holder.tvAppName.text = app.name
        holder.tvPackageName.text = app.packageName

        val states = arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf(-android.R.attr.state_checked))
        val thumbColors = intArrayOf(Color.WHITE, Color.WHITE)
        val trackColors = intArrayOf(Color.parseColor("#00E5FF"), Color.parseColor("#424242"))
        holder.switchBypass.thumbTintList = ColorStateList(states, thumbColors)
        holder.switchBypass.trackTintList = ColorStateList(states, trackColors)

        holder.switchBypass.setOnCheckedChangeListener(null)
        holder.switchBypass.isChecked = app.isBypassed

        holder.switchBypass.setOnCheckedChangeListener { _, isChecked ->
            onSwitchChanged(app, isChecked)
        }
    }

    override fun getItemCount() = apps.size

    fun updateData(newApps: List<AppModel>) {
        val diffResult = androidx.recyclerview.widget.DiffUtil.calculateDiff(object : androidx.recyclerview.widget.DiffUtil.Callback() {
            override fun getOldListSize() = apps.size
            override fun getNewListSize() = newApps.size
            override fun areItemsTheSame(oldItemPosition: Int, newItemPosition: Int) = apps[oldItemPosition].packageName == newApps[newItemPosition].packageName
            override fun areContentsTheSame(oldItemPosition: Int, newItemPosition: Int) = apps[oldItemPosition] == newApps[newItemPosition]
        })
        apps = newApps
        diffResult.dispatchUpdatesTo(this)
    }
}
