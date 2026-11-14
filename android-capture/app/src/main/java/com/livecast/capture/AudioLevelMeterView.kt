package com.livecast.capture

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.util.AttributeSet
import android.view.View

/**
 * Broadcast segmented peak-hold dB audio level meter (green/teal -> amber -> magenta/red).
 */
class AudioLevelMeterView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0,
) : View(context, attrs, defStyleAttr) {

    private var level = 0f
    private var peakLevel = 0f
    private var muted = false

    private val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFF09101E.toInt()
    }
    private val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 2f
        color = 0xFF1E293B.toInt()
    }
    private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val peakPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFFF8FAFC.toInt()
    }
    private val rect = RectF()
    private val fillRect = RectF()

    fun setLevel(normalizedLevel: Float, isMuted: Boolean) {
        val clamped = if (isMuted) 0f else normalizedLevel.coerceIn(0f, 1f)
        level = clamped
        muted = isMuted
        if (clamped > peakLevel) {
            peakLevel = clamped
        } else {
            peakLevel = (peakLevel - 0.025f).coerceAtLeast(clamped)
        }
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val w = width.toFloat()
        val h = height.toFloat()
        if (w <= 0f || h <= 0f) return

        val radius = h * 0.45f
        rect.set(0f, 0f, w, h)
        canvas.drawRoundRect(rect, radius, radius, bgPaint)

        if (!muted && level > 0.005f) {
            fillPaint.shader = LinearGradient(
                0f,
                0f,
                w,
                0f,
                intArrayOf(0xFF14B8A6.toInt(), 0xFF06B6D4.toInt(), 0xFFF59E0B.toInt(), 0xFFEC4899.toInt()),
                floatArrayOf(0f, 0.55f, 0.8f, 1f),
                Shader.TileMode.CLAMP,
            )
            fillRect.set(2f, 2f, (w * level).coerceAtLeast(6f).coerceAtMost(w - 2f), h - 2f)
            canvas.drawRoundRect(fillRect, radius, radius, fillPaint)

            val peakX = (w * peakLevel).coerceIn(4f, w - 4f)
            canvas.drawRect(peakX - 2f, 2f, peakX + 2f, h - 2f, peakPaint)
        } else if (muted) {
            fillPaint.shader = null
            fillPaint.color = Color.argb(65, 244, 63, 94)
            fillRect.set(2f, 2f, w - 2f, h - 2f)
            canvas.drawRoundRect(fillRect, radius, radius, fillPaint)
        }

        canvas.drawRoundRect(rect, radius, radius, borderPaint)
    }
}
