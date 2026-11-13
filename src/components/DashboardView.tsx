import { ArrowRight, CheckCircle2, AlertCircle, Film, KeyRound, Radio, ShieldCheck } from 'lucide-react';
import type {
  OverlayConfig,
  RtmpPublicConfig,
  SecurityStatusInfo,
  StreamHistoryEntry,
  StreamTelemetry,
  VideoAsset,
} from '../../shared/types';
import { formatBytes, formatDuration } from '../lib/api';
import type { NavSection } from './Sidebar';

interface DashboardViewProps {
  telemetry: StreamTelemetry;
  rtmpConfig: RtmpPublicConfig;
  videos: VideoAsset[];
  overlays: OverlayConfig;
  history: StreamHistoryEntry[];
  security: SecurityStatusInfo | null;
  onNavigate: (section: NavSection) => void;
  onGenerateSample: () => Promise<void>;
  generatingSample: boolean;
}

export function DashboardView({
  telemetry,
  rtmpConfig,
  videos,
  overlays,
  history,
  security,
  onNavigate,
  onGenerateSample,
  generatingSample,
}: DashboardViewProps) {
  const activeOverlaysCount = [
    overlays.logoEnabled && overlays.logoUrl,
    overlays.headlineEnabled,
    overlays.lowerThirdEnabled,
    overlays.tickerEnabled,
  ].filter(Boolean).length;

  const readinessItems = [
    {
      label: 'FFmpeg Encoding Engine',
      ready: Boolean(security?.ffmpegAvailable),
      detail: security?.ffmpegAvailable
        ? 'H.264 / AAC / RTMPS pipeline detected on host'
        : 'FFmpeg binary missing on host',
      actionLabel: 'Check Settings',
      target: 'settings' as NavSection,
    },
    {
      label: 'Authorized Video Source',
      ready: videos.length > 0,
      detail:
        videos.length > 0
          ? `${videos.length} verified media ${videos.length === 1 ? 'asset' : 'assets'} available`
          : 'Upload an MP4/MOV/WebM file or generate a sample clip',
      actionLabel: 'Open Live Studio',
      target: 'studio' as NavSection,
    },
    {
      label: 'Facebook RTMP Credentials',
      ready: rtmpConfig.hasStreamKey,
      detail: rtmpConfig.hasStreamKey
        ? `Encrypted key stored (${rtmpConfig.maskedStreamKey})`
        : 'Add your Facebook Stream Key in Settings or Live Studio',
      actionLabel: 'Configure RTMP',
      target: 'settings' as NavSection,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Primary Overview Strip */}
      <div className="bg-[#121721] border border-[#232B3A] rounded-lg p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold text-slate-100">Broadcast Control Overview</h2>
          <p className="text-sm text-slate-400 max-w-2xl">
            Prepare authorized media files or direct streams, compose real-time graphics overlays, and encode directly to Facebook Live via RTMPS.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onGenerateSample}
            disabled={generatingSample}
            className="px-4 py-2 text-sm font-medium rounded-md border border-[#2A3447] bg-[#181F2C] text-slate-200 hover:bg-[#1E2738] disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {generatingSample ? 'Generating MP4...' : 'Generate Sample MP4'}
          </button>
          <button
            type="button"
            onClick={() => onNavigate('studio')}
            className="px-4 py-2 text-sm font-medium rounded-md bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-2 transition-colors whitespace-nowrap"
          >
            <Radio className="w-4 h-4" />
            <span>Open Live Studio</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 4-Column Telemetry Summary Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-[#121721] border border-[#232B3A] rounded-lg p-5">
          <div className="text-xs font-medium text-slate-400">Broadcast Status</div>
          <div className="mt-2 flex items-center gap-2">
            <span
              className={`text-lg font-semibold ${
                telemetry.status === 'Live'
                  ? 'text-red-400'
                  : telemetry.status === 'Connecting'
                    ? 'text-amber-400'
                    : telemetry.status === 'Error'
                      ? 'text-rose-400'
                      : 'text-slate-100'
              }`}
            >
              {telemetry.status}
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {telemetry.outputResolution} · 30 FPS
          </div>
        </div>

        <div className="bg-[#121721] border border-[#232B3A] rounded-lg p-5">
          <div className="text-xs font-medium text-slate-400">Authorized Media Library</div>
          <div className="mt-2 text-lg font-semibold text-slate-100 font-mono tabular-nums">
            {videos.length} {videos.length === 1 ? 'File' : 'Files'}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {formatBytes(videos.reduce((acc, v) => acc + v.sizeBytes, 0))} total
          </div>
        </div>

        <div className="bg-[#121721] border border-[#232B3A] rounded-lg p-5">
          <div className="text-xs font-medium text-slate-400">Active Graphics Overlays</div>
          <div className="mt-2 text-lg font-semibold text-slate-100 font-mono tabular-nums">
            {activeOverlaysCount} / 4 Enabled
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Logo · Headline · Lower-Third · Ticker
          </div>
        </div>

        <div className="bg-[#121721] border border-[#232B3A] rounded-lg p-5">
          <div className="text-xs font-medium text-slate-400">Recorded Sessions</div>
          <div className="mt-2 text-lg font-semibold text-slate-100 font-mono tabular-nums">
            {history.length}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {history[0] ? `Last: ${history[0].status}` : 'No sessions recorded yet'}
          </div>
        </div>
      </div>

      {/* Two-Column Readiness & Recent History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        <section className="bg-[#121721] border border-[#232B3A] rounded-lg p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-[#232B3A]">
              <h3 className="text-base font-semibold text-slate-100">Pre-Flight Broadcast Checklist</h3>
              <ShieldCheck className="w-4 h-4 text-blue-400" />
            </div>
            <div className="divide-y divide-[#232B3A]">
              {readinessItems.map((item) => (
                <div key={item.label} className="py-4 flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    {item.ready ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                    )}
                    <div>
                      <div className="text-sm font-medium text-slate-100">{item.label}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{item.detail}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate(item.target)}
                    className="text-xs font-medium text-blue-400 hover:text-blue-300 whitespace-nowrap shrink-0"
                  >
                    {item.actionLabel}
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-4 border-t border-[#232B3A] flex items-center justify-between text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-slate-400" />
              <span>Stream keys are AES-256-GCM encrypted on the server</span>
            </span>
            <button
              type="button"
              onClick={() => onNavigate('overlays')}
              className="text-blue-400 hover:text-blue-300 font-medium whitespace-nowrap"
            >
              Edit Overlays
            </button>
          </div>
        </section>

        <section className="bg-[#121721] border border-[#232B3A] rounded-lg p-6 flex flex-col">
          <div className="flex items-center justify-between pb-4 border-b border-[#232B3A]">
            <h3 className="text-base font-semibold text-slate-100">Recent Broadcast Sessions</h3>
            <button
              type="button"
              onClick={() => onNavigate('history')}
              className="text-xs font-medium text-blue-400 hover:text-blue-300 whitespace-nowrap"
            >
              View All
            </button>
          </div>

          {history.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-10 text-center">
              <Film className="w-7 h-7 text-slate-500 mb-2" />
              <p className="text-sm font-medium text-slate-300">No Broadcast Sessions Yet</p>
              <p className="text-xs text-slate-400 mt-1 max-w-xs">
                Start an FFmpeg RTMP broadcast in Live Studio to record session telemetry and duration logs.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#232B3A]">
              {history.slice(0, 5).map((entry) => (
                <div key={entry.id} className="py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-200 truncate">
                      {entry.sourceLabel}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5 font-mono tabular-nums">
                      {new Date(entry.startedAt).toLocaleString()} · {entry.outputResolution}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div
                      className={`text-xs font-medium ${
                        entry.status === 'Error' ? 'text-rose-400' : 'text-emerald-400'
                      }`}
                    >
                      {entry.status}
                    </div>
                    <div className="text-xs text-slate-400 font-mono tabular-nums">
                      {formatDuration(entry.durationSec)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
