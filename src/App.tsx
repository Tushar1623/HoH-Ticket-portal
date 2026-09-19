import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Header } from './components/Header';
import { CheckEntry } from './components/CheckEntry';
import { BuyerRegistration } from './components/BuyerRegistration';
import { TicketRegister } from './components/TicketRegister';
import { TicketPassStudio } from './components/TicketPassStudio';
import { ConnectionSettings } from './components/ConnectionSettings';
import { ConnectionMode, StaffRole, TicketRecord } from './types/ticket';
import { calculateSummary, sheetClient } from './lib/sheetClient';
import { RefreshCw } from 'lucide-react';

export function App() {
  const [activeTab, setActiveTab] = useState<'entry' | 'registration' | 'register' | 'passes' | 'settings'>('entry');
  const [role, setRole] = useState<StaffRole>('entry');
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>(sheetClient.getConnectionMode());
  const [tickets, setTickets] = useState<Record<string, TicketRecord>>({});
  const [selectedRegCode, setSelectedRegCode] = useState<string>('HOH001');
  const [loading, setLoading] = useState<boolean>(true);

  // Load ticket database
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await sheetClient.fetchTickets();
      if (res.data) {
        setTickets(res.data);
      }
    } catch (e) {
      console.error('Error fetching tickets:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    if (sheetClient.getScriptUrl()) {
      setConnectionMode('connecting');
      sheetClient.testConnection().then(res => {
        setConnectionMode(res.ok ? 'connected' : 'device');
      });
    } else {
      setConnectionMode('device');
    }
  }, [loadData]);

  // Handle saving buyer registration
  const handleSaveBuyer = async (record: Partial<TicketRecord> & { code: string }) => {
    const res = await sheetClient.upsertBuyer(record);
    if (res.ok && res.data) {
      setTickets(prev => ({
        ...prev,
        [res.data!.code]: res.data!
      }));
    }
    return res;
  };

  // Handle marking ticket entered
  const handleMarkEntered = async (code: string) => {
    const staffLabel = role === 'admin' ? 'Administrator' : role === 'sales' ? 'Sales Desk' : 'Gate Staff';
    const res = await sheetClient.markEntered(code, staffLabel);
    if (res.ok && res.data) {
      setTickets(prev => ({
        ...prev,
        [res.data!.code]: res.data!
      }));
    }
    return res;
  };

  // Reset database
  const handleResetDatabase = () => {
    const clean = sheetClient.resetLocalDatabase();
    setTickets(clean);
  };

  const handleNavigateToCheckEntry = (code: string) => {
    setActiveTab('entry');
  };

  const handleNavigateToRegistration = (code: string) => {
    setSelectedRegCode(code);
    setActiveTab('registration');
  };

  // Calculate live summary
  const summary = useMemo(() => calculateSummary(tickets), [tickets]);

  return (
    <div className="min-h-screen bg-hoh-warm text-hoh-text flex flex-col font-sans selection:bg-hoh-gold/30">
      {/* Box Office Top Nav */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        connectionMode={connectionMode}
        summaryCounts={{
          total: summary.total,
          registered: summary.registered,
          entered: summary.entered
        }}
      />

      {/* Main Content Area */}
      <main className="flex-1 py-4 sm:py-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center min-h-[50vh] text-hoh-burgundy">
            <RefreshCw className="w-8 h-8 animate-spin text-hoh-gold mb-3" />
            <p className="font-serif font-bold text-lg">Loading House of Humour Box Office...</p>
            <p className="text-xs text-stone-500 mt-1">Synchronizing 50 ticket allocations</p>
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
              />
            )}

            {activeTab === 'settings' && (
              <ConnectionSettings
                connectionMode={connectionMode}
                onConnectionChange={setConnectionMode}
                onResetDatabase={handleResetDatabase}
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
            <span>Official Event Box Office & Gate Portal</span>
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
