package com.livecast.capture

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.livecast.capture.databinding.ActivityMonitorACaptureBinding
import kotlinx.coroutines.launch

/**
 * Dedicated Monitor A capture stage.
 * Renders the YouTube preview via YouTubePlayerHelper (preventing Error 152-4/153)
 * with clean Play/Pause, Mute/Unmute, Reload, Open in YouTube, and Stop Capture controls,
 * and zero studio dashboard chrome or browser URL bar.
 */
class MonitorACaptureActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_YOUTUBE_URL = "extra_youtube_url"
        const val EXTRA_PREVIEW_ONLY = "extra_preview_only"
    }

    private lateinit var binding: ActivityMonitorACaptureBinding
    private lateinit var playerHelper: YouTubePlayerHelper
    private var isPlaying = true
    private var isMuted = false
    private var isPreviewOnly = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMonitorACaptureBinding.inflate(layoutInflater)
        setContentView(binding.root)
        enterImmersiveFullscreen()

        isPreviewOnly = intent.getBooleanExtra(EXTRA_PREVIEW_ONLY, false)
        if (isPreviewOnly) {
            binding.btnMonitorStopCapture.text = "Exit Fullscreen"
        }

        var sawActiveOrConnecting = false
        lifecycleScope.launch {
            CaptureForegroundService.uiState.collect { state ->
                if (!isPreviewOnly) {
                    if (state.connectionStatus != ConnectionCaptureStatus.Stopped) {
                        sawActiveOrConnecting = true
                    } else if (sawActiveOrConnecting && !isFinishing) {
                        finish()
                    }
                }
            }
        }

        playerHelper = YouTubePlayerHelper(
            binding.monitorAWebView,
            object : YouTubePlayerHelper.Listener {
                override fun onPlayerStateChanged(statusText: String, playing: Boolean) {
                    isPlaying = playing
                    binding.tvMonitorAState.text = statusText
                    binding.btnMonitorPlayPause.text = if (playing) "Pause" else "Play"
                }

                override fun onPlayerError(code: Int, readableMessage: String) {
                    binding.monitorAErrorBanner.visibility = View.VISIBLE
                    binding.tvMonitorAError.text = readableMessage
                }

                override fun onMutedChanged(muted: Boolean) {
                    isMuted = muted
                    binding.btnMonitorMute.text = if (muted) "Unmute" else "Mute"
                }
            },
        )
        playerHelper.configure()

        val youtubeUrl = intent.getStringExtra(EXTRA_YOUTUBE_URL).orEmpty()
        val videoId = IngestProtocol.extractYouTubeVideoId(youtubeUrl)
        if (videoId != null) {
            binding.monitorAErrorBanner.visibility = View.GONE
            playerHelper.loadVideo(videoId, autoplay = true)
        } else {
            playerHelper.loadStandby(
                "MONITOR A · YOUTUBE CAPTURE STAGE",
                "Paste a valid YouTube Live, watch, or youtu.be URL in LIVECAST STUDIO before starting capture.",
            )
        }

        binding.btnMonitorClearError.setOnClickListener {
            binding.monitorAErrorBanner.visibility = View.GONE
        }

        binding.btnMonitorPlayPause.setOnClickListener {
            if (isPlaying) playerHelper.pause() else playerHelper.play()
        }

        binding.btnMonitorMute.setOnClickListener {
            playerHelper.toggleMute()
        }

        binding.btnMonitorReload.setOnClickListener {
            binding.monitorAErrorBanner.visibility = View.GONE
            playerHelper.reload(autoplay = true)
        }

        binding.btnMonitorOpenYt.setOnClickListener {
            val watchUrl = playerHelper.getCurrentWatchUrl()
                ?: youtubeUrl.ifBlank { "https://www.youtube.com" }
            try {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(watchUrl)))
            } catch (_: Exception) {
            }
        }

        binding.btnMonitorStopCapture.setOnClickListener {
            if (isPreviewOnly) {
                finish()
            } else {
                stopCaptureAndFinish()
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (isPreviewOnly) {
                    finish()
                } else {
                    stopCaptureAndFinish()
                }
            }
        })
    }

    private fun stopCaptureAndFinish() {
        startService(
            Intent(this, CaptureForegroundService::class.java).apply {
                action = CaptureForegroundService.ACTION_STOP_CAPTURE
            },
        )
        finish()
    }

    private fun enterImmersiveFullscreen() {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
            window.insetsController?.let { controller ->
                controller.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                controller.systemBarsBehavior =
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                    View.SYSTEM_UI_FLAG_FULLSCREEN or
                    View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                    View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                    View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                )
        }
    }

    override fun onDestroy() {
        playerHelper.destroy()
        super.onDestroy()
    }
}
