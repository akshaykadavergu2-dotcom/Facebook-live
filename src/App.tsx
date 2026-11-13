import { useCallback, useEffect, useRef, useState } from 'react';
import { LogOut, Menu, Radio, Wifi, WifiOff } from 'lucide-react';
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
import { api, formatDuration } from './lib/api';
import { AuthGateModal } from './components/AuthGateModal';
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
    const [authRes, statusRes, rtmpRes, videosRes, overlaysRes, historyRes] = await Promise.all([
      api.getAuthStatus(),
      api.getStreamStatus().catch(() => null),
      api.getRtmpConfig().catch(() => null),
      api.getVideos().catch(() => null),
      api.getOverlays().catch(() => null),
      api.getHistory().catch(() => null),
    ]);

    setSecurity(authRes);
    if (statusRes) {
      setTelemetry(statusRes.telemetry);
      setLogs(statusRes.logs);
    }
    if (rtmpRes) setRtmpConfig(rtmpRes);
    if (videosRes) {
      setVideos(videosRes.videos);
      if (videosRes.videos.length > 0) {
        setSelectedVideoId((prev) => prev ?? videosRes.videos[0].id);
      }
    }
    if (overlaysRes) setOverlays(overlaysRes);
    if (historyRes) setHistory(historyRes.history);
  }, []);

  useEffect(() => {
    loadStudioData().finally(() => setBootLoading(false));
  }, [loadStudioData]);

  // WebSocket live telemetry & logs connection with automatic reconnect
  useEffect(() => {
    if (bootLoading) return;
    if (security?.authRequired && !security.authenticated) return;

    let closedByCleanup = false;
    let reconnectTimer: number | null = null;

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
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
          reconnectTimer = window.setTimeout(connect, 2500);
        }
      };

      ws.onerror = () => {
        ws.close();
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
  }, [bootLoading, security?.authRequired, security?.authenticated]);

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

  const handleLogout = async () => {
    await api.logout();
    setSecurity((prev) => (prev ? { ...prev, authenticated: false } : prev));
  };

  if (bootLoading) {
    return (
      <div className="min-h-screen bg-[#0B0E14] flex items-center justify-center text-sm text-slate-400">
        Initializing LIVECAST STUDIO...
      </div>
    );
  }

  if (security?.authRequired && !security.authenticated) {
    return (
      <AuthGateModal
        onAuthenticated={() => {
          loadStudioData();
        }}
      />
    );
  }

  const selectedVideo = videos.find((v) => v.id === selectedVideoId) ?? videos[0] ?? null;

  return (
    <div className="min-h-screen h-screen bg-[#0B0E14] text-slate-100 flex overflow-hidden">
      <Sidebar
        activeSection={section}
        onSelect={setSection}
        streamStatus={telemetry.status}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Broadcast Header */}
        <header className="h-14 px-4 lg:px-6 border-b border-[#232B3A] bg-[#0E131B] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation"
              className="lg:hidden p-2 rounded-md text-slate-300 hover:bg-[#181F2C]"
            >
              <Menu className="w-4 h-4" />
            </button>
            <h1 className="text-sm sm:text-base font-semibold text-slate-100 truncate">
              {SECTION_TITLES[section]}
            </h1>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            {/* Live Telemetry & WebSocket Readout */}
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
                    <span>Reconnecting</span>
                  </>
                )}
              </span>
            </div>

            {section !== 'studio' && (
              <button
                type="button"
                onClick={() => setSection('studio')}
                className="px-3.5 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold whitespace-nowrap shrink-0"
              >
                Live Studio
              </button>
            )}

            {security?.authRequired && (
              <button
                type="button"
                onClick={handleLogout}
                aria-label="Sign out"
                className="p-2 rounded-md border border-[#232B3A] text-slate-400 hover:text-slate-100 hover:bg-[#181F2C]"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </header>

        {/* Scrollable Workspace Viewport */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
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
