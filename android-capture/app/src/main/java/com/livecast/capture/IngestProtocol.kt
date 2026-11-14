package com.livecast.capture

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.tanh

enum class VideoCaptureStatus {
    IDLE,
    CAPTURING,
    PAUSED,
    ERROR,
}

enum class AudioCaptureStatus {
    IDLE,
    AUDIO_CAPTURED,
    AUDIO_NOT_AVAILABLE,
}

enum class ConnectionCaptureStatus {
    Disconnected,
    Connecting,
    Connected,
    Capturing,
    Reconnecting,
    Stopped,
    Error,
}

enum class DestinationMode(val apiValue: String, val label: String) {
    FACEBOOK("facebook", "Facebook Only"),
    YOUTUBE("youtube", "YouTube Only"),
    BOTH("both", "Facebook + YouTube"),
}

enum class VideoQualityPreset(
    val apiValue: String,
    val width: Int,
    val height: Int,
    val bitrateBps: Int,
    val label: String,
) {
    HD_720P("720p", 1280, 720, 3_000_000, "720p · 1280x720 · 3000k"),
    FHD_1080P("1080p", 1920, 1080, 5_000_000, "1080p · 1920x1080 · 5000k"),
}

data class CaptureUiState(
    val permissionGranted: Boolean = false,
    val connectionStatus: ConnectionCaptureStatus = ConnectionCaptureStatus.Disconnected,
    val videoStatus: VideoCaptureStatus = VideoCaptureStatus.IDLE,
    val audioStatus: AudioCaptureStatus = AudioCaptureStatus.IDLE,
    val micStatus: AudioCaptureStatus = AudioCaptureStatus.IDLE,
    val fps: Int = 0,
    val width: Int = 0,
    val height: Int = 0,
    val audioSampleRate: Int = 0,
    val latencyMs: Long = 0,
    val framesSent: Long = 0,
    val bitrateKbps: Int = 0,
    val audioReason: String? = null,
    val lastError: String? = null,
)

data class AudioMixerState(
    val internalEnabled: Boolean = true,
    val internalMuted: Boolean = false,
    val internalVolume: Float = 1.0f,
    val internalLevel: Float = 0f,
    val micEnabled: Boolean = false,
    val micMuted: Boolean = false,
    val micVolume: Float = 1.0f,
    val micLevel: Float = 0f,
    val micPermissionGranted: Boolean = false,
    val masterMuted: Boolean = false,
    val masterVolume: Float = 1.0f,
    val masterLevel: Float = 0f,
    val waveform: FloatArray = FloatArray(28),
) {
    fun effectiveInternalGain(): Float =
        if (!internalEnabled || internalMuted || masterMuted) 0f else internalVolume * masterVolume

    fun effectiveMicGain(): Float =
        if (!micEnabled || micMuted || masterMuted) 0f else micVolume * masterVolume
}

data class DestinationPublicCreds(
    val serverUrl: String = "",
    val hasStreamKey: Boolean = false,
    val maskedStreamKey: String = "Not Configured",
    val updatedAt: String? = null,
)

data class DestinationTelemetry(
    val id: String = "",
    val label: String = "",
    val connected: Boolean = false,
    val status: String = "Offline",
    val bitrateKbps: Int = 0,
    val fps: Int = 0,
    val outputResolution: String = "1280x720",
    val droppedFrames: Int = 0,
    val latencyMs: Int = 0,
    val lastError: String? = null,
)

data class BroadcastTelemetry(
    val status: String = "Offline",
    val quality: String = "720p",
    val sourceLabel: String? = null,
    val durationSec: Int = 0,
    val outputResolution: String = "1280x720",
    val bitrateKbps: Int = 0,
    val fps: Double = 0.0,
    val framesEncoded: Int = 0,
    val speed: String = "0x",
    val lastError: String? = null,
    val destinationMode: String = "facebook",
    val facebook: DestinationTelemetry = DestinationTelemetry(id = "facebook", label = "Facebook Live"),
    val youtube: DestinationTelemetry = DestinationTelemetry(id = "youtube", label = "YouTube Live"),
)

data class OverlayStudioState(
    val logoEnabled: Boolean = false,
    val logoUrl: String? = null,
    val logoPosition: String = "top-right",
    val logoScale: Int = 12,
    val logoOpacity: Float = 0.92f,
    val logoX: Float? = null,
    val logoY: Float? = null,

    val headlineEnabled: Boolean = false,
    val headlineText: String = "LIVE STUDIO BROADCAST",
    val headlineFontSize: Int = 28,
    val headlineColor: String = "#FFFFFF",
    val headlineBgColor: String = "#0F172A",
    val headlineBgOpacity: Float = 0.85f,
    val headlineAnimation: String = "fade",

    val breakingNewsEnabled: Boolean = false,
    val breakingNewsLabel: String = "BREAKING NEWS",
    val breakingNewsText: String = "Live studio coverage in progress.",
    val breakingNewsBgColor: String = "#DC2626",
    val breakingNewsTextColor: String = "#FFFFFF",
    val breakingNewsOpacity: Float = 0.95f,

    val lowerThirdEnabled: Boolean = false,
    val lowerThirdTitle: String = "LIVECAST STUDIO",
    val lowerThirdSubtitle: String = "Authorized Live Broadcast Feed",
    val lowerThirdAccentColor: String = "#3B82F6",
    val lowerThirdBgColor: String = "#0B0E14",
    val lowerThirdTextColor: String = "#F8FAFC",
    val lowerThirdX: Float? = null,
    val lowerThirdY: Float? = null,

    val clockEnabled: Boolean = false,
    val clockPosition: String = "top-right",
    val clockFormat: String = "date-time",
    val clockFontSize: Int = 18,
    val clockColor: String = "#F8FAFC",
    val clockBgColor: String = "#0B0E14",
    val clockX: Float? = null,
    val clockY: Float? = null,

    val tickerEnabled: Boolean = false,
    val tickerText: String = "Welcome to the live broadcast. Stay tuned for updates.",
    val tickerFontSize: Int = 20,
    val tickerColor: String = "#F8FAFC",
    val tickerBgColor: String = "#1E293B",
    val tickerSpeed: Int = 95,

    val customTextEnabled: Boolean = false,
    val customText: String = "LIVE BROADCAST",
    val customTextFontSize: Int = 24,
    val customTextColor: String = "#FFFFFF",
    val customTextBgColor: String = "#1E1B4B",
    val customTextAlign: String = "center",
    val customTextX: Float = 50f,
    val customTextY: Float = 16f,

    val imageOverlayEnabled: Boolean = false,
    val imageOverlayUrl: String? = null,
    val imageOverlayX: Float = 8f,
    val imageOverlayY: Float = 18f,
    val imageOverlayScale: Int = 18,
    val imageOverlayOpacity: Float = 0.92f,
)

object AudioMixerMath {
    fun mixPcm16Samples(
        internalSample: Short,
        micSample: Short,
        internalGain: Float,
        micGain: Float,
    ): Short {
        val mixedFloat = (internalSample.toFloat() * internalGain + micSample.toFloat() * micGain) / 32768f
        val shaped = if (mixedFloat > 0.92f || mixedFloat < -0.92f) {
            tanh(mixedFloat.toDouble()).toFloat()
        } else {
            mixedFloat
        }
        val scaled = (shaped * 32767f).toInt().coerceIn(-32768, 32767)
        return scaled.toShort()
    }
}

object IngestProtocol {
    const val MAGIC_0: Byte = 0x4C // 'L'
    const val MAGIC_1: Byte = 0x43 // 'C'
    const val PROTOCOL_VERSION: Byte = 0x01

    const val FRAME_VIDEO_CONFIG: Byte = 0x01
    const val FRAME_VIDEO_DATA: Byte = 0x02
    const val FRAME_AUDIO_CONFIG: Byte = 0x03
    const val FRAME_AUDIO_DATA: Byte = 0x04

    const val FLAG_KEYFRAME: Byte = 0x01
    const val HEADER_BYTES: Int = 16

    fun buildPacket(
        frameType: Byte,
        isKeyframe: Boolean,
        sequence: Int,
        ptsUs: Long,
        payload: ByteArray,
    ): ByteArray {
        val out = ByteArray(HEADER_BYTES + payload.size)
        val buf = ByteBuffer.wrap(out).order(ByteOrder.BIG_ENDIAN)
        buf.put(MAGIC_0)
        buf.put(MAGIC_1)
        buf.put(PROTOCOL_VERSION)
        buf.put(frameType)
        buf.put(if (isKeyframe) FLAG_KEYFRAME else 0x00)
        buf.putShort((sequence and 0xFFFF).toShort())
        buf.put(0x00)
        buf.putLong(ptsUs.coerceAtLeast(0L))
        if (payload.isNotEmpty()) {
            System.arraycopy(payload, 0, out, HEADER_BYTES, payload.size)
        }
        return out
    }

    fun extractYouTubeVideoId(rawUrl: String): String? {
        val trimmed = rawUrl.trim()
        if (trimmed.isEmpty()) return null
        val patterns = listOf(
            Regex("(?:v=|/live/|youtu\\.be/|/embed/|/shorts/)([A-Za-z0-9_-]{11})"),
            Regex("^([A-Za-z0-9_-]{11})$"),
        )
        for (regex in patterns) {
            val match = regex.find(trimmed)
            if (match != null && match.groupValues.size > 1) {
                return match.groupValues[1]
            }
        }
        return null
    }

    fun validateRtmpServerUrl(rawUrl: String): String? {
        val trimmed = rawUrl.trim()
        if (trimmed.isEmpty()) return "RTMP Server URL is required."
        if (Regex("^https?://(www\\.)?(youtube\\.com|youtu\\.be|m\\.youtube\\.com)", RegexOption.IGNORE_CASE).containsMatchIn(trimmed)) {
            return "YouTube watch/share links are for Monitor A Preview only. Use an RTMP ingest URL like rtmps://a.rtmps.youtube.com:443/live2."
        }
        if (!trimmed.startsWith("rtmp://", ignoreCase = true) && !trimmed.startsWith("rtmps://", ignoreCase = true)) {
            return "RTMP Server URL must begin with rtmp:// or rtmps://."
        }
        return null
    }
}
