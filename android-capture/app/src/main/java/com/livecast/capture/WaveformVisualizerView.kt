package com.livecast.capture

import android.content.Context
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.util.AttributeSet
import android.view.View

/**
 * Live 28-band broadcast waveform & spectrum visualizer driven by real mixed PCM energy.
 */
class WaveformVisualizerView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0,
) : View(context, attrs, defStyleAttr) {

    private var bands = FloatArray(28)
    private var masterMuted = false

    private val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFF070C18.toInt()
    }
    private val barPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 2f
        color = 0xFF1E293B.toInt()
    }
    private val bgRect = RectF()
    private val barRect = RectF()

    fun updateWaveform(waveform: FloatArray, isMuted: Boolean) {
        bands = waveform.copyOf()
        masterMuted = isMuted
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val w = width.toFloat()
        val h = height.toFloat()
        if (w <= 0f || h <= 0f) return

        val dp = resources.displayMetrics.density
        bgRect.set(0f, 0f, w, h)
        canvas.drawRoundRect(bgRect, 12f * dp, 12f * dp, bgPaint)

        val count = bands.size.coerceAtLeast(1)
        val pad = 10f * dp
        val availW = (w - pad * 2f).coerceAtLeast(1f)
        val slotW = availW / count
        val barW = (slotW * 0.62f).coerceAtLeast(3f)
        val centerY = h * 0.5f
        val maxHalfH = (h * 0.42f).coerceAtLeast(4f)

        barPaint.shader = LinearGradient(
            0f,
            0f,
            w,
            0f,
            intArrayOf(0xFF06B6D4.toInt(), 0xFF3B82F6.toInt(), 0xFF8B5CF6.toInt(), 0xFFEC4899.toInt()),
            null,
            Shader.TileMode.CLAMP,
        )

        for (i in 0 until count) {
            val amp = if (masterMuted) 0.04f else bands[i].coerceIn(0.05f, 1f)
            val halfBar = maxHalfH * amp
            val left = pad + i * slotW + (slotW - barW) * 0.5f
            barRect.set(left, centerY - halfBar, left + barW, centerY + halfBar)
            canvas.drawRoundRect(barRect, barW * 0.5f, barW * 0.5f, barPaint)
        }

        canvas.drawRoundRect(bgRect, 12f * dp, 12f * dp, borderPaint)
    }
}
