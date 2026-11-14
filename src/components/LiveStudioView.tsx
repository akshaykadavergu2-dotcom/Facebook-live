import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Eye,
  EyeOff,
  FileVideo,
  Globe,
  MonitorSmartphone,
  Play,
  RefreshCw,
  Square,
  Trash2,
  Upload,
  Video,
  Wrench,
  Youtube,
} from 'lucide-react';
import type {
  OverlayConfig,
  PipelineCheckResult,
  RtmpPublicConfig,
  StreamLogEntry,
  StreamQualityProfile,
  StreamTelemetry,
  VideoAsset,
  VideoSourceType,
  YouTubeValidationResult,
} from '../../shared/types';
import { api, formatBytes, formatDuration } from '../lib/api';
import type { NavSection } from './Sidebar';
import { VideoPreviewStage, type ProgramMonitorSource } from './VideoPreviewStage';

interface LiveStudioViewProps {
  telemetry: StreamTelemetry;
  logs: StreamLogEntry[];
  videos: VideoAsset[];
  overlays: OverlayConfig;
  rtmpConfig: RtmpPublicConfig;
  sourceType: ProgramMonitorSource;
  onChangeSourceType: (type: ProgramMonitorSource) => void;
  selectedVideoId: string | null;
  onSelectVideoId: (id: string | null) => void;
  directUrl: string;
  onChangeDirectUrl: (url: string) => void;
  youtubeResult: YouTubeValidationResult | null;
  onYouTubeValidated: (res: YouTubeValidationResult | null) => void;
  quality: StreamQualityProfile;
  onChangeQuality: (q: StreamQualityProfile) => void;
  loopVideo: boolean;
  onChangeLoopVideo: (loop: boolean) => void;
  onVideosUpdated: (videos: VideoAsset[]) => void;
  onRtmpUpdated: (config: RtmpPublicConfig) => void;
  onTelemetryUpdated: (telemetry: StreamTelemetry) => void;
  onNavigate: (section: NavSection) => void;
}

export function LiveStudioView({
  telemetry,
  logs,
  videos,
  overlays,
  rtmpConfig,
  sourceType,
  onChangeSourceType,
  selectedVideoId,
  onSelectVideoId,
  directUrl,
  onChangeDirectUrl,
  youtubeResult,
  onYouTubeValidated,
  quality,
  onChangeQuality,
  loopVideo,
  onChangeLoopVideo,
  onVideosUpdated,
  onRtmpUpdated,
  onTelemetryUpdated,
  onNavigate,
}: LiveStudioViewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const captureStreamRef = useRef<MediaStream | null>(null);

  const [showOverlayPreview, setShowOverlayPreview] = useState<boolean>(true);

  const [ytUrlInput, setYtUrlInput] = useState(youtubeResult?.watchUrl || '');
  const [ytLoading, setYtLoading] = useState(false);

  const [directUrlInput, setDirectUrlInput] = useState(directUrl);
  const [directCheckLoading, setDirectCheckLoading] = useState(false);
  const [directCheckMsg, setDirectCheckMsg] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [generatingSample, setGeneratingSample] = useState(false);
  const [deletingVideoId, setDeletingVideoId] = useState<string | null>(null);

  const [captureStream, setCaptureStream] = useState<MediaStream | null>(null);
  const [cameraFacing, setCameraFacing] = useState<'environment' | 'user'>('environment');
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [isRecordingCapture, setIsRecordingCapture] = useState(false);

  const [rtmpServerInput, setRtmpServerInput] = useState(rtmpConfig.serverUrl);
  const [rtmpKeyInput, setRtmpKeyInput] = useState('');
  const [showStreamKey, setShowStreamKey] = useState(false);
  const [savingRtmp, setSavingRtmp] = useState(false);
  const [rtmpFeedback, setRtmpFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [streamBusyAction, setStreamBusyAction] = useState<'starting' | 'stopping' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [pipelineChecking, setPipelineChecking] = useState(false);
  const [pipelineResult, setPipelineResult] = useState<PipelineCheckResult | null>(null);

  useEffect(() => {
    setRtmpServerInput(rtmpConfig.serverUrl);
  }, [rtmpConfig.serverUrl]);

  useEffect(() => {
    captureStreamRef.current = captureStream;
  }, [captureStream]);

  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try {
          recorderRef.current.stop();
        } catch {
          // ignore
        }
      }
      if (captureStreamRef.current) {
        for (const track of captureStreamRef.current.getTracks()) {
          track.stop();
        }
      }
    };
  }, []);

  const hasGetUserMedia =
    typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  const hasGetDisplayMedia =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getDisplayMedia === 'function';
  const hasMediaRecorder = typeof MediaRecorder !== 'undefined';

  const selectedVideo = videos.find((v) => v.id === selectedVideoId) ?? videos[0] ?? null;
  const isStreamingOrConnecting = telemetry.status === 'Live' || telemetry.status === 'Connecting';
  const isRtmpEligibleSource =
    (sourceType === 'uploaded' && Boolean(selectedVideo)) ||
    (sourceType === 'direct-url' && directUrl.trim().length > 0);

  const stopActiveCapture = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try {
        recorderRef.current.stop();
      } catch {
        // ignore
      }
    }
    if (captureStream) {
      for (const track of captureStream.getTracks()) {
        track.stop();
      }
      setCaptureStream(null);
    }
    setIsRecordingCapture(false);
  };

  const handleStartCamera = async (facing: 'environment' | 'user' = cameraFacing) => {
    setCaptureError(null);
    if (!hasGetUserMedia) {
      setCaptureError(
        'Camera and microphone APIs (getUserMedia) are unavailable in this browser context. Ensure HTTPS is active on Android Chrome.',
      );
      return;
    }
    stopActiveCapture();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
      for (const track of stream.getTracks()) {
        track.onended = () => setCaptureStream(null);
      }
      setCaptureStream(stream);
      onChangeSourceType('camera');
    } catch (err) {
      setCaptureError(
        err instanceof Error
          ? `Camera/Microphone permission or device error: ${err.message}`
          : 'Unable to access Android camera and microphone.',
      );
    }
  };

  const handleStartScreenCapture = async () => {
    setCaptureError(null);
    if (!hasGetDisplayMedia) {
      setCaptureError(
        'Screen capture (getDisplayMedia) is not supported by this Android Chrome browser build. Use Camera Capture or upload a recorded MP4/WebM clip.',
      );
      return;
    }
    stopActiveCapture();
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      for (const track of stream.getTracks()) {
        track.onended = () => setCaptureStream(null);
      }
      setCaptureStream(stream);
      onChangeSourceType('screen');
    } catch (err) {
      setCaptureError(
        err instanceof Error
          ? `Screen capture unavailable or cancelled: ${err.message}`
          : 'Screen capture permission denied or unsupported on this Android device.',
      );
    }
  };

  const handleToggleRecordCapture = () => {
    if (!captureStream || !hasMediaRecorder) {
      setCaptureError('Start Camera or Screen preview first before recording a clip.');
      return;
    }

    if (isRecordingCapture && recorderRef.current) {
      recorderRef.current.stop();
      setIsRecordingCapture(false);
      return;
    }

    setCaptureError(null);
    recordedChunksRef.current = [];
    const preferredMime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
      ? 'video/webm;codecs=vp8,opus'
      : MediaRecorder.isTypeSupported('video/webm')
        ? 'video/webm'
        : MediaRecorder.isTypeSupported('video/mp4')
          ? 'video/mp4'
          : '';

    try {
      const recorder = preferredMime
        ? new MediaRecorder(captureStream, { mimeType: preferredMime })
        : new MediaRecorder(captureStream);

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          recordedChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = async () => {
        setIsRecordingCapture(false);
        const chunks = recordedChunksRef.current;
        if (chunks.length === 0) return;
        const mimeType = recorder.mimeType || 'video/webm';
        const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
        const blob = new Blob(chunks, { type: mimeType });
        const file = new File([blob], `android_capture_${Date.now()}.${ext}`, { type: mimeType });
        await handleUploadVideo(file);
      };

      recorder.start(500);
      recorderRef.current = recorder;
      setIsRecordingCapture(true);
    } catch (err) {
      setCaptureError(
        err instanceof Error
          ? `MediaRecorder error on this browser: ${err.message}`
          : 'Unable to record live capture on this browser.',
      );
    }
  };

  const handleUploadVideo = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setActionError(null);
    try {
      const res = await api.uploadVideo(file);
      onVideosUpdated(res.videos);
      onSelectVideoId(res.video.id);
      onChangeSourceType('uploaded');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Video upload failed.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleGenerateSample = async () => {
    setGeneratingSample(true);
    setActionError(null);
    try {
      const res = await api.generateSampleVideo();
      onVideosUpdated(res.videos);
      onSelectVideoId(res.video.id);
      onChangeSourceType('uploaded');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Sample video generation failed.');
    } finally {
      setGeneratingSample(false);
    }
  };

  const handleDeleteVideo = async (id: string) => {
    setDeletingVideoId(id);
    setActionError(null);
    try {
      const res = await api.deleteVideo(id);
      onVideosUpdated(res.videos);
      if (selectedVideoId === id) {
        onSelectVideoId(res.videos[0]?.id ?? null);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to delete video.');
    } finally {
      setDeletingVideoId(null);
    }
  };

  const handleLoadYouTube = async () => {
    setYtLoading(true);
    setActionError(null);
    try {
      const result = await api.validateYouTube(ytUrlInput);
      onYouTubeValidated(result);
      onChangeSourceType('youtube-preview');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'YouTube validation failed.');
    } finally {
      setYtLoading(false);
    }
  };

  const handleValidateDirectUrl = async () => {
    setDirectCheckLoading(true);
    setDirectCheckMsg(null);
    setActionError(null);
    try {
      const res = await api.validateDirectUrl(directUrlInput);
      onChangeDirectUrl(res.url);
      onChangeSourceType('direct-url');
      setDirectCheckMsg(
        `Verified ${res.probe.width}x${res.probe.height} (${res.probe.videoCodec}${res.probe.hasAudio ? ` / ${res.probe.audioCodec}` : ' / no audio'})`,
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Direct media URL validation failed.');
    } finally {
      setDirectCheckLoading(false);
    }
  };

  const handleSaveRtmp = async () => {
    setSavingRtmp(true);
    setRtmpFeedback(null);
    try {
      const updated = await api.saveRtmpConfig(rtmpServerInput, rtmpKeyInput || undefined);
      onRtmpUpdated(updated);
      setRtmpKeyInput('');
      setShowStreamKey(false);
      setRtmpFeedback({
        type: 'ok',
        text: updated.hasStreamKey
          ? `Saved securely on server (${updated.maskedStreamKey}).`
          : 'RTMP Server URL updated. Enter a Stream Key to enable live broadcasting.',
      });
    } catch (err) {
      setRtmpFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to save RTMP settings.',
      });
    } finally {
      setSavingRtmp(false);
    }
  };

  const handleStartLive = async () => {
    setActionError(null);
    setPipelineResult(null);

    if (!isRtmpEligibleSource) {
      setActionError(
        sourceType === 'youtube-preview'
          ? 'YouTube share URLs are preview-only via the official YouTube IFrame Player API and cannot be sent to FFmpeg. Select an uploaded MP4/MOV/WebM file or an authorized direct media URL.'
          : 'Local camera/screen preview cannot stream directly to backend FFmpeg without uploading. Tap Record & Upload Clip or choose an Uploaded Video / Direct Media URL.',
      );
      return;
    }

    const apiSource: VideoSourceType = sourceType === 'direct-url' ? 'direct-url' : 'uploaded';
    setStreamBusyAction('starting');
    try {
      const res = await api.startStream({
        sourceType: apiSource,
        videoId: apiSource === 'uploaded' ? selectedVideo?.id : undefined,
        directUrl: apiSource === 'direct-url' ? directUrl : undefined,
        quality,
        loopVideo,
      });
      onTelemetryUpdated(res.telemetry);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to start live stream.');
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
      setActionError(err instanceof Error ? err.message : 'Failed to stop live stream.');
    } finally {
      setStreamBusyAction(null);
    }
  };

  const handleValidatePipeline = async () => {
    setActionError(null);
    setPipelineResult(null);
    if (!isRtmpEligibleSource) {
      setActionError('Select an uploaded video or authorized direct media URL to test FFmpeg.');
      return;
    }
    const apiSource: VideoSourceType = sourceType === 'direct-url' ? 'direct-url' : 'uploaded';
    setPipelineChecking(true);
    try {
      const res = await api.validatePipeline({
        sourceType: apiSource,
        videoId: apiSource === 'uploaded' ? selectedVideo?.id : undefined,
        directUrl: apiSource === 'direct-url' ? directUrl : undefined,
        quality,
      });
      setPipelineResult(res);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Pipeline verification failed.');
    } finally {
      setPipelineChecking(false);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start min-w-0">
      {/* Program Monitor + Telemetry + Sources */}
      <div className="xl:col-span-8 space-y-5 min-w-0">
        <section className="bg-[#121721] border border-[#232B3A] rounded-2xl p-3 sm:p-4 space-y-3.5 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm sm:text-base font-semibold text-slate-100">Program Monitor</h2>
                {sourceType === 'youtube-preview' && youtubeResult?.valid && (
                  <span className="text-[11px] font-mono text-blue-300">
                    · Preview Only (YouTube)
                  </span>
                )}
              </div>
              <p className="text-[11px] sm:text-xs text-slate-400">
                16:9 canvas with real-time overlay composition
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
            sourceType={sourceType}
            selectedVideo={selectedVideo}
            directUrl={directUrl}
            youtubeResult={youtubeResult}
            captureStream={captureStream}
            overlays={overlays}
            streamStatus={telemetry.status}
            showOverlays={showOverlayPreview}
            loopVideo={loopVideo}
          />

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-2.5">
            <div className="bg-[#0E131B] border border-[#232B3A] rounded-xl px-3 py-2 min-w-0">
              <div className="text-[11px] text-slate-400">Status</div>
              <div
                className={`text-xs sm:text-sm font-semibold mt-0.5 truncate ${
                  telemetry.status === 'Live'
                    ? 'text-red-400'
                    : telemetry.status === 'Connecting'
                      ? 'text-amber-400'
                      : telemetry.status === 'Error'
                        ? 'text-rose-400'
                        : 'text-slate-200'
                }`}
              >
                {telemetry.status}
              </div>
            </div>
            <div className="bg-[#0E131B] border border-[#232B3A] rounded-xl px-3 py-2 min-w-0">
              <div className="text-[11px] text-slate-400">Duration</div>
              <div className="text-xs sm:text-sm font-semibold text-slate-100 font-mono tabular-nums mt-0.5 truncate">
                {formatDuration(telemetry.durationSec)}
              </div>
            </div>
            <div className="bg-[#0E131B] border border-[#232B3A] rounded-xl px-3 py-2 min-w-0">
              <div className="text-[11px] text-slate-400">Resolution</div>
              <div className="text-xs sm:text-sm font-semibold text-slate-100 font-mono tabular-nums mt-0.5 truncate">
                {isStreamingOrConnecting
                  ? telemetry.outputResolution
                  : quality === '1080p'
                    ? '1920x1080'
                    : '1280x720'}
              </div>
            </div>
            <div className="bg-[#0E131B] border border-[#232B3A] rounded-xl px-3 py-2 min-w-0">
              <div className="text-[11px] text-slate-400">Bitrate</div>
              <div className="text-xs sm:text-sm font-semibold text-slate-100 font-mono tabular-nums mt-0.5 truncate">
                {telemetry.bitrateKbps > 0 ? `${telemetry.bitrateKbps} kbps` : '0 kbps'}
              </div>
            </div>
            <div className="bg-[#0E131B] border border-[#232B3A] rounded-xl px-3 py-2 col-span-2 sm:col-span-1 min-w-0">
              <div className="text-[11px] text-slate-400">Output FPS</div>
              <div className="text-xs sm:text-sm font-semibold text-slate-100 font-mono tabular-nums mt-0.5 truncate">
                {telemetry.fps > 0 ? `${telemetry.fps} fps` : '30 target'}
              </div>
            </div>
          </div>
        </section>

        {/* Source Selection Panel */}
        <section className="bg-[#121721] border border-[#232B3A] rounded-2xl p-4 sm:p-5 space-y-4 min-w-0">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-slate-100">Video Sources</h3>
              <button
                type="button"
                onClick={() => onNavigate('youtube')}
                className="text-xs font-medium text-blue-400 hover:text-blue-300 min-h-[36px] px-1"
              >
                Open Full YouTube View
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 bg-[#0B0E14] border border-[#232B3A] rounded-xl">
              <button
                type="button"
                onClick={() => onChangeSourceType('uploaded')}
                className={`min-h-[44px] px-2.5 py-2 text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap ${
                  sourceType === 'uploaded'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <FileVideo className="w-3.5 h-3.5 shrink-0" />
                <span>Uploaded</span>
              </button>
              <button
                type="button"
                onClick={() => onChangeSourceType('direct-url')}
                className={`min-h-[44px] px-2.5 py-2 text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap ${
                  sourceType === 'direct-url'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Globe className="w-3.5 h-3.5 shrink-0" />
                <span>Direct URL</span>
              </button>
              <button
                type="button"
                onClick={() => onChangeSourceType('youtube-preview')}
                className={`min-h-[44px] px-2.5 py-2 text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap ${
                  sourceType === 'youtube-preview'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Youtube className="w-3.5 h-3.5 shrink-0" />
                <span>YouTube</span>
              </button>
              <button
                type="button"
                onClick={() => onChangeSourceType(sourceType === 'screen' ? 'screen' : 'camera')}
                className={`min-h-[44px] px-2.5 py-2 text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap ${
                  sourceType === 'camera' || sourceType === 'screen'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Camera className="w-3.5 h-3.5 shrink-0" />
                <span>Cam / Screen</span>
              </button>
            </div>
          </div>

          {sourceType === 'uploaded' && (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <p className="text-xs text-slate-400">
                  Authorized MP4, MOV, WebM, or MKV files for FFmpeg RTMP output.
                </p>
                <div className="grid grid-cols-2 sm:flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleGenerateSample}
                    disabled={generatingSample || uploading}
                    className="min-h-[44px] px-3 py-2 text-xs font-medium rounded-xl border border-[#2A3447] bg-[#181F2C] text-slate-200 hover:bg-[#1F293A] disabled:opacity-50 whitespace-nowrap"
                  >
                    {generatingSample ? 'Generating...' : 'Sample MP4'}
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading || generatingSample}
                    className="min-h-[44px] px-3.5 py-2 text-xs font-semibold rounded-xl bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center gap-1.5 disabled:opacity-50 whitespace-nowrap"
                  >
                    <Upload className="w-3.5 h-3.5 shrink-0" />
                    <span>{uploading ? 'Uploading...' : 'Upload Video'}</span>
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.webm,.mkv"
                    className="hidden"
                    onChange={(e) => handleUploadVideo(e.target.files?.[0])}
                  />
                </div>
              </div>

              {videos.length === 0 ? (
                <div className="border border-dashed border-[#2A3447] rounded-xl p-6 text-center text-xs text-slate-400">
                  No uploaded videos yet. Upload an authorized MP4/MOV/WebM clip or generate the SMPTE test broadcast clip.
                </div>
              ) : (
                <div className="divide-y divide-[#232B3A] border border-[#232B3A] rounded-xl bg-[#0E131B] overflow-hidden">
                  {videos.map((video) => {
                    const active = selectedVideo?.id === video.id;
                    return (
                      <div
                        key={video.id}
                        className={`px-3.5 py-2.5 flex items-center justify-between gap-2.5 ${
                          active ? 'bg-blue-600/12' : 'hover:bg-[#141B26]'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => onSelectVideoId(video.id)}
                          className="flex-1 min-h-[44px] text-left min-w-0 py-1"
                        >
                          <div className="text-sm font-medium text-slate-100 truncate">
                            {video.originalName}
                          </div>
                          <div className="text-xs text-slate-400 font-mono tabular-nums mt-0.5 break-words">
                            {video.width}x{video.height} · {video.fps} fps · {formatDuration(video.durationSec)} · {formatBytes(video.sizeBytes)}
                          </div>
                        </button>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {active && (
                            <span className="text-xs font-semibold text-blue-400 px-1">Active</span>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeleteVideo(video.id)}
                            disabled={(isStreamingOrConnecting && active) || deletingVideoId === video.id}
                            aria-label={`Delete ${video.originalName}`}
                            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-400 hover:bg-[#1A2230] disabled:opacity-40"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {sourceType === 'direct-url' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-400">
                Enter an authorized direct media URL (MP4, MOV, or HLS `.m3u8` stream) hosted on your CDN or storage bucket.
              </p>
              <div className="flex flex-col sm:flex-row gap-2.5">
                <input
                  type="url"
                  inputMode="url"
                  value={directUrlInput}
                  onChange={(e) => setDirectUrlInput(e.target.value)}
                  placeholder="https://cdn.example.com/authorized-broadcast.mp4"
                  className="flex-1 min-w-0 min-h-[44px] bg-[#0B0E14] border border-[#263042] rounded-xl px-3.5 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={handleValidateDirectUrl}
                  disabled={directCheckLoading || !directUrlInput.trim()}
                  className="min-h-[44px] px-4 py-2 text-sm font-medium rounded-xl bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 whitespace-nowrap"
                >
                  {directCheckLoading ? 'Probing...' : 'Load & Probe URL'}
                </button>
              </div>
              {directCheckMsg && (
                <div className="flex items-center gap-2 text-xs text-emerald-400">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{directCheckMsg}</span>
                </div>
              )}
            </div>
          )}

          {sourceType === 'youtube-preview' && (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row gap-2.5">
                <input
                  type="url"
                  inputMode="url"
                  value={ytUrlInput}
                  onChange={(e) => setYtUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && ytUrlInput.trim() && !ytLoading) {
                      handleLoadYouTube();
                    }
                  }}
                  placeholder="https://youtube.com/live/... or https://youtu.be/..."
                  className="flex-1 min-w-0 min-h-[44px] bg-[#0B0E14] border border-[#263042] rounded-xl px-3.5 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={handleLoadYouTube}
                  disabled={ytLoading || !ytUrlInput.trim()}
                  className="min-h-[44px] px-4 py-2 text-sm font-medium rounded-xl bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 whitespace-nowrap"
                >
                  {ytLoading ? 'Validating...' : 'Load Preview'}
                </button>
              </div>

              {youtubeResult && (
                <div
                  className={`p-3.5 rounded-xl border text-xs space-y-2 ${
                    youtubeResult.valid
                      ? 'bg-[#0E131B] border-blue-500/35 text-slate-200'
                      : 'bg-rose-950/25 border-rose-500/35 text-rose-200'
                  }`}
                >
                  {youtubeResult.valid ? (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-blue-300">
                          YouTube IFrame Preview Active · Preview Only
                        </span>
                        <span className="font-mono text-[11px] text-slate-400">
                          ID: {youtubeResult.videoId}
                        </span>
                      </div>
                      {youtubeResult.title && (
                        <div className="font-semibold text-sm text-slate-100 break-words">
                          {youtubeResult.title} · {youtubeResult.authorName}
                        </div>
                      )}
                      <p className="leading-relaxed text-slate-300">{youtubeResult.explanation}</p>
                      <button
                        type="button"
                        onClick={() => onChangeSourceType('uploaded')}
                        className="min-h-[40px] px-3 py-1.5 rounded-lg bg-[#181F2C] hover:bg-[#212B3D] border border-[#2C374C] text-xs font-medium text-blue-300"
                      >
                        Switch to Uploaded MP4 for Facebook RTMP
                      </button>
                    </>
                  ) : (
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <p className="leading-relaxed">{youtubeResult.explanation}</p>
                    </div>
                  )}
                </div>
              )}

              {!youtubeResult && (
                <p className="text-xs text-slate-400 leading-relaxed">
                  YouTube share links play via the official YouTube IFrame Player for preview only and cannot be captured by FFmpeg.
                </p>
              )}
            </div>
          )}

          {(sourceType === 'camera' || sourceType === 'screen') && (
            <div className="space-y-3.5">
              <div className="bg-[#0E131B] border border-[#232B3A] rounded-xl p-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-slate-200">
                    Android Browser Device Capture
                  </div>
                  <span className="text-[11px] font-mono text-slate-400">
                    Local Preview · Record to Upload
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => handleStartCamera(cameraFacing)}
                    disabled={!hasGetUserMedia}
                    className="min-h-[44px] px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-[#1B2230] disabled:text-slate-500 text-white text-xs font-semibold flex items-center justify-center gap-2"
                  >
                    <Camera className="w-4 h-4 shrink-0" />
                    <span>
                      {captureStream && sourceType === 'camera'
                        ? 'Restart Camera + Mic'
                        : 'Start Camera + Mic'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const next = cameraFacing === 'environment' ? 'user' : 'environment';
                      setCameraFacing(next);
                      if (sourceType === 'camera' && captureStream) {
                        handleStartCamera(next);
                      }
                    }}
                    disabled={!hasGetUserMedia}
                    className="min-h-[44px] px-3.5 py-2 rounded-xl border border-[#2C374C] bg-[#181F2C] hover:bg-[#222C3E] disabled:opacity-40 text-slate-200 text-xs font-medium flex items-center justify-center gap-2"
                  >
                    <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                    <span>Camera: {cameraFacing === 'environment' ? 'Rear' : 'Front'}</span>
                  </button>
                </div>

                <div className="pt-1 border-t border-[#232B3A] space-y-2">
                  {hasGetDisplayMedia ? (
                    <button
                      type="button"
                      onClick={handleStartScreenCapture}
                      className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-[#2C374C] bg-[#181F2C] hover:bg-[#222C3E] text-slate-200 text-xs font-medium flex items-center justify-center gap-2"
                    >
                      <MonitorSmartphone className="w-4 h-4 text-blue-400 shrink-0" />
                      <span>Start Android Screen Capture</span>
                    </button>
                  ) : (
                    <div className="p-3 rounded-xl bg-[#0B0E14] border border-[#232B3A] text-xs text-slate-400 leading-relaxed">
                      <strong className="text-slate-200">Screen Capture Unavailable:</strong> Android Chrome on this device does not expose <code className="font-mono text-slate-300">navigator.mediaDevices.getDisplayMedia</code>. Use Camera + Mic above or upload a screen recording file from Android.
                    </div>
                  )}
                </div>

                {captureStream && (
                  <div className="pt-2 border-t border-[#232B3A] flex flex-col sm:flex-row gap-2.5">
                    {hasMediaRecorder ? (
                      <button
                        type="button"
                        onClick={handleToggleRecordCapture}
                        disabled={uploading}
                        className={`flex-1 min-h-[44px] px-4 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 ${
                          isRecordingCapture
                            ? 'bg-rose-600 hover:bg-rose-500 text-white'
                            : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                        }`}
                      >
                        <Video className="w-4 h-4 shrink-0" />
                        <span>
                          {uploading
                            ? 'Uploading Recorded Clip...'
                            : isRecordingCapture
                              ? 'Stop & Upload Clip to Studio'
                              : 'Record Clip for RTMP Broadcast'}
                        </span>
                      </button>
                    ) : (
                      <div className="text-xs text-amber-300">
                        MediaRecorder API is unavailable on this browser; capture stays preview-only.
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={stopActiveCapture}
                      className="min-h-[44px] px-4 py-2 rounded-xl border border-[#2C374C] text-xs font-medium text-slate-300 hover:bg-[#181F2C]"
                    >
                      Stop Preview
                    </button>
                  </div>
                )}

                {captureError && (
                  <div className="p-3 rounded-xl bg-rose-950/35 border border-rose-500/40 text-xs text-rose-200 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <span className="break-words min-w-0">{captureError}</span>
                  </div>
                )}

                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Note: Because FFmpeg runs securely on the Render backend, live browser camera/screen previews cannot bypass upload directly into RTMP. Record a clip above to upload and broadcast it with overlays.
                </p>
              </div>
            </div>
          )}
        </section>

        {/* Live FFmpeg & WebSocket Activity Logs */}
        <section className="bg-[#121721] border border-[#232B3A] rounded-2xl p-4 sm:p-5 space-y-3 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-slate-100">Broadcast Engine Logs</h3>
            <span className="text-xs font-mono text-slate-400 tabular-nums">
              {logs.length} events · Key redacted
            </span>
          </div>
          <div className="bg-[#080A0F] border border-[#232B3A] rounded-xl p-3 h-52 overflow-y-auto overflow-x-hidden font-mono text-xs space-y-1">
            {logs.length === 0 ? (
              <div className="text-slate-500 py-6 text-center">
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

      {/* Right Column: Thumb-Friendly Broadcast & RTMP Controls */}
      <div className="xl:col-span-4 space-y-5 min-w-0">
        <section className="bg-[#121721] border border-[#232B3A] rounded-2xl p-4 sm:p-5 space-y-4 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-slate-100">Stream Controls</h3>
            <button
              type="button"
              onClick={() => onNavigate('facebook')}
              className="text-xs font-medium text-blue-400 hover:text-blue-300"
            >
              Output Details
            </button>
          </div>

          {(actionError || telemetry.lastError) && (
            <div className="p-3 rounded-xl bg-rose-950/35 border border-rose-500/40 text-xs text-rose-200 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span className="break-words min-w-0">{actionError || telemetry.lastError}</span>
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-300">
              Output Profile (H.264 / AAC / 30 FPS)
            </label>
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
          </div>

          {sourceType === 'uploaded' && (
            <label className="min-h-[44px] flex items-center justify-between text-xs text-slate-300 py-1 cursor-pointer gap-2">
              <span>Loop uploaded video continuously</span>
              <input
                type="checkbox"
                disabled={isStreamingOrConnecting}
                checked={loopVideo}
                onChange={(e) => onChangeLoopVideo(e.target.checked)}
                className="w-4 h-4 rounded border-[#2E384B] bg-[#0B0E14] text-blue-600 focus:ring-blue-500 shrink-0"
              />
            </label>
          )}

          {!isRtmpEligibleSource && (
            <div className="p-3 rounded-xl bg-[#0E131B] border border-[#232B3A] text-xs text-slate-300 flex items-center justify-between gap-2.5">
              <span className="leading-relaxed min-w-0">
                {sourceType === 'youtube-preview'
                  ? 'YouTube is Preview Only and cannot feed FFmpeg RTMP.'
                  : 'Select an Uploaded Video or Direct URL to enable START LIVE.'}
              </span>
              <button
                type="button"
                onClick={() => onChangeSourceType('uploaded')}
                className="min-h-[36px] px-2.5 py-1 rounded-lg bg-[#181F2C] hover:bg-[#222C3E] border border-[#2C374C] text-[11px] font-medium text-blue-300 whitespace-nowrap shrink-0"
              >
                Use Uploaded
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2.5 pt-1">
            <button
              type="button"
              onClick={handleStartLive}
              disabled={isStreamingOrConnecting || streamBusyAction !== null || !isRtmpEligibleSource}
              className="min-h-[48px] px-3 sm:px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-[0.98] disabled:bg-blue-600/35 disabled:text-slate-300 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all whitespace-nowrap"
            >
              <Play className="w-4 h-4 shrink-0" />
              <span>{streamBusyAction === 'starting' ? 'STARTING...' : 'START LIVE'}</span>
            </button>
            <button
              type="button"
              onClick={handleStopLive}
              disabled={!isStreamingOrConnecting || streamBusyAction !== null}
              className="min-h-[48px] px-3 sm:px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 active:scale-[0.98] disabled:bg-[#1B2230] disabled:text-slate-500 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all whitespace-nowrap"
            >
              <Square className="w-4 h-4 shrink-0" />
              <span>{streamBusyAction === 'stopping' ? 'STOPPING...' : 'STOP LIVE'}</span>
            </button>
          </div>

          <div className="pt-2 border-t border-[#232B3A] space-y-2.5">
            <button
              type="button"
              onClick={handleValidatePipeline}
              disabled={pipelineChecking || isStreamingOrConnecting || !isRtmpEligibleSource}
              className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-[#2A3447] bg-[#181F2C] hover:bg-[#1F293B] text-slate-200 text-xs font-medium flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
            >
              <Wrench className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <span className="truncate">
                {pipelineChecking ? 'Running 2s FFmpeg Dry-Run...' : 'Verify Encoding Pipeline (Dry-Run)'}
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
                <div className="font-mono text-[11px] text-slate-300">
                  {pipelineResult.resolution} · {pipelineResult.videoCodec} · {pipelineResult.audioCodec}
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="bg-[#121721] border border-[#232B3A] rounded-2xl p-4 sm:p-5 space-y-4 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-slate-100">Facebook RTMP Target</h3>
            <span
              className={`text-xs font-medium shrink-0 ${
                rtmpConfig.hasStreamKey ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              {rtmpConfig.hasStreamKey ? 'Key Configured' : 'Key Required'}
            </span>
          </div>

          <div className="space-y-3">
            <div>
              <label htmlFor="rtmp-server-url" className="block text-xs font-medium text-slate-300 mb-1">
                RTMP Server URL
              </label>
              <input
                id="rtmp-server-url"
                type="text"
                value={rtmpServerInput}
                onChange={(e) => setRtmpServerInput(e.target.value)}
                placeholder="rtmps://live-api-s.facebook.com:443/rtmp/"
                className="w-full min-h-[44px] bg-[#0B0E14] border border-[#263042] rounded-xl px-3 py-2 text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label htmlFor="rtmp-stream-key" className="block text-xs font-medium text-slate-300 mb-1">
                Facebook Stream Key
              </label>
              <div className="relative">
                <input
                  id="rtmp-stream-key"
                  type={showStreamKey ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={rtmpKeyInput}
                  onChange={(e) => setRtmpKeyInput(e.target.value)}
                  placeholder={
                    rtmpConfig.hasStreamKey
                      ? `Stored: ${rtmpConfig.maskedStreamKey} (enter to replace)`
                      : 'Paste Facebook Live Stream Key'
                  }
                  className="w-full min-h-[44px] bg-[#0B0E14] border border-[#263042] rounded-xl pl-3 pr-12 py-2 text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowStreamKey((v) => !v)}
                  aria-label={showStreamKey ? 'Hide stream key' : 'Show stream key'}
                  className="absolute right-1 top-1/2 -translate-y-1/2 min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:text-slate-200"
                >
                  {showStreamKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[11px] text-slate-500 mt-1.5">
                Saved AES-256-GCM encrypted on the backend. Never stored in localStorage or logs.
              </p>
            </div>

            {rtmpFeedback && (
              <div
                className={`text-xs p-2.5 rounded-xl border break-words ${
                  rtmpFeedback.type === 'ok'
                    ? 'bg-emerald-950/25 border-emerald-500/35 text-emerald-200'
                    : 'bg-rose-950/25 border-rose-500/35 text-rose-200'
                }`}
              >
                {rtmpFeedback.text}
              </div>
            )}

            <button
              type="button"
              onClick={handleSaveRtmp}
              disabled={savingRtmp}
              className="w-full min-h-[44px] px-4 py-2 rounded-xl bg-[#181F2C] hover:bg-[#212B3D] border border-[#2C374C] text-slate-100 text-xs font-semibold transition-colors disabled:opacity-50"
            >
              {savingRtmp ? 'Encrypting & Saving...' : 'Save RTMP Credentials Securely'}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
