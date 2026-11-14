package com.livecast.capture

import android.annotation.SuppressLint
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.projection.MediaProjection
import android.os.Build
import android.os.SystemClock
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs

class AudioPlaybackCaptureEngine(
    private val scope: CoroutineScope,
    private val mediaProjection: MediaProjection,
    private val monotonicClockBaseUs: Long,
    private val wsClient: CaptureWebSocketClient,
    private val onAudioStatus: (AudioCaptureStatus, sampleRate: Int) -> Unit,
) {
    private val sampleRate = 44_100
    private val channels = 2
    private val running = AtomicBoolean(false)

    private var audioRecord: AudioRecord? = null
    private var aacCodec: MediaCodec? = null
    private var captureJob: Job? = null

    @SuppressLint("MissingPermission")
    fun start(hasRecordAudioPermission: Boolean) {
        if (running.getAndSet(true)) return

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || !hasRecordAudioPermission) {
            running.set(false)
            onAudioStatus(AudioCaptureStatus.AUDIO_NOT_AVAILABLE, 0)
            return
        }

        try {
            val captureConfig = AudioPlaybackCaptureConfiguration.Builder(mediaProjection)
                .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                .build()

            val audioFormat = AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(sampleRate)
                .setChannelMask(AudioFormat.CHANNEL_IN_STEREO)
                .build()

            val minBufBytes = AudioRecord.getMinBufferSize(
                sampleRate,
                AudioFormat.CHANNEL_IN_STEREO,
                AudioFormat.ENCODING_PCM_16BIT,
            ).coerceAtLeast(8192)

            val record = AudioRecord.Builder()
                .setAudioFormat(audioFormat)
                .setBufferSizeInBytes(minBufBytes * 2)
                .setAudioPlaybackCaptureConfig(captureConfig)
                .build()

            if (record.state != AudioRecord.STATE_INITIALIZED) {
                record.release()
                running.set(false)
                onAudioStatus(AudioCaptureStatus.AUDIO_NOT_AVAILABLE, 0)
                return
            }

            val aacFormat = MediaFormat.createAudioFormat(
                MediaFormat.MIMETYPE_AUDIO_AAC,
                sampleRate,
                channels,
            ).apply {
                setInteger(
                    MediaFormat.KEY_AAC_PROFILE,
                    MediaCodecInfo.CodecProfileLevel.AACObjectLC,
                )
                setInteger(MediaFormat.KEY_BIT_RATE, 128_000)
                setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, minBufBytes * 2)
            }

            val encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
            encoder.configure(aacFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            encoder.start()
            record.startRecording()

            audioRecord = record
            aacCodec = encoder

            captureJob = scope.launch(Dispatchers.IO) {
                pumpAudioLoop(record, encoder)
            }
        } catch (_: Exception) {
            running.set(false)
            releaseResources()
            onAudioStatus(AudioCaptureStatus.AUDIO_NOT_AVAILABLE, 0)
        }
    }

    private fun pumpAudioLoop(record: AudioRecord, encoder: MediaCodec) {
        val pcmBuffer = ByteArray(4096)
        val outInfo = MediaCodec.BufferInfo()
        var silentChunks = 0
        var confirmedLiveAudio = false
        var sentAudioConfig = false

        try {
            while (running.get() && scope.isActive) {
                val readBytes = record.read(pcmBuffer, 0, pcmBuffer.size)
                if (readBytes <= 0) continue

                val hasSignal = detectNonSilentPcm(pcmBuffer, readBytes)
                if (hasSignal) {
                    silentChunks = 0
                    if (!confirmedLiveAudio) {
                        confirmedLiveAudio = true
                        onAudioStatus(AudioCaptureStatus.AUDIO_CAPTURED, sampleRate)
                    }
                } else if (!confirmedLiveAudio) {
                    silentChunks += 1
                    // ~4 seconds of continuous digital silence usually indicates protected/denied playback capture
                    if (silentChunks >= 170) {
                        onAudioStatus(AudioCaptureStatus.AUDIO_NOT_AVAILABLE, 0)
                        running.set(false)
                        break
                    }
                    continue
                }

                val nowUs = ((System.nanoTime() / 1000L) - monotonicClockBaseUs).coerceAtLeast(0L)
                val inIdx = encoder.dequeueInputBuffer(10_000)
                if (inIdx >= 0) {
                    val inBuf = encoder.getInputBuffer(inIdx)
                    if (inBuf != null) {
                        inBuf.clear()
                        inBuf.put(pcmBuffer, 0, readBytes.coerceAtMost(inBuf.capacity()))
                        encoder.queueInputBuffer(inIdx, 0, readBytes.coerceAtMost(inBuf.capacity()), nowUs, 0)
                    }
                }

                var outIdx = encoder.dequeueOutputBuffer(outInfo, 0)
                while (outIdx >= 0 || outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    if (outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                        val csd0 = encoder.outputFormat.getByteBuffer("csd-0")
                        if (csd0 != null) {
                            val dup = csd0.duplicate()
                            dup.clear()
                            val cfg = ByteArray(dup.remaining())
                            dup.get(cfg)
                            if (cfg.isNotEmpty()) {
                                wsClient.sendBinaryFrame(
                                    frameType = IngestProtocol.FRAME_AUDIO_CONFIG,
                                    isKeyframe = true,
                                    ptsUs = 0L,
                                    payload = cfg,
                                )
                                sentAudioConfig = true
                            }
                        }
                    } else if (outIdx >= 0) {
                        val outBuf = encoder.getOutputBuffer(outIdx)
                        if (outBuf != null && outInfo.size > 0) {
                            val bytes = ByteArray(outInfo.size)
                            outBuf.position(outInfo.offset)
                            outBuf.limit(outInfo.offset + outInfo.size)
                            outBuf.get(bytes)

                            val isCfg = (outInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0
                            if (isCfg) {
                                wsClient.sendBinaryFrame(
                                    frameType = IngestProtocol.FRAME_AUDIO_CONFIG,
                                    isKeyframe = true,
                                    ptsUs = 0L,
                                    payload = bytes,
                                )
                                sentAudioConfig = true
                            } else if (sentAudioConfig) {
                                val framePts = outInfo.presentationTimeUs.coerceAtLeast(0L)
                                wsClient.sendBinaryFrame(
                                    frameType = IngestProtocol.FRAME_AUDIO_DATA,
                                    isKeyframe = false,
                                    ptsUs = framePts,
                                    payload = bytes,
                                )
                            }
                        }
                        encoder.releaseOutputBuffer(outIdx, false)
                    }
                    outIdx = encoder.dequeueOutputBuffer(outInfo, 0)
                }
            }
        } catch (_: Exception) {
            onAudioStatus(AudioCaptureStatus.AUDIO_NOT_AVAILABLE, 0)
        } finally {
            releaseResources()
        }
    }

    private fun detectNonSilentPcm(buf: ByteArray, length: Int): Boolean {
        var i = 0
        while (i + 1 < length) {
            val sample = (buf[i].toInt() and 0xFF) or (buf[i + 1].toInt() shl 8)
            val signed = sample.toShort().toInt()
            if (abs(signed) > 12) {
                return true
            }
            i += 2
        }
        return false
    }

    fun stop() {
        if (!running.getAndSet(false)) return
        captureJob?.cancel()
        captureJob = null
        releaseResources()
        onAudioStatus(AudioCaptureStatus.IDLE, 0)
    }

    private fun releaseResources() {
        try {
            audioRecord?.stop()
        } catch (_: Exception) {
        }
        try {
            audioRecord?.release()
        } catch (_: Exception) {
        }
        audioRecord = null

        try {
            aacCodec?.stop()
            aacCodec?.release()
        } catch (_: Exception) {
        }
        aacCodec = null
    }
}
