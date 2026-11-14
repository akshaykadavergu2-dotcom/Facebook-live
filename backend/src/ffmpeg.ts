import { EventEmitter } from 'node:events';
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { promisify } from 'node:util';
import type {
  DestinationId,
  DestinationMode,
  DestinationStreamTelemetry,
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
import { FlvStreamSplitter } from './flvMuxer.ts';
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

export function validateRtmpUrl(
  rawUrl: string,
  platformLabel = 'RTMP',
): { valid: boolean; normalized?: string; error?: string } {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { valid: false, error: `${platformLabel} Server URL is required.` };
  }
  if (/[\s\r\n\0]/.test(trimmed)) {
    return {
      valid: false,
      error: `${platformLabel} Server URL must not contain whitespace or control characters.`,
    };
  }
  if (/^https?:\/\/(www\.)?(youtube\.com|youtu\.be|m\.youtube\.com)/i.test(trimmed)) {
    return {
      valid: false,
      error:
        'A YouTube watch/share URL cannot be used as an RTMP ingest server. Enter your YouTube RTMP URL (e.g., rtmps://a.rtmps.youtube.com:443/live2).',
    };
  }
  if (!/^rtmps?:\/\//i.test(trimmed)) {
    return { valid: false, error: `${platformLabel} Server URL must begin with rtmp:// or rtmps://.` };
  }
  try {
    const httpEquivalent = trimmed.replace(/^rtmps?:\/\//i, 'https://');
    const parsed = new URL(httpEquivalent);
    if (!parsed.hostname || parsed.hostname.length < 3) {
      return { valid: false, error: `${platformLabel} Server URL must include a valid hostname.` };
    }
    if (isPrivateOrLoopbackHost(parsed.hostname)) {
      return {
        valid: false,
        error: 'Private network or loopback RTMP destinations are blocked for security.',
      };
    }
    return { valid: true, normalized: trimmed };
  } catch {
    return { valid: false, error: `Invalid ${platformLabel} Server URL format.` };
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
        'YouTube share links cannot be streamed via FFmpeg RTMP. Use Monitor A Preview + Android Capture, or select an authorized MP4/HLS/RTMP/SRT feed.',
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

function clampPercent(val: number | null | undefined, fallback: number): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) return fallback;
  return Math.min(95, Math.max(2, val));
}

export function buildFilterGraph(
  width: number,
  height: number,
  overlays: OverlayConfig,
  hasLogoInput: boolean,
  hasImageOverlayInput = false,
): string {
  const filters: string[] = [];
  let currentLabel = 'vbase';
  let nextInputIdx = 1;

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
    filters.push(`[${nextInputIdx}:v]scale=${logoWidth}:-1,format=rgba,colorchannelmixer=aa=${opacity}[logo_img]`);
    nextInputIdx += 1;

    let posExpr: string;
    if (typeof overlays.logoX === 'number' && typeof overlays.logoY === 'number') {
      const px = Math.round((clampPercent(overlays.logoX, 82) / 100) * width);
      const py = Math.round((clampPercent(overlays.logoY, 8) / 100) * height);
      posExpr = `min(${px}\\,W-w):min(${py}\\,H-h)`;
    } else {
      const margin = Math.round(24 * scaleFactor);
      const topMargin = hasHeadlineBar ? Math.round(24 * scaleFactor) + headlineBoxH + Math.round(10 * scaleFactor) : margin;
      const bottomY = `H-h-${margin + bottomStackH}`;
      posExpr = `W-w-${margin}:${topMargin}`;
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
    }
    const nextLabel = 'vlogo';
    filters.push(`[${currentLabel}][logo_img]overlay=${posExpr}:shortest=0[${nextLabel}]`);
    currentLabel = nextLabel;
  }

  if (hasImageOverlayInput) {
    const imgWidth = Math.max(
      64,
      Math.round(width * (Math.min(50, Math.max(5, overlays.imageOverlayScale ?? 18)) / 100)),
    );
    const opacity = Math.min(1, Math.max(0.1, overlays.imageOverlayOpacity ?? 0.92)).toFixed(2);
    filters.push(`[${nextInputIdx}:v]scale=${imgWidth}:-1,format=rgba,colorchannelmixer=aa=${opacity}[extra_img]`);
    nextInputIdx += 1;

    const px = Math.round((clampPercent(overlays.imageOverlayX, 8) / 100) * width);
    const py = Math.round((clampPercent(overlays.imageOverlayY, 18) / 100) * height);
    const nextLabel = 'vimg';
    filters.push(`[${currentLabel}][extra_img]overlay=min(${px}\\,W-w):min(${py}\\,H-h):shortest=0[${nextLabel}]`);
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
    const defaultX = Math.round(28 * scaleFactor);
    const defaultY = height - bottomStackH - boxH - Math.round(20 * scaleFactor);
    const marginX =
      typeof overlays.lowerThirdX === 'number'
        ? Math.min(width - boxW, Math.max(8, Math.round((overlays.lowerThirdX / 100) * width)))
        : defaultX;
    const boxY =
      typeof overlays.lowerThirdY === 'number'
        ? Math.min(height - boxH, Math.max(8, Math.round((overlays.lowerThirdY / 100) * height)))
        : defaultY;
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

  if (overlays.customTextEnabled && overlays.customText && overlays.customText.trim().length > 0) {
    const customFile = writeOverlayTextFile('custom-text', overlays.customText);
    const fSize = Math.round(Math.min(64, Math.max(14, overlays.customTextFontSize ?? 24)) * scaleFactor);
    const txtColor = sanitizeHexColor(overlays.customTextColor || '#FFFFFF', '0xFFFFFF');
    const bgColor = sanitizeHexColor(overlays.customTextBgColor || '#1E1B4B', '0x1E1B4B');
    const bgAlpha = Math.min(1, Math.max(0, overlays.customTextBgOpacity ?? 0.78)).toFixed(2);
    const pctX = clampPercent(overlays.customTextX, 50);
    const pctY = clampPercent(overlays.customTextY, 16);
    const yExpr = `min(${Math.round((pctY / 100) * height)}\\,h-th-8)`;

    let xExpr: string;
    switch (overlays.customTextAlign) {
      case 'left':
        xExpr = `max(8\\,min(${Math.round((pctX / 100) * width)}\\,w-tw-8))`;
        break;
      case 'right':
        xExpr = `max(8\\,min(${Math.round((pctX / 100) * width)}-tw\\,w-tw-8))`;
        break;
      case 'center':
      default:
        xExpr = `max(8\\,min(${Math.round((pctX / 100) * width)}-tw/2\\,w-tw-8))`;
        break;
    }

    const boxArgs =
      Number(bgAlpha) > 0
        ? `:box=1:boxcolor=${bgColor}@${bgAlpha}:boxborderw=${Math.round(10 * scaleFactor)}`
        : '';

    textStages.push(
      `drawtext=${fontArg}expansion=none:textfile='${escapeFilterPath(customFile)}':fontsize=${fSize}:fontcolor=${txtColor}:x=${xExpr}:y=${yExpr}${boxArgs}`,
    );
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

    let xExpr: string;
    let yExpr: string;
    if (typeof overlays.clockX === 'number' && typeof overlays.clockY === 'number') {
      xExpr = `min(${Math.round((clampPercent(overlays.clockX, 76) / 100) * width)}\\,w-tw-8)`;
      yExpr = `min(${Math.round((clampPercent(overlays.clockY, 8) / 100) * height)}\\,h-th-8)`;
    } else {
      xExpr = `w-tw-${margin}`;
      yExpr = `${topY}`;
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

function diagnoseRtmpError(stderrLine: string, platformLabel = 'RTMP'): string | null {
  const lower = stderrLine.toLowerCase();
  if (lower.includes('connection refused')) {
    return `${platformLabel} connection refused by remote server. Verify the Server URL and port.`;
  }
  if (lower.includes('name or service not known') || lower.includes('could not resolve hostname')) {
    return `DNS resolution failed for ${platformLabel} hostname. Check internet access and server URL.`;
  }
  if (lower.includes('tls') || lower.includes('ssl') || lower.includes('gnutls')) {
    return `TLS/RTMPS handshake error for ${platformLabel}. Ensure rtmps:// uses port 443 and TLS is permitted.`;
  }
  if (lower.includes('403') || lower.includes('401') || lower.includes('unauthorized') || lower.includes('rejected')) {
    return `${platformLabel} rejected the Stream Key or connection. Generate a fresh Stream Key in ${platformLabel} Live Producer.`;
  }
  if (lower.includes('input/output error') || lower.includes('broken pipe') || lower.includes('connection reset')) {
    return `${platformLabel} stream disconnected unexpectedly (I/O or broken pipe). Check stream key validity and network stability.`;
  }
  if (lower.includes('timed out') || lower.includes('timeout')) {
    return `Connection to ${platformLabel} RTMP server timed out.`;
  }
  return null;
}

export interface DestinationTarget {
  id: DestinationId;
  label: string;
  rtmpServerUrl: string;
  streamKey: string;
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
  rtmpServerUrl?: string;
  streamKey?: string;
  destinationMode?: DestinationMode;
  destinations?: DestinationTarget[];
  overlays: OverlayConfig;
  loopVideo: boolean;
}

interface ActivePusher {
  id: DestinationId;
  label: string;
  proc: ChildProcessWithoutNullStreams;
  pipe: PassThrough;
  headersSent: boolean;
  stopRequested: boolean;
  droppedFrames: number;
  connectedAtMs: number | null;
}

function createDefaultDestinationTelemetry(id: DestinationId, label: string): DestinationStreamTelemetry {
  return {
    id,
    label,
    connected: false,
    status: 'Offline',
    bitrateKbps: 0,
    fps: 0,
    outputResolution: '1280x720',
    droppedFrames: 0,
    latencyMs: 0,
    lastError: null,
  };
}

class StreamManager extends EventEmitter {
  private compositorProcess: ChildProcessWithoutNullStreams | null = null;
  private splitter: FlvStreamSplitter | null = null;
  private pushers = new Map<DestinationId, ActivePusher>();
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
    destinationMode: 'facebook',
    destinations: {
      facebook: createDefaultDestinationTelemetry('facebook', 'Facebook Live'),
      youtube: createDefaultDestinationTelemetry('youtube', 'YouTube Live'),
    },
  };
  private logs: StreamLogEntry[] = [];
  private durationTimer: NodeJS.Timeout | null = null;
  private activeSecretKeys = new Set<string>();
  private bitrateSamples: number[] = [];
  private stopRequested = false;

  public getTelemetry(): StreamTelemetry {
    return {
      ...this.telemetry,
      destinations: this.telemetry.destinations
        ? {
            facebook: { ...this.telemetry.destinations.facebook },
            youtube: { ...this.telemetry.destinations.youtube },
          }
        : undefined,
    };
  }

  public getLogs(): StreamLogEntry[] {
    return [...this.logs];
  }

  public isBusy(): boolean {
    return this.status === 'Connecting' || this.status === 'Live';
  }

  private pushLog(level: StreamLogEntry['level'], rawMessage: string): void {
    const safeMsg = redactSensitive(rawMessage, Array.from(this.activeSecretKeys));
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

  private updateDestinationTelemetry(
    id: DestinationId,
    next: Partial<DestinationStreamTelemetry>,
  ): void {
    const current = this.telemetry.destinations ?? {
      facebook: createDefaultDestinationTelemetry('facebook', 'Facebook Live'),
      youtube: createDefaultDestinationTelemetry('youtube', 'YouTube Live'),
    };
    current[id] = {
      ...current[id],
      ...next,
    };
    this.telemetry.destinations = current;
    this.emit('status', this.getTelemetry());
  }

  private stopDurationTimer(): void {
    if (this.durationTimer) {
      clearInterval(this.durationTimer);
      this.durationTimer = null;
    }
  }

  public async startStream(options: StartStreamOptions): Promise<StreamTelemetry> {
    if (this.isBusy() || this.compositorProcess) {
      throw new Error('STREAM_ALREADY_ACTIVE');
    }

    const targets: DestinationTarget[] =
      options.destinations && options.destinations.length > 0
        ? options.destinations
        : options.rtmpServerUrl && options.streamKey
          ? [
              {
                id: 'facebook',
                label: 'Facebook Live',
                rtmpServerUrl: options.rtmpServerUrl,
                streamKey: options.streamKey,
              },
            ]
          : [];

    if (targets.length === 0) {
      throw new Error('At least one RTMP destination (Facebook or YouTube) must be configured.');
    }

    const validatedTargets: DestinationTarget[] = [];
    for (const target of targets) {
      const check = validateRtmpUrl(target.rtmpServerUrl, target.label);
      if (!check.valid || !check.normalized) {
        throw new Error(check.error || `Invalid ${target.label} RTMP Server URL.`);
      }
      if (!target.streamKey || !target.streamKey.trim()) {
        throw new Error(`${target.label} Stream Key is missing. Save a valid Stream Key first.`);
      }
      validatedTargets.push({
        ...target,
        rtmpServerUrl: check.normalized,
        streamKey: target.streamKey.trim(),
      });
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
    const hasImageInput = Boolean(
      options.overlays.imageOverlayEnabled &&
        options.overlays.imageOverlayPath &&
        fs.existsSync(options.overlays.imageOverlayPath),
    );

    const filterComplex = buildFilterGraph(
      profile.width,
      profile.height,
      options.overlays,
      hasLogoInput,
      hasImageInput,
    );

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
    if (hasImageInput && options.overlays.imageOverlayPath) {
      args.push('-i', options.overlays.imageOverlayPath);
      nextInputIndex += 1;
    }

    let audioMapArg = '0:a:0';
    if (!probe.hasAudio) {
      args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
      audioMapArg = `${nextInputIndex}:a:0`;
    }

    const vBitrate = `${profile.videoBitrateKbps}k`;
    const bufSize = `${profile.videoBitrateKbps * 2}k`;
    const aBitrate = `${profile.audioBitrateKbps}k`;

    // Master compositor outputs a single synchronized FLV stream (H.264 + AAC) to stdout
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
      'pipe:1',
    );

    const sessionId = `sess_${Date.now()}`;
    const startedAt = new Date().toISOString();
    this.activeSecretKeys.clear();
    for (const t of validatedTargets) {
      this.activeSecretKeys.add(t.streamKey);
    }
    this.bitrateSamples = [];
    this.stopRequested = false;

    const destinationMode: DestinationMode =
      options.destinationMode ||
      (validatedTargets.length === 2
        ? 'both'
        : validatedTargets[0].id === 'youtube'
          ? 'youtube'
          : 'facebook');

    const destMap: Record<DestinationId, DestinationStreamTelemetry> = {
      facebook: createDefaultDestinationTelemetry('facebook', 'Facebook Live'),
      youtube: createDefaultDestinationTelemetry('youtube', 'YouTube Live'),
    };
    destMap.facebook.outputResolution = profile.label;
    destMap.youtube.outputResolution = profile.label;
    for (const t of validatedTargets) {
      destMap[t.id].status = 'Connecting';
      destMap[t.id].lastError = null;
    }

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
      destinationMode,
      destinations: destMap,
    });

    this.pushLog(
      'info',
      `Initializing master FFmpeg compositor (${profile.label} @ 30fps, ${profile.videoBitrateKbps} kbps) -> ${validatedTargets.map((t) => t.label).join(' + ')}`,
    );
    if (!probe.hasAudio) {
      this.pushLog('warn', 'Source has no audio stream; injecting silent stereo AAC track for RTMP compatibility.');
    }

    const compositor = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.compositorProcess = compositor;
    this.activeInputStream = options.inputStream ?? null;
    this.isPipedInput = Boolean(options.inputStream);

    // Prepare FLV splitter to fan out synchronized FLV header + sequence headers + A/V tags to pushers
    this.splitter = new FlvStreamSplitter({
      onHeader: (header) => {
        for (const pusher of this.pushers.values()) {
          if (!pusher.headersSent && !pusher.pipe.destroyed && !pusher.pipe.writableEnded) {
            pusher.pipe.write(header);
            pusher.headersSent = true;
          }
        }
      },
      onTag: (tag, info) => {
        for (const pusher of this.pushers.values()) {
          if (pusher.pipe.destroyed || pusher.pipe.writableEnded) continue;
          if (!pusher.headersSent && this.splitter) {
            for (const chunk of this.splitter.getBootstrapChunks()) {
              pusher.pipe.write(chunk);
            }
            pusher.headersSent = true;
            continue;
          }
          if (pusher.pipe.writableNeedDrain && !info.isKeyframe && !info.isSequenceHeader) {
            pusher.droppedFrames += 1;
            continue;
          }
          pusher.pipe.write(tag);
        }
      },
    });

    // Spawn independent RTMP pusher(s) cleanly before compositor starts emitting tags
    for (const t of validatedTargets) {
      this.spawnDestinationPusher(t, profile.label);
    }

    compositor.stdout.on('data', (chunk: Buffer) => {
      this.splitter?.push(chunk);
    });

    if (options.inputStream) {
      options.inputStream.pipe(compositor.stdin);
      compositor.stdin.on('error', () => {
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
    let compositorError: string | null = null;

    compositor.stderr.on('data', (chunk: Buffer) => {
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

          this.updateStatus({
            framesEncoded: frames,
            fps,
            bitrateKbps: bitrate,
            speed,
            durationSec: Math.floor((Date.now() - startMs) / 1000),
          });
          continue;
        }

        const diag = diagnoseRtmpError(line, 'Compositor');
        if (diag) {
          compositorError = diag;
          this.pushLog('error', diag);
        }
        this.pushLog('ffmpeg', line);
      }
    });

    compositor.on('error', (err) => {
      const msg = redactSensitive(err.message, Array.from(this.activeSecretKeys));
      compositorError = msg;
      this.pushLog('error', `Master compositor process spawn error: ${msg}`);
    });

    compositor.on('close', (code, signal) => {
      this.stopDurationTimer();
      this.closeAllPushers();

      const endedAt = new Date().toISOString();
      const durationSec = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
      const avgBitrate =
        this.bitrateSamples.length > 0
          ? Math.round(this.bitrateSamples.reduce((a, b) => a + b, 0) / this.bitrateSamples.length)
          : 0;

      const wasError = !this.stopRequested && code !== 0 && signal !== 'SIGTERM';
      const finalError = wasError
        ? compositorError || this.telemetry.lastError || `FFmpeg exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'none'}).`
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
          this.activeInputStream.unpipe(compositor.stdin);
          if ('destroy' in this.activeInputStream && typeof this.activeInputStream.destroy === 'function') {
            this.activeInputStream.destroy();
          }
        } catch {
          // ignore
        }
        this.activeInputStream = null;
      }

      this.isPipedInput = false;
      this.compositorProcess = null;
      this.splitter = null;
      this.activeSecretKeys.clear();

      // Mark any non-Error destination offline cleanly
      for (const id of ['facebook', 'youtube'] as DestinationId[]) {
        const cur = this.telemetry.destinations?.[id];
        if (cur && cur.status !== 'Error') {
          this.updateDestinationTelemetry(id, {
            connected: false,
            status: 'Offline',
            bitrateKbps: 0,
            fps: 0,
          });
        }
      }

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

  public startAdditionalDestination(target: DestinationTarget): boolean {
    if (!this.compositorProcess || !this.splitter) {
      return false;
    }
    const existing = this.pushers.get(target.id);
    if (existing) {
      return true;
    }
    const check = validateRtmpUrl(target.rtmpServerUrl, target.label);
    if (!check.valid || !check.normalized || !target.streamKey.trim()) {
      return false;
    }
    const cleanTarget: DestinationTarget = {
      ...target,
      rtmpServerUrl: check.normalized,
      streamKey: target.streamKey.trim(),
    };
    this.activeSecretKeys.add(cleanTarget.streamKey);
    const pusher = this.spawnDestinationPusher(cleanTarget, this.telemetry.outputResolution);
    const bootstrap = this.splitter.getBootstrapChunks();
    if (bootstrap.length > 0) {
      for (const chunk of bootstrap) {
        pusher.pipe.write(chunk);
      }
      pusher.headersSent = true;
    }
    return true;
  }

  public async stopDestination(id: DestinationId): Promise<StreamTelemetry> {
    const pusher = this.pushers.get(id);
    if (!pusher) {
      this.updateDestinationTelemetry(id, {
        connected: false,
        status: 'Offline',
        bitrateKbps: 0,
        fps: 0,
      });
      return this.getTelemetry();
    }

    pusher.stopRequested = true;
    this.pushLog('info', `Disconnecting ${pusher.label} output...`);
    await this.terminatePusher(pusher);

    // If no active pushers remain and compositor is running, stop the broadcast cleanly
    if (this.pushers.size === 0 && this.compositorProcess) {
      return this.stopStream();
    }
    this.recomputeOverallStatusFromPushers();
    return this.getTelemetry();
  }

  private spawnDestinationPusher(target: DestinationTarget, resolutionLabel: string): ActivePusher {
    const baseRtmp = target.rtmpServerUrl.endsWith('/') ? target.rtmpServerUrl : `${target.rtmpServerUrl}/`;
    const rtmpDestination = `${baseRtmp}${target.streamKey}`;
    const pipe = new PassThrough({ highWaterMark: 1024 * 1024 });

    const pusherArgs = [
      '-hide_banner',
      '-loglevel',
      'info',
      '-f',
      'flv',
      '-i',
      'pipe:0',
      '-c',
      'copy',
      '-flvflags',
      'no_duration_filesize',
      '-f',
      'flv',
      rtmpDestination,
    ];

    const proc = spawn('ffmpeg', pusherArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    const pusher: ActivePusher = {
      id: target.id,
      label: target.label,
      proc,
      pipe,
      headersSent: false,
      stopRequested: false,
      droppedFrames: 0,
      connectedAtMs: null,
    };
    this.pushers.set(target.id, pusher);

    this.updateDestinationTelemetry(target.id, {
      connected: false,
      status: 'Connecting',
      outputResolution: resolutionLabel,
      droppedFrames: 0,
      lastError: null,
    });

    this.pushLog('info', `Connecting ${target.label} pusher -> ${baseRtmp}[REDACTED_STREAM_KEY]`);

    pipe.pipe(proc.stdin);
    proc.stdin.on('error', () => {
      // Ignore EPIPE on close
    });

    let stderrBuf = '';
    let diagnosedError: string | null = null;
    const handshakeStartMs = Date.now();

    proc.stderr.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf8');
      const lines = stderrBuf.split(/\r|\n/);
      stderrBuf = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        const frameMatch = line.match(/frame=\s*(\d+)/);
        const fpsMatch = line.match(/fps=\s*([\d.]+)/);
        const bitrateMatch = line.match(/bitrate=\s*([\d.]+)kbits\/s/);

        if (frameMatch) {
          const frames = Number(frameMatch[1]) || 0;
          const fps = fpsMatch ? Number(fpsMatch[1]) || 0 : 30;
          const bitrate = bitrateMatch ? Math.round(Number(bitrateMatch[1]) || 0) : 0;

          if (pusher.connectedAtMs === null && frames >= 3) {
            pusher.connectedAtMs = Date.now();
            const handshakeLatency = Math.max(10, pusher.connectedAtMs - handshakeStartMs);
            this.pushLog('info', `${target.label} RTMPS handshake succeeded. Output is LIVE.`);
            this.updateDestinationTelemetry(target.id, {
              connected: true,
              status: 'Live',
              bitrateKbps: bitrate,
              fps,
              droppedFrames: pusher.droppedFrames,
              latencyMs: handshakeLatency,
              lastError: null,
            });
            this.recomputeOverallStatusFromPushers();
          } else {
            this.updateDestinationTelemetry(target.id, {
              bitrateKbps: bitrate,
              fps,
              droppedFrames: pusher.droppedFrames,
            });
          }
          continue;
        }

        const diag = diagnoseRtmpError(line, target.label);
        if (diag) {
          diagnosedError = diag;
          this.pushLog('error', diag);
        }
        this.pushLog('ffmpeg', `[${target.label}] ${line}`);
      }
    });

    proc.on('error', (err) => {
      const msg = redactSensitive(err.message, Array.from(this.activeSecretKeys));
      diagnosedError = msg;
      this.pushLog('error', `[${target.label}] Pusher spawn error: ${msg}`);
    });

    proc.on('close', (code, signal) => {
      this.pushers.delete(target.id);
      pipe.unpipe(proc.stdin);
      if (!pipe.destroyed) pipe.destroy();

      const wasError = !pusher.stopRequested && !this.stopRequested && code !== 0 && signal !== 'SIGTERM';
      const errMsg = wasError
        ? diagnosedError || `${target.label} RTMP output disconnected (code=${code ?? 'null'}).`
        : null;

      if (wasError) {
        this.pushLog('error', errMsg!);
      } else {
        this.pushLog('info', `${target.label} output disconnected cleanly.`);
      }

      this.updateDestinationTelemetry(target.id, {
        connected: false,
        status: wasError ? 'Error' : 'Offline',
        bitrateKbps: 0,
        fps: 0,
        lastError: errMsg,
      });

      this.recomputeOverallStatusFromPushers();

      // If all active destination pushers are gone while compositor was running unrequested, shut down compositor
      if (this.pushers.size === 0 && this.compositorProcess && !this.stopRequested) {
        if (wasError && errMsg) {
          this.updateStatus({ lastError: errMsg });
        }
        void this.stopCompositorOnly();
      }
    });

    return pusher;
  }

  private recomputeOverallStatusFromPushers(): void {
    const dest = this.telemetry.destinations;
    if (!dest) return;
    const anyLive = dest.facebook.status === 'Live' || dest.youtube.status === 'Live';
    const anyConnecting = dest.facebook.status === 'Connecting' || dest.youtube.status === 'Connecting';
    if (anyLive) {
      if (this.status !== 'Live') {
        this.updateStatus({ status: 'Live' });
      }
    } else if (anyConnecting) {
      if (this.status !== 'Connecting') {
        this.updateStatus({ status: 'Connecting' });
      }
    }
  }

  private async terminatePusher(pusher: ActivePusher): Promise<void> {
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      if (pusher.proc.exitCode !== null) {
        done();
        return;
      }
      pusher.proc.once('close', done);
      try {
        pusher.pipe.unpipe(pusher.proc.stdin);
        if (!pusher.pipe.destroyed) pusher.pipe.destroy();
        pusher.proc.stdin.end();
      } catch {
        // ignore
      }
      pusher.proc.kill('SIGTERM');
      setTimeout(() => {
        if (!settled && pusher.proc.exitCode === null) {
          pusher.proc.kill('SIGKILL');
          done();
        }
      }, 2500);
    });
  }

  private closeAllPushers(): void {
    for (const pusher of this.pushers.values()) {
      pusher.stopRequested = true;
      try {
        pusher.pipe.unpipe(pusher.proc.stdin);
        if (!pusher.pipe.destroyed) pusher.pipe.destroy();
        pusher.proc.stdin.end();
        if (pusher.proc.exitCode === null) {
          pusher.proc.kill('SIGTERM');
        }
      } catch {
        // ignore
      }
    }
    this.pushers.clear();
  }

  private async stopCompositorOnly(): Promise<void> {
    const proc = this.compositorProcess;
    if (!proc) return;
    this.stopRequested = true;
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      if (proc.exitCode !== null) {
        done();
        return;
      }
      proc.once('close', done);
      if (this.isPipedInput) {
        try {
          if (this.activeInputStream) {
            this.activeInputStream.unpipe(proc.stdin);
            if ('destroy' in this.activeInputStream && typeof this.activeInputStream.destroy === 'function') {
              this.activeInputStream.destroy();
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
          // ignore
        }
        setTimeout(() => {
          if (!settled && proc.exitCode === null) {
            proc.kill('SIGTERM');
          }
        }, 1800);
      }
      setTimeout(() => {
        if (!settled && proc.exitCode === null) {
          proc.kill('SIGKILL');
          done();
        }
      }, 4000);
    });
  }

  public async stopStream(): Promise<StreamTelemetry> {
    if (!this.compositorProcess) {
      this.stopDurationTimer();
      this.closeAllPushers();
      for (const id of ['facebook', 'youtube'] as DestinationId[]) {
        this.updateDestinationTelemetry(id, {
          connected: false,
          status: 'Offline',
          bitrateKbps: 0,
          fps: 0,
        });
      }
      this.updateStatus({
        status: 'Offline',
        fps: 0,
        bitrateKbps: 0,
        speed: '0x',
      });
      return this.getTelemetry();
    }

    this.stopRequested = true;
    this.pushLog('info', 'Sending graceful stop signal to FFmpeg compositor and RTMP outputs...');
    this.closeAllPushers();
    await this.stopCompositorOnly();
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
    const hasImageInput = Boolean(
      overlays.imageOverlayEnabled &&
        overlays.imageOverlayPath &&
        fs.existsSync(overlays.imageOverlayPath),
    );
    const filterComplex = buildFilterGraph(
      profile.width,
      profile.height,
      overlays,
      hasLogoInput,
      hasImageInput,
    );

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
    if (hasImageInput && overlays.imageOverlayPath) {
      args.push('-i', overlays.imageOverlayPath);
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
              audioCodec: pipedOptions.hasAudio ? 'aac (Android Mixed Audio)' : 'aac (silent fallback)',
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
