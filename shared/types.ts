export type StreamStatusState = 'Offline' | 'Connecting' | 'Live' | 'Error';

export type StreamQualityProfile = '720p' | '1080p';

export type LogoPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export type ClockFormat = 'date-time' | 'time-24h' | 'time-12h';

export type OverlayAnimation = 'static' | 'fade' | 'slide' | 'scroll';

export type VideoSourceType = 'uploaded' | 'direct-url' | 'android-capture' | 'youtube-preview';

export type AndroidCaptureConnectionState =
  | 'Disconnected'
  | 'WaitingForApp'
  | 'Connecting'
  | 'Capturing'
  | 'Reconnecting'
  | 'Stopped'
  | 'Error';

export type AndroidVideoCaptureStatus = 'IDLE' | 'CAPTURING' | 'PAUSED' | 'ERROR';

export type AndroidAudioCaptureStatus = 'IDLE' | 'AUDIO_CAPTURED' | 'AUDIO_NOT_AVAILABLE';

export interface AndroidCaptureTelemetry {
  sessionId: string | null;
  status: AndroidCaptureConnectionState;
  videoStatus: AndroidVideoCaptureStatus;
  audioStatus: AndroidAudioCaptureStatus;
  permissionGranted: boolean;
  fps: number;
  width: number;
  height: number;
  audioSampleRate: number;
  bitrateKbps: number;
  latencyMs: number;
  framesReceived: number;
  youtubeUrl: string | null;
  lastHeartbeatAt: string | null;
  lastError: string | null;
}

export interface AndroidCaptureSessionInfo {
  sessionId: string;
  ingestToken: string;
  wsIngestUrl: string;
  deepLinkUrl: string;
  expiresAt: string;
}

export interface OverlayConfig {
  logoEnabled: boolean;
  logoPath: string | null;
  logoUrl: string | null;
  logoPosition: LogoPosition;
  logoScale: number; // percentage of video width (5..35)
  logoOpacity: number; // 0.1..1.0

  headlineEnabled: boolean;
  headlineText: string;
  headlineFontSize: number; // 18..64
  headlineColor: string;
  headlineBgColor: string;
  headlineBgOpacity: number; // 0..1
  headlineAnimation: Exclude<OverlayAnimation, 'scroll'>;

  breakingNewsEnabled: boolean;
  breakingNewsLabel: string;
  breakingNewsText: string;
  breakingNewsBgColor: string;
  breakingNewsTextColor: string;
  breakingNewsOpacity: number; // 0.2..1.0

  lowerThirdEnabled: boolean;
  lowerThirdTitle: string;
  lowerThirdSubtitle: string;
  lowerThirdAccentColor: string;
  lowerThirdBgColor: string;
  lowerThirdTextColor: string;
  lowerThirdAnimation: Exclude<OverlayAnimation, 'scroll'>;

  clockEnabled: boolean;
  clockPosition: LogoPosition;
  clockFormat: ClockFormat;
  clockFontSize: number; // 12..36
  clockColor: string;
  clockBgColor: string;
  clockBgOpacity: number; // 0..1

  tickerEnabled: boolean;
  tickerText: string;
  tickerFontSize: number; // 14..36
  tickerColor: string;
  tickerBgColor: string;
  tickerBgOpacity: number; // 0.1..1.0
  tickerSpeed: number; // pixels/sec (40..220)
}

export interface VideoAsset {
  id: string;
  originalName: string;
  filename: string;
  sizeBytes: number;
  mimeType: string;
  url: string;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  audioCodec: string | null;
  hasAudio: boolean;
  uploadedAt: string;
  isSample?: boolean;
}

export interface RtmpPublicConfig {
  serverUrl: string;
  hasStreamKey: boolean;
  maskedStreamKey: string;
  updatedAt: string | null;
}

export interface StreamTelemetry {
  status: StreamStatusState;
  quality: StreamQualityProfile;
  sourceType: VideoSourceType | null;
  sourceLabel: string | null;
  startedAt: string | null;
  durationSec: number;
  outputResolution: string;
  bitrateKbps: number;
  fps: number;
  framesEncoded: number;
  speed: string;
  loopVideo: boolean;
  lastError: string | null;
  sessionId: string | null;
}

export interface StreamLogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'ffmpeg';
  message: string;
}

export interface StreamHistoryEntry {
  id: string;
  startedAt: string;
  endedAt: string;
  durationSec: number;
  sourceLabel: string;
  sourceType: VideoSourceType;
  quality: StreamQualityProfile;
  outputResolution: string;
  avgBitrateKbps: number;
  status: 'Completed' | 'Stopped' | 'Error';
  errorMessage: string | null;
}

export interface YouTubeValidationResult {
  valid: boolean;
  videoId?: string;
  embedUrl?: string;
  watchUrl?: string;
  title?: string;
  authorName?: string;
  thumbnailUrl?: string;
  streamableViaRtmp: false;
  explanation: string;
}

export interface PipelineCheckResult {
  success: boolean;
  durationMs: number;
  ffmpegCommandSummary: string;
  videoCodec: string;
  audioCodec: string;
  resolution: string;
  message: string;
  stderrExcerpt?: string;
}

export interface SecurityStatusInfo {
  authRequired: boolean;
  authenticated: boolean;
  originProtectionEnabled: boolean;
  encryptionConfigured: boolean;
  rateLimitEnabled: boolean;
  ffmpegAvailable: boolean;
  ffmpegVersion: string | null;
  maxUploadMb: number;
}
