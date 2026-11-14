package com.dewsecure.android.ui.controller

import android.content.Context
import android.graphics.Typeface
import android.view.Gravity
import android.view.View
import android.widget.GridLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import com.dewsecure.android.R

class LangSettingsController(
    private val fragment: Fragment,
    private val rootView: View
) {
    private val languages = listOf(
        "English" to "en", "简体中文" to "zh", "日本語" to "ja",
        "한국어" to "ko", "Melayu" to "ms", "Español" to "es",
        "Português" to "pt", "Deutsch" to "de", "Français" to "fr"
    )

    fun setup() {
        val grid = rootView.findViewById<GridLayout>(R.id.grid_language) ?: return
        val context = fragment.requireContext()
        val prefs = context.getSharedPreferences("app_settings", Context.MODE_PRIVATE)
        val currentLang = prefs.getString("language", "en") ?: "en"

        for ((name, code) in languages) {
            val btn = TextView(context)
            btn.text = name
            btn.gravity = Gravity.CENTER
            btn.textSize = 13f
            btn.setPadding(16, 16, 16, 16)

            val params = GridLayout.LayoutParams()
            params.width = 0
            params.height = GridLayout.LayoutParams.WRAP_CONTENT
            params.columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f)
            params.setMargins(8, 8, 8, 8)
            btn.layoutParams = params

            fun updateState(isSelected: Boolean) {
                if (isSelected) {
                    btn.setBackgroundResource(R.drawable.bg_glass_tab_active)
                    btn.setTextColor(ContextCompat.getColor(context, R.color.green_on))
                    btn.setTypeface(null, Typeface.BOLD)
                } else {
                    btn.setBackgroundResource(R.drawable.bg_glass_card)
                    btn.setTextColor(ContextCompat.getColor(context, R.color.text_primary))
                    btn.setTypeface(null, Typeface.NORMAL)
                }
            }

            updateState(code == currentLang)

            btn.setOnClickListener {
                for (i in 0 until grid.childCount) {
                    val child = grid.getChildAt(i) as TextView
                    val childLang = languages[i].second
                    if (childLang == code) {
                        child.setBackgroundResource(R.drawable.bg_glass_tab_active)
                        child.setTextColor(ContextCompat.getColor(context, R.color.green_on))
                        child.setTypeface(null, Typeface.BOLD)
                    } else {
                        child.setBackgroundResource(R.drawable.bg_glass_card)
                        child.setTextColor(ContextCompat.getColor(context, R.color.text_primary))
                        child.setTypeface(null, Typeface.NORMAL)
                    }
                }
                prefs.edit().putString("language", code).apply()
                Toast.makeText(context, "Language switched to $name", Toast.LENGTH_SHORT).show()
            }
            grid.addView(btn)
        }
    }
}
