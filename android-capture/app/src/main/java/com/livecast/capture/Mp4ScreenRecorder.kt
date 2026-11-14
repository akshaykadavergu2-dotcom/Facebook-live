package com.livecast.capture

import android.media.MediaCodec
import android.media.MediaFormat
import android.media.MediaMuxer
import java.io.File
import java.nio.ByteBuffer

enum class RecordingStatus {
    IDLE,
    RECORDING,
    PAUSED,
    SAVED,
    ERROR,
}

data class RecordingUiState(
    val status: RecordingStatus = RecordingStatus.IDLE,
    val elapsedSec: Int = 0,
    val resolutionLabel: String = "1280x720",
    val fps: Int = 30,
    val outputFilePath: String? = null,
    val outputFileSizeBytes: Long = 0L,
    val statusMessage: String = "Ready · Captures ONLY the dedicated Monitor A Preview Activity",
)

/**
 * Thread-safe MP4 MediaMuxer screen recorder that records the live H.264 + AAC frames
 * produced while capturing the dedicated Monitor A Preview Activity.
 * Supports Pause & Resume by tracking total paused duration in microseconds.
 */
class Mp4ScreenRecorder(
    private val outputFile: File,
    private val onError: (String) -> Unit,
) {
    private val lock = Any()
    private var muxer: MediaMuxer? = null
    private var videoTrackIndex = -1
    private var audioTrackIndex = -1
    private var muxerStarted = false
    private var stopped = false
    private var paused = false
    private var pauseStartUs = 0L
    private var totalPausedUs = 0L

    init {
        try {
            outputFile.parentFile?.mkdirs()
            muxer = MediaMuxer(outputFile.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        } catch (err: Exception) {
            stopped = true
            onError("Failed to initialize MP4 MediaMuxer: ${err.message}")
        }
    }

    fun onVideoFormatChanged(format: MediaFormat) {
        synchronized(lock) {
            if (stopped || muxerStarted || videoTrackIndex >= 0) return
            try {
                videoTrackIndex = muxer?.addTrack(format) ?: -1
                tryStartMuxerLocked()
            } catch (err: Exception) {
                onError("MP4 video track config error: ${err.message}")
            }
        }
    }

    fun onAudioFormatChanged(format: MediaFormat) {
        synchronized(lock) {
            if (stopped || muxerStarted || audioTrackIndex >= 0) return
            try {
                audioTrackIndex = muxer?.addTrack(format) ?: -1
                tryStartMuxerLocked()
            } catch (_: Exception) {
                // Audio track is optional if internal audio is blocked
            }
        }
    }

    private fun tryStartMuxerLocked() {
        if (muxerStarted || stopped) return
        if (videoTrackIndex >= 0) {
            try {
                muxer?.start()
                muxerStarted = true
            } catch (err: Exception) {
                onError("Failed to start MP4 MediaMuxer: ${err.message}")
            }
        }
    }

    fun writeVideoSample(data: ByteArray, ptsUs: Long, isKeyframe: Boolean) {
        synchronized(lock) {
            if (stopped || paused || !muxerStarted || videoTrackIndex < 0) return
            try {
                val adjPts = (ptsUs - totalPausedUs).coerceAtLeast(0L)
                val info = MediaCodec.BufferInfo().apply {
                    offset = 0
                    size = data.size
                    presentationTimeUs = adjPts
                    flags = if (isKeyframe) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0
                }
                muxer?.writeSampleData(videoTrackIndex, ByteBuffer.wrap(data), info)
            } catch (_: Exception) {
            }
        }
    }

    fun writeAudioSample(data: ByteArray, ptsUs: Long) {
        synchronized(lock) {
            if (stopped || paused || !muxerStarted || audioTrackIndex < 0) return
            try {
                val adjPts = (ptsUs - totalPausedUs).coerceAtLeast(0L)
                val info = MediaCodec.BufferInfo().apply {
                    offset = 0
                    size = data.size
                    presentationTimeUs = adjPts
                    flags = 0
                }
                muxer?.writeSampleData(audioTrackIndex, ByteBuffer.wrap(data), info)
            } catch (_: Exception) {
            }
        }
    }

    fun pause() {
        synchronized(lock) {
            if (stopped || paused) return
            paused = true
            pauseStartUs = System.nanoTime() / 1000L
        }
    }

    fun resume() {
        synchronized(lock) {
            if (stopped || !paused) return
            val nowUs = System.nanoTime() / 1000L
            if (pauseStartUs > 0L && nowUs > pauseStartUs) {
                totalPausedUs += (nowUs - pauseStartUs)
            }
            pauseStartUs = 0L
            paused = false
        }
    }

    fun stopAndFinalize(): File? {
        synchronized(lock) {
            if (stopped) return if (outputFile.exists() && outputFile.length() > 0L) outputFile else null
            stopped = true
            try {
                if (muxerStarted) {
                    muxer?.stop()
                }
            } catch (_: Exception) {
            }
            try {
                muxer?.release()
            } catch (_: Exception) {
            }
            muxer = null
            muxerStarted = false
            return if (outputFile.exists() && outputFile.length() > 0L) outputFile else null
        }
    }
}
