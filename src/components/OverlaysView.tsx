import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ImagePlus, Save, Trash2 } from 'lucide-react';
import type {
  AndroidCaptureTelemetry,
  ClockFormat,
  LogoPosition,
  OverlayConfig,
  StreamStatusState,
  VideoAsset,
} from '../../shared/types';
import { api } from '../lib/api';
import { VideoPreviewStage, type ProgramMonitorSource } from './VideoPreviewStage';

interface OverlaysViewProps {
  overlays: OverlayConfig;
  onOverlaysUpdated: (next: OverlayConfig) => void;
  sourceType: ProgramMonitorSource;
  selectedVideo: VideoAsset | null;
  directUrl: string;
  captureStream?: MediaStream | null;
  captureTelemetry?: AndroidCaptureTelemetry | null;
  streamStatus: StreamStatusState;
}

export function OverlaysView({
  overlays,
  onOverlaysUpdated,
  sourceType,
  selectedVideo,
  directUrl,
  captureStream = null,
  captureTelemetry = null,
  streamStatus,
}: OverlaysViewProps) {
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState<OverlayConfig>(overlays);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [removingLogo, setRemovingLogo] = useState(false);
  const [showOverlayPreview, setShowOverlayPreview] = useState(true);
  const [statusMsg, setStatusMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    setDraft(overlays);
  }, [overlays]);

  const updateField = <K extends keyof OverlayConfig>(key: K, value: OverlayConfig[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setStatusMsg(null);
    try {
      const saved = await api.saveOverlays(draft);
      setDraft(saved);
      onOverlaysUpdated(saved);
      setStatusMsg({
        type: 'ok',
        text: 'Overlays saved on backend and burned into Facebook Program Output on broadcast start.',
      });
    } catch (err) {
      setStatusMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to save overlay settings.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleUploadLogo = async (file: File | undefined) => {
    if (!file) return;
    setUploadingLogo(true);
    setStatusMsg(null);
    try {
      const updated = await api.uploadOverlayLogo(file);
      setDraft(updated);
      onOverlaysUpdated(updated);
      setStatusMsg({ type: 'ok', text: 'Transparent PNG logo uploaded.' });
    } catch (err) {
      setStatusMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'PNG logo upload failed.',
      });
    } finally {
      setUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  };

  const handleDeleteLogo = async () => {
    setRemovingLogo(true);
    setStatusMsg(null);
    try {
      const updated = await api.deleteOverlayLogo();
      setDraft(updated);
      onOverlaysUpdated(updated);
      setStatusMsg({ type: 'ok', text: 'Logo overlay removed.' });
    } catch (err) {
      setStatusMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to remove logo.',
      });
    } finally {
      setRemovingLogo(false);
    }
  };

  const programSource: ProgramMonitorSource =
    sourceType === 'youtube-preview' ? 'uploaded' : sourceType;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start min-w-0">
      <div className="xl:col-span-7 space-y-4 min-w-0 xl:sticky xl:top-6">
        <section className="bg-[#121721] border border-[#232B3A] rounded-2xl p-4 sm:p-5 space-y-4 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-100">
                Facebook Program Output Overlay Stage
              </h2>
              <p className="text-xs text-slate-400">
                Renders live on Monitor B and burns directly into FFmpeg RTMPS Facebook output.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowOverlayPreview((v) => !v)}
                className="min-h-[44px] px-3.5 py-2 rounded-xl border border-[#2C374C] bg-[#181F2C] hover:bg-[#222C3E] text-slate-200 text-xs font-medium whitespace-nowrap"
              >
                {showOverlayPreview ? 'Hide Overlays' : 'Preview Overlays'}
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-2 disabled:opacity-50 whitespace-nowrap"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{saving ? 'Saving...' : 'Save Overlays'}</span>
              </button>
            </div>
          </div>

          <VideoPreviewStage
            sourceType={programSource}
            selectedVideo={selectedVideo}
            directUrl={directUrl}
            captureStream={captureStream}
            captureTelemetry={captureTelemetry}
            overlays={draft}
            streamStatus={streamStatus}
            showOverlays={showOverlayPreview}
          />

          {statusMsg && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                statusMsg.type === 'ok'
                  ? 'bg-emerald-950/25 border-emerald-500/35 text-emerald-200'
                  : 'bg-rose-950/25 border-rose-500/35 text-rose-200'
              }`}
            >
              {statusMsg.type === 'ok' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0" />
              )}
              <span>{statusMsg.text}</span>
            </div>
          )}
        </section>
      </div>

      <div className="xl:col-span-5 space-y-5 min-w-0">
        {/* 01. Corner Logo */}
        <section className="bg-[#121721] border border-[#232B3A] rounded-2xl p-4 sm:p-5 space-y-4 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-100">01. Corner Logo (Transparent PNG)</h3>
            <label className="min-h-[44px] flex items-center gap-2 text-xs text-slate-300 cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={draft.logoEnabled}
                onChange={(e) => updateField('logoEnabled', e.target.checked)}
                className="w-4 h-4 rounded border-[#2E384B] bg-[#0B0E14] text-blue-600"
              />
              <span>Enabled</span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => logoInputRef.current?.click()}
              disabled={uploadingLogo}
              className="min-h-[44px] px-3.5 py-2 rounded-xl bg-[#181F2C] hover:bg-[#212B3D] border border-[#2C374C] text-xs font-medium text-slate-100 flex items-center gap-2 disabled:opacity-50"
            >
              <ImagePlus className="w-3.5 h-3.5 text-blue-400" />
              <span>{uploadingLogo ? 'Uploading PNG...' : 'Upload PNG Logo'}</span>
            </button>
            {draft.logoUrl && (
              <button
                type="button"
                onClick={handleDeleteLogo}
                disabled={removingLogo}
                className="min-h-[44px] px-3.5 py-2 rounded-xl border border-[#2C374C] text-xs text-rose-400 hover:bg-rose-950/30 flex items-center gap-1.5 disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{removingLogo ? 'Removing...' : 'Remove'}</span>
              </button>
            )}
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,.png"
              className="hidden"
              onChange={(e) => handleUploadLogo(e.target.files?.[0])}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Corner Position</label>
              <select
                value={draft.logoPosition}
                onChange={(e) => updateField('logoPosition', e.target.value as LogoPosition)}
                className="w-full min-h-[44px] bg-[#0B0E14] border border-[#263042] rounded-xl px-3 py-2 text-xs text-slate-100"
              >
                <option value="top-left">Top Left</option>
                <option value="top-right">Top Right</option>
                <option value="bottom-left">Bottom Left</option>
                <option value="bottom-right">Bottom Right</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Scale ({draft.logoScale}% width)
              </label>
              <input
                type="range"
                min={5}
                max={30}
                value={draft.logoScale}
                onChange={(e) => updateField('logoScale', Number(e.target.value))}
                className="w-full accent-blue-600 mt-2"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Logo Opacity ({Math.round(draft.logoOpacity * 100)}%)
            </label>
            <input
              type="range"
              min={10}
              max={100}
              value={Math.round(draft.logoOpacity * 100)}
              onChange={(e) => updateField('logoOpacity', Number(e.target.value) / 100)}
              className="w-full accent-blue-600"
            />
          </div>
        </section>

        {/* 02. Headline Text */}
        <section className="bg-[#121721] border border-[#232B3A] rounded-2xl p-4 sm:p-5 space-y-3 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-100">02. Headline Text Banner</h3>
            <label className="min-h-[44px] flex items-center gap-2 text-xs text-slate-300 cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={draft.headlineEnabled}
                onChange={(e) => updateField('headlineEnabled', e.target.checked)}
                className="w-4 h-4 rounded border-[#2E384B] bg-[#0B0E14] text-blue-600"
              />
              <span>Enabled</span>
            </label>
          </div>

          <input
            type="text"
            value={draft.headlineText}
            onChange={(e) => updateField('headlineText', e.target.value)}
            placeholder="Top headline bar text..."
            className="w-full min-h-[44px] bg-[#0B0E14] border border-[#263042] rounded-xl px-3 py-2 text-xs text-slate-100"
          />

          <div className="grid grid-cols-3 gap-2.5">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Font Size</label>
              <input
                type="number"
                min={16}
                max={64}
                value={draft.headlineFontSize}
                onChange={(e) => updateField('headlineFontSize', Number(e.target.value))}
                className="w-full min-h-[44px] bg-[#0B0E14] border border-[#263042] rounded-xl px-2.5 py-1.5 text-xs font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Text Color</label>
              <input
                type="color"
                value={draft.headlineColor}
                onChange={(e) => updateField('headlineColor', e.target.value)}
                className="w-full h-11 bg-[#0B0E14] border border-[#263042] rounded-xl cursor-pointer"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Background</label>
              <input
                type="color"
                value={draft.headlineBgColor}
                onChange={(e) => updateField('headlineBgColor', e.target.value)}
                className="w-full h-11 bg-[#0B0E14] border border-[#263042] rounded-xl cursor-pointer"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Animation</label>
              <select
                value={draft.headlineAnimation}
                onChange={(e) =>
                  updateField('headlineAnimation', e.target.value as 'static' | 'fade' | 'slide')
                }
                className="w-full min-h-[44px] bg-[#0B0E14] border border-[#263042] rounded-xl px-2.5 py-1.5 text-xs text-slate-100"
              >
                <option value="static">Static</option>
                <option value="fade">Fade In</option>
                <option value="slide">Slide In</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                Bg Opacity ({Math.round(draft.headlineBgOpacity * 100)}%)
              </label>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(draft.headlineBgOpacity * 100)}
                onChange={(e) => updateField('headlineBgOpacity', Number(e.target.value) / 100)}
                className="w-full accent-blue-600 mt-2.5"
              />
            </div>
          </div>
        </section>

        {/* 03. Breaking News Banner */}
        <section className="bg-[#121721] border border-[#232B3A] rounded-2xl p-4 sm:p-5 space-y-3 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-100">03. Breaking News Banner</h3>
            <label className="min-h-[44px] flex items-center gap-2 text-xs text-slate-300 cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={draft.breakingNewsEnabled}
                onChange={(e) => updateField('breakingNewsEnabled', e.target.checked)}
                className="w-4 h-4 rounded border-[#2E384B] bg-[#0B0E14] text-blue-600"
              />
              <span>Enabled</span>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <input
              type="text"
              value={draft.breakingNewsLabel}
              onChange={(e) => updateField('breakingNewsLabel', e.target.value)}
              placeholder="BREAKING NEWS"
              className="w-full min-h-[44px] bg-[#0B0E14] border border-[#263042] rounded-xl px-3 py-2 text-xs font-bold uppercase text-slate-100"
            />
            <input
              type="text"
              value={draft.breakingNewsText}
              onChange={(e) => updateField('breakingNewsText', e.target.value)}
              placeholder="Live update headline text..."
              className="sm:col-span-2 w-full min-h-[44px] bg-[#0B0E14] border border-[#263042] rounded-xl px-3 py-2 text-xs text-slate-100"
            />
          </div>

          <div className="grid grid-cols-3 gap-2.5 items-center">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Badge Color</label>
              <input
                type="color"
                value={draft.breakingNewsBgColor}
                onChange={(e) => updateField('breakingNewsBgColor', e.target.value)}
                className="w-full h-11 bg-[#0B0E14] border border-[#263042] rounded-xl cursor-pointer"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Text Color</label>
              <input
                type="color"
                value={draft.breakingNewsTextColor}
                onChange={(e) => updateField('breakingNewsTextColor', e.target.value)}
                className="w-full h-11 bg-[#0B0E14] border border-[#263042] rounded-xl cursor-pointer"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                Opacity ({Math.round(draft.breakingNewsOpacity * 100)}%)
              </label>
              <input
                type="range"
                min={20}
                max={100}
                value={Math.round(draft.breakingNewsOpacity * 100)}
                onChange={(e) => updateField('breakingNewsOpacity', Number(e.target.value) / 100)}
                className="w-full accent-blue-600 mt-2"
              />
            </div>
          </div>
        </section>

        {/* 04. Date & Live Clock */}
        <section className="bg-[#121721] border border-[#232B3A] rounded-2xl p-4 sm:p-5 space-y-3 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-100">04. Date &amp; Live Clock</h3>
            <label className="min-h-[44px] flex items-center gap-2 text-xs text-slate-300 cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={draft.clockEnabled}
                onChange={(e) => updateField('clockEnabled', e.target.checked)}
                className="w-4 h-4 rounded border-[#2E384B] bg-[#0B0E14] text-blue-600"
              />
              <span>Enabled</span>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Corner Position</label>
              <select
                value={draft.clockPosition}
                onChange={(e) => updateField('clockPosition', e.target.value as LogoPosition)}
                className="w-full min-h-[44px] bg-[#0B0E14] border border-[#263042] rounded-xl px-3 py-2 text-xs text-slate-100"
              >
                <option value="top-left">Top Left</option>
                <option value="top-right">Top Right</option>
                <option value="bottom-left">Bottom Left</option>
                <option value="bottom-right">Bottom Right</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Display Format</label>
              <select
                value={draft.clockFormat}
                onChange={(e) => updateField('clockFormat', e.target.value as ClockFormat)}
                className="w-full min-h-[44px] bg-[#0B0E14] border border-[#263042] rounded-xl px-3 py-2 text-xs text-slate-100"
              >
                <option value="date-time">Date + Live Time (24h)</option>
                <option value="time-24h">Live Time Only (24h)</option>
                <option value="time-12h">Live Time Only (12h AM/PM)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Font Size</label>
              <input
                type="number"
                min={12}
                max={36}
                value={draft.clockFontSize}
                onChange={(e) => updateField('clockFontSize', Number(e.target.value))}
                className="w-full min-h-[44px] bg-[#0B0E14] border border-[#263042] rounded-xl px-2.5 py-1.5 text-xs font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Text Color</label>
              <input
                type="color"
                value={draft.clockColor}
                onChange={(e) => updateField('clockColor', e.target.value)}
                className="w-full h-11 bg-[#0B0E14] border border-[#263042] rounded-xl cursor-pointer"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Plate Color</label>
              <input
                type="color"
                value={draft.clockBgColor}
                onChange={(e) => updateField('clockBgColor', e.target.value)}
                className="w-full h-11 bg-[#0B0E14] border border-[#263042] rounded-xl cursor-pointer"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-slate-400 mb-1">
              Clock Background Opacity ({Math.round(draft.clockBgOpacity * 100)}%)
            </label>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(draft.clockBgOpacity * 100)}
              onChange={(e) => updateField('clockBgOpacity', Number(e.target.value) / 100)}
              className="w-full accent-blue-600"
            />
          </div>
        </section>

        {/* 05. Lower-Third Graphic */}
        <section className="bg-[#121721] border border-[#232B3A] rounded-2xl p-4 sm:p-5 space-y-3 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-100">05. Lower-Third News Graphic</h3>
            <label className="min-h-[44px] flex items-center gap-2 text-xs text-slate-300 cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={draft.lowerThirdEnabled}
                onChange={(e) => updateField('lowerThirdEnabled', e.target.checked)}
                className="w-4 h-4 rounded border-[#2E384B] bg-[#0B0E14] text-blue-600"
              />
              <span>Enabled</span>
            </label>
          </div>

          <input
            type="text"
            value={draft.lowerThirdTitle}
            onChange={(e) => updateField('lowerThirdTitle', e.target.value)}
            placeholder="Speaker / Segment Title"
            className="w-full min-h-[44px] bg-[#0B0E14] border border-[#263042] rounded-xl px-3 py-2 text-xs text-slate-100"
          />
          <input
            type="text"
            value={draft.lowerThirdSubtitle}
            onChange={(e) => updateField('lowerThirdSubtitle', e.target.value)}
            placeholder="Subtitle / Role / Location"
            className="w-full min-h-[44px] bg-[#0B0E14] border border-[#263042] rounded-xl px-3 py-2 text-xs text-slate-100"
          />

          <div className="grid grid-cols-3 gap-2.5">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Accent Bar</label>
              <input
                type="color"
                value={draft.lowerThirdAccentColor}
                onChange={(e) => updateField('lowerThirdAccentColor', e.target.value)}
                className="w-full h-11 bg-[#0B0E14] border border-[#263042] rounded-xl cursor-pointer"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Plate Color</label>
              <input
                type="color"
                value={draft.lowerThirdBgColor}
                onChange={(e) => updateField('lowerThirdBgColor', e.target.value)}
                className="w-full h-11 bg-[#0B0E14] border border-[#263042] rounded-xl cursor-pointer"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Animation</label>
              <select
                value={draft.lowerThirdAnimation}
                onChange={(e) =>
                  updateField('lowerThirdAnimation', e.target.value as 'static' | 'fade' | 'slide')
                }
                className="w-full h-11 bg-[#0B0E14] border border-[#263042] rounded-xl px-2 text-xs text-slate-100"
              >
                <option value="slide">Slide</option>
                <option value="fade">Fade</option>
                <option value="static">Static</option>
              </select>
            </div>
          </div>
        </section>

        {/* 06. Scrolling Ticker */}
        <section className="bg-[#121721] border border-[#232B3A] rounded-2xl p-4 sm:p-5 space-y-3 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-100">06. Scrolling News Ticker</h3>
            <label className="min-h-[44px] flex items-center gap-2 text-xs text-slate-300 cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={draft.tickerEnabled}
                onChange={(e) => updateField('tickerEnabled', e.target.checked)}
                className="w-4 h-4 rounded border-[#2E384B] bg-[#0B0E14] text-blue-600"
              />
              <span>Enabled</span>
            </label>
          </div>

          <textarea
            rows={2}
            value={draft.tickerText}
            onChange={(e) => updateField('tickerText', e.target.value)}
            placeholder="Enter scrolling ticker message..."
            className="w-full bg-[#0B0E14] border border-[#263042] rounded-xl px-3 py-2.5 text-xs text-slate-100"
          />

          <div className="grid grid-cols-3 gap-2.5">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Font Size</label>
              <input
                type="number"
                min={14}
                max={36}
                value={draft.tickerFontSize}
                onChange={(e) => updateField('tickerFontSize', Number(e.target.value))}
                className="w-full min-h-[44px] bg-[#0B0E14] border border-[#263042] rounded-xl px-2.5 py-1.5 text-xs font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Text Color</label>
              <input
                type="color"
                value={draft.tickerColor}
                onChange={(e) => updateField('tickerColor', e.target.value)}
                className="w-full h-11 bg-[#0B0E14] border border-[#263042] rounded-xl cursor-pointer"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Bar Color</label>
              <input
                type="color"
                value={draft.tickerBgColor}
                onChange={(e) => updateField('tickerBgColor', e.target.value)}
                className="w-full h-11 bg-[#0B0E14] border border-[#263042] rounded-xl cursor-pointer"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                Scroll Speed ({draft.tickerSpeed} px/sec)
              </label>
              <input
                type="range"
                min={40}
                max={220}
                value={draft.tickerSpeed}
                onChange={(e) => updateField('tickerSpeed', Number(e.target.value))}
                className="w-full accent-blue-600 mt-1.5"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                Bar Opacity ({Math.round(draft.tickerBgOpacity * 100)}%)
              </label>
              <input
                type="range"
                min={10}
                max={100}
                value={Math.round(draft.tickerBgOpacity * 100)}
                onChange={(e) => updateField('tickerBgOpacity', Number(e.target.value) / 100)}
                className="w-full accent-blue-600 mt-1.5"
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
