package com.livecast.capture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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
}
