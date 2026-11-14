package com.livecast.capture

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File

class CaptureForegroundService : Service() {

    companion object {
        const val ACTION_CONNECT_ONLY = "com.livecast.capture.ACTION_CONNECT_ONLY"
        const val ACTION_START_CAPTURE = "com.livecast.capture.ACTION_START_CAPTURE"
        const val ACTION_STOP_CAPTURE = "com.livecast.capture.ACTION_STOP_CAPTURE"
        const val ACTION_START_RECORDING = "com.livecast.capture.ACTION_START_RECORDING"
        const val ACTION_PAUSE_RECORDING = "com.livecast.capture.ACTION_PAUSE_RECORDING"
        const val ACTION_RESUME_RECORDING = "com.livecast.capture.ACTION_RESUME_RECORDING"
        const val ACTION_STOP_RECORDING = "com.livecast.capture.ACTION_STOP_RECORDING"

        const val EXTRA_BACKEND_URL = "extra_backend_url"
        const val EXTRA_SESSION_ID = "extra_session_id"
        const val EXTRA_INGEST_TOKEN = "extra_ingest_token"
        const val EXTRA_RESULT_CODE = "extra_result_code"
        const val EXTRA_RESULT_DATA = "extra_result_data"
        const val EXTRA_YOUTUBE_URL = "extra_youtube_url"
        const val EXTRA_VIDEO_WIDTH = "extra_video_width"
        const val EXTRA_VIDEO_HEIGHT = "extra_video_height"
        const val EXTRA_VIDEO_FPS = "extra_video_fps"
        const val EXTRA_VIDEO_BITRATE_BPS = "extra_video_bitrate_bps"
        const val EXTRA_RECORD_MP4 = "extra_record_mp4"

        private const val CHANNEL_ID = "livecast_capture_channel"
        private const val NOTIFICATION_ID = 4109

        private val _uiState = MutableStateFlow(CaptureUiState())
        val uiState: StateFlow<CaptureUiState> = _uiState.asStateFlow()

        private val _mixerState = MutableStateFlow(AudioMixerState())
        val mixerState: StateFlow<AudioMixerState> = _mixerState.asStateFlow()

        private val _recordingState = MutableStateFlow(RecordingUiState())
        val recordingState: StateFlow<RecordingUiState> = _recordingState.asStateFlow()

        private val _remoteStartRequest = MutableStateFlow<String?>(null)
        val remoteStartRequest: StateFlow<String?> = _remoteStartRequest.asStateFlow()

        @Volatile
        private var activeInstance: CaptureForegroundService? = null

        fun updateMixerConfig(transform: (AudioMixerState) -> AudioMixerState) {
            val next = transform(_mixerState.value)
            _mixerState.value = next
            activeInstance?.audioEngine?.updateConfig(next)
        }

        fun updateRecordingState(transform: (RecordingUiState) -> RecordingUiState) {
            _recordingState.value = transform(_recordingState.value)
        }

        fun clearRemoteStartRequest() {
            _remoteStartRequest.value = null
        }
    }

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var wsClient: CaptureWebSocketClient? = null
    private var mediaProjection: MediaProjection? = null
    private var videoEncoder: ScreenVideoEncoder? = null
    private var audioEngine: AudioMixerEngine? = null
    @Volatile
    private var mp4Recorder: Mp4ScreenRecorder? = null
    private var telemetryJob: Job? = null
    private var recordingTimerJob: Job? = null

    private val projectionCallback = object : MediaProjection.Callback() {
        override fun onStop() {
            stopAllAndShutdown("System stopped screen capture permission.")
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        activeInstance = this
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP_CAPTURE -> {
                stopAllAndShutdown(null)
                return START_NOT_STICKY
            }

            ACTION_PAUSE_RECORDING -> {
                pauseMp4Recording()
                return START_NOT_STICKY
            }

            ACTION_RESUME_RECORDING -> {
                resumeMp4Recording()
                return START_NOT_STICKY
            }

            ACTION_STOP_RECORDING -> {
                stopMp4RecordingOnly()
                return START_NOT_STICKY
            }

            ACTION_START_RECORDING -> {
                startMp4RecordingInternal(
                    width = _uiState.value.width.takeIf { it > 0 } ?: 1280,
                    height = _uiState.value.height.takeIf { it > 0 } ?: 720,
                    fps = _uiState.value.fps.takeIf { it > 0 } ?: 30,
                )
                return START_NOT_STICKY
            }

            ACTION_CONNECT_ONLY -> {
                val backendUrl = intent.getStringExtra(EXTRA_BACKEND_URL).orEmpty()
                val sessionId = intent.getStringExtra(EXTRA_SESSION_ID).orEmpty()
                val token = intent.getStringExtra(EXTRA_INGEST_TOKEN).orEmpty()
                ensureForeground(requireProjectionType = false)
                ensureWebSocketConnected(backendUrl, sessionId, token)
            }

            ACTION_START_CAPTURE -> {
                val backendUrl = intent.getStringExtra(EXTRA_BACKEND_URL).orEmpty()
                val sessionId = intent.getStringExtra(EXTRA_SESSION_ID).orEmpty()
                val token = intent.getStringExtra(EXTRA_INGEST_TOKEN).orEmpty()
                val width = intent.getIntExtra(EXTRA_VIDEO_WIDTH, 1280).coerceIn(640, 1920)
                val height = intent.getIntExtra(EXTRA_VIDEO_HEIGHT, 720).coerceIn(360, 1080)
                val fps = intent.getIntExtra(EXTRA_VIDEO_FPS, 30).coerceIn(15, 60)
                val bitrateBps = intent.getIntExtra(EXTRA_VIDEO_BITRATE_BPS, 3_000_000)
                val recordMp4 = intent.getBooleanExtra(EXTRA_RECORD_MP4, false)
                val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
                val resultData = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra(EXTRA_RESULT_DATA)
                }

                val hasProjectionToken = resultCode == Activity.RESULT_OK && resultData != null
                ensureForeground(requireProjectionType = hasProjectionToken)
                if (backendUrl.isNotBlank() && sessionId.isNotBlank() && token.isNotBlank()) {
                    ensureWebSocketConnected(backendUrl, sessionId, token)
                }

                if (hasProjectionToken) {
                    if (recordMp4) {
                        startMp4RecordingInternal(width, height, fps)
                    }
                    startMediaProjectionPipeline(
                        resultCode = resultCode,
                        data = resultData!!,
                        width = width,
                        height = height,
                        fps = fps,
                        bitrateBps = bitrateBps,
                    )
                } else {
                    _uiState.value = _uiState.value.copy(
                        permissionGranted = false,
                        videoStatus = VideoCaptureStatus.ERROR,
                        lastError = "Screen capture permission was not granted.",
                    )
                }
            }
        }
        return START_NOT_STICKY
    }

    private fun startMp4RecordingInternal(width: Int, height: Int, fps: Int) {
        stopMp4RecordingOnly(markSaved = false)
        val dir = File(getExternalFilesDir(null) ?: filesDir, "recordings").apply { mkdirs() }
        val file = File(dir, "monitor_a_${width}x${height}_${fps}fps_${System.currentTimeMillis()}.mp4")
        val rec = Mp4ScreenRecorder(file) { err ->
            _recordingState.value = _recordingState.value.copy(
                status = RecordingStatus.ERROR,
                statusMessage = err,
            )
        }
        videoEncoder?.currentOutputFormat()?.let { rec.onVideoFormatChanged(it) }
        audioEngine?.currentAudioFormat()?.let { rec.onAudioFormatChanged(it) }
        mp4Recorder = rec
        _recordingState.value = RecordingUiState(
            status = RecordingStatus.RECORDING,
            elapsedSec = 0,
            resolutionLabel = "${width}x${height}",
            fps = fps,
            outputFilePath = file.absolutePath,
            outputFileSizeBytes = 0L,
            statusMessage = "Recording Monitor A Preview (${width}x${height} @ ${fps} FPS)...",
        )
        startRecordingTimer()
    }

    private fun pauseMp4Recording() {
        val rec = mp4Recorder ?: return
        rec.pause()
        recordingTimerJob?.cancel()
        recordingTimerJob = null
        _recordingState.value = _recordingState.value.copy(
            status = RecordingStatus.PAUSED,
            statusMessage = "Recording paused at ${formatTimer(_recordingState.value.elapsedSec)}.",
        )
    }

    private fun resumeMp4Recording() {
        val rec = mp4Recorder ?: return
        rec.resume()
        _recordingState.value = _recordingState.value.copy(
            status = RecordingStatus.RECORDING,
            statusMessage = "Recording resumed (${_recordingState.value.resolutionLabel} @ ${_recordingState.value.fps} FPS)...",
        )
        startRecordingTimer()
    }

    private fun stopMp4RecordingOnly(markSaved: Boolean = true) {
        recordingTimerJob?.cancel()
        recordingTimerJob = null
        val rec = mp4Recorder ?: return
        mp4Recorder = null
        val finalized = rec.stopAndFinalize()
        if (markSaved) {
            if (finalized != null && finalized.exists() && finalized.length() > 0L) {
                _recordingState.value = _recordingState.value.copy(
                    status = RecordingStatus.SAVED,
                    outputFilePath = finalized.absolutePath,
                    outputFileSizeBytes = finalized.length(),
                    statusMessage = "Saved recording: ${finalized.name} (${finalized.length() / 1024} KB)",
                )
            } else {
                _recordingState.value = _recordingState.value.copy(
                    status = RecordingStatus.IDLE,
                    statusMessage = "Recording stopped.",
                )
            }
        }
    }

    private fun startRecordingTimer() {
        recordingTimerJob?.cancel()
        recordingTimerJob = serviceScope.launch {
            while (isActive && _recordingState.value.status == RecordingStatus.RECORDING) {
                delay(1000L)
                if (_recordingState.value.status == RecordingStatus.RECORDING) {
                    val path = _recordingState.value.outputFilePath
                    val size = if (!path.isNullOrBlank()) File(path).length() else 0L
                    _recordingState.value = _recordingState.value.copy(
                        elapsedSec = _recordingState.value.elapsedSec + 1,
                        outputFileSizeBytes = size,
                    )
                }
            }
        }
    }

    private fun formatTimer(sec: Int): String {
        val h = sec / 3600
        val m = (sec % 3600) / 60
        val s = sec % 60
        return String.format("%02d:%02d:%02d", h, m, s)
    }

    private fun hasRecordAudioPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            this,
            android.Manifest.permission.RECORD_AUDIO,
        ) == PackageManager.PERMISSION_GRANTED
    }

    private fun ensureForeground(requireProjectionType: Boolean) {
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            var fgsType = if (requireProjectionType) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            } else {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            }
            if (requireProjectionType && hasRecordAudioPermission()) {
                fgsType = fgsType or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            }
            startForeground(NOTIFICATION_ID, notification, fgsType)
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val fgsType = if (requireProjectionType) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            } else {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            }
            startForeground(NOTIFICATION_ID, notification, fgsType)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun ensureWebSocketConnected(backendUrl: String, sessionId: String, token: String) {
        if (backendUrl.isBlank() || sessionId.isBlank() || token.isBlank()) {
            return
        }

        if (wsClient == null) {
            wsClient = CaptureWebSocketClient(
                scope = serviceScope,
                onConnectionState = { status, errMsg ->
                    val clearedError =
                        if (status == ConnectionCaptureStatus.Connected ||
                            status == ConnectionCaptureStatus.Capturing
                        ) {
                            null
                        } else {
                            errMsg ?: _uiState.value.lastError
                        }
                    _uiState.value = _uiState.value.copy(
                        connectionStatus = status,
                        lastError = clearedError,
                    )
                },
                onRemoteCommand = { type, youtubeUrl ->
                    when (type) {
                        "stop" -> stopAllAndShutdown(null)
                        "start-request" -> _remoteStartRequest.value = youtubeUrl ?: ""
                    }
                },
                onLatencyMeasured = { latency ->
                    _uiState.value = _uiState.value.copy(latencyMs = latency)
                },
                onThroughputMeasured = { frames, kbps ->
                    _uiState.value = _uiState.value.copy(
                        framesSent = frames,
                        bitrateKbps = kbps,
                    )
                },
            )
        }
        wsClient?.connect(backendUrl, sessionId, token)
        startTelemetryHeartbeat()
    }

    private fun startMediaProjectionPipeline(
        resultCode: Int,
        data: Intent,
        width: Int,
        height: Int,
        fps: Int,
        bitrateBps: Int,
    ) {
        stopCapturePipelineOnly()

        val mgr = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val projection = mgr.getMediaProjection(resultCode, data)
        if (projection == null) {
            _uiState.value = _uiState.value.copy(
                permissionGranted = false,
                videoStatus = VideoCaptureStatus.ERROR,
                lastError = "Android returned null MediaProjection handle.",
            )
            return
        }

        projection.registerCallback(projectionCallback, Handler(Looper.getMainLooper()))
        mediaProjection = projection

        val monotonicClockBaseUs = System.nanoTime() / 1000L
        val densityDpi = resources.displayMetrics.densityDpi
        val socket = wsClient

        _uiState.value = _uiState.value.copy(
            permissionGranted = true,
            connectionStatus = ConnectionCaptureStatus.Capturing,
            lastError = null,
        )

        val vEncoder = ScreenVideoEncoder(
            scope = serviceScope,
            mediaProjection = projection,
            width = width,
            height = height,
            targetFps = fps,
            bitrateBps = bitrateBps,
            densityDpi = densityDpi,
            monotonicClockBaseUs = monotonicClockBaseUs,
            wsClient = socket,
            mp4Recorder = { mp4Recorder },
            onStats = { measuredFps, w, h, status ->
                _uiState.value = _uiState.value.copy(
                    fps = measuredFps,
                    width = w,
                    height = h,
                    videoStatus = status,
                    connectionStatus = if (status == VideoCaptureStatus.CAPTURING) {
                        ConnectionCaptureStatus.Capturing
                    } else {
                        _uiState.value.connectionStatus
                    },
                )
            },
            onError = { err ->
                socket?.sendError(err)
                _uiState.value = _uiState.value.copy(
                    videoStatus = VideoCaptureStatus.ERROR,
                    lastError = err,
                )
            },
        )
        videoEncoder = vEncoder
        vEncoder.start()

        val hasAudioPerm = hasRecordAudioPermission()
        _mixerState.value = _mixerState.value.copy(micPermissionGranted = hasAudioPerm)

        val aEngine = AudioMixerEngine(
            scope = serviceScope,
            mediaProjection = projection,
            monotonicClockBaseUs = monotonicClockBaseUs,
            wsClient = socket,
            mp4Recorder = { mp4Recorder },
            initialConfig = _mixerState.value,
            onStatusUpdate = { internalStatus, micStatus, rate, reason ->
                _uiState.value = _uiState.value.copy(
                    audioStatus = internalStatus,
                    micStatus = micStatus,
                    audioSampleRate = rate,
                    audioReason = reason,
                )
            },
            onLevelsUpdate = { intLvl, micLvl, masLvl, wave ->
                _mixerState.value = _mixerState.value.copy(
                    internalLevel = intLvl,
                    micLevel = micLvl,
                    masterLevel = masLvl,
                    waveform = wave,
                )
            },
        )
        audioEngine = aEngine
        aEngine.start(hasAudioPerm)
    }

    private fun startTelemetryHeartbeat() {
        telemetryJob?.cancel()
        telemetryJob = serviceScope.launch(Dispatchers.IO) {
            while (isActive) {
                wsClient?.sendTelemetry(_uiState.value)
                delay(1000L)
            }
        }
    }

    private fun stopCapturePipelineOnly() {
        audioEngine?.stop()
        audioEngine = null

        videoEncoder?.stop()
        videoEncoder = null

        try {
            mediaProjection?.unregisterCallback(projectionCallback)
            mediaProjection?.stop()
        } catch (_: Exception) {
        }
        mediaProjection = null
    }

    private fun stopAllAndShutdown(reason: String?) {
        stopMp4RecordingOnly(markSaved = true)
        telemetryJob?.cancel()
        telemetryJob = null
        stopCapturePipelineOnly()

        wsClient?.sendStopAndClose()
        wsClient = null

        _uiState.value = CaptureUiState(
            permissionGranted = false,
            connectionStatus = ConnectionCaptureStatus.Stopped,
            videoStatus = VideoCaptureStatus.IDLE,
            audioStatus = AudioCaptureStatus.IDLE,
            micStatus = AudioCaptureStatus.IDLE,
            lastError = reason,
        )
        _mixerState.value = _mixerState.value.copy(
            internalLevel = 0f,
            micLevel = 0f,
            masterLevel = 0f,
            waveform = FloatArray(28),
        )

        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                getString(R.string.notification_channel_name),
                NotificationManager.IMPORTANCE_LOW,
            )
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val openAppIntent = PendingIntent.getActivity(
            this,
            1,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val stopIntent = PendingIntent.getService(
            this,
            2,
            Intent(this, CaptureForegroundService::class.java).apply {
                action = ACTION_STOP_CAPTURE
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_livecast)
            .setContentTitle(getString(R.string.notification_title))
            .setContentText(getString(R.string.notification_text))
            .setOngoing(true)
            .setContentIntent(openAppIntent)
            .addAction(
                android.R.drawable.ic_media_pause,
                getString(R.string.action_stop_capture),
                stopIntent,
            )
            .build()
    }

    override fun onDestroy() {
        if (activeInstance === this) {
            activeInstance = null
        }
        stopMp4RecordingOnly(markSaved = true)
        stopCapturePipelineOnly()
        telemetryJob?.cancel()
        wsClient?.sendStopAndClose()
        serviceScope.cancel()
        super.onDestroy()
    }
}
