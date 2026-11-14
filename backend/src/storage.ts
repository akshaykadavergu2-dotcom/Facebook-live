import fs from 'node:fs';
import path from 'node:path';
import type {
  OverlayConfig,
  RtmpPublicConfig,
  StreamHistoryEntry,
  VideoAsset,
} from '../shared/types.ts';
import {
  decryptSecret,
  encryptSecret,
  maskStreamKey,
  type EncryptedPayload,
} from './crypto.ts';

export const DATA_DIR = path.resolve(process.cwd(), '.data');
export const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');
export const VIDEOS_DIR = path.join(UPLOADS_DIR, 'videos');
export const OVERLAYS_DIR = path.join(UPLOADS_DIR, 'overlays');
const STATE_FILE = path.join(DATA_DIR, 'studio-state.json');

interface PersistedState {
  rtmp: {
    serverUrl: string;
    encryptedStreamKey: EncryptedPayload | null;
    updatedAt: string | null;
  };
  overlays: OverlayConfig;
  videos: VideoAsset[];
  history: StreamHistoryEntry[];
}

export const DEFAULT_OVERLAY_CONFIG: OverlayConfig = {
  logoEnabled: false,
  logoPath: null,
  logoUrl: null,
  logoPosition: 'top-right',
  logoScale: 12,
  logoOpacity: 0.92,

  headlineEnabled: false,
  headlineText: 'LIVE STUDIO BROADCAST',
  headlineFontSize: 28,
  headlineColor: '#FFFFFF',
  headlineBgColor: '#0F172A',
  headlineBgOpacity: 0.85,
  headlineAnimation: 'fade',

  breakingNewsEnabled: false,
  breakingNewsLabel: 'BREAKING NEWS',
  breakingNewsText: 'Live studio coverage in progress.',
  breakingNewsBgColor: '#DC2626',
  breakingNewsTextColor: '#FFFFFF',
  breakingNewsOpacity: 0.95,

  lowerThirdEnabled: false,
  lowerThirdTitle: 'LIVECAST STUDIO',
  lowerThirdSubtitle: 'Authorized Live Broadcast Feed',
  lowerThirdAccentColor: '#2563EB',
  lowerThirdBgColor: '#0B0E14',
  lowerThirdTextColor: '#F8FAFC',
  lowerThirdAnimation: 'slide',

  clockEnabled: false,
  clockPosition: 'top-right',
  clockFormat: 'date-time',
  clockFontSize: 18,
  clockColor: '#F8FAFC',
  clockBgColor: '#0B0E14',
  clockBgOpacity: 0.85,

  tickerEnabled: false,
  tickerText: 'Welcome to the live broadcast. Stay tuned for updates and upcoming segments.',
  tickerFontSize: 20,
  tickerColor: '#F8FAFC',
  tickerBgColor: '#1E293B',
  tickerBgOpacity: 0.9,
  tickerSpeed: 95,
};

const DEFAULT_STATE: PersistedState = {
  rtmp: {
    serverUrl: 'rtmps://live-api-s.facebook.com:443/rtmp/',
    encryptedStreamKey: null,
    updatedAt: null,
  },
  overlays: DEFAULT_OVERLAY_CONFIG,
  videos: [],
  history: [],
};

export function ensureDirectories(): void {
  for (const dir of [DATA_DIR, UPLOADS_DIR, VIDEOS_DIR, OVERLAYS_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

function readState(): PersistedState {
  ensureDirectories();
  if (!fs.existsSync(STATE_FILE)) {
    writeState(DEFAULT_STATE);
    return structuredClone(DEFAULT_STATE);
  }
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return {
      rtmp: {
        serverUrl: parsed.rtmp?.serverUrl || DEFAULT_STATE.rtmp.serverUrl,
        encryptedStreamKey: parsed.rtmp?.encryptedStreamKey ?? null,
        updatedAt: parsed.rtmp?.updatedAt ?? null,
      },
      overlays: {
        ...DEFAULT_OVERLAY_CONFIG,
        ...(parsed.overlays ?? {}),
      },
      videos: Array.isArray(parsed.videos) ? parsed.videos : [],
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

function writeState(state: PersistedState): void {
  ensureDirectories();
  const tempPath = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tempPath, STATE_FILE);
}

export function getRtmpPublicConfig(): RtmpPublicConfig {
  const state = readState();
  const decrypted = decryptSecret(state.rtmp.encryptedStreamKey);
  return {
    serverUrl: state.rtmp.serverUrl,
    hasStreamKey: Boolean(decrypted && decrypted.length > 0),
    maskedStreamKey: maskStreamKey(decrypted),
    updatedAt: state.rtmp.updatedAt,
  };
}

export function getDecryptedStreamKey(): string | null {
  const state = readState();
  return decryptSecret(state.rtmp.encryptedStreamKey);
}

export function saveRtmpConfig(serverUrl: string, newStreamKey?: string | null): RtmpPublicConfig {
  const state = readState();
  state.rtmp.serverUrl = serverUrl.trim();
  if (typeof newStreamKey === 'string') {
    const trimmed = newStreamKey.trim();
    state.rtmp.encryptedStreamKey = trimmed.length > 0 ? encryptSecret(trimmed) : null;
  }
  state.rtmp.updatedAt = new Date().toISOString();
  writeState(state);
  return getRtmpPublicConfig();
}

export function clearStreamKey(): RtmpPublicConfig {
  const state = readState();
  state.rtmp.encryptedStreamKey = null;
  state.rtmp.updatedAt = new Date().toISOString();
  writeState(state);
  return getRtmpPublicConfig();
}

export function getOverlayConfig(): OverlayConfig {
  const state = readState();
  if (state.overlays.logoPath && !fs.existsSync(state.overlays.logoPath)) {
    state.overlays.logoPath = null;
    state.overlays.logoUrl = null;
    state.overlays.logoEnabled = false;
    writeState(state);
  }
  return state.overlays;
}

export function saveOverlayConfig(partial: Partial<OverlayConfig>): OverlayConfig {
  const state = readState();
  state.overlays = {
    ...state.overlays,
    ...partial,
  };
  writeState(state);
  return state.overlays;
}

export function getVideos(): VideoAsset[] {
  const state = readState();
  const existing = state.videos.filter((v) => fs.existsSync(path.join(VIDEOS_DIR, v.filename)));
  if (existing.length !== state.videos.length) {
    state.videos = existing;
    writeState(state);
  }
  return existing;
}

export function getVideoById(id: string): VideoAsset | undefined {
  return getVideos().find((v) => v.id === id);
}

export function addVideo(video: VideoAsset): VideoAsset[] {
  const state = readState();
  state.videos = [video, ...state.videos.filter((v) => v.id !== video.id)];
  writeState(state);
  return state.videos;
}

export function removeVideo(id: string): boolean {
  const state = readState();
  const target = state.videos.find((v) => v.id === id);
  if (!target) return false;
  const fullPath = path.join(VIDEOS_DIR, path.basename(target.filename));
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }
  state.videos = state.videos.filter((v) => v.id !== id);
  writeState(state);
  return true;
}

export function getStreamHistory(): StreamHistoryEntry[] {
  const state = readState();
  return state.history;
}

export function addStreamHistoryEntry(entry: StreamHistoryEntry): StreamHistoryEntry[] {
  const state = readState();
  state.history = [entry, ...state.history].slice(0, 100);
  writeState(state);
  return state.history;
}

export function clearStreamHistory(): void {
  const state = readState();
  state.history = [];
  writeState(state);
}

export function safeResolveVideoPath(filename: string): string | null {
  const base = path.basename(filename);
  const resolved = path.resolve(VIDEOS_DIR, base);
  if (!resolved.startsWith(VIDEOS_DIR + path.sep)) {
    return null;
  }
  return resolved;
}
