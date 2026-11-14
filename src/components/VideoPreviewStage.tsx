import { useEffect, useRef, useState } from 'react';
import { Film, AlertTriangle, Tv, Camera, MonitorSmartphone, Radio } from 'lucide-react';
import type {
  OverlayConfig,
  StreamStatusState,
  VideoAsset,
  VideoSourceType,
  YouTubeValidationResult,
} from '../../shared/types';
import { resolveMediaUrl } from '../lib/api';

export type ProgramMonitorSource = VideoSourceType | 'camera' | 'screen';

export interface VideoPlaybackMeta {
  playbackStatus: 'Idle' | 'Ready' | 'Playing' | 'Paused' | 'Buffering' | 'Ended' | 'External Pull';
  width: number;
  height: number;
  durationSec: number;
  muted: boolean;
}

interface VideoPreviewStageProps {
  sourceType: ProgramMonitorSource;
  selectedVideo: VideoAsset | null;
  directUrl: string;
  youtubeResult?: YouTubeValidationResult | null;
  captureStream?: MediaStream | null;
  overlays: OverlayConfig;
  streamStatus: StreamStatusState;
  showOverlays?: boolean;
  loopVideo?: boolean;
  onPlaybackMetaChange?: (meta: VideoPlaybackMeta) => void;
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return `rgba(15, 23, 42, ${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function formatClockDisplay(now: Date, format: OverlayConfig['clockFormat']): string {
  if (format === 'time-24h') {
    return now.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  }
  if (format === 'time-12h') {
    return now.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  }
  const datePart = now.toLocaleDateString([], {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const timePart = now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return `${datePart}  ${timePart}`;
}

export function VideoPreviewStage({
  sourceType,
  selectedVideo,
  directUrl,
  captureStream = null,
  overlays,
  streamStatus,
  showOverlays = true,
  loopVideo = true,
  onPlaybackMetaChange,
}: VideoPreviewStageProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const captureVideoRef = useRef<HTMLVideoElement | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());

  const trimmedDirectUrl = directUrl.trim();
  const isPullProtocolUrl = /^(rtmps?|srt):\/\//i.test(trimmedDirectUrl);

  useEffect(() => {
    if (!overlays.clockEnabled || !showOverlays) return;
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [overlays.clockEnabled, showOverlays]);

  useEffect(() => {
    setMediaError(null);
  }, [sourceType, selectedVideo?.id, trimmedDirectUrl]);

  useEffect(() => {
    if (!onPlaybackMetaChange) return;
    if (sourceType === 'uploaded' && selectedVideo) {
      onPlaybackMetaChange({
        playbackStatus: 'Ready',
        width: selectedVideo.width,
        height: selectedVideo.height,
        durationSec: selectedVideo.durationSec,
        muted: false,
      });
    } else if (sourceType === 'direct-url' && trimmedDirectUrl) {
      onPlaybackMetaChange({
        playbackStatus: isPullProtocolUrl ? 'External Pull' : 'Ready',
        width: 0,
        height: 0,
        durationSec: 0,
        muted: false,
      });
    } else if ((sourceType === 'camera' || sourceType === 'screen') && captureStream) {
      onPlaybackMetaChange({
        playbackStatus: 'Playing',
        width: 1280,
        height: 720,
        durationSec: 0,
        muted: true,
      });
    } else {
      onPlaybackMetaChange({
        playbackStatus: 'Idle',
        width: 0,
        height: 0,
        durationSec: 0,
        muted: false,
      });
    }
  }, [
    sourceType,
    selectedVideo?.id,
    selectedVideo?.width,
    selectedVideo?.height,
    selectedVideo?.durationSec,
    trimmedDirectUrl,
    isPullProtocolUrl,
    captureStream,
    onPlaybackMetaChange,
  ]);

  useEffect(() => {
    const el = captureVideoRef.current;
    if (!el) return;
    if ((sourceType === 'camera' || sourceType === 'screen') && captureStream) {
      el.srcObject = captureStream;
      el.play().catch(() => {
        // Autoplay fallback handled by user interaction
      });
    } else {
      el.srcObject = null;
    }
  }, [sourceType, captureStream]);

  const emitVideoMeta = (status: VideoPlaybackMeta['playbackStatus']) => {
    if (!onPlaybackMetaChange) return;
    const el = videoRef.current;
    onPlaybackMetaChange({
      playbackStatus: status,
      width: el?.videoWidth || selectedVideo?.width || 0,
      height: el?.videoHeight || selectedVideo?.height || 0,
      durationSec:
        el && Number.isFinite(el.duration) && el.duration > 0
          ? el.duration
          : selectedVideo?.durationSec || 0,
      muted: Boolean(el?.muted),
    });
  };

  const tickerHeightPx =
    overlays.tickerEnabled && overlays.tickerText.trim().length > 0 ? 30 : 0;
  const hasBreakingBanner =
    overlays.breakingNewsEnabled &&
    (overlays.breakingNewsLabel.trim().length > 0 || overlays.breakingNewsText.trim().length > 0);
  const breakingHeightPx = hasBreakingBanner ? 28 : 0;
  const bottomStackPx = tickerHeightPx + breakingHeightPx;
  const topHeadlineOffsetPx =
    overlays.headlineEnabled && overlays.headlineText.trim().length > 0 ? 44 : 10;

  const logoPosClass =
    overlays.logoPosition === 'top-left'
      ? 'left-3'
      : overlays.logoPosition === 'top-right'
        ? 'right-3'
        : overlays.logoPosition === 'bottom-left'
          ? 'left-3'
          : 'right-3';
  const isTopLogo =
    overlays.logoPosition === 'top-left' || overlays.logoPosition === 'top-right';
  const bottomOffsetPx = bottomStackPx > 0 ? bottomStackPx + 8 : 10;

  const isTopClock =
    overlays.clockPosition === 'top-left' || overlays.clockPosition === 'top-right';
  const clockPosClass =
    overlays.clockPosition === 'top-left' || overlays.clockPosition === 'bottom-left'
      ? 'left-3'
      : 'right-3';

  const tickerDurationSec = Math.max(6, Math.round(1400 / Math.max(40, overlays.tickerSpeed)));

  const headlineAnimClass =
    overlays.headlineAnimation === 'fade'
      ? 'animate-overlay-fade'
      : overlays.headlineAnimation === 'slide'
        ? 'animate-overlay-slide'
        : '';

  const lowerThirdAnimClass =
    overlays.lowerThirdAnimation === 'fade'
      ? 'animate-overlay-fade'
      : overlays.lowerThirdAnimation === 'slide'
        ? 'animate-overlay-slide'
        : '';

  const resolvedVideoSrc = selectedVideo ? resolveMediaUrl(selectedVideo.url) : '';
  const resolvedLogoSrc = overlays.logoUrl ? resolveMediaUrl(overlays.logoUrl) : '';

  return (
    <div className="relative w-full max-w-full aspect-video bg-[#07090D] rounded-xl overflow-hidden border border-[#232B3A]">
      {sourceType === 'uploaded' && selectedVideo ? (
        <video
          ref={videoRef}
          key={resolvedVideoSrc}
          src={resolvedVideoSrc}
          controls
          loop={loopVideo}
          playsInline
          onLoadedMetadata={() => emitVideoMeta('Ready')}
          onPlay={() => emitVideoMeta('Playing')}
          onPause={() => emitVideoMeta('Paused')}
          onWaiting={() => emitVideoMeta('Buffering')}
          onEnded={() => emitVideoMeta('Ended')}
          onVolumeChange={() => emitVideoMeta(videoRef.current?.paused ? 'Paused' : 'Playing')}
          onError={() =>
            setMediaError(
              'Browser could not preview this video format directly, though backend FFmpeg can still encode it for RTMP.',
            )
          }
          className="w-full h-full object-contain bg-black"
        />
      ) : sourceType === 'direct-url' && trimmedDirectUrl && isPullProtocolUrl ? (
        <div className="w-full h-full flex flex-col items-center justify-center p-4 sm:p-6 text-center bg-[#090D14]">
          <div className="w-11 h-11 rounded-xl bg-blue-600/15 border border-blue-500/35 flex items-center justify-center mb-2.5">
            <Radio className="w-5 h-5 text-blue-400" />
          </div>
          <p className="text-xs sm:text-sm font-semibold text-slate-100">
            Authorized RTMP / SRT Live Feed Configured
          </p>
          <p className="text-[11px] font-mono text-blue-300 mt-1 break-all max-w-md px-2">
            {trimmedDirectUrl}
          </p>
          <p className="text-[11px] text-slate-400 mt-1.5 max-w-md">
            HTML5 browsers do not decode native RTMP/SRT streams directly. Live overlays below preview exactly how FFmpeg ingests and relays this feed to Facebook Live.
          </p>
        </div>
      ) : sourceType === 'direct-url' && trimmedDirectUrl ? (
        <video
          ref={videoRef}
          key={trimmedDirectUrl}
          src={trimmedDirectUrl}
          controls
          playsInline
          onLoadedMetadata={() => emitVideoMeta('Ready')}
          onPlay={() => emitVideoMeta('Playing')}
          onPause={() => emitVideoMeta('Paused')}
          onWaiting={() => emitVideoMeta('Buffering')}
          onEnded={() => emitVideoMeta('Ended')}
          onVolumeChange={() => emitVideoMeta(videoRef.current?.paused ? 'Paused' : 'Playing')}
          onError={() =>
            setMediaError(
              'Browser preview unavailable for this URL (CORS or HLS format). Backend FFmpeg can still ingest verified streams.',
            )
          }
          className="w-full h-full object-contain bg-black"
        />
      ) : (sourceType === 'camera' || sourceType === 'screen') && captureStream ? (
        <video
          ref={captureVideoRef}
          autoPlay
          muted
          playsInline
          className="w-full h-full object-contain bg-black"
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center p-4 sm:p-6 text-center bg-[#090C11]">
          <div className="w-11 h-11 rounded-xl bg-[#141A24] border border-[#232B3A] flex items-center justify-center mb-2.5">
            {sourceType === 'camera' ? (
              <Camera className="w-5 h-5 text-slate-400" />
            ) : sourceType === 'screen' ? (
              <MonitorSmartphone className="w-5 h-5 text-slate-400" />
            ) : (
              <Film className="w-5 h-5 text-slate-400" />
            )}
          </div>
          <p className="text-xs sm:text-sm font-medium text-slate-200">
            {sourceType === 'camera'
              ? 'Camera Preview Inactive'
              : sourceType === 'screen'
                ? 'Screen Capture Inactive'
                : 'No Facebook Broadcast Source Loaded'}
          </p>
          <p className="text-[11px] sm:text-xs text-slate-400 mt-1 max-w-md">
            {sourceType === 'camera'
              ? 'Start camera + microphone below to record and upload a clip.'
              : sourceType === 'screen'
                ? 'Start Android screen capture where supported or upload a recording.'
                : 'Select or upload an MP4/MOV/WebM clip, or enter an authorized HTTPS/HLS/RTMP/SRT stream URL.'}
          </p>
        </div>
      )}

      {mediaError && (
        <div className="pointer-events-none absolute inset-x-3 top-12 flex justify-center z-20">
          <div className="bg-[#0B0E14]/90 border border-amber-500/40 rounded-md px-3 py-1.5 text-[11px] sm:text-xs text-amber-200 flex items-center gap-2 max-w-lg">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>{mediaError}</span>
          </div>
        </div>
      )}

      {/* Program Output On-Air State Indicator */}
      <div className="pointer-events-none absolute top-2.5 left-2.5 flex items-center gap-2 z-20">
        {streamStatus === 'Live' ? (
          <div className="flex items-center gap-1.5 bg-red-600 text-white px-2 py-0.5 sm:px-2.5 sm:py-1 rounded text-[10px] sm:text-[11px] font-semibold tracking-wider font-mono">
            <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
            <span>ON AIR</span>
          </div>
        ) : streamStatus === 'Connecting' ? (
          <div className="flex items-center gap-1.5 bg-amber-500 text-slate-950 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded text-[10px] sm:text-[11px] font-semibold tracking-wider font-mono">
            <Tv className="w-3 h-3" />
            <span>CONNECTING</span>
          </div>
        ) : (sourceType === 'camera' || sourceType === 'screen') && captureStream ? (
          <div className="flex items-center gap-1.5 bg-[#0B0E14]/90 border border-blue-500/40 text-blue-200 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded text-[10px] sm:text-[11px] font-medium">
            <Camera className="w-3 h-3 text-blue-400 shrink-0" />
            <span>{sourceType === 'camera' ? 'Camera (Record to Upload)' : 'Screen (Record to Upload)'}</span>
          </div>
        ) : null}
      </div>

      {/* Live Composited Graphics Overlays */}
      {showOverlays && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden z-10">
          {overlays.logoEnabled && resolvedLogoSrc && (
            <img
              src={resolvedLogoSrc}
              alt="Broadcast Logo Overlay"
              referrerPolicy="no-referrer"
              style={{
                width: `${overlays.logoScale}%`,
                opacity: overlays.logoOpacity,
                top: isTopLogo ? `${topHeadlineOffsetPx}px` : undefined,
                bottom: !isTopLogo ? `${bottomOffsetPx}px` : undefined,
              }}
              className={`absolute object-contain select-none ${logoPosClass}`}
            />
          )}

          {overlays.headlineEnabled && overlays.headlineText.trim().length > 0 && (
            <div
              key={`hl-${overlays.headlineText}-${overlays.headlineAnimation}`}
              style={{
                backgroundColor: hexToRgba(overlays.headlineBgColor, overlays.headlineBgOpacity),
                color: overlays.headlineColor,
                fontSize: `clamp(11px, 2.6vw, ${Math.max(12, Math.round(overlays.headlineFontSize * 0.56))}px)`,
              }}
              className={`absolute top-2.5 inset-x-3 px-3 py-1 rounded font-semibold tracking-tight truncate ${headlineAnimClass}`}
            >
              {overlays.headlineText}
            </div>
          )}

          {overlays.clockEnabled && (
            <div
              style={{
                backgroundColor: hexToRgba(overlays.clockBgColor, overlays.clockBgOpacity),
                color: overlays.clockColor,
                fontSize: `clamp(10px, 2vw, ${Math.max(11, Math.round(overlays.clockFontSize * 0.65))}px)`,
                top: isTopClock ? `${topHeadlineOffsetPx}px` : undefined,
                bottom: !isTopClock ? `${bottomOffsetPx}px` : undefined,
              }}
              className={`absolute ${clockPosClass} px-2.5 py-1 rounded font-mono font-semibold tabular-nums tracking-tight whitespace-nowrap`}
            >
              {formatClockDisplay(now, overlays.clockFormat)}
            </div>
          )}

          {overlays.lowerThirdEnabled &&
            (overlays.lowerThirdTitle.trim() || overlays.lowerThirdSubtitle.trim()) && (
              <div
                key={`lt-${overlays.lowerThirdTitle}-${overlays.lowerThirdAnimation}`}
                style={{
                  bottom: `${bottomStackPx > 0 ? bottomStackPx + 8 : 10}px`,
                  backgroundColor: hexToRgba(overlays.lowerThirdBgColor, 0.9),
                  color: overlays.lowerThirdTextColor,
                }}
                className={`absolute left-3 max-w-[78%] flex items-stretch rounded-r overflow-hidden shadow-lg ${lowerThirdAnimClass}`}
              >
                <div
                  style={{ backgroundColor: overlays.lowerThirdAccentColor }}
                  className="w-1.5 shrink-0"
                />
                <div className="px-2.5 sm:px-3.5 py-1.5 min-w-0">
                  {overlays.lowerThirdTitle.trim() && (
                    <div className="text-xs sm:text-sm font-bold leading-tight truncate">
                      {overlays.lowerThirdTitle}
                    </div>
                  )}
                  {overlays.lowerThirdSubtitle.trim() && (
                    <div className="text-[10px] sm:text-xs text-slate-300 leading-tight mt-0.5 truncate">
                      {overlays.lowerThirdSubtitle}
                    </div>
                  )}
                </div>
              </div>
            )}

          {hasBreakingBanner && (
            <div
              style={{
                bottom: `${tickerHeightPx > 0 ? tickerHeightPx + 3 : 8}px`,
                height: `${breakingHeightPx}px`,
                backgroundColor: `rgba(11, 14, 20, ${overlays.breakingNewsOpacity})`,
                color: overlays.breakingNewsTextColor,
              }}
              className="absolute inset-x-3 flex items-stretch rounded overflow-hidden border border-white/10"
            >
              <div
                style={{
                  backgroundColor: hexToRgba(
                    overlays.breakingNewsBgColor,
                    overlays.breakingNewsOpacity,
                  ),
                }}
                className="px-2.5 flex items-center text-[10px] sm:text-xs font-extrabold uppercase tracking-wider shrink-0"
              >
                {overlays.breakingNewsLabel.trim() || 'BREAKING NEWS'}
              </div>
              <div className="px-2.5 flex items-center text-[11px] sm:text-xs font-semibold truncate min-w-0">
                {overlays.breakingNewsText}
              </div>
            </div>
          )}

          {tickerHeightPx > 0 && (
            <div
              style={{
                height: `${tickerHeightPx}px`,
                backgroundColor: hexToRgba(overlays.tickerBgColor, overlays.tickerBgOpacity),
                color: overlays.tickerColor,
                ['--ticker-duration' as string]: `${tickerDurationSec}s`,
              }}
              className="absolute bottom-0 inset-x-0 flex items-center overflow-hidden border-t border-white/10"
            >
              <div
                style={{
                  fontSize: `clamp(11px, 2.4vw, ${Math.max(11, Math.round(overlays.tickerFontSize * 0.65))}px)`,
                }}
                className="animate-ticker font-medium px-4"
              >
                {overlays.tickerText}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
