import { useEffect, useRef, useState } from 'react';
import { Film, Play, AlertTriangle, Tv, Camera, MonitorSmartphone } from 'lucide-react';
import type {
  OverlayConfig,
  StreamStatusState,
  VideoAsset,
  VideoSourceType,
  YouTubeValidationResult,
} from '../../shared/types';
import { resolveMediaUrl } from '../lib/api';

export type ProgramMonitorSource = VideoSourceType | 'camera' | 'screen';

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement | string,
        options: {
          videoId: string;
          playerVars?: Record<string, string | number>;
          events?: {
            onReady?: () => void;
            onError?: (e: { data: number }) => void;
          };
        },
      ) => {
        destroy: () => void;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface VideoPreviewStageProps {
  sourceType: ProgramMonitorSource;
  selectedVideo: VideoAsset | null;
  directUrl: string;
  youtubeResult: YouTubeValidationResult | null;
  captureStream?: MediaStream | null;
  overlays: OverlayConfig;
  streamStatus: StreamStatusState;
  showOverlays?: boolean;
  loopVideo?: boolean;
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return `rgba(15, 23, 42, ${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function VideoPreviewStage({
  sourceType,
  selectedVideo,
  directUrl,
  youtubeResult,
  captureStream = null,
  overlays,
  streamStatus,
  showOverlays = true,
  loopVideo = true,
}: VideoPreviewStageProps) {
  const ytContainerRef = useRef<HTMLDivElement | null>(null);
  const ytPlayerRef = useRef<{ destroy: () => void } | null>(null);
  const captureVideoRef = useRef<HTMLVideoElement | null>(null);
  const [ytError, setYtError] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);

  useEffect(() => {
    setMediaError(null);
  }, [sourceType, selectedVideo?.id, directUrl]);

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

  useEffect(() => {
    if (sourceType !== 'youtube-preview' || !youtubeResult?.valid || !youtubeResult.videoId) {
      if (ytPlayerRef.current) {
        try {
          ytPlayerRef.current.destroy();
        } catch {
          // ignore
        }
        ytPlayerRef.current = null;
      }
      setYtError(null);
      return;
    }

    let cancelled = false;
    const videoId = youtubeResult.videoId;
    setYtError(null);

    const mountPlayer = () => {
      if (cancelled || !ytContainerRef.current || !window.YT?.Player) return;
      if (ytPlayerRef.current) {
        try {
          ytPlayerRef.current.destroy();
        } catch {
          // ignore
        }
      }
      ytContainerRef.current.innerHTML = '';
      const hostEl = document.createElement('div');
      hostEl.className = 'w-full h-full';
      ytContainerRef.current.appendChild(hostEl);

      ytPlayerRef.current = new window.YT.Player(hostEl, {
        videoId,
        playerVars: {
          autoplay: 0,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
        },
        events: {
          onError: (e) => {
            if (!cancelled) {
              setYtError(
                e.data === 101 || e.data === 150
                  ? 'The video owner has disabled embedded playback for this YouTube video (Error 101/150).'
                  : `YouTube IFrame Player reported playback error code ${e.data}.`,
              );
            }
          },
        },
      });
    };

    if (window.YT?.Player) {
      mountPlayer();
    } else {
      const existingScript = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
      if (!existingScript) {
        const script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        script.async = true;
        document.head.appendChild(script);
      }
      const prevCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (prevCallback) prevCallback();
        mountPlayer();
      };
    }

    return () => {
      cancelled = true;
      if (ytPlayerRef.current) {
        try {
          ytPlayerRef.current.destroy();
        } catch {
          // ignore
        }
        ytPlayerRef.current = null;
      }
    };
  }, [sourceType, youtubeResult?.valid, youtubeResult?.videoId]);

  const tickerHeightPx = 32;
  const logoPosClass =
    overlays.logoPosition === 'top-left'
      ? 'top-3 left-3'
      : overlays.logoPosition === 'top-right'
        ? 'top-3 right-3'
        : overlays.logoPosition === 'bottom-left'
          ? 'left-3'
          : 'right-3';

  const isBottomLogo =
    overlays.logoPosition === 'bottom-left' || overlays.logoPosition === 'bottom-right';
  const bottomOffsetPx = overlays.tickerEnabled ? tickerHeightPx + 10 : 12;

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
          key={resolvedVideoSrc}
          src={resolvedVideoSrc}
          controls
          loop={loopVideo}
          playsInline
          onError={() =>
            setMediaError(
              'Browser could not preview this video format directly, though the backend FFmpeg engine can still transcode it for RTMP.',
            )
          }
          className="w-full h-full object-contain bg-black"
        />
      ) : sourceType === 'direct-url' && directUrl.trim() ? (
        <video
          key={directUrl.trim()}
          src={directUrl.trim()}
          controls
          playsInline
          onError={() =>
            setMediaError(
              'Browser preview unavailable for this direct stream URL (CORS or HLS container). Use Verify Encoding Pipeline to test backend FFmpeg ingestion.',
            )
          }
          className="w-full h-full object-contain bg-black"
        />
      ) : sourceType === 'youtube-preview' && youtubeResult?.valid ? (
        <div className="w-full h-full relative bg-black">
          <div ref={ytContainerRef} className="w-full h-full" />
          {ytError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0B0E14]/95 p-4 sm:p-6 text-center">
              <AlertTriangle className="w-8 h-8 text-amber-400 mb-2.5" />
              <p className="text-xs sm:text-sm font-medium text-slate-200 max-w-md">{ytError}</p>
            </div>
          )}
        </div>
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
                : 'No Video Source Loaded'}
          </p>
          <p className="text-[11px] sm:text-xs text-slate-400 mt-1 max-w-md">
            {sourceType === 'camera'
              ? 'Tap Start Camera below to request Android camera and microphone permissions.'
              : sourceType === 'screen'
                ? 'Start Android screen capture if supported by your Chrome build, or upload an MP4/MOV/WebM clip.'
                : 'Select an authorized MP4/MOV/WebM file, enter an authorized direct media URL, or load a YouTube share URL for IFrame preview.'}
          </p>
        </div>
      )}

      {mediaError && (
        <div className="pointer-events-none absolute inset-x-3 top-12 flex justify-center">
          <div className="bg-[#0B0E14]/90 border border-amber-500/40 rounded-md px-3 py-1.5 text-[11px] sm:text-xs text-amber-200 flex items-center gap-2 max-w-lg">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>{mediaError}</span>
          </div>
        </div>
      )}

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
        ) : sourceType === 'youtube-preview' && youtubeResult?.valid ? (
          <div className="flex items-center gap-1.5 bg-[#0B0E14]/90 border border-amber-500/40 text-amber-200 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded text-[10px] sm:text-[11px] font-medium">
            <Play className="w-3 h-3 text-amber-400 shrink-0" />
            <span>Preview Only · YouTube</span>
          </div>
        ) : (sourceType === 'camera' || sourceType === 'screen') && captureStream ? (
          <div className="flex items-center gap-1.5 bg-[#0B0E14]/90 border border-blue-500/40 text-blue-200 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded text-[10px] sm:text-[11px] font-medium">
            <Camera className="w-3 h-3 text-blue-400 shrink-0" />
            <span>{sourceType === 'camera' ? 'Camera Preview (Record to Upload)' : 'Screen Preview (Record to Upload)'}</span>
          </div>
        ) : null}
      </div>

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
                bottom: isBottomLogo ? `${bottomOffsetPx}px` : undefined,
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
                fontSize: `clamp(11px, 2.8vw, ${Math.max(12, Math.round(overlays.headlineFontSize * 0.58))}px)`,
              }}
              className={`absolute top-3 inset-x-3 px-3 py-1.5 rounded font-semibold tracking-tight truncate ${headlineAnimClass}`}
            >
              {overlays.headlineText}
            </div>
          )}

          {overlays.lowerThirdEnabled &&
            (overlays.lowerThirdTitle.trim() || overlays.lowerThirdSubtitle.trim()) && (
              <div
                key={`lt-${overlays.lowerThirdTitle}-${overlays.lowerThirdAnimation}`}
                style={{
                  bottom: `${overlays.tickerEnabled ? tickerHeightPx + 10 : 12}px`,
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

          {overlays.tickerEnabled && overlays.tickerText.trim().length > 0 && (
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
                  fontSize: `clamp(11px, 2.5vw, ${Math.max(11, Math.round(overlays.tickerFontSize * 0.68))}px)`,
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
