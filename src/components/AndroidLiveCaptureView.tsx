import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  CircleDot,
  Download,
  MonitorSmartphone,
  Pause,
  Play,
  Radio,
  RefreshCw,
  ShieldCheck,
  Square,
  Trash2,
  Upload,
  Wrench,
} from 'lucide-react';
import type {
  AndroidCaptureTelemetry,
  DestinationMode,
  OverlayConfig,
  PipelineCheckResult,
  RtmpPublicConfig,
  StreamLogEntry,
  StreamQualityProfile,
  StreamTelemetry,
  YouTubeValidationResult,
} from '../../shared/types';
import { api, formatBytes, formatDuration } from '../lib/api';
import type { InAppLiveCaptureState } from '../lib/useInAppLiveCapture';
import type { NavSection } from './Sidebar';
import { VideoPreviewStage, type ProgramMonitorSource } from './VideoPreviewStage';
import { YouTubeMonitorCard } from './YouTubeMonitorCard';

interface RecordedClipItem {
  id: string;
  name: string;
  blob: Blob;
  url: string;
  mimeType: string;
  sizeBytes: number;
  durationSec: number;
  resolution: string;
  fps: number;
  createdAt: string;
  uploadedToStudio: boolean;
}

interface AndroidLiveCaptureViewProps {
  inAppCapture: InAppLiveCaptureState;
  captureTelemetry: AndroidCaptureTelemetry;
  telemetry: StreamTelemetry;
  logs: StreamLogEntry[];
  overlays: OverlayConfig;
  rtmpConfig: RtmpPublicConfig;
  youtubeRtmpConfig: RtmpPublicConfig;
  destinationMode: DestinationMode;
  onChangeDestinationMode: (mode: DestinationMode) => void;
  youtubeResult: YouTubeValidationResult | null;
  onYouTubeValidated: (res: YouTubeValidationResult | null) => void;
  quality: StreamQualityProfile;
  onChangeQuality: (q: StreamQualityProfile) => void;
  onTelemetryUpdated: (next: StreamTelemetry) => void;
  onChangeSourceType: (type: ProgramMonitorSource) => void;
  onNavigate: (section: NavSection) => void;
}

export function AndroidLiveCaptureView({
  inAppCapture,
  captureTelemetry,
  telemetry,
  logs,
  overlays,
  rtmpConfig,
  youtubeRtmpConfig,
  destinationMode,
  onChangeDestinationMode,
  youtubeResult,
  onYouTubeValidated,
  quality,
  onChangeQuality,
  onTelemetryUpdated,
  onChangeSourceType,
  onNavigate,
}: AndroidLiveCaptureViewProps) {
  const [showOverlayPreview, setShowOverlayPreview] = useState(true);
  const [streamBusyAction, setStreamBusyAction] = useState<'starting' | 'stopping' | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [pipelineChecking, setPipelineChecking] = useState(false);
  const [pipelineResult, setPipelineResult] = useState<PipelineCheckResult | null>(null);

  // Built-in Screen Recording Deck State
  const [recState, setRecState] = useState<'IDLE' | 'RECORDING' | 'PAUSED' | 'SAVED'>('IDLE');
  const [recResolution, setRecResolution] = useState<'720p' | '1080p'>('720p');
  const [recFps, setRecFps] = useState<24 | 30 | 60>(30);
  const [recDurationSec, setRecDurationSec] = useState(0);
  const [recError, setRecError] = useState<string | null>(null);
  const [recClips, setRecClips] = useState<RecordedClipItem[]>([]);
  const [activePlaybackClipId, setActivePlaybackClipId] = useState<string | null>(null);
  const [confirmDeleteClipId, setConfirmDeleteClipId] = useState<string | null>(null);
  const [uploadingClipId, setUploadingClipId] = useState<string | null>(null);

  const localRecorderRef = useRef<MediaRecorder | null>(null);
  const localChunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<number | null>(null);
  const recElapsedSecRef = useRef(0);

  useEffect(() => {
    return () => {
      if (recTimerRef.current !== null) {
        window.clearInterval(recTimerRef.current);
      }
      if (localRecorderRef.current && localRecorderRef.current.state !== 'inactive') {
        try {
          localRecorderRef.current.stop();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  const isLiveCaptureActive =
    Boolean(inAppCapture.captureStream) ||
    (captureTelemetry.status === 'Capturing' && captureTelemetry.framesReceived > 0);
  const isCaptureReadyForStream =
    captureTelemetry.width > 0 &&
    (captureTelemetry.status === 'Capturing' || captureTelemetry.status === 'Reconnecting');
  const isStreamingOrConnecting = telemetry.status === 'Live' || telemetry.status === 'Connecting';

  const audioStatusLabel =
    captureTelemetry.audioStatus === 'AUDIO_CAPTURED'
      ? 'AUDIO CAPTURED'
      : captureTelemetry.audioStatus === 'AUDIO_NOT_AVAILABLE'
        ? 'SILENT AAC FALLBACK'
        : 'IDLE';

  const ytPreviewUrl = youtubeResult?.valid ? youtubeResult.watchUrl || null : null;

  // Screen Recording Deck Handlers
  const startRecTimer = () => {
    if (recTimerRef.current !== null) window.clearInterval(recTimerRef.current);
    recTimerRef.current = window.setInterval(() => {
      recElapsedSecRef.current += 1;
      setRecDurationSec(recElapsedSecRef.current);
    }, 1000);
  };

  const pauseRecTimer = () => {
    if (recTimerRef.current !== null) {
      window.clearInterval(recTimerRef.current);
      recTimerRef.current = null;
    }
  };

  const handleStartRecording = async () => {
    setRecError(null);
    let streamToRecord = inAppCapture.captureStream;

    if (!streamToRecord) {
      if (inAppCapture.hasGetDisplayMedia) {
        await inAppCapture.startScreenLiveCapture(ytPreviewUrl);
      } else if (inAppCapture.hasGetUserMedia) {
        await inAppCapture.startCameraLiveCapture(inAppCapture.cameraFacing, ytPreviewUrl);
      } else {
        setRecError('Capture APIs require HTTPS in a modern browser.');
        return;
      }
    }

    // Read current active stream from inAppCapture or prompt if still null
    streamToRecord = inAppCapture.captureStream;
    if (!streamToRecord) {
      setRecError(
        'Start Screen Capture or Camera + Mic Capture above first, then click START RECORDING.',
      );
      return;
    }

    if (typeof MediaRecorder === 'undefined') {
      setRecError('MediaRecorder API is unavailable in this browser.');
      return;
    }

    const mimeCandidates = [
      'video/webm;codecs=h264,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4',
    ];
    const chosenMime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || '';

    try {
      localChunksRef.current = [];
      recElapsedSecRef.current = 0;
      setRecDurationSec(0);

      const bitrate = recResolution === '1080p' ? 5_000_000 : 3_000_000;
      const options: MediaRecorderOptions = {
        videoBitsPerSecond: bitrate,
        audioBitsPerSecond: 128_000,
      };
      if (chosenMime) options.mimeType = chosenMime;

      const recorder = new MediaRecorder(streamToRecord, options);
      localRecorderRef.current = recorder;

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          localChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = () => {
        pauseRecTimer();
        const chunks = localChunksRef.current;
        if (chunks.length === 0) {
          setRecState('IDLE');
          return;
        }
        const mime = recorder.mimeType || 'video/webm';
        const ext = mime.includes('mp4') ? 'mp4' : 'webm';
        const blob = new Blob(chunks, { type: mime });
        const url = URL.createObjectURL(blob);
        const clip: RecordedClipItem = {
          id: `rec_${Date.now()}`,
          name: `monitor_a_${recResolution}_${recFps}fps_${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`,
          blob,
          url,
          mimeType: mime,
          sizeBytes: blob.size,
          durationSec: Math.max(1, recElapsedSecRef.current),
          resolution: recResolution === '1080p' ? '1920x1080' : '1280x720',
          fps: recFps,
          createdAt: new Date().toLocaleTimeString(),
          uploadedToStudio: false,
        };
        setRecClips((prev) => [clip, ...prev]);
        setActivePlaybackClipId(clip.id);
        setRecState('SAVED');
      };

      recorder.start(500);
      setRecState('RECORDING');
      startRecTimer();
    } catch (err) {
      setRecError(err instanceof Error ? err.message : 'Failed to start screen recording.');
    }
  };

  const handlePauseRecording = () => {
    const rec = localRecorderRef.current;
    if (rec && rec.state === 'recording') {
      try {
        rec.pause();
        pauseRecTimer();
        setRecState('PAUSED');
      } catch (err) {
        setRecError(err instanceof Error ? err.message : 'Unable to pause recording.');
      }
    }
  };

  const handleResumeRecording = () => {
    const rec = localRecorderRef.current;
    if (rec && rec.state === 'paused') {
      try {
        rec.resume();
        startRecTimer();
        setRecState('RECORDING');
      } catch (err) {
        setRecError(err instanceof Error ? err.message : 'Unable to resume recording.');
      }
    }
  };

  const handleStopRecording = () => {
    const rec = localRecorderRef.current;
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop();
      } catch (err) {
        setRecError(err instanceof Error ? err.message : 'Unable to stop recording.');
      }
    }
  };

  const handleUploadRecordedClipToStudio = async (clip: RecordedClipItem) => {
    setUploadingClipId(clip.id);
    setRecError(null);
    try {
      const file = new File([clip.blob], clip.name, { type: clip.mimeType });
      await api.uploadVideo(file);
      setRecClips((prev) =>
        prev.map((c) => (c.id === clip.id ? { ...c, uploadedToStudio: true } : c)),
      );
      onChangeSourceType('uploaded');
    } catch (err) {
      setRecError(err instanceof Error ? err.message : 'Failed to upload recorded video to studio.');
    } finally {
      setUploadingClipId(null);
    }
  };

  const handleDeleteClipConfirmed = (clipId: string) => {
    setRecClips((prev) => {
      const target = prev.find((c) => c.id === clipId);
      if (target) {
        URL.revokeObjectURL(target.url);
      }
      return prev.filter((c) => c.id !== clipId);
    });
    if (activePlaybackClipId === clipId) {
      setActivePlaybackClipId(null);
    }
    setConfirmDeleteClipId(null);
  };

  const handleStartLive = async () => {
    setStreamError(null);
    setPipelineResult(null);
    if (!isCaptureReadyForStream) {
      setStreamError(
        'Start Screen/Tab Capture or Camera + Mic Capture above and wait for incoming frames before starting the live broadcast.',
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
        destinationMode,
      });
      onTelemetryUpdated(res.telemetry);
    } catch (err) {
      setStreamError(err instanceof Error ? err.message : 'Failed to start live broadcast.');
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
      setStreamError(err instanceof Error ? err.message : 'Failed to stop live broadcast.');
    } finally {
      setStreamBusyAction(null);
    }
  };

  const handleValidatePipeline = async () => {
    setStreamError(null);
    setPipelineResult(null);
    if (!isCaptureReadyForStream) {
      setStreamError('Start In-App Live Capture first so live H.264/WebM frames are arriving.');
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

  const activePlaybackClip = recClips.find((c) => c.id === activePlaybackClipId) ?? null;

  return (
    <div className="space-y-5 min-w-0">
      {/* Unified In-App Screen / Camera Capture Bar */}
      <section className="bg-[#121721] border border-[#232B3A] rounded-2xl p-4 sm:p-5 space-y-4 min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <MonitorSmartphone className="w-4 h-4 text-blue-400 shrink-0" />
              <h2 className="text-base sm:text-lg font-semibold text-slate-100">
                IN-APP LIVE CAPTURE &amp; SCREEN RECORDER
              </h2>
              {isLiveCaptureActive && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-emerald-600 text-white text-[11px] font-mono font-semibold tracking-wider">
                  <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                  <span>CAPTURING LIVE</span>
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 leading-relaxed max-w-3xl">
              Capture screen/tab or live camera + microphone directly inside LIVECAST STUDIO via authenticated WebSocket into Monitor B, local MP4/WebM recorder, and FFmpeg RTMPS — no separate recording app needed.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono text-emerald-300 shrink-0">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>Stream Keys Server-Encrypted</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          <button
            type="button"
            disabled={inAppCapture.captureBusy || !inAppCapture.hasGetDisplayMedia}
            onClick={() => void inAppCapture.startScreenLiveCapture(ytPreviewUrl)}
            className="min-h-[48px] px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-[0.98] disabled:bg-[#1B2230] disabled:text-slate-500 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all whitespace-nowrap"
          >
            <MonitorSmartphone className="w-4 h-4 shrink-0" />
            <span>
              {inAppCapture.captureBusy
                ? 'STARTING...'
                : inAppCapture.captureMode === 'screen'
                  ? 'RESTART SCREEN CAPTURE'
                  : 'START SCREEN CAPTURE'}
            </span>
          </button>

          <button
            type="button"
            disabled={inAppCapture.captureBusy || !inAppCapture.hasGetUserMedia}
            onClick={() =>
              void inAppCapture.startCameraLiveCapture(inAppCapture.cameraFacing, ytPreviewUrl)
            }
            className="min-h-[48px] px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] disabled:bg-[#1B2230] disabled:text-slate-500 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all whitespace-nowrap"
          >
            <Camera className="w-4 h-4 shrink-0" />
            <span>
              {inAppCapture.captureMode === 'camera'
                ? 'RESTART CAMERA + MIC'
                : 'START CAMERA + MIC'}
            </span>
          </button>

          <button
            type="button"
            disabled={inAppCapture.captureBusy || !inAppCapture.hasGetUserMedia}
            onClick={() => {
              const next = inAppCapture.cameraFacing === 'environment' ? 'user' : 'environment';
              inAppCapture.setCameraFacing(next);
              if (inAppCapture.captureMode === 'camera') {
                void inAppCapture.startCameraLiveCapture(next, ytPreviewUrl);
              }
            }}
            className="min-h-[48px] px-4 py-2.5 rounded-xl bg-[#181F2C] hover:bg-[#222C3E] border border-[#2C374C] disabled:opacity-40 text-slate-200 text-xs font-semibold flex items-center justify-center gap-2 whitespace-nowrap"
          >
            <RefreshCw className="w-3.5 h-3.5 shrink-0" />
            <span>
              Lens: {inAppCapture.cameraFacing === 'environment' ? 'Rear Camera' : 'Front Camera'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => void inAppCapture.stopInAppCapture()}
            disabled={!isLiveCaptureActive && !isCaptureReadyForStream}
            className="min-h-[48px] px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 active:scale-[0.98] disabled:bg-[#1B2230] disabled:text-slate-500 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all whitespace-nowrap"
          >
            <Square className="w-4 h-4 shrink-0" />
            <span>STOP CAPTURE</span>
          </button>
        </div>

        {/* Real Telemetry Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
          <div className="bg-[#0E131B] border border-[#232B3A] rounded-xl px-3 py-2.5 min-w-0">
            <div className="text-[10px] font-medium text-slate-400">VIDEO STATUS</div>
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
            <div className="text-[10px] font-medium text-slate-400">AUDIO STATUS</div>
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
            <div className="text-[10px] font-medium text-slate-400">INGEST SOCKET</div>
            <div
              className={`text-xs sm:text-sm font-mono font-semibold mt-0.5 truncate ${
                captureTelemetry.status === 'Capturing'
                  ? 'text-emerald-400'
                  : captureTelemetry.status === 'Reconnecting' ||
                      captureTelemetry.status === 'WaitingForApp'
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
            <div className="text-[10px] font-medium text-slate-400">RESOLUTION</div>
            <div className="text-xs sm:text-sm font-mono font-semibold tabular-nums text-slate-100 mt-0.5 truncate">
              {captureTelemetry.width > 0 && captureTelemetry.height > 0
                ? `${captureTelemetry.width}x${captureTelemetry.height}`
                : 'Not Active'}
            </div>
          </div>

          <div className="bg-[#0E131B] border border-[#232B3A] rounded-xl px-3 py-2.5 min-w-0">
            <div className="text-[10px] font-medium text-slate-400">AUDIO RATE</div>
            <div className="text-xs sm:text-sm font-mono font-semibold tabular-nums text-slate-100 mt-0.5 truncate">
              {captureTelemetry.audioSampleRate > 0
                ? `${captureTelemetry.audioSampleRate} Hz`
                : 'Not Available'}
            </div>
          </div>

          <div className="bg-[#0E131B] border border-[#232B3A] rounded-xl px-3 py-2.5 min-w-0">
            <div className="text-[10px] font-medium text-slate-400">INGEST LATENCY</div>
            <div className="text-xs sm:text-sm font-mono font-semibold tabular-nums text-slate-100 mt-0.5 truncate">
              {captureTelemetry.latencyMs > 0 ? `${captureTelemetry.latencyMs} ms` : '0 ms'}
            </div>
          </div>
        </div>

        {(inAppCapture.captureError || captureTelemetry.lastError) && (
          <div className="p-3 rounded-xl bg-rose-950/35 border border-rose-500/40 text-xs text-rose-200 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span className="break-words min-w-0">
              {inAppCapture.captureError || captureTelemetry.lastError}
            </span>
          </div>
        )}

        {inAppCapture.captureMessage && (
          <div className="p-3 rounded-xl bg-blue-950/30 border border-blue-500/35 text-xs text-blue-100 flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <span className="break-words min-w-0">{inAppCapture.captureMessage}</span>
          </div>
        )}
      </section>

      {/* MONITOR A (YouTube Preview) + MONITOR B (Live Program Output) */}
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
                  Monitor B · Program Output (Live Capture)
                </h3>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-400 truncate">
                Real-time captured video + audio + composited overlays
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
            captureStream={inAppCapture.captureStream}
            captureTelemetry={captureTelemetry}
            overlays={overlays}
            streamStatus={telemetry.status}
            showOverlays={showOverlayPreview}
          />
        </section>
      </div>

      {/* DEDICATED SCREEN RECORDING DECK */}
      <section className="bg-[#121721] border border-[#232B3A] rounded-2xl p-4 sm:p-5 space-y-4 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <CircleDot
              className={`w-4 h-4 shrink-0 ${
                recState === 'RECORDING'
                  ? 'text-red-400 animate-pulse'
                  : recState === 'PAUSED'
                    ? 'text-amber-400'
                    : 'text-cyan-400'
              }`}
            />
            <h3 className="text-base font-semibold text-slate-100">
              Monitor A Screen Recording Studio
            </h3>
            <span
              className={`px-2 py-0.5 rounded text-[11px] font-mono font-semibold ${
                recState === 'RECORDING'
                  ? 'bg-red-600 text-white'
                  : recState === 'PAUSED'
                    ? 'bg-amber-600 text-white'
                    : recState === 'SAVED'
                      ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40'
                      : 'bg-[#181F2C] text-slate-300'
              }`}
            >
              {recState}
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs font-mono tabular-nums">
            <span className="text-slate-400">Timer:</span>
            <span className="text-sm font-semibold text-slate-100">
              {formatDuration(recDurationSec)}
            </span>
          </div>
        </div>

        {/* Resolution + FPS selectors */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex items-center justify-between gap-2 bg-[#0E131B] border border-[#232B3A] rounded-xl px-3 py-2">
            <span className="text-xs font-medium text-slate-300">Recording Resolution</span>
            <div className="flex items-center gap-1.5">
              {(['720p', '1080p'] as const).map((res) => (
                <button
                  key={res}
                  type="button"
                  disabled={recState === 'RECORDING' || recState === 'PAUSED'}
                  onClick={() => setRecResolution(res)}
                  className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-mono font-semibold transition-colors disabled:opacity-50 ${
                    recResolution === res
                      ? 'bg-blue-600 text-white'
                      : 'bg-[#181F2C] text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {res}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 bg-[#0E131B] border border-[#232B3A] rounded-xl px-3 py-2">
            <span className="text-xs font-medium text-slate-300">Target Frame Rate</span>
            <div className="flex items-center gap-1.5">
              {([24, 30, 60] as const).map((fpsOpt) => (
                <button
                  key={fpsOpt}
                  type="button"
                  disabled={recState === 'RECORDING' || recState === 'PAUSED'}
                  onClick={() => setRecFps(fpsOpt)}
                  className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-mono font-semibold transition-colors disabled:opacity-50 ${
                    recFps === fpsOpt
                      ? 'bg-blue-600 text-white'
                      : 'bg-[#181F2C] text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {fpsOpt} FPS
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* START / PAUSE / RESUME / STOP Recording Buttons */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <button
            type="button"
            disabled={recState === 'RECORDING' || recState === 'PAUSED'}
            onClick={() => void handleStartRecording()}
            className="min-h-[44px] px-3 py-2 rounded-xl bg-red-600 hover:bg-red-500 disabled:bg-[#1B2230] disabled:text-slate-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
          >
            <CircleDot className="w-4 h-4 shrink-0" />
            <span>START RECORDING</span>
          </button>

          <button
            type="button"
            disabled={recState !== 'RECORDING'}
            onClick={handlePauseRecording}
            className="min-h-[44px] px-3 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:bg-[#1B2230] disabled:text-slate-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
          >
            <Pause className="w-4 h-4 shrink-0" />
            <span>PAUSE RECORDING</span>
          </button>

          <button
            type="button"
            disabled={recState !== 'PAUSED'}
            onClick={handleResumeRecording}
            className="min-h-[44px] px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-[#1B2230] disabled:text-slate-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
          >
            <Play className="w-4 h-4 shrink-0" />
            <span>RESUME RECORDING</span>
          </button>

          <button
            type="button"
            disabled={recState !== 'RECORDING' && recState !== 'PAUSED'}
            onClick={handleStopRecording}
            className="min-h-[44px] px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 disabled:bg-[#1B2230] disabled:text-slate-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
          >
            <Square className="w-4 h-4 shrink-0" />
            <span>STOP RECORDING</span>
          </button>
        </div>

        {recError && (
          <div className="p-3 rounded-xl bg-rose-950/35 border border-rose-500/40 text-xs text-rose-200 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span className="break-words min-w-0">{recError}</span>
          </div>
        )}

        {/* Saved Recordings Playback & Management */}
        {recClips.length > 0 && (
          <div className="space-y-3 pt-2 border-t border-[#232B3A]">
            <div className="text-xs font-semibold text-slate-200">
              Saved Recordings ({recClips.length})
            </div>

            {activePlaybackClip && (
              <div className="bg-[#0B0E14] border border-[#232B3A] rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-mono text-slate-200 truncate">
                    Playing: {activePlaybackClip.name}
                  </span>
                  <span className="font-mono text-slate-400 shrink-0">
                    {activePlaybackClip.resolution} · {activePlaybackClip.fps}fps
                  </span>
                </div>
                <video
                  key={activePlaybackClip.url}
                  src={activePlaybackClip.url}
                  controls
                  className="w-full max-h-72 rounded-lg bg-black"
                />
              </div>
            )}

            <div className="divide-y divide-[#232B3A] border border-[#232B3A] rounded-xl bg-[#0E131B] overflow-hidden">
              {recClips.map((clip) => (
                <div
                  key={clip.id}
                  className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-mono font-semibold text-slate-100 truncate">
                      {clip.name}
                    </div>
                    <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                      {clip.resolution} · {clip.fps} FPS · {formatDuration(clip.durationSec)} ·{' '}
                      {formatBytes(clip.sizeBytes)} · {clip.createdAt}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setActivePlaybackClipId(clip.id)}
                      className="min-h-[36px] px-3 py-1.5 rounded-lg bg-[#181F2C] hover:bg-[#222C3E] border border-[#2C374C] text-xs font-medium text-slate-200 flex items-center gap-1.5"
                    >
                      <Play className="w-3.5 h-3.5 text-blue-400" />
                      <span>Play</span>
                    </button>

                    <a
                      href={clip.url}
                      download={clip.name}
                      className="min-h-[36px] px-3 py-1.5 rounded-lg bg-[#181F2C] hover:bg-[#222C3E] border border-[#2C374C] text-xs font-medium text-slate-200 flex items-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Save File</span>
                    </a>

                    <button
                      type="button"
                      disabled={uploadingClipId === clip.id || clip.uploadedToStudio}
                      onClick={() => void handleUploadRecordedClipToStudio(clip)}
                      className="min-h-[36px] px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-semibold text-white flex items-center gap-1.5"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>
                        {clip.uploadedToStudio
                          ? 'In Studio Library'
                          : uploadingClipId === clip.id
                            ? 'Uploading...'
                            : 'Use in Studio'}
                      </span>
                    </button>

                    {confirmDeleteClipId === clip.id ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleDeleteClipConfirmed(clip.id)}
                          className="min-h-[36px] px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold"
                        >
                          Confirm Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteClipId(null)}
                          className="min-h-[36px] px-2.5 py-1 rounded-lg bg-[#181F2C] text-slate-300 text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteClipId(clip.id)}
                        className="min-h-[36px] px-2.5 py-1.5 rounded-lg border border-[#2C374C] text-rose-300 hover:bg-rose-950/30 text-xs flex items-center gap-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* OUTPUT LIVE CONTROLS + ENGINE LOGS */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start min-w-0">
        <section className="xl:col-span-5 bg-[#121721] border border-[#232B3A] rounded-2xl p-4 sm:p-5 space-y-4 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-slate-100">Broadcast Output Control</h3>
            <button
              type="button"
              onClick={() => onNavigate('facebook')}
              className="text-xs font-medium text-blue-400 hover:text-blue-300"
            >
              RTMP Settings
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {(['facebook', 'youtube', 'both'] as DestinationMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                disabled={isStreamingOrConnecting}
                onClick={() => onChangeDestinationMode(mode)}
                className={`min-h-[42px] px-2.5 py-2 rounded-xl border text-xs font-semibold transition-colors disabled:opacity-50 ${
                  destinationMode === mode
                    ? 'bg-blue-600/20 border-blue-500 text-slate-100'
                    : 'bg-[#0E131B] border-[#232B3A] text-slate-400 hover:text-slate-200'
                }`}
              >
                {mode === 'facebook' ? 'Facebook' : mode === 'youtube' ? 'YouTube' : 'Both'}
              </button>
            ))}
          </div>

          <div className="bg-[#0E131B] border border-[#232B3A] rounded-xl p-3 space-y-1 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-400">Facebook Key</span>
              <span
                className={`font-mono ${
                  rtmpConfig.hasStreamKey ? 'text-emerald-400' : 'text-amber-300'
                }`}
              >
                {rtmpConfig.hasStreamKey ? rtmpConfig.maskedStreamKey : 'Not Configured'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-400">YouTube Key</span>
              <span
                className={`font-mono ${
                  youtubeRtmpConfig.hasStreamKey ? 'text-emerald-400' : 'text-slate-400'
                }`}
              >
                {youtubeRtmpConfig.hasStreamKey
                  ? youtubeRtmpConfig.maskedStreamKey
                  : 'Not Configured'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-400">Master Output</span>
              <span className="font-mono tabular-nums text-slate-200">
                {telemetry.status} · {formatDuration(telemetry.durationSec)} ·{' '}
                {telemetry.bitrateKbps} kbps
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
              disabled={
                isStreamingOrConnecting || streamBusyAction !== null || !isCaptureReadyForStream
              }
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
            <span>
              {pipelineChecking
                ? 'Testing 2s Piped Encode...'
                : 'Verify Capture FFmpeg Pipeline'}
            </span>
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
            <h3 className="text-base font-semibold text-slate-100">
              FFmpeg &amp; RTMPS Broadcast Logs
            </h3>
            <span className="text-xs font-mono text-slate-400 tabular-nums">
              {logs.length} events · Keys redacted
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
