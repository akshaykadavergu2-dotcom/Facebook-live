package com.livecast.capture

import android.annotation.SuppressLint
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.projection.MediaProjection
import android.os.Build
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs
import kotlin.math.sqrt

/**
 * Dual-channel broadcast Audio Mixer & AAC-LC encoder:
 * - Channel 1: Internal Preview Audio via AudioPlaybackCapture (Android 10+, USAGE_MEDIA & USAGE_UNKNOWN)
 * - Channel 2: Live Microphone via AudioRecord (VOICE_COMMUNICATION + AEC when supported)
 * Independent enable/mute/volume controls for both channels + Master Mute & Master Volume.
 * Never fakes playback capture audio when OS or content blocks AudioPlaybackCapture.
 */
class AudioMixerEngine(
    private val scope: CoroutineScope,
    private val mediaProjection: MediaProjection,
    private val monotonicClockBaseUs: Long,
    private val wsClient: CaptureWebSocketClient?,
    private val mp4Recorder: () -> Mp4ScreenRecorder? = { null },
    private val initialConfig: AudioMixerState,
    private val onStatusUpdate: (
        internalStatus: AudioCaptureStatus,
        micStatus: AudioCaptureStatus,
        sampleRate: Int,
        reason: String?,
    ) -> Unit,
    private val onLevelsUpdate: (internalLevel: Float, micLevel: Float, masterLevel: Float, waveform: FloatArray) -> Unit,
) {
    private val sampleRate = 44_100
    private val channels = 2
    private val chunkSizeBytes = 4096
    private val running = AtomicBoolean(false)

    @Volatile
    private var config: AudioMixerState = initialConfig
    @Volatile
    private var latestAudioFormat: MediaFormat? = null

    private var internalRecord: AudioRecord? = null
    private var micRecord: AudioRecord? = null
    private var micAec: AcousticEchoCanceler? = null
    private var aacCodec: MediaCodec? = null
    private var mixerJob: Job? = null

    fun currentAudioFormat(): MediaFormat? = latestAudioFormat

    fun updateConfig(newConfig: AudioMixerState) {
        config = newConfig
    }

    @SuppressLint("MissingPermission")
    fun start(hasRecordAudioPermission: Boolean) {
        if (running.getAndSet(true)) return

        var internalStatus = AudioCaptureStatus.IDLE
        var micStatus = AudioCaptureStatus.IDLE
        var statusReason: String? = null

        val minStereoBuf = AudioRecord.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_IN_STEREO,
            AudioFormat.ENCODING_PCM_16BIT,
        ).coerceAtLeast(8192)

        // 1. Attempt AudioPlaybackCapture (Android 10+ and RECORD_AUDIO granted)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && hasRecordAudioPermission) {
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

                val record = AudioRecord.Builder()
                    .setAudioFormat(audioFormat)
                    .setBufferSizeInBytes(minStereoBuf * 2)
                    .setAudioPlaybackCaptureConfig(captureConfig)
                    .build()

                if (record.state == AudioRecord.STATE_INITIALIZED) {
                    record.startRecording()
                    internalRecord = record
                    internalStatus = AudioCaptureStatus.AUDIO_CAPTURED
                } else {
                    record.release()
                    internalStatus = AudioCaptureStatus.AUDIO_NOT_AVAILABLE
                    statusReason = "AudioPlaybackCapture failed to initialize."
                }
            } catch (err: Exception) {
                internalStatus = AudioCaptureStatus.AUDIO_NOT_AVAILABLE
                statusReason = "Internal audio unavailable: ${err.message}"
            }
        } else {
            internalStatus = AudioCaptureStatus.AUDIO_NOT_AVAILABLE
            statusReason = if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                "Android 10+ required for internal playback capture."
            } else {
                "RECORD_AUDIO permission not granted."
            }
        }

        // 2. Initialize Microphone AudioRecord when permission is granted
        if (hasRecordAudioPermission) {
            try {
                val minMonoBuf = AudioRecord.getMinBufferSize(
                    sampleRate,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                ).coerceAtLeast(4096)

                val micFormat = AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(sampleRate)
                    .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                    .build()

                val mic = AudioRecord.Builder()
                    .setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
                    .setAudioFormat(micFormat)
                    .setBufferSizeInBytes(minMonoBuf * 2)
                    .build()

                if (mic.state == AudioRecord.STATE_INITIALIZED) {
                    if (AcousticEchoCanceler.isAvailable()) {
                        try {
                            micAec = AcousticEchoCanceler.create(mic.audioSessionId)?.apply {
                                enabled = true
                            }
                        } catch (_: Exception) {
                        }
                    }
                    mic.startRecording()
                    micRecord = mic
                    micStatus = AudioCaptureStatus.AUDIO_CAPTURED
                } else {
                    mic.release()
                    micStatus = AudioCaptureStatus.AUDIO_NOT_AVAILABLE
                }
            } catch (_: Exception) {
                micStatus = AudioCaptureStatus.AUDIO_NOT_AVAILABLE
            }
        } else {
            micStatus = AudioCaptureStatus.AUDIO_NOT_AVAILABLE
        }

        // If neither audio source can be initialized, stop cleanly and report
        if (internalRecord == null && micRecord == null) {
            running.set(false)
            releaseResources()
            onStatusUpdate(internalStatus, micStatus, 0, statusReason)
            return
        }

        try {
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
                setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, minStereoBuf * 2)
            }

            val encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
            encoder.configure(aacFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            encoder.start()
            aacCodec = encoder

            onStatusUpdate(internalStatus, micStatus, sampleRate, statusReason)

            mixerJob = scope.launch(Dispatchers.IO) {
                pumpMixedAudioLoop(internalStatus, micStatus, encoder)
            }
        } catch (err: Exception) {
            running.set(false)
            releaseResources()
            onStatusUpdate(
                AudioCaptureStatus.AUDIO_NOT_AVAILABLE,
                AudioCaptureStatus.AUDIO_NOT_AVAILABLE,
                0,
                "AAC encoder init failed: ${err.message}",
            )
        }
    }

    private fun pumpMixedAudioLoop(
        initialInternalStatus: AudioCaptureStatus,
        initialMicStatus: AudioCaptureStatus,
        encoder: MediaCodec,
    ) {
        val internalStereoBuf = ByteArray(chunkSizeBytes) // 1024 stereo frames = 2048 shorts
        val micMonoBuf = ByteArray(chunkSizeBytes / 2)    // 1024 mono frames = 1024 shorts
        val mixedOutBuf = ByteArray(chunkSizeBytes)
        val outInfo = MediaCodec.BufferInfo()

        var sentAudioConfig = false
        var silentInternalChunks = 0
        var confirmedInternalAudio = false
        var currentInternalStatus = initialInternalStatus
        var lastUiLevelPostMs = 0L

        try {
            while (running.get() && scope.isActive) {
                val cfg = config
                val internalGain = cfg.effectiveInternalGain()
                val micGain = cfg.effectiveMicGain()

                var internalRead = 0
                val intRec = internalRecord
                if (intRec != null) {
                    internalRead = intRec.read(internalStereoBuf, 0, internalStereoBuf.size)
                    if (internalRead > 0 && currentInternalStatus == AudioCaptureStatus.AUDIO_CAPTURED) {
                        if (hasSignal(internalStereoBuf, internalRead)) {
                            silentInternalChunks = 0
                            if (!confirmedInternalAudio) {
                                confirmedInternalAudio = true
                            }
                        } else if (!confirmedInternalAudio) {
                            silentInternalChunks += 1
                            if (silentInternalChunks == 200) {
                                // Note: Do not stop mic if mic is active; report honest internal status
                                onStatusUpdate(
                                    AudioCaptureStatus.AUDIO_NOT_AVAILABLE,
                                    initialMicStatus,
                                    sampleRate,
                                    "Internal preview returned silence (DRM/app policy or paused player).",
                                )
                            }
                        }
                    }
                }

                var micRead = 0
                val mRec = micRecord
                if (mRec != null) {
                    micRead = mRec.read(micMonoBuf, 0, micMonoBuf.size)
                }

                val framesFromInternal = (internalRead / 4).coerceAtLeast(0)
                val framesFromMic = (micRead / 2).coerceAtLeast(0)
                val frameCount = maxOf(framesFromInternal, framesFromMic).coerceAtMost(chunkSizeBytes / 4)
                if (frameCount <= 0) continue

                var sumSqInternal = 0.0
                var sumSqMic = 0.0
                var sumSqMaster = 0.0

                val waveform = FloatArray(28)
                val framesPerBand = (frameCount / waveform.size).coerceAtLeast(1)

                for (frameIdx in 0 until frameCount) {
                    val intL = if (frameIdx < framesFromInternal) {
                        readLittleEndianShort(internalStereoBuf, frameIdx * 4)
                    } else 0
                    val intR = if (frameIdx < framesFromInternal) {
                        readLittleEndianShort(internalStereoBuf, frameIdx * 4 + 2)
                    } else 0
                    val micMono = if (frameIdx < framesFromMic) {
                        readLittleEndianShort(micMonoBuf, frameIdx * 2)
                    } else 0

                    val intNorm = ((abs(intL.toInt()) + abs(intR.toInt())) * 0.5f) / 32768f
                    val micNorm = abs(micMono.toInt()) / 32768f
                    sumSqInternal += (intNorm * internalGain) * (intNorm * internalGain)
                    sumSqMic += (micNorm * micGain) * (micNorm * micGain)

                    val outL = AudioMixerMath.mixPcm16Samples(intL, micMono, internalGain, micGain)
                    val outR = AudioMixerMath.mixPcm16Samples(intR, micMono, internalGain, micGain)

                    writeLittleEndianShort(mixedOutBuf, frameIdx * 4, outL)
                    writeLittleEndianShort(mixedOutBuf, frameIdx * 4 + 2, outR)

                    val masterNorm = ((abs(outL.toInt()) + abs(outR.toInt())) * 0.5f) / 32768f
                    sumSqMaster += masterNorm * masterNorm

                    val bandIdx = (frameIdx / framesPerBand).coerceIn(0, waveform.lastIndex)
                    if (masterNorm > waveform[bandIdx]) {
                        waveform[bandIdx] = (masterNorm * 2.4f).coerceIn(0f, 1f)
                    }
                }

                val nowMs = System.currentTimeMillis()
                if (nowMs - lastUiLevelPostMs >= 50L) {
                    lastUiLevelPostMs = nowMs
                    val intLvl = (sqrt(sumSqInternal / frameCount).toFloat() * 3.0f).coerceIn(0f, 1f)
                    val micLvl = (sqrt(sumSqMic / frameCount).toFloat() * 3.2f).coerceIn(0f, 1f)
                    val masLvl = (sqrt(sumSqMaster / frameCount).toFloat() * 3.0f).coerceIn(0f, 1f)
                    onLevelsUpdate(intLvl, micLvl, masLvl, waveform)
                }

                val mixedBytes = frameCount * 4
                val nowUs = ((System.nanoTime() / 1000L) - monotonicClockBaseUs).coerceAtLeast(0L)
                val inIdx = encoder.dequeueInputBuffer(10_000)
                if (inIdx >= 0) {
                    val inBuf = encoder.getInputBuffer(inIdx)
                    if (inBuf != null) {
                        inBuf.clear()
                        val putLen = mixedBytes.coerceAtMost(inBuf.capacity())
                        inBuf.put(mixedOutBuf, 0, putLen)
                        encoder.queueInputBuffer(inIdx, 0, putLen, nowUs, 0)
                    }
                }

                var outIdx = encoder.dequeueOutputBuffer(outInfo, 0)
                while (outIdx >= 0 || outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    if (outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                        val outFormat = encoder.outputFormat
                        latestAudioFormat = outFormat
                        mp4Recorder()?.onAudioFormatChanged(outFormat)
                        val csd0 = outFormat.getByteBuffer("csd-0")
                        if (csd0 != null) {
                            val dup = csd0.duplicate()
                            dup.clear()
                            val cfgBytes = ByteArray(dup.remaining())
                            dup.get(cfgBytes)
                            if (cfgBytes.isNotEmpty()) {
                                wsClient?.sendBinaryFrame(
                                    frameType = IngestProtocol.FRAME_AUDIO_CONFIG,
                                    isKeyframe = true,
                                    ptsUs = 0L,
                                    payload = cfgBytes,
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
                                wsClient?.sendBinaryFrame(
                                    frameType = IngestProtocol.FRAME_AUDIO_CONFIG,
                                    isKeyframe = true,
                                    ptsUs = 0L,
                                    payload = bytes,
                                )
                                sentAudioConfig = true
                            } else if (sentAudioConfig) {
                                val framePts = outInfo.presentationTimeUs.coerceAtLeast(0L)
                                wsClient?.sendBinaryFrame(
                                    frameType = IngestProtocol.FRAME_AUDIO_DATA,
                                    isKeyframe = false,
                                    ptsUs = framePts,
                                    payload = bytes,
                                )
                                val activeRec = mp4Recorder()
                                if (activeRec != null) {
                                    latestAudioFormat?.let { activeRec.onAudioFormatChanged(it) }
                                    activeRec.writeAudioSample(bytes, framePts)
                                }
                            }
                        }
                        encoder.releaseOutputBuffer(outIdx, false)
                    }
                    outIdx = encoder.dequeueOutputBuffer(outInfo, 0)
                }
            }
        } catch (err: Exception) {
            onStatusUpdate(
                AudioCaptureStatus.AUDIO_NOT_AVAILABLE,
                AudioCaptureStatus.AUDIO_NOT_AVAILABLE,
                0,
                "Audio mixer stopped: ${err.message}",
            )
        } finally {
            releaseResources()
        }
    }

    private fun readLittleEndianShort(buf: ByteArray, offset: Int): Short {
        val lo = buf[offset].toInt() and 0xFF
        val hi = buf[offset + 1].toInt() shl 8
        return (lo or hi).toShort()
    }

    private fun writeLittleEndianShort(buf: ByteArray, offset: Int, value: Short) {
        val v = value.toInt()
        buf[offset] = (v and 0xFF).toByte()
        buf[offset + 1] = ((v ushr 8) and 0xFF).toByte()
    }

    private fun hasSignal(buf: ByteArray, len: Int): Boolean {
        var i = 0
        while (i + 1 < len) {
            if (abs(readLittleEndianShort(buf, i).toInt()) > 12) return true
            i += 2
        }
        return false
    }

    fun stop() {
        if (!running.getAndSet(false)) return
        mixerJob?.cancel()
        mixerJob = null
        releaseResources()
        onStatusUpdate(AudioCaptureStatus.IDLE, AudioCaptureStatus.IDLE, 0, null)
        onLevelsUpdate(0f, 0f, 0f, FloatArray(28))
    }

    private fun releaseResources() {
        try {
            micAec?.release()
        } catch (_: Exception) {
        }
        micAec = null

        try {
            internalRecord?.stop()
        } catch (_: Exception) {
        }
        try {
            internalRecord?.release()
        } catch (_: Exception) {
        }
        internalRecord = null

        try {
            micRecord?.stop()
        } catch (_: Exception) {
        }
        try {
            micRecord?.release()
        } catch (_: Exception) {
        }
        micRecord = null

        try {
            aacCodec?.stop()
            aacCodec?.release()
        } catch (_: Exception) {
        }
        aacCodec = null
    }
}
