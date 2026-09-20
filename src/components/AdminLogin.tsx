import React, { useState } from 'react';
import { Lock, User, AlertCircle, Sparkles, Mic2, MapPin, Calendar, Trophy } from 'lucide-react';
import { apiClient } from '../lib/apiClient';

interface AdminLoginProps {
  onLoginSuccess: () => void;
}

export const AdminLogin: React.FC<AdminLoginProps> = ({ onLoginSuccess }) => {
  const [usernameOrEmail, setUsernameOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usernameOrEmail.trim() || !password.trim()) {
      setError('Please enter both your Username/Email and Password.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await apiClient.login(usernameOrEmail.trim(), password.trim());
      if (res.success) {
        onLoginSuccess();
      } else {
        setError(res.error?.message || 'Invalid username or password.');
      }
    } catch {
      setError('Connection failed. Make sure the backend server is running.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative flex flex-col justify-center items-center px-4 py-12 selection:bg-amber-500 selection:text-black overflow-hidden font-sans">
      {/* Theatrical Curtain & Spotlight Overlays */}
      <div className="absolute inset-0 pointer-events-none z-0">
        {/* Stage Spotlight Cones */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[500px] bg-amber-500/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute -top-32 left-10 w-96 h-96 bg-red-800/20 rounded-full blur-[100px] pointer-events-none" />
        <div className="absolute -top-32 right-10 w-96 h-96 bg-red-800/20 rounded-full blur-[100px] pointer-events-none" />
        
        {/* Velvet Curtain Left & Right Accents */}
        <div className="hidden lg:block absolute left-0 top-0 bottom-0 w-32 bg-gradient-to-r from-[#3b0811] via-[#24040a] to-transparent opacity-80" />
        <div className="hidden lg:block absolute right-0 top-0 bottom-0 w-32 bg-gradient-to-l from-[#3b0811] via-[#24040a] to-transparent opacity-80" />
      </div>

      <div className="w-full max-w-md relative z-10 space-y-6">
        {/* Brand Theatrical Marquee Header */}
        <div className="text-center space-y-3">
          {/* Official House of Humour Circular Logo with Stage Spotlight Glow */}
          <div className="relative inline-block mx-auto mb-1">
            <div className="absolute inset-0 rounded-full bg-amber-500/25 blur-2xl animate-pulse pointer-events-none" />
            <img 
              src="/hoh-logo.png" 
              alt="House of Humour Logo" 
              className="relative w-32 h-32 sm:w-36 sm:h-36 object-contain rounded-full shadow-[0_0_35px_rgba(245,158,11,0.45)] border-2 border-amber-400/90 bg-black/90 p-1 mx-auto hoh-logo-glow transition-transform hover:scale-105 duration-300"
            />
          </div>

          {/* Distressed Title */}
          <div>
            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-wider text-transparent bg-clip-text bg-gradient-to-b from-amber-100 via-amber-300 to-amber-600 font-bebas drop-shadow-[0_4px_10px_rgba(0,0,0,0.9)]">
              HOUSE OF HUMOUR
            </h1>
            
            {/* Theatrical Crimson Ribbon */}
            <div className="inline-block mt-1 px-4 py-1 rounded-full bg-gradient-to-r from-red-900 via-red-700 to-red-900 border border-amber-500/50 text-[11px] font-bold tracking-widest text-amber-200 uppercase shadow-md shadow-black/60 font-cinzel">
              India's Biggest Stand-Up Comedy Talent Hunt
            </div>
            <div className="text-[10px] uppercase font-bold tracking-[0.25em] text-amber-500/80 mt-1 font-cinzel">
              North • South • East • West
            </div>
          </div>

          {/* Event Venue Subtitle */}
          <div className="flex items-center justify-center gap-3 text-xs text-amber-200/80 font-medium">
            <span className="flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5 text-amber-400" />
              The Satire Club • Kolkata
            </span>
            <span>•</span>
            <span className="flex items-center gap-1 text-amber-400 font-bold">
              <Trophy className="w-3.5 h-3.5" />
              Win ₹15,000
            </span>
          </div>
        </div>

        {/* Vintage Theater Placard Card */}
        <div className="theatre-placard rounded-2xl p-7 sm:p-8 backdrop-blur-md relative overflow-hidden">
          {/* Subtle Top Brass Corner Brackets */}
          <div className="absolute top-2 left-2 w-3 h-3 border-t-2 border-l-2 border-amber-500/60 pointer-events-none" />
          <div className="absolute top-2 right-2 w-3 h-3 border-t-2 border-r-2 border-amber-500/60 pointer-events-none" />
          <div className="absolute bottom-2 left-2 w-3 h-3 border-b-2 border-l-2 border-amber-500/60 pointer-events-none" />
          <div className="absolute bottom-2 right-2 w-3 h-3 border-b-2 border-r-2 border-amber-500/60 pointer-events-none" />

          {/* Header inside Card */}
          <div className="flex items-center justify-between border-b border-amber-500/20 pb-4 mb-5">
            <div>
              <h2 className="text-base font-bold text-amber-100 uppercase tracking-wide font-cinzel flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                Box Office Entrance
              </h2>
              <p className="text-[11px] text-amber-300/60 mt-0.5">Physical Ticket & Gate Management</p>
            </div>
            <span className="text-[10px] uppercase font-mono font-bold px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400">
              Admin Only
            </span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 bg-red-950/80 border border-red-500/50 rounded-xl flex items-start gap-2.5 text-red-200 text-xs shadow-lg animate-in fade-in duration-150">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div className="flex-1 font-medium">{error}</div>
              </div>
            )}

            <div>
              <label className="block text-[11px] font-bold text-amber-200/90 uppercase tracking-wider mb-1.5 font-cinzel">
                Username or Email
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-amber-500/70">
                  <User className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  value={usernameOrEmail}
                  onChange={(e) => setUsernameOrEmail(e.target.value)}
                  placeholder="admin or admin@hoh.com"
                  autoComplete="username"
                  required
                  className="w-full pl-10 pr-4 py-2.5 bg-[#0e0204]/90 border border-amber-500/30 rounded-xl text-amber-50 placeholder-stone-600 text-xs focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400/50 transition-all font-medium"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-amber-200/90 uppercase tracking-wider mb-1.5 font-cinzel">
                Admin Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-amber-500/70">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  autoComplete="current-password"
                  required
                  className="w-full pl-10 pr-4 py-2.5 bg-[#0e0204]/90 border border-amber-500/30 rounded-xl text-amber-50 placeholder-stone-600 text-xs focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400/50 transition-all font-medium"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-3 px-4 bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 hover:from-amber-400 hover:to-amber-300 text-stone-950 font-black rounded-xl text-xs uppercase tracking-widest shadow-[0_4px_15px_rgba(245,158,11,0.35)] hover:shadow-[0_6px_20px_rgba(245,158,11,0.5)] active:scale-[0.99] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer font-cinzel"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-stone-950 border-t-transparent rounded-full animate-spin" />
                  <span>Entering Box Office...</span>
                </>
              ) : (
                <>
                  <span>Unlock Box Office</span>
                  <span className="text-stone-900 font-bold">→</span>
                </>
              )}
            </button>
          </form>

          {/* Vintage Ticket Notice */}
          <div className="mt-5 pt-4 border-t border-amber-500/20 text-center text-[11px] text-amber-200/60 font-mono">
            50 Physical Tickets • Anchor Consecutive Engine
          </div>
        </div>

        {/* Footer Tagline from Poster */}
        <div className="text-center space-y-1 text-xs text-amber-400/80 font-cinzel tracking-wider">
          <p className="font-bold text-amber-300">"NOT JUST A MIC. IT'S YOUR MOMENT."</p>
          <p className="text-[10px] text-amber-200/40">House of Humour • The Satire Club Edition</p>
        </div>
      </div>
    </div>
  );
};
