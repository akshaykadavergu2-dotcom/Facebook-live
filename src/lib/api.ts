import type {
  AndroidCaptureSessionInfo,
  AndroidCaptureTelemetry,
  DestinationId,
  DestinationMode,
  DestinationsConfigResponse,
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
    host === 'ai.studio' ||
    host.endsWith('.ai.studio') ||
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

export function getWebIngestUrl(session: AndroidCaptureSessionInfo, mimeType?: string): string {
  const params = new URLSearchParams({
    sessionId: session.sessionId,
    token: session.ingestToken,
  });
  if (mimeType) {
    params.set('mime', mimeType);
  }
  if (API_BASE_URL) {
    try {
      const parsed = new URL(API_BASE_URL);
      const wsProto = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${wsProto}//${parsed.host}/ws/web-ingest?${params.toString()}`;
    } catch {
      const wsBase = API_BASE_URL.replace(/^https:\/\//i, 'wss://').replace(/^http:\/\//i, 'ws://');
      return `${wsBase}/ws/web-ingest?${params.toString()}`;
    }
  }
  if (session.wsWebIngestUrl) {
    return mimeType
      ? `${session.wsWebIngestUrl}&mime=${encodeURIComponent(mimeType)}`
      : session.wsWebIngestUrl;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/web-ingest?${params.toString()}`;
}

export class ApiError extends Error {
  public readonly status: number | null;
  public readonly statusText: string;
  public readonly method: string;
  public readonly url: string;
  public readonly responseBody: string;

  constructor(opts: {
    message: string;
    status: number | null;
    statusText: string;
    method: string;
    url: string;
    responseBody?: string;
  }) {
    super(opts.message);
    this.name = 'ApiError';
    this.status = opts.status;
    this.statusText = opts.statusText;
    this.method = opts.method;
    this.url = opts.url;
    this.responseBody = opts.responseBody ?? '';
  }
}

function summarizeResponseExcerpt(rawText: string): string {
  const plain = rawText
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > 220 ? `${plain.slice(0, 220)}...` : plain;
}

async function parseApiResponse<T>(
  res: Response,
  method: string,
  targetUrl: string,
): Promise<T> {
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const isJson = contentType.includes('application/json');
  const rawText = await res.text();

  if (!res.ok) {
    let detail = '';
    if (isJson && rawText.trim().length > 0) {
      try {
        const parsed = JSON.parse(rawText) as { error?: string; message?: string };
        detail = parsed.error || parsed.message || '';
      } catch {
        detail = summarizeResponseExcerpt(rawText);
      }
    } else if (rawText.trim().length > 0) {
      detail = summarizeResponseExcerpt(rawText);
    }

    const statusLabel = `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`;
    throw new ApiError({
      message: `${statusLabel} on ${method} ${targetUrl}${detail ? ` — ${detail}` : ''}`,
      status: res.status,
      statusText: res.statusText || '',
      method,
      url: targetUrl,
      responseBody: rawText,
    });
  }

  if (res.status === 204) {
    return {} as T;
  }

  if (!rawText.trim()) {
    throw new ApiError({
      message: `HTTP ${res.status} on ${method} ${targetUrl} returned an empty response instead of JSON.`,
      status: res.status,
      statusText: res.statusText || '',
      method,
      url: targetUrl,
      responseBody: rawText,
    });
  }

  if (!isJson) {
    const excerpt = summarizeResponseExcerpt(rawText);
    throw new ApiError({
      message: `Expected JSON from ${method} ${targetUrl} (HTTP ${res.status}, content-type: ${contentType || 'unknown'})${excerpt ? ` — ${excerpt}` : ''}`,
      status: res.status,
      statusText: res.statusText || '',
      method,
      url: targetUrl,
      responseBody: rawText,
    });
  }

  try {
    return JSON.parse(rawText) as T;
  } catch {
    throw new ApiError({
      message: `Malformed JSON from ${method} ${targetUrl} (HTTP ${res.status}) — ${summarizeResponseExcerpt(rawText)}`,
      status: res.status,
      statusText: res.statusText || '',
      method,
      url: targetUrl,
      responseBody: rawText,
    });
  }
}

async function performFetch(
  targetUrl: string,
  method: string,
  init?: RequestInit,
): Promise<Response> {
  const isMutating = method !== 'GET' && method !== 'HEAD';
  const hasJsonBody = init?.body !== undefined && !(init.body instanceof FormData);

  const headers: Record<string, string> = {};
  if (isMutating) {
    headers['X-Livecast-Client'] = 'livecast-web';
  }
  if (hasJsonBody) {
    headers['Content-Type'] = 'application/json';
  }

  return fetch(targetUrl, {
    credentials: 'same-origin',
    ...init,
    method,
    headers: {
      ...headers,
      ...((init?.headers as Record<string, string> | undefined) ?? {}),
    },
  });
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || 'GET').toUpperCase();
  const targetUrl = apiUrl(path);

  if (
    !API_BASE_URL &&
    typeof window !== 'undefined' &&
    window.location.hostname.endsWith('.netlify.app')
  ) {
    throw new ApiError({
      message: `VITE_API_BASE_URL is empty in this Netlify build (${method} ${targetUrl} cannot reach Render). Set VITE_API_BASE_URL=https://facebook-live-gvx5.onrender.com in Netlify and redeploy.`,
      status: null,
      statusText: 'MISSING_VITE_API_BASE_URL',
      method,
      url: targetUrl,
    });
  }

  const maxAttempts = method === 'GET' ? 2 : 1;
  let lastNetworkErr: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await performFetch(targetUrl, method, init);
      if (
        method === 'GET' &&
        attempt < maxAttempts &&
        (res.status === 502 || res.status === 503 || res.status === 504)
      ) {
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      return await parseApiResponse<T>(res, method, targetUrl);
    } catch (err) {
      if (err instanceof ApiError) {
        throw err;
      }
      lastNetworkErr = err;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
    }
  }

  const fetchErrMsg =
    lastNetworkErr instanceof Error ? lastNetworkErr.message : String(lastNetworkErr || 'Failed to fetch');
  throw new ApiError({
    message: `Network/CORS failure on ${method} ${targetUrl}: ${fetchErrMsg}`,
    status: null,
    statusText: 'NETWORK_ERROR',
    method,
    url: targetUrl,
    responseBody: fetchErrMsg,
  });
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
    destinationMode?: DestinationMode;
  }) =>
    requestJson<{ telemetry: StreamTelemetry }>('/api/stream/start', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  stopStream: () =>
    requestJson<{ telemetry: StreamTelemetry }>('/api/stream/stop', { method: 'POST' }),
  startDestination: (dest: DestinationId) =>
    requestJson<{ telemetry: StreamTelemetry }>(`/api/stream/destination/${dest}/start`, {
      method: 'POST',
    }),
  stopDestination: (dest: DestinationId) =>
    requestJson<{ telemetry: StreamTelemetry }>(`/api/stream/destination/${dest}/stop`, {
      method: 'POST',
    }),
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

  getDestinations: () => requestJson<DestinationsConfigResponse>('/api/stream/destinations'),
  getRtmpConfig: () => requestJson<RtmpPublicConfig>('/api/stream/credentials'),
  saveRtmpConfig: (serverUrl: string, streamKey?: string) =>
    requestJson<RtmpPublicConfig>('/api/stream/credentials', {
      method: 'POST',
      body: JSON.stringify({ serverUrl, streamKey }),
    }),
  clearRtmpKey: () => requestJson<RtmpPublicConfig>('/api/stream/credentials', { method: 'DELETE' }),
  saveYoutubeRtmpConfig: (serverUrl: string, streamKey?: string) =>
    requestJson<RtmpPublicConfig>('/api/stream/credentials/youtube', {
      method: 'POST',
      body: JSON.stringify({ serverUrl, streamKey }),
    }),
  clearYoutubeRtmpKey: () =>
    requestJson<RtmpPublicConfig>('/api/stream/credentials/youtube', { method: 'DELETE' }),

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
    const targetUrl = apiUrl('/api/videos/validate-youtube');
    let res: Response;
    try {
      res = await performFetch(targetUrl, 'POST', {
        body: JSON.stringify({ url }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err || 'Failed to fetch');
      throw new ApiError({
        message: `Network/CORS failure on POST ${targetUrl}: ${msg}`,
        status: null,
        statusText: 'NETWORK_ERROR',
        method: 'POST',
        url: targetUrl,
        responseBody: msg,
      });
    }

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const rawText = await res.text();
    if (contentType.includes('application/json') && rawText.trim() && (res.ok || res.status === 400)) {
      try {
        return JSON.parse(rawText) as YouTubeValidationResult;
      } catch {
        throw new ApiError({
          message: `Malformed JSON on POST ${targetUrl} (HTTP ${res.status})`,
          status: res.status,
          statusText: res.statusText || '',
          method: 'POST',
          url: targetUrl,
          responseBody: rawText,
        });
      }
    }

    return parseApiResponse<YouTubeValidationResult>(
      new Response(rawText, { status: res.status, statusText: res.statusText, headers: res.headers }),
      'POST',
      targetUrl,
    );
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
