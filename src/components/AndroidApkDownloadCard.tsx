import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { formatBytes } from '../lib/api';

interface ApkMetadata {
  available: boolean;
  appName?: string;
  packageName?: string;
  buildVariant?: string;
  versionName?: string;
  versionCode?: number;
  buildDateIso?: string;
  sizeBytes?: number;
  sha256?: string;
  commitSha?: string;
  downloadPath?: string;
  workflowRunUrl?: string;
}

const APK_DOWNLOAD_PATH = '/downloads/livecast-companion.apk';
const APK_METADATA_PATH = '/downloads/apk-metadata.json';
const GITHUB_WORKFLOW_URL =
  'https://github.com/akshaykadavergu2-dotcom/Facebook-live/actions/workflows/android-apk.yml';

interface AndroidApkDownloadCardProps {
  compact?: boolean;
}

export function AndroidApkDownloadCard({ compact = false }: AndroidApkDownloadCardProps) {
  const [checking, setChecking] = useState(true);
  const [apkAvailable, setApkAvailable] = useState(false);
  const [metadata, setMetadata] = useState<ApkMetadata | null>(null);
  const [statusDetail, setStatusDetail] = useState<string>('Checking published APK build...');

  const checkPublishedApk = useCallback(async () => {
    setChecking(true);
    try {
      let parsedMeta: ApkMetadata | null = null;
      try {
        const metaRes = await fetch(APK_METADATA_PATH, { cache: 'no-store' });
        const metaCt = (metaRes.headers.get('content-type') || '').toLowerCase();
        if (metaRes.ok && metaCt.includes('application/json')) {
          parsedMeta = (await metaRes.json()) as ApkMetadata;
        }
      } catch {
        parsedMeta = null;
      }

      const headRes = await fetch(APK_DOWNLOAD_PATH, {
        method: 'HEAD',
        cache: 'no-store',
      });
      const contentType = (headRes.headers.get('content-type') || '').toLowerCase();
      const contentLengthHeader = Number(headRes.headers.get('content-length') || '0');
      const isHtmlFallback = contentType.includes('text/html');
      const verifiedSize = contentLengthHeader || parsedMeta?.sizeBytes || 0;
      const isValidBinary =
        headRes.ok && !isHtmlFallback && verifiedSize > 100_000;

      setMetadata(parsedMeta);
      setApkAvailable(isValidBinary);

      if (isValidBinary) {
        setStatusDetail('Verified signed debug APK ready for direct Android installation.');
      } else {
        setStatusDetail(
          'APK has not been published to public/downloads/livecast-companion.apk yet. Run the "Build Android Companion APK" GitHub Actions workflow to build & deploy it automatically.',
        );
      }
    } catch (err) {
      setApkAvailable(false);
      setStatusDetail(
        `Unable to verify APK availability: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    checkPublishedApk();
  }, [checkPublishedApk]);

  const versionLabel = metadata?.versionName
    ? `v${metadata.versionName}${metadata.versionCode ? ` (Build ${metadata.versionCode})` : ''}`
    : 'v1.0.0 (Build 1)';

  const buildDateLabel = metadata?.buildDateIso
    ? new Date(metadata.buildDateIso).toLocaleString()
    : 'Awaiting GitHub Actions Build';

  const sizeLabel =
    metadata?.sizeBytes && metadata.sizeBytes > 0
      ? formatBytes(metadata.sizeBytes)
      : apkAvailable
        ? 'Verified APK'
        : 'Not published yet';

  return (
    <section className="bg-[#121721] border border-[#232B3A] rounded-2xl p-4 sm:p-5 space-y-4 min-w-0">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1.5 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Smartphone className="w-4 h-4 text-emerald-400 shrink-0" />
            <h3 className="text-sm sm:text-base font-semibold text-slate-100">
              Android Live Capture Companion APK
            </h3>
            {checking ? (
              <span className="text-[11px] font-mono text-slate-400">Checking APK...</span>
            ) : apkAvailable ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-mono font-semibold text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>APK Ready</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] font-mono font-semibold text-amber-300">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>Pending Cloud Build</span>
              </span>
            )}
          </div>

          <p className="text-xs text-slate-400 leading-relaxed max-w-3xl">
            Direct Android APK installer (<code className="font-mono text-slate-300">com.livecast.capture</code>) built cleanly in the cloud by GitHub Actions. Installs directly on your Android phone with no PC, Android Studio, or USB debugging required (this is the native APK, not a browser PWA).
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 shrink-0">
          {apkAvailable ? (
            <a
              href={APK_DOWNLOAD_PATH}
              download="livecast-companion.apk"
              className="min-h-[48px] px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all whitespace-nowrap"
            >
              <Download className="w-4 h-4 shrink-0" />
              <span>DOWNLOAD ANDROID APP</span>
            </a>
          ) : (
            <button
              type="button"
              disabled
              aria-disabled="true"
              title="Run GitHub Actions workflow first to publish /downloads/livecast-companion.apk"
              className="min-h-[48px] px-5 py-2.5 rounded-xl bg-[#1A2230] border border-[#2A3447] text-slate-400 text-sm font-semibold flex items-center justify-center gap-2 cursor-not-allowed whitespace-nowrap"
            >
              <Download className="w-4 h-4 shrink-0" />
              <span>DOWNLOAD ANDROID APP</span>
            </button>
          )}

          {!apkAvailable && (
            <a
              href={GITHUB_WORKFLOW_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-[48px] px-4 py-2.5 rounded-xl border border-blue-500/40 bg-blue-600/15 hover:bg-blue-600/25 text-blue-300 text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap"
            >
              <ExternalLink className="w-3.5 h-3.5 shrink-0" />
              <span>GitHub APK Builder</span>
            </a>
          )}

          <button
            type="button"
            onClick={checkPublishedApk}
            disabled={checking}
            aria-label="Refresh APK build status"
            className="min-h-[48px] px-3.5 py-2.5 rounded-xl border border-[#2A3447] bg-[#181F2C] hover:bg-[#1E2738] text-slate-300 text-xs font-medium flex items-center justify-center gap-1.5 disabled:opacity-50 whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
            <span>Check APK</span>
          </button>
        </div>
      </div>

      {/* Real Build Metadata Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
        <div className="bg-[#0E131B] border border-[#232B3A] rounded-xl px-3 py-2.5 min-w-0">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">APK Version</div>
          <div className="font-mono text-slate-100 font-semibold mt-0.5 truncate">{versionLabel}</div>
        </div>
        <div className="bg-[#0E131B] border border-[#232B3A] rounded-xl px-3 py-2.5 min-w-0">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">Build Date</div>
          <div className="font-mono text-slate-200 mt-0.5 truncate">{buildDateLabel}</div>
        </div>
        <div className="bg-[#0E131B] border border-[#232B3A] rounded-xl px-3 py-2.5 min-w-0">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">Package & Size</div>
          <div className="font-mono text-slate-200 mt-0.5 truncate">
            {metadata?.packageName || 'com.livecast.capture'} · {sizeLabel}
          </div>
        </div>
        <div className="bg-[#0E131B] border border-[#232B3A] rounded-xl px-3 py-2.5 min-w-0">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">Direct URL</div>
          <div className="font-mono text-blue-300 mt-0.5 truncate">/downloads/livecast-companion.apk</div>
        </div>
      </div>

      {!checking && !apkAvailable && (
        <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/35 text-xs text-amber-200 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1 min-w-0">
            <p className="break-words">{statusDetail}</p>
            {metadata?.workflowRunUrl && (
              <a
                href={metadata.workflowRunUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-amber-100 underline"
              >
                <span>View last workflow run</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      )}

      {!compact && (
        <div className="bg-[#0E131B] border border-[#232B3A] rounded-xl p-3.5 space-y-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-slate-200 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>Phone-Only APK Installation Instructions (Android 10+)</span>
            </span>
            {metadata?.sha256 && (
              <span className="hidden sm:inline font-mono text-[10px] text-slate-500">
                SHA-256: {metadata.sha256.slice(0, 12)}...
              </span>
            )}
          </div>
          <ol className="list-decimal list-inside space-y-1 text-slate-300 leading-relaxed">
            <li>
              Tap <strong className="text-white">DOWNLOAD ANDROID APP</strong> above in Android Chrome to download <code className="font-mono text-slate-200">livecast-companion.apk</code> directly to your phone.
            </li>
            <li>
              Tap <strong className="text-white">Open</strong> on the Chrome download notification (or open <strong className="text-white">Files &rarr; Downloads</strong> and tap <code className="font-mono text-slate-200">livecast-companion.apk</code>).
            </li>
            <li>
              If Android prompts <strong className="text-white">Install unknown apps</strong>, enable permission for Chrome/Files, then tap <strong className="text-white">Install</strong>.
            </li>
            <li>
              Return here to <strong className="text-white">Android Capture</strong>, load Monitor A, tap <strong className="text-white">CONNECT ANDROID</strong>, and tap <strong className="text-white">Launch Companion App</strong> to pair automatically over <code className="font-mono text-slate-200">livecast://capture</code>.
            </li>
          </ol>
        </div>
      )}
    </section>
  );
}
