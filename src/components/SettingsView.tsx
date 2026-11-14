import { useEffect, useState } from 'react';
import { CheckCircle2, Eye, EyeOff, KeyRound, Lock, Server, ShieldCheck, Smartphone, Terminal } from 'lucide-react';
import type { RtmpPublicConfig, SecurityStatusInfo } from '../../shared/types';
import { api, API_BASE_URL } from '../lib/api';
import { AndroidApkDownloadCard } from './AndroidApkDownloadCard';
import { PWAInstallButton } from './PWAInstallButton';

interface SettingsViewProps {
  rtmpConfig: RtmpPublicConfig;
  youtubeRtmpConfig: RtmpPublicConfig;
  security: SecurityStatusInfo | null;
  onRtmpUpdated: (config: RtmpPublicConfig) => void;
  onYoutubeRtmpUpdated: (config: RtmpPublicConfig) => void;
}

export function SettingsView({
  rtmpConfig,
  youtubeRtmpConfig,
  security,
  onRtmpUpdated,
  onYoutubeRtmpUpdated,
}: SettingsViewProps) {
  const [serverUrl, setServerUrl] = useState(rtmpConfig.serverUrl);
  const [streamKey, setStreamKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [ytServerUrl, setYtServerUrl] = useState(youtubeRtmpConfig.serverUrl);
  const [ytStreamKey, setYtStreamKey] = useState('');
  const [showYtKey, setShowYtKey] = useState(false);
  const [savingYt, setSavingYt] = useState(false);
  const [ytFeedback, setYtFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    setServerUrl(rtmpConfig.serverUrl);
  }, [rtmpConfig.serverUrl]);

  useEffect(() => {
    setYtServerUrl(youtubeRtmpConfig.serverUrl);
  }, [youtubeRtmpConfig.serverUrl]);

  const handleSave = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      const updated = await api.saveRtmpConfig(serverUrl, streamKey || undefined);
      onRtmpUpdated(updated);
      setStreamKey('');
      setShowKey(false);
      setFeedback({
        type: 'ok',
        text: 'Facebook RTMP settings saved and AES-256-GCM encrypted on the backend.',
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to save RTMP settings.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleClearKey = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      const updated = await api.clearRtmpKey();
      onRtmpUpdated(updated);
      setFeedback({ type: 'ok', text: 'Stored Facebook Stream Key deleted from backend.' });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to clear Stream Key.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveYoutube = async () => {
    setSavingYt(true);
    setYtFeedback(null);
    try {
      const updated = await api.saveYoutubeRtmpConfig(ytServerUrl, ytStreamKey || undefined);
      onYoutubeRtmpUpdated(updated);
      setYtStreamKey('');
      setShowYtKey(false);
      setYtFeedback({
        type: 'ok',
        text: 'YouTube Live RTMP settings saved and AES-256-GCM encrypted on the backend.',
      });
    } catch (err) {
      setYtFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to save YouTube RTMP settings.',
      });
    } finally {
      setSavingYt(false);
    }
  };

  const handleClearYoutubeKey = async () => {
    setSavingYt(true);
    setYtFeedback(null);
    try {
      const updated = await api.clearYoutubeRtmpKey();
      onYoutubeRtmpUpdated(updated);
      setYtFeedback({ type: 'ok', text: 'Stored YouTube Stream Key deleted from backend.' });
    } catch (err) {
      setYtFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to clear YouTube Stream Key.',
      });
    } finally {
      setSavingYt(false);
    }
  };

  return (
    <div className="space-y-5 max-w-5xl min-w-0">
      {/* Optional Native All-in-One Android APK Download Card */}
      <AndroidApkDownloadCard />

      {/* Android PWA Install Card */}
      <section className="bg-[#121721] border border-[#232B3A] rounded-2xl p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 min-w-0">
        <div className="space-y-1 min-w-0">
          <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-blue-400 shrink-0" />
            <span>Android Mobile App (PWA)</span>
          </h2>
          <p className="text-xs text-slate-400 leading-relaxed">
            Install LIVECAST STUDIO to your Android home screen for standalone full-screen broadcast control without browser bars.
          </p>
        </div>
        <div className="shrink-0">
          <PWAInstallButton />
        </div>
      </section>

      {/* Facebook RTMP Configuration */}
      <section className="bg-[#121721] border border-[#232B3A] rounded-2xl p-4 sm:p-6 space-y-4 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#232B3A]">
          <div className="flex items-center gap-2.5">
            <KeyRound className="w-4 h-4 text-blue-400 shrink-0" />
            <h2 className="text-base font-semibold text-slate-100">Facebook Live RTMP Credentials</h2>
          </div>
          <span className="text-xs font-mono text-slate-400">
            {rtmpConfig.hasStreamKey ? `Stored: ${rtmpConfig.maskedStreamKey}` : 'No Key Saved'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="min-w-0">
            <label htmlFor="settings-rtmp-url" className="block text-xs font-medium text-slate-300 mb-1.5">
              Facebook RTMP Server URL
            </label>
            <input
              id="settings-rtmp-url"
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="rtmps://live-api-s.facebook.com:443/rtmp/"
              className="w-full min-h-[44px] bg-[#0B0E14] border border-[#263042] rounded-xl px-3 py-2 text-xs font-mono text-slate-100"
            />
          </div>

          <div className="min-w-0">
            <label htmlFor="settings-rtmp-key" className="block text-xs font-medium text-slate-300 mb-1.5">
              Facebook Stream Key (Backend-Encrypted)
            </label>
            <div className="relative">
              <input
                id="settings-rtmp-key"
                type={showKey ? 'text' : 'password'}
                autoComplete="new-password"
                value={streamKey}
                onChange={(e) => setStreamKey(e.target.value)}
                placeholder={
                  rtmpConfig.hasStreamKey
                    ? 'Leave blank to keep existing encrypted key'
                    : 'Enter Facebook Live Stream Key'
                }
                className="w-full min-h-[44px] bg-[#0B0E14] border border-[#263042] rounded-xl pl-3 pr-12 py-2 text-xs font-mono text-slate-100"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? 'Hide key' : 'Show key'}
                className="absolute right-1 top-1/2 -translate-y-1/2 min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:text-slate-200"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>

        {feedback && (
          <div
            className={`p-3 rounded-xl border text-xs break-words ${
              feedback.type === 'ok'
                ? 'bg-emerald-950/25 border-emerald-500/35 text-emerald-200'
                : 'bg-rose-950/25 border-rose-500/35 text-rose-200'
            }`}
          >
            {feedback.text}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Credentials'}
          </button>
          {rtmpConfig.hasStreamKey && (
            <button
              type="button"
              onClick={handleClearKey}
              disabled={saving}
              className="min-h-[44px] px-4 py-2 rounded-xl border border-[#2C374C] text-xs font-medium text-rose-300 hover:bg-rose-950/30 disabled:opacity-50"
            >
              Clear Stored Key
            </button>
          )}
        </div>
      </section>

      {/* YouTube Live RTMP Configuration */}
      <section className="bg-[#121721] border border-[#232B3A] rounded-2xl p-4 sm:p-6 space-y-4 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#232B3A]">
          <div className="flex items-center gap-2.5">
            <KeyRound className="w-4 h-4 text-rose-400 shrink-0" />
            <h2 className="text-base font-semibold text-slate-100">YouTube Live RTMP Credentials</h2>
          </div>
          <span className="text-xs font-mono text-slate-400">
            {youtubeRtmpConfig.hasStreamKey
              ? `Stored: ${youtubeRtmpConfig.maskedStreamKey}`
              : 'No Key Saved'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="min-w-0">
            <label htmlFor="settings-yt-rtmp-url" className="block text-xs font-medium text-slate-300 mb-1.5">
              YouTube RTMP Server URL
            </label>
            <input
              id="settings-yt-rtmp-url"
              type="text"
              value={ytServerUrl}
              onChange={(e) => setYtServerUrl(e.target.value)}
              placeholder="rtmps://a.rtmps.youtube.com:443/live2"
              className="w-full min-h-[44px] bg-[#0B0E14] border border-[#263042] rounded-xl px-3 py-2 text-xs font-mono text-slate-100"
            />
          </div>

          <div className="min-w-0">
            <label htmlFor="settings-yt-rtmp-key" className="block text-xs font-medium text-slate-300 mb-1.5">
              YouTube Live Stream Key (Backend-Encrypted)
            </label>
            <div className="relative">
              <input
                id="settings-yt-rtmp-key"
                type={showYtKey ? 'text' : 'password'}
                autoComplete="new-password"
                value={ytStreamKey}
                onChange={(e) => setYtStreamKey(e.target.value)}
                placeholder={
                  youtubeRtmpConfig.hasStreamKey
                    ? 'Leave blank to keep existing encrypted key'
                    : 'Enter YouTube Live Stream Key'
                }
                className="w-full min-h-[44px] bg-[#0B0E14] border border-[#263042] rounded-xl pl-3 pr-12 py-2 text-xs font-mono text-slate-100"
              />
              <button
                type="button"
                onClick={() => setShowYtKey((v) => !v)}
                aria-label={showYtKey ? 'Hide YouTube key' : 'Show YouTube key'}
                className="absolute right-1 top-1/2 -translate-y-1/2 min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:text-slate-200"
              >
                {showYtKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>

        {ytFeedback && (
          <div
            className={`p-3 rounded-xl border text-xs break-words ${
              ytFeedback.type === 'ok'
                ? 'bg-emerald-950/25 border-emerald-500/35 text-emerald-200'
                : 'bg-rose-950/25 border-rose-500/35 text-rose-200'
            }`}
          >
            {ytFeedback.text}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSaveYoutube}
            disabled={savingYt}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold disabled:opacity-50"
          >
            {savingYt ? 'Saving...' : 'Save YouTube Credentials'}
          </button>
          {youtubeRtmpConfig.hasStreamKey && (
            <button
              type="button"
              onClick={handleClearYoutubeKey}
              disabled={savingYt}
              className="min-h-[44px] px-4 py-2 rounded-xl border border-[#2C374C] text-xs font-medium text-rose-300 hover:bg-rose-950/30 disabled:opacity-50"
            >
              Clear Stored Key
            </button>
          )}
        </div>
      </section>

      {/* Security & Production Posture */}
      <section className="bg-[#121721] border border-[#232B3A] rounded-lg p-4 sm:p-6 space-y-4 min-w-0">
        <div className="flex items-center gap-2.5 pb-3 border-b border-[#232B3A]">
          <Lock className="w-4 h-4 text-blue-400 shrink-0" />
          <h2 className="text-base font-semibold text-slate-100">Security Posture & Backend Connection</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="bg-[#0E131B] border border-[#232B3A] rounded-md p-4 space-y-1.5 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-slate-200">Backend API Endpoint</span>
              <span className="text-blue-400 font-mono truncate">
                {API_BASE_URL || 'Same-Origin (/api)'}
              </span>
            </div>
            <p className="text-slate-400 leading-relaxed">
              On Netlify (<code className="font-mono text-slate-300">streamkarolive.netlify.app</code>), set <code className="font-mono text-slate-300">VITE_API_BASE_URL</code> in Netlify Site Environment Variables to your Render/VPS backend URL. Never put secrets in <code className="font-mono text-slate-300">VITE_*</code> variables.
            </p>
          </div>

          <div className="bg-[#0E131B] border border-[#232B3A] rounded-md p-4 space-y-1.5 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-slate-200">Stream Control Protection</span>
              <span className="text-emerald-400 flex items-center gap-1 shrink-0">
                <ShieldCheck className="w-3.5 h-3.5" />{' '}
                {security?.originProtectionEnabled !== false ? 'Origin-Locked' : 'Active'}
              </span>
            </div>
            <p className="text-slate-400 leading-relaxed">
              Backend stream control and WebSocket upgrades validate allowed CORS origins (<code className="font-mono text-slate-300">ALLOWED_CORS_ORIGIN</code>), client request headers, and rate limits without blocking dashboard access.
            </p>
          </div>

          <div className="bg-[#0E131B] border border-[#232B3A] rounded-md p-4 space-y-1.5 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-slate-200">Credential Encryption Key</span>
              {security?.encryptionConfigured ? (
                <span className="text-emerald-400 flex items-center gap-1 shrink-0">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Env Configured
                </span>
              ) : (
                <span className="text-slate-300 shrink-0">Auto-Generated Master Key</span>
              )}
            </div>
            <p className="text-slate-400 leading-relaxed">
              Provide <code className="font-mono text-slate-300">CREDENTIAL_ENCRYPTION_KEY</code> on the backend so AES-256-GCM encrypted RTMP keys persist across container redeploys.
            </p>
          </div>

          <div className="bg-[#0E131B] border border-[#232B3A] rounded-md p-4 space-y-1.5 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-slate-200">FFmpeg Runtime</span>
              <span className={security?.ffmpegAvailable ? 'text-emerald-400 shrink-0' : 'text-rose-400 shrink-0'}>
                {security?.ffmpegAvailable ? 'Installed' : 'Not Connected'}
              </span>
            </div>
            <p className="text-slate-400 font-mono text-[11px] truncate">
              {security?.ffmpegVersion || 'FFmpeg runs exclusively on the Node.js backend host'}
            </p>
          </div>
        </div>
      </section>

      {/* Split Netlify + Render Deployment Instructions */}
      <section className="bg-[#121721] border border-[#232B3A] rounded-lg p-4 sm:p-6 space-y-4 min-w-0">
        <div className="flex items-center gap-2.5 pb-3 border-b border-[#232B3A]">
          <Server className="w-4 h-4 text-blue-400 shrink-0" />
          <h2 className="text-base font-semibold text-slate-100">Netlify Frontend + Render Backend Deployment</h2>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed">
          Netlify serves only the static React UI. Deploy the <code className="font-mono text-slate-200">/backend</code> folder as a persistent Docker Web Service on Render (or Railway/VPS) with FFmpeg installed, then connect Netlify via <code className="font-mono text-slate-200">VITE_API_BASE_URL</code>.
        </p>

        <div className="bg-[#080A0F] border border-[#232B3A] rounded-md p-4 font-mono text-xs text-slate-300 space-y-2 overflow-x-auto max-w-full">
          <div className="flex items-center gap-2 text-slate-400 pb-1 border-b border-[#232B3A]">
            <Terminal className="w-3.5 h-3.5 shrink-0" />
            <span>1. Render Backend Env Vars · 2. Netlify Frontend Env Var</span>
          </div>
          <pre className="leading-relaxed whitespace-pre-wrap break-words sm:whitespace-pre">{`# Render Web Service (Root Directory: backend, Runtime: Docker)
NODE_ENV=production
PORT=3000
ALLOWED_CORS_ORIGIN=https://streamkarolive.netlify.app
CREDENTIAL_ENCRYPTION_KEY=<openssl rand -hex 32>

# Netlify Site Environment Variables (streamkarolive.netlify.app)
VITE_API_BASE_URL=https://facebook-live-gvx5.onrender.com`}</pre>
        </div>
      </section>
    </div>
  );
}
