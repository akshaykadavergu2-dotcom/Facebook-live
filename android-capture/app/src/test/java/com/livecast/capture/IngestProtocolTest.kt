package com.livecast.capture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

class IngestProtocolTest {

    @Test
    fun buildPacket_encodes16ByteHeaderAndPayloadAccurately() {
        val payload = byteArrayOf(0x00, 0x00, 0x00, 0x01, 0x67)
        val packet = IngestProtocol.buildPacket(
            frameType = IngestProtocol.FRAME_VIDEO_DATA,
            isKeyframe = true,
            sequence = 42,
            ptsUs = 1_234_567L,
            payload = payload,
        )

        assertEquals(16 + payload.size, packet.size)
        assertEquals('L'.code.toByte(), packet[0])
        assertEquals('C'.code.toByte(), packet[1])
        assertEquals(IngestProtocol.PROTOCOL_VERSION, packet[2])
        assertEquals(IngestProtocol.FRAME_VIDEO_DATA, packet[3])
        assertEquals(IngestProtocol.FLAG_KEYFRAME, packet[4])

        val buf = ByteBuffer.wrap(packet).order(ByteOrder.BIG_ENDIAN)
        buf.position(5)
        assertEquals(42, buf.short.toInt() and 0xFFFF)
        buf.position(8)
        assertEquals(1_234_567L, buf.long)
    }

    @Test
    fun extractYouTubeVideoId_handlesWatchLiveAndShortLinks() {
        assertEquals(
            "dQw4w9WgXcQ",
            IngestProtocol.extractYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
        )
        assertEquals(
            "MkevOPApLaE",
            IngestProtocol.extractYouTubeVideoId("https://youtube.com/live/MkevOPApLaE?feature=share"),
        )
        assertEquals(
            "jNQXAC9IVRw",
            IngestProtocol.extractYouTubeVideoId("https://youtu.be/jNQXAC9IVRw"),
        )
        assertNull(IngestProtocol.extractYouTubeVideoId("https://example.com/not-youtube"))
    }

    @Test
    fun audioMixerState_keepsInternalAndMicMuteIndependent() {
        val mutedInternalOnly = AudioMixerState(
            internalEnabled = true,
            internalMuted = true,
            internalVolume = 1.2f,
            micEnabled = true,
            micMuted = false,
            micVolume = 0.8f,
            masterMuted = false,
            masterVolume = 1.0f,
        )
        assertEquals(0f, mutedInternalOnly.effectiveInternalGain(), 0.0001f)
        assertEquals(0.8f, mutedInternalOnly.effectiveMicGain(), 0.0001f)

        val mutedMaster = mutedInternalOnly.copy(internalMuted = false, masterMuted = true)
        assertEquals(0f, mutedMaster.effectiveInternalGain(), 0.0001f)
        assertEquals(0f, mutedMaster.effectiveMicGain(), 0.0001f)
    }

    @Test
    fun mixPcm16Samples_softClipsPeaksWithoutWraparound() {
        val peak = AudioMixerMath.mixPcm16Samples(
            internalSample = 30_000,
            micSample = 30_000,
            internalGain = 1.5f,
            micGain = 1.5f,
        )
        assertTrue(peak in 28_000..32_767)
    }

    @Test
    fun validateRtmpServerUrl_rejectsYoutubeWatchLinksAndAcceptsRtmps() {
        assertNull(IngestProtocol.validateRtmpServerUrl("rtmps://a.rtmps.youtube.com:443/live2"))
        assertNull(IngestProtocol.validateRtmpServerUrl("rtmps://live-api-s.facebook.com:443/rtmp/"))
        assertNotNull(IngestProtocol.validateRtmpServerUrl("https://youtube.com/live/MkevOPApLaE"))
        assertNotNull(IngestProtocol.validateRtmpServerUrl("https://example.com/stream"))
    }
}
