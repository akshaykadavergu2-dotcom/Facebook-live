package com.livecast.capture

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

data class CreatedCaptureSession(
    val sessionId: String,
    val ingestToken: String,
    val expiresAt: String,
)

data class BackendHealthResult(
    val ok: Boolean,
    val ffmpegAvailable: Boolean,
    val ffmpegVersion: String,
    val latencyMs: Long,
    val error: String? = null,
)

data class DestinationsConfigResult(
    val facebook: DestinationPublicCreds,
    val youtube: DestinationPublicCreds,
)

data class PipelineValidationResult(
    val success: Boolean,
    val message: String,
)

/**
 * Typed HTTP + WebSocket client for LIVECAST STUDIO backend API.
 * Sends X-Livecast-Client: livecast-android so security policies authorize the native studio.
 */
class BackendApiClient {

    private val jsonMime = "application/json; charset=utf-8".toMediaType()
    private val pngMime = "image/png".toMediaType()

    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(45, TimeUnit.SECONDS)
        .writeTimeout(45, TimeUnit.SECONDS)
        .pingInterval(20, TimeUnit.SECONDS)
        .build()

    @Volatile
    private var statusWs: WebSocket? = null

    fun connectLiveTelemetrySocket(
        baseUrl: String,
        onTelemetry: (BroadcastTelemetry) -> Unit,
        onLogs: (List<String>) -> Unit,
        onSocketError: (String) -> Unit,
    ) {
        disconnectLiveTelemetrySocket()
        val clean = baseUrl.trim().trimEnd('/')
        val wsUrl = when {
            clean.startsWith("https://", ignoreCase = true) -> "wss://${clean.substring(8)}/ws"
            clean.startsWith("http://", ignoreCase = true) -> "ws://${clean.substring(7)}/ws"
            else -> "wss://$clean/ws"
        }

        val req = Request.Builder()
            .url(wsUrl)
            .header("X-Livecast-Client", "livecast-android")
            .header("Origin", "https://streamkarolive.netlify.app")
            .build()

        statusWs = http.newWebSocket(req, object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val obj = JSONObject(text)
                    val type = obj.optString("type", "")
                    if (type == "init" || type == "status") {
                        obj.optJSONObject("telemetry")?.let {
                            onTelemetry(parseTelemetry(it))
                        }
                    }
                    if (type == "init") {
                        val arr = obj.optJSONArray("logs")
                        if (arr != null) {
                            onLogs(parseLogArray(arr))
                        }
                    } else if (type == "log") {
                        obj.optJSONObject("entry")?.let { entry ->
                            val msg = formatLogEntry(entry)
                            if (msg.isNotBlank()) onLogs(listOf(msg))
                        }
                    }
                } catch (_: Exception) {
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                val code = response?.code
                val msg = if (code != null) "Telemetry WS HTTP $code" else (t.message ?: "Telemetry WS disconnected")
                onSocketError(msg)
            }
        })
    }

    fun disconnectLiveTelemetrySocket() {
        try {
            statusWs?.close(1000, "Client detached")
        } catch (_: Exception) {
        }
        statusWs = null
    }

    suspend fun fetchHealth(baseUrl: String): BackendHealthResult = withContext(Dispatchers.IO) {
        val started = System.currentTimeMillis()
        try {
            val req = requestBuilder(baseUrl, "/api/health").get().build()
            http.newCall(req).execute().use { res ->
                val raw = res.body?.string().orEmpty()
                val latency = (System.currentTimeMillis() - started).coerceAtLeast(1L)
                if (!res.isSuccessful) {
                    return@withContext BackendHealthResult(
                        ok = false,
                        ffmpegAvailable = false,
                        ffmpegVersion = "",
                        latencyMs = latency,
                        error = extractErrorMessage(raw, "HTTP ${res.code}"),
                    )
                }
                val json = JSONObject(raw)
                BackendHealthResult(
                    ok = json.optBoolean("ok", true),
                    ffmpegAvailable = json.optBoolean("ffmpegAvailable", false),
                    ffmpegVersion = json.optString("ffmpegVersion", ""),
                    latencyMs = latency,
                )
            }
        } catch (err: Exception) {
            BackendHealthResult(
                ok = false,
                ffmpegAvailable = false,
                ffmpegVersion = "",
                latencyMs = 0L,
                error = err.message ?: "Unable to reach backend",
            )
        }
    }

    suspend fun fetchStreamStatus(baseUrl: String): Pair<BroadcastTelemetry, List<String>> = withContext(Dispatchers.IO) {
        val req = requestBuilder(baseUrl, "/api/stream/status").get().build()
        http.newCall(req).execute().use { res ->
            val raw = res.body?.string().orEmpty()
            if (!res.isSuccessful) {
                throw IllegalStateException(extractErrorMessage(raw, "HTTP ${res.code}"))
            }
            val json = JSONObject(raw)
            val telemetry = json.optJSONObject("telemetry")?.let(::parseTelemetry) ?: BroadcastTelemetry()
            val logs = json.optJSONArray("logs")?.let(::parseLogArray) ?: emptyList()
            telemetry to logs
        }
    }

    suspend fun fetchDestinations(baseUrl: String): DestinationsConfigResult = withContext(Dispatchers.IO) {
        val req = requestBuilder(baseUrl, "/api/stream/destinations").get().build()
        http.newCall(req).execute().use { res ->
            val raw = res.body?.string().orEmpty()
            if (!res.isSuccessful) {
                throw IllegalStateException(extractErrorMessage(raw, "HTTP ${res.code}"))
            }
            val json = JSONObject(raw)
            val fbObj = json.optJSONObject("facebook") ?: JSONObject()
            val ytObj = json.optJSONObject("youtube") ?: JSONObject()
            DestinationsConfigResult(
                facebook = parseDestCreds(fbObj, SecureCredentialStore.DEFAULT_FB_RTMP),
                youtube = parseDestCreds(ytObj, SecureCredentialStore.DEFAULT_YT_RTMP),
            )
        }
    }

    suspend fun saveDestinationCredentials(
        baseUrl: String,
        platform: String,
        serverUrl: String,
        streamKey: String?,
    ): DestinationPublicCreds = withContext(Dispatchers.IO) {
        val payload = JSONObject().put("serverUrl", serverUrl.trim())
        if (!streamKey.isNullOrBlank()) {
            payload.put("streamKey", streamKey.trim())
        }
        val path = if (platform == "youtube") "/api/stream/credentials/youtube" else "/api/stream/credentials/facebook"
        val req = requestBuilder(baseUrl, path)
            .post(payload.toString().toRequestBody(jsonMime))
            .build()
        http.newCall(req).execute().use { res ->
            val raw = res.body?.string().orEmpty()
            if (!res.isSuccessful) {
                throw IllegalStateException(extractErrorMessage(raw, "HTTP ${res.code}"))
            }
            val defaultUrl = if (platform == "youtube") {
                SecureCredentialStore.DEFAULT_YT_RTMP
            } else {
                SecureCredentialStore.DEFAULT_FB_RTMP
            }
            parseDestCreds(JSONObject(raw), defaultUrl)
        }
    }

    suspend fun clearDestinationStreamKey(baseUrl: String, platform: String): DestinationPublicCreds =
        withContext(Dispatchers.IO) {
            val path = if (platform == "youtube") "/api/stream/credentials/youtube" else "/api/stream/credentials/facebook"
            val req = requestBuilder(baseUrl, path).delete().build()
            http.newCall(req).execute().use { res ->
                val raw = res.body?.string().orEmpty()
                if (!res.isSuccessful) {
                    throw IllegalStateException(extractErrorMessage(raw, "HTTP ${res.code}"))
                }
                val defaultUrl = if (platform == "youtube") {
                    SecureCredentialStore.DEFAULT_YT_RTMP
                } else {
                    SecureCredentialStore.DEFAULT_FB_RTMP
                }
                parseDestCreds(JSONObject(raw), defaultUrl)
            }
        }

    suspend fun createCaptureSession(baseUrl: String, youtubeUrl: String?): CreatedCaptureSession =
        withContext(Dispatchers.IO) {
            val payload = JSONObject()
            if (!youtubeUrl.isNullOrBlank()) {
                payload.put("youtubeUrl", youtubeUrl.trim())
            }
            val req = requestBuilder(baseUrl, "/api/capture/session")
                .post(payload.toString().toRequestBody(jsonMime))
                .build()
            http.newCall(req).execute().use { res ->
                val raw = res.body?.string().orEmpty()
                if (!res.isSuccessful) {
                    throw IllegalStateException(extractErrorMessage(raw, "HTTP ${res.code}"))
                }
                val session = JSONObject(raw).getJSONObject("session")
                CreatedCaptureSession(
                    sessionId = session.getString("sessionId"),
                    ingestToken = session.getString("ingestToken"),
                    expiresAt = session.optString("expiresAt", ""),
                )
            }
        }

    suspend fun startStream(
        baseUrl: String,
        sourceType: String,
        quality: String,
        destinationMode: String,
        directUrl: String? = null,
        loopVideo: Boolean = false,
    ): BroadcastTelemetry = withContext(Dispatchers.IO) {
        val payload = JSONObject()
            .put("sourceType", sourceType)
            .put("quality", quality)
            .put("destinationMode", destinationMode)
            .put("loopVideo", loopVideo)
        if (!directUrl.isNullOrBlank()) {
            payload.put("directUrl", directUrl.trim())
        }
        val req = requestBuilder(baseUrl, "/api/stream/start")
            .post(payload.toString().toRequestBody(jsonMime))
            .build()
        http.newCall(req).execute().use { res ->
            val raw = res.body?.string().orEmpty()
            if (!res.isSuccessful) {
                throw IllegalStateException(extractErrorMessage(raw, "HTTP ${res.code}"))
            }
            parseTelemetry(JSONObject(raw).getJSONObject("telemetry"))
        }
    }

    suspend fun stopStream(baseUrl: String): BroadcastTelemetry = withContext(Dispatchers.IO) {
        val req = requestBuilder(baseUrl, "/api/stream/stop")
            .post("{}".toRequestBody(jsonMime))
            .build()
        http.newCall(req).execute().use { res ->
            val raw = res.body?.string().orEmpty()
            if (!res.isSuccessful) {
                throw IllegalStateException(extractErrorMessage(raw, "HTTP ${res.code}"))
            }
            parseTelemetry(JSONObject(raw).getJSONObject("telemetry"))
        }
    }

    suspend fun controlDestination(
        baseUrl: String,
        destination: String,
        action: String,
    ): BroadcastTelemetry = withContext(Dispatchers.IO) {
        val req = requestBuilder(baseUrl, "/api/stream/destination/$destination/$action")
            .post("{}".toRequestBody(jsonMime))
            .build()
        http.newCall(req).execute().use { res ->
            val raw = res.body?.string().orEmpty()
            if (!res.isSuccessful) {
                throw IllegalStateException(extractErrorMessage(raw, "HTTP ${res.code}"))
            }
            parseTelemetry(JSONObject(raw).getJSONObject("telemetry"))
        }
    }

    suspend fun validatePipeline(
        baseUrl: String,
        sourceType: String,
        quality: String,
    ): PipelineValidationResult = withContext(Dispatchers.IO) {
        val payload = JSONObject()
            .put("sourceType", sourceType)
            .put("quality", quality)
        val req = requestBuilder(baseUrl, "/api/stream/validate-pipeline")
            .post(payload.toString().toRequestBody(jsonMime))
            .build()
        http.newCall(req).execute().use { res ->
            val raw = res.body?.string().orEmpty()
            val obj = try {
                JSONObject(raw)
            } catch (_: Exception) {
                JSONObject()
            }
            if (!res.isSuccessful) {
                return@withContext PipelineValidationResult(
                    success = false,
                    message = obj.optString("message").ifBlank { extractErrorMessage(raw, "HTTP ${res.code}") },
                )
            }
            PipelineValidationResult(
                success = obj.optBoolean("success", true),
                message = obj.optString("message", "Pipeline validated cleanly."),
            )
        }
    }

    suspend fun fetchOverlays(baseUrl: String): OverlayStudioState = withContext(Dispatchers.IO) {
        val req = requestBuilder(baseUrl, "/api/overlays").get().build()
        http.newCall(req).execute().use { res ->
            val raw = res.body?.string().orEmpty()
            if (!res.isSuccessful) {
                throw IllegalStateException(extractErrorMessage(raw, "HTTP ${res.code}"))
            }
            parseOverlayState(JSONObject(raw))
        }
    }

    suspend fun saveOverlays(baseUrl: String, state: OverlayStudioState): OverlayStudioState =
        withContext(Dispatchers.IO) {
            val payload = JSONObject()
                .put("logoEnabled", state.logoEnabled)
                .put("logoPosition", state.logoPosition)
                .put("logoScale", state.logoScale)
                .put("logoOpacity", state.logoOpacity.toDouble())
                .put("logoX", state.logoX?.toDouble() ?: JSONObject.NULL)
                .put("logoY", state.logoY?.toDouble() ?: JSONObject.NULL)
                .put("headlineEnabled", state.headlineEnabled)
                .put("headlineText", state.headlineText)
                .put("headlineFontSize", state.headlineFontSize)
                .put("headlineColor", state.headlineColor)
                .put("headlineBgColor", state.headlineBgColor)
                .put("headlineBgOpacity", state.headlineBgOpacity.toDouble())
                .put("headlineAnimation", state.headlineAnimation)
                .put("breakingNewsEnabled", state.breakingNewsEnabled)
                .put("breakingNewsLabel", state.breakingNewsLabel)
                .put("breakingNewsText", state.breakingNewsText)
                .put("breakingNewsBgColor", state.breakingNewsBgColor)
                .put("breakingNewsTextColor", state.breakingNewsTextColor)
                .put("breakingNewsOpacity", state.breakingNewsOpacity.toDouble())
                .put("lowerThirdEnabled", state.lowerThirdEnabled)
                .put("lowerThirdTitle", state.lowerThirdTitle)
                .put("lowerThirdSubtitle", state.lowerThirdSubtitle)
                .put("lowerThirdAccentColor", state.lowerThirdAccentColor)
                .put("lowerThirdBgColor", state.lowerThirdBgColor)
                .put("lowerThirdTextColor", state.lowerThirdTextColor)
                .put("lowerThirdX", state.lowerThirdX?.toDouble() ?: JSONObject.NULL)
                .put("lowerThirdY", state.lowerThirdY?.toDouble() ?: JSONObject.NULL)
                .put("clockEnabled", state.clockEnabled)
                .put("clockPosition", state.clockPosition)
                .put("clockFormat", state.clockFormat)
                .put("clockFontSize", state.clockFontSize)
                .put("clockColor", state.clockColor)
                .put("clockBgColor", state.clockBgColor)
                .put("clockX", state.clockX?.toDouble() ?: JSONObject.NULL)
                .put("clockY", state.clockY?.toDouble() ?: JSONObject.NULL)
                .put("tickerEnabled", state.tickerEnabled)
                .put("tickerText", state.tickerText)
                .put("tickerFontSize", state.tickerFontSize)
                .put("tickerColor", state.tickerColor)
                .put("tickerBgColor", state.tickerBgColor)
                .put("tickerSpeed", state.tickerSpeed)
                .put("customTextEnabled", state.customTextEnabled)
                .put("customText", state.customText)
                .put("customTextFontSize", state.customTextFontSize)
                .put("customTextColor", state.customTextColor)
                .put("customTextBgColor", state.customTextBgColor)
                .put("customTextAlign", state.customTextAlign)
                .put("customTextX", state.customTextX.toDouble())
                .put("customTextY", state.customTextY.toDouble())
                .put("imageOverlayEnabled", state.imageOverlayEnabled)
                .put("imageOverlayX", state.imageOverlayX.toDouble())
                .put("imageOverlayY", state.imageOverlayY.toDouble())
                .put("imageOverlayScale", state.imageOverlayScale)
                .put("imageOverlayOpacity", state.imageOverlayOpacity.toDouble())

            val req = requestBuilder(baseUrl, "/api/overlays")
                .post(payload.toString().toRequestBody(jsonMime))
                .build()
            http.newCall(req).execute().use { res ->
                val raw = res.body?.string().orEmpty()
                if (!res.isSuccessful) {
                    throw IllegalStateException(extractErrorMessage(raw, "HTTP ${res.code}"))
                }
                parseOverlayState(JSONObject(raw))
            }
        }

    suspend fun uploadOverlayPng(
        baseUrl: String,
        endpoint: String,
        fieldName: String,
        filename: String,
        pngBytes: ByteArray,
    ): OverlayStudioState = withContext(Dispatchers.IO) {
        val body = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart(fieldName, filename, pngBytes.toRequestBody(pngMime))
            .build()
        val req = requestBuilder(baseUrl, endpoint)
            .post(body)
            .build()
        http.newCall(req).execute().use { res ->
            val raw = res.body?.string().orEmpty()
            if (!res.isSuccessful) {
                throw IllegalStateException(extractErrorMessage(raw, "HTTP ${res.code}"))
            }
            parseOverlayState(JSONObject(raw))
        }
    }

    suspend fun deleteOverlayPng(baseUrl: String, endpoint: String): OverlayStudioState =
        withContext(Dispatchers.IO) {
            val req = requestBuilder(baseUrl, endpoint).delete().build()
            http.newCall(req).execute().use { res ->
                val raw = res.body?.string().orEmpty()
                if (!res.isSuccessful) {
                    throw IllegalStateException(extractErrorMessage(raw, "HTTP ${res.code}"))
                }
                parseOverlayState(JSONObject(raw))
            }
        }

    private fun requestBuilder(baseUrl: String, path: String): Request.Builder {
        val cleanBase = baseUrl.trim().trimEnd('/')
        return Request.Builder()
            .url("$cleanBase$path")
            .header("X-Livecast-Client", "livecast-android")
            .header("Accept", "application/json")
    }

    private fun extractErrorMessage(rawBody: String, fallback: String): String {
        if (rawBody.isBlank()) return fallback
        return try {
            val obj = JSONObject(rawBody)
            obj.optString("error").ifBlank { obj.optString("message", fallback) }
        } catch (_: Exception) {
            rawBody.take(180)
        }
    }

    private fun parseDestCreds(obj: JSONObject, defaultServer: String): DestinationPublicCreds {
        return DestinationPublicCreds(
            serverUrl = obj.optString("serverUrl", defaultServer).ifBlank { defaultServer },
            hasStreamKey = obj.optBoolean("hasStreamKey", false),
            maskedStreamKey = obj.optString("maskedStreamKey", "Not Configured"),
            updatedAt = if (obj.isNull("updatedAt")) null else obj.optString("updatedAt"),
        )
    }

    private fun parseTelemetry(obj: JSONObject): BroadcastTelemetry {
        val dests = obj.optJSONObject("destinations")
        val fb = dests?.optJSONObject("facebook")?.let { parseDestTelemetry(it, "facebook", "Facebook Live") }
            ?: DestinationTelemetry(id = "facebook", label = "Facebook Live")
        val yt = dests?.optJSONObject("youtube")?.let { parseDestTelemetry(it, "youtube", "YouTube Live") }
            ?: DestinationTelemetry(id = "youtube", label = "YouTube Live")
        return BroadcastTelemetry(
            status = obj.optString("status", "Offline"),
            quality = obj.optString("quality", "720p"),
            sourceLabel = if (obj.isNull("sourceLabel")) null else obj.optString("sourceLabel"),
            durationSec = obj.optInt("durationSec", 0),
            outputResolution = obj.optString("outputResolution", "1280x720"),
            bitrateKbps = obj.optInt("bitrateKbps", 0),
            fps = obj.optDouble("fps", 0.0),
            framesEncoded = obj.optInt("framesEncoded", 0),
            speed = obj.optString("speed", "0x"),
            lastError = if (obj.isNull("lastError")) null else obj.optString("lastError"),
            destinationMode = obj.optString("destinationMode", "facebook"),
            facebook = fb,
            youtube = yt,
        )
    }

    private fun parseDestTelemetry(obj: JSONObject, defaultId: String, defaultLabel: String): DestinationTelemetry {
        return DestinationTelemetry(
            id = obj.optString("id", defaultId),
            label = obj.optString("label", defaultLabel),
            connected = obj.optBoolean("connected", false),
            status = obj.optString("status", "Offline"),
            bitrateKbps = obj.optInt("bitrateKbps", 0),
            fps = obj.optInt("fps", 0),
            outputResolution = obj.optString("outputResolution", "1280x720"),
            droppedFrames = obj.optInt("droppedFrames", 0),
            latencyMs = obj.optInt("latencyMs", 0),
            lastError = if (obj.isNull("lastError")) null else obj.optString("lastError"),
        )
    }

    private fun parseOverlayState(obj: JSONObject): OverlayStudioState {
        return OverlayStudioState(
            logoEnabled = obj.optBoolean("logoEnabled", false),
            logoUrl = if (obj.isNull("logoUrl")) null else obj.optString("logoUrl"),
            logoPosition = obj.optString("logoPosition", "top-right"),
            logoScale = obj.optInt("logoScale", 12),
            logoOpacity = obj.optDouble("logoOpacity", 0.92).toFloat(),
            logoX = if (obj.isNull("logoX")) null else obj.optDouble("logoX").toFloat(),
            logoY = if (obj.isNull("logoY")) null else obj.optDouble("logoY").toFloat(),
            headlineEnabled = obj.optBoolean("headlineEnabled", false),
            headlineText = obj.optString("headlineText", "LIVE STUDIO BROADCAST"),
            headlineFontSize = obj.optInt("headlineFontSize", 28),
            headlineColor = obj.optString("headlineColor", "#FFFFFF"),
            headlineBgColor = obj.optString("headlineBgColor", "#0F172A"),
            headlineBgOpacity = obj.optDouble("headlineBgOpacity", 0.85).toFloat(),
            headlineAnimation = obj.optString("headlineAnimation", "fade"),
            breakingNewsEnabled = obj.optBoolean("breakingNewsEnabled", false),
            breakingNewsLabel = obj.optString("breakingNewsLabel", "BREAKING NEWS"),
            breakingNewsText = obj.optString("breakingNewsText", "Live studio coverage in progress."),
            breakingNewsBgColor = obj.optString("breakingNewsBgColor", "#DC2626"),
            breakingNewsTextColor = obj.optString("breakingNewsTextColor", "#FFFFFF"),
            breakingNewsOpacity = obj.optDouble("breakingNewsOpacity", 0.95).toFloat(),
            lowerThirdEnabled = obj.optBoolean("lowerThirdEnabled", false),
            lowerThirdTitle = obj.optString("lowerThirdTitle", "LIVECAST STUDIO"),
            lowerThirdSubtitle = obj.optString("lowerThirdSubtitle", "Authorized Live Broadcast Feed"),
            lowerThirdAccentColor = obj.optString("lowerThirdAccentColor", "#3B82F6"),
            lowerThirdBgColor = obj.optString("lowerThirdBgColor", "#0B0E14"),
            lowerThirdTextColor = obj.optString("lowerThirdTextColor", "#F8FAFC"),
            lowerThirdX = if (obj.isNull("lowerThirdX")) null else obj.optDouble("lowerThirdX").toFloat(),
            lowerThirdY = if (obj.isNull("lowerThirdY")) null else obj.optDouble("lowerThirdY").toFloat(),
            clockEnabled = obj.optBoolean("clockEnabled", false),
            clockPosition = obj.optString("clockPosition", "top-right"),
            clockFormat = obj.optString("clockFormat", "date-time"),
            clockFontSize = obj.optInt("clockFontSize", 18),
            clockColor = obj.optString("clockColor", "#F8FAFC"),
            clockBgColor = obj.optString("clockBgColor", "#0B0E14"),
            clockX = if (obj.isNull("clockX")) null else obj.optDouble("clockX").toFloat(),
            clockY = if (obj.isNull("clockY")) null else obj.optDouble("clockY").toFloat(),
            tickerEnabled = obj.optBoolean("tickerEnabled", false),
            tickerText = obj.optString("tickerText", "Welcome to the live broadcast. Stay tuned for updates."),
            tickerFontSize = obj.optInt("tickerFontSize", 20),
            tickerColor = obj.optString("tickerColor", "#F8FAFC"),
            tickerBgColor = obj.optString("tickerBgColor", "#1E293B"),
            tickerSpeed = obj.optInt("tickerSpeed", 95),
            customTextEnabled = obj.optBoolean("customTextEnabled", false),
            customText = obj.optString("customText", "LIVE BROADCAST"),
            customTextFontSize = obj.optInt("customTextFontSize", 24),
            customTextColor = obj.optString("customTextColor", "#FFFFFF"),
            customTextBgColor = obj.optString("customTextBgColor", "#1E1B4B"),
            customTextAlign = obj.optString("customTextAlign", "center"),
            customTextX = obj.optDouble("customTextX", 50.0).toFloat(),
            customTextY = obj.optDouble("customTextY", 16.0).toFloat(),
            imageOverlayEnabled = obj.optBoolean("imageOverlayEnabled", false),
            imageOverlayUrl = if (obj.isNull("imageOverlayUrl")) null else obj.optString("imageOverlayUrl"),
            imageOverlayX = obj.optDouble("imageOverlayX", 8.0).toFloat(),
            imageOverlayY = obj.optDouble("imageOverlayY", 18.0).toFloat(),
            imageOverlayScale = obj.optInt("imageOverlayScale", 18),
            imageOverlayOpacity = obj.optDouble("imageOverlayOpacity", 0.92).toFloat(),
        )
    }

    private fun parseLogArray(arr: JSONArray): List<String> {
        val list = ArrayList<String>(arr.length())
        for (i in 0 until arr.length()) {
            val obj = arr.optJSONObject(i) ?: continue
            val msg = formatLogEntry(obj)
            if (msg.isNotBlank()) list.add(msg)
        }
        return list
    }

    private fun formatLogEntry(obj: JSONObject): String {
        val lvl = obj.optString("level", "info").uppercase()
        val msg = obj.optString("message", "")
        if (msg.isBlank()) return ""
        return "[$lvl] $msg"
    }
}
