import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough, type Readable } from 'node:stream';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { WebSocket } from 'ws';
import type {
  AndroidAudioCaptureStatus,
  AndroidCaptureSessionInfo,
  AndroidCaptureTelemetry,
  AndroidVideoCaptureStatus,
} from '../shared/types.ts';
import {
  annexBToAvccPayload,
  buildAvcDecoderConfigFromAnnexB,
  createFlvAacAudioTag,
  createFlvAacSequenceTag,
  createFlvAvcSequenceTag,
  createFlvAvcVideoTag,
  createFlvHeader,
  FRAME_AUDIO_CONFIG,
  FRAME_AUDIO_DATA,
  FRAME_VIDEO_CONFIG,
  FRAME_VIDEO_DATA,
  parseBinaryIngestPacket,
  stripAdtsHeaderIfPresent,
} from './flvMuxer.ts';

interface InternalCaptureSession {
  sessionId: string;
  ingestToken: string;
  expiresAtMs: number;
  ws: WebSocket | null;
  telemetry: AndroidCaptureTelemetry;
  basePtsUs: bigint | null;
  videoConfig: Buffer | null;
  audioConfig: Buffer | null;
  lastKeyGopTags: Buffer[];
  consumers: Set<PassThrough>;
  consumerHeadersSent: WeakSet<PassThrough>;
  fpsWindowFrames: number;
  fpsWindowBytes: number;
  fpsWindowStartMs: number;
  reconnectTimer: NodeJS.Timeout | null;
}

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const RECONNECT_GRACE_MS = 15000;

class AndroidCaptureManager extends EventEmitter {
  private sessions = new Map<string, InternalCaptureSession>();
  private activeSessionId: string | null = null;

  public getTelemetry(sessionId?: string | null): AndroidCaptureTelemetry {
    const targetId = sessionId ?? this.activeSessionId;
    if (targetId && this.sessions.has(targetId)) {
      return { ...this.sessions.get(targetId)!.telemetry };
    }
    return {
      sessionId: null,
      status: 'Disconnected',
      videoStatus: 'IDLE',
      audioStatus: 'IDLE',
      permissionGranted: false,
      fps: 0,
      width: 0,
      height: 0,
      audioSampleRate: 0,
      bitrateKbps: 0,
      latencyMs: 0,
      framesReceived: 0,
      youtubeUrl: null,
      lastHeartbeatAt: null,
      lastError: null,
    };
  }

  public createSession(
    youtubeUrl: string | null,
    httpProtocol: string,
    hostHeader: string,
  ): AndroidCaptureSessionInfo {
    // End stale waiting session if replacing before active capture
    const sessionId = `cap_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const ingestToken = crypto.randomBytes(24).toString('hex');
    const expiresAtMs = Date.now() + SESSION_TTL_MS;

    const wsProto = httpProtocol === 'https' ? 'wss' : 'ws';
    const wsIngestUrl = `${wsProto}://${hostHeader}/ws/capture-ingest?sessionId=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(ingestToken)}`;
    const backendHttpUrl = `${httpProtocol}://${hostHeader}`;
    const deepLinkUrl =
      `livecast://capture?backend=${encodeURIComponent(backendHttpUrl)}` +
      `&sessionId=${encodeURIComponent(sessionId)}` +
      `&token=${encodeURIComponent(ingestToken)}` +
      (youtubeUrl ? `&yt=${encodeURIComponent(youtubeUrl)}` : '');

    const session: InternalCaptureSession = {
      sessionId,
      ingestToken,
      expiresAtMs,
      ws: null,
      telemetry: {
        sessionId,
        status: 'WaitingForApp',
        videoStatus: 'IDLE',
        audioStatus: 'IDLE',
        permissionGranted: false,
        fps: 0,
        width: 0,
        height: 0,
        audioSampleRate: 0,
        bitrateKbps: 0,
        latencyMs: 0,
        framesReceived: 0,
        youtubeUrl: youtubeUrl || null,
        lastHeartbeatAt: null,
        lastError: null,
      },
      basePtsUs: null,
      videoConfig: null,
      audioConfig: null,
      lastKeyGopTags: [],
      consumers: new Set(),
      consumerHeadersSent: new WeakSet(),
      fpsWindowFrames: 0,
      fpsWindowBytes: 0,
      fpsWindowStartMs: Date.now(),
      reconnectTimer: null,
    };

    // Clean up old idle sessions that never started or already stopped
    for (const [id, existing] of this.sessions.entries()) {
      if (existing.telemetry.status === 'Stopped' || existing.telemetry.status === 'WaitingForApp') {
        this.destroySession(id);
      }
    }

    this.sessions.set(sessionId, session);
    this.activeSessionId = sessionId;
    this.emitTelemetry(session);

    return {
      sessionId,
      ingestToken,
      wsIngestUrl,
      deepLinkUrl,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  public verifyIngestToken(sessionId: string, token: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    if (Date.now() > session.expiresAtMs) return false;
    const expected = Buffer.from(session.ingestToken, 'utf8');
    const provided = Buffer.from(token, 'utf8');
    if (expected.length !== provided.length) return false;
    return crypto.timingSafeEqual(expected, provided);
  }

  public hasActiveVideoStream(sessionId?: string | null): boolean {
    const targetId = sessionId ?? this.activeSessionId;
    if (!targetId) return false;
    const session = this.sessions.get(targetId);
    if (!session) return false;
    return Boolean(
      session.videoConfig &&
        (session.telemetry.status === 'Capturing' || session.telemetry.status === 'Reconnecting'),
    );
  }

  public hasAudioTrack(sessionId?: string | null): boolean {
    const targetId = sessionId ?? this.activeSessionId;
    if (!targetId) return false;
    const session = this.sessions.get(targetId);
    if (!session) return false;
    return Boolean(session.audioConfig && session.telemetry.audioStatus === 'AUDIO_CAPTURED');
  }

  public attachIngestSocket(sessionId: string, ws: WebSocket): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      ws.close(4004, 'Session not found');
      return;
    }

    if (session.reconnectTimer) {
      clearTimeout(session.reconnectTimer);
      session.reconnectTimer = null;
    }

    if (session.ws && session.ws !== ws && session.ws.readyState === WebSocket.OPEN) {
      try {
        session.ws.close(4001, 'Superseded by reconnect');
      } catch {
        // ignore
      }
    }

    session.ws = ws;
    this.activeSessionId = sessionId;
    session.telemetry.status = 'Connecting';
    session.telemetry.lastHeartbeatAt = new Date().toISOString();
    session.telemetry.lastError = null;
    this.emitTelemetry(session);

    ws.on('message', (raw, isBinary) => {
      if (!isBinary) {
        this.handleControlMessage(session, raw.toString('utf8'));
        return;
      }
      const buf = Buffer.isBuffer(raw)
        ? raw
        : Array.isArray(raw)
          ? Buffer.concat(raw)
          : Buffer.from(raw as ArrayBuffer);
      this.handleBinaryFrame(session, buf);
    });

    ws.on('close', () => {
      if (session.ws !== ws) return;
      session.ws = null;

      if (session.telemetry.status === 'Stopped') {
        return;
      }

      session.telemetry.status = 'Reconnecting';
      session.telemetry.videoStatus = 'PAUSED';
      this.emitTelemetry(session);

      session.reconnectTimer = setTimeout(() => {
        if (!session.ws && session.telemetry.status !== 'Stopped') {
          session.telemetry.status = 'Disconnected';
          session.telemetry.videoStatus = 'IDLE';
          session.telemetry.fps = 0;
          session.telemetry.bitrateKbps = 0;
          session.telemetry.lastError = 'Android capture disconnected and did not reconnect within 15s.';
          this.emitTelemetry(session);
          this.closeAllConsumers(session);
        }
      }, RECONNECT_GRACE_MS);
    });

    ws.on('error', (err) => {
      session.telemetry.lastError = err.message;
      this.emitTelemetry(session);
    });
  }

  private handleControlMessage(session: InternalCaptureSession, text: string): void {
    try {
      const msg = JSON.parse(text) as {
        type?: string;
        permissionGranted?: boolean;
        videoStatus?: AndroidVideoCaptureStatus;
        audioStatus?: AndroidAudioCaptureStatus;
        width?: number;
        height?: number;
        audioSampleRate?: number;
        sentAtMs?: number;
        error?: string;
      };

      session.telemetry.lastHeartbeatAt = new Date().toISOString();

      if (msg.type === 'telemetry') {
        if (typeof msg.permissionGranted === 'boolean') {
          session.telemetry.permissionGranted = msg.permissionGranted;
        }
        if (msg.videoStatus) session.telemetry.videoStatus = msg.videoStatus;
        if (msg.audioStatus) session.telemetry.audioStatus = msg.audioStatus;
        if (typeof msg.width === 'number' && msg.width > 0) session.telemetry.width = msg.width;
        if (typeof msg.height === 'number' && msg.height > 0) session.telemetry.height = msg.height;
        if (typeof msg.audioSampleRate === 'number' && msg.audioSampleRate >= 0) {
          session.telemetry.audioSampleRate = msg.audioSampleRate;
        }
        if (typeof msg.sentAtMs === 'number' && msg.sentAtMs > 0) {
          const delta = Math.max(0, Date.now() - msg.sentAtMs);
          if (delta < 30000) {
            session.telemetry.latencyMs = Math.round(delta);
          }
          if (session.ws && session.ws.readyState === WebSocket.OPEN) {
            try {
              session.ws.send(JSON.stringify({ type: 'telemetry-ack', sentAtMs: msg.sentAtMs }));
            } catch {
              // ignore ack send failure
            }
          }
        }
        this.emitTelemetry(session);
      } else if (msg.type === 'error') {
        session.telemetry.status = 'Error';
        session.telemetry.videoStatus = 'ERROR';
        session.telemetry.lastError = msg.error || 'Android capture reported an error.';
        this.emitTelemetry(session);
      } else if (msg.type === 'stop') {
        this.stopSession(session.sessionId);
      }
    } catch {
      // ignore malformed JSON telemetry packet
    }
  }

  private handleBinaryFrame(session: InternalCaptureSession, raw: Buffer): void {
    const parsed = parseBinaryIngestPacket(raw);
    if (!parsed || parsed.payload.length === 0) return;

    session.telemetry.lastHeartbeatAt = new Date().toISOString();

    if (session.basePtsUs === null || parsed.ptsUs < session.basePtsUs) {
      if (session.basePtsUs === null) {
        session.basePtsUs = parsed.ptsUs;
      }
    }
    const relMs =
      session.basePtsUs !== null
        ? Math.max(0, Number((parsed.ptsUs - session.basePtsUs) / 1000n))
        : 0;

    if (parsed.frameType === FRAME_VIDEO_CONFIG) {
      const avcConfig = buildAvcDecoderConfigFromAnnexB(parsed.payload);
      if (!avcConfig) return;
      session.videoConfig = avcConfig;
      session.telemetry.status = 'Capturing';
      session.telemetry.videoStatus = 'CAPTURING';
      session.telemetry.permissionGranted = true;
      this.emit(`videoConfig:${session.sessionId}`, avcConfig);
      this.emitTelemetry(session);
      return;
    }

    if (parsed.frameType === FRAME_AUDIO_CONFIG) {
      session.audioConfig = Buffer.from(parsed.payload);
      session.telemetry.audioStatus = 'AUDIO_CAPTURED';
      if (session.telemetry.audioSampleRate === 0) {
        session.telemetry.audioSampleRate = 44100;
      }
      this.emitTelemetry(session);
      return;
    }

    if (parsed.frameType === FRAME_VIDEO_DATA) {
      const avccPayload = annexBToAvccPayload(parsed.payload);
      if (avccPayload.length === 0) return;

      // Also extract inline SPS/PPS on IDR frames if not sent separately
      if (parsed.isKeyframe && !session.videoConfig) {
        const inlineConfig = buildAvcDecoderConfigFromAnnexB(parsed.payload);
        if (inlineConfig) {
          session.videoConfig = inlineConfig;
          this.emit(`videoConfig:${session.sessionId}`, inlineConfig);
        }
      }

      const tag = createFlvAvcVideoTag(avccPayload, parsed.isKeyframe, relMs);
      if (parsed.isKeyframe) {
        session.lastKeyGopTags = [tag];
      } else if (session.lastKeyGopTags.length > 0 && session.lastKeyGopTags.length < 180) {
        session.lastKeyGopTags.push(tag);
      }

      session.telemetry.framesReceived += 1;
      session.telemetry.status = 'Capturing';
      session.telemetry.videoStatus = 'CAPTURING';
      session.telemetry.permissionGranted = true;

      this.updateBitrateAndFps(session, raw.length, true);
      this.broadcastFlvTag(session, tag, parsed.isKeyframe);
      return;
    }

    if (parsed.frameType === FRAME_AUDIO_DATA) {
      const aacRaw = stripAdtsHeaderIfPresent(parsed.payload);
      if (aacRaw.length === 0) return;
      const tag = createFlvAacAudioTag(aacRaw, relMs);
      session.telemetry.audioStatus = 'AUDIO_CAPTURED';
      this.updateBitrateAndFps(session, raw.length, false);
      this.broadcastFlvTag(session, tag, false);
    }
  }

  private updateBitrateAndFps(
    session: InternalCaptureSession,
    bytes: number,
    isVideoFrame: boolean,
  ): void {
    const now = Date.now();
    if (isVideoFrame) session.fpsWindowFrames += 1;
    session.fpsWindowBytes += bytes;

    const elapsedMs = now - session.fpsWindowStartMs;
    if (elapsedMs >= 1000) {
      session.telemetry.fps = Math.round((session.fpsWindowFrames * 1000) / elapsedMs);
      session.telemetry.bitrateKbps = Math.round((session.fpsWindowBytes * 8) / elapsedMs);
      session.fpsWindowFrames = 0;
      session.fpsWindowBytes = 0;
      session.fpsWindowStartMs = now;
      this.emitTelemetry(session);
    }
  }

  private sendConsumerBootstrap(session: InternalCaptureSession, consumer: PassThrough): void {
    if (session.consumerHeadersSent.has(consumer)) return;
    if (!session.videoConfig) return;

    const hasAudio = Boolean(session.audioConfig);
    consumer.write(createFlvHeader(hasAudio, true));
    consumer.write(createFlvAvcSequenceTag(session.videoConfig, 0));
    if (session.audioConfig) {
      consumer.write(createFlvAacSequenceTag(session.audioConfig, 0));
    }
    for (const gopTag of session.lastKeyGopTags) {
      consumer.write(gopTag);
    }
    session.consumerHeadersSent.add(consumer);
  }

  private broadcastFlvTag(
    session: InternalCaptureSession,
    tag: Buffer,
    isKeyframe: boolean,
  ): void {
    for (const consumer of session.consumers) {
      if (consumer.destroyed || consumer.writableEnded) {
        session.consumers.delete(consumer);
        continue;
      }
      if (!session.consumerHeadersSent.has(consumer)) {
        this.sendConsumerBootstrap(session, consumer);
        continue;
      }
      // Backpressure guard: drop non-keyframe packets on stalled consumers to preserve low latency
      if (consumer.writableNeedDrain && !isKeyframe) {
        continue;
      }
      consumer.write(tag);
    }
  }

  public async waitForVideoConfig(sessionId: string, timeoutMs = 4500): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    if (session.videoConfig) return true;

    const eventKey = `videoConfig:${sessionId}`;
    return new Promise<boolean>((resolve) => {
      const onCfg = () => {
        cleanup();
        resolve(true);
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve(Boolean(session.videoConfig));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        this.off(eventKey, onCfg);
      };
      this.on(eventKey, onCfg);
    });
  }

  public createFfmpegFlvStream(sessionId?: string | null): Readable | null {
    const targetId = sessionId ?? this.activeSessionId;
    if (!targetId) return null;
    const session = this.sessions.get(targetId);
    if (!session || !session.videoConfig) return null;

    const stream = new PassThrough({ highWaterMark: 1024 * 1024 });
    session.consumers.add(stream);
    this.sendConsumerBootstrap(session, stream);

    stream.on('close', () => {
      session.consumers.delete(stream);
    });
    return stream;
  }

  public createPreviewRemuxStream(
    sessionId?: string | null,
  ): { stream: Readable; cleanup: () => void } | null {
    const flvStream = this.createFfmpegFlvStream(sessionId);
    if (!flvStream) return null;

    const proc: ChildProcessWithoutNullStreams = spawn(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'flv',
        '-i',
        'pipe:0',
        '-c',
        'copy',
        '-f',
        'mp4',
        '-movflags',
        'frag_keyframe+empty_moov+default_base_moof+omit_tfhd_offset',
        'pipe:1',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );

    flvStream.pipe(proc.stdin);
    proc.stdin.on('error', () => {
      // Ignore EPIPE on preview disconnect
    });

    const cleanup = () => {
      flvStream.unpipe(proc.stdin);
      flvStream.destroy();
      if (proc.exitCode === null) {
        proc.kill('SIGTERM');
      }
    };

    proc.on('close', () => {
      flvStream.destroy();
    });

    return { stream: proc.stdout, cleanup };
  }

  public stopSession(sessionId?: string | null): AndroidCaptureTelemetry {
    const targetId = sessionId ?? this.activeSessionId;
    if (!targetId || !this.sessions.has(targetId)) {
      return this.getTelemetry(null);
    }
    const session = this.sessions.get(targetId)!;
    if (session.reconnectTimer) {
      clearTimeout(session.reconnectTimer);
      session.reconnectTimer = null;
    }

    session.telemetry.status = 'Stopped';
    session.telemetry.videoStatus = 'IDLE';
    session.telemetry.fps = 0;
    session.telemetry.bitrateKbps = 0;

    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      try {
        session.ws.send(JSON.stringify({ type: 'stop' }));
        session.ws.close(1000, 'Stopped by studio');
      } catch {
        // ignore
      }
    }
    session.ws = null;
    this.closeAllConsumers(session);
    this.emitTelemetry(session);
    return { ...session.telemetry };
  }

  public requestStart(sessionId?: string | null, youtubeUrl?: string | null): boolean {
    const targetId = sessionId ?? this.activeSessionId;
    if (!targetId || !this.sessions.has(targetId)) return false;
    const session = this.sessions.get(targetId)!;
    if (youtubeUrl && youtubeUrl.trim().length > 0) {
      session.telemetry.youtubeUrl = youtubeUrl.trim();
      this.emitTelemetry(session);
    }
    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      try {
        session.ws.send(
          JSON.stringify({
            type: 'start-request',
            youtubeUrl: session.telemetry.youtubeUrl,
          }),
        );
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  private closeAllConsumers(session: InternalCaptureSession): void {
    for (const c of session.consumers) {
      if (!c.destroyed) {
        c.end();
      }
    }
    session.consumers.clear();
  }

  private destroySession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session.reconnectTimer) clearTimeout(session.reconnectTimer);
    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      try {
        session.ws.close(1000, 'Replaced');
      } catch {
        // ignore
      }
    }
    this.closeAllConsumers(session);
    this.sessions.delete(sessionId);
  }

  private emitTelemetry(session: InternalCaptureSession): void {
    this.emit('telemetry', { ...session.telemetry });
  }
}

export const captureManager = new AndroidCaptureManager();
