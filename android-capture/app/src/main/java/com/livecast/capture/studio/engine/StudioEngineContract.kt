package com.livecast.capture.studio.engine

import com.livecast.capture.studio.model.StudioProject
import kotlinx.coroutines.flow.StateFlow

enum class EngineStatus { IDLE, PREVIEWING, LIVE, RECORDING, ERROR }

data class EngineSnapshot(
    val status: EngineStatus = EngineStatus.IDLE,
    val outputFps: Float = 0f,
    val bitrateKbps: Int = 0,
    val droppedFrames: Long = 0,
    val lastError: String? = null,
)

/**
 * Stable boundary between the UI and platform media implementations.
 * Android implementation will use Camera2, MediaProjection, OpenGL ES,
 * MediaCodec and AudioRecord/Oboe. iOS will implement the same contract
 * with AVFoundation, Metal and VideoToolbox.
 */
interface StudioEngine {
    val snapshot: StateFlow<EngineSnapshot>
    suspend fun loadProject(project: StudioProject)
    suspend fun startPreview()
    suspend fun startRecording()
    suspend fun startStreaming(destinations: List<StreamDestination>)
    suspend fun stopOutput()
    suspend fun release()
}

data class StreamDestination(
    val id: String,
    val label: String,
    val endpoint: String,
    val protocol: StreamProtocol = StreamProtocol.RTMP,
)

enum class StreamProtocol { RTMP, RTMPS, SRT }
