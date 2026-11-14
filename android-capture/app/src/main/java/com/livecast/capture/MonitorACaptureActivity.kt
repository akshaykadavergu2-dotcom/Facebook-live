package com.livecast.capture

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.livecast.capture.databinding.ActivityMonitorACaptureBinding
import kotlinx.coroutines.launch

/**
 * Dedicated distraction-free Monitor A capture surface.
 * Because standard Android MediaProjection captures a full display task window and cannot
 * isolate an individual HTML element inside Chrome, MonitorACaptureActivity renders ONLY the
 * official YouTube IFrame Player API stage with zero browser URL bar or studio UI chrome.
 */
class MonitorACaptureActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_YOUTUBE_URL = "extra_youtube_url"
    }

    private lateinit var binding: ActivityMonitorACaptureBinding

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMonitorACaptureBinding.inflate(layoutInflater)
        setContentView(binding.root)
        enterImmersiveFullscreen()

        lifecycleScope.launch {
            CaptureForegroundService.uiState.collect { state ->
                if (state.connectionStatus == ConnectionCaptureStatus.Stopped && !isFinishing) {
                    finish()
                }
            }
        }

        val youtubeUrl = intent.getStringExtra(EXTRA_YOUTUBE_URL).orEmpty()
        val videoId = IngestProtocol.extractYouTubeVideoId(youtubeUrl)

        val webView = binding.monitorAWebView
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            useWideViewPort = true
            loadWithOverviewMode = true
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        }
        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString().orEmpty()
                return !(url.startsWith("https://www.youtube.com") ||
                    url.startsWith("https://www.youtube-nocookie.com") ||
                    url.startsWith("https://youtu.be"))
            }
        }

        if (videoId != null) {
            val html = buildYouTubeStageHtml(videoId)
            webView.loadDataWithBaseURL(
                "https://www.youtube.com",
                html,
                "text/html",
                "utf-8",
                null,
            )
        } else {
            val standbyHtml = """
                <!DOCTYPE html>
                <html>
                <body style="margin:0;background:#000;color:#94a3b8;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;">
                  <div>
                    <div style="font-size:18px;font-weight:700;color:#f1f5f9;">MONITOR A · YOUTUBE CAPTURE STAGE</div>
                    <div style="font-size:13px;margin-top:8px;">Enter a valid YouTube Live or Video URL in Livecast Capture before starting.</div>
                  </div>
                </body>
                </html>
            """.trimIndent()
            webView.loadDataWithBaseURL(null, standbyHtml, "text/html", "utf-8", null)
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                startService(
                    Intent(this@MonitorACaptureActivity, CaptureForegroundService::class.java).apply {
                        action = CaptureForegroundService.ACTION_STOP_CAPTURE
                    },
                )
                finish()
            }
        })
    }

    private fun buildYouTubeStageHtml(videoId: String): String {
        val safeId = videoId.replace(Regex("[^A-Za-z0-9_-]"), "")
        return """
            <!DOCTYPE html>
            <html>
            <head>
              <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
              <style>
                html, body {
                  margin: 0;
                  padding: 0;
                  width: 100%;
                  height: 100%;
                  background: #000000;
                  overflow: hidden;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                }
                #stage {
                  width: 100vw;
                  height: 56.25vw;
                  max-height: 100vh;
                  max-width: 177.78vh;
                  background: #000000;
                }
                iframe {
                  width: 100%;
                  height: 100%;
                  border: 0;
                }
              </style>
            </head>
            <body>
              <div id="stage">
                <iframe
                  id="ytplayer"
                  src="https://www.youtube.com/embed/$safeId?autoplay=1&playsinline=1&rel=0&modestbranding=1&enablejsapi=1"
                  allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                  allowfullscreen>
                </iframe>
              </div>
            </body>
            </html>
        """.trimIndent()
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
        binding.monitorAWebView.apply {
            loadUrl("about:blank")
            destroy()
        }
        super.onDestroy()
    }
}
