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
import android.os.IBinder
import android.os.SystemClock
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

class CaptureForegroundService : Service() {

    companion object {
        const val ACTION_CONNECT_ONLY = "com.livecast.capture.ACTION_CONNECT_ONLY"
        const val ACTION_START_CAPTURE = "com.livecast.capture.ACTION_START_CAPTURE"
        const val ACTION_STOP_CAPTURE = "com.livecast.capture.ACTION_STOP_CAPTURE"

        const val EXTRA_BACKEND_URL = "extra_backend_url"
        const val EXTRA_SESSION_ID = "extra_session_id"
        const val EXTRA_INGEST_TOKEN = "extra_ingest_token"
        const val EXTRA_RESULT_CODE = "extra_result_code"
        const val EXTRA_RESULT_DATA = "extra_result_data"
        const val EXTRA_YOUTUBE_URL = "extra_youtube_url"

        private const val CHANNEL_ID = "livecast_capture_channel"
        private const val NOTIFICATION_ID = 4109

        private val _uiState = MutableStateFlow(CaptureUiState())
        val uiState: StateFlow<CaptureUiState> = _uiState.asStateFlow()

        private val _remoteStartRequest = MutableStateFlow<String?>(null)
        val remoteStartRequest: StateFlow<String?> = _remoteStartRequest.asStateFlow()

        fun clearRemoteStartRequest() {
            _remoteStartRequest.value = null
        }
    }

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var wsClient: CaptureWebSocketClient? = null
    private var mediaProjection: MediaProjection? = null
    private var videoEncoder: ScreenVideoEncoder? = null
    private var audioEngine: AudioPlaybackCaptureEngine? = null
    private var telemetryJob: Job? = null

    private val projectionCallback = object : MediaProjection.Callback() {
        override fun onStop() {
            stopAllAndShutdown("System stopped screen capture permission.")
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP_CAPTURE -> {
                stopAllAndShutdown(null)
                return START_NOT_STICKY
            }

            ACTION_CONNECT_ONLY -> {
                val backendUrl = intent.getStringExtra(EXTRA_BACKEND_URL).orEmpty()
                val sessionId = intent.getStringExtra(EXTRA_SESSION_ID).orEmpty()
                val token = intent.getStringExtra(EXTRA_INGEST_TOKEN).orEmpty()
                ensureForeground()
                ensureWebSocketConnected(backendUrl, sessionId, token)
            }

            ACTION_START_CAPTURE -> {
                val backendUrl = intent.getStringExtra(EXTRA_BACKEND_URL).orEmpty()
                val sessionId = intent.getStringExtra(EXTRA_SESSION_ID).orEmpty()
                val token = intent.getStringExtra(EXTRA_INGEST_TOKEN).orEmpty()
                val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
                val resultData = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra(EXTRA_RESULT_DATA)
                }

                ensureForeground()
                ensureWebSocketConnected(backendUrl, sessionId, token)

                if (resultCode == Activity.RESULT_OK && resultData != null) {
                    startMediaProjectionPipeline(resultCode, resultData)
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

    private fun ensureForeground() {
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun ensureWebSocketConnected(backendUrl: String, sessionId: String, token: String) {
        if (backendUrl.isBlank() || sessionId.isBlank() || token.isBlank()) {
            _uiState.value = _uiState.value.copy(
                connectionStatus = ConnectionCaptureStatus.Error,
                lastError = "Backend URL, Session ID, and Ingest Token are required.",
            )
            return
        }

        if (wsClient == null) {
            wsClient = CaptureWebSocketClient(
                scope = serviceScope,
                onConnectionState = { status, errMsg ->
                    _uiState.value = _uiState.value.copy(
                        connectionStatus = status,
                        lastError = errMsg ?: _uiState.value.lastError,
                    )
                },
                onRemoteCommand = { type, youtubeUrl ->
                    when (type) {
                        "stop" -> stopAllAndShutdown(null)
                        "start-request" -> _remoteStartRequest.value = youtubeUrl ?: ""
                    }
                },
            )
        }
        wsClient?.connect(backendUrl, sessionId, token)
        startTelemetryHeartbeat()
    }

    private fun startMediaProjectionPipeline(resultCode: Int, data: Intent) {
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

        projection.registerCallback(projectionCallback, null)
        mediaProjection = projection

        val monotonicClockBaseUs = SystemClock.elapsedRealtimeNanos() / 1000L
        val densityDpi = resources.displayMetrics.densityDpi

        val socket = wsClient ?: return

        _uiState.value = _uiState.value.copy(
            permissionGranted = true,
            connectionStatus = ConnectionCaptureStatus.Capturing,
            lastError = null,
        )

        val vEncoder = ScreenVideoEncoder(
            scope = serviceScope,
            mediaProjection = projection,
            width = 1280,
            height = 720,
            densityDpi = densityDpi,
            monotonicClockBaseUs = monotonicClockBaseUs,
            wsClient = socket,
            onStats = { fps, w, h, status ->
                _uiState.value = _uiState.value.copy(
                    fps = fps,
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
                socket.sendError(err)
                _uiState.value = _uiState.value.copy(
                    videoStatus = VideoCaptureStatus.ERROR,
                    lastError = err,
                )
            },
        )
        videoEncoder = vEncoder
        vEncoder.start()

        val hasRecordAudio = ContextCompat.checkSelfPermission(
            this,
            android.Manifest.permission.RECORD_AUDIO,
        ) == PackageManager.PERMISSION_GRANTED

        val aEngine = AudioPlaybackCaptureEngine(
            scope = serviceScope,
            mediaProjection = projection,
            monotonicClockBaseUs = monotonicClockBaseUs,
            wsClient = socket,
            onAudioStatus = { audioStatus, rate ->
                _uiState.value = _uiState.value.copy(
                    audioStatus = audioStatus,
                    audioSampleRate = rate,
                )
            },
        )
        audioEngine = aEngine
        aEngine.start(hasRecordAudio)
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
            lastError = reason,
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
            .setSmallIcon(android.R.drawable.ic_media_play)
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
        stopCapturePipelineOnly()
        telemetryJob?.cancel()
        wsClient?.sendStopAndClose()
        serviceScope.cancel()
        super.onDestroy()
    }
}
