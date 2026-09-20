import React, { useState } from 'react';
import { QrCode, UserPlus, ClipboardList, Settings, Ticket, Shield, KeyRound, Check, X } from 'lucide-react';
import { ConnectionMode, StaffRole } from '../types/ticket';
import { canAccessSheetSetup } from '../lib/ticketRules';
import { DEFAULT_PASSKEYS } from '../lib/apiClient';

interface HeaderProps {
  activeTab: 'entry' | 'registration' | 'register' | 'passes' | 'settings';
  setActiveTab: (tab: 'entry' | 'registration' | 'register' | 'passes' | 'settings') => void;
  connectionMode: ConnectionMode;
  staffRole: StaffRole;
  onRoleChange: (role: StaffRole, passkey: string) => void;
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
  staffRole,
  onRoleChange,
  summaryCounts
}) => {
  const [authModalOpen, setAuthModalOpen] = useState<boolean>(false);
  const [selectedRole, setSelectedRole] = useState<StaffRole>(staffRole);
  const [passkeyInput, setPasskeyInput] = useState<string>(DEFAULT_PASSKEYS[staffRole]);
  const [authError, setAuthError] = useState<string | null>(null);

  const roleLabels: Record<StaffRole, { title: string; color: string }> = {
    entry: { title: 'Entry Staff', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
    sales: { title: 'Sales Staff', color: 'bg-blue-500/20 text-blue-300 border-blue-500/40' },
    manager: { title: 'Event Manager', color: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
    admin: { title: 'Super Admin', color: 'bg-rose-500/20 text-rose-300 border-rose-500/40' }
  };

  const handleOpenAuthModal = (targetRole: StaffRole) => {
    setSelectedRole(targetRole);
    setPasskeyInput(DEFAULT_PASSKEYS[targetRole] || '');
    setAuthError(null);
    setAuthModalOpen(true);
  };

  const handleApplyAuth = (e: React.FormEvent) => {
    e.preventDefault();
    if (!passkeyInput.trim()) {
      setAuthError('Staff passkey is required.');
      return;
    }

    onRoleChange(selectedRole, passkeyInput.trim());
    setAuthModalOpen(false);
  };

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
          {/* Logo / Brand */}
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

          {/* Right Meta Controls: Role Badge & Connection Indicator */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Authenticated Staff Role Badge / Selector */}
            <button
              type="button"
              onClick={() => handleOpenAuthModal(staffRole)}
              className={`cursor-pointer px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-full border text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm ${roleLabels[staffRole].color}`}
              title="Click to authenticate or switch staff role"
            >
              <Shield className="w-3.5 h-3.5" />
              <span>{roleLabels[staffRole].title}</span>
              <KeyRound className="w-3 h-3 opacity-60 ml-0.5" />
            </button>

            {/* Live MongoDB Atlas Connection Indicator */}
            {canAccessSheetSetup(staffRole) && (
              <button
                type="button"
                onClick={() => setActiveTab('settings')}
                className="cursor-pointer group flex items-center gap-2 px-2.5 py-1.5 rounded-full bg-black/40 hover:bg-black/60 border border-hoh-gold/30 transition-all text-xs"
                title="MongoDB Atlas Database Status & Settings"
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
                  {connectionMode === 'connected' ? 'MongoDB Atlas Online' : connectionMode === 'connecting' ? 'Connecting...' : 'Offline Mode'}
                </span>
                <span className="md:hidden font-medium text-stone-200">
                  {connectionMode === 'connected' ? 'Atlas DB' : 'Offline'}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Navigation Tabs Bar */}
        <nav className="flex items-center justify-between border-t border-white/10 pt-1 pb-1 overflow-x-auto no-scrollbar gap-1 sm:gap-2">
          <div className="flex items-center gap-1 sm:gap-2">
            <button
              onClick={() => setActiveTab('entry')}
              className={`flex items-center gap-2 px-3 py-2 rounded-t-xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap border-b-2 cursor-pointer ${
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
              className={`flex items-center gap-2 px-3 py-2 rounded-t-xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap border-b-2 cursor-pointer ${
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
              className={`flex items-center gap-2 px-3 py-2 rounded-t-xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap border-b-2 cursor-pointer ${
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
              className={`flex items-center gap-2 px-3 py-2 rounded-t-xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap border-b-2 cursor-pointer ${
                activeTab === 'register'
                  ? 'border-hoh-gold text-hoh-gold bg-black/30'
                  : 'border-transparent text-stone-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <ClipboardList className="w-4 h-4 text-hoh-gold" />
              <span>Ticket Register</span>
            </button>
          </div>

          {/* Sheet Setup is strictly hidden from Entry Staff and Sales Staff */}
          {canAccessSheetSetup(staffRole) && (
            <div className="flex items-center">
              <button
                onClick={() => setActiveTab('settings')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-t-xl text-xs sm:text-sm font-semibold transition-all whitespace-nowrap border-b-2 cursor-pointer ${
                  activeTab === 'settings'
                    ? 'border-hoh-gold text-hoh-gold bg-black/30'
                    : 'border-transparent text-stone-300 hover:text-white hover:bg-white/5'
                }`}
                title="MongoDB Atlas Database and App settings"
              >
                <Settings className="w-4 h-4" />
                <span className="hidden sm:inline">Database</span>
              </button>
            </div>
          )}
        </nav>
      </div>

      {/* Staff Authentication Modal */}
      {authModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/70 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-stone-200 text-stone-900 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-stone-100">
              <h3 className="text-lg font-serif font-bold text-hoh-burgundy flex items-center gap-2">
                <Shield className="w-5 h-5 text-hoh-gold" />
                <span>Staff Role Authentication</span>
              </h3>
              <button
                type="button"
                onClick={() => setAuthModalOpen(false)}
                className="p-1 text-stone-400 hover:text-stone-700 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-stone-600">
              Server-verified role permissions. Choose your role and enter the authorized staff passkey.
            </p>

            {authError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">
                {authError}
              </div>
            )}

            <form onSubmit={handleApplyAuth} className="space-y-3">
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-stone-700">Select Role:</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['entry', 'sales', 'manager', 'admin'] as StaffRole[]).map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => {
                        setSelectedRole(r);
                        setPasskeyInput(DEFAULT_PASSKEYS[r] || '');
                      }}
                      className={`p-2 rounded-xl border text-xs font-bold text-left transition-all cursor-pointer ${
                        selectedRole === r
                          ? 'border-hoh-burgundy bg-hoh-burgundy/10 text-hoh-burgundy shadow-sm'
                          : 'border-stone-200 bg-stone-50 text-stone-700 hover:bg-stone-100'
                      }`}
                    >
                      {roleLabels[r].title}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-stone-700">Staff Passkey / Access Key:</label>
                <input
                  type="password"
                  value={passkeyInput}
                  onChange={(e) => setPasskeyInput(e.target.value)}
                  placeholder="Enter staff passkey..."
                  className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-stone-300 focus:border-hoh-burgundy focus:ring-1 focus:ring-hoh-burgundy"
                  required
                />
                <p className="text-[11px] text-stone-400">
                  Verified server-side in MongoDB Atlas with every write request.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setAuthModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold text-white bg-hoh-burgundy hover:bg-hoh-burgundy-light rounded-xl shadow transition-all cursor-pointer"
                >
                  Authenticate Role
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </header>
  );
};
export default Header;
