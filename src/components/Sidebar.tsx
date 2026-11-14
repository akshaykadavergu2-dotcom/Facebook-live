import {
  LayoutDashboard,
  Radio,
  Smartphone,
  Youtube,
  Layers,
  Cast,
  History,
  Settings,
  X,
  Menu,
} from 'lucide-react';
import type { StreamStatusState } from '../../shared/types';
import { PWAInstallButton } from './PWAInstallButton';

export type NavSection =
  | 'dashboard'
  | 'studio'
  | 'android-capture'
  | 'youtube'
  | 'overlays'
  | 'facebook'
  | 'history'
  | 'settings';

export const NAV_ITEMS: Array<{
  id: NavSection;
  label: string;
  shortLabel: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: 'dashboard', label: 'Dashboard', shortLabel: 'Home', icon: LayoutDashboard },
  { id: 'studio', label: 'Live Studio', shortLabel: 'Studio', icon: Radio },
  { id: 'android-capture', label: 'Android Capture', shortLabel: 'Capture', icon: Smartphone },
  { id: 'youtube', label: 'YouTube Preview', shortLabel: 'YouTube', icon: Youtube },
  { id: 'overlays', label: 'Overlays', shortLabel: 'Overlays', icon: Layers },
  { id: 'facebook', label: 'Facebook Output', shortLabel: 'Output', icon: Cast },
  { id: 'history', label: 'Stream History', shortLabel: 'History', icon: History },
  { id: 'settings', label: 'Settings', shortLabel: 'Settings', icon: Settings },
];

interface SidebarProps {
  activeSection: NavSection;
  onSelect: (section: NavSection) => void;
  streamStatus: StreamStatusState;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({
  activeSection,
  onSelect,
  streamStatus,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const navContent = (
    <div className="flex flex-col h-full bg-[#0E131B] border-r border-[#232B3A] w-64 shrink-0 pt-safe pb-safe">
      <div className="h-14 px-5 flex items-center justify-between border-b border-[#232B3A]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
            <Radio className="w-4 h-4 text-white" />
          </div>
          <span className="font-display font-bold tracking-tight text-sm text-slate-100 whitespace-nowrap truncate">
            LIVECAST STUDIO
          </span>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation"
          className="lg:hidden min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-100 hover:bg-[#181F2C]"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label="Studio Navigation">
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
              className={`w-full min-h-[44px] flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                active
                  ? 'bg-blue-600/15 text-blue-400 border border-blue-500/25'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-[#161D29] border border-transparent'
              }`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </span>
              {(item.id === 'studio' || item.id === 'facebook') && streamStatus === 'Live' && (
                <span className="font-mono text-[10px] font-semibold text-red-400 shrink-0">LIVE</span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="px-4 py-3 border-t border-[#232B3A] space-y-2.5">
        <PWAInstallButton />
        <div className="text-xs text-slate-400 space-y-1">
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
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block h-full shrink-0">{navContent}</aside>
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/75 backdrop-blur-xs"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full max-w-[82vw]">{navContent}</div>
        </div>
      )}
    </>
  );
}

interface MobileBottomNavProps {
  activeSection: NavSection;
  onSelect: (section: NavSection) => void;
  onOpenDrawer: () => void;
  streamStatus: StreamStatusState;
}

const PRIMARY_MOBILE_TABS: Array<{
  id: NavSection;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: 'dashboard', label: 'Home', icon: LayoutDashboard },
  { id: 'studio', label: 'Studio', icon: Radio },
  { id: 'android-capture', label: 'Capture', icon: Smartphone },
  { id: 'facebook', label: 'Output', icon: Cast },
];

export function MobileBottomNav({
  activeSection,
  onSelect,
  onOpenDrawer,
  streamStatus,
}: MobileBottomNavProps) {
  const isMoreSection =
    activeSection === 'youtube' ||
    activeSection === 'overlays' ||
    activeSection === 'history' ||
    activeSection === 'settings';

  return (
    <nav
      aria-label="Mobile Primary Navigation"
      className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#0E131B]/95 backdrop-blur-md border-t border-[#232B3A] pb-safe [@media(max-height:480px)]:hidden"
    >
      <div className="grid grid-cols-5 h-14">
        {PRIMARY_MOBILE_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeSection === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelect(tab.id)}
              className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 px-1 transition-colors relative ${
                active ? 'text-blue-400' : 'text-slate-400 active:text-slate-200'
              }`}
            >
              <div className="relative">
                <Icon className="w-5 h-5" />
                {tab.id === 'facebook' && streamStatus === 'Live' && (
                  <span
                    aria-label="Live broadcast active"
                    className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-red-500"
                  />
                )}
              </div>
              <span className="text-[10px] font-medium tracking-tight leading-none whitespace-nowrap">
                {tab.label}
              </span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={onOpenDrawer}
          className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 px-1 transition-colors ${
            isMoreSection ? 'text-blue-400' : 'text-slate-400 active:text-slate-200'
          }`}
        >
          <Menu className="w-5 h-5" />
          <span className="text-[10px] font-medium tracking-tight leading-none whitespace-nowrap">
            More
          </span>
        </button>
      </div>
    </nav>
  );
}
