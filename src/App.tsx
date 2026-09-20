import { useState, useEffect, useMemo, useCallback } from 'react';
import { Header } from './components/Header';
import { CheckEntry } from './components/CheckEntry';
import { BuyerRegistration } from './components/BuyerRegistration';
import { TicketRegister } from './components/TicketRegister';
import { TicketPassStudio } from './components/TicketPassStudio';
import { ConnectionSettings } from './components/ConnectionSettings';
import { ConnectionMode, StaffRole, TicketRecord } from './types/ticket';
import { calculateSummary, apiClient, DEFAULT_PASSKEYS } from './lib/apiClient';
import { canAccessSheetSetup } from './lib/ticketRules';
import { RefreshCw } from 'lucide-react';

export function App() {
  const [activeTab, setActiveTab] = useState<'entry' | 'registration' | 'register' | 'passes' | 'settings'>('entry');
  const [role, setRole] = useState<StaffRole>(apiClient.getSession().role);
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('connecting');
  const [tickets, setTickets] = useState<Record<string, TicketRecord>>({});
  const [selectedRegCode, setSelectedRegCode] = useState<string>('HOH001');
  const [loading, setLoading] = useState<boolean>(true);

  // Load ticket database from MongoDB backend
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.fetchTickets();
      if (res.data) {
        setTickets(res.data);
        setConnectionMode(res.ok ? 'connected' : 'device');
      }
    } catch (e) {
      console.error('Error fetching tickets:', e);
      setConnectionMode('device');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    // Periodically verify server health
    fetch('/health')
      .then(res => res.json())
      .then(() => setConnectionMode('connected'))
      .catch(() => setConnectionMode('device'));
  }, [loadData]);

  // Handle staff role change and credentials
  const handleRoleChange = (newRole: StaffRole, passkey: string) => {
    setRole(newRole);
    const roleNameMap: Record<StaffRole, string> = {
      entry: 'Gate Entry Staff',
      sales: 'Box Office Sales',
      manager: 'Event Manager',
      admin: 'System Admin'
    };
    apiClient.setSession({
      role: newRole,
      passkey: passkey || DEFAULT_PASSKEYS[newRole],
      identity: roleNameMap[newRole]
    });
    // Protect settings tab
    if (!canAccessSheetSetup(newRole) && activeTab === 'settings') {
      setActiveTab('entry');
    }
    loadData();
  };

  // Handle saving buyer registration
  const handleSaveBuyer = async (record: Partial<TicketRecord> & { code: string }) => {
    const res = await apiClient.createBooking({
      buyerName: record.buyerName || '',
      phone: record.phone || '',
      email: record.email || undefined,
      ticketQuantity: 1,
      paymentStatus: record.paymentStatus || 'Paid',
      totalAmount: record.amount || 500,
      notes: record.notes || undefined
    });

    if (res.ok) {
      await loadData();
    }
    return res;
  };

  // Handle marking ticket entered (Zero local fallback: only update if server confirms ok=true)
  const handleMarkEntered = async (code: string) => {
    const res = await apiClient.markEntered(code);
    if (res.ok && res.data) {
      setTickets(prev => ({
        ...prev,
        [code]: {
          ...prev[code],
          entered: true,
          enteredAt: res.data!.enteredAt || new Date().toISOString()
        }
      }));
    }
    return res;
  };

  const handleNavigateToCheckEntry = (_code: string) => {
    setActiveTab('entry');
  };

  const handleNavigateToRegistration = (code: string) => {
    setSelectedRegCode(code);
    setActiveTab('registration');
  };

  // Calculate live summary
  const summary = useMemo(() => calculateSummary(tickets), [tickets]);

  return (
    <div className="min-h-screen bg-hoh-warm flex flex-col selection:bg-hoh-gold/30">
      {/* Box Office Top Header */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        connectionMode={connectionMode}
        staffRole={role}
        onRoleChange={handleRoleChange}
        summaryCounts={{
          total: summary.total,
          registered: summary.registered,
          entered: summary.entered
        }}
      />

      {/* Main Box Office Viewport */}
      <main className="flex-1 pb-16">
        {loading ? (
          <div className="min-h-[400px] flex flex-col items-center justify-center">
            <RefreshCw className="w-8 h-8 text-hoh-burgundy animate-spin mb-2" />
            <span className="text-sm font-semibold text-hoh-burgundy">Loading House of Humour Database...</span>
            <p className="text-xs text-stone-500 mt-1">Synchronizing 50 ticket allocations with MongoDB Atlas</p>
          </div>
        ) : (
          <>
            {activeTab === 'entry' && (
              <CheckEntry
                tickets={tickets}
                onMarkEntered={handleMarkEntered}
                onNavigateToRegistration={handleNavigateToRegistration}
                staffRole={role}
              />
            )}

            {activeTab === 'registration' && (
              <BuyerRegistration
                tickets={tickets}
                selectedCode={selectedRegCode}
                onSave={handleSaveBuyer}
                onNavigateToCheckEntry={handleNavigateToCheckEntry}
                staffRole={role}
              />
            )}

            {activeTab === 'passes' && (
              <TicketPassStudio
                tickets={tickets}
                onSelectForEntry={handleNavigateToCheckEntry}
                onSelectForRegistration={handleNavigateToRegistration}
              />
            )}

            {activeTab === 'register' && (
              <TicketRegister
                tickets={tickets}
                onSelectTicketForEntry={handleNavigateToCheckEntry}
                onSelectTicketForEdit={handleNavigateToRegistration}
                onRefreshData={loadData}
                staffRole={role}
              />
            )}

            {activeTab === 'settings' && canAccessSheetSetup(role) && (
              <ConnectionSettings
                connectionMode={connectionMode}
                onConnectionChange={setConnectionMode}
                onResetDatabase={loadData}
              />
            )}
          </>
        )}
      </main>

      {/* Box Office Footer */}
      <footer className="bg-hoh-burgundy-dark border-t border-hoh-gold/20 py-4 px-4 text-center text-xs text-stone-400 print:hidden">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-serif font-bold text-hoh-gold tracking-wider">HOUSE OF HUMOUR</span>
            <span>&bull;</span>
            <span>MongoDB Atlas Box Office & Gate Portal</span>
          </div>

          <div className="flex items-center gap-3 text-[11px]">
            <span>Capacity: <strong className="text-stone-200">50 Tickets</strong></span>
            <span>&bull;</span>
            <span>Admitted: <strong className="text-emerald-400">{summary.entered}</strong></span>
            <span>&bull;</span>
            <span>Available: <strong className="text-hoh-gold">{summary.available}</strong></span>
          </div>
        </div>
      </footer>
    </div>
  );
}
export default App;
