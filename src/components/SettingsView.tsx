import { useState } from 'react';
import { CheckCircle2, Eye, EyeOff, KeyRound, Lock, Server, ShieldAlert, Terminal } from 'lucide-react';
import type { RtmpPublicConfig, SecurityStatusInfo } from '../../shared/types';
import { api } from '../lib/api';

interface SettingsViewProps {
  rtmpConfig: RtmpPublicConfig;
  security: SecurityStatusInfo | null;
  onRtmpUpdated: (config: RtmpPublicConfig) => void;
}

export function SettingsView({ rtmpConfig, security, onRtmpUpdated }: SettingsViewProps) {
  const [serverUrl, setServerUrl] = useState(rtmpConfig.serverUrl);
  const [streamKey, setStreamKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

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
        text: 'Facebook RTMP settings saved and AES-256-GCM encrypted on the server.',
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
      setFeedback({ type: 'ok', text: 'Stored Stream Key deleted from server.' });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to clear Stream Key.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Facebook RTMP Configuration */}
      <section className="bg-[#121721] border border-[#232B3A] rounded-lg p-6 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-[#232B3A]">
          <div className="flex items-center gap-2.5">
            <KeyRound className="w-4 h-4 text-blue-400" />
            <h2 className="text-base font-semibold text-slate-100">Facebook Live RTMP Credentials</h2>
          </div>
          <span className="text-xs font-mono text-slate-400">
            {rtmpConfig.hasStreamKey ? `Stored: ${rtmpConfig.maskedStreamKey}` : 'No Key Saved'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="settings-rtmp-url" className="block text-xs font-medium text-slate-300 mb-1.5">
              Facebook RTMP Server URL
            </label>
            <input
              id="settings-rtmp-url"
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="rtmps://live-api-s.facebook.com:443/rtmp/"
              className="w-full bg-[#0B0E14] border border-[#263042] rounded-md px-3 py-2 text-xs font-mono text-slate-100"
            />
          </div>

          <div>
            <label htmlFor="settings-rtmp-key" className="block text-xs font-medium text-slate-300 mb-1.5">
              Facebook Stream Key (Server-Encrypted)
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
                className="w-full bg-[#0B0E14] border border-[#263042] rounded-md pl-3 pr-10 py-2 text-xs font-mono text-slate-100"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? 'Hide key' : 'Show key'}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-200"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>

        {feedback && (
          <div
            className={`p-3 rounded-md border text-xs ${
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
            className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Credentials'}
          </button>
          {rtmpConfig.hasStreamKey && (
            <button
              type="button"
              onClick={handleClearKey}
              disabled={saving}
              className="px-4 py-2 rounded-md border border-[#2C374C] text-xs font-medium text-rose-300 hover:bg-rose-950/30"
            >
              Clear Stored Key
            </button>
          )}
        </div>
      </section>

      {/* Security & Production Posture */}
      <section className="bg-[#121721] border border-[#232B3A] rounded-lg p-6 space-y-4">
        <div className="flex items-center gap-2.5 pb-3 border-b border-[#232B3A]">
          <Lock className="w-4 h-4 text-blue-400" />
          <h2 className="text-base font-semibold text-slate-100">Security Posture & Runtime Diagnostics</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="bg-[#0E131B] border border-[#232B3A] rounded-md p-4 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-200">Operator Authentication</span>
              {security?.authRequired ? (
                <span className="text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Enabled
                </span>
              ) : (
                <span className="text-amber-400 flex items-center gap-1">
                  <ShieldAlert className="w-3.5 h-3.5" /> Disabled (Local Mode)
                </span>
              )}
            </div>
            <p className="text-slate-400 leading-relaxed">
              Set <code className="font-mono text-slate-300">STUDIO_ADMIN_PASSWORD</code> in your environment before deploying to a public VPS to require HMAC-signed cookie auth on all API and WebSocket routes.
            </p>
          </div>

          <div className="bg-[#0E131B] border border-[#232B3A] rounded-md p-4 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-200">Credential Encryption Key</span>
              {security?.encryptionConfigured ? (
                <span className="text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Env Configured
                </span>
              ) : (
                <span className="text-slate-300">Auto-Generated Master Key</span>
              )}
            </div>
            <p className="text-slate-400 leading-relaxed">
              Provide <code className="font-mono text-slate-300">CREDENTIAL_ENCRYPTION_KEY</code> in production so encrypted RTMP keys remain portable across container rebuilds.
            </p>
          </div>

          <div className="bg-[#0E131B] border border-[#232B3A] rounded-md p-4 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-200">FFmpeg Runtime</span>
              <span className={security?.ffmpegAvailable ? 'text-emerald-400' : 'text-rose-400'}>
                {security?.ffmpegAvailable ? 'Installed' : 'Not Found'}
              </span>
            </div>
            <p className="text-slate-400 font-mono text-[11px] truncate">
              {security?.ffmpegVersion || 'Install ffmpeg and fonts-liberation on host'}
            </p>
          </div>

          <div className="bg-[#0E131B] border border-[#232B3A] rounded-md p-4 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-200">API Rate Limiting & Upload Guard</span>
              <span className="text-emerald-400">Active</span>
            </div>
            <p className="text-slate-400 leading-relaxed">
              Max upload size <span className="font-mono text-slate-300">{security?.maxUploadMb ?? 500} MB</span> · MP4/MOV/WebM/MKV & PNG magic-byte verification enabled.
            </p>
          </div>
        </div>
      </section>

      {/* Docker & VPS Deployment Instructions */}
      <section className="bg-[#121721] border border-[#232B3A] rounded-lg p-6 space-y-4">
        <div className="flex items-center gap-2.5 pb-3 border-b border-[#232B3A]">
          <Server className="w-4 h-4 text-blue-400" />
          <h2 className="text-base font-semibold text-slate-100">Docker & VPS Deployment Guide</h2>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed">
          FFmpeg RTMP encoding is a long-running, CPU-intensive stateful process. Deploy LIVECAST STUDIO on a VPS or persistent container host (minimum 2 vCPU / 2 GB RAM for 720p30, 4 vCPU / 4 GB RAM for 1080p30) rather than serverless functions.
        </p>

        <div className="bg-[#080A0F] border border-[#232B3A] rounded-md p-4 font-mono text-xs text-slate-300 space-y-2 overflow-x-auto">
          <div className="flex items-center gap-2 text-slate-400 pb-1 border-b border-[#232B3A]">
            <Terminal className="w-3.5 h-3.5" />
            <span>Deploy with Docker Compose</span>
          </div>
          <pre className="leading-relaxed">{`export CREDENTIAL_ENCRYPTION_KEY=$(openssl rand -hex 32)
export SESSION_SECRET=$(openssl rand -hex 32)
export STUDIO_ADMIN_PASSWORD="choose-a-strong-password"
docker compose up -d --build`}</pre>
        </div>
      </section>
    </div>
  );
}
