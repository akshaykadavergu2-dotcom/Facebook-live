import {
  LayoutDashboard,
  Radio,
  Layers,
  History,
  Settings,
  X,
} from 'lucide-react';
import type { StreamStatusState } from '../../shared/types';

export type NavSection = 'dashboard' | 'studio' | 'overlays' | 'history' | 'settings';

interface SidebarProps {
  activeSection: NavSection;
  onSelect: (section: NavSection) => void;
  streamStatus: StreamStatusState;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const NAV_ITEMS: Array<{ id: NavSection; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'studio', label: 'Live Studio', icon: Radio },
  { id: 'overlays', label: 'Overlays', icon: Layers },
  { id: 'history', label: 'Stream History', icon: History },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function Sidebar({
  activeSection,
  onSelect,
  streamStatus,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const navContent = (
    <div className="flex flex-col h-full bg-[#0E131B] border-r border-[#232B3A] w-60 shrink-0">
      <div className="h-14 px-5 flex items-center justify-between border-b border-[#232B3A]">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded bg-blue-600 flex items-center justify-center shrink-0">
            <Radio className="w-4 h-4 text-white" />
          </div>
          <span className="font-display font-bold tracking-tight text-sm text-slate-100 whitespace-nowrap">
            LIVECAST STUDIO
          </span>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation"
          className="lg:hidden p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-[#181F2C]"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1" aria-label="Studio Navigation">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelect(item.id);
                onCloseMobile();
              }}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                active
                  ? 'bg-blue-600/15 text-blue-400 border border-blue-500/25'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-[#161D29] border border-transparent'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </span>
              {item.id === 'studio' && streamStatus === 'Live' && (
                <span className="font-mono text-[10px] font-semibold text-red-400">LIVE</span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="px-4 py-3 border-t border-[#232B3A] text-xs text-slate-400 space-y-1">
        <div className="flex items-center justify-between">
          <span>Engine</span>
          <span className="font-mono text-slate-300">FFmpeg RTMP</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Target</span>
          <span className="font-mono text-slate-300">Facebook Live</span>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block h-full shrink-0">{navContent}</aside>
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full">{navContent}</div>
        </div>
      )}
    </>
  );
}
