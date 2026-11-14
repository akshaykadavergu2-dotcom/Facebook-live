import { useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Link2,
  Play,
  Radio,
  ShieldCheck,
  Smartphone,
  Square,
  Wrench,
} from 'lucide-react';
import type {
  AndroidCaptureSessionInfo,
  AndroidCaptureTelemetry,
  OverlayConfig,
  PipelineCheckResult,
  RtmpPublicConfig,
  StreamLogEntry,
  StreamQualityProfile,
  StreamTelemetry,
  YouTubeValidationResult,
} from '../../shared/types';
import { api, API_BASE_URL, formatDuration } from '../lib/api';
import type { NavSection } from './Sidebar';
import { VideoPreviewStage, type ProgramMonitorSource } from './VideoPreviewStage';
import { YouTubeMonitorCard } from './YouTubeMonitorCard';

interface AndroidLiveCaptureViewProps {
  captureTelemetry: AndroidCaptureTelemetry;
  onCaptureTelemetryUpdated: (next: AndroidCaptureTelemetry) => void;
  telemetry: StreamTelemetry;
  logs: StreamLogEntry[];
  overlays: OverlayConfig;
  rtmpConfig: RtmpPublicConfig;
  youtubeResult: YouTubeValidationResult | null;
  onYouTubeValidated: (res: YouTubeValidationResult | null) => void;
  quality: StreamQualityProfile;
  onChangeQuality: (q: StreamQualityProfile) => void;
  onTelemetryUpdated: (next: StreamTelemetry) => void;
  onChangeSourceType: (type: ProgramMonitorSource) => void;
  onNavigate: (section: NavSection) => void;
}

export function AndroidLiveCaptureView({
  captureTelemetry,
  onCaptureTelemetryUpdated,
  telemetry,
  logs,
  overlays,
  rtmpConfig,
  youtubeResult,
  onYouTubeValidated,
  quality,
  onChangeQuality,
  onTelemetryUpdated,
  onChangeSourceType,
  onNavigate,
}: AndroidLiveCaptureViewProps) {
  const [sessionInfo, setSessionInfo] = useState<AndroidCaptureSessionInfo | null>(null);
  const [connectingAndroid, setConnectingAndroid] = useState(false);
  const [startingCapture, setStartingCapture] = useState(false);
  const [stoppingCapture, setStoppingCapture] = useState(false);
  const [captureActionMsg, setCaptureActionMsg] = useState<string | null>(null);
  const [captureActionError, setCaptureActionError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [showOverlayPreview, setShowOverlayPreview] = useState(true);
  const [streamBusyAction, setStreamBusyAction] = useState<'starting' | 'stopping' | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [pipelineChecking, setPipelineChecking] = useState(false);
  const [pipelineResult, setPipelineResult] = useState<PipelineCheckResult | null>(null);

  const backendHttpUrl =
    API_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : '');

  const isLiveCaptureActive =
    captureTelemetry.status === 'Capturing' && captureTelemetry.framesReceived > 0;
  const isCaptureReadyForStream =
    captureTelemetry.width > 0 &&
    (captureTelemetry.status === 'Capturing' || captureTelemetry.status === 'Reconnecting');
  const isStreamingOrConnecting = telemetry.status === 'Live' || telemetry.status === 'Connecting';

  const audioStatusLabel =
    captureTelemetry.audioStatus === 'AUDIO_CAPTURED'
      ? 'AUDIO CAPTURED'
      : captureTelemetry.audioStatus === 'AUDIO_NOT_AVAILABLE'
        ? 'AUDIO NOT AVAILABLE'
        : 'IDLE';

  const copyValue = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1800);
    } catch {
      setCaptureActionError('Clipboard copy was blocked by browser settings.');
    }
  };

  const handleConnectAndroid = async () => {
    setConnectingAndroid(true);
    setCaptureActionError(null);
    setCaptureActionMsg(null);
    try {
      const youtubeUrl = youtubeResult?.valid ? youtubeResult.watchUrl || null : null;
      const res = await api.createCaptureSession(youtubeUrl);
      setSessionInfo(res.session);
      onCaptureTelemetryUpdated(res.telemetry);
      onChangeSourceType('android-capture');
      setCaptureActionMsg(
        'Capture session initialized. Launch the Android Capture companion app using the pairing link or copy the Session ID & Ingest Token into the app.',
      );
    } catch (err) {
      setCaptureActionError(
        err instanceof Error ? err.message : 'Failed to initialize Android capture session.',
      );
    } finally {
      setConnectingAndroid(false);
    }
  };

  const handleStartCapture = async () => {
    setStartingCapture(true);
    setCaptureActionError(null);
    setCaptureActionMsg(null);
    try {
      const youtubeUrl = youtubeResult?.valid ? youtubeResult.watchUrl || null : null;
      let activeSession = sessionInfo;

      if (!activeSession && captureTelemetry.sessionId) {
        const res = await api.startCaptureSession(captureTelemetry.sessionId, youtubeUrl);
        onCaptureTelemetryUpdated(res.telemetry);
        onChangeSourceType('android-capture');
        setCaptureActionMsg(
          res.signaled
            ? 'Start signal sent to Android Capture app. Approve the MediaProjection prompt on Android to begin capturing Monitor A.'
            : 'Session ready. Open the Android Capture app and confirm the MediaProjection prompt on your phone.',
        );
        return;
      }

      if (!activeSession) {
        const created = await api.createCaptureSession(youtubeUrl);
        activeSession = created.session;
        setSessionInfo(created.session);
        onCaptureTelemetryUpdated(created.telemetry);
      } else {
        const res = await api.startCaptureSession(activeSession.sessionId, youtubeUrl);
        onCaptureTelemetryUpdated(res.telemetry);
        if (res.signaled) {
          onChangeSourceType('android-capture');
          setCaptureActionMsg(
            'Start capture command dispatched to Android companion app. Approve screen capture consent on Android if prompted.',
          );
          return;
        }
      }

      onChangeSourceType('android-capture');
      window.location.href = activeSession.deepLinkUrl;
      setCaptureActionMsg(
        'Opening Android Capture companion app via deep link. Grant MediaProjection permission on Monitor A to stream live.',
      );
    } catch (err) {
      setCaptureActionError(
        err instanceof Error ? err.message : 'Failed to request Android capture start.',
      );
    } finally {
      setStartingCapture(false);
    }
  };

  const handleStopCapture = async () => {
    setStoppingCapture(true);
    setCaptureActionError(null);
    setCaptureActionMsg(null);
    try {
      const targetId = captureTelemetry.sessionId || sessionInfo?.sessionId;
      const res = await api.stopCaptureSession(targetId);
      onCaptureTelemetryUpdated(res.telemetry);
      setCaptureActionMsg('Capture session stopped and resources released.');
    } catch (err) {
      setCaptureActionError(
        err instanceof Error ? err.message : 'Failed to stop Android capture session.',
      );
    } finally {
      setStoppingCapture(false);
    }
  };

  const handleStartLive = async () => {
    setStreamError(null);
    setPipelineResult(null);
    if (!isCaptureReadyForStream) {
      setStreamError(
        'Connect the Android Capture companion app and wait until VIDEO CAPTURE STATUS shows CAPTURING before starting Facebook Live.',
      );
      return;
    }
    setStreamBusyAction('starting');
    try {
      onChangeSourceType('android-capture');
      const res = await api.startStream({
        sourceType: 'android-capture',
        quality,
        loopVideo: false,
      });
      onTelemetryUpdated(res.telemetry);
    } catch (err) {
      setStreamError(err instanceof Error ? err.message : 'Failed to start Facebook Live stream.');
    } finally {
      setStreamBusyAction(null);
    }
  };

  const handleStopLive = async () => {
    setStreamError(null);
    setStreamBusyAction('stopping');
    try {
      const res = await api.stopStream();
      onTelemetryUpdated(res.telemetry);
    } catch (err) {
      setStreamError(err instanceof Error ? err.message : 'Failed to stop Facebook Live stream.');
    } finally {
      setStreamBusyAction(null);
    }
  };

  const handleValidatePipeline = async () => {
    setStreamError(null);
    setPipelineResult(null);
    if (!isCaptureReadyForStream) {
      setStreamError('Start Android Live Capture first so live H.264 frames are arriving.');
      return;
    }
    setPipelineChecking(true);
    try {
      const res = await api.validatePipeline({
        sourceType: 'android-capture',
        quality,
      });
      setPipelineResult(res);
    } catch (err) {
      setStreamError(err instanceof Error ? err.message : 'Pipeline dry-run failed.');
    } finally {
      setPipelineChecking(false);
    }
  };

  return (
    <div className="space-y-5 min-w-0">
      {/* Android Companion Pairing & Capture Control Header */}
      <section className="bg-[#121721] border border-[#232B3A] rounded-2xl p-4 sm:p-5 space-y-4 min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <Smartphone className="w-4 h-4 text-blue-400 shrink-0" />
              <h2 className="text-base sm:text-lg font-semibold text-slate-100">
                ANDROID LIVE CAPTURE
              </h2>
              {isLiveCaptureActive && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-emerald-600 text-white text-[11px] font-mono font-semibold tracking-wider">
                  <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                  <span>LIVE CAPTURE</span>
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 leading-relaxed max-w-3xl">
              Streams ONLY Monitor A inside the companion Android capture activity (<code className="font-mono text-slate-300">MediaProjection</code> + permitted <code className="font-mono text-slate-300">AudioPlaybackCapture</code>) continuously via authenticated binary WebSocket into Monitor B and FFmpeg RTMPS. Browser chrome and dashboard controls are excluded.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono text-emerald-300 shrink-0">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>Stream Key Isolated on Server</span>
          </div>
        </div>

        {/* Primary Capture Action Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <button
            type="button"
            onClick={handleConnectAndroid}
            disabled={connectingAndroid}
            className="min-h-[48px] px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-[0.98] disabled:opacity-50 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all whitespace-nowrap"
          >
            <Link2 className="w-4 h-4 shrink-0" />
            <span>{connectingAndroid ? 'CREATING SESSION...' : 'CONNECT ANDROID'}</span>
          </button>

          <button
            type="button"
            onClick={handleStartCapture}
            disabled={startingCapture}
            className="min-h-[48px] px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] disabled:opacity-50 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all whitespace-nowrap"
          >
            <Play className="w-4 h-4 shrink-0" />
            <span>{startingCapture ? 'SIGNALING APP...' : 'START CAPTURE'}</span>
          </button>

          <button
            type="button"
            onClick={handleStopCapture}
            disabled={
              stoppingCapture ||
              (!captureTelemetry.sessionId && !sessionInfo) ||
              captureTelemetry.status === 'Stopped' ||
              captureTelemetry.status === 'Disconnected'
            }
            className="min-h-[48px] px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 active:scale-[0.98] disabled:bg-[#1B2230] disabled:text-slate-500 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all whitespace-nowrap"
          >
            <Square className="w-4 h-4 shrink-0" />
            <span>{stoppingCapture ? 'STOPPING...' : 'STOP CAPTURE'}</span>
          </button>
        </div>

        {/* Honest Telemetry Grid (7 Required Readouts) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
          <div className="bg-[#0E131B] border border-[#232B3A] rounded-xl px-3 py-2.5 min-w-0">
            <div className="text-[10px] font-medium text-slate-400">VIDEO CAPTURE STATUS</div>
            <div
              className={`text-xs sm:text-sm font-mono font-semibold mt-0.5 truncate ${
                captureTelemetry.videoStatus === 'CAPTURING'
                  ? 'text-emerald-400'
                  : captureTelemetry.videoStatus === 'ERROR'
                    ? 'text-rose-400'
                    : captureTelemetry.videoStatus === 'PAUSED'
                      ? 'text-amber-400'
                      : 'text-slate-200'
              }`}
            >
              {captureTelemetry.videoStatus}
            </div>
          </div>

          <div className="bg-[#0E131B] border border-[#232B3A] rounded-xl px-3 py-2.5 min-w-0">
            <div className="text-[10px] font-medium text-slate-400">AUDIO CAPTURE STATUS</div>
            <div
              className={`text-xs font-mono font-semibold mt-0.5 truncate ${
                captureTelemetry.audioStatus === 'AUDIO_CAPTURED'
                  ? 'text-emerald-400'
                  : captureTelemetry.audioStatus === 'AUDIO_NOT_AVAILABLE'
                    ? 'text-amber-300'
                    : 'text-slate-300'
              }`}
            >
              {audioStatusLabel}
            </div>
          </div>

          <div className="bg-[#0E131B] border border-[#232B3A] rounded-xl px-3 py-2.5 min-w-0">
            <div className="text-[10px] font-medium text-slate-400">BACKEND CONNECTION STATUS</div>
            <div
              className={`text-xs sm:text-sm font-mono font-semibold mt-0.5 truncate ${
                captureTelemetry.status === 'Capturing'
                  ? 'text-emerald-400'
                  : captureTelemetry.status === 'Reconnecting' || captureTelemetry.status === 'WaitingForApp'
                    ? 'text-amber-300'
                    : captureTelemetry.status === 'Error'
                      ? 'text-rose-400'
                      : 'text-slate-200'
              }`}
            >
              {captureTelemetry.status}
            </div>
          </div>

          <div className="bg-[#0E131B] border border-[#232B3A] rounded-xl px-3 py-2.5 min-w-0">
            <div className="text-[10px] font-medium text-slate-400">CAPTURE FPS</div>
            <div className="text-xs sm:text-sm font-mono font-semibold tabular-nums text-slate-100 mt-0.5 truncate">
              {captureTelemetry.fps} fps
            </div>
          </div>

          <div className="bg-[#0E131B] border border-[#232B3A] rounded-xl px-3 py-2.5 min-w-0">
            <div className="text-[10px] font-medium text-slate-400">CAPTURE RESOLUTION</div>
            <div className="text-xs sm:text-sm font-mono font-semibold tabular-nums text-slate-100 mt-0.5 truncate">
              {captureTelemetry.width > 0 && captureTelemetry.height > 0
                ? `${captureTelemetry.width}x${captureTelemetry.height}`
                : 'Not Active'}
            </div>
          </div>

          <div className="bg-[#0E131B] border border-[#232B3A] rounded-xl px-3 py-2.5 min-w-0">
            <div className="text-[10px] font-medium text-slate-400">AUDIO SAMPLE RATE</div>
            <div className="text-xs sm:text-sm font-mono font-semibold tabular-nums text-slate-100 mt-0.5 truncate">
              {captureTelemetry.audioSampleRate > 0
                ? `${captureTelemetry.audioSampleRate} Hz`
                : 'Not Available'}
            </div>
          </div>

          <div className="bg-[#0E131B] border border-[#232B3A] rounded-xl px-3 py-2.5 min-w-0">
            <div className="text-[10px] font-medium text-slate-400">STREAM LATENCY</div>
            <div className="text-xs sm:text-sm font-mono font-semibold tabular-nums text-slate-100 mt-0.5 truncate">
              {captureTelemetry.latencyMs > 0 ? `${captureTelemetry.latencyMs} ms` : '0 ms'}
            </div>
          </div>
        </div>

        {(captureActionError || captureTelemetry.lastError) && (
          <div className="p-3 rounded-xl bg-rose-950/35 border border-rose-500/40 text-xs text-rose-200 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span className="break-words min-w-0">
              {captureActionError || captureTelemetry.lastError}
            </span>
          </div>
        )}

        {captureActionMsg && (
          <div className="p-3 rounded-xl bg-blue-950/30 border border-blue-500/35 text-xs text-blue-100 flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <span className="break-words min-w-0">{captureActionMsg}</span>
          </div>
        )}

        {/* Companion App Pairing Credentials Box */}
        {sessionInfo && (
          <div className="bg-[#0E131B] border border-[#232B3A] rounded-xl p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-slate-200">
                Android Companion App Session Credentials (No Facebook Keys Included)
              </div>
              <a
                href={sessionInfo.deepLinkUrl}
                className="min-h-[38px] px-3 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-300 text-xs font-medium inline-flex items-center gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Launch Companion App</span>
              </a>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-xs">
              <div className="bg-[#080B10] border border-[#232B3A] rounded-lg px-3 py-2 flex items-center justify-between gap-2 min-w-0">
                <div className="min-w-0">
                  <div className="text-[10px] text-slate-400">Backend URL</div>
                  <div className="font-mono text-slate-200 truncate">{backendHttpUrl}</div>
                </div>
                <button
                  type="button"
                  onClick={() => copyValue('backend', backendHttpUrl)}
                  aria-label="Copy Backend URL"
                  className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-md text-slate-400 hover:text-slate-100 hover:bg-[#171E2B]"
                >
                  {copiedKey === 'backend' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>

              <div className="bg-[#080B10] border border-[#232B3A] rounded-lg px-3 py-2 flex items-center justify-between gap-2 min-w-0">
                <div className="min-w-0">
                  <div className="text-[10px] text-slate-400">Session ID</div>
                  <div className="font-mono text-slate-200 truncate">{sessionInfo.sessionId}</div>
                </div>
                <button
                  type="button"
                  onClick={() => copyValue('session', sessionInfo.sessionId)}
                  aria-label="Copy Session ID"
                  className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-md text-slate-400 hover:text-slate-100 hover:bg-[#171E2B]"
                >
                  {copiedKey === 'session' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>

              <div className="bg-[#080B10] border border-[#232B3A] rounded-lg px-3 py-2 flex items-center justify-between gap-2 min-w-0">
                <div className="min-w-0">
                  <div className="text-[10px] text-slate-400">Ephemeral Ingest Token</div>
                  <div className="font-mono text-slate-200 truncate">{sessionInfo.ingestToken}</div>
                </div>
                <button
                  type="button"
                  onClick={() => copyValue('token', sessionInfo.ingestToken)}
                  aria-label="Copy Ingest Token"
                  className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-md text-slate-400 hover:text-slate-100 hover:bg-[#171E2B]"
                >
                  {copiedKey === 'token' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* MONITOR A (YouTube Preview) + MONITOR B (Live Android Capture Program Output) */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start min-w-0">
        <YouTubeMonitorCard
          youtubeResult={youtubeResult}
          onYouTubeValidated={onYouTubeValidated}
          showComplianceNote={false}
        />

        <section className="bg-[#121721] border border-[#232B3A] rounded-2xl p-3 sm:p-4 space-y-3 min-w-0 flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-emerald-400 shrink-0" />
                <h3 className="text-sm sm:text-base font-semibold text-slate-100 truncate">
                  Monitor B · Program Output (Live Android Capture)
                </h3>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-400 truncate">
                Real-time captured video + permitted playback audio + composited overlays
              </p>
            </div>
            <label className="min-h-[44px] flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none px-1 shrink-0">
              <input
                type="checkbox"
                checked={showOverlayPreview}
                onChange={(e) => setShowOverlayPreview(e.target.checked)}
                className="w-4 h-4 rounded border-[#2E384B] bg-[#0B0E14] text-blue-600 focus:ring-blue-500"
              />
              <span>Overlays</span>
            </label>
          </div>

          <VideoPreviewStage
            sourceType="android-capture"
            selectedVideo={null}
            directUrl=""
            captureTelemetry={captureTelemetry}
            overlays={overlays}
            streamStatus={telemetry.status}
            showOverlays={showOverlayPreview}
          />

          {captureTelemetry.audioStatus === 'AUDIO_NOT_AVAILABLE' && (
            <div className="p-2.5 rounded-xl bg-amber-950/30 border border-amber-500/35 text-[11px] text-amber-200 leading-relaxed">
              Audio Playback Capture unavailable on Android for the active playback surface (or denied by media policy). FFmpeg automatically injects a synchronized silent stereo AAC track so Facebook Live audio remains compliant.
            </div>
          )}
        </section>
      </div>

      {/* FACEBOOK OUTPUT LIVE CONTROLS + ENGINE LOGS */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start min-w-0">
        <section className="xl:col-span-5 bg-[#121721] border border-[#232B3A] rounded-2xl p-4 sm:p-5 space-y-4 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-slate-100">Facebook Live Output</h3>
            <button
              type="button"
              onClick={() => onNavigate('facebook')}
              className="text-xs font-medium text-blue-400 hover:text-blue-300"
            >
              RTMP Settings
            </button>
          </div>

          <div className="bg-[#0E131B] border border-[#232B3A] rounded-xl p-3 space-y-1 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-400">Target Stream Key</span>
              <span className={`font-mono ${rtmpConfig.hasStreamKey ? 'text-emerald-400' : 'text-amber-300'}`}>
                {rtmpConfig.hasStreamKey ? rtmpConfig.maskedStreamKey : 'Not Configured'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-400">Ingest Bitrate · Frames</span>
              <span className="font-mono tabular-nums text-slate-200">
                {captureTelemetry.bitrateKbps} kbps · {captureTelemetry.framesReceived} frames
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-400">Facebook Output</span>
              <span className="font-mono tabular-nums text-slate-200">
                {telemetry.status} · {formatDuration(telemetry.durationSec)} · {telemetry.bitrateKbps} kbps
              </span>
            </div>
          </div>

          {streamError && (
            <div className="p-3 rounded-xl bg-rose-950/35 border border-rose-500/40 text-xs text-rose-200 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span className="break-words min-w-0">{streamError}</span>
            </div>
          )}

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
              disabled={isStreamingOrConnecting || streamBusyAction !== null || !isCaptureReadyForStream}
              className="min-h-[48px] px-3 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/35 disabled:text-slate-300 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all whitespace-nowrap"
            >
              <Play className="w-4 h-4 shrink-0" />
              <span>{streamBusyAction === 'starting' ? 'STARTING...' : 'START LIVE'}</span>
            </button>
            <button
              type="button"
              onClick={handleStopLive}
              disabled={!isStreamingOrConnecting || streamBusyAction !== null}
              className="min-h-[48px] px-3 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:bg-[#1B2230] disabled:text-slate-500 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all whitespace-nowrap"
            >
              <Square className="w-4 h-4 shrink-0" />
              <span>{streamBusyAction === 'stopping' ? 'STOPPING...' : 'STOP LIVE'}</span>
            </button>
          </div>

          <button
            type="button"
            onClick={handleValidatePipeline}
            disabled={pipelineChecking || isStreamingOrConnecting || !isCaptureReadyForStream}
            className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#2A3447] bg-[#181F2C] hover:bg-[#1F293B] text-slate-200 text-xs font-medium flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Wrench className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <span>{pipelineChecking ? 'Testing 2s Piped Encode...' : 'Verify Capture FFmpeg Pipeline'}</span>
          </button>

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
            </div>
          )}
        </section>

        <section className="xl:col-span-7 bg-[#121721] border border-[#232B3A] rounded-2xl p-4 sm:p-5 space-y-3 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-slate-100">FFmpeg &amp; RTMPS Broadcast Logs</h3>
            <span className="text-xs font-mono text-slate-400 tabular-nums">
              {logs.length} events · Key redacted
            </span>
          </div>
          <div className="bg-[#080A0F] border border-[#232B3A] rounded-xl p-3 h-64 overflow-y-auto overflow-x-hidden font-mono text-xs space-y-1">
            {logs.length === 0 ? (
              <div className="text-slate-500 py-8 text-center">
                Waiting for broadcast engine events...
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
