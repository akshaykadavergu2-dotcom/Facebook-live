import { useState } from 'react';
import { AlertTriangle, History, Search, Trash2 } from 'lucide-react';
import type { StreamHistoryEntry } from '../../shared/types';
import { formatDuration } from '../lib/api';

interface HistoryViewProps {
  history: StreamHistoryEntry[];
  onClearHistory: () => Promise<void>;
}

export function HistoryView({ history, onClearHistory }: HistoryViewProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'Stopped' | 'Completed' | 'Error'>('ALL');
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  const filtered = history.filter((item) => {
    const matchesStatus = statusFilter === 'ALL' || item.status === statusFilter;
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      item.sourceLabel.toLowerCase().includes(q) ||
      (item.errorMessage && item.errorMessage.toLowerCase().includes(q));
    return matchesStatus && matchesSearch;
  });

  const handleClear = async () => {
    setClearing(true);
    setClearError(null);
    try {
      await onClearHistory();
    } catch (err) {
      setClearError(err instanceof Error ? err.message : 'Failed to clear history.');
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="space-y-5 min-w-0">
      <div className="bg-[#121721] border border-[#232B3A] rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 min-w-0">
        <div>
          <h2 className="text-base font-semibold text-slate-100">Stream Session History</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Audit log of FFmpeg RTMP broadcast sessions, output profiles, bitrates, and diagnostics.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
          <div className="relative w-full sm:w-56">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter source or error..."
              className="w-full min-h-[44px] bg-[#0B0E14] border border-[#263042] rounded-xl pl-8 pr-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex flex-wrap p-1 bg-[#0B0E14] border border-[#232B3A] rounded-xl">
            {(['ALL', 'Stopped', 'Completed', 'Error'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setStatusFilter(tab)}
                className={`min-h-[36px] px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                  statusFilter === tab
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab === 'ALL' ? 'All' : tab}
              </button>
            ))}
          </div>

          {history.length > 0 && (
            <button
              type="button"
              onClick={handleClear}
              disabled={clearing}
              className="min-h-[44px] px-3.5 py-2 text-xs font-medium rounded-xl border border-[#2C374C] text-slate-300 hover:text-rose-300 hover:border-rose-500/40 flex items-center gap-1.5 disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{clearing ? 'Clearing...' : 'Clear Log'}</span>
            </button>
          )}
        </div>
      </div>

      {clearError && (
        <div className="p-3 rounded-xl bg-rose-950/35 border border-rose-500/40 text-xs text-rose-200 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <span>{clearError}</span>
        </div>
      )}

      <div className="bg-[#121721] border border-[#232B3A] rounded-2xl overflow-hidden min-w-0">
        {filtered.length === 0 ? (
          <div className="py-14 px-6 text-center">
            <History className="w-8 h-8 text-slate-500 mx-auto mb-2.5" />
            <p className="text-sm font-medium text-slate-200">No Matching Stream Sessions</p>
            <p className="text-xs text-slate-400 mt-1">
              {history.length === 0
                ? 'Sessions will appear here automatically after you run a live FFmpeg broadcast.'
                : 'Try adjusting your search query or status filter.'}
            </p>
          </div>
        ) : (
          <>
            {/* Android mobile stacked list */}
            <div className="md:hidden divide-y divide-[#232B3A]">
              {filtered.map((item) => (
                <div key={item.id} className="p-4 space-y-1.5 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-medium text-slate-100 break-words min-w-0">
                      {item.sourceLabel}
                    </div>
                    <span
                      className={`text-xs font-semibold shrink-0 ${
                        item.status === 'Error' ? 'text-rose-400' : 'text-emerald-400'
                      }`}
                    >
                      {item.status}
                    </span>
                  </div>
                  <div className="text-xs font-mono tabular-nums text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span>{new Date(item.startedAt).toLocaleString()}</span>
                    <span aria-hidden="true">·</span>
                    <span>{item.outputResolution}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatDuration(item.durationSec)}</span>
                    {item.avgBitrateKbps > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{item.avgBitrateKbps} kbps</span>
                      </>
                    )}
                  </div>
                  {item.errorMessage && (
                    <div className="text-xs text-rose-300 break-words pt-0.5">
                      {item.errorMessage}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Tablet / Desktop table */}
            <div className="hidden md:block overflow-x-auto max-w-full">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#232B3A] bg-[#0E131B] text-[11px] font-medium text-slate-400">
                    <th className="py-3 px-4">Started</th>
                    <th className="py-3 px-4">Source</th>
                    <th className="py-3 px-4">Profile</th>
                    <th className="py-3 px-4 text-right">Avg Bitrate</th>
                    <th className="py-3 px-4 text-right">Duration</th>
                    <th className="py-3 px-4">Outcome</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#232B3A] text-xs">
                  {filtered.map((item) => (
                    <tr key={item.id} className="hover:bg-[#161D29] transition-colors">
                      <td className="py-3 px-4 font-mono tabular-nums text-slate-300 whitespace-nowrap">
                        {new Date(item.startedAt).toLocaleString()}
                      </td>
                      <td className="py-3 px-4 max-w-xs">
                        <div className="text-slate-100 font-medium truncate">{item.sourceLabel}</div>
                        {item.errorMessage && (
                          <div className="text-rose-400 text-[11px] mt-0.5 truncate">
                            {item.errorMessage}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-300 whitespace-nowrap">
                        {item.quality} · {item.outputResolution}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-right text-slate-300 whitespace-nowrap">
                        {item.avgBitrateKbps > 0 ? `${item.avgBitrateKbps} kbps` : '—'}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-right text-slate-200 whitespace-nowrap">
                        {formatDuration(item.durationSec)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`font-medium ${
                            item.status === 'Error' ? 'text-rose-400' : 'text-emerald-400'
                          }`}
                        >
                          {item.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
