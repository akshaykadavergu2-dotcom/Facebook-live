package com.livecast.capture

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString.Companion.toByteString
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

class CaptureWebSocketClient(
    private val scope: CoroutineScope,
    private val onConnectionState: (ConnectionCaptureStatus, String?) -> Unit,
    private val onRemoteCommand: (type: String, youtubeUrl: String?) -> Unit,
    private val onLatencyMeasured: (Long) -> Unit,
) {
    private data class QueuedFrame(
        val bytes: ByteArray,
        val isCritical: Boolean,
    )

    private val client = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    private val sendQueue = ArrayBlockingQueue<QueuedFrame>(96)
    private val sequence = AtomicInteger(0)
    private val closedByUser = AtomicBoolean(false)

    @Volatile
    private var activeWs: WebSocket? = null
    @Volatile
    private var targetBackendUrl: String = ""
    @Volatile
    private var targetSessionId: String = ""
    @Volatile
    private var targetToken: String = ""

    private var senderJob: Job? = null
    private var reconnectAttempt = 0

    fun connect(backendUrl: String, sessionId: String, ingestToken: String) {
        closedByUser.set(false)
        targetBackendUrl = backendUrl.trim().trimEnd('/')
        targetSessionId = sessionId.trim()
        targetToken = ingestToken.trim()
        reconnectAttempt = 0
        openSocket()
        startSenderLoop()
    }

    private fun buildWsUrl(): String {
        val base = when {
            targetBackendUrl.startsWith("https://", ignoreCase = true) ->
                "wss://" + targetBackendUrl.substring(8)
            targetBackendUrl.startsWith("http://", ignoreCase = true) ->
                "ws://" + targetBackendUrl.substring(7)
            else -> "wss://$targetBackendUrl"
        }
        val encSession = URLEncoder.encode(targetSessionId, "UTF-8")
        val encToken = URLEncoder.encode(targetToken, "UTF-8")
        return "$base/ws/capture-ingest?sessionId=$encSession&token=$encToken"
    }

    private fun openSocket() {
        if (closedByUser.get()) return
        onConnectionState(
            if (reconnectAttempt > 0) ConnectionCaptureStatus.Reconnecting else ConnectionCaptureStatus.Connecting,
            null,
        )

        val request = Request.Builder()
            .url(buildWsUrl())
            .build()

        activeWs = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                reconnectAttempt = 0
                onConnectionState(ConnectionCaptureStatus.Connected, null)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val json = JSONObject(text)
                    val type = json.optString("type", "")
                    if (type == "telemetry-ack") {
                        val sentAtMs = json.optLong("sentAtMs", 0L)
                        if (sentAtMs > 0L) {
                            val rttHalf = ((System.currentTimeMillis() - sentAtMs) / 2L).coerceIn(1L, 10_000L)
                            onLatencyMeasured(rttHalf)
                        }
                        return
                    }
                    val yt = if (json.has("youtubeUrl") && !json.isNull("youtubeUrl")) {
                        json.optString("youtubeUrl", "")
                    } else {
                        null
                    }
                    onRemoteCommand(type, yt)
                } catch (_: Exception) {
                    // ignore malformed control packets
                }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(code, reason)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (!closedByUser.get() && code != 1000 && code != 4004) {
                    scheduleReconnect("Connection closed ($code)")
                } else if (closedByUser.get()) {
                    onConnectionState(ConnectionCaptureStatus.Stopped, null)
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                if (!closedByUser.get()) {
                    val msg = t.message ?: "WebSocket transport failure"
                    scheduleReconnect(msg)
                }
            }
        })
    }

    private fun scheduleReconnect(reason: String) {
        reconnectAttempt += 1
        val delayMs = (1000L shl reconnectAttempt.coerceAtMost(4)).coerceAtMost(10_000L)
        onConnectionState(ConnectionCaptureStatus.Reconnecting, reason)
        scope.launch(Dispatchers.IO) {
            delay(delayMs)
            if (!closedByUser.get()) {
                openSocket()
            }
        }
    }

    private fun startSenderLoop() {
        senderJob?.cancel()
        senderJob = scope.launch(Dispatchers.IO) {
            while (isActive && !closedByUser.get()) {
                val frame = sendQueue.poll(100, TimeUnit.MILLISECONDS) ?: continue
                val ws = activeWs
                if (ws != null) {
                    // Backpressure protection if OkHttp outbound buffer exceeds 4 MB
                    if (ws.queueSize() > 4 * 1024 * 1024 && !frame.isCritical) {
                        continue
                    }
                    ws.send(frame.bytes.toByteString())
                }
            }
        }
    }

    fun sendBinaryFrame(
        frameType: Byte,
        isKeyframe: Boolean,
        ptsUs: Long,
        payload: ByteArray,
    ) {
        val seq = sequence.getAndIncrement()
        val packet = IngestProtocol.buildPacket(
            frameType = frameType,
            isKeyframe = isKeyframe,
            sequence = seq,
            ptsUs = ptsUs,
            payload = payload,
        )
        val isCritical = isKeyframe ||
            frameType == IngestProtocol.FRAME_VIDEO_CONFIG ||
            frameType == IngestProtocol.FRAME_AUDIO_CONFIG

        if (!sendQueue.offer(QueuedFrame(packet, isCritical))) {
            // Drop oldest non-critical frame cleanly to make space
            sendQueue.poll()
            sendQueue.offer(QueuedFrame(packet, isCritical))
        }
    }

    fun sendTelemetry(state: CaptureUiState) {
        val ws = activeWs ?: return
        val json = JSONObject()
            .put("type", "telemetry")
            .put("permissionGranted", state.permissionGranted)
            .put("videoStatus", state.videoStatus.name)
            .put("audioStatus", state.audioStatus.name)
            .put("width", state.width)
            .put("height", state.height)
            .put("audioSampleRate", state.audioSampleRate)
            .put("sentAtMs", System.currentTimeMillis())
        ws.send(json.toString())
    }

    fun sendError(message: String) {
        val ws = activeWs ?: return
        val json = JSONObject()
            .put("type", "error")
            .put("error", message)
        ws.send(json.toString())
    }

    fun sendStopAndClose() {
        closedByUser.set(true)
        senderJob?.cancel()
        sendQueue.clear()
        try {
            activeWs?.send(JSONObject().put("type", "stop").toString())
            activeWs?.close(1000, "Capture stopped by user")
        } catch (_: Exception) {
            // ignore
        }
        activeWs = null
        onConnectionState(ConnectionCaptureStatus.Stopped, null)
    }
}
