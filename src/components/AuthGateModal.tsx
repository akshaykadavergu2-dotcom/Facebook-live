import { useState, type FormEvent } from 'react';
import { Lock, Radio } from 'lucide-react';
import { api } from '../lib/api';

interface AuthGateModalProps {
  onAuthenticated: () => void;
}

export function AuthGateModal({ onAuthenticated }: AuthGateModalProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.login(password);
      onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0E14] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#121721] border border-[#232B3A] rounded-lg p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded bg-blue-600 flex items-center justify-center">
            <Radio className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-display text-lg font-bold text-slate-100">LIVECAST STUDIO</h1>
            <p className="text-xs text-slate-400">Operator Sign-In Required</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="studio-password" className="block text-xs font-medium text-slate-300 mb-1.5">
              Studio Operator Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="studio-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter STUDIO_ADMIN_PASSWORD"
                className="w-full bg-[#0B0E14] border border-[#263042] rounded-md pl-9 pr-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {error && (
            <div className="p-2.5 rounded bg-rose-950/35 border border-rose-500/40 text-xs text-rose-200">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold disabled:opacity-50"
          >
            {loading ? 'Verifying...' : 'Unlock Control Room'}
          </button>
        </form>
      </div>
    </div>
  );
}
