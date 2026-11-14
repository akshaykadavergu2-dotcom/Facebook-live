package com.livecast.capture

import android.Manifest
import android.animation.ObjectAnimator
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.text.method.HideReturnsTransformationMethod
import android.text.method.PasswordTransformationMethod
import android.view.View
import android.view.animation.DecelerateInterpolator
import android.widget.Button
import android.widget.ImageView
import android.widget.SeekBar
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.livecast.capture.databinding.ActivityMainBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : AppCompatActivity() {

    private enum class StudioTab(val index: Int) {
        HOME(0),
        STUDIO(1),
        PREVIEW(2),
        RECORDING(3),
        MIXER(4),
        OUTPUT(5),
        SETTINGS(6),
    }

    private lateinit var binding: ActivityMainBinding
    private lateinit var credStore: SecureCredentialStore
    private lateinit var previewPlayer: YouTubePlayerHelper
    private val api = BackendApiClient()

    private var activeTab = StudioTab.HOME
    private var selectedDestinationMode = DestinationMode.FACEBOOK
    private var selectedQuality = VideoQualityPreset.HD_720P
    private var selectedFps = 30
    private var selectedRecQuality = VideoQualityPreset.HD_720P
    private var selectedRecFps = 30
    private var pendingRecordMp4 = false
    private var selectedSourceType = "android-capture"
    private var overlayState = OverlayStudioState()
    private var latestBroadcast = BroadcastTelemetry()
    private val recentLogs = ArrayDeque<String>(24)

    private var previewPlaying = false
    private var previewMuted = false
    private var fbKeyVisible = false
    private var ytKeyVisible = false
    private var pendingUploadTarget = "logo"

    private val projectionLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK && result.data != null) {
            launchCaptureService(result.resultCode, result.data!!)
        } else {
            showGlobalError("Screen capture permission denied by Android user prompt.")
        }
    }

    private val capturePermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) {
        requestScreenCapturePermission()
    }

    private val micPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        CaptureForegroundService.updateMixerConfig {
            it.copy(micPermissionGranted = granted, micEnabled = granted)
        }
        if (!granted) {
            showGlobalError("Microphone permission was denied. Enable RECORD_AUDIO in Android Settings to broadcast mic voice.")
        }
    }

    private val pngPickerLauncher = registerForActivityResult(
        ActivityResultContracts.GetContent(),
    ) { uri: Uri? ->
        if (uri != null) {
            uploadSelectedPng(uri, pendingUploadTarget)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        credStore = SecureCredentialStore(this)
        binding.tabSettings.etBackendUrl.setText(credStore.getBackendUrl())
        binding.tabSettings.etFbServerUrl.setText(credStore.getFacebookServerUrl())
        binding.tabSettings.etYtServerUrl.setText(credStore.getYoutubeServerUrl())

        setupBottomNav()
        setupHomeTab()
        setupStudioTab()
        setupPreviewTab()
        setupRecordingTab()
        setupMixerTab()
        setupOutputTab()
        setupSettingsTab()

        applyDeepLinkIntent(intent)
        observeFlows()
        syncAllWithBackend()
        connectLiveTelemetrySocket()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        applyDeepLinkIntent(intent)
    }

    override fun onDestroy() {
        api.disconnectLiveTelemetrySocket()
        previewPlayer.destroy()
        super.onDestroy()
    }

    private fun currentBackendUrl(): String {
        val typed = binding.tabSettings.etBackendUrl.text.toString().trim().trimEnd('/')
        return typed.ifBlank { credStore.getBackendUrl() }
    }

    private fun showGlobalError(message: String?) {
        if (message.isNullOrBlank()) {
            binding.tvGlobalErrorBanner.visibility = View.GONE
        } else {
            binding.tvGlobalErrorBanner.visibility = View.VISIBLE
            binding.tvGlobalErrorBanner.text = message
        }
    }

    // =========================================================================
    // 7-Tab Custom Animated Bottom Navigation
    // =========================================================================

    private fun setupBottomNav() {
        val navViews = listOf(
            binding.navHome to StudioTab.HOME,
            binding.navStudio to StudioTab.STUDIO,
            binding.navPreview to StudioTab.PREVIEW,
            binding.navRecording to StudioTab.RECORDING,
            binding.navMixer to StudioTab.MIXER,
            binding.navOutput to StudioTab.OUTPUT,
            binding.navSettings to StudioTab.SETTINGS,
        )
        for ((view, tab) in navViews) {
            view.setOnClickListener { switchTab(tab) }
        }
        binding.bottomNavContainer.post {
            updateBottomNavVisuals(animate = false)
        }
    }

    private fun switchTab(tab: StudioTab) {
        activeTab = tab
        binding.tabHome.root.visibility = if (tab == StudioTab.HOME) View.VISIBLE else View.GONE
        binding.tabStudio.root.visibility = if (tab == StudioTab.STUDIO) View.VISIBLE else View.GONE
        binding.tabPreview.root.visibility = if (tab == StudioTab.PREVIEW) View.VISIBLE else View.GONE
        binding.tabRecording.root.visibility = if (tab == StudioTab.RECORDING) View.VISIBLE else View.GONE
        binding.tabMixer.root.visibility = if (tab == StudioTab.MIXER) View.VISIBLE else View.GONE
        binding.tabOutput.root.visibility = if (tab == StudioTab.OUTPUT) View.VISIBLE else View.GONE
        binding.tabSettings.root.visibility = if (tab == StudioTab.SETTINGS) View.VISIBLE else View.GONE
        updateBottomNavVisuals(animate = true)
    }

    private fun updateBottomNavVisuals(animate: Boolean) {
        val containerW = binding.bottomNavContainer.width -
            binding.bottomNavContainer.paddingStart -
            binding.bottomNavContainer.paddingEnd
        if (containerW > 0) {
            val slotW = containerW / 7f
            val lp = binding.navActivePill.layoutParams
            val targetW = slotW.toInt().coerceAtLeast(42)
            if (lp.width != targetW) {
                lp.width = targetW
                binding.navActivePill.layoutParams = lp
            }
            val targetX = activeTab.index * slotW
            if (animate) {
                ObjectAnimator.ofFloat(binding.navActivePill, View.TRANSLATION_X, targetX).apply {
                    duration = 220L
                    interpolator = DecelerateInterpolator()
                    start()
                }
            } else {
                binding.navActivePill.translationX = targetX
            }
        }

        val items: List<Triple<StudioTab, ImageView, TextView>> = listOf(
            Triple(StudioTab.HOME, binding.ivNavHome, binding.tvNavHome),
            Triple(StudioTab.STUDIO, binding.ivNavStudio, binding.tvNavStudio),
            Triple(StudioTab.PREVIEW, binding.ivNavPreview, binding.tvNavPreview),
            Triple(StudioTab.RECORDING, binding.ivNavRecording, binding.tvNavRecording),
            Triple(StudioTab.MIXER, binding.ivNavMixer, binding.tvNavMixer),
            Triple(StudioTab.OUTPUT, binding.ivNavOutput, binding.tvNavOutput),
            Triple(StudioTab.SETTINGS, binding.ivNavSettings, binding.tvNavSettings),
        )
        val activeColor = ContextCompat.getColor(this, R.color.studio_cyan)
        val mutedColor = ContextCompat.getColor(this, R.color.studio_text_muted)
        for ((tab, icon, label) in items) {
            val selected = tab == activeTab
            icon.setColorFilter(if (selected) activeColor else mutedColor)
            icon.animate().scaleX(if (selected) 1.12f else 1.0f).scaleY(if (selected) 1.12f else 1.0f).setDuration(160L).start()
            label.setTextColor(if (selected) activeColor else mutedColor)
        }
    }

    // =========================================================================
    // Tab 1: Home Control Deck
    // =========================================================================

    private fun setupHomeTab() {
        val h = binding.tabHome
        h.btnHomeOpenPreview.setOnClickListener { switchTab(StudioTab.PREVIEW) }
        h.btnHomeGoStudio.setOnClickListener { switchTab(StudioTab.STUDIO) }
        h.btnHomeGoMixer.setOnClickListener { switchTab(StudioTab.MIXER) }
        h.btnHomeGoOutput.setOnClickListener { switchTab(StudioTab.OUTPUT) }
        h.btnHomeQuickGoLive.setOnClickListener { triggerStartBroadcast() }
        h.btnHomeStopAll.setOnClickListener { stopCaptureAndBroadcast() }
        h.btnHomeRefreshStatus.setOnClickListener { syncAllWithBackend() }
    }

    // =========================================================================
    // Tab 2: Overlay Studio
    // =========================================================================

    private fun setupStudioTab() {
        val s = binding.tabStudio

        fun selectDragTarget(target: DraggableOverlayCanvasView.DragTarget) {
            s.overlayPreviewCanvas.setActiveDragTarget(target)
            styleChip(s.btnDragTargetText, target == DraggableOverlayCanvasView.DragTarget.CUSTOM_TEXT)
            styleChip(s.btnDragTargetImage, target == DraggableOverlayCanvasView.DragTarget.IMAGE_OVERLAY)
            styleChip(s.btnDragTargetLogo, target == DraggableOverlayCanvasView.DragTarget.LOGO)
            styleChip(s.btnDragTargetClock, target == DraggableOverlayCanvasView.DragTarget.CLOCK)
            styleChip(s.btnDragTargetLowerThird, target == DraggableOverlayCanvasView.DragTarget.LOWER_THIRD)
        }

        s.btnDragTargetText.setOnClickListener { selectDragTarget(DraggableOverlayCanvasView.DragTarget.CUSTOM_TEXT) }
        s.btnDragTargetImage.setOnClickListener { selectDragTarget(DraggableOverlayCanvasView.DragTarget.IMAGE_OVERLAY) }
        s.btnDragTargetLogo.setOnClickListener { selectDragTarget(DraggableOverlayCanvasView.DragTarget.LOGO) }
        s.btnDragTargetClock.setOnClickListener { selectDragTarget(DraggableOverlayCanvasView.DragTarget.CLOCK) }
        s.btnDragTargetLowerThird.setOnClickListener { selectDragTarget(DraggableOverlayCanvasView.DragTarget.LOWER_THIRD) }

        s.overlayPreviewCanvas.setOnPositionChangedListener { target, xPct, yPct ->
            overlayState = when (target) {
                DraggableOverlayCanvasView.DragTarget.CUSTOM_TEXT -> overlayState.copy(customTextX = xPct, customTextY = yPct)
                DraggableOverlayCanvasView.DragTarget.IMAGE_OVERLAY -> overlayState.copy(imageOverlayX = xPct, imageOverlayY = yPct)
                DraggableOverlayCanvasView.DragTarget.LOGO -> overlayState.copy(logoX = xPct, logoY = yPct)
                DraggableOverlayCanvasView.DragTarget.CLOCK -> overlayState.copy(clockX = xPct, clockY = yPct)
                DraggableOverlayCanvasView.DragTarget.LOWER_THIRD -> overlayState.copy(lowerThirdX = xPct, lowerThirdY = yPct)
            }
            s.tvStudioOverlayStatus.text = "${target.label} positioned at (${xPct.toInt()}%, ${yPct.toInt()}%). Tap Apply Live."
        }

        fun setAlign(align: String) {
            overlayState = overlayState.copy(customTextAlign = align)
            styleChip(s.btnAlignLeft, align == "left")
            styleChip(s.btnAlignCenter, align == "center")
            styleChip(s.btnAlignRight, align == "right")
            pushDraftOverlaysToCanvas()
        }

        s.btnAlignLeft.setOnClickListener { setAlign("left") }
        s.btnAlignCenter.setOnClickListener { setAlign("center") }
        s.btnAlignRight.setOnClickListener { setAlign("right") }

        s.swLogoEnabled.setOnCheckedChangeListener { _, _ -> pushDraftOverlaysToCanvas() }
        s.swImageOverlayEnabled.setOnCheckedChangeListener { _, _ -> pushDraftOverlaysToCanvas() }
        s.swCustomTextEnabled.setOnCheckedChangeListener { _, _ -> pushDraftOverlaysToCanvas() }
        s.swClockEnabled.setOnCheckedChangeListener { _, _ -> pushDraftOverlaysToCanvas() }
        s.swHeadlineEnabled.setOnCheckedChangeListener { _, _ -> pushDraftOverlaysToCanvas() }
        s.swBreakingNewsEnabled.setOnCheckedChangeListener { _, _ -> pushDraftOverlaysToCanvas() }
        s.swLowerThirdEnabled.setOnCheckedChangeListener { _, _ -> pushDraftOverlaysToCanvas() }
        s.swTickerEnabled.setOnCheckedChangeListener { _, _ -> pushDraftOverlaysToCanvas() }

        val simpleSeek = object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(sb: SeekBar?, progress: Int, fromUser: Boolean) {
                if (fromUser) pushDraftOverlaysToCanvas()
            }
            override fun onStartTrackingTouch(sb: SeekBar?) {}
            override fun onStopTrackingTouch(sb: SeekBar?) {}
        }
        s.seekLogoScale.setOnSeekBarChangeListener(simpleSeek)
        s.seekImageScale.setOnSeekBarChangeListener(simpleSeek)
        s.seekCustomTextSize.setOnSeekBarChangeListener(simpleSeek)

        s.btnUploadLogo.setOnClickListener {
            pendingUploadTarget = "logo"
            pngPickerLauncher.launch("image/png")
        }
        s.btnRemoveLogo.setOnClickListener { deleteOverlayAsset("/api/overlays/logo") }

        s.btnUploadImageOverlay.setOnClickListener {
            pendingUploadTarget = "image"
            pngPickerLauncher.launch("image/png")
        }
        s.btnRemoveImageOverlay.setOnClickListener { deleteOverlayAsset("/api/overlays/image") }

        s.btnStudioSaveOverlays.setOnClickListener {
            val draft = readDraftOverlaysFromInputs()
            overlayState = draft
            s.overlayPreviewCanvas.setOverlayState(draft)
            s.tvStudioOverlayStatus.text = "Saving overlay layout to backend..."
            lifecycleScope.launch {
                try {
                    val saved = api.saveOverlays(currentBackendUrl(), draft)
                    overlayState = saved
                    bindOverlayStateToUi(saved)
                    s.tvStudioOverlayStatus.text = "Overlays synced live with FFmpeg compositor."
                    showGlobalError(null)
                } catch (err: Exception) {
                    s.tvStudioOverlayStatus.text = "Overlay save failed: ${err.message}"
                    showGlobalError("Overlay sync failed: ${err.message}")
                }
            }
        }
    }

    private fun readDraftOverlaysFromInputs(): OverlayStudioState {
        val s = binding.tabStudio
        return overlayState.copy(
            logoEnabled = s.swLogoEnabled.isChecked,
            logoScale = s.seekLogoScale.progress.coerceIn(5, 35),
            imageOverlayEnabled = s.swImageOverlayEnabled.isChecked,
            imageOverlayScale = s.seekImageScale.progress.coerceIn(5, 50),
            customTextEnabled = s.swCustomTextEnabled.isChecked,
            customText = s.etCustomText.text.toString().ifBlank { "LIVE BROADCAST" },
            customTextFontSize = s.seekCustomTextSize.progress.coerceIn(14, 64),
            clockEnabled = s.swClockEnabled.isChecked,
            headlineEnabled = s.swHeadlineEnabled.isChecked,
            headlineText = s.etHeadlineText.text.toString().ifBlank { "LIVE STUDIO BROADCAST" },
            breakingNewsEnabled = s.swBreakingNewsEnabled.isChecked,
            breakingNewsText = s.etBreakingNewsText.text.toString().ifBlank { "Live studio coverage in progress." },
            lowerThirdEnabled = s.swLowerThirdEnabled.isChecked,
            lowerThirdTitle = s.etLowerThirdTitle.text.toString().ifBlank { "LIVECAST STUDIO" },
            lowerThirdSubtitle = s.etLowerThirdSubtitle.text.toString().ifBlank { "Authorized Live Broadcast Feed" },
            tickerEnabled = s.swTickerEnabled.isChecked,
            tickerText = s.etTickerText.text.toString().ifBlank { "Welcome to the live broadcast." },
        )
    }

    private fun pushDraftOverlaysToCanvas() {
        val draft = readDraftOverlaysFromInputs()
        overlayState = draft
        binding.tabStudio.overlayPreviewCanvas.setOverlayState(draft)
    }

    private fun bindOverlayStateToUi(st: OverlayStudioState) {
        val s = binding.tabStudio
        s.swLogoEnabled.isChecked = st.logoEnabled
        s.seekLogoScale.progress = st.logoScale.coerceIn(5, 35)
        s.swImageOverlayEnabled.isChecked = st.imageOverlayEnabled
        s.seekImageScale.progress = st.imageOverlayScale.coerceIn(5, 50)
        s.swCustomTextEnabled.isChecked = st.customTextEnabled
        s.etCustomText.setText(st.customText)
        s.seekCustomTextSize.progress = st.customTextFontSize.coerceIn(14, 64)
        s.swClockEnabled.isChecked = st.clockEnabled
        s.swHeadlineEnabled.isChecked = st.headlineEnabled
        s.etHeadlineText.setText(st.headlineText)
        s.swBreakingNewsEnabled.isChecked = st.breakingNewsEnabled
        s.etBreakingNewsText.setText(st.breakingNewsText)
        s.swLowerThirdEnabled.isChecked = st.lowerThirdEnabled
        s.etLowerThirdTitle.setText(st.lowerThirdTitle)
        s.etLowerThirdSubtitle.setText(st.lowerThirdSubtitle)
        s.swTickerEnabled.isChecked = st.tickerEnabled
        s.etTickerText.setText(st.tickerText)
        styleChip(s.btnAlignLeft, st.customTextAlign == "left")
        styleChip(s.btnAlignCenter, st.customTextAlign == "center")
        styleChip(s.btnAlignRight, st.customTextAlign == "right")
        s.overlayPreviewCanvas.setOverlayState(st)

        st.logoUrl?.let { loadOverlayBitmapAsync(it, isLogo = true) } ?: s.overlayPreviewCanvas.setLogoBitmap(null)
        st.imageOverlayUrl?.let { loadOverlayBitmapAsync(it, isLogo = false) } ?: s.overlayPreviewCanvas.setImageOverlayBitmap(null)
    }

    private fun loadOverlayBitmapAsync(relativeUrl: String, isLogo: Boolean) {
        val fullUrl = if (relativeUrl.startsWith("http")) relativeUrl else "${currentBackendUrl()}$relativeUrl"
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val conn = (URL(fullUrl).openConnection() as HttpURLConnection).apply {
                    connectTimeout = 8000
                    readTimeout = 8000
                    setRequestProperty("Origin", "https://streamkarolive.netlify.app")
                }
                val bmp = conn.inputStream.use { BitmapFactory.decodeStream(it) }
                withContext(Dispatchers.Main) {
                    if (isLogo) {
                        binding.tabStudio.overlayPreviewCanvas.setLogoBitmap(bmp)
                    } else {
                        binding.tabStudio.overlayPreviewCanvas.setImageOverlayBitmap(bmp)
                    }
                }
            } catch (_: Exception) {
            }
        }
    }

    private fun uploadSelectedPng(uri: Uri, target: String) {
        val s = binding.tabStudio
        s.tvStudioOverlayStatus.text = "Uploading PNG overlay..."
        lifecycleScope.launch {
            try {
                val pngBytes = withContext(Dispatchers.IO) {
                    contentResolver.openInputStream(uri)?.use { input ->
                        val out = ByteArrayOutputStream()
                        input.copyTo(out)
                        out.toByteArray()
                    } ?: ByteArray(0)
                }
                if (pngBytes.isEmpty()) {
                    throw IllegalStateException("Unable to read selected image file.")
                }
                val endpoint = if (target == "logo") "/api/overlays/logo" else "/api/overlays/image"
                val field = if (target == "logo") "logo" else "image"
                val updated = api.uploadOverlayPng(currentBackendUrl(), endpoint, field, "$target.png", pngBytes)
                overlayState = updated
                bindOverlayStateToUi(updated)
                s.tvStudioOverlayStatus.text = "${if (target == "logo") "Logo" else "PNG Image"} uploaded and enabled."
                showGlobalError(null)
            } catch (err: Exception) {
                s.tvStudioOverlayStatus.text = "PNG upload failed: ${err.message}"
                showGlobalError("PNG overlay upload failed: ${err.message}")
            }
        }
    }

    private fun deleteOverlayAsset(endpoint: String) {
        lifecycleScope.launch {
            try {
                val updated = api.deleteOverlayPng(currentBackendUrl(), endpoint)
                overlayState = updated
                bindOverlayStateToUi(updated)
                binding.tabStudio.tvStudioOverlayStatus.text = "Overlay asset cleared."
            } catch (err: Exception) {
                showGlobalError("Failed to remove overlay image: ${err.message}")
            }
        }
    }

    // =========================================================================
    // Tab 3: Monitor A YouTube Preview + Native Capture
    // =========================================================================

    private fun setupPreviewTab() {
        val p = binding.tabPreview
        previewPlayer = YouTubePlayerHelper(
            p.previewWebView,
            object : YouTubePlayerHelper.Listener {
                override fun onPlayerStateChanged(statusText: String, isPlaying: Boolean) {
                    previewPlaying = isPlaying
                    p.tvPreviewPlayerState.text = statusText
                    p.btnPreviewPlayPause.text = if (isPlaying) "Pause" else "Play"
                }

                override fun onPlayerError(code: Int, readableMessage: String) {
                    p.tvPreviewErrorBanner.visibility = View.VISIBLE
                    p.tvPreviewErrorBanner.text = readableMessage
                }

                override fun onMutedChanged(muted: Boolean) {
                    previewMuted = muted
                    p.btnPreviewMute.text = if (muted) "Unmute" else "Mute"
                }
            },
        )
        previewPlayer.configure()
        previewPlayer.loadStandby(
            "NO YOUTUBE PREVIEW LOADED",
            "Paste a YouTube Live, watch?v=, or youtu.be URL above to monitor in Monitor A.",
        )

        p.btnLoadPreview.setOnClickListener { loadYouTubePreviewFromInput() }
        p.btnClearPreview.setOnClickListener {
            p.etYoutubeUrl.setText("")
            p.tvPreviewErrorBanner.visibility = View.GONE
            previewPlayer.loadStandby(
                "NO YOUTUBE PREVIEW LOADED",
                "Paste a YouTube Live, watch?v=, or youtu.be URL above to monitor in Monitor A.",
            )
        }
        p.btnPreviewPlayPause.setOnClickListener {
            if (previewPlaying) previewPlayer.pause() else previewPlayer.play()
        }
        p.btnPreviewMute.setOnClickListener { previewPlayer.toggleMute() }
        p.btnPreviewReload.setOnClickListener {
            p.tvPreviewErrorBanner.visibility = View.GONE
            previewPlayer.reload(autoplay = false)
        }
        p.btnPreviewFullscreen.setOnClickListener {
            val ytUrl = p.etYoutubeUrl.text.toString().trim()
            startActivity(
                Intent(this, MonitorACaptureActivity::class.java).apply {
                    putExtra(MonitorACaptureActivity.EXTRA_YOUTUBE_URL, ytUrl)
                    putExtra(MonitorACaptureActivity.EXTRA_PREVIEW_ONLY, true)
                },
            )
        }
        p.btnPreviewOpenYt.setOnClickListener {
            val watchUrl = previewPlayer.getCurrentWatchUrl()
                ?: p.etYoutubeUrl.text.toString().trim().ifBlank { "https://www.youtube.com" }
            try {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(watchUrl)))
            } catch (_: Exception) {
            }
        }

        p.btnStartCapture.setOnClickListener {
            pendingRecordMp4 = false
            checkPermissionsAndStartCapture()
        }
        p.btnStopCapture.setOnClickListener {
            startService(
                Intent(this, CaptureForegroundService::class.java).apply {
                    action = CaptureForegroundService.ACTION_STOP_CAPTURE
                },
            )
        }
    }

    private fun loadYouTubePreviewFromInput() {
        val p = binding.tabPreview
        val raw = p.etYoutubeUrl.text.toString().trim()
        val videoId = IngestProtocol.extractYouTubeVideoId(raw)
        if (videoId == null) {
            p.tvPreviewErrorBanner.visibility = View.VISIBLE
            p.tvPreviewErrorBanner.text = "Enter a valid YouTube Live, youtube.com/watch?v=..., or youtu.be/... link."
            return
        }
        p.tvPreviewErrorBanner.visibility = View.GONE
        previewPlayer.loadVideo(videoId, autoplay = true)
    }

    // =========================================================================
    // Tab 4: Dedicated Monitor A Screen Recording Studio
    // =========================================================================

    private fun setupRecordingTab() {
        val r = binding.tabRecording

        fun setRecRes(q: VideoQualityPreset) {
            selectedRecQuality = q
            styleChip(r.btnRecRes720p, q == VideoQualityPreset.HD_720P)
            styleChip(r.btnRecRes1080p, q == VideoQualityPreset.FHD_1080P)
        }

        fun setRecFpsVal(fps: Int) {
            selectedRecFps = fps
            styleChip(r.btnRecFps24, fps == 24)
            styleChip(r.btnRecFps30, fps == 30)
            styleChip(r.btnRecFps60, fps == 60)
        }

        r.btnRecRes720p.setOnClickListener { setRecRes(VideoQualityPreset.HD_720P) }
        r.btnRecRes1080p.setOnClickListener { setRecRes(VideoQualityPreset.FHD_1080P) }

        r.btnRecFps24.setOnClickListener { setRecFpsVal(24) }
        r.btnRecFps30.setOnClickListener { setRecFpsVal(30) }
        r.btnRecFps60.setOnClickListener { setRecFpsVal(60) }

        r.btnStartRecording.setOnClickListener {
            selectedQuality = selectedRecQuality
            selectedFps = selectedRecFps
            if (CaptureForegroundService.uiState.value.videoStatus == VideoCaptureStatus.CAPTURING) {
                startService(
                    Intent(this, CaptureForegroundService::class.java).apply {
                        action = CaptureForegroundService.ACTION_START_RECORDING
                    },
                )
                val ytUrl = binding.tabPreview.etYoutubeUrl.text.toString().trim()
                startActivity(
                    Intent(this, MonitorACaptureActivity::class.java).apply {
                        putExtra(MonitorACaptureActivity.EXTRA_YOUTUBE_URL, ytUrl)
                    },
                )
            } else {
                pendingRecordMp4 = true
                checkPermissionsAndStartCapture()
            }
        }

        r.btnPauseRecording.setOnClickListener {
            startService(
                Intent(this, CaptureForegroundService::class.java).apply {
                    action = CaptureForegroundService.ACTION_PAUSE_RECORDING
                },
            )
        }

        r.btnResumeRecording.setOnClickListener {
            startService(
                Intent(this, CaptureForegroundService::class.java).apply {
                    action = CaptureForegroundService.ACTION_RESUME_RECORDING
                },
            )
        }

        r.btnStopRecording.setOnClickListener {
            startService(
                Intent(this, CaptureForegroundService::class.java).apply {
                    action = CaptureForegroundService.ACTION_STOP_RECORDING
                },
            )
        }

        r.btnSaveRecording.setOnClickListener {
            val path = CaptureForegroundService.recordingState.value.outputFilePath
            if (path.isNullOrBlank() || !File(path).exists()) {
                showGlobalError("No recorded video available to save yet. Tap START RECORDING first.")
                return@setOnClickListener
            }
            val file = File(path)
            r.tvSavedRecordingInfo.text = "Saved MP4: ${file.name} (${file.length() / 1024} KB)"
            showGlobalError(null)
        }

        r.btnPlayRecording.setOnClickListener {
            val path = CaptureForegroundService.recordingState.value.outputFilePath
            if (path.isNullOrBlank() || !File(path).exists()) {
                showGlobalError("No saved recording found to play.")
                return@setOnClickListener
            }
            r.recordedVideoContainer.visibility = View.VISIBLE
            r.recordedVideoView.setVideoPath(path)
            r.recordedVideoView.start()
        }

        r.btnDeleteRecording.setOnClickListener {
            val path = CaptureForegroundService.recordingState.value.outputFilePath
            if (path.isNullOrBlank() || !File(path).exists()) {
                showGlobalError("No saved recording to delete.")
                return@setOnClickListener
            }
            val file = File(path)
            AlertDialog.Builder(this)
                .setTitle("Delete Recording?")
                .setMessage("Permanently delete ${file.name}?")
                .setPositiveButton("Delete") { _, _ ->
                    r.recordedVideoView.stopPlayback()
                    r.recordedVideoContainer.visibility = View.GONE
                    file.delete()
                    CaptureForegroundService.updateRecordingState {
                        RecordingUiState()
                    }
                }
                .setNegativeButton("Cancel", null)
                .show()
        }
    }

    // =========================================================================
    // Tab 4: Pro Dual-Channel Audio Mixer
    // =========================================================================

    private fun setupMixerTab() {
        val m = binding.tabMixer

        m.btnMasterMute.setOnClickListener {
            CaptureForegroundService.updateMixerConfig { it.copy(masterMuted = !it.masterMuted) }
        }
        m.seekMasterVol.setOnSeekBarChangeListener(seekListener { pct ->
            m.tvMasterVolPct.text = "$pct%"
            CaptureForegroundService.updateMixerConfig { it.copy(masterVolume = pct / 100f) }
        })

        m.swInternalEnabled.setOnCheckedChangeListener { _, checked ->
            CaptureForegroundService.updateMixerConfig { it.copy(internalEnabled = checked) }
        }
        m.btnInternalMute.setOnClickListener {
            CaptureForegroundService.updateMixerConfig { it.copy(internalMuted = !it.internalMuted) }
        }
        m.seekInternalVol.setOnSeekBarChangeListener(seekListener { pct ->
            m.tvInternalVolPct.text = "$pct%"
            CaptureForegroundService.updateMixerConfig { it.copy(internalVolume = pct / 100f) }
        })

        m.swMicEnabled.setOnCheckedChangeListener { _, checked ->
            if (checked && !hasRecordAudioPermission()) {
                m.swMicEnabled.isChecked = false
                micPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                return@setOnCheckedChangeListener
            }
            CaptureForegroundService.updateMixerConfig { it.copy(micEnabled = checked) }
        }
        m.btnMicMute.setOnClickListener {
            CaptureForegroundService.updateMixerConfig { it.copy(micMuted = !it.micMuted) }
        }
        m.seekMicVol.setOnSeekBarChangeListener(seekListener { pct ->
            m.tvMicVolPct.text = "$pct%"
            CaptureForegroundService.updateMixerConfig { it.copy(micVolume = pct / 100f) }
        })

        m.btnGrantMicPermission.setOnClickListener {
            micPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    private fun seekListener(onChange: (Int) -> Unit): SeekBar.OnSeekBarChangeListener {
        return object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(sb: SeekBar?, progress: Int, fromUser: Boolean) {
                if (fromUser) onChange(progress)
            }
            override fun onStartTrackingTouch(sb: SeekBar?) {}
            override fun onStopTrackingTouch(sb: SeekBar?) {}
        }
    }

    // =========================================================================
    // Tab 5: Program Output & Multi-Destination RTMP Control
    // =========================================================================

    private fun setupOutputTab() {
        val o = binding.tabOutput

        fun setDestMode(mode: DestinationMode) {
            selectedDestinationMode = mode
            styleChip(o.btnModeFacebook, mode == DestinationMode.FACEBOOK)
            styleChip(o.btnModeYoutube, mode == DestinationMode.YOUTUBE)
            styleChip(o.btnModeBoth, mode == DestinationMode.BOTH)
        }

        fun setQuality(q: VideoQualityPreset) {
            selectedQuality = q
            styleChip(o.btnQuality720p, q == VideoQualityPreset.HD_720P)
            styleChip(o.btnQuality1080p, q == VideoQualityPreset.FHD_1080P)
        }

        fun setFps(fps: Int) {
            selectedFps = fps
            styleChip(o.btnFps24, fps == 24)
            styleChip(o.btnFps30, fps == 30)
            styleChip(o.btnFps60, fps == 60)
        }

        fun setSource(type: String) {
            selectedSourceType = type
            styleChip(o.btnSourceCapture, type == "android-capture")
            styleChip(o.btnSourceDirectUrl, type == "direct-url")
            o.etDirectMediaUrl.visibility = if (type == "direct-url") View.VISIBLE else View.GONE
        }

        o.btnModeFacebook.setOnClickListener { setDestMode(DestinationMode.FACEBOOK) }
        o.btnModeYoutube.setOnClickListener { setDestMode(DestinationMode.YOUTUBE) }
        o.btnModeBoth.setOnClickListener { setDestMode(DestinationMode.BOTH) }

        o.btnQuality720p.setOnClickListener { setQuality(VideoQualityPreset.HD_720P) }
        o.btnQuality1080p.setOnClickListener { setQuality(VideoQualityPreset.FHD_1080P) }

        o.btnFps24.setOnClickListener { setFps(24) }
        o.btnFps30.setOnClickListener { setFps(30) }
        o.btnFps60.setOnClickListener { setFps(60) }

        o.btnSourceCapture.setOnClickListener { setSource("android-capture") }
        o.btnSourceDirectUrl.setOnClickListener { setSource("direct-url") }

        o.btnOutputStartLive.setOnClickListener { triggerStartBroadcast() }
        o.btnOutputStopLive.setOnClickListener { stopBroadcastOnly() }

        o.btnValidatePipeline.setOnClickListener {
            o.tvOutputPipelineResult.text = "Running 2-second FFmpeg pipeline dry-run..."
            lifecycleScope.launch {
                val res = api.validatePipeline(currentBackendUrl(), selectedSourceType, selectedQuality.apiValue)
                o.tvOutputPipelineResult.text = res.message
                if (!res.success) showGlobalError(res.message) else showGlobalError(null)
            }
        }

        o.btnFbConnect.setOnClickListener { controlSingleDestination("facebook", "start") }
        o.btnFbDisconnect.setOnClickListener { controlSingleDestination("facebook", "stop") }
        o.btnYtConnect.setOnClickListener { controlSingleDestination("youtube", "start") }
        o.btnYtDisconnect.setOnClickListener { controlSingleDestination("youtube", "stop") }
    }

    private fun triggerStartBroadcast() {
        val directUrl = binding.tabOutput.etDirectMediaUrl.text.toString().trim()
        binding.tabOutput.tvOutputPipelineResult.text = "Starting ${selectedDestinationMode.label} (${selectedQuality.apiValue})..."
        lifecycleScope.launch {
            try {
                val tel = api.startStream(
                    baseUrl = currentBackendUrl(),
                    sourceType = selectedSourceType,
                    quality = selectedQuality.apiValue,
                    destinationMode = selectedDestinationMode.apiValue,
                    directUrl = directUrl,
                )
                applyBroadcastTelemetry(tel)
                showGlobalError(null)
            } catch (err: Exception) {
                val msg = err.message ?: "Failed to start broadcast."
                binding.tabOutput.tvOutputPipelineResult.text = msg
                showGlobalError(msg)
            }
        }
    }

    private fun stopBroadcastOnly() {
        lifecycleScope.launch {
            try {
                val tel = api.stopStream(currentBackendUrl())
                applyBroadcastTelemetry(tel)
                showGlobalError(null)
            } catch (err: Exception) {
                showGlobalError("Stop broadcast failed: ${err.message}")
            }
        }
    }

    private fun stopCaptureAndBroadcast() {
        startService(
            Intent(this, CaptureForegroundService::class.java).apply {
                action = CaptureForegroundService.ACTION_STOP_CAPTURE
            },
        )
        stopBroadcastOnly()
    }

    private fun controlSingleDestination(dest: String, action: String) {
        lifecycleScope.launch {
            try {
                val tel = api.controlDestination(currentBackendUrl(), dest, action)
                applyBroadcastTelemetry(tel)
                showGlobalError(null)
            } catch (err: Exception) {
                showGlobalError("${dest.uppercase()} $action failed: ${err.message}")
            }
        }
    }

    // =========================================================================
    // Tab 6: Settings, Credentials Vault, & Diagnostics
    // =========================================================================

    private fun setupSettingsTab() {
        val st = binding.tabSettings

        st.btnToggleFbKey.setOnClickListener {
            fbKeyVisible = !fbKeyVisible
            st.etFbStreamKey.transformationMethod = if (fbKeyVisible) {
                HideReturnsTransformationMethod.getInstance()
            } else {
                PasswordTransformationMethod.getInstance()
            }
            st.btnToggleFbKey.text = if (fbKeyVisible) "Hide" else "Show"
        }

        st.btnToggleYtKey.setOnClickListener {
            ytKeyVisible = !ytKeyVisible
            st.etYtStreamKey.transformationMethod = if (ytKeyVisible) {
                HideReturnsTransformationMethod.getInstance()
            } else {
                PasswordTransformationMethod.getInstance()
            }
            st.btnToggleYtKey.text = if (ytKeyVisible) "Hide" else "Show"
        }

        st.btnSaveFbCreds.setOnClickListener {
            val server = st.etFbServerUrl.text.toString().trim()
            val key = st.etFbStreamKey.text.toString().trim()
            val err = IngestProtocol.validateRtmpServerUrl(server)
            if (err != null) {
                showGlobalError(err)
                return@setOnClickListener
            }
            credStore.saveFacebookCredentials(server, key.ifBlank { null })
            lifecycleScope.launch {
                try {
                    val saved = api.saveDestinationCredentials(currentBackendUrl(), "facebook", server, key.ifBlank { null })
                    st.tvFbMaskedKey.text = saved.maskedStreamKey
                    st.etFbStreamKey.setText("")
                    showGlobalError(null)
                } catch (e: Exception) {
                    showGlobalError("Facebook key save failed: ${e.message}")
                }
            }
        }

        st.btnClearFbKey.setOnClickListener {
            credStore.clearFacebookStreamKey()
            lifecycleScope.launch {
                try {
                    val cleared = api.clearDestinationStreamKey(currentBackendUrl(), "facebook")
                    st.tvFbMaskedKey.text = cleared.maskedStreamKey
                } catch (e: Exception) {
                    showGlobalError("Clear Facebook key failed: ${e.message}")
                }
            }
        }

        st.btnSaveYtCreds.setOnClickListener {
            val server = st.etYtServerUrl.text.toString().trim()
            val key = st.etYtStreamKey.text.toString().trim()
            val err = IngestProtocol.validateRtmpServerUrl(server)
            if (err != null) {
                showGlobalError(err)
                return@setOnClickListener
            }
            credStore.saveYoutubeCredentials(server, key.ifBlank { null })
            lifecycleScope.launch {
                try {
                    val saved = api.saveDestinationCredentials(currentBackendUrl(), "youtube", server, key.ifBlank { null })
                    st.tvYtMaskedKey.text = saved.maskedStreamKey
                    st.etYtStreamKey.setText("")
                    showGlobalError(null)
                } catch (e: Exception) {
                    showGlobalError("YouTube key save failed: ${e.message}")
                }
            }
        }

        st.btnClearYtKey.setOnClickListener {
            credStore.clearYoutubeStreamKey()
            lifecycleScope.launch {
                try {
                    val cleared = api.clearDestinationStreamKey(currentBackendUrl(), "youtube")
                    st.tvYtMaskedKey.text = cleared.maskedStreamKey
                } catch (e: Exception) {
                    showGlobalError("Clear YouTube key failed: ${e.message}")
                }
            }
        }

        st.btnTestBackendHealth.setOnClickListener {
            val url = currentBackendUrl()
            credStore.setBackendUrl(url)
            connectLiveTelemetrySocket()
            syncAllWithBackend()
        }

        st.btnReplayIntro.setOnClickListener {
            startActivity(
                Intent(this, SplashIntroActivity::class.java).apply {
                    putExtra(SplashIntroActivity.EXTRA_FORCE_PLAY, true)
                },
            )
        }

        st.btnConnectBackend.setOnClickListener { connectCaptureIngestOnly() }
    }

    // =========================================================================
    // Backend Sync, Capture Pairing, & Live Observers
    // =========================================================================

    private fun connectLiveTelemetrySocket() {
        api.connectLiveTelemetrySocket(
            baseUrl = currentBackendUrl(),
            onTelemetry = { tel ->
                runOnUiThread { applyBroadcastTelemetry(tel) }
            },
            onLogs = { newLogs ->
                runOnUiThread { appendLogs(newLogs) }
            },
            onSocketError = { err ->
                runOnUiThread {
                    binding.tvHeaderBackendChip.text = "WS: $err"
                }
            },
        )
    }

    private fun syncAllWithBackend() {
        val baseUrl = currentBackendUrl()
        lifecycleScope.launch {
            val health = api.fetchHealth(baseUrl)
            if (health.ok) {
                binding.tvHeaderBackendChip.text = "Server: ${health.latencyMs}ms"
                binding.tabSettings.tvBackendDiag.text =
                    "Connected (${health.latencyMs}ms) · FFmpeg: ${if (health.ffmpegAvailable) health.ffmpegVersion else "Unavailable"}"
                showGlobalError(null)
            } else {
                binding.tvHeaderBackendChip.text = "Server: Offline"
                binding.tabSettings.tvBackendDiag.text = "Health check failed: ${health.error}"
                showGlobalError("Backend unreachable: ${health.error}")
            }

            try {
                val (tel, logs) = api.fetchStreamStatus(baseUrl)
                applyBroadcastTelemetry(tel)
                appendLogs(logs)
            } catch (_: Exception) {
            }

            try {
                val dests = api.fetchDestinations(baseUrl)
                binding.tabSettings.etFbServerUrl.setText(dests.facebook.serverUrl)
                binding.tabSettings.tvFbMaskedKey.text = dests.facebook.maskedStreamKey
                binding.tabSettings.etYtServerUrl.setText(dests.youtube.serverUrl)
                binding.tabSettings.tvYtMaskedKey.text = dests.youtube.maskedStreamKey
            } catch (_: Exception) {
            }

            try {
                val ov = api.fetchOverlays(baseUrl)
                overlayState = ov
                bindOverlayStateToUi(ov)
            } catch (_: Exception) {
            }
        }
    }

    private fun appendLogs(entries: List<String>) {
        if (entries.isEmpty()) return
        for (line in entries) {
            if (recentLogs.size >= 14) recentLogs.removeFirst()
            recentLogs.addLast(line)
        }
        binding.tabHome.tvHomeLogs.text = recentLogs.joinToString("\n")
    }

    private fun applyBroadcastTelemetry(tel: BroadcastTelemetry) {
        latestBroadcast = tel
        val isLive = tel.status == "Live"
        binding.tvHeaderLiveBadge.text = tel.status.uppercase()
        binding.tvHeaderLiveBadge.setBackgroundResource(
            if (isLive) R.drawable.bg_badge_live else R.drawable.bg_pill_unselected,
        )
        binding.tvHeaderLiveBadge.setTextColor(
            ContextCompat.getColor(
                this,
                if (isLive) R.color.studio_text_primary else R.color.studio_text_muted,
            ),
        )

        val h = binding.tabHome
        h.tvHomeBroadcastStatus.text = tel.status
        val mm = tel.durationSec / 60
        val ss = tel.durationSec % 60
        h.tvHomeBroadcastMetrics.text = String.format(
            "%s · %.1f fps · %d kbps · %02d:%02d",
            tel.outputResolution,
            tel.fps,
            tel.bitrateKbps,
            mm,
            ss,
        )
        h.tvHomeFbStatus.text = tel.facebook.status
        h.tvHomeFbStats.text = "${tel.facebook.bitrateKbps} kbps · ${tel.facebook.fps} fps"
        h.tvHomeYtStatus.text = tel.youtube.status
        h.tvHomeYtStats.text = "${tel.youtube.bitrateKbps} kbps · ${tel.youtube.fps} fps"

        val o = binding.tabOutput
        o.tvOutputPipelineResult.text =
            "Master Compositor: ${tel.status} (${tel.destinationMode}) · ${tel.outputResolution} · ${tel.bitrateKbps} kbps"
        o.tvFbDestStatus.text = tel.facebook.status
        o.tvFbDestMetrics.text =
            "Bitrate: ${tel.facebook.bitrateKbps} kbps · FPS: ${tel.facebook.fps} · ${tel.facebook.outputResolution} · Dropped: ${tel.facebook.droppedFrames} · Latency: ${tel.facebook.latencyMs} ms"
        o.tvFbDestError.visibility = if (tel.facebook.lastError.isNullOrBlank()) View.GONE else View.VISIBLE
        o.tvFbDestError.text = tel.facebook.lastError.orEmpty()

        o.tvYtDestStatus.text = tel.youtube.status
        o.tvYtDestMetrics.text =
            "Bitrate: ${tel.youtube.bitrateKbps} kbps · FPS: ${tel.youtube.fps} · ${tel.youtube.outputResolution} · Dropped: ${tel.youtube.droppedFrames} · Latency: ${tel.youtube.latencyMs} ms"
        o.tvYtDestError.visibility = if (tel.youtube.lastError.isNullOrBlank()) View.GONE else View.VISIBLE
        o.tvYtDestError.text = tel.youtube.lastError.orEmpty()

        if (!tel.lastError.isNullOrBlank()) {
            showGlobalError(tel.lastError)
        }
    }

    private fun observeFlows() {
        lifecycleScope.launch {
            CaptureForegroundService.uiState.collect { st ->
                binding.tabHome.tvHomeCaptureSummary.text =
                    "Monitor A: ${st.videoStatus.name} (${st.fps} fps ${st.width}x${st.height}) · Internal: ${st.audioStatus.name} · Mic: ${st.micStatus.name}"
                binding.tabPreview.tvCaptureStatusDetail.text =
                    "Socket: ${st.connectionStatus.name} · Video: ${st.videoStatus.name} · ${st.fps} fps · ${st.width}x${st.height} · ${st.bitrateKbps} kbps · Audio: ${st.audioStatus.name}"
                binding.tabMixer.tvInternalAudioStatus.text =
                    if (!st.audioReason.isNullOrBlank() && st.audioStatus == AudioCaptureStatus.AUDIO_NOT_AVAILABLE) {
                        "Status: AUDIO_NOT_AVAILABLE (${st.audioReason})"
                    } else {
                        "Status: ${st.audioStatus.name} (${st.audioSampleRate} Hz)"
                    }
                binding.tabMixer.tvMicAudioStatus.text = "Status: ${st.micStatus.name}"

                if (!st.lastError.isNullOrBlank()) {
                    showGlobalError(st.lastError)
                }
            }
        }

        lifecycleScope.launch {
            CaptureForegroundService.mixerState.collect { mx ->
                val m = binding.tabMixer
                m.waveformVisualizer.updateWaveform(mx.waveform, mx.masterMuted)
                m.meterMaster.setLevel(mx.masterLevel, mx.masterMuted)
                m.meterInternal.setLevel(mx.internalLevel, mx.internalMuted || !mx.internalEnabled || mx.masterMuted)
                m.meterMic.setLevel(mx.micLevel, mx.micMuted || !mx.micEnabled || mx.masterMuted)
                m.btnMasterMute.text = if (mx.masterMuted) "Master Mute: ON" else "Master Mute: OFF"
                m.btnInternalMute.text = if (mx.internalMuted) "Unmute CH1" else "Mute CH1"
                m.btnMicMute.text = if (mx.micMuted) "Unmute Mic" else "Mute Mic"
                m.btnGrantMicPermission.visibility = if (mx.micPermissionGranted || hasRecordAudioPermission()) {
                    View.GONE
                } else {
                    View.VISIBLE
                }
            }
        }

        lifecycleScope.launch {
            CaptureForegroundService.recordingState.collect { rec ->
                val r = binding.tabRecording
                val hh = rec.elapsedSec / 3600
                val mm = (rec.elapsedSec % 3600) / 60
                val ss = rec.elapsedSec % 60
                r.tvRecordingTimer.text = String.format("%02d:%02d:%02d", hh, mm, ss)
                r.tvRecordingIndicatorBadge.text = rec.status.name
                r.tvRecordingIndicatorBadge.setBackgroundResource(
                    if (rec.status == RecordingStatus.RECORDING) R.drawable.bg_badge_live else R.drawable.bg_pill_unselected,
                )
                r.tvRecordingStatusText.text = rec.statusMessage
                if (!rec.outputFilePath.isNullOrBlank()) {
                    val f = File(rec.outputFilePath)
                    if (f.exists()) {
                        r.tvSavedRecordingInfo.text =
                            "${f.name} · ${rec.resolutionLabel} @ ${rec.fps} FPS · ${f.length() / 1024} KB"
                    }
                } else {
                    r.tvSavedRecordingInfo.text = "No recorded video saved yet."
                }
            }
        }

        lifecycleScope.launch {
            CaptureForegroundService.remoteStartRequest.collect { ytUrl ->
                if (ytUrl != null) {
                    if (ytUrl.isNotBlank()) {
                        binding.tabPreview.etYoutubeUrl.setText(ytUrl)
                    }
                    CaptureForegroundService.clearRemoteStartRequest()
                    pendingRecordMp4 = false
                    checkPermissionsAndStartCapture()
                }
            }
        }
    }

    private fun applyDeepLinkIntent(intent: Intent?) {
        val data = intent?.data ?: return
        if (data.scheme == "livecast" && data.host == "capture") {
            data.getQueryParameter("backend")?.let {
                binding.tabSettings.etBackendUrl.setText(it)
                credStore.setBackendUrl(it)
            }
            data.getQueryParameter("sessionId")?.let { binding.tabSettings.etSessionId.setText(it) }
            data.getQueryParameter("token")?.let { binding.tabSettings.etIngestToken.setText(it) }
            data.getQueryParameter("yt")?.let {
                binding.tabPreview.etYoutubeUrl.setText(it)
                loadYouTubePreviewFromInput()
            }
            if (hasValidPairingCredentials()) {
                connectCaptureIngestOnly()
            }
        }
    }

    private fun hasValidPairingCredentials(): Boolean {
        return currentBackendUrl().isNotEmpty() &&
            binding.tabSettings.etSessionId.text.toString().trim().isNotEmpty() &&
            binding.tabSettings.etIngestToken.text.toString().trim().isNotEmpty()
    }

    private fun hasRecordAudioPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.RECORD_AUDIO,
        ) == PackageManager.PERMISSION_GRANTED
    }

    private fun connectCaptureIngestOnly() {
        val st = binding.tabSettings
        val backend = currentBackendUrl()
        val sessionId = st.etSessionId.text.toString().trim()
        val token = st.etIngestToken.text.toString().trim()
        if (backend.isEmpty() || sessionId.isEmpty() || token.isEmpty()) {
            showGlobalError("Enter or auto-create a Session ID and Ephemeral Token first.")
            return
        }
        val intent = Intent(this, CaptureForegroundService::class.java).apply {
            action = CaptureForegroundService.ACTION_CONNECT_ONLY
            putExtra(CaptureForegroundService.EXTRA_BACKEND_URL, backend)
            putExtra(CaptureForegroundService.EXTRA_SESSION_ID, sessionId)
            putExtra(CaptureForegroundService.EXTRA_INGEST_TOKEN, token)
        }
        ContextCompat.startForegroundService(this, intent)
    }

    private fun checkPermissionsAndStartCapture() {
        showGlobalError(null)
        lifecycleScope.launch {
            if (!hasValidPairingCredentials() && !pendingRecordMp4) {
                try {
                    val created = api.createCaptureSession(
                        currentBackendUrl(),
                        binding.tabPreview.etYoutubeUrl.text.toString().trim(),
                    )
                    binding.tabSettings.etSessionId.setText(created.sessionId)
                    binding.tabSettings.etIngestToken.setText(created.ingestToken)
                } catch (err: Exception) {
                    showGlobalError("Could not create live capture session on backend: ${err.message}")
                    return@launch
                }
            }

            val missing = mutableListOf<String>()
            if (!hasRecordAudioPermission()) {
                missing.add(Manifest.permission.RECORD_AUDIO)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED
            ) {
                missing.add(Manifest.permission.POST_NOTIFICATIONS)
            }

            if (missing.isNotEmpty()) {
                capturePermissionLauncher.launch(missing.toTypedArray())
            } else {
                requestScreenCapturePermission()
            }
        }
    }

    private fun requestScreenCapturePermission() {
        val mgr = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        projectionLauncher.launch(mgr.createScreenCaptureIntent())
    }

    private fun launchCaptureService(resultCode: Int, data: Intent) {
        val ytUrl = binding.tabPreview.etYoutubeUrl.text.toString().trim()
        val st = binding.tabSettings
        val recordMp4 = pendingRecordMp4
        pendingRecordMp4 = false
        val serviceIntent = Intent(this, CaptureForegroundService::class.java).apply {
            action = CaptureForegroundService.ACTION_START_CAPTURE
            putExtra(CaptureForegroundService.EXTRA_BACKEND_URL, currentBackendUrl())
            putExtra(CaptureForegroundService.EXTRA_SESSION_ID, st.etSessionId.text.toString().trim())
            putExtra(CaptureForegroundService.EXTRA_INGEST_TOKEN, st.etIngestToken.text.toString().trim())
            putExtra(CaptureForegroundService.EXTRA_YOUTUBE_URL, ytUrl)
            putExtra(CaptureForegroundService.EXTRA_VIDEO_WIDTH, selectedQuality.width)
            putExtra(CaptureForegroundService.EXTRA_VIDEO_HEIGHT, selectedQuality.height)
            putExtra(CaptureForegroundService.EXTRA_VIDEO_FPS, selectedFps)
            putExtra(CaptureForegroundService.EXTRA_VIDEO_BITRATE_BPS, selectedQuality.bitrateBps)
            putExtra(CaptureForegroundService.EXTRA_RECORD_MP4, recordMp4)
            putExtra(CaptureForegroundService.EXTRA_RESULT_CODE, resultCode)
            putExtra(CaptureForegroundService.EXTRA_RESULT_DATA, data)
        }
        ContextCompat.startForegroundService(this, serviceIntent)

        val monitorIntent = Intent(this, MonitorACaptureActivity::class.java).apply {
            putExtra(MonitorACaptureActivity.EXTRA_YOUTUBE_URL, ytUrl)
        }
        startActivity(monitorIntent)
    }

    private fun styleChip(btn: Button, selected: Boolean) {
        btn.setBackgroundResource(if (selected) R.drawable.bg_pill_selected else R.drawable.bg_pill_unselected)
        btn.setTextColor(
            ContextCompat.getColor(
                this,
                if (selected) R.color.studio_text_primary else R.color.studio_text_muted,
            ),
        )
    }
}
