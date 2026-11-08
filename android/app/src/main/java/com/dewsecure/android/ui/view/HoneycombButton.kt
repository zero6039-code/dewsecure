package com.dewsecure.android.ui.view

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.*
import android.util.AttributeSet
import android.view.animation.DecelerateInterpolator
import android.view.animation.LinearInterpolator
import androidx.appcompat.widget.AppCompatButton
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

class HoneycombButton @JvmOverloads constructor(
    context: Context, attrs: AttributeSet? = null, defStyleAttr: Int = androidx.appcompat.R.attr.buttonStyle
) : AppCompatButton(context, attrs, defStyleAttr) {

    private var progress = 0f // 0f = 关闭, 1f = 开启
    var isOn = false
        private set

    // 圆角背景与边框
    private val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 2f
        color = Color.parseColor("#30363D")
    }
    private val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#33161B22")
    }

    // 蜂巢线条画笔 (Logo 渐变)
    private val hexPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 2.5f // 稍微加粗一点，显得有质感
        val gradient = LinearGradient(0f, 0f, 0f, 200f,
            Color.parseColor("#00E5FF"), Color.parseColor("#1F6FEB"), Shader.TileMode.CLAMP)
        shader = gradient
    }

    // 扫描流光画笔 (亮青色发光)
    private val flowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 3f
        color = Color.parseColor("#FFFFFF")
        setShadowLayer(12f, 0f, 0f, Color.parseColor("#00E5FF"))
    }

    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textAlign = Paint.Align.CENTER
        textSize = 45f
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        color = Color.WHITE
    }

    private val rectF = RectF()
    private val clipPath = Path()
    private val hexPath = Path()
    private val hexCenters = mutableListOf<PointF>()
    
    private var flowProgress = 0f

    // 六边形几何参数 (半径 36)
    private val r = 36f
    private val hexWidth = sqrt(3.0).toFloat() * r
    private val hexHeight = 2f * r
    private val vertDist = hexHeight * 0.75f

    init {
        setBackgroundColor(Color.TRANSPARENT)
        isClickable = true
        isFocusable = true
        startFlowAnimation()
    }

    fun toggle() {
        isOn = !isOn
        val start = progress
        val end = if (isOn) 1f else 0f
        ValueAnimator.ofFloat(start, end).apply {
            duration = 800
            interpolator = DecelerateInterpolator()
            addUpdateListener {
                progress = it.animatedValue as Float
                invalidate()
            }
            start()
        }
    }

    fun setInitialState(initiallyOn: Boolean) {
        isOn = initiallyOn
        progress = if (initiallyOn) 1f else 0f
        invalidate()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        rectF.set(0f, 0f, w.toFloat(), h.toFloat())
        textPaint.textSize = h * 0.32f
        
        val radius = h / 2f
        clipPath.reset()
        clipPath.addRoundRect(rectF, radius, radius, Path.Direction.CW)
        
        generateHoneycomb(w.toFloat(), h.toFloat())
    }

    override fun onDraw(canvas: Canvas) {
        val w = width.toFloat()
        val h = height.toFloat()
        val radius = h / 2f

        // 画暗底和细边框
        canvas.drawRoundRect(rectF, radius, radius, bgPaint)
        canvas.drawRoundRect(rectF, radius, radius, borderPaint)

        if (progress > 0f) {
            canvas.save()
            // 核心修复：将画布裁剪成圆角矩形，防止蜂巢画到按钮外面
            canvas.clipPath(clipPath)

            val maxDistance = w / 1.5f // 最大扩散半径
            val currentSpread = maxDistance * progress

            // 1. 绘制蜂巢网格
            for (center in hexCenters) {
                val dist = abs(center.x - w / 2f)
                
                if (dist < currentSpread) {
                    var alphaRatio = 1f
                    if (currentSpread > 0) {
                        val edgeDist = currentSpread - dist
                        alphaRatio = (edgeDist / 80f).coerceIn(0f, 1f) // 边缘渐隐
                    }
                    
                    hexPaint.alpha = (255 * alphaRatio).toInt()
                    drawHexagon(canvas, center.x, center.y, r, hexPaint)
                }
            }

            // 2. 绘制移动的扫描流光 (仅当全亮时触发)
            if (progress > 0.8f) {
                val scanX = flowProgress * w // 当前扫描线的X坐标
                for (center in hexCenters) {
                    // 如果六边形在扫描线附近，高亮它的特定边
                    if (abs(center.x - scanX) < 40f) {
                        // 越靠近扫描线越亮
                        val intensity = 1f - (abs(center.x - scanX) / 40f)
                        flowPaint.alpha = (255 * intensity).toInt()
                        drawHexagon(canvas, center.x, center.y, r, flowPaint)
                    }
                }
            }

            canvas.restore()
        }

        // 3. 绘制文字
        val textY = (h / 2f) - ((textPaint.descent() + textPaint.ascent()) / 2f)
        canvas.drawText(text.toString(), w / 2f, textY, textPaint)
    }

    // 生成绝对对齐的蜂巢网格坐标
    private fun generateHoneycomb(w: Float, h: Float) {
        hexCenters.clear()
        val cols = (w / hexWidth).toInt() + 2
        val rows = (h / vertDist).toInt() + 2

        // 从中心向四周生成，确保扩散效果均匀
        for (row in -rows..rows) {
            for (col in -cols..cols) {
                // 奇数行向右偏移半个宽度
                val offsetX = if (row % 2 != 0) hexWidth / 2f else 0f
                val cx = w / 2f + col * hexWidth + offsetX
                val cy = h / 2f + row * vertDist
                hexCenters.add(PointF(cx, cy))
            }
        }
    }

    private fun drawHexagon(canvas: Canvas, cx: Float, cy: Float, r: Float, paint: Paint) {
        hexPath.reset()
        for (i in 0 until 6) {
            // 尖顶六边形：起始角度 30度
            val angle = Math.PI / 180.0 * (60 * i + 30)
            val x = cx + r * cos(angle).toFloat()
            val y = cy + r * sin(angle).toFloat()
            if (i == 0) hexPath.moveTo(x, y) else hexPath.lineTo(x, y)
        }
        hexPath.close()
        canvas.drawPath(hexPath, paint)
    }

    private fun startFlowAnimation() {
        ValueAnimator.ofFloat(0f, 1.2f).apply {
            duration = 3000
            repeatCount = ValueAnimator.INFINITE
            interpolator = LinearInterpolator()
            addUpdateListener {
                flowProgress = it.animatedValue as Float
                if (isOn) invalidate()
            }
            start()
        }
    }
}
