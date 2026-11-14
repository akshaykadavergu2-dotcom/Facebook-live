/**
 * Minimal real-time FLV muxer for H.264 (Annex-B or AVCC) and AAC (raw or ADTS)
 * frames ingested from the Android MediaCodec / AudioPlaybackCapture pipeline.
 */

export const INGEST_MAGIC_0 = 0x4c; // 'L'
export const INGEST_MAGIC_1 = 0x43; // 'C'
export const INGEST_VERSION = 0x01;

export const FRAME_VIDEO_CONFIG = 0x01;
export const FRAME_VIDEO_DATA = 0x02;
export const FRAME_AUDIO_CONFIG = 0x03;
export const FRAME_AUDIO_DATA = 0x04;

export interface ParsedIngestFrame {
  frameType: number;
  isKeyframe: boolean;
  ptsUs: bigint;
  payload: Buffer;
}

export function parseBinaryIngestPacket(data: Buffer): ParsedIngestFrame | null {
  if (data.length < 16) return null;
  if (data[0] !== INGEST_MAGIC_0 || data[1] !== INGEST_MAGIC_1 || data[2] !== INGEST_VERSION) {
    return null;
  }
  const frameType = data[3];
  const flags = data[4];
  const ptsUs = data.readBigInt64BE(8);
  const payload = data.subarray(16);
  return {
    frameType,
    isKeyframe: (flags & 0x01) !== 0,
    ptsUs,
    payload,
  };
}

export function splitAnnexBNals(buf: Buffer): Buffer[] {
  const nals: Buffer[] = [];
  let i = 0;
  let start = -1;

  while (i < buf.length) {
    let scLen = 0;
    if (i + 3 < buf.length && buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 0 && buf[i + 3] === 1) {
      scLen = 4;
    } else if (i + 2 < buf.length && buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 1) {
      scLen = 3;
    }

    if (scLen > 0) {
      if (start !== -1 && i > start) {
        nals.push(buf.subarray(start, i));
      }
      i += scLen;
      start = i;
    } else {
      i += 1;
    }
  }

  if (start !== -1 && start < buf.length) {
    nals.push(buf.subarray(start));
  }

  // Fallback if caller passed length-prefixed AVCC or single raw NAL without start codes
  if (nals.length === 0 && buf.length > 0) {
    nals.push(buf);
  }
  return nals.filter((n) => n.length > 0);
}

export function buildAvcDecoderConfigFromAnnexB(buf: Buffer): Buffer | null {
  // If already an AVCDecoderConfigurationRecord (version 1 header with enough length)
  if (buf.length >= 7 && buf[0] === 0x01 && (buf[4] & 0xfc) === 0xfc) {
    return buf;
  }

  const nals = splitAnnexBNals(buf);
  let sps: Buffer | null = null;
  let pps: Buffer | null = null;

  for (const nal of nals) {
    const nalType = nal[0] & 0x1f;
    if (nalType === 7 && !sps) sps = nal;
    if (nalType === 8 && !pps) pps = nal;
  }

  if (!sps || !pps || sps.length < 4) {
    return null;
  }

  const out = Buffer.alloc(11 + sps.length + pps.length);
  out[0] = 0x01; // configurationVersion
  out[1] = sps[1]; // AVCProfileIndication
  out[2] = sps[2]; // profile_compatibility
  out[3] = sps[3]; // AVCLevelIndication
  out[4] = 0xff; // lengthSizeMinusOne = 3 (4-byte NAL length)
  out[5] = 0xe1; // numOfSequenceParameterSets = 1
  out.writeUInt16BE(sps.length, 6);
  sps.copy(out, 8);
  const ppsOffset = 8 + sps.length;
  out[ppsOffset] = 0x01; // numOfPictureParameterSets = 1
  out.writeUInt16BE(pps.length, ppsOffset + 1);
  pps.copy(out, ppsOffset + 3);
  return out;
}

export function annexBToAvccPayload(buf: Buffer): Buffer {
  const nals = splitAnnexBNals(buf).filter((nal) => {
    const nalType = nal[0] & 0x1f;
    // Skip AUD (9); keep IDR, non-IDR slices, SPS/PPS if inline
    return nalType !== 9;
  });

  if (nals.length === 0) return Buffer.alloc(0);

  let totalLen = 0;
  for (const nal of nals) {
    totalLen += 4 + nal.length;
  }
  const out = Buffer.allocUnsafe(totalLen);
  let offset = 0;
  for (const nal of nals) {
    out.writeUInt32BE(nal.length, offset);
    nal.copy(out, offset + 4);
    offset += 4 + nal.length;
  }
  return out;
}

export function stripAdtsHeaderIfPresent(buf: Buffer): Buffer {
  // Check for 12-bit ADTS syncword 0xFFF
  if (buf.length > 7 && buf[0] === 0xff && (buf[1] & 0xf0) === 0xf0) {
    const hasCrc = (buf[1] & 0x01) === 0;
    const headerLen = hasCrc ? 9 : 7;
    if (buf.length > headerLen) {
      return buf.subarray(headerLen);
    }
  }
  return buf;
}

export function createFlvHeader(hasAudio: boolean, hasVideo = true): Buffer {
  const flags = (hasAudio ? 0x04 : 0x00) | (hasVideo ? 0x01 : 0x00);
  // 9-byte header + 4-byte PreviousTagSize0 = 13 bytes
  return Buffer.from([
    0x46, 0x4c, 0x56, // "FLV"
    0x01,             // Version 1
    flags,            // TypeFlagsAudio | TypeFlagsVideo
    0x00, 0x00, 0x00, 0x09, // DataOffset = 9
    0x00, 0x00, 0x00, 0x00, // PreviousTagSize0 = 0
  ]);
}

function wrapFlvTag(tagType: number, body: Buffer, timestampMs: number): Buffer {
  const safeTs = Math.max(0, Math.floor(timestampMs));
  const dataSize = body.length;
  const tagSize = 11 + dataSize;
  const out = Buffer.allocUnsafe(tagSize + 4);

  out[0] = tagType;
  out[1] = (dataSize >> 16) & 0xff;
  out[2] = (dataSize >> 8) & 0xff;
  out[3] = dataSize & 0xff;

  // Timestamp (24-bit lower + 8-bit extended)
  out[4] = (safeTs >> 16) & 0xff;
  out[5] = (safeTs >> 8) & 0xff;
  out[6] = safeTs & 0xff;
  out[7] = (safeTs >> 24) & 0xff;

  // StreamID always 0
  out[8] = 0;
  out[9] = 0;
  out[10] = 0;

  body.copy(out, 11);
  out.writeUInt32BE(tagSize, tagSize);
  return out;
}

export function createFlvAvcSequenceTag(avcDecoderConfig: Buffer, timestampMs = 0): Buffer {
  const body = Buffer.allocUnsafe(5 + avcDecoderConfig.length);
  body[0] = 0x17; // keyframe + AVC (CodecID 7)
  body[1] = 0x00; // AVCPacketType = sequence header
  body[2] = 0x00;
  body[3] = 0x00;
  body[4] = 0x00; // CompositionTime = 0
  avcDecoderConfig.copy(body, 5);
  return wrapFlvTag(0x09, body, timestampMs);
}

export function createFlvAvcVideoTag(avccNals: Buffer, isKeyframe: boolean, timestampMs: number): Buffer {
  const body = Buffer.allocUnsafe(5 + avccNals.length);
  body[0] = isKeyframe ? 0x17 : 0x27; // frameType (1=keyframe, 2=inter) + CodecID 7 (AVC)
  body[1] = 0x01; // AVCPacketType = NALU
  body[2] = 0x00;
  body[3] = 0x00;
  body[4] = 0x00; // CompositionTime = 0
  avccNals.copy(body, 5);
  return wrapFlvTag(0x09, body, timestampMs);
}

export function createFlvAacSequenceTag(audioSpecificConfig: Buffer, timestampMs = 0): Buffer {
  const body = Buffer.allocUnsafe(2 + audioSpecificConfig.length);
  body[0] = 0xaf; // SoundFormat 10 (AAC), 44kHz, 16-bit, stereo
  body[1] = 0x00; // AACPacketType = sequence header
  audioSpecificConfig.copy(body, 2);
  return wrapFlvTag(0x08, body, timestampMs);
}

export function createFlvAacAudioTag(rawAacFrame: Buffer, timestampMs: number): Buffer {
  const body = Buffer.allocUnsafe(2 + rawAacFrame.length);
  body[0] = 0xaf; // SoundFormat 10 (AAC)
  body[1] = 0x01; // AACPacketType = raw AAC frame
  rawAacFrame.copy(body, 2);
  return wrapFlvTag(0x08, body, timestampMs);
}

export interface FlvTagCallback {
  onHeader?: (header: Buffer) => void;
  onTag: (tag: Buffer, info: { tagType: number; isKeyframe: boolean; isSequenceHeader: boolean }) => void;
}

/**
 * Splits a continuous FLV byte stream (such as master FFmpeg stdout `-f flv pipe:1`)
 * into discrete 13-byte header + FLV tags so multiple independent RTMP pushers
 * can receive identical video+audio frames and bootstrap cleanly on late/reconnect attach.
 */
export class FlvStreamSplitter {
  private buffer: Buffer = Buffer.alloc(0);
  private headerParsed = false;
  public header: Buffer | null = null;
  public metadataTag: Buffer | null = null;
  public avcSeqTag: Buffer | null = null;
  public aacSeqTag: Buffer | null = null;
  public latestGopTags: Buffer[] = [];
  private readonly callbacks: FlvTagCallback;

  constructor(callbacks: FlvTagCallback) {
    this.callbacks = callbacks;
  }

  public push(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);

    if (!this.headerParsed) {
      if (this.buffer.length < 13) return;
      this.header = Buffer.from(this.buffer.subarray(0, 13));
      this.buffer = this.buffer.subarray(13);
      this.headerParsed = true;
      this.callbacks.onHeader?.(this.header);
    }

    while (this.buffer.length >= 15) {
      const dataSize = (this.buffer[1] << 16) | (this.buffer[2] << 8) | this.buffer[3];
      const totalLen = 11 + dataSize + 4;
      if (this.buffer.length < totalLen) break;

      const tag = Buffer.from(this.buffer.subarray(0, totalLen));
      this.buffer = this.buffer.subarray(totalLen);

      const tagType = tag[0];
      const isVideoSeq = tagType === 0x09 && dataSize >= 2 && (tag[11] & 0x0f) === 7 && tag[12] === 0x00;
      const isAudioSeq = tagType === 0x08 && dataSize >= 2 && ((tag[11] >> 4) & 0x0f) === 10 && tag[12] === 0x00;
      const isScript = tagType === 0x12;
      const isKeyframe = tagType === 0x09 && dataSize >= 2 && (tag[11] >> 4) === 1 && tag[12] === 0x01;
      const isSequenceHeader = isVideoSeq || isAudioSeq || isScript;

      if (isScript) this.metadataTag = tag;
      else if (isVideoSeq) this.avcSeqTag = tag;
      else if (isAudioSeq) this.aacSeqTag = tag;
      else if (tagType === 0x09 || tagType === 0x08) {
        if (isKeyframe) {
          this.latestGopTags = [tag];
        } else if (this.latestGopTags.length > 0 && this.latestGopTags.length < 240) {
          this.latestGopTags.push(tag);
        }
      }

      this.callbacks.onTag(tag, { tagType, isKeyframe, isSequenceHeader });
    }
  }

  public getBootstrapChunks(): Buffer[] {
    const out: Buffer[] = [];
    if (this.header) out.push(this.header);
    if (this.metadataTag) out.push(this.metadataTag);
    if (this.avcSeqTag) out.push(this.avcSeqTag);
    if (this.aacSeqTag) out.push(this.aacSeqTag);
    for (const t of this.latestGopTags) {
      out.push(t);
    }
    return out;
  }
}
