package com.livecast.capture

import java.nio.ByteBuffer
import java.nio.ByteOrder

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

data class CaptureUiState(
    val permissionGranted: Boolean = false,
    val connectionStatus: ConnectionCaptureStatus = ConnectionCaptureStatus.Disconnected,
    val videoStatus: VideoCaptureStatus = VideoCaptureStatus.IDLE,
    val audioStatus: AudioCaptureStatus = AudioCaptureStatus.IDLE,
    val fps: Int = 0,
    val width: Int = 0,
    val height: Int = 0,
    val audioSampleRate: Int = 0,
    val latencyMs: Long = 0,
    val lastError: String? = null,
)

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

    /**
     * Packages an encoded H.264/AAC chunk using Livecast Studio's 16-byte LC binary ingest header:
     * [0..1]   "LC"
     * [2]      Version (0x01)
     * [3]      Frame type
     * [4]      Flags (bit 0 = keyframe)
     * [5..6]   Sequence uint16 BE
     * [7]      Reserved 0x00
     * [8..15]  ptsUs int64 BE
     */
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
}
