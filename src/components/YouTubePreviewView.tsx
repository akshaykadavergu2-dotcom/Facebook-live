import { useState } from 'react';
import { ArrowRight, ExternalLink, Film, Info } from 'lucide-react';
import type { YouTubeValidationResult } from '../../shared/types';
import type { NavSection } from './Sidebar';
import { YouTubeMonitorCard } from './YouTubeMonitorCard';

interface YouTubePreviewViewProps {
  youtubeResult: YouTubeValidationResult | null;
  onYouTubeValidated: (res: YouTubeValidationResult | null) => void;
  onNavigate: (section: NavSection) => void;
}

export function YouTubePreviewView({
  youtubeResult,
  onYouTubeValidated,
  onNavigate,
}: YouTubePreviewViewProps) {
  const [thumbFailed, setThumbFailed] = useState(false);

  return (
    <div className="space-y-5 max-w-6xl min-w-0">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start min-w-0">
        {/* Monitor A: Dedicated YouTube Player + Transport Controls */}
        <div className="xl:col-span-8 min-w-0">
          <YouTubeMonitorCard
            youtubeResult={youtubeResult}
            onYouTubeValidated={(res) => {
              setThumbFailed(false);
              onYouTubeValidated(res);
            }}
            showComplianceNote
          />
        </div>

        {/* Metadata & Compliance Details */}
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
                    <span className="text-slate-400">Monitor Mode</span>
                    <span className="font-semibold text-amber-300">Preview Only</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-400">FFmpeg RTMP Input</span>
                    <span className="font-mono text-rose-300">Disabled (Compliance)</span>
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
                  Paste a YouTube Live or video link to validate its ID and preview it inside Monitor A.
                </p>
              </div>
            )}
          </section>

          <section className="bg-[#121721] border border-amber-500/30 rounded-2xl p-4 sm:p-5 space-y-3 min-w-0">
            <div className="flex items-start gap-2.5">
              <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1.5 text-xs min-w-0">
                <div className="font-semibold text-amber-200">Dual-Monitor Studio Workflow</div>
                <p className="text-slate-300 leading-relaxed">
                  YouTube Live plays independently inside Monitor A using the official YouTube IFrame Player API. It never blocks or replaces your authorized Facebook broadcast source.
                </p>
                <p className="text-slate-400 leading-relaxed">
                  To broadcast to Facebook Live via RTMPS, pick an uploaded MP4/MOV/WebM clip or an authorized direct URL/RTMP/SRT feed in Live Studio Monitor B.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onNavigate('studio')}
              className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-[#181F2C] hover:bg-[#222C3E] border border-[#2C374C] text-xs font-semibold text-slate-100 flex items-center justify-center gap-2 transition-colors"
            >
              <span>Open Dual-Monitor Live Studio</span>
              <ArrowRight className="w-4 h-4 text-blue-400 shrink-0" />
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
