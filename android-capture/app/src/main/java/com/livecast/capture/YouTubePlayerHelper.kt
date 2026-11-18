package com.livecast.capture

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * Shared YouTube IFrame Player API WebView controller that prevents Error 152-4 / 153
 * by loading from an authorized HTTPS origin, preserving Referrer-Policy: strict-origin-when-cross-origin,
 * enabling third-party cookies required by YouTube player sessions, and providing real JS bridge events.
 */
class YouTubePlayerHelper(
    private val webView: WebView,
    private val listener: Listener,
) {
    interface Listener {
        fun onPlayerStateChanged(statusText: String, isPlaying: Boolean)
        fun onPlayerError(code: Int, readableMessage: String)
        fun onMutedChanged(muted: Boolean)
        fun onAutoplayBlocked() {}
    }

    companion object {
        private const val TRUSTED_EMBED_ORIGIN = "https://streamkarolive.netlify.app"
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private var currentVideoId: String? = null
    private var isMutedState = false

    @SuppressLint("SetJavaScriptEnabled")
    fun configure() {
        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setAcceptThirdPartyCookies(webView, true)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            useWideViewPort = true
            loadWithOverviewMode = true
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            cacheMode = WebSettings.LOAD_DEFAULT
        }

        webView.addJavascriptInterface(YtBridge(), "LivecastYtBridge")
        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString().orEmpty()
                val isYouTubeFrame =
                    url.startsWith("https://www.youtube.com") ||
                        url.startsWith("https://www.youtube-nocookie.com") ||
                        url.startsWith("https://accounts.google.com") ||
                        url.startsWith(TRUSTED_EMBED_ORIGIN)
                if (isYouTubeFrame) return false

                if (url.startsWith("http://") || url.startsWith("https://")) {
                    try {
                        webView.context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                    } catch (_: Exception) {
                    }
                    return true
                }
                return false
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?,
            ) {
                if (request?.isForMainFrame == true) {
                    listener.onPlayerError(
                        error?.errorCode ?: -1,
                        "Network error loading YouTube preview (${error?.description ?: "offline"}).",
                    )
                }
            }
        }
    }

    fun loadVideo(videoId: String, autoplay: Boolean) {
        currentVideoId = videoId
        listener.onPlayerStateChanged("Loading...", false)
        val safeId = videoId.replace(Regex("[^A-Za-z0-9_-]"), "")
        val html = buildIframeApiHtml(safeId, autoplay)
        webView.loadDataWithBaseURL(
            "$TRUSTED_EMBED_ORIGIN/",
            html,
            "text/html",
            "utf-8",
            null,
        )
    }

    fun loadStandby(title: String, subtitle: String) {
        currentVideoId = null
        listener.onPlayerStateChanged("Idle", false)
        val html = """
            <!DOCTYPE html>
            <html>
            <body style="margin:0;background:#04060E;color:#94A3B8;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;padding:16px;box-sizing:border-box;">
              <div>
                <div style="font-size:15px;font-weight:700;color:#F8FAFC;letter-spacing:0.5px;">$title</div>
                <div style="font-size:12px;margin-top:8px;color:#94A3B8;">$subtitle</div>
              </div>
            </body>
            </html>
        """.trimIndent()
        webView.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
    }

    fun reload(autoplay: Boolean) {
        val vid = currentVideoId ?: return
        loadVideo(vid, autoplay)
    }

    fun play() {
        webView.evaluateJavascript("window.lcPlay && window.lcPlay();", null)
    }

    fun pause() {
        webView.evaluateJavascript("window.lcPause && window.lcPause();", null)
    }

    fun setMuted(muted: Boolean) {
        isMutedState = muted
        webView.evaluateJavascript("window.lcSetMuted && window.lcSetMuted(${if (muted) "true" else "false"});", null)
        listener.onMutedChanged(muted)
    }

    fun toggleMute(): Boolean {
        val next = !isMutedState
        setMuted(next)
        return next
    }

    fun getCurrentWatchUrl(): String? = currentVideoId?.let { "https://www.youtube.com/watch?v=$it" }

    fun destroy() {
        webView.loadUrl("about:blank")
        webView.destroy()
    }

    private fun buildIframeApiHtml(videoId: String, autoplay: Boolean): String {
        val autoVal = if (autoplay) 1 else 0
        return """
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8" />
              <meta name="referrer" content="strict-origin-when-cross-origin" />
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
                #player, iframe {
                  width: 100%;
                  height: 100%;
                  border: 0;
                }
              </style>
            </head>
            <body>
              <div id="stage"><div id="player"></div></div>
              <script src="https://www.youtube.com/iframe_api"></script>
              <script>
                var ytPlayer = null;
                function applyReferrerPolicy() {
                  var f = document.querySelector('#stage iframe');
                  if (f) {
                    f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
                  }
                }
                function onYouTubeIframeAPIReady() {
                  ytPlayer = new YT.Player('player', {
                    videoId: '$videoId',
                    host: 'https://www.youtube.com',
                    playerVars: {
                      autoplay: $autoVal,
                      controls: 1,
                      enablejsapi: 1,
                      playsinline: 1,
                      rel: 0,
                      modestbranding: 1,
                      origin: '$TRUSTED_EMBED_ORIGIN',
                      widget_referrer: '$TRUSTED_EMBED_ORIGIN/'
                    },
                    events: {
                      onReady: function(e) {
                        applyReferrerPolicy();
                        if ($autoVal === 1) {
                          try { e.target.playVideo(); } catch (_) {}
                        }
                        if (window.LivecastYtBridge) {
                          window.LivecastYtBridge.onReady(!!(e.target.isMuted && e.target.isMuted()));
                        }
                      },
                      onStateChange: function(e) {
                        applyReferrerPolicy();
                        if (window.LivecastYtBridge) {
                          window.LivecastYtBridge.onStateChange(e.data);
                        }
                      },
                      onError: function(e) {
                        if (window.LivecastYtBridge) {
                          window.LivecastYtBridge.onError(e.data);
                        }
                      },
                      onAutoplayBlocked: function() {
                        if (window.LivecastYtBridge) {
                          window.LivecastYtBridge.onAutoplayBlocked();
                        }
                      }
                    }
                  });
                  setTimeout(applyReferrerPolicy, 100);
                }
                window.lcPlay = function() {
                  if (ytPlayer && ytPlayer.playVideo) { ytPlayer.playVideo(); }
                };
                window.lcPause = function() {
                  if (ytPlayer && ytPlayer.pauseVideo) { ytPlayer.pauseVideo(); }
                };
                window.lcSetMuted = function(muted) {
                  if (!ytPlayer) return;
                  if (muted && ytPlayer.mute) { ytPlayer.mute(); }
                  if (!muted && ytPlayer.unMute) { ytPlayer.unMute(); }
                  if (window.LivecastYtBridge) { window.LivecastYtBridge.onMuted(!!muted); }
                };
              </script>
            </body>
            </html>
        """.trimIndent()
    }

    private inner class YtBridge {
        @JavascriptInterface
        fun onReady(muted: Boolean) {
            mainHandler.post {
                isMutedState = muted
                listener.onMutedChanged(muted)
                listener.onPlayerStateChanged("Ready", false)
            }
        }

        @JavascriptInterface
        fun onStateChange(code: Int) {
            mainHandler.post {
                val (label, playing) = when (code) {
                    1 -> "Playing" to true
                    2 -> "Paused" to false
                    // Buffering is still an active playback request. Keep the
                    // control in the Pause state so a second tap doesn't issue
                    // another playVideo() call while YouTube is buffering.
                    3 -> "Buffering" to true
                    0 -> "Ended" to false
                    5 -> "Ready" to false
                    else -> "Ready" to false
                }
                listener.onPlayerStateChanged(label, playing)
            }
        }

        @JavascriptInterface
        fun onMuted(muted: Boolean) {
            mainHandler.post {
                isMutedState = muted
                listener.onMutedChanged(muted)
            }
        }

        @JavascriptInterface
        fun onAutoplayBlocked() {
            mainHandler.post {
                listener.onAutoplayBlocked()
                listener.onPlayerStateChanged("Tap Play in the YouTube player", false)
            }
        }

        @JavascriptInterface
        fun onError(code: Int) {
            mainHandler.post {
                val msg = when (code) {
                    2 -> "Invalid YouTube video ID or request parameter (Error 2)."
                    5 -> "HTML5 player error inside Android WebView (Error 5). Tap Reload Preview."
                    100 -> "Video removed, private, or not found (Error 100)."
                    101, 150 -> "The video owner disabled embedded playback (Error $code). Tap Open in YouTube or load an embeddable stream."
                    153 -> "YouTube blocked this embed because the request is missing its HTTP Referer or app identity (Error 153). Reload the player from the app's HTTPS base URL, or open in YouTube."
                    152 -> "YouTube returned player error 152. This is an embed/player restriction; retry once or open the video in YouTube."
                    else -> "YouTube player error code $code."
                }
                listener.onPlayerStateChanged("Error $code", false)
                listener.onPlayerError(code, msg)
            }
        }
    }
}
