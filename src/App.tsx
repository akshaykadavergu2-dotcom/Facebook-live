import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Menu, Radio, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import type {
  AndroidCaptureTelemetry,
  OverlayConfig,
  RtmpPublicConfig,
  SecurityStatusInfo,
  StreamHistoryEntry,
  StreamLogEntry,
  StreamQualityProfile,
  StreamTelemetry,
  VideoAsset,
  YouTubeValidationResult,
} from '../shared/types';
import { api, API_BASE_URL, formatDuration, getWebSocketUrl } from './lib/api';
import { AndroidLiveCaptureView } from './components/AndroidLiveCaptureView';
import { DashboardView } from './components/DashboardView';
import { FacebookOutputView } from './components/FacebookOutputView';
import { HistoryView } from './components/HistoryView';
import { LiveStudioView } from './components/LiveStudioView';
import { OverlaysView } from './components/OverlaysView';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton';
import { SettingsView } from './components/SettingsView';
import { MobileBottomNav, Sidebar, type NavSection } from './components/Sidebar';
import type { ProgramMonitorSource } from './components/VideoPreviewStage';
import { YouTubePreviewView } from './components/YouTubePreviewView';

const INITIAL_TELEMETRY: StreamTelemetry = {
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
  loopVideo: true,
  lastError: null,
  sessionId: null,
};

const INITIAL_OVERLAYS: OverlayConfig = {
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

const INITIAL_CAPTURE_TELEMETRY: AndroidCaptureTelemetry = {
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

const SECTION_TITLES: Record<NavSection, string> = {
  dashboard: 'Dashboard',
  studio: 'Live Studio',
  'android-capture': 'Android Live Capture',
  youtube: 'YouTube Preview',
  overlays: 'Overlays & Graphics',
  facebook: 'Facebook Output',
  history: 'Stream History',
  settings: 'Settings & Deployment',
};

export default function App() {
  const [companionMissingNotice, setCompanionMissingNotice] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    if (params.get('companion') === 'missing') {
      return 'Livecast Android Capture (com.livecast.capture) is not installed on this Android phone yet. Tap DOWNLOAD ANDROID APP above to install livecast-companion.apk first, or paste Session ID & Ephemeral Ingest Token manually if already installed.';
    }
    return null;
  });
  const [section, setSection] = useState<NavSection>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('companion') === 'missing') {
        return 'android-capture';
      }
    }
    return 'studio';
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [security, setSecurity] = useState<SecurityStatusInfo | null>(null);
  const [bootLoading, setBootLoading] = useState(true);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [retryingConnection, setRetryingConnection] = useState(false);

  const [telemetry, setTelemetry] = useState<StreamTelemetry>(INITIAL_TELEMETRY);
  const [captureTelemetry, setCaptureTelemetry] = useState<AndroidCaptureTelemetry>(
    INITIAL_CAPTURE_TELEMETRY,
  );
  const [logs, setLogs] = useState<StreamLogEntry[]>([]);
  const [rtmpConfig, setRtmpConfig] = useState<RtmpPublicConfig>({
    serverUrl: 'rtmps://live-api-s.facebook.com:443/rtmp/',
    hasStreamKey: false,
    maskedStreamKey: '',
    updatedAt: null,
  });
  const [videos, setVideos] = useState<VideoAsset[]>([]);
  const [overlays, setOverlays] = useState<OverlayConfig>(INITIAL_OVERLAYS);
  const [history, setHistory] = useState<StreamHistoryEntry[]>([]);

  const [sourceType, setSourceType] = useState<ProgramMonitorSource>('uploaded');
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [directUrl, setDirectUrl] = useState('');
  const [youtubeResult, setYoutubeResult] = useState<YouTubeValidationResult | null>(null);
  const [quality, setQuality] = useState<StreamQualityProfile>('720p');
  const [loopVideo, setLoopVideo] = useState<boolean>(true);
  const [generatingSample, setGeneratingSample] = useState(false);

  const [wsConnected, setWsConnected] = useState(false);
  const [wsError, setWsError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const loadStudioData = useCallback(async () => {
    setBackendError(null);

    const [
      healthOutcome,
      securityOutcome,
      statusOutcome,
      rtmpOutcome,
      videosOutcome,
      overlaysOutcome,
      historyOutcome,
      captureOutcome,
    ] = await Promise.allSettled([
      api.getHealth(),
      api.getSecurityStatus(),
      api.getStreamStatus(),
      api.getRtmpConfig(),
      api.getVideos(),
      api.getOverlays(),
      api.getHistory(),
      api.getCaptureStatus(),
    ]);

    if (securityOutcome.status === 'fulfilled') {
      setSecurity(securityOutcome.value);
    }
    if (statusOutcome.status === 'fulfilled') {
      setTelemetry(statusOutcome.value.telemetry);
      setQuality(statusOutcome.value.telemetry.quality);
      setLoopVideo(statusOutcome.value.telemetry.loopVideo);
      setLogs(statusOutcome.value.logs);
    }
    if (rtmpOutcome.status === 'fulfilled') {
      setRtmpConfig(rtmpOutcome.value);
    }
    if (videosOutcome.status === 'fulfilled') {
      const list = videosOutcome.value.videos;
      setVideos(list);
      if (list.length > 0) {
        setSelectedVideoId((prev) => prev ?? list[0].id);
      }
    }
    if (overlaysOutcome.status === 'fulfilled') {
      setOverlays(overlaysOutcome.value);
    }
    if (historyOutcome.status === 'fulfilled') {
      setHistory(historyOutcome.value.history);
    }
    if (captureOutcome.status === 'fulfilled') {
      setCaptureTelemetry(captureOutcome.value.telemetry);
    }

    const failures: string[] = [];
    const checkFailure = (label: string, outcome: PromiseSettledResult<unknown>) => {
      if (outcome.status === 'rejected') {
        const msg =
          outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
        failures.push(`${label}: ${msg}`);
      }
    };

    checkFailure('/api/security/status', securityOutcome);
    checkFailure('/api/stream/status', statusOutcome);
    checkFailure('/api/stream/credentials', rtmpOutcome);
    checkFailure('/api/videos', videosOutcome);
    checkFailure('/api/overlays', overlaysOutcome);
    checkFailure('/api/history', historyOutcome);
    checkFailure('/api/capture/status', captureOutcome);

    if (failures.length > 0 || healthOutcome.status === 'rejected') {
      const healthSummary =
        healthOutcome.status === 'fulfilled'
          ? `/api/health responded HTTP 200 (ok=${String(healthOutcome.value.ok)}, ffmpeg=${String(healthOutcome.value.ffmpegAvailable)})`
          : `/api/health failed: ${
              healthOutcome.reason instanceof Error
                ? healthOutcome.reason.message
                : String(healthOutcome.reason)
            }`;

      const detailLines = failures.length > 0 ? failures.slice(0, 3).join(' | ') : healthSummary;
      setBackendError(
        failures.length > 0
          ? `${healthSummary}. Failing request(s): ${detailLines}`
          : healthSummary,
      );
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (url.searchParams.has('companion')) {
        url.searchParams.delete('companion');
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
      }
    }
  }, []);

  useEffect(() => {
    loadStudioData().finally(() => setBootLoading(false));
  }, [loadStudioData]);

  const handleRetryConnection = async () => {
    setRetryingConnection(true);
    try {
      await loadStudioData();
    } finally {
      setRetryingConnection(false);
    }
  };

  useEffect(() => {
    if (bootLoading) return;
    if (backendError) return;
    if (!API_BASE_URL && window.location.hostname.endsWith('.netlify.app')) {
      setWsConnected(false);
      setWsError('Missing VITE_API_BASE_URL for Netlify WebSocket connection.');
      return;
    }

    let closedByCleanup = false;
    let reconnectTimer: number | null = null;
    const wsTargetUrl = getWebSocketUrl();

    const connect = () => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsTargetUrl);
      } catch (err) {
        setWsConnected(false);
        setWsError(
          `WebSocket init failed (${wsTargetUrl}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        setWsError(null);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as
            | {
                type: 'init';
                telemetry: StreamTelemetry;
                logs: StreamLogEntry[];
                history: StreamHistoryEntry[];
                capture?: AndroidCaptureTelemetry;
              }
            | { type: 'status'; telemetry: StreamTelemetry }
            | { type: 'capture'; capture: AndroidCaptureTelemetry }
            | { type: 'log'; entry: StreamLogEntry }
            | { type: 'history'; entry: StreamHistoryEntry };

          if (msg.type === 'init') {
            setTelemetry(msg.telemetry);
            setLogs(msg.logs);
            setHistory(msg.history);
            if (msg.capture) {
              setCaptureTelemetry(msg.capture);
            }
          } else if (msg.type === 'status') {
            setTelemetry(msg.telemetry);
          } else if (msg.type === 'capture') {
            setCaptureTelemetry(msg.capture);
          } else if (msg.type === 'log') {
            setLogs((prev) => {
              if (prev.some((l) => l.id === msg.entry.id)) return prev;
              return [...prev.slice(-249), msg.entry];
            });
          } else if (msg.type === 'history') {
            setHistory((prev) => {
              if (prev.some((h) => h.id === msg.entry.id)) return prev;
              return [msg.entry, ...prev];
            });
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = (ev) => {
        setWsConnected(false);
        if (!closedByCleanup) {
          if (ev.code !== 1000 && ev.code !== 1001) {
            const reasonText = ev.reason ? ` (${ev.reason})` : '';
            setWsError(`WebSocket closed (code ${ev.code}${reasonText}) on ${wsTargetUrl}`);
          }
          reconnectTimer = window.setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => {
        setWsConnected(false);
        if (!closedByCleanup) {
          setWsError(`WebSocket connection error on ${wsTargetUrl}`);
        }
      };
    };

    connect();

    return () => {
      closedByCleanup = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [bootLoading, backendError]);

  const handleGenerateSample = async () => {
    setGeneratingSample(true);
    try {
      const res = await api.generateSampleVideo();
      setVideos(res.videos);
      setSelectedVideoId(res.video.id);
      setSourceType('uploaded');
      setSection('studio');
    } finally {
      setGeneratingSample(false);
    }
  };

  const handleClearHistory = async () => {
    const res = await api.clearHistory();
    setHistory(res.history);
  };

  if (bootLoading) {
    return (
      <div className="min-h-screen bg-[#0B0E14] flex flex-col items-center justify-center gap-2 text-sm text-slate-400 px-4 text-center pt-safe pb-safe">
        <span>Connecting to LIVECAST STUDIO backend...</span>
        {API_BASE_URL && (
          <span className="text-xs font-mono text-slate-500 break-all">{API_BASE_URL}</span>
        )}
      </div>
    );
  }

  const selectedVideo = videos.find((v) => v.id === selectedVideoId) ?? videos[0] ?? null;

  return (
    <div className="min-h-dvh lg:h-dvh bg-[#0B0E14] text-slate-100 flex w-full max-w-full lg:overflow-hidden">
      <Sidebar
        activeSection={section}
        onSelect={setSection}
        streamStatus={telemetry.status}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0 lg:overflow-hidden">
        <header className="sticky top-0 z-30 lg:static min-h-12 sm:h-14 pt-safe px-3 sm:px-4 lg:px-6 border-b border-[#232B3A] bg-[#0E131B]/95 backdrop-blur-md flex items-center justify-between gap-2.5 shrink-0 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation"
              className="lg:hidden min-h-[44px] min-w-[44px] -ml-1.5 flex items-center justify-center rounded-lg text-slate-300 hover:bg-[#181F2C] shrink-0"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="text-sm sm:text-base font-semibold text-slate-100 truncate">
              {SECTION_TITLES[section]}
            </h1>
          </div>

          <div className="flex items-center gap-2 sm:gap-3.5 shrink-0">
            <div className="flex sm:hidden items-center gap-1.5 text-[11px] font-mono tabular-nums">
              <span
                className={`flex items-center gap-1 font-semibold ${
                  telemetry.status === 'Live'
                    ? 'text-red-400'
                    : telemetry.status === 'Connecting'
                      ? 'text-amber-400'
                      : telemetry.status === 'Error'
                        ? 'text-rose-400'
                        : 'text-slate-400'
                }`}
              >
                <Radio className="w-3 h-3" />
                <span>{telemetry.status}</span>
              </span>
              {telemetry.status === 'Live' && (
                <span className="text-slate-300">{formatDuration(telemetry.durationSec)}</span>
              )}
            </div>

            <div className="hidden sm:flex items-center gap-3 text-xs font-mono tabular-nums text-slate-300">
              <span
                className={`flex items-center gap-1.5 font-semibold ${
                  telemetry.status === 'Live'
                    ? 'text-red-400'
                    : telemetry.status === 'Connecting'
                      ? 'text-amber-400'
                      : telemetry.status === 'Error'
                        ? 'text-rose-400'
                        : 'text-slate-400'
                }`}
              >
                <Radio className="w-3.5 h-3.5" />
                <span>{telemetry.status}</span>
              </span>
              <span className="text-slate-600">/</span>
              <span>{formatDuration(telemetry.durationSec)}</span>
              <span className="text-slate-600">/</span>
              <span
                className="flex items-center gap-1 text-slate-400"
                title={wsError ?? undefined}
              >
                {wsConnected ? (
                  <>
                    <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                    <span>WS Connected</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="w-3.5 h-3.5 text-amber-400" />
                    <span>{wsError ? 'WS Error' : 'Offline'}</span>
                  </>
                )}
              </span>
            </div>

            <PWAInstallButton compact />

            {section !== 'studio' && (
              <button
                type="button"
                onClick={() => setSection('studio')}
                className="hidden sm:inline-flex min-h-[36px] items-center px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold whitespace-nowrap shrink-0"
              >
                Live Studio
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 p-3 sm:p-4 lg:p-6 pb-24 lg:pb-6 min-w-0 lg:overflow-y-auto lg:overflow-x-hidden scroll-smooth">
          <OfflineIndicator />

          {(backendError || (!wsConnected && wsError)) && (
            <div className="mb-5 bg-rose-950/35 border border-rose-500/40 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div className="text-xs text-rose-100 space-y-1 min-w-0">
                  <div className="font-semibold text-sm text-rose-200">
                    {backendError ? 'Backend API Connection Issue' : 'WebSocket Telemetry Issue'}
                  </div>
                  <p className="break-words font-mono text-[11px] leading-relaxed">
                    {backendError || wsError}
                  </p>
                  <p className="text-[11px] text-rose-300/80 break-all">
                    Origin: {typeof window !== 'undefined' ? window.location.origin : ''} · Backend:{' '}
                    {API_BASE_URL || 'Same-Origin (/api)'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleRetryConnection}
                disabled={retryingConnection}
                className="min-h-[44px] px-3.5 py-2 rounded-xl bg-[#181F2C] hover:bg-[#232C3E] border border-[#2E394E] text-xs font-medium text-slate-100 flex items-center gap-1.5 shrink-0 disabled:opacity-50 self-start sm:self-center"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${retryingConnection ? 'animate-spin' : ''}`} />
                <span>{retryingConnection ? 'Retrying...' : 'Retry Connection'}</span>
              </button>
            </div>
          )}

          {section === 'dashboard' && (
            <DashboardView
              telemetry={telemetry}
              rtmpConfig={rtmpConfig}
              videos={videos}
              overlays={overlays}
              history={history}
              security={security}
              onNavigate={setSection}
              onGenerateSample={handleGenerateSample}
              generatingSample={generatingSample}
            />
          )}

          {section === 'studio' && (
            <LiveStudioView
              telemetry={telemetry}
              captureTelemetry={captureTelemetry}
              logs={logs}
              videos={videos}
              overlays={overlays}
              rtmpConfig={rtmpConfig}
              sourceType={sourceType}
              onChangeSourceType={setSourceType}
              selectedVideoId={selectedVideoId}
              onSelectVideoId={setSelectedVideoId}
              directUrl={directUrl}
              onChangeDirectUrl={setDirectUrl}
              youtubeResult={youtubeResult}
              onYouTubeValidated={setYoutubeResult}
              quality={quality}
              onChangeQuality={setQuality}
              loopVideo={loopVideo}
              onChangeLoopVideo={setLoopVideo}
              onVideosUpdated={setVideos}
              onRtmpUpdated={setRtmpConfig}
              onTelemetryUpdated={setTelemetry}
              onNavigate={setSection}
            />
          )}

          {section === 'android-capture' && (
            <AndroidLiveCaptureView
              captureTelemetry={captureTelemetry}
              onCaptureTelemetryUpdated={setCaptureTelemetry}
              telemetry={telemetry}
              logs={logs}
              overlays={overlays}
              rtmpConfig={rtmpConfig}
              youtubeResult={youtubeResult}
              onYouTubeValidated={setYoutubeResult}
              quality={quality}
              onChangeQuality={setQuality}
              onTelemetryUpdated={setTelemetry}
              onChangeSourceType={setSourceType}
              onNavigate={setSection}
              initialNotice={companionMissingNotice}
              onDismissInitialNotice={() => setCompanionMissingNotice(null)}
            />
          )}

          {section === 'youtube' && (
            <YouTubePreviewView
              youtubeResult={youtubeResult}
              onYouTubeValidated={setYoutubeResult}
              onNavigate={setSection}
            />
          )}

          {section === 'overlays' && (
            <OverlaysView
              overlays={overlays}
              onOverlaysUpdated={setOverlays}
              sourceType={sourceType}
              selectedVideo={selectedVideo}
              directUrl={directUrl}
              captureTelemetry={captureTelemetry}
              streamStatus={telemetry.status}
            />
          )}

          {section === 'facebook' && (
            <FacebookOutputView
              telemetry={telemetry}
              logs={logs}
              rtmpConfig={rtmpConfig}
              sourceType={sourceType}
              selectedVideo={selectedVideo}
              directUrl={directUrl}
              captureTelemetry={captureTelemetry}
              quality={quality}
              onChangeQuality={setQuality}
              loopVideo={loopVideo}
              onChangeLoopVideo={setLoopVideo}
              onRtmpUpdated={setRtmpConfig}
              onTelemetryUpdated={setTelemetry}
              onNavigate={setSection}
            />
          )}

          {section === 'history' && (
            <HistoryView history={history} onClearHistory={handleClearHistory} />
          )}

          {section === 'settings' && (
            <SettingsView
              rtmpConfig={rtmpConfig}
              security={security}
              onRtmpUpdated={setRtmpConfig}
            />
          )}
        </main>
      </div>

      <MobileBottomNav
        activeSection={section}
        onSelect={setSection}
        onOpenDrawer={() => setMobileMenuOpen(true)}
        streamStatus={telemetry.status}
      />
    </div>
  );
}
