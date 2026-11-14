import { useState } from 'react';
import { Download, Smartphone, WifiOff, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  compact?: boolean;
}

export function PWAInstallButton({ compact = false }: PWAInstallButtonProps) {
  const { isInstallable, isInstalled, isIOS, isAndroid, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className={`flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white font-semibold transition-all whitespace-nowrap shrink-0 ${
          compact ? 'min-h-[36px] px-2.5 text-xs' : 'min-h-[44px] px-4 text-xs sm:text-sm'
        }`}
      >
        <Download className="w-3.5 h-3.5 shrink-0" />
        <span>Install App</span>
      </button>
    );
  }

  if (!isAndroid && !isIOS && compact) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowGuide(true)}
        className={`flex items-center justify-center gap-1.5 rounded-lg border border-[#2C374C] bg-[#161D29] hover:bg-[#1E2738] text-slate-200 font-medium transition-colors whitespace-nowrap shrink-0 ${
          compact ? 'min-h-[36px] px-2.5 text-xs' : 'min-h-[44px] px-4 text-xs sm:text-sm'
        }`}
      >
        <Smartphone className="w-3.5 h-3.5 text-blue-400 shrink-0" />
        <span>{compact ? 'App' : 'Install Studio App'}</span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-guide-title"
        >
          <div className="w-full max-w-sm rounded-2xl bg-[#121721] border border-[#263042] p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between gap-2">
              <h3 id="pwa-install-guide-title" className="text-base font-semibold text-slate-100">
                Install LIVECAST STUDIO
              </h3>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Close install instructions"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-100 hover:bg-[#181F2C]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {isIOS ? (
              <p className="text-xs text-slate-300 leading-relaxed">
                1. Tap the <strong>Share</strong> icon in the browser toolbar.
                <br />
                2. Tap <strong>Add to Home Screen</strong> to launch LIVECAST STUDIO in standalone mode.
              </p>
            ) : (
              <p className="text-xs text-slate-300 leading-relaxed">
                In <strong>Android Chrome</strong>, open the browser menu (three dots top-right) and tap{' '}
                <strong>Install app</strong> or <strong>Add to Home screen</strong> for full-screen broadcast control.
              </p>
            )}
            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="w-full min-h-[44px] rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div className="mb-3 rounded-xl bg-amber-950/60 border border-amber-500/40 px-3.5 py-2.5 text-xs text-amber-100 flex items-center gap-2">
      <WifiOff className="w-4 h-4 text-amber-400 shrink-0" />
      <span>Device is offline. Broadcast engine controls require an active internet connection.</span>
    </div>
  );
}
