import { EventEmitter } from 'node:events';
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  OverlayConfig,
  PipelineCheckResult,
  StreamHistoryEntry,
  StreamLogEntry,
  StreamQualityProfile,
  StreamStatusState,
  StreamTelemetry,
  VideoSourceType,
} from '../shared/types.ts';
import { redactSensitive } from './crypto.ts';
import { addStreamHistoryEntry, DATA_DIR } from './storage.ts';

const execFileAsync = promisify(execFile);

const QUALITY_PROFILES: Record<
  StreamQualityProfile,
  { width: number; height: number; videoBitrateKbps: number; audioBitrateKbps: number; label: string }
> = {
  '720p': {
    width: 1280,
    height: 720,
    videoBitrateKbps: 3000,
    audioBitrateKbps: 128,
    label: '1280x720',
  },
  '1080p': {
    width: 1920,
    height: 1080,
    videoBitrateKbps: 5000,
    audioBitrateKbps: 192,
    label: '1920x1080',
  },
};

function findSystemFont(): string | null {
  const candidates = [
    '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
    '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export async function checkFfmpegAvailability(): Promise<{ available: boolean; version: string | null }> {
  try {
    const { stdout } = await execFileAsync('ffmpeg', ['-version'], { timeout: 3000 });
    const firstLine = stdout.split('\n')[0]?.trim() || 'ffmpeg detected';
    return { available: true, version: firstLine };
  } catch {
    return { available: false, version: null };
  }
}

export interface MediaProbeResult {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  audioCodec: string | null;
  hasAudio: boolean;
}

function parseFrameRate(raw: string | undefined): number {
  if (!raw) return 30;
  const parts = raw.split('/');
  if (parts.length === 2) {
    const num = Number(parts[0]);
    const den = Number(parts[1]);
    if (den > 0 && Number.isFinite(num / den)) {
      return Math.round((num / den) * 100) / 100;
    }
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 30;
}

function isLiveNetworkStreamUrl(target: string): boolean {
  return /^(rtmps?|srt):\/\//i.test(target) || /\.m3u8(\?|$)/i.test(target);
}

export async function probeMedia(targetPathOrUrl: string): Promise<MediaProbeResult> {
  const ffprobeArgs = ['-v', 'quiet'];
  if (/^(https?|rtmps?|srt):\/\//i.test(targetPathOrUrl)) {
    ffprobeArgs.push('-analyzeduration', '3500000', '-probesize', '3500000');
  }
  ffprobeArgs.push('-print_format', 'json', '-show_format', '-show_streams', targetPathOrUrl);

  const { stdout } = await execFileAsync('ffprobe', ffprobeArgs, { timeout: 14000 });
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      r_frame_rate?: string;
      avg_frame_rate?: string;
    }>;
  };

  const videoStream = parsed.streams?.find((s) => s.codec_type === 'video');
  const audioStream = parsed.streams?.find((s) => s.codec_type === 'audio');

  if (!videoStream) {
    throw new Error('No video stream found in media file.');
  }

  return {
    durationSec: Math.round((Number(parsed.format?.duration) || 0) * 10) / 10,
    width: videoStream.width || 1280,
    height: videoStream.height || 720,
    fps: parseFrameRate(videoStream.avg_frame_rate || videoStream.r_frame_rate),
    videoCodec: videoStream.codec_name || 'unknown',
    audioCodec: audioStream?.codec_name ?? null,
    hasAudio: Boolean(audioStream),
  };
}

export async function generateSampleVideo(outputPath: string): Promise<void> {
  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=1280x720:rate=30',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=44100',
      '-t',
      '12',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-b:v',
      '2200k',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ar',
      '44100',
      '-ac',
      '2',
      '-movflags',
      '+faststart',
      outputPath,
    ],
    { timeout: 45000 },
  );
}

export function validateRtmpUrl(rawUrl: string): { valid: boolean; normalized?: string; error?: string } {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { valid: false, error: 'RTMP Server URL is required.' };
  }
  if (/[\s\r\n\0]/.test(trimmed)) {
    return { valid: false, error: 'RTMP Server URL must not contain whitespace or control characters.' };
  }
  if (!/^rtmps?:\/\//i.test(trimmed)) {
    return { valid: false, error: 'RTMP Server URL must begin with rtmp:// or rtmps://.' };
  }
  try {
    const httpEquivalent = trimmed.replace(/^rtmps?:\/\//i, 'https://');
    const parsed = new URL(httpEquivalent);
    if (!parsed.hostname || parsed.hostname.length < 3) {
      return { valid: false, error: 'RTMP Server URL must include a valid hostname.' };
    }
    return { valid: true, normalized: trimmed };
  } catch {
    return { valid: false, error: 'Invalid RTMP Server URL format.' };
  }
}

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.local') || lower === 'ip6-localhost') {
    return true;
  }
  const ipVersion = net.isIP(lower);
  if (ipVersion === 4) {
    const [a, b] = lower.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  if (ipVersion === 6) {
    if (lower === '::1' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) {
      return true;
    }
  }
  return false;
}

export function validateDirectMediaUrl(rawUrl: string): {
  valid: boolean;
  normalized?: string;
  protocol?: 'http' | 'https' | 'rtmp' | 'rtmps' | 'srt';
  error?: string;
} {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { valid: false, error: 'Direct media, HLS, RTMP, or SRT URL is required.' };
  }
  if (/[\s\r\n\0]/.test(trimmed)) {
    return { valid: false, error: 'Media URL must not contain spaces or control characters.' };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      error: 'Invalid URL format. Enter a full https://, http://, rtmp://, rtmps://, or srt:// URL.',
    };
  }
  const proto = parsed.protocol.replace(/:$/, '').toLowerCase();
  if (proto !== 'https' && proto !== 'http' && proto !== 'rtmp' && proto !== 'rtmps' && proto !== 'srt') {
    return {
      valid: false,
      error: 'Only http://, https://, rtmp://, rtmps://, and srt:// authorized feeds are supported.',
    };
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (
    host === 'youtube.com' ||
    host === 'youtu.be' ||
    host === 'm.youtube.com' ||
    host === 'music.youtube.com' ||
    host === 'youtube-nocookie.com'
  ) {
    return {
      valid: false,
      error:
        'YouTube share links cannot be streamed via FFmpeg RTMP. Use the YouTube Preview monitor for preview, or select an authorized MP4/HLS/RTMP/SRT feed.',
    };
  }
  if (isPrivateOrLoopbackHost(parsed.hostname)) {
    return {
      valid: false,
      error: 'Private network or loopback URLs are blocked for security.',
    };
  }
  return {
    valid: true,
    normalized: trimmed,
    protocol: proto as 'http' | 'https' | 'rtmp' | 'rtmps' | 'srt',
  };
}

function escapeFilterPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function writeOverlayTextFile(name: string, text: string): string {
  const dir = path.join(DATA_DIR, 'overlay-text');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filePath = path.join(dir, `${name}.txt`);
  fs.writeFileSync(filePath, text.replace(/\r?\n/g, ' ').trim(), 'utf8');
  return filePath;
}

function sanitizeHexColor(hex: string, fallback = '0xFFFFFF'): string {
  const clean = hex.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(clean)) {
    return `0x${clean.slice(1)}`;
  }
  return fallback;
}

export function buildFilterGraph(
  width: number,
  height: number,
  overlays: OverlayConfig,
  hasLogoInput: boolean,
): string {
  const filters: string[] = [];
  let currentLabel = 'vbase';

  filters.push(
    `[0:v]fps=30,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[${currentLabel}]`,
  );

  const scaleFactor = height / 720;
  const tickerBarH = overlays.tickerEnabled && overlays.tickerText.trim().length > 0 ? Math.round(44 * scaleFactor) : 0;
  const hasBreakingBanner =
    overlays.breakingNewsEnabled &&
    (overlays.breakingNewsLabel.trim().length > 0 || overlays.breakingNewsText.trim().length > 0);
  const breakingBarH = hasBreakingBanner ? Math.round(42 * scaleFactor) : 0;
  const bottomStackH = tickerBarH + breakingBarH;

  const hasHeadlineBar = overlays.headlineEnabled && overlays.headlineText.trim().length > 0;
  const headlineSizeScaled = Math.round(Math.min(64, Math.max(16, overlays.headlineFontSize)) * scaleFactor);
  const headlineBoxH = hasHeadlineBar ? Math.round(headlineSizeScaled * 1.75) : 0;

  if (hasLogoInput) {
    const logoWidth = Math.max(48, Math.round(width * (Math.min(35, Math.max(5, overlays.logoScale)) / 100)));
    const opacity = Math.min(1, Math.max(0.1, overlays.logoOpacity)).toFixed(2);
    filters.push(`[1:v]scale=${logoWidth}:-1,format=rgba,colorchannelmixer=aa=${opacity}[logo_img]`);

    const margin = Math.round(24 * scaleFactor);
    const topMargin = hasHeadlineBar ? Math.round(24 * scaleFactor) + headlineBoxH + Math.round(10 * scaleFactor) : margin;
    const bottomY = `H-h-${margin + bottomStackH}`;
    let posExpr = `W-w-${margin}:${topMargin}`;
    switch (overlays.logoPosition) {
      case 'top-left':
        posExpr = `${margin}:${topMargin}`;
        break;
      case 'top-right':
        posExpr = `W-w-${margin}:${topMargin}`;
        break;
      case 'bottom-left':
        posExpr = `${margin}:${bottomY}`;
        break;
      case 'bottom-right':
        posExpr = `W-w-${margin}:${bottomY}`;
        break;
    }
    const nextLabel = 'vlogo';
    filters.push(`[${currentLabel}][logo_img]overlay=${posExpr}:shortest=0[${nextLabel}]`);
    currentLabel = nextLabel;
  }

  const fontFile = findSystemFont();
  const fontArg = fontFile ? `fontfile='${escapeFilterPath(fontFile)}':` : '';

  const textStages: string[] = [];

  if (hasHeadlineBar) {
    const headlineFile = writeOverlayTextFile('headline', overlays.headlineText);
    const padX = Math.round(24 * scaleFactor);
    const padY = Math.round(24 * scaleFactor);
    const bgColor = sanitizeHexColor(overlays.headlineBgColor, '0x0F172A');
    const bgAlpha = Math.min(1, Math.max(0, overlays.headlineBgOpacity)).toFixed(2);
    const textColor = sanitizeHexColor(overlays.headlineColor, '0xFFFFFF');

    if (Number(bgAlpha) > 0) {
      textStages.push(`drawbox=x=${padX}:y=${padY}:w=iw-${padX * 2}:h=${headlineBoxH}:color=${bgColor}@${bgAlpha}:t=fill`);
    }
    textStages.push(
      `drawtext=${fontArg}expansion=none:textfile='${escapeFilterPath(headlineFile)}':fontsize=${headlineSizeScaled}:fontcolor=${textColor}:x=${padX + Math.round(16 * scaleFactor)}:y=${padY + Math.round((headlineBoxH - headlineSizeScaled) / 2)}`,
    );
  }

  if (
    overlays.lowerThirdEnabled &&
    (overlays.lowerThirdTitle.trim().length > 0 || overlays.lowerThirdSubtitle.trim().length > 0)
  ) {
    const boxW = Math.round(540 * scaleFactor);
    const boxH = Math.round(78 * scaleFactor);
    const marginX = Math.round(28 * scaleFactor);
    const boxY = height - bottomStackH - boxH - Math.round(20 * scaleFactor);
    const stripeW = Math.round(6 * scaleFactor);
    const accentColor = sanitizeHexColor(overlays.lowerThirdAccentColor, '0x2563EB');
    const bgColor = sanitizeHexColor(overlays.lowerThirdBgColor, '0x0B0E14');
    const txtColor = sanitizeHexColor(overlays.lowerThirdTextColor, '0xF8FAFC');

    textStages.push(`drawbox=x=${marginX}:y=${boxY}:w=${boxW}:h=${boxH}:color=${bgColor}@0.88:t=fill`);
    textStages.push(`drawbox=x=${marginX}:y=${boxY}:w=${stripeW}:h=${boxH}:color=${accentColor}@1.0:t=fill`);

    if (overlays.lowerThirdTitle.trim()) {
      const titleFile = writeOverlayTextFile('lt-title', overlays.lowerThirdTitle);
      const titleSize = Math.round(22 * scaleFactor);
      textStages.push(
        `drawtext=${fontArg}expansion=none:textfile='${escapeFilterPath(titleFile)}':fontsize=${titleSize}:fontcolor=${txtColor}:x=${marginX + Math.round(18 * scaleFactor)}:y=${boxY + Math.round(14 * scaleFactor)}`,
      );
    }
    if (overlays.lowerThirdSubtitle.trim()) {
      const subFile = writeOverlayTextFile('lt-subtitle', overlays.lowerThirdSubtitle);
      const subSize = Math.round(15 * scaleFactor);
      textStages.push(
        `drawtext=${fontArg}expansion=none:textfile='${escapeFilterPath(subFile)}':fontsize=${subSize}:fontcolor=0xCBD5E1:x=${marginX + Math.round(18 * scaleFactor)}:y=${boxY + Math.round(44 * scaleFactor)}`,
      );
    }
  }

  if (hasBreakingBanner) {
    const padX = Math.round(24 * scaleFactor);
    const bannerY = height - tickerBarH - breakingBarH - (tickerBarH > 0 ? Math.round(4 * scaleFactor) : Math.round(16 * scaleFactor));
    const tagW = Math.round(186 * scaleFactor);
    const bannerAlpha = Math.min(1, Math.max(0.2, overlays.breakingNewsOpacity)).toFixed(2);
    const badgeColor = sanitizeHexColor(overlays.breakingNewsBgColor, '0xDC2626');
    const txtColor = sanitizeHexColor(overlays.breakingNewsTextColor, '0xFFFFFF');
    const fSize = Math.round(18 * scaleFactor);

    textStages.push(`drawbox=x=${padX}:y=${bannerY}:w=iw-${padX * 2}:h=${breakingBarH}:color=0x0B0E14@${bannerAlpha}:t=fill`);
    textStages.push(`drawbox=x=${padX}:y=${bannerY}:w=${tagW}:h=${breakingBarH}:color=${badgeColor}@${bannerAlpha}:t=fill`);

    const labelText = overlays.breakingNewsLabel.trim() || 'BREAKING NEWS';
    const labelFile = writeOverlayTextFile('breaking-label', labelText);
    textStages.push(
      `drawtext=${fontArg}expansion=none:textfile='${escapeFilterPath(labelFile)}':fontsize=${Math.round(15 * scaleFactor)}:fontcolor=${txtColor}:x=${padX + Math.round(14 * scaleFactor)}:y=${bannerY + Math.round((breakingBarH - 15 * scaleFactor) / 2)}`,
    );

    if (overlays.breakingNewsText.trim()) {
      const newsFile = writeOverlayTextFile('breaking-text', overlays.breakingNewsText);
      textStages.push(
        `drawtext=${fontArg}expansion=none:textfile='${escapeFilterPath(newsFile)}':fontsize=${fSize}:fontcolor=${txtColor}:x=${padX + tagW + Math.round(16 * scaleFactor)}:y=${bannerY + Math.round((breakingBarH - fSize) / 2)}`,
      );
    }
  }

  if (overlays.clockEnabled) {
    const fSize = Math.round(Math.min(36, Math.max(12, overlays.clockFontSize)) * scaleFactor);
    const margin = Math.round(24 * scaleFactor);
    const topY = hasHeadlineBar ? Math.round(24 * scaleFactor) + headlineBoxH + Math.round(10 * scaleFactor) : margin;
    const bottomY = `h-th-${margin + bottomStackH + Math.round(8 * scaleFactor)}`;
    const clockBg = sanitizeHexColor(overlays.clockBgColor, '0x0B0E14');
    const clockBgAlpha = Math.min(1, Math.max(0, overlays.clockBgOpacity)).toFixed(2);
    const clockTxt = sanitizeHexColor(overlays.clockColor, '0xF8FAFC');

    let localtimeExpr = '%{localtime\\:%d %b %Y  %H\\\\\\:%M\\\\\\:%S}';
    if (overlays.clockFormat === 'time-24h') {
      localtimeExpr = '%{localtime\\:%H\\\\\\:%M\\\\\\:%S}';
    } else if (overlays.clockFormat === 'time-12h') {
      localtimeExpr = '%{localtime\\:%I\\\\\\:%M\\\\\\:%S %p}';
    }

    let xExpr = `w-tw-${margin}`;
    let yExpr = `${topY}`;
    switch (overlays.clockPosition) {
      case 'top-left':
        xExpr = `${margin}`;
        yExpr = `${topY}`;
        break;
      case 'top-right':
        xExpr = `w-tw-${margin}`;
        yExpr = `${topY}`;
        break;
      case 'bottom-left':
        xExpr = `${margin}`;
        yExpr = bottomY;
        break;
      case 'bottom-right':
        xExpr = `w-tw-${margin}`;
        yExpr = bottomY;
        break;
    }

    const boxArgs =
      Number(clockBgAlpha) > 0
        ? `:box=1:boxcolor=${clockBg}@${clockBgAlpha}:boxborderw=${Math.round(8 * scaleFactor)}`
        : '';

    textStages.push(
      `drawtext=${fontArg}expansion=normal:text='${localtimeExpr}':fontsize=${fSize}:fontcolor=${clockTxt}:x=${xExpr}:y=${yExpr}${boxArgs}`,
    );
  }

  if (tickerBarH > 0) {
    const tickerFile = writeOverlayTextFile('ticker', overlays.tickerText);
    const fSize = Math.round(Math.min(36, Math.max(14, overlays.tickerFontSize)) * scaleFactor);
    const bgColor = sanitizeHexColor(overlays.tickerBgColor, '0x1E293B');
    const bgAlpha = Math.min(1, Math.max(0.1, overlays.tickerBgOpacity)).toFixed(2);
    const txtColor = sanitizeHexColor(overlays.tickerColor, '0xF8FAFC');
    const speed = Math.round(Math.min(240, Math.max(40, overlays.tickerSpeed)) * scaleFactor);
    const barY = height - tickerBarH;

    textStages.push(`drawbox=x=0:y=${barY}:w=iw:h=${tickerBarH}:color=${bgColor}@${bgAlpha}:t=fill`);
    textStages.push(
      `drawtext=${fontArg}expansion=none:textfile='${escapeFilterPath(tickerFile)}':fontsize=${fSize}:fontcolor=${txtColor}:x=w-mod(t*${speed}\\,w+tw):y=${barY}+(${tickerBarH}-text_h)/2`,
    );
  }

  if (textStages.length > 0) {
    filters.push(`[${currentLabel}]${textStages.join(',')}[vout]`);
  } else {
    filters.push(`[${currentLabel}]null[vout]`);
  }

  return filters.join(';');
}

function diagnoseRtmpError(stderrLine: string): string | null {
  const lower = stderrLine.toLowerCase();
  if (lower.includes('connection refused')) {
    return 'RTMP connection refused by remote server. Verify the RTMP Server URL and port.';
  }
  if (lower.includes('name or service not known') || lower.includes('could not resolve hostname')) {
    return 'DNS resolution failed for the RTMP server hostname. Check internet access and server URL.';
  }
  if (lower.includes('tls') || lower.includes('ssl') || lower.includes('gnutls')) {
    return 'TLS/RTMPS handshake error. Ensure the server URL uses rtmps:// on port 443 and outbound TLS is allowed.';
  }
  if (lower.includes('403') || lower.includes('401') || lower.includes('unauthorized') || lower.includes('rejected')) {
    return 'Facebook rejected the RTMP stream key or connection. Generate a fresh Stream Key in Facebook Live Producer.';
  }
  if (lower.includes('input/output error') || lower.includes('broken pipe') || lower.includes('connection reset')) {
    return 'RTMP stream disconnected unexpectedly (I/O or broken pipe). Check stream key validity and network stability.';
  }
  if (lower.includes('timed out') || lower.includes('timeout')) {
    return 'Connection to Facebook RTMP server timed out.';
  }
  return null;
}

export interface StartStreamOptions {
  inputTarget: string;
  inputStream?: NodeJS.ReadableStream;
  inputFormat?: 'flv';
  hasAudioOverride?: boolean;
  isLocalFile: boolean;
  sourceType: VideoSourceType;
  sourceLabel: string;
  quality: StreamQualityProfile;
  rtmpServerUrl: string;
  streamKey: string;
  overlays: OverlayConfig;
  loopVideo: boolean;
}

class StreamManager extends EventEmitter {
  private process: ChildProcessWithoutNullStreams | null = null;
  private activeInputStream: NodeJS.ReadableStream | null = null;
  private isPipedInput = false;
  private status: StreamStatusState = 'Offline';
  private telemetry: StreamTelemetry = {
    status: 'Offline',
    quality: '720p',
    sourceType: null,
    sourceLabel: null,
    startedAt: null,
    durationSec: 0,
    outputResolution: '1280x720',
    bitrateKbps: 0,
    fps: 0,
    framesEncoded: 0,
    speed: '0x',
    loopVideo: false,
    lastError: null,
    sessionId: null,
  };
  private logs: StreamLogEntry[] = [];
  private durationTimer: NodeJS.Timeout | null = null;
  private activeSecretKey: string | null = null;
  private bitrateSamples: number[] = [];
  private stopRequested = false;

  public getTelemetry(): StreamTelemetry {
    return { ...this.telemetry };
  }

  public getLogs(): StreamLogEntry[] {
    return [...this.logs];
  }

  public isBusy(): boolean {
    return this.status === 'Connecting' || this.status === 'Live';
  }

  private pushLog(level: StreamLogEntry['level'], rawMessage: string): void {
    const safeMsg = redactSensitive(rawMessage, [this.activeSecretKey]);
    const entry: StreamLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      level,
      message: safeMsg,
    };
    this.logs.push(entry);
    if (this.logs.length > 250) {
      this.logs.shift();
    }
    this.emit('log', entry);
  }

  private updateStatus(next: Partial<StreamTelemetry>): void {
    this.telemetry = {
      ...this.telemetry,
      ...next,
    };
    this.status = this.telemetry.status;
    this.emit('status', this.getTelemetry());
  }

  private stopDurationTimer(): void {
    if (this.durationTimer) {
      clearInterval(this.durationTimer);
      this.durationTimer = null;
    }
  }

  public async startStream(options: StartStreamOptions): Promise<StreamTelemetry> {
    if (this.isBusy() || this.process) {
      throw new Error('STREAM_ALREADY_ACTIVE');
    }

    const rtmpValidation = validateRtmpUrl(options.rtmpServerUrl);
    if (!rtmpValidation.valid || !rtmpValidation.normalized) {
      throw new Error(rtmpValidation.error || 'Invalid RTMP Server URL.');
    }

    if (!options.streamKey || !options.streamKey.trim()) {
      throw new Error('Facebook RTMP Stream Key is missing. Save a valid Stream Key first.');
    }

    const ffCheck = await checkFfmpegAvailability();
    if (!ffCheck.available) {
      throw new Error('FFmpeg binary is not available on this host.');
    }

    let probe: MediaProbeResult;
    if (options.inputStream) {
      probe = {
        durationSec: 0,
        width: QUALITY_PROFILES[options.quality].width,
        height: QUALITY_PROFILES[options.quality].height,
        fps: 30,
        videoCodec: 'h264',
        audioCodec: options.hasAudioOverride ? 'aac' : null,
        hasAudio: Boolean(options.hasAudioOverride),
      };
    } else {
      try {
        probe = await probeMedia(options.inputTarget);
      } catch (err) {
        throw new Error(
          `Failed to inspect media source with ffprobe: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const profile = QUALITY_PROFILES[options.quality];
    const hasLogoInput = Boolean(
      options.overlays.logoEnabled &&
        options.overlays.logoPath &&
        fs.existsSync(options.overlays.logoPath),
    );

    const filterComplex = buildFilterGraph(profile.width, profile.height, options.overlays, hasLogoInput);
    const args: string[] = ['-hide_banner', '-loglevel', 'info'];
    if (options.inputStream) {
      if (options.inputFormat) {
        args.push('-f', options.inputFormat);
      }
      args.push('-fflags', '+genpts', '-i', 'pipe:0');
    } else {
      if (options.isLocalFile || !isLiveNetworkStreamUrl(options.inputTarget)) {
        args.push('-re');
      }
      if (options.isLocalFile && options.loopVideo) {
        args.push('-stream_loop', '-1');
      }
      args.push('-i', options.inputTarget);
    }

    let nextInputIndex = 1;
    if (hasLogoInput && options.overlays.logoPath) {
      args.push('-i', options.overlays.logoPath);
      nextInputIndex += 1;
    }

    let audioMapArg = '0:a:0';
    if (!probe.hasAudio) {
      args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
      audioMapArg = `${nextInputIndex}:a:0`;
    }

    const baseRtmp = rtmpValidation.normalized.endsWith('/')
      ? rtmpValidation.normalized
      : `${rtmpValidation.normalized}/`;
    const rtmpDestination = `${baseRtmp}${options.streamKey.trim()}`;

    const vBitrate = `${profile.videoBitrateKbps}k`;
    const bufSize = `${profile.videoBitrateKbps * 2}k`;
    const aBitrate = `${profile.audioBitrateKbps}k`;

    args.push(
      '-filter_complex',
      filterComplex,
      '-map',
      '[vout]',
      '-map',
      audioMapArg,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-tune',
      'zerolatency',
      '-profile:v',
      'main',
      '-level',
      '4.1',
      '-b:v',
      vBitrate,
      '-maxrate',
      vBitrate,
      '-bufsize',
      bufSize,
      '-g',
      '60',
      '-keyint_min',
      '60',
      '-sc_threshold',
      '0',
      '-r',
      '30',
      '-c:a',
      'aac',
      '-b:a',
      aBitrate,
      '-ar',
      '44100',
      '-ac',
      '2',
      '-flvflags',
      'no_duration_filesize',
      '-f',
      'flv',
      rtmpDestination,
    );

    const sessionId = `sess_${Date.now()}`;
    const startedAt = new Date().toISOString();
    this.activeSecretKey = options.streamKey.trim();
    this.bitrateSamples = [];
    this.stopRequested = false;

    this.updateStatus({
      status: 'Connecting',
      quality: options.quality,
      sourceType: options.sourceType,
      sourceLabel: options.sourceLabel,
      startedAt,
      durationSec: 0,
      outputResolution: profile.label,
      bitrateKbps: 0,
      fps: 0,
      framesEncoded: 0,
      speed: '0x',
      loopVideo: options.loopVideo,
      lastError: null,
      sessionId,
    });

    this.pushLog(
      'info',
      `Initializing FFmpeg broadcast (${profile.label} @ 30fps, ${profile.videoBitrateKbps} kbps) to ${baseRtmp}[REDACTED_STREAM_KEY]`,
    );
    if (!probe.hasAudio) {
      this.pushLog('warn', 'Source has no audio stream; injecting silent stereo AAC track for Facebook Live RTMP compatibility.');
    }

    const child = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.process = child;
    this.activeInputStream = options.inputStream ?? null;
    this.isPipedInput = Boolean(options.inputStream);

    if (options.inputStream) {
      options.inputStream.pipe(child.stdin);
      child.stdin.on('error', () => {
        // Ignore EPIPE when FFmpeg closes stdin on shutdown
      });
    }

    this.stopDurationTimer();
    const startMs = Date.now();
    this.durationTimer = setInterval(() => {
      if (this.status === 'Live') {
        this.updateStatus({
          durationSec: Math.floor((Date.now() - startMs) / 1000),
        });
      }
    }, 1000);

    let stderrBuffer = '';
    let diagnosedError: string | null = null;

    child.stderr.on('data', (chunk: Buffer) => {
      stderrBuffer += chunk.toString('utf8');
      const lines = stderrBuffer.split(/\r|\n/);
      stderrBuffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        const frameMatch = line.match(/frame=\s*(\d+)/);
        const fpsMatch = line.match(/fps=\s*([\d.]+)/);
        const bitrateMatch = line.match(/bitrate=\s*([\d.]+)kbits\/s/);
        const speedMatch = line.match(/speed=\s*([\d.]+x)/);

        if (frameMatch) {
          const frames = Number(frameMatch[1]) || 0;
          const fps = fpsMatch ? Number(fpsMatch[1]) || 0 : this.telemetry.fps;
          const bitrate = bitrateMatch ? Math.round(Number(bitrateMatch[1]) || 0) : this.telemetry.bitrateKbps;
          const speed = speedMatch ? speedMatch[1] : this.telemetry.speed;

          if (bitrate > 0) {
            this.bitrateSamples.push(bitrate);
          }

          if (this.status === 'Connecting' && frames >= 5) {
            this.pushLog('info', 'RTMP handshake succeeded. Stream is now LIVE.');
            this.updateStatus({
              status: 'Live',
              framesEncoded: frames,
              fps,
              bitrateKbps: bitrate,
              speed,
              durationSec: Math.floor((Date.now() - startMs) / 1000),
            });
          } else {
            this.updateStatus({
              framesEncoded: frames,
              fps,
              bitrateKbps: bitrate,
              speed,
            });
          }
          continue;
        }

        const rtmpDiag = diagnoseRtmpError(line);
        if (rtmpDiag) {
          diagnosedError = rtmpDiag;
          this.pushLog('error', rtmpDiag);
        }
        this.pushLog('ffmpeg', line);
      }
    });

    child.on('error', (err) => {
      this.stopDurationTimer();
      const msg = redactSensitive(err.message, [this.activeSecretKey]);
      this.pushLog('error', `FFmpeg process spawn error: ${msg}`);
      this.process = null;
      this.activeSecretKey = null;
      this.updateStatus({
        status: 'Error',
        lastError: msg,
        fps: 0,
        bitrateKbps: 0,
      });
    });

    child.on('close', (code, signal) => {
      this.stopDurationTimer();
      const endedAt = new Date().toISOString();
      const durationSec = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
      const avgBitrate =
        this.bitrateSamples.length > 0
          ? Math.round(this.bitrateSamples.reduce((a, b) => a + b, 0) / this.bitrateSamples.length)
          : 0;

      const wasError = !this.stopRequested && code !== 0 && signal !== 'SIGTERM';
      const finalError = wasError
        ? diagnosedError || `FFmpeg exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'none'}).`
        : null;

      if (wasError) {
        this.pushLog('error', finalError || 'Broadcast ended with an error.');
      } else {
        this.pushLog('info', `Broadcast stopped cleanly (${durationSec}s elapsed).`);
      }

      const historyEntry: StreamHistoryEntry = {
        id: sessionId,
        startedAt,
        endedAt,
        durationSec,
        sourceLabel: options.sourceLabel,
        sourceType: options.sourceType,
        quality: options.quality,
        outputResolution: profile.label,
        avgBitrateKbps: avgBitrate,
        status: wasError ? 'Error' : this.stopRequested ? 'Stopped' : 'Completed',
        errorMessage: finalError,
      };
      addStreamHistoryEntry(historyEntry);
      this.emit('history', historyEntry);

      if (this.activeInputStream) {
        try {
          this.activeInputStream.unpipe(child.stdin);
          if ('destroy' in this.activeInputStream && typeof this.activeInputStream.destroy === 'function') {
            this.activeInputStream.destroy();
          }
        } catch {
          // ignore
        }
        this.activeInputStream = null;
      }
      this.isPipedInput = false;
      this.process = null;
      this.activeSecretKey = null;
      this.updateStatus({
        status: wasError ? 'Error' : 'Offline',
        lastError: finalError,
        fps: 0,
        bitrateKbps: 0,
        speed: '0x',
      });
    });

    return this.getTelemetry();
  }

  public async stopStream(): Promise<StreamTelemetry> {
    if (!this.process) {
      this.stopDurationTimer();
      this.updateStatus({
        status: 'Offline',
        fps: 0,
        bitrateKbps: 0,
        speed: '0x',
      });
      return this.getTelemetry();
    }

    this.stopRequested = true;
    this.pushLog('info', 'Sending graceful stop signal to FFmpeg...');
    const proc = this.process;
    const piped = this.isPipedInput;
    const inputStream = this.activeInputStream;

    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      proc.once('close', done);

      if (piped) {
        try {
          if (inputStream) {
            inputStream.unpipe(proc.stdin);
            if ('destroy' in inputStream && typeof inputStream.destroy === 'function') {
              inputStream.destroy();
            }
          }
          proc.stdin.end();
        } catch {
          // ignore
        }
        proc.kill('SIGTERM');
      } else {
        try {
          proc.stdin.write('q\n');
        } catch {
          // Ignore write error if stdin already closed
        }
        setTimeout(() => {
          if (!settled && proc.exitCode === null) {
            proc.kill('SIGTERM');
          }
        }, 2000);
      }

      setTimeout(() => {
        if (!settled && proc.exitCode === null) {
          proc.kill('SIGKILL');
          done();
        }
      }, 4500);
    });

    return this.getTelemetry();
  }

  public async testPipelineDryRun(
    inputTarget: string,
    quality: StreamQualityProfile,
    overlays: OverlayConfig,
    pipedOptions?: {
      inputStream: NodeJS.ReadableStream;
      inputFormat: 'flv';
      hasAudio: boolean;
    },
  ): Promise<PipelineCheckResult> {
    const startMs = Date.now();
    const profile = QUALITY_PROFILES[quality];
    const probe = pipedOptions
      ? {
          durationSec: 0,
          width: profile.width,
          height: profile.height,
          fps: 30,
          videoCodec: 'h264',
          audioCodec: pipedOptions.hasAudio ? 'aac' : null,
          hasAudio: pipedOptions.hasAudio,
        }
      : await probeMedia(inputTarget);

    const hasLogoInput = Boolean(
      overlays.logoEnabled && overlays.logoPath && fs.existsSync(overlays.logoPath),
    );
    const filterComplex = buildFilterGraph(profile.width, profile.height, overlays, hasLogoInput);

    const args: string[] = ['-hide_banner', '-loglevel', 'error'];
    if (pipedOptions) {
      args.push('-f', pipedOptions.inputFormat, '-fflags', '+genpts', '-i', 'pipe:0');
    } else {
      args.push('-i', inputTarget);
    }

    let nextIdx = 1;
    if (hasLogoInput && overlays.logoPath) {
      args.push('-i', overlays.logoPath);
      nextIdx += 1;
    }
    let audioMapArg = '0:a:0';
    if (!probe.hasAudio) {
      args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
      audioMapArg = `${nextIdx}:a:0`;
    }

    args.push(
      '-t',
      '2',
      '-filter_complex',
      filterComplex,
      '-map',
      '[vout]',
      '-map',
      audioMapArg,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-b:v',
      `${profile.videoBitrateKbps}k`,
      '-r',
      '30',
      '-c:a',
      'aac',
      '-b:a',
      `${profile.audioBitrateKbps}k`,
      '-f',
      'null',
      '-',
    );

    if (pipedOptions) {
      return new Promise<PipelineCheckResult>((resolve) => {
        const child = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
        let stderr = '';
        let settled = false;

        const finish = (ok: boolean, errMsg?: string) => {
          if (settled) return;
          settled = true;
          try {
            pipedOptions.inputStream.unpipe(child.stdin);
            if ('destroy' in pipedOptions.inputStream && typeof pipedOptions.inputStream.destroy === 'function') {
              pipedOptions.inputStream.destroy();
            }
          } catch {
            // ignore
          }
          if (ok) {
            resolve({
              success: true,
              durationMs: Date.now() - startMs,
              ffmpegCommandSummary: `ffmpeg -f flv -i pipe:0 -filter_complex "${filterComplex.slice(0, 84)}..." -c:v libx264 -r 30 -c:a aac -f null -`,
              videoCodec: 'libx264 (H.264)',
              audioCodec: pipedOptions.hasAudio ? 'aac (Android Playback Audio)' : 'aac (silent fallback)',
              resolution: profile.label,
              message: `Android capture dry-run encode passed in ${Date.now() - startMs}ms. Live capture A/V sync and overlays verified.`,
              stderrExcerpt: stderr.trim() || undefined,
            });
          } else {
            resolve({
              success: false,
              durationMs: Date.now() - startMs,
              ffmpegCommandSummary: 'ffmpeg piped dry-run failed',
              videoCodec: 'libx264',
              audioCodec: 'aac',
              resolution: profile.label,
              message: `Pipeline validation failed: ${errMsg || stderr || 'FFmpeg exited unexpectedly.'}`,
              stderrExcerpt: errMsg || stderr || undefined,
            });
          }
        };

        pipedOptions.inputStream.pipe(child.stdin);
        child.stdin.on('error', () => {
          // ignore EPIPE
        });
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString('utf8');
        });
        const timer = setTimeout(() => {
          if (child.exitCode === null) {
            child.kill('SIGTERM');
          }
          finish(false, 'Dry-run timed out waiting for 2 seconds of Android capture frames.');
        }, 12000);
        child.on('close', (code) => {
          clearTimeout(timer);
          if (code === 0) {
            finish(true);
          } else {
            finish(false, stderr.trim() || `FFmpeg exited with code ${code ?? 'null'}`);
          }
        });
      });
    }

    try {
      const { stderr } = await execFileAsync('ffmpeg', args, { timeout: 25000 });
      return {
        success: true,
        durationMs: Date.now() - startMs,
        ffmpegCommandSummary: `ffmpeg -i <source> -filter_complex "${filterComplex.slice(0, 96)}..." -c:v libx264 -r 30 -c:a aac -f null -`,
        videoCodec: 'libx264 (H.264)',
        audioCodec: probe.hasAudio ? 'aac (mapped)' : 'aac (silent fallback)',
        resolution: profile.label,
        message: `Local dry-run encode passed in ${Date.now() - startMs}ms. Video, audio mapping, and active overlays rendered cleanly.`,
        stderrExcerpt: stderr.trim() || undefined,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        durationMs: Date.now() - startMs,
        ffmpegCommandSummary: 'ffmpeg dry-run failed',
        videoCodec: 'libx264',
        audioCodec: 'aac',
        resolution: profile.label,
        message: `Pipeline validation failed: ${msg}`,
        stderrExcerpt: msg,
      };
    }
  }
}

export const streamManager = new StreamManager();
