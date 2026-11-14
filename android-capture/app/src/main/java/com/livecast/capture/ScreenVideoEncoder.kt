package com.livecast.capture

import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.projection.MediaProjection
import android.view.Surface
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicBoolean

class ScreenVideoEncoder(
    private val scope: CoroutineScope,
    private val mediaProjection: MediaProjection,
    private val width: Int = 1280,
    private val height: Int = 720,
    private val targetFps: Int = 30,
    private val bitrateBps: Int = 3_000_000,
    private val densityDpi: Int,
    private val monotonicClockBaseUs: Long,
    private val wsClient: CaptureWebSocketClient?,
    private val mp4Recorder: () -> Mp4ScreenRecorder? = { null },
    private val onStats: (fps: Int, width: Int, height: Int, status: VideoCaptureStatus) -> Unit,
    private val onError: (String) -> Unit,
) {
    private var codec: MediaCodec? = null
    private var inputSurface: Surface? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var drainJob: Job? = null
    private val running = AtomicBoolean(false)
    @Volatile
    private var latestOutputFormat: MediaFormat? = null

    fun currentOutputFormat(): MediaFormat? = latestOutputFormat

    fun start() {
        if (running.getAndSet(true)) return

        try {
            val safeFps = targetFps.coerceIn(15, 60)
            val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
                setInteger(
                    MediaFormat.KEY_COLOR_FORMAT,
                    MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface,
                )
                setInteger(MediaFormat.KEY_BIT_RATE, bitrateBps)
                setInteger(MediaFormat.KEY_FRAME_RATE, safeFps)
                setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 2)
            }

            val encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
            encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            val surface = encoder.createInputSurface()
            encoder.start()

            val display = mediaProjection.createVirtualDisplay(
                "LivecastMonitorACapture",
                width,
                height,
                densityDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                surface,
                null,
                null,
            )

            codec = encoder
            inputSurface = surface
            virtualDisplay = display
            onStats(0, width, height, VideoCaptureStatus.CAPTURING)

            drainJob = scope.launch(Dispatchers.Default) {
                drainLoop(encoder)
            }
        } catch (err: Exception) {
            running.set(false)
            releaseResources()
            onStats(0, 0, 0, VideoCaptureStatus.ERROR)
            onError("H.264 MediaCodec video capture initialization failed: ${err.message}")
        }
    }

    private fun drainLoop(encoder: MediaCodec) {
        val info = MediaCodec.BufferInfo()
        var windowFrames = 0
        var windowStartMs = System.currentTimeMillis()
        var sentConfig = false
        var videoPtsBaseUs: Long? = null

        try {
            while (running.get() && scope.isActive) {
                val outIndex = encoder.dequeueOutputBuffer(info, 15_000)
                when {
                    outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        val outFormat = encoder.outputFormat
                        latestOutputFormat = outFormat
                        mp4Recorder()?.onVideoFormatChanged(outFormat)
                        val configBytes = extractAnnexBConfig(outFormat)
                        if (configBytes != null && configBytes.isNotEmpty()) {
                            wsClient?.sendBinaryFrame(
                                frameType = IngestProtocol.FRAME_VIDEO_CONFIG,
                                isKeyframe = true,
                                ptsUs = 0L,
                                payload = configBytes,
                            )
                            sentConfig = true
                        }
                    }

                    outIndex >= 0 -> {
                        val encodedBuf = encoder.getOutputBuffer(outIndex)
                        if (encodedBuf != null && info.size > 0) {
                            val bytes = ByteArray(info.size)
                            encodedBuf.position(info.offset)
                            encodedBuf.limit(info.offset + info.size)
                            encodedBuf.get(bytes)

                            val isCodecConfig = (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0
                            if (isCodecConfig) {
                                wsClient?.sendBinaryFrame(
                                    frameType = IngestProtocol.FRAME_VIDEO_CONFIG,
                                    isKeyframe = true,
                                    ptsUs = 0L,
                                    payload = bytes,
                                )
                                sentConfig = true
                            } else {
                                if (!sentConfig) {
                                    val fallbackCfg = extractAnnexBConfig(encoder.outputFormat)
                                    if (fallbackCfg != null && fallbackCfg.isNotEmpty()) {
                                        wsClient?.sendBinaryFrame(
                                            frameType = IngestProtocol.FRAME_VIDEO_CONFIG,
                                            isKeyframe = true,
                                            ptsUs = 0L,
                                            payload = fallbackCfg,
                                        )
                                        sentConfig = true
                                    }
                                }

                                val wallElapsedUs = ((System.nanoTime() / 1000L) - monotonicClockBaseUs).coerceAtLeast(0L)
                                val base = videoPtsBaseUs ?: (info.presentationTimeUs - wallElapsedUs).also {
                                    videoPtsBaseUs = it
                                }
                                val isKey = (info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME) != 0
                                val relPtsUs = (info.presentationTimeUs - base).coerceAtLeast(0L)
                                wsClient?.sendBinaryFrame(
                                    frameType = IngestProtocol.FRAME_VIDEO_DATA,
                                    isKeyframe = isKey,
                                    ptsUs = relPtsUs,
                                    payload = bytes,
                                )
                                val activeRec = mp4Recorder()
                                if (activeRec != null) {
                                    latestOutputFormat?.let { activeRec.onVideoFormatChanged(it) }
                                    activeRec.writeVideoSample(bytes, relPtsUs, isKey)
                                }

                                windowFrames += 1
                                val now = System.currentTimeMillis()
                                val elapsed = now - windowStartMs
                                if (elapsed >= 1000L) {
                                    val fps = ((windowFrames * 1000L) / elapsed).toInt()
                                    onStats(fps, width, height, VideoCaptureStatus.CAPTURING)
                                    windowFrames = 0
                                    windowStartMs = now
                                }
                            }
                        }
                        encoder.releaseOutputBuffer(outIndex, false)
                    }
                }
            }
        } catch (err: Exception) {
            if (running.get()) {
                onStats(0, width, height, VideoCaptureStatus.ERROR)
                onError("Video encoder loop interrupted: ${err.message}")
            }
        }
    }

    private fun extractAnnexBConfig(format: MediaFormat): ByteArray? {
        val sps = format.getByteBuffer("csd-0")?.toByteArray() ?: ByteArray(0)
        val pps = format.getByteBuffer("csd-1")?.toByteArray() ?: ByteArray(0)
        if (sps.isEmpty() && pps.isEmpty()) return null
        return sps + pps
    }

    private fun ByteBuffer.toByteArray(): ByteArray {
        val dup = duplicate()
        dup.clear()
        val arr = ByteArray(dup.remaining())
        dup.get(arr)
        return arr
    }

    fun stop() {
        if (!running.getAndSet(false)) return
        drainJob?.cancel()
        drainJob = null
        releaseResources()
        onStats(0, 0, 0, VideoCaptureStatus.IDLE)
    }

    private fun releaseResources() {
        try {
            virtualDisplay?.release()
        } catch (_: Exception) {
        }
        virtualDisplay = null

        try {
            codec?.stop()
            codec?.release()
        } catch (_: Exception) {
        }
        codec = null

        try {
            inputSurface?.release()
        } catch (_: Exception) {
        }
        inputSurface = null
    }
}
