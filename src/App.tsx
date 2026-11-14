import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Menu, Radio, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import type {
  OverlayConfig,
  RtmpPublicConfig,
  SecurityStatusInfo,
  StreamHistoryEntry,
  StreamLogEntry,
  StreamTelemetry,
  VideoAsset,
  VideoSourceType,
  YouTubeValidationResult,
} from '../shared/types';
import { api, API_BASE_URL, formatDuration, getWebSocketUrl } from './lib/api';
import { DashboardView } from './components/DashboardView';
import { HistoryView } from './components/HistoryView';
import { LiveStudioView } from './components/LiveStudioView';
import { OverlaysView } from './components/OverlaysView';
import { SettingsView } from './components/SettingsView';
import { Sidebar, type NavSection } from './components/Sidebar';

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
  lowerThirdEnabled: false,
  lowerThirdTitle: 'LIVECAST STUDIO',
  lowerThirdSubtitle: 'Authorized Live Broadcast Feed',
  lowerThirdAccentColor: '#2563EB',
  lowerThirdBgColor: '#0B0E14',
  lowerThirdTextColor: '#F8FAFC',
  lowerThirdAnimation: 'slide',
  tickerEnabled: false,
  tickerText: 'Welcome to the live broadcast. Stay tuned for updates and upcoming segments.',
  tickerFontSize: 20,
  tickerColor: '#F8FAFC',
  tickerBgColor: '#1E293B',
  tickerBgOpacity: 0.9,
  tickerSpeed: 95,
};

const SECTION_TITLES: Record<NavSection, string> = {
  dashboard: 'Dashboard',
  studio: 'Live Studio',
  overlays: 'Overlays & Graphics',
  history: 'Stream History',
  settings: 'Settings & Deployment',
};

export default function App() {
  const [section, setSection] = useState<NavSection>('studio');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [security, setSecurity] = useState<SecurityStatusInfo | null>(null);
  const [bootLoading, setBootLoading] = useState(true);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [retryingConnection, setRetryingConnection] = useState(false);

  const [telemetry, setTelemetry] = useState<StreamTelemetry>(INITIAL_TELEMETRY);
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

  const [sourceType, setSourceType] = useState<VideoSourceType>('uploaded');
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [directUrl, setDirectUrl] = useState('');
  const [youtubeResult, setYoutubeResult] = useState<YouTubeValidationResult | null>(null);
  const [generatingSample, setGeneratingSample] = useState(false);

  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const loadStudioData = useCallback(async () => {
    setBackendError(null);
    try {
      const [securityRes, statusRes, rtmpRes, videosRes, overlaysRes, historyRes] = await Promise.all([
        api.getSecurityStatus(),
        api.getStreamStatus(),
        api.getRtmpConfig(),
        api.getVideos(),
        api.getOverlays(),
        api.getHistory(),
      ]);

      setSecurity(securityRes);

      setTelemetry(statusRes.telemetry);
      setLogs(statusRes.logs);
      setRtmpConfig(rtmpRes);
      setVideos(videosRes.videos);
      if (videosRes.videos.length > 0) {
        setSelectedVideoId((prev) => prev ?? videosRes.videos[0].id);
      }
      setOverlays(overlaysRes);
      setHistory(historyRes.history);
    } catch (err) {
      const isNetlifyMissingBase =
        !API_BASE_URL && window.location.hostname.endsWith('.netlify.app');
      setBackendError(
        isNetlifyMissingBase
          ? 'VITE_API_BASE_URL is not configured for this Netlify deployment. Set VITE_API_BASE_URL to your Render backend URL in Netlify Environment Variables and redeploy.'
          : err instanceof Error
            ? err.message
            : 'Unable to connect to the LIVECAST STUDIO backend server.',
      );
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

    let closedByCleanup = false;
    let reconnectTimer: number | null = null;

    const connect = () => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(getWebSocketUrl());
      } catch {
        setWsConnected(false);
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as
            | { type: 'init'; telemetry: StreamTelemetry; logs: StreamLogEntry[]; history: StreamHistoryEntry[] }
            | { type: 'status'; telemetry: StreamTelemetry }
            | { type: 'log'; entry: StreamLogEntry }
            | { type: 'history'; entry: StreamHistoryEntry };

          if (msg.type === 'init') {
            setTelemetry(msg.telemetry);
            setLogs(msg.logs);
            setHistory(msg.history);
          } else if (msg.type === 'status') {
            setTelemetry(msg.telemetry);
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

      ws.onclose = () => {
        setWsConnected(false);
        if (!closedByCleanup) {
          reconnectTimer = window.setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => {
        setWsConnected(false);
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
      <div className="min-h-screen bg-[#0B0E14] flex flex-col items-center justify-center gap-2 text-sm text-slate-400 px-4 text-center">
        <span>Connecting to LIVECAST STUDIO backend...</span>
        {API_BASE_URL && (
          <span className="text-xs font-mono text-slate-500 break-all">{API_BASE_URL}</span>
        )}
      </div>
    );
  }

  const selectedVideo = videos.find((v) => v.id === selectedVideoId) ?? videos[0] ?? null;

  return (
    <div className="min-h-screen bg-[#0B0E14] text-slate-100 flex w-full max-w-full">
      <Sidebar
        activeSection={section}
        onSelect={setSection}
        streamStatus={telemetry.status}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-14 px-3 sm:px-4 lg:px-6 border-b border-[#232B3A] bg-[#0E131B] flex items-center justify-between gap-3 shrink-0 min-w-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation"
              className="lg:hidden p-2 rounded-md text-slate-300 hover:bg-[#181F2C] shrink-0"
            >
              <Menu className="w-4 h-4" />
            </button>
            <h1 className="text-sm sm:text-base font-semibold text-slate-100 truncate">
              {SECTION_TITLES[section]}
            </h1>
          </div>

          <div className="flex items-center gap-3 sm:gap-4 shrink-0">
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
              <span className="flex items-center gap-1 text-slate-400">
                {wsConnected ? (
                  <>
                    <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                    <span>WS Connected</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="w-3.5 h-3.5 text-amber-400" />
                    <span>Offline</span>
                  </>
                )}
              </span>
            </div>

            {section !== 'studio' && (
              <button
                type="button"
                onClick={() => setSection('studio')}
                className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold whitespace-nowrap shrink-0"
              >
                Live Studio
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4 lg:p-6 min-w-0">
          {backendError && (
            <div className="mb-5 bg-rose-950/35 border border-rose-500/40 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div className="text-xs text-rose-100 space-y-1 min-w-0">
                  <div className="font-semibold text-sm text-rose-200">Backend API Connection Issue</div>
                  <p className="break-words">{backendError}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleRetryConnection}
                disabled={retryingConnection}
                className="px-3.5 py-2 rounded-md bg-[#181F2C] hover:bg-[#232C3E] border border-[#2E394E] text-xs font-medium text-slate-100 flex items-center gap-1.5 shrink-0 disabled:opacity-50 self-start sm:self-center"
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
              onVideosUpdated={setVideos}
              onRtmpUpdated={setRtmpConfig}
              onTelemetryUpdated={setTelemetry}
            />
          )}

          {section === 'overlays' && (
            <OverlaysView
              overlays={overlays}
              onOverlaysUpdated={setOverlays}
              sourceType={sourceType}
              selectedVideo={selectedVideo}
              directUrl={directUrl}
              youtubeResult={youtubeResult}
              streamStatus={telemetry.status}
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
    </div>
  );
}
