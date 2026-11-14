import { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ExternalLink,
  Film,
  Info,
  Play,
  Youtube,
} from 'lucide-react';
import type {
  OverlayConfig,
  StreamStatusState,
  YouTubeValidationResult,
} from '../../shared/types';
import { api } from '../lib/api';
import type { NavSection } from './Sidebar';
import { VideoPreviewStage } from './VideoPreviewStage';

interface YouTubePreviewViewProps {
  youtubeResult: YouTubeValidationResult | null;
  onYouTubeValidated: (res: YouTubeValidationResult | null) => void;
  overlays: OverlayConfig;
  streamStatus: StreamStatusState;
  onUseInStudioMonitor: () => void;
  onNavigate: (section: NavSection) => void;
}

export function YouTubePreviewView({
  youtubeResult,
  onYouTubeValidated,
  overlays,
  streamStatus,
  onUseInStudioMonitor,
  onNavigate,
}: YouTubePreviewViewProps) {
  const [urlInput, setUrlInput] = useState(youtubeResult?.watchUrl || '');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showOverlays, setShowOverlays] = useState(true);
  const [thumbFailed, setThumbFailed] = useState(false);

  const handleValidate = async (targetUrl?: string) => {
    const candidate = (targetUrl ?? urlInput).trim();
    if (!candidate) return;
    setLoading(true);
    setErrorMsg(null);
    setThumbFailed(false);
    try {
      const result = await api.validateYouTube(candidate);
      onYouTubeValidated(result);
      onUseInStudioMonitor();
      if (!result.valid) {
        setErrorMsg(result.explanation);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to validate YouTube URL.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5 max-w-6xl min-w-0">
      {/* URL Input Card */}
      <section className="bg-[#121721] border border-[#232B3A] rounded-2xl p-4 sm:p-5 space-y-4 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
              <Youtube className="w-4 h-4 text-rose-400 shrink-0" />
              <span>YouTube Live &amp; Video Input</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Validate any YouTube Live share URL or regular video link for official IFrame preview.
            </p>
          </div>
          <span className="text-xs font-mono text-amber-300 shrink-0">
            Source Status · Preview Only
          </span>
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5">
          <input
            type="url"
            inputMode="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Paste https://youtube.com/live/... or https://youtu.be/..."
            aria-label="YouTube Live or Video Share URL"
            className="flex-1 min-w-0 min-h-[44px] bg-[#0B0E14] border border-[#263042] rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
          />
          <button
            type="button"
            onClick={() => handleValidate()}
            disabled={loading || !urlInput.trim()}
            className="min-h-[44px] px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 transition-all whitespace-nowrap shrink-0"
          >
            <Play className="w-4 h-4 shrink-0" />
            <span>{loading ? 'Validating...' : 'Load Preview'}</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
          <span>Supported formats:</span>
          <span className="font-mono text-slate-300">youtube.com/live/ID</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono text-slate-300">youtu.be/ID</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono text-slate-300">youtube.com/watch?v=ID</span>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-xl bg-rose-950/35 border border-rose-500/40 text-xs text-rose-200 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span className="break-words min-w-0">{errorMsg}</span>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start min-w-0">
        {/* Embedded Official YouTube 16:9 Stage */}
        <section className="xl:col-span-8 bg-[#121721] border border-[#232B3A] rounded-2xl p-3 sm:p-4 space-y-3 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3 px-1">
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-semibold text-slate-100">
                Official YouTube Embedded Preview
              </h3>
              <p className="text-xs text-slate-400">
                Rendered with the official YouTube IFrame Player API
              </p>
            </div>
            <label className="min-h-[44px] flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none px-2">
              <input
                type="checkbox"
                checked={showOverlays}
                onChange={(e) => setShowOverlays(e.target.checked)}
                className="w-4 h-4 rounded border-[#2E384B] bg-[#0B0E14] text-blue-600 focus:ring-blue-500"
              />
              <span>Preview Overlays</span>
            </label>
          </div>

          <VideoPreviewStage
            sourceType="youtube-preview"
            selectedVideo={null}
            directUrl=""
            youtubeResult={youtubeResult}
            overlays={overlays}
            streamStatus={streamStatus}
            showOverlays={showOverlays}
          />
        </section>

        {/* Metadata & Compliance Explanation */}
        <div className="xl:col-span-4 space-y-4 min-w-0">
          <section className="bg-[#121721] border border-[#232B3A] rounded-2xl p-4 sm:p-5 space-y-4 min-w-0">
            <h3 className="text-sm font-semibold text-slate-100">Extracted Source Metadata</h3>

            {youtubeResult?.valid ? (
              <div className="space-y-3 min-w-0">
                {youtubeResult.thumbnailUrl && !thumbFailed ? (
                  <div className="aspect-video rounded-xl overflow-hidden bg-[#090C11] border border-[#232B3A]">
                    <img
                      src={youtubeResult.thumbnailUrl}
                      alt={youtubeResult.title || 'YouTube thumbnail'}
                      referrerPolicy="no-referrer"
                      onError={() => setThumbFailed(true)}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="aspect-video rounded-xl bg-[#090C11] border border-[#232B3A] flex flex-col items-center justify-center text-slate-500 gap-1.5">
                    <Film className="w-6 h-6" />
                    <span className="text-xs">Thumbnail preview unavailable</span>
                  </div>
                )}

                <div className="space-y-1.5 min-w-0">
                  <div className="text-sm font-semibold text-slate-100 break-words">
                    {youtubeResult.title}
                  </div>
                  <div className="text-xs text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span>{youtubeResult.authorName}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono text-slate-300">ID: {youtubeResult.videoId}</span>
                  </div>
                </div>

                <div className="pt-2 border-t border-[#232B3A] space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-400">Source Status</span>
                    <span className="font-semibold text-amber-300">Preview Only</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-400">FFmpeg RTMP Eligible</span>
                    <span className="font-mono text-rose-300">No</span>
                  </div>
                  {youtubeResult.watchUrl && (
                    <a
                      href={youtubeResult.watchUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-blue-400 hover:text-blue-300 pt-1 min-h-[36px]"
                    >
                      <span>Open on YouTube</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <div className="py-6 text-center text-xs text-slate-400 space-y-1">
                <p>No YouTube URL loaded yet.</p>
                <p className="text-slate-500">
                  Paste a live stream or video link above to extract its ID and load the official preview.
                </p>
              </div>
            )}
          </section>

          <section className="bg-[#121721] border border-amber-500/30 rounded-2xl p-4 sm:p-5 space-y-3 min-w-0">
            <div className="flex items-start gap-2.5">
              <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1.5 text-xs min-w-0">
                <div className="font-semibold text-amber-200">Why YouTube Is Preview-Only</div>
                <p className="text-slate-300 leading-relaxed">
                  YouTube share URLs run inside the official YouTube IFrame Player API and cannot be extracted or captured by server-side FFmpeg without violating platform restrictions.
                </p>
                <p className="text-slate-400 leading-relaxed">
                  To broadcast to Facebook Live via RTMPS, switch to an uploaded MP4/MOV/WebM file or an authorized direct media URL in Live Studio.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onNavigate('studio')}
              className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-[#181F2C] hover:bg-[#222C3E] border border-[#2C374C] text-xs font-semibold text-slate-100 flex items-center justify-center gap-2 transition-colors"
            >
              <span>Select Broadcast Source in Live Studio</span>
              <ArrowRight className="w-4 h-4 text-blue-400 shrink-0" />
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
