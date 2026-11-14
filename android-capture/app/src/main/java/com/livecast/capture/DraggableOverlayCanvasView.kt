package com.livecast.capture

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.View
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Interactive 16:9 Studio Broadcast Overlay Preview Canvas.
 * Renders all active layers (Logo, Clock, Headline, Breaking News, Lower Third,
 * Scrolling Ticker, Custom Text, and Image Overlay) and lets the operator drag
 * movable layers directly with their finger.
 */
class DraggableOverlayCanvasView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0,
) : View(context, attrs, defStyleAttr) {

    enum class DragTarget(val label: String) {
        CUSTOM_TEXT("Custom Text"),
        IMAGE_OVERLAY("Image Overlay"),
        LOGO("Channel Logo"),
        CLOCK("Live Clock"),
        LOWER_THIRD("Lower Third"),
    }

    private var state = OverlayStudioState()
    private var activeTarget = DragTarget.CUSTOM_TEXT
    private var tickerOffsetPx = 0f
    private var logoBitmap: Bitmap? = null
    private var imageOverlayBitmap: Bitmap? = null
    private var onPositionChanged: ((DragTarget, Float, Float) -> Unit)? = null

    private val stagePaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val gridPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0x2238BDF8
        strokeWidth = 1.5f
    }
    private val boxPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val accentPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val subTextPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val activeRingPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 3f
        color = 0xFF06B6D4.toInt()
    }
    private val tmpRect = RectF()
    private val tmpRect2 = RectF()

    private val tickerRunnable = object : Runnable {
        override fun run() {
            if (state.tickerEnabled && isAttachedToWindow) {
                tickerOffsetPx += 3.2f
                invalidate()
                postDelayed(this, 33L)
            }
        }
    }

    fun setOverlayState(newState: OverlayStudioState) {
        val wasTicker = state.tickerEnabled
        state = newState
        invalidate()
        if (!wasTicker && newState.tickerEnabled) {
            removeCallbacks(tickerRunnable)
            post(tickerRunnable)
        } else if (!newState.tickerEnabled) {
            removeCallbacks(tickerRunnable)
        }
    }

    fun setActiveDragTarget(target: DragTarget) {
        activeTarget = target
        invalidate()
    }

    fun setLogoBitmap(bmp: Bitmap?) {
        logoBitmap = bmp
        invalidate()
    }

    fun setImageOverlayBitmap(bmp: Bitmap?) {
        imageOverlayBitmap = bmp
        invalidate()
    }

    fun setOnPositionChangedListener(listener: (DragTarget, Float, Float) -> Unit) {
        onPositionChanged = listener
    }

    override fun onDetachedFromWindow() {
        removeCallbacks(tickerRunnable)
        super.onDetachedFromWindow()
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val w = MeasureSpec.getSize(widthMeasureSpec)
        val targetH = (w * 9f / 16f).toInt().coerceAtLeast(180)
        setMeasuredDimension(w, resolveSize(targetH, heightMeasureSpec))
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (width <= 0 || height <= 0) return super.onTouchEvent(event)
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE -> {
                parent?.requestDisallowInterceptTouchEvent(true)
                val xPct = ((event.x / width.toFloat()) * 100f).coerceIn(2f, 92f)
                val yPct = ((event.y / height.toFloat()) * 100f).coerceIn(2f, 92f)
                state = when (activeTarget) {
                    DragTarget.CUSTOM_TEXT -> state.copy(customTextX = xPct, customTextY = yPct)
                    DragTarget.IMAGE_OVERLAY -> state.copy(imageOverlayX = xPct, imageOverlayY = yPct)
                    DragTarget.LOGO -> state.copy(logoX = xPct, logoY = yPct)
                    DragTarget.CLOCK -> state.copy(clockX = xPct, clockY = yPct)
                    DragTarget.LOWER_THIRD -> state.copy(lowerThirdX = xPct, lowerThirdY = yPct)
                }
                invalidate()
                if (event.actionMasked == MotionEvent.ACTION_MOVE || event.actionMasked == MotionEvent.ACTION_UP) {
                    onPositionChanged?.invoke(activeTarget, xPct, yPct)
                }
                return true
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                parent?.requestDisallowInterceptTouchEvent(false)
                val xPct = ((event.x / width.toFloat()) * 100f).coerceIn(2f, 92f)
                val yPct = ((event.y / height.toFloat()) * 100f).coerceIn(2f, 92f)
                onPositionChanged?.invoke(activeTarget, xPct, yPct)
                return true
            }
        }
        return super.onTouchEvent(event)
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val w = width.toFloat()
        val h = height.toFloat()
        if (w <= 0f || h <= 0f) return
        val dp = resources.displayMetrics.density

        // 16:9 Studio Stage backdrop
        stagePaint.shader = LinearGradient(
            0f,
            0f,
            w,
            h,
            intArrayOf(0xFF040711.toInt(), 0xFF0E172E.toInt(), 0xFF060B17.toInt()),
            null,
            Shader.TileMode.CLAMP,
        )
        canvas.drawRoundRect(0f, 0f, w, h, 14f * dp, 14f * dp, stagePaint)

        // Safe-title broadcast guides
        val safeMarginX = w * 0.05f
        val safeMarginY = h * 0.06f
        canvas.drawRect(safeMarginX, safeMarginY, w - safeMarginX, h - safeMarginY, gridPaint)

        // Stage Label
        subTextPaint.textSize = 9.5f * dp
        subTextPaint.color = 0x6694A3B8
        subTextPaint.textAlign = Paint.Align.CENTER
        canvas.drawText("PROGRAM OUTPUT COMPOSITOR · DRAG '${activeTarget.label.uppercase()}'", w * 0.5f, h * 0.52f, subTextPaint)

        // 1. Top Headline Banner
        if (state.headlineEnabled && state.headlineText.isNotBlank()) {
            boxPaint.color = withAlpha(parseHex(state.headlineBgColor, 0xFF0F172A.toInt()), state.headlineBgOpacity)
            tmpRect.set(w * 0.04f, h * 0.04f, w * 0.96f, h * 0.19f)
            canvas.drawRoundRect(tmpRect, 6f * dp, 6f * dp, boxPaint)
            textPaint.color = parseHex(state.headlineColor, Color.WHITE)
            textPaint.textSize = (state.headlineFontSize * 0.42f * dp).coerceIn(10f * dp, 24f * dp)
            textPaint.isFakeBoldText = true
            textPaint.textAlign = Paint.Align.LEFT
            canvas.drawText(state.headlineText, tmpRect.left + 10f * dp, tmpRect.centerY() + textPaint.textSize * 0.35f, textPaint)
        }

        // 2. Breaking News Banner
        if (state.breakingNewsEnabled) {
            val top = if (state.tickerEnabled) h * 0.72f else h * 0.80f
            val bottom = top + h * 0.13f
            boxPaint.color = withAlpha(parseHex(state.breakingNewsBgColor, 0xFFDC2626.toInt()), state.breakingNewsOpacity)
            tmpRect.set(w * 0.03f, top, w * 0.97f, bottom)
            canvas.drawRoundRect(tmpRect, 6f * dp, 6f * dp, boxPaint)
            textPaint.color = parseHex(state.breakingNewsTextColor, Color.WHITE)
            textPaint.textSize = 11f * dp
            textPaint.isFakeBoldText = true
            textPaint.textAlign = Paint.Align.LEFT
            canvas.drawText("${state.breakingNewsLabel}: ${state.breakingNewsText}", tmpRect.left + 8f * dp, tmpRect.centerY() + 4f * dp, textPaint)
        }

        // 3. Channel Logo
        if (state.logoEnabled) {
            val logoSize = w * (state.logoScale / 100f).coerceIn(0.06f, 0.32f)
            val lx = ((state.logoX ?: 82f) / 100f * w).coerceIn(4f, w - logoSize - 4f)
            val ly = ((state.logoY ?: 8f) / 100f * h).coerceIn(4f, h - logoSize - 4f)
            tmpRect.set(lx, ly, lx + logoSize, ly + logoSize * 0.65f)
            val bmp = logoBitmap
            if (bmp != null) {
                boxPaint.alpha = (state.logoOpacity * 255f).toInt().coerceIn(25, 255)
                canvas.drawBitmap(bmp, null, tmpRect, boxPaint)
                boxPaint.alpha = 255
            } else {
                boxPaint.color = withAlpha(0xFF2563EB.toInt(), state.logoOpacity)
                canvas.drawRoundRect(tmpRect, 8f * dp, 8f * dp, boxPaint)
                textPaint.color = Color.WHITE
                textPaint.textSize = 9.5f * dp
                textPaint.textAlign = Paint.Align.CENTER
                canvas.drawText("LOGO", tmpRect.centerX(), tmpRect.centerY() + 3f * dp, textPaint)
            }
            if (activeTarget == DragTarget.LOGO) {
                canvas.drawRoundRect(tmpRect, 8f * dp, 8f * dp, activeRingPaint)
            }
        }

        // 4. Custom Image Overlay
        if (state.imageOverlayEnabled) {
            val imgSize = w * (state.imageOverlayScale / 100f).coerceIn(0.06f, 0.45f)
            val ix = (state.imageOverlayX / 100f * w).coerceIn(4f, w - imgSize - 4f)
            val iy = (state.imageOverlayY / 100f * h).coerceIn(4f, h - imgSize * 0.6f - 4f)
            tmpRect.set(ix, iy, ix + imgSize, iy + imgSize * 0.72f)
            val bmp = imageOverlayBitmap
            if (bmp != null) {
                boxPaint.alpha = (state.imageOverlayOpacity * 255f).toInt().coerceIn(25, 255)
                canvas.drawBitmap(bmp, null, tmpRect, boxPaint)
                boxPaint.alpha = 255
            } else {
                boxPaint.color = withAlpha(0xFF8B5CF6.toInt(), state.imageOverlayOpacity)
                canvas.drawRoundRect(tmpRect, 8f * dp, 8f * dp, boxPaint)
                textPaint.color = Color.WHITE
                textPaint.textSize = 9.5f * dp
                textPaint.textAlign = Paint.Align.CENTER
                canvas.drawText("PNG", tmpRect.centerX(), tmpRect.centerY() + 3f * dp, textPaint)
            }
            if (activeTarget == DragTarget.IMAGE_OVERLAY) {
                canvas.drawRoundRect(tmpRect, 8f * dp, 8f * dp, activeRingPaint)
            }
        }

        // 5. Lower Third
        if (state.lowerThirdEnabled) {
            val ltx = ((state.lowerThirdX ?: 4f) / 100f * w).coerceIn(4f, w * 0.65f)
            val lty = ((state.lowerThirdY ?: 64f) / 100f * h).coerceIn(4f, h * 0.80f)
            tmpRect.set(ltx, lty, (ltx + w * 0.46f).coerceAtMost(w - 8f), lty + h * 0.19f)
            boxPaint.color = withAlpha(parseHex(state.lowerThirdBgColor, 0xFF0B0E14.toInt()), 0.90f)
            canvas.drawRoundRect(tmpRect, 6f * dp, 6f * dp, boxPaint)
            accentPaint.color = parseHex(state.lowerThirdAccentColor, 0xFF3B82F6.toInt())
            tmpRect2.set(tmpRect.left, tmpRect.top, tmpRect.left + 4f * dp, tmpRect.bottom)
            canvas.drawRoundRect(tmpRect2, 2f * dp, 2f * dp, accentPaint)
            textPaint.color = parseHex(state.lowerThirdTextColor, Color.WHITE)
            textPaint.textSize = 10.5f * dp
            textPaint.isFakeBoldText = true
            textPaint.textAlign = Paint.Align.LEFT
            canvas.drawText(state.lowerThirdTitle, tmpRect.left + 10f * dp, tmpRect.top + 14f * dp, textPaint)
            subTextPaint.color = 0xFFCBD5E1.toInt()
            subTextPaint.textSize = 8.5f * dp
            subTextPaint.textAlign = Paint.Align.LEFT
            canvas.drawText(state.lowerThirdSubtitle, tmpRect.left + 10f * dp, tmpRect.top + 26f * dp, subTextPaint)
            if (activeTarget == DragTarget.LOWER_THIRD) {
                canvas.drawRoundRect(tmpRect, 6f * dp, 6f * dp, activeRingPaint)
            }
        }

        // 6. Live Clock
        if (state.clockEnabled) {
            val fmt = when (state.clockFormat) {
                "time-12h" -> "hh:mm:ss a"
                "time-24h" -> "HH:mm:ss"
                else -> "MMM dd · HH:mm:ss"
            }
            val nowStr = SimpleDateFormat(fmt, Locale.US).format(Date())
            textPaint.textSize = (state.clockFontSize * 0.48f * dp).coerceIn(9f * dp, 16f * dp)
            textPaint.isFakeBoldText = true
            val tw = textPaint.measureText(nowStr) + 14f * dp
            val th = textPaint.textSize + 8f * dp
            val cx = ((state.clockX ?: 74f) / 100f * w).coerceIn(4f, w - tw - 4f)
            val cy = ((state.clockY ?: 5f) / 100f * h).coerceIn(4f, h - th - 4f)
            tmpRect.set(cx, cy, cx + tw, cy + th)
            boxPaint.color = withAlpha(parseHex(state.clockBgColor, 0xFF0B0E14.toInt()), 0.84f)
            canvas.drawRoundRect(tmpRect, 5f * dp, 5f * dp, boxPaint)
            textPaint.color = parseHex(state.clockColor, Color.WHITE)
            textPaint.textAlign = Paint.Align.LEFT
            canvas.drawText(nowStr, tmpRect.left + 7f * dp, tmpRect.centerY() + textPaint.textSize * 0.35f, textPaint)
            if (activeTarget == DragTarget.CLOCK) {
                canvas.drawRoundRect(tmpRect, 5f * dp, 5f * dp, activeRingPaint)
            }
        }

        // 7. Custom Text Overlay
        if (state.customTextEnabled && state.customText.isNotBlank()) {
            textPaint.textSize = (state.customTextFontSize * 0.46f * dp).coerceIn(10f * dp, 24f * dp)
            textPaint.isFakeBoldText = true
            val tw = textPaint.measureText(state.customText) + 18f * dp
            val th = textPaint.textSize + 10f * dp
            val rawX = state.customTextX / 100f * w
            val xLeft = when (state.customTextAlign) {
                "center" -> rawX - tw * 0.5f
                "right" -> rawX - tw
                else -> rawX
            }.coerceIn(4f, (w - tw - 4f).coerceAtLeast(4f))
            val yTop = (state.customTextY / 100f * h).coerceIn(4f, (h - th - 4f).coerceAtLeast(4f))
            tmpRect.set(xLeft, yTop, (xLeft + tw).coerceAtMost(w - 4f), yTop + th)
            boxPaint.color = withAlpha(parseHex(state.customTextBgColor, 0xFF1E1B4B.toInt()), 0.85f)
            canvas.drawRoundRect(tmpRect, 6f * dp, 6f * dp, boxPaint)
            textPaint.color = parseHex(state.customTextColor, Color.WHITE)
            textPaint.textAlign = Paint.Align.LEFT
            canvas.drawText(state.customText, tmpRect.left + 9f * dp, tmpRect.centerY() + textPaint.textSize * 0.35f, textPaint)
            if (activeTarget == DragTarget.CUSTOM_TEXT) {
                canvas.drawRoundRect(tmpRect, 6f * dp, 6f * dp, activeRingPaint)
            }
        }

        // 8. Scrolling Ticker
        if (state.tickerEnabled && state.tickerText.isNotBlank()) {
            val tickerH = h * 0.13f
            tmpRect.set(0f, h - tickerH, w, h)
            boxPaint.color = withAlpha(parseHex(state.tickerBgColor, 0xFF1E293B.toInt()), 0.92f)
            canvas.drawRect(tmpRect, boxPaint)
            textPaint.color = parseHex(state.tickerColor, Color.WHITE)
            textPaint.textSize = 10.5f * dp
            textPaint.isFakeBoldText = false
            textPaint.textAlign = Paint.Align.LEFT
            val span = textPaint.measureText(state.tickerText) + 60f * dp
            val x = w - (tickerOffsetPx % (w + span))
            canvas.drawText(state.tickerText, x, tmpRect.centerY() + 3.5f * dp, textPaint)
        }
    }

    private fun parseHex(hex: String, fallback: Int): Int {
        return try {
            Color.parseColor(hex.trim())
        } catch (_: Exception) {
            fallback
        }
    }

    private fun withAlpha(color: Int, alpha: Float): Int {
        val a = (alpha.coerceIn(0f, 1f) * 255f).toInt()
        return (color and 0x00FFFFFF) or (a shl 24)
    }
}
