import type {
  OverlayConfig,
  PipelineCheckResult,
  RtmpPublicConfig,
  SecurityStatusInfo,
  StreamHistoryEntry,
  StreamLogEntry,
  StreamQualityProfile,
  StreamTelemetry,
  VideoAsset,
  VideoSourceType,
  YouTubeValidationResult,
} from '../../shared/types';

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(init?.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string; message?: string }).error || (data as { message?: string }).message || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  getAuthStatus: () => requestJson<SecurityStatusInfo>('/api/auth/status'),
  login: (password: string) =>
    requestJson<{ authenticated: boolean; authRequired: boolean }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  logout: () => requestJson<{ authenticated: boolean }>('/api/auth/logout', { method: 'POST' }),

  getStreamStatus: () =>
    requestJson<{ telemetry: StreamTelemetry; logs: StreamLogEntry[] }>('/api/stream/status'),
  startStream: (payload: {
    sourceType: VideoSourceType;
    videoId?: string;
    directUrl?: string;
    quality: StreamQualityProfile;
    loopVideo: boolean;
  }) =>
    requestJson<{ telemetry: StreamTelemetry }>('/api/stream/start', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  stopStream: () =>
    requestJson<{ telemetry: StreamTelemetry }>('/api/stream/stop', { method: 'POST' }),
  validatePipeline: (payload: {
    sourceType: VideoSourceType;
    videoId?: string;
    directUrl?: string;
    quality: StreamQualityProfile;
  }) =>
    requestJson<PipelineCheckResult>('/api/stream/validate-pipeline', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getRtmpConfig: () => requestJson<RtmpPublicConfig>('/api/rtmp/config'),
  saveRtmpConfig: (serverUrl: string, streamKey?: string) =>
    requestJson<RtmpPublicConfig>('/api/rtmp/config', {
      method: 'POST',
      body: JSON.stringify({ serverUrl, streamKey }),
    }),
  clearRtmpKey: () => requestJson<RtmpPublicConfig>('/api/rtmp/key', { method: 'DELETE' }),

  getVideos: () => requestJson<{ videos: VideoAsset[] }>('/api/videos'),
  uploadVideo: (file: File) => {
    const form = new FormData();
    form.append('video', file);
    return requestJson<{ video: VideoAsset; videos: VideoAsset[] }>('/api/video/upload', {
      method: 'POST',
      body: form,
    });
  },
  generateSampleVideo: () =>
    requestJson<{ video: VideoAsset; videos: VideoAsset[] }>('/api/videos/generate-sample', {
      method: 'POST',
    }),
  deleteVideo: (id: string) =>
    requestJson<{ videos: VideoAsset[] }>(`/api/videos/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  validateYouTube: async (url: string): Promise<YouTubeValidationResult> => {
    const res = await fetch('/api/videos/validate-youtube', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = (await res.json()) as YouTubeValidationResult;
    return data;
  },
  validateDirectUrl: (url: string) =>
    requestJson<{
      valid: boolean;
      url: string;
      probe: {
        durationSec: number;
        width: number;
        height: number;
        fps: number;
        videoCodec: string;
        audioCodec: string | null;
        hasAudio: boolean;
      };
    }>('/api/videos/validate-direct-url', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),

  getOverlays: () => requestJson<OverlayConfig>('/api/overlays'),
  saveOverlays: (config: Partial<OverlayConfig>) =>
    requestJson<OverlayConfig>('/api/overlays', {
      method: 'POST',
      body: JSON.stringify(config),
    }),
  uploadOverlayLogo: (file: File) => {
    const form = new FormData();
    form.append('logo', file);
    return requestJson<OverlayConfig>('/api/overlays/logo', {
      method: 'POST',
      body: form,
    });
  },
  deleteOverlayLogo: () =>
    requestJson<OverlayConfig>('/api/overlays/logo', { method: 'DELETE' }),

  getHistory: () => requestJson<{ history: StreamHistoryEntry[] }>('/api/history'),
  clearHistory: () => requestJson<{ history: StreamHistoryEntry[] }>('/api/history', { method: 'DELETE' }),
};

export function formatDuration(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return [hrs, mins, secs].map((v) => String(v).padStart(2, '0')).join(':');
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let value = bytes;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}
