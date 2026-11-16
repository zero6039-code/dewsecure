package com.dewsecure.android.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.dewsecure.android.ui.MainActivity
import com.dewsecure.android.R

object VpnNotificationManager {
    private const val CHANNEL_ID = "dewsecure_vpn"
    const val NOTIFICATION_ID = 1001

    fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID, "DewSecure VPN", NotificationManager.IMPORTANCE_LOW
            )
            context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    fun buildNotification(context: Context): Notification {
        val contentIntent = PendingIntent.getActivity(
            context, 0, Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val stopIntent = Intent(context, DewVpnService::class.java).apply {
            action = "ACTION_STOP_VPN"
        }
        val stopPendingIntent = PendingIntent.getService(
            context, 1, stopIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        return NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle(context.getString(R.string.notif_title))
            .setContentText(context.getString(R.string.notif_text))
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, context.getString(R.string.notif_action_stop), stopPendingIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }
}
