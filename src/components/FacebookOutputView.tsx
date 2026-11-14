import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Play,
  Radio,
  Square,
  Trash2,
  Wrench,
} from 'lucide-react';
import type {
  PipelineCheckResult,
  RtmpPublicConfig,
  StreamLogEntry,
  StreamQualityProfile,
  StreamTelemetry,
  VideoAsset,
  VideoSourceType,
} from '../../shared/types';
import { api, formatDuration } from '../lib/api';
import type { NavSection } from './Sidebar';

interface FacebookOutputViewProps {
  telemetry: StreamTelemetry;
  logs: StreamLogEntry[];
  rtmpConfig: RtmpPublicConfig;
  sourceType: VideoSourceType | 'camera' | 'screen';
  selectedVideo: VideoAsset | null;
  directUrl: string;
  quality: StreamQualityProfile;
  onChangeQuality: (q: StreamQualityProfile) => void;
  loopVideo: boolean;
  onChangeLoopVideo: (loop: boolean) => void;
  onRtmpUpdated: (config: RtmpPublicConfig) => void;
  onTelemetryUpdated: (telemetry: StreamTelemetry) => void;
  onNavigate: (section: NavSection) => void;
}

export function FacebookOutputView({
  telemetry,
  logs,
  rtmpConfig,
  sourceType,
  selectedVideo,
  directUrl,
  quality,
  onChangeQuality,
  loopVideo,
  onChangeLoopVideo,
  onRtmpUpdated,
  onTelemetryUpdated,
  onNavigate,
}: FacebookOutputViewProps) {
  const [serverUrl, setServerUrl] = useState(rtmpConfig.serverUrl);
  const [streamKey, setStreamKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rtmpFeedback, setRtmpFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [streamBusyAction, setStreamBusyAction] = useState<'starting' | 'stopping' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [pipelineChecking, setPipelineChecking] = useState(false);
  const [pipelineResult, setPipelineResult] = useState<PipelineCheckResult | null>(null);

  useEffect(() => {
    setServerUrl(rtmpConfig.serverUrl);
  }, [rtmpConfig.serverUrl]);

  const isStreamingOrConnecting = telemetry.status === 'Live' || telemetry.status === 'Connecting';
  const isAuthorizedSource =
    (sourceType === 'uploaded' && Boolean(selectedVideo)) ||
    (sourceType === 'direct-url' && directUrl.trim().length > 0);

  const sourceSummary =
    sourceType === 'uploaded'
      ? selectedVideo
        ? `Uploaded File · ${selectedVideo.originalName}`
        : 'No uploaded video selected'
      : sourceType === 'direct-url'
        ? directUrl.trim()
          ? `Direct Media URL · ${directUrl.trim()}`
          : 'No direct media URL entered'
        : sourceType === 'youtube-preview'
          ? 'YouTube Preview Only (Cannot start FFmpeg RTMP)'
          : 'Local Browser Capture Preview Only (Record & upload to broadcast)';

  const handleSaveCredentials = async () => {
    setSaving(true);
    setRtmpFeedback(null);
    try {
      const updated = await api.saveRtmpConfig(serverUrl, streamKey || undefined);
      onRtmpUpdated(updated);
      setStreamKey('');
      setShowKey(false);
      setRtmpFeedback({
        type: 'ok',
        text: updated.hasStreamKey
          ? `Saved & AES-256-GCM encrypted on backend (${updated.maskedStreamKey}).`
          : 'RTMP server URL updated. Add your Stream Key to broadcast.',
      });
    } catch (err) {
      setRtmpFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to save Facebook RTMP credentials.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleClearKey = async () => {
    setSaving(true);
    setRtmpFeedback(null);
    try {
      const updated = await api.clearRtmpKey();
      onRtmpUpdated(updated);
      setRtmpFeedback({ type: 'ok', text: 'Stored Stream Key removed from backend.' });
    } catch (err) {
      setRtmpFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to clear Stream Key.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleStartLive = async () => {
    setActionError(null);
    setPipelineResult(null);

    if (!isAuthorizedSource) {
      setActionError(
        sourceType === 'youtube-preview'
          ? 'YouTube sources are preview-only and cannot be sent to FFmpeg. Choose an uploaded MP4/MOV/WebM file or authorized direct media URL.'
          : 'Select an uploaded video file or authorized direct media URL in Live Studio first.',
      );
      return;
    }

    setStreamBusyAction('starting');
    try {
      const res = await api.startStream({
        sourceType: sourceType === 'direct-url' ? 'direct-url' : 'uploaded',
        videoId: sourceType === 'uploaded' ? selectedVideo?.id : undefined,
        directUrl: sourceType === 'direct-url' ? directUrl : undefined,
        quality,
        loopVideo,
      });
      onTelemetryUpdated(res.telemetry);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to start Facebook Live broadcast.');
    } finally {
      setStreamBusyAction(null);
    }
  };

  const handleStopLive = async () => {
    setActionError(null);
    setStreamBusyAction('stopping');
    try {
      const res = await api.stopStream();
      onTelemetryUpdated(res.telemetry);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to stop broadcast.');
    } finally {
      setStreamBusyAction(null);
    }
  };

  const handleValidatePipeline = async () => {
    setActionError(null);
    setPipelineResult(null);
    if (!isAuthorizedSource) {
      setActionError('Select an uploaded video or authorized direct media URL first.');
      return;
    }
    setPipelineChecking(true);
    try {
      const res = await api.validatePipeline({
        sourceType: sourceType === 'direct-url' ? 'direct-url' : 'uploaded',
        videoId: sourceType === 'uploaded' ? selectedVideo?.id : undefined,
        directUrl: sourceType === 'direct-url' ? directUrl : undefined,
        quality,
      });
      setPipelineResult(res);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Encoding pipeline check failed.');
    } finally {
      setPipelineChecking(false);
    }
  };

  return (
    <div className="space-y-5 max-w-6xl min-w-0">
      {/* Live Output Telemetry & Primary Controls */}
      <section className="bg-[#121721] border border-[#232B3A] rounded-2xl p-4 sm:p-5 space-y-4 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Radio className="w-4 h-4 text-blue-400 shrink-0" />
            <h2 className="text-base font-semibold text-slate-100">Facebook Live Output Control</h2>
          </div>
          <span
            className={`text-xs font-mono font-semibold shrink-0 ${
              telemetry.status === 'Live'
                ? 'text-red-400'
                : telemetry.status === 'Connecting'
                  ? 'text-amber-400'
                  : telemetry.status === 'Error'
                    ? 'text-rose-400'
                    : 'text-slate-400'
            }`}
          >
            {telemetry.status}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5">
          <div className="bg-[#0E131B] border border-[#232B3A] rounded-xl px-3 py-2.5 min-w-0">
            <div className="text-[11px] text-slate-400">Connection</div>
            <div className="text-sm font-semibold text-slate-100 mt-0.5 truncate">{telemetry.status}</div>
          </div>
          <div className="bg-[#0E131B] border border-[#232B3A] rounded-xl px-3 py-2.5 min-w-0">
            <div className="text-[11px] text-slate-400">Duration</div>
            <div className="text-sm font-semibold text-slate-100 font-mono tabular-nums mt-0.5 truncate">
              {formatDuration(telemetry.durationSec)}
            </div>
          </div>
          <div className="bg-[#0E131B] border border-[#232B3A] rounded-xl px-3 py-2.5 min-w-0">
            <div className="text-[11px] text-slate-400">Resolution</div>
            <div className="text-sm font-semibold text-slate-100 font-mono tabular-nums mt-0.5 truncate">
              {isStreamingOrConnecting
                ? telemetry.outputResolution
                : quality === '1080p'
                  ? '1920x1080'
                  : '1280x720'}
            </div>
          </div>
          <div className="bg-[#0E131B] border border-[#232B3A] rounded-xl px-3 py-2.5 min-w-0">
            <div className="text-[11px] text-slate-400">FPS</div>
            <div className="text-sm font-semibold text-slate-100 font-mono tabular-nums mt-0.5 truncate">
              {telemetry.fps > 0 ? `${telemetry.fps} fps` : '30 target'}
            </div>
          </div>
          <div className="bg-[#0E131B] border border-[#232B3A] rounded-xl px-3 py-2.5 min-w-0">
            <div className="text-[11px] text-slate-400">Bitrate</div>
            <div className="text-sm font-semibold text-slate-100 font-mono tabular-nums mt-0.5 truncate">
              {telemetry.bitrateKbps > 0 ? `${telemetry.bitrateKbps} kbps` : '0 kbps'}
            </div>
          </div>
          <div className="bg-[#0E131B] border border-[#232B3A] rounded-xl px-3 py-2.5 min-w-0">
            <div className="text-[11px] text-slate-400">Frames / Speed</div>
            <div className="text-sm font-semibold text-slate-100 font-mono tabular-nums mt-0.5 truncate">
              {telemetry.framesEncoded} · {telemetry.speed}
            </div>
          </div>
        </div>

        {/* Active Video Source Summary */}
        <div className="bg-[#0E131B] border border-[#232B3A] rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 min-w-0">
          <div className="min-w-0">
            <div className="text-[11px] text-slate-400">Assigned Broadcast Input</div>
            <div
              className={`text-xs sm:text-sm font-medium mt-0.5 break-words ${
                isAuthorizedSource ? 'text-slate-100' : 'text-amber-300'
              }`}
            >
              {sourceSummary}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('studio')}
            className="min-h-[44px] px-3.5 py-2 rounded-xl bg-[#181F2C] hover:bg-[#222C3E] border border-[#2C374C] text-xs font-medium text-slate-200 flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <span>Change Source</span>
            <ArrowRight className="w-3.5 h-3.5 text-blue-400" />
          </button>
        </div>

        {(actionError || telemetry.lastError) && (
          <div className="p-3 rounded-xl bg-rose-950/35 border border-rose-500/40 text-xs text-rose-200 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span className="break-words min-w-0">{actionError || telemetry.lastError}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              disabled={isStreamingOrConnecting}
              onClick={() => onChangeQuality('720p')}
              className={`min-h-[48px] px-3 py-2 rounded-xl border text-left transition-colors disabled:opacity-50 ${
                quality === '720p'
                  ? 'bg-blue-600/15 border-blue-500 text-slate-100'
                  : 'bg-[#0E131B] border-[#232B3A] text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="text-sm font-semibold font-mono">720p30</div>
              <div className="text-[11px] text-slate-400 font-mono">1280x720 · 3000k</div>
            </button>
            <button
              type="button"
              disabled={isStreamingOrConnecting}
              onClick={() => onChangeQuality('1080p')}
              className={`min-h-[48px] px-3 py-2 rounded-xl border text-left transition-colors disabled:opacity-50 ${
                quality === '1080p'
                  ? 'bg-blue-600/15 border-blue-500 text-slate-100'
                  : 'bg-[#0E131B] border-[#232B3A] text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="text-sm font-semibold font-mono">1080p30</div>
              <div className="text-[11px] text-slate-400 font-mono">1920x1080 · 5000k</div>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={handleStartLive}
              disabled={isStreamingOrConnecting || streamBusyAction !== null || !isAuthorizedSource}
              className="min-h-[48px] px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-[0.98] disabled:bg-blue-600/35 disabled:text-slate-300 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all whitespace-nowrap"
            >
              <Play className="w-4 h-4 shrink-0" />
              <span>{streamBusyAction === 'starting' ? 'STARTING...' : 'START LIVE'}</span>
            </button>
            <button
              type="button"
              onClick={handleStopLive}
              disabled={!isStreamingOrConnecting || streamBusyAction !== null}
              className="min-h-[48px] px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 active:scale-[0.98] disabled:bg-[#1B2230] disabled:text-slate-500 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all whitespace-nowrap"
            >
              <Square className="w-4 h-4 shrink-0" />
              <span>{streamBusyAction === 'stopping' ? 'STOPPING...' : 'STOP LIVE'}</span>
            </button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
          {sourceType === 'uploaded' ? (
            <label className="min-h-[44px] flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                disabled={isStreamingOrConnecting}
                checked={loopVideo}
                onChange={(e) => onChangeLoopVideo(e.target.checked)}
                className="w-4 h-4 rounded border-[#2E384B] bg-[#0B0E14] text-blue-600 focus:ring-blue-500"
              />
              <span>Loop uploaded video continuously</span>
            </label>
          ) : (
            <span className="text-xs text-slate-400">H.264 + AAC · 30 FPS · Constant Keyframes</span>
          )}

          <button
            type="button"
            onClick={handleValidatePipeline}
            disabled={pipelineChecking || isStreamingOrConnecting || !isAuthorizedSource}
            className="min-h-[44px] px-4 py-2 rounded-xl border border-[#2A3447] bg-[#181F2C] hover:bg-[#1F293B] text-slate-200 text-xs font-medium flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
          >
            <Wrench className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <span>
              {pipelineChecking ? 'Testing 2s FFmpeg Encode...' : 'Verify Encoding Pipeline (Dry-Run)'}
            </span>
          </button>
        </div>

        {pipelineResult && (
          <div
            className={`p-3 rounded-xl border text-xs space-y-1 ${
              pipelineResult.success
                ? 'bg-emerald-950/25 border-emerald-500/35 text-emerald-200'
                : 'bg-rose-950/25 border-rose-500/35 text-rose-200'
            }`}
          >
            <div className="font-semibold">
              {pipelineResult.success ? 'Dry-Run Encode Passed' : 'Dry-Run Encode Failed'}
            </div>
            <p className="break-words">{pipelineResult.message}</p>
            <div className="font-mono text-[11px] text-slate-300">
              {pipelineResult.resolution} · {pipelineResult.videoCodec} · {pipelineResult.audioCodec}
            </div>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start min-w-0">
        {/* Facebook RTMP Credentials */}
        <section className="lg:col-span-5 bg-[#121721] border border-[#232B3A] rounded-2xl p-4 sm:p-5 space-y-4 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[#232B3A]">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-blue-400 shrink-0" />
              <h3 className="text-sm sm:text-base font-semibold text-slate-100">
                Facebook RTMP Configuration
              </h3>
            </div>
            <span className="text-xs font-mono text-slate-300">
              {rtmpConfig.hasStreamKey ? rtmpConfig.maskedStreamKey : 'No Key Saved'}
            </span>
          </div>

          <div className="space-y-3">
            <div>
              <label htmlFor="fb-out-url" className="block text-xs font-medium text-slate-300 mb-1.5">
                RTMP Server URL
              </label>
              <input
                id="fb-out-url"
                type="text"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="rtmps://live-api-s.facebook.com:443/rtmp/"
                className="w-full min-h-[44px] bg-[#0B0E14] border border-[#263042] rounded-xl px-3 py-2 text-xs font-mono text-slate-100 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label htmlFor="fb-out-key" className="block text-xs font-medium text-slate-300 mb-1.5">
                Facebook Stream Key
              </label>
              <div className="relative">
                <input
                  id="fb-out-key"
                  type={showKey ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={streamKey}
                  onChange={(e) => setStreamKey(e.target.value)}
                  placeholder={
                    rtmpConfig.hasStreamKey
                      ? `Stored: ${rtmpConfig.maskedStreamKey} (enter to replace)`
                      : 'Paste Facebook Live Stream Key'
                  }
                  className="w-full min-h-[44px] bg-[#0B0E14] border border-[#263042] rounded-xl pl-3 pr-12 py-2 text-xs font-mono text-slate-100 focus:outline-none focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  aria-label={showKey ? 'Hide stream key' : 'Show stream key'}
                  className="absolute right-1 top-1/2 -translate-y-1/2 min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:text-slate-200"
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
                Encrypted on the Render backend with AES-256-GCM. Never stored in localStorage or exposed in frontend responses.
              </p>
            </div>

            {rtmpFeedback && (
              <div
                className={`p-3 rounded-xl border text-xs flex items-start gap-2 break-words ${
                  rtmpFeedback.type === 'ok'
                    ? 'bg-emerald-950/25 border-emerald-500/35 text-emerald-200'
                    : 'bg-rose-950/25 border-rose-500/35 text-rose-200'
                }`}
              >
                {rtmpFeedback.type === 'ok' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                )}
                <span>{rtmpFeedback.text}</span>
              </div>
            )}

            <div className="flex flex-wrap gap-2.5 pt-1">
              <button
                type="button"
                onClick={handleSaveCredentials}
                disabled={saving}
                className="flex-1 min-h-[44px] px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold disabled:opacity-50"
              >
                {saving ? 'Encrypting & Saving...' : 'Save Configuration'}
              </button>
              {rtmpConfig.hasStreamKey && (
                <button
                  type="button"
                  onClick={handleClearKey}
                  disabled={saving}
                  className="min-h-[44px] px-3.5 py-2 rounded-xl border border-[#2C374C] text-xs font-medium text-rose-300 hover:bg-rose-950/30 flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear Key</span>
                </button>
              )}
            </div>
          </div>
        </section>

        {/* FFmpeg Output Logs */}
        <section className="lg:col-span-7 bg-[#121721] border border-[#232B3A] rounded-2xl p-4 sm:p-5 space-y-3 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm sm:text-base font-semibold text-slate-100">
              FFmpeg &amp; RTMPS Engine Logs
            </h3>
            <span className="text-xs font-mono text-slate-400 tabular-nums">
              {logs.length} events · Stream key redacted
            </span>
          </div>
          <div className="bg-[#080A0F] border border-[#232B3A] rounded-xl p-3 h-64 sm:h-72 overflow-y-auto overflow-x-hidden font-mono text-xs space-y-1.5">
            {logs.length === 0 ? (
              <div className="text-slate-500 py-8 text-center">
                No FFmpeg events yet. Run a dry-run check or start a live broadcast.
              </div>
            ) : (
              logs.map((entry) => (
                <div key={entry.id} className="flex items-start gap-2 leading-relaxed">
                  <span className="text-slate-500 shrink-0 tabular-nums">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                  <span
                    className={`shrink-0 uppercase text-[10px] font-semibold mt-0.5 ${
                      entry.level === 'error'
                        ? 'text-rose-400'
                        : entry.level === 'warn'
                          ? 'text-amber-400'
                          : entry.level === 'info'
                            ? 'text-blue-400'
                            : 'text-slate-400'
                    }`}
                  >
                    [{entry.level}]
                  </span>
                  <span
                    className={`break-all min-w-0 ${
                      entry.level === 'error'
                        ? 'text-rose-200'
                        : entry.level === 'warn'
                          ? 'text-amber-200'
                          : 'text-slate-300'
                    }`}
                  >
                    {entry.message}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
