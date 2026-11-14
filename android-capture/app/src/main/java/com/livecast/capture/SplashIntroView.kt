package com.livecast.capture

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.util.AttributeSet
import android.view.View
import android.view.animation.LinearInterpolator
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

/**
 * High-FPS 60fps custom broadcast opening animation for LIVECAST STUDIO:
 * - Deep black/navy base + radial electric blue/purple studio glow
 * - Center Livecast Studio camera-broadcast emblem with expanding signal arcs
 * - Traveling sound waves & subtle floating luminous particles
 * - Smooth animated "LIVECAST STUDIO" title & "TV BROADCAST CONTROL ROOM" subtitle
 */
class SplashIntroView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0,
) : View(context, attrs, defStyleAttr) {

    private var progress = 0f
    private var animator: ValueAnimator? = null

    private val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val glowPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val particlePaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val arcPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
    }
    private val emblemFillPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val emblemStrokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
    }
    private val wavePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
    }
    private val titlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textAlign = Paint.Align.CENTER
        isFakeBoldText = true
    }
    private val subtitlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textAlign = Paint.Align.CENTER
        letterSpacing = 0.22f
    }

    private data class Particle(val rx: Float, val ry: Float, val radius: Float, val speed: Float, val phase: Float)

    private val particles = List(26) { idx ->
        val angle = idx * 0.618f * 2f * PI.toFloat()
        Particle(
            rx = (0.12f + ((idx * 17) % 76) / 100f),
            ry = (0.12f + ((idx * 29) % 76) / 100f),
            radius = 1.8f + (idx % 4) * 1.1f,
            speed = 0.6f + (idx % 5) * 0.25f,
            phase = angle,
        )
    }

    private val cardRect = RectF()
    private val arcRect = RectF()
    private val playPath = Path()
    private val wavePath = Path()

    fun startAnimation(durationMs: Long = 3500L, onCompleted: () -> Unit) {
        animator?.cancel()
        animator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = durationMs
            interpolator = LinearInterpolator()
            addUpdateListener { anim ->
                progress = anim.animatedValue as Float
                invalidate()
            }
            addListener(object : android.animation.Animator.AnimatorListener {
                private var cancelled = false
                override fun onAnimationStart(animation: android.animation.Animator) {}
                override fun onAnimationEnd(animation: android.animation.Animator) {
                    if (!cancelled) onCompleted()
                }
                override fun onAnimationCancel(animation: android.animation.Animator) {
                    cancelled = true
                }
                override fun onAnimationRepeat(animation: android.animation.Animator) {}
            })
            start()
        }
    }

    fun cancelAnimation() {
        animator?.cancel()
        animator = null
    }

    override fun onDetachedFromWindow() {
        cancelAnimation()
        super.onDetachedFromWindow()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val w = width.toFloat()
        val h = height.toFloat()
        if (w <= 0f || h <= 0f) return

        val cx = w * 0.5f
        val cy = h * 0.43f
        val dp = resources.displayMetrics.density

        // 1. Deep Black & Navy Backdrop
        bgPaint.shader = LinearGradient(
            0f,
            0f,
            w,
            h,
            intArrayOf(0xFF03050B.toInt(), 0xFF091024.toInt(), 0xFF04060E.toInt()),
            floatArrayOf(0f, 0.52f, 1f),
            Shader.TileMode.CLAMP,
        )
        canvas.drawRect(0f, 0f, w, h, bgPaint)

        // 2. Radial Studio Glow (Electric Blue + Purple)
        val glowAlpha = (min(1f, progress / 0.35f) * 175).toInt().coerceIn(0, 255)
        val glowRadius = min(w, h) * (0.48f + 0.08f * sin(progress * 2f * PI).toFloat())
        glowPaint.shader = RadialGradient(
            cx,
            cy,
            glowRadius,
            intArrayOf(
                Color.argb((glowAlpha * 0.65f).toInt(), 59, 130, 246),
                Color.argb((glowAlpha * 0.38f).toInt(), 139, 92, 246),
                Color.TRANSPARENT,
            ),
            floatArrayOf(0f, 0.46f, 1f),
            Shader.TileMode.CLAMP,
        )
        canvas.drawCircle(cx, cy, glowRadius, glowPaint)

        // 3. Subtle floating luminous particles
        for (p in particles) {
            val px = p.rx * w + sin(progress * 4.5f * p.speed + p.phase) * 14f * dp
            val py = p.ry * h - (progress * 38f * p.speed * dp) % (40f * dp)
            val twinkle = 0.35f + 0.65f * ((sin(progress * 9f + p.phase) + 1f) * 0.5f)
            particlePaint.color = Color.argb((twinkle * 130f).toInt().coerceIn(0, 255), 147, 197, 253)
            canvas.drawCircle(px, py, p.radius * dp, particlePaint)
        }

        // 4. Broadcast Signal Waves expanding from center emblem
        val emblemSize = 44f * dp
        for (ring in 0..2) {
            val wavePhase = ((progress * 2.2f) + ring * 0.33f) % 1f
            val r = emblemSize * (1.15f + wavePhase * 1.45f)
            val alpha = ((1f - wavePhase) * 185f * min(1f, progress / 0.25f)).toInt().coerceIn(0, 255)
            arcPaint.strokeWidth = (2.4f - wavePhase * 1.2f) * dp
            arcPaint.color = when (ring) {
                0 -> Color.argb(alpha, 59, 130, 246)
                1 -> Color.argb(alpha, 6, 182, 212)
                else -> Color.argb(alpha, 139, 92, 246)
            }
            arcRect.set(cx - r, cy - r, cx + r, cy + r)
            canvas.drawArc(arcRect, -42f, 84f, false, arcPaint)
            canvas.drawArc(arcRect, 138f, 84f, false, arcPaint)
        }

        // 5. Center Logo Card
        val emblemScale = min(1f, 0.65f + (progress / 0.28f) * 0.35f)
        val half = emblemSize * emblemScale
        cardRect.set(cx - half, cy - half, cx + half, cy + half)
        emblemFillPaint.shader = LinearGradient(
            cardRect.left,
            cardRect.top,
            cardRect.right,
            cardRect.bottom,
            0xFF2563EB.toInt(),
            0xFF8B5CF6.toInt(),
            Shader.TileMode.CLAMP,
        )
        canvas.drawRoundRect(cardRect, 20f * dp, 20f * dp, emblemFillPaint)

        emblemStrokePaint.strokeWidth = 2f * dp
        emblemStrokePaint.color = 0xAA67E8F9.toInt()
        canvas.drawRoundRect(cardRect, 20f * dp, 20f * dp, emblemStrokePaint)

        // Inner Live Play Triangle
        val triR = half * 0.42f
        playPath.reset()
        playPath.moveTo(cx - triR * 0.45f, cy - triR * 0.65f)
        playPath.lineTo(cx + triR * 0.78f, cy)
        playPath.lineTo(cx - triR * 0.45f, cy + triR * 0.65f)
        playPath.close()
        particlePaint.color = Color.WHITE
        canvas.drawPath(playPath, particlePaint)

        // 6. Sound Wave Ribbon beneath emblem
        val waveY = cy + half + 32f * dp
        val waveWidth = min(w * 0.72f, 280f * dp)
        val waveAlpha = (min(1f, (progress - 0.15f).coerceAtLeast(0f) / 0.25f) * 210f).toInt().coerceIn(0, 255)
        wavePaint.strokeWidth = 2.2f * dp
        wavePaint.shader = LinearGradient(
            cx - waveWidth * 0.5f,
            waveY,
            cx + waveWidth * 0.5f,
            waveY,
            intArrayOf(
                Color.argb(waveAlpha, 6, 182, 212),
                Color.argb(waveAlpha, 59, 130, 246),
                Color.argb(waveAlpha, 236, 72, 153),
            ),
            null,
            Shader.TileMode.CLAMP,
        )
        wavePath.reset()
        val steps = 48
        for (i in 0..steps) {
            val t = i.toFloat() / steps
            val x = cx - waveWidth * 0.5f + t * waveWidth
            val env = sin(t * PI).toFloat()
            val y = waveY + sin((t * 14f - progress * 18f)) * 10f * dp * env
            if (i == 0) wavePath.moveTo(x, y) else wavePath.lineTo(x, y)
        }
        canvas.drawPath(wavePath, wavePaint)

        // 7. Animated Title Reveal
        val textProgress = ((progress - 0.24f) / 0.35f).coerceIn(0f, 1f)
        val textAlpha = (textProgress * 255f).toInt()
        val slideOffset = (1f - textProgress) * 18f * dp

        titlePaint.textSize = 27f * dp
        titlePaint.color = Color.argb(textAlpha, 248, 250, 252)
        titlePaint.setShadowLayer(12f * dp, 0f, 0f, Color.argb((textAlpha * 0.5f).toInt(), 59, 130, 246))
        val titleY = waveY + 46f * dp + slideOffset
        canvas.drawText("LIVECAST STUDIO", cx, titleY, titlePaint)

        val subProgress = ((progress - 0.38f) / 0.32f).coerceIn(0f, 1f)
        subtitlePaint.textSize = 11.5f * dp
        subtitlePaint.color = Color.argb((subProgress * 220f).toInt(), 103, 232, 249)
        canvas.drawText("TV BROADCAST CONTROL ROOM", cx, titleY + 24f * dp, subtitlePaint)
    }
}
