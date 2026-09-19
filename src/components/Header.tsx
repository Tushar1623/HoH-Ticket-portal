import React from 'react';
import { QrCode, UserPlus, ClipboardList, Settings, Shield, Ticket } from 'lucide-react';
import { ConnectionMode, StaffRole } from '../types/ticket';

interface HeaderProps {
  activeTab: 'entry' | 'registration' | 'register' | 'passes' | 'settings';
  setActiveTab: (tab: 'entry' | 'registration' | 'register' | 'passes' | 'settings') => void;
  connectionMode: ConnectionMode;
  role: StaffRole;
  setRole: (role: StaffRole) => void;
  summaryCounts: {
    total: number;
    registered: number;
    entered: number;
  };
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  connectionMode,
  role,
  setRole,
  summaryCounts
}) => {
  return (
    <header className="bg-gradient-to-r from-[#2A0C13] via-[#451622] to-[#2A0C13] text-white shadow-theatre sticky top-0 z-40 border-b border-hoh-gold/30">
      {/* Top Banner Ribbon */}
      <div className="bg-[#8E1B24] text-[#F7E7B4] text-[10px] sm:text-xs font-semibold tracking-widest text-center py-1 uppercase border-b border-hoh-gold/20 flex items-center justify-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-hoh-gold animate-ping"></span>
        <span>India's Biggest Stand-Up Comedy Talent Hunt &bull; Official Venue Box Office</span>
        <span className="w-1.5 h-1.5 rounded-full bg-hoh-gold animate-ping"></span>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between py-2 sm:py-3 gap-2">
          {/* Logo / Brand with actual HOH emblem */}
          <div className="flex items-center gap-3">
            <div className="relative group cursor-pointer" onClick={() => setActiveTab('entry')}>
              <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-black p-0.5 shadow-gold-glow border-2 border-hoh-gold flex items-center justify-center overflow-hidden">
                <img
                  src="/hoh-logo.png"
                  alt="House of Humour Logo"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-serif font-black text-lg sm:text-2xl tracking-wider text-white flex items-center gap-1.5">
                  <span className="text-white">HOUSE</span>
                  <span className="text-xs font-sans text-stone-300 font-normal">OF</span>
                  <span className="text-hoh-gold bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-500 bg-clip-text text-transparent">
                    HUMOUR
                  </span>
                </h1>
                <span className="hidden sm:inline-block text-[10px] font-mono font-bold uppercase bg-hoh-gold/20 text-hoh-gold border border-hoh-gold/50 px-2 py-0.5 rounded-full">
                  Gate Portal
                </span>
              </div>
              <p className="text-[11px] text-amber-200/80 tracking-wide font-sans hidden sm:block">
                Ticket Registration, QR Verification & Anti-Duplicate Admission System
              </p>
            </div>
          </div>

          {/* Right Meta Controls: Connection Status + Role Selector */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Live Sheet Connection Indicator */}
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              className="cursor-pointer group flex items-center gap-2 px-2.5 py-1.5 rounded-full bg-black/40 hover:bg-black/60 border border-hoh-gold/30 transition-all text-xs"
              title="Click to configure Google Sheet connection"
            >
              <span className="relative flex h-2 w-2">
                {connectionMode === 'connected' ? (
                  <>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </>
                ) : connectionMode === 'connecting' ? (
                  <>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                  </>
                ) : (
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-hoh-gold"></span>
                )}
              </span>
              <span className="hidden md:inline font-medium text-stone-200">
                {connectionMode === 'connected' ? 'Sheet Online' : connectionMode === 'connecting' ? 'Connecting...' : 'Device Mode'}
              </span>
              <span className="md:hidden font-medium text-stone-200">
                {connectionMode === 'connected' ? 'Sheet' : 'Device'}
              </span>
            </button>

            {/* Role Switcher */}
            <div className="relative flex items-center">
              <div className="flex items-center gap-1 bg-black/50 p-1 rounded-xl border border-hoh-gold/30 text-xs">
                <span className="text-hoh-gold/80 px-1 hidden xl:flex items-center gap-1">
                  <Shield className="w-3 h-3" /> Role:
                </span>
                <button
                  type="button"
                  onClick={() => setRole('entry')}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                    role === 'entry'
                      ? 'bg-hoh-gold text-stone-950 font-bold shadow-sm'
                      : 'text-stone-300 hover:text-white'
                  }`}
                  title="Gate Entry Team"
                >
                  Entry
                </button>
                <button
                  type="button"
                  onClick={() => setRole('sales')}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                    role === 'sales'
                      ? 'bg-hoh-gold text-stone-950 font-bold shadow-sm'
                      : 'text-stone-300 hover:text-white'
                  }`}
                  title="Sales & Buyer Registration"
                >
                  Sales
                </button>
                <button
                  type="button"
                  onClick={() => setRole('admin')}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                    role === 'admin'
                      ? 'bg-hoh-gold text-stone-950 font-bold shadow-sm'
                      : 'text-stone-300 hover:text-white'
                  }`}
                  title="Box Office Admin"
                >
                  Admin
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Navigation Tabs Bar */}
        <nav className="flex items-center justify-between border-t border-white/10 pt-1 pb-1 overflow-x-auto no-scrollbar gap-1 sm:gap-2">
          <div className="flex items-center gap-1 sm:gap-2">
            <button
              onClick={() => setActiveTab('entry')}
              className={`flex items-center gap-2 px-3 py-2 rounded-t-xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap border-b-2 ${
                activeTab === 'entry'
                  ? 'border-hoh-gold text-hoh-gold bg-black/30 shadow-inner'
                  : 'border-transparent text-stone-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <QrCode className="w-4 h-4 text-hoh-gold" />
              <span>Check Entry</span>
              <span className="ml-1 text-[11px] px-2 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                {summaryCounts.entered}/50
              </span>
            </button>

            <button
              onClick={() => setActiveTab('registration')}
              className={`flex items-center gap-2 px-3 py-2 rounded-t-xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap border-b-2 ${
                activeTab === 'registration'
                  ? 'border-hoh-gold text-hoh-gold bg-black/30'
                  : 'border-transparent text-stone-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <UserPlus className="w-4 h-4 text-hoh-gold" />
              <span>Buyer Registration</span>
              <span className="ml-1 text-[11px] px-2 py-0.2 rounded-full bg-white/10 text-stone-200">
                {summaryCounts.registered}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('passes')}
              className={`flex items-center gap-2 px-3 py-2 rounded-t-xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap border-b-2 ${
                activeTab === 'passes'
                  ? 'border-hoh-gold text-hoh-gold bg-black/30'
                  : 'border-transparent text-stone-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <Ticket className="w-4 h-4 text-hoh-gold" />
              <span>QR Ticket Passes</span>
            </button>

            <button
              onClick={() => setActiveTab('register')}
              className={`flex items-center gap-2 px-3 py-2 rounded-t-xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap border-b-2 ${
                activeTab === 'register'
                  ? 'border-hoh-gold text-hoh-gold bg-black/30'
                  : 'border-transparent text-stone-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <ClipboardList className="w-4 h-4 text-hoh-gold" />
              <span>Ticket Register</span>
            </button>
          </div>

          <div className="flex items-center">
            <button
              onClick={() => setActiveTab('settings')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-t-xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap border-b-2 ${
                activeTab === 'settings'
                  ? 'border-hoh-gold text-hoh-gold bg-black/30'
                  : 'border-transparent text-stone-300 hover:text-white hover:bg-white/5'
              }`}
              title="Google Sheet and App settings"
            >
              <Settings className="w-4 h-4" />
              <span className="hidden sm:inline">Sheet Setup</span>
            </button>
          </div>
        </nav>
      </div>
    </header>
  );
};
