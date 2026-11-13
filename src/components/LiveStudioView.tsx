import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  FileVideo,
  Globe,
  Play,
  Square,
  Trash2,
  Upload,
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
import { VideoPreviewStage } from './VideoPreviewStage';

interface LiveStudioViewProps {
  telemetry: StreamTelemetry;
  logs: StreamLogEntry[];
  videos: VideoAsset[];
  overlays: OverlayConfig;
  rtmpConfig: RtmpPublicConfig;
  sourceType: VideoSourceType;
  onChangeSourceType: (type: VideoSourceType) => void;
  selectedVideoId: string | null;
  onSelectVideoId: (id: string | null) => void;
  directUrl: string;
  onChangeDirectUrl: (url: string) => void;
  youtubeResult: YouTubeValidationResult | null;
  onYouTubeValidated: (res: YouTubeValidationResult | null) => void;
  onVideosUpdated: (videos: VideoAsset[]) => void;
  onRtmpUpdated: (config: RtmpPublicConfig) => void;
  onTelemetryUpdated: (telemetry: StreamTelemetry) => void;
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
  onVideosUpdated,
  onRtmpUpdated,
  onTelemetryUpdated,
}: LiveStudioViewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [quality, setQuality] = useState<StreamQualityProfile>(telemetry.quality || '720p');
  const [loopVideo, setLoopVideo] = useState<boolean>(true);
  const [showOverlayPreview, setShowOverlayPreview] = useState<boolean>(true);

  const [ytUrlInput, setYtUrlInput] = useState('');
  const [ytLoading, setYtLoading] = useState(false);

  const [directUrlInput, setDirectUrlInput] = useState(directUrl);
  const [directCheckLoading, setDirectCheckLoading] = useState(false);
  const [directCheckMsg, setDirectCheckMsg] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [generatingSample, setGeneratingSample] = useState(false);
  const [deletingVideoId, setDeletingVideoId] = useState<string | null>(null);

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

  const selectedVideo = videos.find((v) => v.id === selectedVideoId) ?? videos[0] ?? null;
  const isStreamingOrConnecting = telemetry.status === 'Live' || telemetry.status === 'Connecting';

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

    if (sourceType === 'youtube-preview') {
      setActionError(
        'YouTube share URLs are preview-only via the official YouTube IFrame Player API and cannot be sent to FFmpeg. Select an uploaded MP4/MOV/WebM file or an authorized direct media URL.',
      );
      return;
    }

    setStreamBusyAction('starting');
    try {
      const res = await api.startStream({
        sourceType,
        videoId: sourceType === 'uploaded' ? selectedVideo?.id : undefined,
        directUrl: sourceType === 'direct-url' ? directUrl : undefined,
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
    if (sourceType === 'youtube-preview') {
      setActionError('YouTube preview sources cannot be tested in the FFmpeg encoding pipeline.');
      return;
    }
    setPipelineChecking(true);
    try {
      const res = await api.validatePipeline({
        sourceType,
        videoId: sourceType === 'uploaded' ? selectedVideo?.id : undefined,
        directUrl: sourceType === 'direct-url' ? directUrl : undefined,
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
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start min-w-0">
      {/* Left 8 columns */}
      <div className="xl:col-span-8 space-y-5 min-w-0">
        <section className="bg-[#121721] border border-[#232B3A] rounded-lg p-3 sm:p-4 space-y-4 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-100">Program Monitor</h2>
              <p className="text-xs text-slate-400">
                16:9 broadcast canvas with real-time graphics overlay composition
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none shrink-0">
              <input
                type="checkbox"
                checked={showOverlayPreview}
                onChange={(e) => setShowOverlayPreview(e.target.checked)}
                className="rounded border-[#2E384B] bg-[#0B0E14] text-blue-600 focus:ring-blue-500"
              />
              <span>Preview Overlays</span>
            </label>
          </div>

          <VideoPreviewStage
            sourceType={sourceType}
            selectedVideo={selectedVideo}
            directUrl={directUrl}
            youtubeResult={youtubeResult}
            overlays={overlays}
            streamStatus={telemetry.status}
            showOverlays={showOverlayPreview}
            loopVideo={loopVideo}
          />

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 sm:gap-3 pt-1">
            <div className="bg-[#0E131B] border border-[#232B3A] rounded-md px-3 py-2.5 min-w-0">
              <div className="text-[11px] text-slate-400">Status</div>
              <div
                className={`text-sm font-semibold mt-0.5 truncate ${
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
            <div className="bg-[#0E131B] border border-[#232B3A] rounded-md px-3 py-2.5 min-w-0">
              <div className="text-[11px] text-slate-400">Duration</div>
              <div className="text-sm font-semibold text-slate-100 font-mono tabular-nums mt-0.5 truncate">
                {formatDuration(telemetry.durationSec)}
              </div>
            </div>
            <div className="bg-[#0E131B] border border-[#232B3A] rounded-md px-3 py-2.5 min-w-0">
              <div className="text-[11px] text-slate-400">Resolution</div>
              <div className="text-sm font-semibold text-slate-100 font-mono tabular-nums mt-0.5 truncate">
                {isStreamingOrConnecting
                  ? telemetry.outputResolution
                  : quality === '1080p'
                    ? '1920x1080'
                    : '1280x720'}
              </div>
            </div>
            <div className="bg-[#0E131B] border border-[#232B3A] rounded-md px-3 py-2.5 min-w-0">
              <div className="text-[11px] text-slate-400">Bitrate</div>
              <div className="text-sm font-semibold text-slate-100 font-mono tabular-nums mt-0.5 truncate">
                {telemetry.bitrateKbps > 0 ? `${telemetry.bitrateKbps} kbps` : '0 kbps'}
              </div>
            </div>
            <div className="bg-[#0E131B] border border-[#232B3A] rounded-md px-3 py-2.5 col-span-2 sm:col-span-1 min-w-0">
              <div className="text-[11px] text-slate-400">Output FPS</div>
              <div className="text-sm font-semibold text-slate-100 font-mono tabular-nums mt-0.5 truncate">
                {telemetry.fps > 0 ? `${telemetry.fps} fps` : '30 fps target'}
              </div>
            </div>
          </div>
        </section>

        {/* Source Input Panel */}
        <section className="bg-[#121721] border border-[#232B3A] rounded-lg p-4 sm:p-5 space-y-4 min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-slate-100">Video Source Selection</h3>
            <div className="flex flex-wrap gap-1 p-1 bg-[#0B0E14] border border-[#232B3A] rounded-md w-full sm:w-auto">
              <button
                type="button"
                onClick={() => onChangeSourceType('uploaded')}
                className={`flex-1 sm:flex-initial px-3 py-1.5 text-xs font-medium rounded transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap ${
                  sourceType === 'uploaded'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <FileVideo className="w-3.5 h-3.5 shrink-0" />
                <span>Uploaded Video</span>
              </button>
              <button
                type="button"
                onClick={() => onChangeSourceType('direct-url')}
                className={`flex-1 sm:flex-initial px-3 py-1.5 text-xs font-medium rounded transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap ${
                  sourceType === 'direct-url'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Globe className="w-3.5 h-3.5 shrink-0" />
                <span>Direct Media URL</span>
              </button>
              <button
                type="button"
                onClick={() => onChangeSourceType('youtube-preview')}
                className={`flex-1 sm:flex-initial px-3 py-1.5 text-xs font-medium rounded transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap ${
                  sourceType === 'youtube-preview'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Youtube className="w-3.5 h-3.5 shrink-0" />
                <span>YouTube URL</span>
              </button>
            </div>
          </div>

          {sourceType === 'uploaded' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-slate-400">
                  Upload authorized MP4, MOV, WebM, or MKV files for FFmpeg RTMP streaming.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleGenerateSample}
                    disabled={generatingSample || uploading}
                    className="px-3 py-1.5 text-xs font-medium rounded-md border border-[#2A3447] bg-[#181F2C] text-slate-200 hover:bg-[#1F293A] disabled:opacity-50 whitespace-nowrap"
                  >
                    {generatingSample ? 'Generating...' : 'Generate Sample MP4'}
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading || generatingSample}
                    className="px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap"
                  >
                    <Upload className="w-3.5 h-3.5" />
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
                <div className="border border-dashed border-[#2A3447] rounded-md p-6 text-center text-xs text-slate-400">
                  No uploaded videos yet. Upload an authorized MP4 or generate the SMPTE test broadcast clip.
                </div>
              ) : (
                <div className="divide-y divide-[#232B3A] border border-[#232B3A] rounded-md bg-[#0E131B]">
                  {videos.map((video) => {
                    const active = selectedVideo?.id === video.id;
                    return (
                      <div
                        key={video.id}
                        className={`px-3.5 py-2.5 flex items-center justify-between gap-3 ${
                          active ? 'bg-blue-600/10' : 'hover:bg-[#141B26]'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => onSelectVideoId(video.id)}
                          className="flex-1 text-left min-w-0"
                        >
                          <div className="text-sm font-medium text-slate-100 truncate">
                            {video.originalName}
                          </div>
                          <div className="text-xs text-slate-400 font-mono tabular-nums mt-0.5 break-words">
                            {video.width}x{video.height} · {video.fps} fps · {formatDuration(video.durationSec)} · {formatBytes(video.sizeBytes)} · {video.videoCodec}{video.hasAudio ? `/${video.audioCodec}` : ' (no audio)'}
                          </div>
                        </button>
                        <div className="flex items-center gap-2 shrink-0">
                          {active && (
                            <span className="text-xs font-medium text-blue-400">Selected</span>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeleteVideo(video.id)}
                            disabled={(isStreamingOrConnecting && active) || deletingVideoId === video.id}
                            aria-label={`Delete ${video.originalName}`}
                            className="p-1.5 rounded text-slate-400 hover:text-rose-400 hover:bg-[#1A2230] disabled:opacity-40"
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
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="url"
                  value={directUrlInput}
                  onChange={(e) => setDirectUrlInput(e.target.value)}
                  placeholder="https://cdn.example.com/authorized-broadcast.mp4"
                  className="flex-1 min-w-0 bg-[#0B0E14] border border-[#263042] rounded-md px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={handleValidateDirectUrl}
                  disabled={directCheckLoading || !directUrlInput.trim()}
                  className="px-4 py-2 text-sm font-medium rounded-md bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 whitespace-nowrap"
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
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="url"
                  value={ytUrlInput}
                  onChange={(e) => setYtUrlInput(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=... or https://youtu.be/..."
                  className="flex-1 min-w-0 bg-[#0B0E14] border border-[#263042] rounded-md px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={handleLoadYouTube}
                  disabled={ytLoading || !ytUrlInput.trim()}
                  className="px-4 py-2 text-sm font-medium rounded-md bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 whitespace-nowrap"
                >
                  {ytLoading ? 'Validating...' : 'Load Video'}
                </button>
              </div>

              {youtubeResult && (
                <div
                  className={`p-3.5 rounded-md border text-xs space-y-1.5 ${
                    youtubeResult.valid
                      ? 'bg-amber-950/25 border-amber-500/35 text-amber-100'
                      : 'bg-rose-950/25 border-rose-500/35 text-rose-200'
                  }`}
                >
                  {youtubeResult.valid && youtubeResult.title && (
                    <div className="font-semibold text-sm text-slate-100 break-words">
                      {youtubeResult.title} · {youtubeResult.authorName}
                    </div>
                  )}
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <p className="leading-relaxed">{youtubeResult.explanation}</p>
                  </div>
                </div>
              )}

              {!youtubeResult && (
                <p className="text-xs text-slate-400 leading-relaxed">
                  YouTube links are validated and played inside the official YouTube IFrame Player API where permitted. For actual Facebook Live RTMP broadcasting, switch to Uploaded Video or Direct Media URL.
                </p>
              )}
            </div>
          )}
        </section>

        {/* Live FFmpeg & WebSocket Activity Logs */}
        <section className="bg-[#121721] border border-[#232B3A] rounded-lg p-4 sm:p-5 space-y-3 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-slate-100">Broadcast Engine Activity Logs</h3>
            <span className="text-xs font-mono text-slate-400 tabular-nums">
              {logs.length} events · Stream key redacted
            </span>
          </div>
          <div className="bg-[#080A0F] border border-[#232B3A] rounded-md p-3 h-56 overflow-y-auto overflow-x-hidden font-mono text-xs space-y-1">
            {logs.length === 0 ? (
              <div className="text-slate-500 py-4 text-center">
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

      {/* Right 4 columns */}
      <div className="xl:col-span-4 space-y-5 min-w-0">
        <section className="bg-[#121721] border border-[#232B3A] rounded-lg p-4 sm:p-5 space-y-4 min-w-0">
          <h3 className="text-base font-semibold text-slate-100">Stream Controls</h3>

          {(actionError || telemetry.lastError) && (
            <div className="p-3 rounded-md bg-rose-950/35 border border-rose-500/40 text-xs text-rose-200 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span className="break-words min-w-0">{actionError || telemetry.lastError}</span>
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-300">
              Output Quality Profile (H.264 / AAC / 30 FPS)
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={isStreamingOrConnecting}
                onClick={() => setQuality('720p')}
                className={`px-3 py-2.5 rounded-md border text-left transition-colors disabled:opacity-50 ${
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
                onClick={() => setQuality('1080p')}
                className={`px-3 py-2.5 rounded-md border text-left transition-colors disabled:opacity-50 ${
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
            <label className="flex items-center justify-between text-xs text-slate-300 py-1 cursor-pointer gap-2">
              <span>Loop uploaded video continuously</span>
              <input
                type="checkbox"
                disabled={isStreamingOrConnecting}
                checked={loopVideo}
                onChange={(e) => setLoopVideo(e.target.checked)}
                className="rounded border-[#2E384B] bg-[#0B0E14] text-blue-600 focus:ring-blue-500 shrink-0"
              />
            </label>
          )}

          <div className="grid grid-cols-2 gap-2.5 pt-1">
            <button
              type="button"
              onClick={handleStartLive}
              disabled={isStreamingOrConnecting || streamBusyAction !== null || sourceType === 'youtube-preview'}
              className="px-3 sm:px-4 py-2.5 rounded-md bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/40 disabled:text-slate-300 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
            >
              <Play className="w-4 h-4 shrink-0" />
              <span>{streamBusyAction === 'starting' ? 'STARTING...' : 'START LIVE'}</span>
            </button>
            <button
              type="button"
              onClick={handleStopLive}
              disabled={!isStreamingOrConnecting || streamBusyAction !== null}
              className="px-3 sm:px-4 py-2.5 rounded-md bg-rose-600 hover:bg-rose-500 disabled:bg-[#1B2230] disabled:text-slate-500 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
            >
              <Square className="w-4 h-4 shrink-0" />
              <span>{streamBusyAction === 'stopping' ? 'STOPPING...' : 'STOP LIVE'}</span>
            </button>
          </div>

          <div className="pt-2 border-t border-[#232B3A] space-y-2.5">
            <button
              type="button"
              onClick={handleValidatePipeline}
              disabled={pipelineChecking || isStreamingOrConnecting || sourceType === 'youtube-preview'}
              className="w-full px-3 py-2 rounded-md border border-[#2A3447] bg-[#181F2C] hover:bg-[#1F293B] text-slate-200 text-xs font-medium flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
            >
              <Wrench className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <span className="truncate">
                {pipelineChecking ? 'Running 2s FFmpeg Dry-Run...' : 'Verify Encoding Pipeline (Local Dry-Run)'}
              </span>
            </button>

            {pipelineResult && (
              <div
                className={`p-3 rounded-md border text-xs space-y-1 ${
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

        <section className="bg-[#121721] border border-[#232B3A] rounded-lg p-4 sm:p-5 space-y-4 min-w-0">
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
                className="w-full bg-[#0B0E14] border border-[#263042] rounded-md px-3 py-2 text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
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
                      ? `Stored: ${rtmpConfig.maskedStreamKey} (enter new key to replace)`
                      : 'Paste Facebook Live Stream Key'
                  }
                  className="w-full bg-[#0B0E14] border border-[#263042] rounded-md pl-3 pr-10 py-2 text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowStreamKey((v) => !v)}
                  aria-label={showStreamKey ? 'Hide stream key' : 'Show stream key'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-200"
                >
                  {showStreamKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[11px] text-slate-500 mt-1.5">
                Saved AES-256-GCM encrypted on the backend. Never stored in browser localStorage or exposed in logs.
              </p>
            </div>

            {rtmpFeedback && (
              <div
                className={`text-xs p-2.5 rounded border break-words ${
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
              className="w-full px-4 py-2 rounded-md bg-[#181F2C] hover:bg-[#212B3D] border border-[#2C374C] text-slate-100 text-xs font-semibold transition-colors disabled:opacity-50"
            >
              {savingRtmp ? 'Encrypting & Saving...' : 'Save RTMP Credentials Securely'}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
