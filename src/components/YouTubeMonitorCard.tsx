import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ExternalLink,
  Maximize2,
  Pause,
  Play,
  Volume2,
  VolumeX,
  X,
  Youtube,
} from 'lucide-react';
import type { YouTubeValidationResult } from '../../shared/types';
import { api, formatDuration } from '../lib/api';

interface YTPlayerInstance {
  destroy: () => void;
  playVideo?: () => void;
  pauseVideo?: () => void;
  mute?: () => void;
  unMute?: () => void;
  isMuted?: () => boolean;
  getDuration?: () => number;
  getPlayerState?: () => number;
  getIframe?: () => HTMLIFrameElement;
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement | string,
        options: {
          videoId: string;
          playerVars?: Record<string, string | number>;
          events?: {
            onReady?: (e: { target: YTPlayerInstance }) => void;
            onStateChange?: (e: { data: number; target: YTPlayerInstance }) => void;
            onError?: (e: { data: number }) => void;
          };
        },
      ) => YTPlayerInstance;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

type YtPlaybackState =
  | 'Idle'
  | 'Connecting'
  | 'Ready'
  | 'Playing'
  | 'Paused'
  | 'Buffering'
  | 'Ended'
  | 'Restricted';

interface YouTubeMonitorCardProps {
  youtubeResult: YouTubeValidationResult | null;
  onYouTubeValidated: (res: YouTubeValidationResult | null) => void;
  showComplianceNote?: boolean;
}

export function YouTubeMonitorCard({
  youtubeResult,
  onYouTubeValidated,
  showComplianceNote = false,
}: YouTubeMonitorCardProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageWrapperRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayerInstance | null>(null);

  const [urlInput, setUrlInput] = useState(youtubeResult?.watchUrl || '');
  const [validating, setValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [controlNotice, setControlNotice] = useState<string | null>(null);

  const [playbackState, setPlaybackState] = useState<YtPlaybackState>('Idle');
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [durationSec, setDurationSec] = useState<number>(0);

  useEffect(() => {
    if (youtubeResult?.watchUrl && !urlInput) {
      setUrlInput(youtubeResult.watchUrl);
    }
  }, [youtubeResult?.watchUrl, urlInput]);

  useEffect(() => {
    if (!youtubeResult?.valid || !youtubeResult.videoId) {
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // ignore
        }
        playerRef.current = null;
      }
      setPlayerError(null);
      setPlaybackState('Idle');
      setDurationSec(0);
      setIsMuted(false);
      return;
    }

    let cancelled = false;
    const videoId = youtubeResult.videoId;
    setPlayerError(null);
    setControlNotice(null);
    setPlaybackState('Connecting');

    const mapYtState = (code: number): YtPlaybackState => {
      switch (code) {
        case 1:
          return 'Playing';
        case 2:
          return 'Paused';
        case 3:
          return 'Buffering';
        case 0:
          return 'Ended';
        case 5:
        case -1:
        default:
          return 'Ready';
      }
    };

    const mountPlayer = () => {
      if (cancelled || !containerRef.current || !window.YT?.Player) return;
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // ignore
        }
      }
      containerRef.current.innerHTML = '';
      const hostEl = document.createElement('div');
      hostEl.className = 'w-full h-full';
      containerRef.current.appendChild(hostEl);

      playerRef.current = new window.YT.Player(hostEl, {
        videoId,
        playerVars: {
          autoplay: 0,
          controls: 1,
          enablejsapi: 1,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          ...(typeof window !== 'undefined' && window.location?.origin
            ? {
                origin: window.location.origin,
                widget_referrer: window.location.href,
              }
            : {}),
        },
        events: {
          onReady: (e) => {
            if (cancelled) return;
            setPlaybackState('Ready');
            try {
              const muted = e.target.isMuted?.();
              if (typeof muted === 'boolean') setIsMuted(muted);
              const dur = e.target.getDuration?.();
              if (typeof dur === 'number' && Number.isFinite(dur) && dur > 0) {
                setDurationSec(Math.floor(dur));
              }
            } catch {
              // ignore
            }
          },
          onStateChange: (e) => {
            if (cancelled) return;
            setPlaybackState(mapYtState(e.data));
            try {
              const muted = e.target.isMuted?.();
              if (typeof muted === 'boolean') setIsMuted(muted);
              const dur = e.target.getDuration?.();
              if (typeof dur === 'number' && Number.isFinite(dur) && dur > 0) {
                setDurationSec(Math.floor(dur));
              }
            } catch {
              // ignore
            }
          },
          onError: (e) => {
            if (cancelled) return;
            setPlaybackState('Restricted');
            setPlayerError(
              e.data === 101 || e.data === 150 || e.data === 153
                ? `YouTube embed restricted for this stream/frame (Error ${e.data}). Open directly on YouTube, or select an authorized MP4/RTMP/SRT source on Monitor B.`
                : `YouTube IFrame Player error code ${e.data}.`,
            );
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
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // ignore
        }
        playerRef.current = null;
      }
    };
  }, [youtubeResult?.valid, youtubeResult?.videoId]);

  const handleLoadYouTube = async () => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    setValidating(true);
    setValidationError(null);
    setControlNotice(null);
    try {
      const res = await api.validateYouTube(trimmed);
      if (!res.valid) {
        setValidationError(res.explanation);
      } else {
        onYouTubeValidated(res);
      }
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : 'Failed to validate YouTube URL.');
    } finally {
      setValidating(false);
    }
  };

  const handleClear = () => {
    setUrlInput('');
    setValidationError(null);
    setPlayerError(null);
    setControlNotice(null);
    onYouTubeValidated(null);
  };

  const handlePlay = () => {
    setControlNotice(null);
    try {
      playerRef.current?.playVideo?.();
    } catch {
      setControlNotice('Tap inside the YouTube player frame once to allow mobile playback.');
    }
  };

  const handlePause = () => {
    setControlNotice(null);
    try {
      playerRef.current?.pauseVideo?.();
    } catch {
      // ignore
    }
  };

  const handleToggleMute = () => {
    setControlNotice(null);
    const p = playerRef.current;
    if (!p) return;
    try {
      const currentlyMuted = p.isMuted ? p.isMuted() : isMuted;
      if (currentlyMuted) {
        p.unMute?.();
        setIsMuted(false);
      } else {
        p.mute?.();
        setIsMuted(true);
      }
    } catch {
      setControlNotice('Use the YouTube player volume control directly.');
    }
  };

  const handleFullscreen = async () => {
    setControlNotice(null);
    const iframe = playerRef.current?.getIframe?.();
    const target: (HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void }) | null =
      iframe || stageWrapperRef.current;
    if (!target) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      if (target.requestFullscreen) {
        await target.requestFullscreen();
      } else if (target.webkitRequestFullscreen) {
        target.webkitRequestFullscreen();
      } else {
        setControlNotice('Fullscreen API is restricted in this embedded mobile container.');
      }
    } catch {
      setControlNotice('Fullscreen blocked by mobile browser frame; tap the player’s native expand icon.');
    }
  };

  const hasValidVideo = Boolean(youtubeResult?.valid && youtubeResult.videoId);

  return (
    <section className="bg-[#121721] border border-[#232B3A] rounded-2xl p-3 sm:p-4 space-y-3 min-w-0 flex flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Youtube className="w-4 h-4 text-rose-400 shrink-0" />
            <h2 className="text-sm sm:text-base font-semibold text-slate-100 truncate">
              Monitor A · YouTube Preview
            </h2>
          </div>
          <p className="text-[11px] sm:text-xs text-slate-400 truncate">
            Official YouTube IFrame Player · Preview Only (never sent to FFmpeg)
          </p>
        </div>
        <span
          className={`text-[11px] font-mono font-semibold shrink-0 ${
            playbackState === 'Playing'
              ? 'text-emerald-400'
              : playbackState === 'Restricted'
                ? 'text-rose-400'
                : hasValidVideo
                  ? 'text-amber-300'
                  : 'text-slate-500'
          }`}
        >
          {playbackState}
        </span>
      </div>

      {/* URL Paste + Load + Clear */}
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="url"
          inputMode="url"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && urlInput.trim() && !validating) {
              handleLoadYouTube();
            }
          }}
          placeholder="Paste youtube.com/live/..., watch?v=..., or youtu.be/..."
          aria-label="YouTube Live or Video Share URL"
          className="flex-1 min-w-0 min-h-[44px] bg-[#0B0E14] border border-[#263042] rounded-xl px-3 py-2 text-xs sm:text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
        />
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleLoadYouTube}
            disabled={validating || !urlInput.trim()}
            className="flex-1 sm:flex-initial min-h-[44px] px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white text-xs font-semibold disabled:opacity-50 whitespace-nowrap"
          >
            {validating ? 'Loading...' : 'Load Preview'}
          </button>
          {(hasValidVideo || urlInput.trim().length > 0) && (
            <button
              type="button"
              onClick={handleClear}
              aria-label="Clear YouTube source"
              className="min-h-[44px] px-3 py-2 rounded-xl border border-[#2C374C] bg-[#181F2C] hover:bg-[#222C3E] text-slate-300 text-xs font-medium flex items-center gap-1 whitespace-nowrap"
            >
              <X className="w-3.5 h-3.5 shrink-0" />
              <span>Clear</span>
            </button>
          )}
        </div>
      </div>

      {validationError && (
        <div className="p-2.5 rounded-xl bg-rose-950/35 border border-rose-500/40 text-xs text-rose-200 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <span className="break-words min-w-0">{validationError}</span>
        </div>
      )}

      {/* 16:9 YouTube Player Frame */}
      <div
        ref={stageWrapperRef}
        className="relative w-full aspect-video bg-[#07090D] rounded-xl overflow-hidden border border-[#232B3A]"
      >
        {hasValidVideo ? (
          <>
            <div ref={containerRef} className="w-full h-full" />
            {playerError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0B0E14]/95 p-4 text-center gap-3 z-20">
                <AlertTriangle className="w-7 h-7 text-amber-400" />
                <p className="text-xs sm:text-sm font-medium text-slate-200 max-w-md">{playerError}</p>
                {youtubeResult?.watchUrl && (
                  <a
                    href={youtubeResult.watchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-[44px] px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <span>Watch on YouTube</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center bg-[#090C11]">
            <div className="w-11 h-11 rounded-xl bg-[#141A24] border border-[#232B3A] flex items-center justify-center mb-2">
              <Youtube className="w-5 h-5 text-slate-400" />
            </div>
            <p className="text-xs sm:text-sm font-medium text-slate-200">No YouTube Preview Loaded</p>
            <p className="text-[11px] sm:text-xs text-slate-400 mt-1 max-w-sm">
              Paste a YouTube Live, watch, or youtu.be URL above to monitor it independently alongside your Facebook broadcast.
            </p>
          </div>
        )}
      </div>

      {/* Player Controls Row */}
      <div className="grid grid-cols-4 gap-2">
        <button
          type="button"
          onClick={handlePlay}
          disabled={!hasValidVideo}
          className="min-h-[44px] px-2 rounded-xl border border-[#2A3447] bg-[#0E131B] hover:bg-[#192231] disabled:opacity-40 text-slate-200 text-xs font-medium flex items-center justify-center gap-1.5"
        >
          <Play className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span>Play</span>
        </button>
        <button
          type="button"
          onClick={handlePause}
          disabled={!hasValidVideo}
          className="min-h-[44px] px-2 rounded-xl border border-[#2A3447] bg-[#0E131B] hover:bg-[#192231] disabled:opacity-40 text-slate-200 text-xs font-medium flex items-center justify-center gap-1.5"
        >
          <Pause className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>Pause</span>
        </button>
        <button
          type="button"
          onClick={handleToggleMute}
          disabled={!hasValidVideo}
          className="min-h-[44px] px-2 rounded-xl border border-[#2A3447] bg-[#0E131B] hover:bg-[#192231] disabled:opacity-40 text-slate-200 text-xs font-medium flex items-center justify-center gap-1.5"
        >
          {isMuted ? (
            <VolumeX className="w-3.5 h-3.5 text-rose-400 shrink-0" />
          ) : (
            <Volume2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          )}
          <span>{isMuted ? 'Unmute' : 'Mute'}</span>
        </button>
        <button
          type="button"
          onClick={handleFullscreen}
          disabled={!hasValidVideo}
          className="min-h-[44px] px-2 rounded-xl border border-[#2A3447] bg-[#0E131B] hover:bg-[#192231] disabled:opacity-40 text-slate-200 text-xs font-medium flex items-center justify-center gap-1.5"
        >
          <Maximize2 className="w-3.5 h-3.5 text-slate-300 shrink-0" />
          <span className="truncate">Full</span>
        </button>
      </div>

      {controlNotice && (
        <p className="text-[11px] text-amber-300 px-0.5">{controlNotice}</p>
      )}

      {/* Honest Telemetry Readout */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="bg-[#0E131B] border border-[#232B3A] rounded-xl px-2.5 py-2 min-w-0 col-span-2">
          <div className="text-[10px] text-slate-400">Source Name</div>
          <div className="text-xs font-medium text-slate-100 truncate mt-0.5">
            {hasValidVideo ? youtubeResult?.title || `YouTube (${youtubeResult?.videoId})` : 'None Loaded'}
          </div>
        </div>
        <div className="bg-[#0E131B] border border-[#232B3A] rounded-xl px-2.5 py-2 min-w-0">
          <div className="text-[10px] text-slate-400">Duration</div>
          <div className="text-xs font-semibold text-slate-100 font-mono tabular-nums truncate mt-0.5">
            {!hasValidVideo ? '00:00:00' : durationSec > 0 ? formatDuration(durationSec) : 'Live / Auto'}
          </div>
        </div>
        <div className="bg-[#0E131B] border border-[#232B3A] rounded-xl px-2.5 py-2 min-w-0">
          <div className="text-[10px] text-slate-400">Audio / Mode</div>
          <div className="text-xs font-medium text-amber-300 truncate mt-0.5">
            {!hasValidVideo ? 'Idle' : `${isMuted ? 'Muted' : 'Audio On'} · Preview`}
          </div>
        </div>
      </div>

      {showComplianceNote && (
        <p className="text-[11px] text-slate-400 leading-relaxed pt-0.5">
          Supported links: standard <code className="font-mono text-slate-300">watch?v=</code>,{' '}
          <code className="font-mono text-slate-300">youtu.be/</code>, and{' '}
          <code className="font-mono text-slate-300">/live/</code> URLs. Plays locally in Monitor A only — never extracted or forwarded to FFmpeg.
        </p>
      )}
    </section>
  );
}
