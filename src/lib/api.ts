import type {
  AndroidCaptureSessionInfo,
  AndroidCaptureTelemetry,
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

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '').replace(/\/api$/i, '');
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function isCoHostedFullStackHost(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname.toLowerCase();
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.endsWith('.run.app')
  );
}

const RAW_API_BASE_URL = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL || '');
export const API_BASE_URL = isCoHostedFullStackHost() ? '' : RAW_API_BASE_URL;

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return API_BASE_URL ? `${API_BASE_URL}${normalizedPath}` : normalizedPath;
}

export function resolveMediaUrl(url: string | null | undefined): string {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return apiUrl(url);
}

export function getWebSocketUrl(): string {
  if (API_BASE_URL) {
    try {
      const parsed = new URL(API_BASE_URL);
      const wsProto = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${wsProto}//${parsed.host}/ws`;
    } catch {
      const wsBase = API_BASE_URL.replace(/^https:\/\//i, 'wss://').replace(/^http:\/\//i, 'ws://');
      return `${wsBase}/ws`;
    }
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

async function parseApiResponse<T>(res: Response): Promise<T> {
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const isJson = contentType.includes('application/json');
  const rawText = await res.text();

  if (!res.ok) {
    if (isJson && rawText.trim().length > 0) {
      try {
        const parsed = JSON.parse(rawText) as { error?: string; message?: string };
        throw new Error(
          parsed.error || parsed.message || `Backend request failed (${res.status} ${res.statusText}).`,
        );
      } catch (err) {
        if (err instanceof Error && !err.message.startsWith('Unexpected')) {
          throw err;
        }
      }
    }

    if (res.status === 404) {
      throw new Error(
        'Backend API endpoint not found (404). If deployed on Netlify, verify VITE_API_BASE_URL is set to your running Render/Node.js backend URL.',
      );
    }
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      throw new Error(
        `Backend server is temporarily unavailable (${res.status}). If hosted on Render free tier, wait ~30 seconds for wake-up and retry.`,
      );
    }

    throw new Error(
      `Backend returned non-JSON error (${res.status} ${res.statusText || 'Error'}). Verify VITE_API_BASE_URL and CORS configuration.`,
    );
  }

  if (res.status === 204) {
    return {} as T;
  }

  if (!rawText.trim()) {
    throw new Error('Backend returned an empty response instead of JSON.');
  }

  if (!isJson) {
    throw new Error(
      'Expected JSON from backend API, but received HTML or plain text. On Netlify, set VITE_API_BASE_URL to your separate Node.js backend URL and rebuild.',
    );
  }

  try {
    return JSON.parse(rawText) as T;
  } catch {
    throw new Error('Backend returned malformed JSON data.');
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      credentials: 'same-origin',
      ...init,
      headers: {
        'X-Livecast-Client': 'livecast-web',
        ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new Error(
      API_BASE_URL
        ? `Unable to reach backend server at ${API_BASE_URL}. Confirm the service is running and allows CORS from ${window.location.origin}.`
        : 'Unable to reach backend API. Ensure the Node.js server is running or configure VITE_API_BASE_URL.',
    );
  }
  return parseApiResponse<T>(res);
}

export const api = {
  getHealth: () =>
    requestJson<{
      ok: boolean;
      service: string;
      ffmpegAvailable: boolean;
      ffmpegVersion: string | null;
      status: string;
      timestamp: string;
    }>('/api/health'),

  getSecurityStatus: () => requestJson<SecurityStatusInfo>('/api/security/status'),

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

  getRtmpConfig: () => requestJson<RtmpPublicConfig>('/api/stream/credentials'),
  saveRtmpConfig: (serverUrl: string, streamKey?: string) =>
    requestJson<RtmpPublicConfig>('/api/stream/credentials', {
      method: 'POST',
      body: JSON.stringify({ serverUrl, streamKey }),
    }),
  clearRtmpKey: () => requestJson<RtmpPublicConfig>('/api/stream/credentials', { method: 'DELETE' }),

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
    let res: Response;
    try {
      res = await fetch(apiUrl('/api/videos/validate-youtube'), {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Livecast-Client': 'livecast-web',
        },
        body: JSON.stringify({ url }),
      });
    } catch {
      throw new Error('Unable to reach backend API to validate YouTube URL.');
    }

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const rawText = await res.text();
    if (!contentType.includes('application/json') || !rawText.trim()) {
      return parseApiResponse<YouTubeValidationResult>(
        new Response(rawText, { status: res.status, statusText: res.statusText, headers: res.headers }),
      );
    }
    try {
      return JSON.parse(rawText) as YouTubeValidationResult;
    } catch {
      throw new Error('Received malformed JSON while validating YouTube URL.');
    }
  },
  validateDirectUrl: (url: string) =>
    requestJson<{
      valid: boolean;
      url: string;
      protocol?: string;
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

  getCaptureStatus: (sessionId?: string | null) =>
    requestJson<{ telemetry: AndroidCaptureTelemetry }>(
      sessionId ? `/api/capture/status?sessionId=${encodeURIComponent(sessionId)}` : '/api/capture/status',
    ),
  createCaptureSession: (youtubeUrl?: string | null) =>
    requestJson<{ session: AndroidCaptureSessionInfo; telemetry: AndroidCaptureTelemetry }>(
      '/api/capture/session',
      {
        method: 'POST',
        body: JSON.stringify({ youtubeUrl: youtubeUrl || undefined }),
      },
    ),
  startCaptureSession: (sessionId: string, youtubeUrl?: string | null) =>
    requestJson<{ signaled: boolean; telemetry: AndroidCaptureTelemetry }>(
      `/api/capture/session/${encodeURIComponent(sessionId)}/start`,
      {
        method: 'POST',
        body: JSON.stringify({ youtubeUrl: youtubeUrl || undefined }),
      },
    ),
  stopCaptureSession: (sessionId?: string | null) =>
    requestJson<{ telemetry: AndroidCaptureTelemetry }>(
      `/api/capture/session/${encodeURIComponent(sessionId || 'active')}/stop`,
      { method: 'POST' },
    ),
  getCapturePreviewUrl: (sessionId?: string | null, cacheBust?: number) => {
    const params = new URLSearchParams();
    if (sessionId) params.set('sessionId', sessionId);
    if (cacheBust) params.set('t', String(cacheBust));
    const qs = params.toString();
    return apiUrl(qs ? `/api/capture/preview.mp4?${qs}` : '/api/capture/preview.mp4');
  },
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
