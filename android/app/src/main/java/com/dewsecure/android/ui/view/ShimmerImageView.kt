package com.dewsecure.android.ui.view

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.*
import android.util.AttributeSet
import android.view.animation.AccelerateDecelerateInterpolator
import androidx.appcompat.widget.AppCompatImageView

class ShimmerImageView @JvmOverloads constructor(
    context: Context, attrs: AttributeSet? = null, defStyleAttr: Int = 0
) : AppCompatImageView(context, attrs, defStyleAttr) {

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private var currentX = -1f
    private val shimmerWidth = 120f // 流光带的宽度，适当加宽显得更柔和

    init {
        // 核心：使用 SRC_IN，让流光只画在 Logo 的不透明像素（蜂巢线）上
        paint.xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC_IN)
    }

    override fun onDraw(canvas: Canvas) {
        // 1. 先用默认方式画出底色（完整的暗青色 Logo）
        super.onDraw(canvas)

        // 如果还没开始动画，直接返回
        if (currentX == -1f) return

        // 2. 创建一个离屏图层，用来处理流光的遮罩
        val layerId = canvas.saveLayer(0f, 0f, width.toFloat(), height.toFloat(), null)

        // 3. 在这个图层上，再画一遍 Logo 作为“遮罩”
        super.onDraw(canvas)

        // 4. 准备流光渐变（极亮青蓝色）
        val gradient = LinearGradient(
            currentX - shimmerWidth / 2, 0f, 
            currentX + shimmerWidth / 2, 0f,
            intArrayOf(0x0000E5FF, 0xFFFFFFFF.toInt(), 0x0000E5FF), // 两边透明，中间纯白高亮
            floatArrayOf(0f, 0.5f, 1f),
            Shader.TileMode.CLAMP
        )
        paint.shader = gradient

        // 5. 画流光矩形。因为设置了 SRC_IN，它会只在 Logo 线条的像素上着色
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), paint)

        // 6. 恢复图层
        canvas.restoreToCount(layerId)
    }

    fun startShimmer() {
        // 确保 View 布局完成后再开始
        post {
            currentX = -shimmerWidth
            // 动画从左侧画外，扫到右侧画外
            val animator = ValueAnimator.ofFloat(-shimmerWidth, width.toFloat() + shimmerWidth)
            
            // 🌟 核心调整：拉长动画时间至 1500ms，让光效更悠闲丝滑
            animator.duration = 1500
            animator.interpolator = AccelerateDecelerateInterpolator()
            animator.addUpdateListener { animation ->
                currentX = animation.animatedValue as Float
                invalidate() // 触发重绘
            }
            animator.start()
        }
    }
}
