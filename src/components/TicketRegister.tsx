import React, { useState, useMemo } from 'react';
import { 
  Search, Download, Edit3, CheckCircle, Clock,
  Users, IndianRupee, ShieldCheck, Ticket, Filter, RefreshCw,
  RotateCcw, Trash2, AlertTriangle, X, Check, Lock, Loader2, Info
} from 'lucide-react';
import { TicketRecord } from '../types/ticket';
import { calculateSummary, sheetClient } from '../lib/sheetClient';
import { formatCurrency, formatLocalTimestamp, VALID_TICKET_CODES } from '../lib/ticketRules';
import { PaymentBadge, EntryBadge } from './StatusBadge';

interface TicketRegisterProps {
  tickets: Record<string, TicketRecord>;
  onSelectTicketForEntry: (code: string) => void;
  onSelectTicketForEdit: (code: string) => void;
  onSetEntryStatus?: (code: string, entered: boolean, reason?: string) => Promise<{ ok: boolean; message?: string; error?: string }>;
  onRefreshData?: () => void;
}

export const TicketRegister: React.FC<TicketRegisterProps> = ({
  tickets,
  onSelectTicketForEntry,
  onSelectTicketForEdit,
  onSetEntryStatus,
  onRefreshData
}) => {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [filterType, setFilterType] = useState<'all' | 'registered' | 'available' | 'paid' | 'pending' | 'entered' | 'not-entered'>('all');

  // Modals & Action States
  const [entryToggleTicket, setEntryToggleTicket] = useState<TicketRecord | null>(null);
  const [entryToggleReason, setEntryToggleReason] = useState<string>('');

  const [clearTicketModalData, setClearTicketModalData] = useState<TicketRecord | null>(null);
  const [clearCodeConfirm, setClearCodeConfirm] = useState<string>('');
  const [clearReason, setClearReason] = useState<string>('');

  const [resetAllModalOpen, setResetAllModalOpen] = useState<boolean>(false);
  const [resetAllConfirmText, setResetAllConfirmText] = useState<string>('');
  const [resetAllReason, setResetAllReason] = useState<string>('');

  const [togglingCode, setTogglingCode] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [actionFeedback, setActionFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // 1-Click Direct Entry Status Toggle (Instant access)
  const handleDirectEntryToggle = async (ticket: TicketRecord) => {
    if (togglingCode) return;
    setTogglingCode(ticket.code);
    setActionFeedback(null);

    const targetEntered = !ticket.entered;
    let res;

    if (onSetEntryStatus) {
      res = await onSetEntryStatus(
        ticket.code,
        targetEntered,
        `Direct 1-click toggle to ${targetEntered ? 'Entered' : 'Not Entered'}`
      );
    } else {
      res = await sheetClient.setEntryStatus(
        ticket.code,
        targetEntered,
        `Direct 1-click toggle to ${targetEntered ? 'Entered' : 'Not Entered'}`,
        'Ticket Register Staff'
      );
    }

    setTogglingCode(null);

    if (res && res.ok) {
      setActionFeedback({
        type: 'success',
        message: res.message || `Ticket ${ticket.code} directly marked as ${targetEntered ? 'Entered' : 'Not Entered'}.`
      });
      if (onRefreshData) onRefreshData();
    } else {
      setActionFeedback({
        type: 'error',
        message: res?.error || 'Failed to toggle entry status.'
      });
    }
  };

  // Calculate live KPI counts
  const summary = useMemo(() => calculateSummary(tickets), [tickets]);

  // Filter tickets
  const filteredTickets = useMemo(() => {
    return VALID_TICKET_CODES.map(code => tickets[code] || {
      code,
      qrPayload: code,
      buyerName: '',
      phone: '',
      guests: 1,
      paymentStatus: 'Pending',
      amount: 0,
      entered: false,
      updatedAt: ''
    }).filter(ticket => {
      const isReg = Boolean(ticket.buyerName && ticket.buyerName.trim() !== '');

      // Status filter
      if (filterType === 'registered' && !isReg) return false;
      if (filterType === 'available' && isReg) return false;
      if (filterType === 'paid' && ticket.paymentStatus !== 'Paid') return false;
      if (filterType === 'pending' && ticket.paymentStatus !== 'Pending') return false;
      if (filterType === 'entered' && !ticket.entered) return false;
      if (filterType === 'not-entered' && (ticket.entered || !isReg)) return false;

      // Search match (code, buyerName, phone, notes)
      if (searchTerm.trim() !== '') {
        const query = searchTerm.toLowerCase().trim();
        const codeMatch = ticket.code.toLowerCase().includes(query);
        const nameMatch = (ticket.buyerName || '').toLowerCase().includes(query);
        const phoneMatch = (ticket.phone || '').toLowerCase().includes(query);
        const notesMatch = (ticket.notes || '').toLowerCase().includes(query);
        const paymentMatch = (ticket.paymentStatus || '').toLowerCase().includes(query);
        return codeMatch || nameMatch || phoneMatch || notesMatch || paymentMatch;
      }

      return true;
    });
  }, [tickets, filterType, searchTerm]);

  // Export to CSV
  const handleExportCSV = () => {
    const headers = ['Code', 'Buyer Name', 'Phone', 'Email', 'Guests', 'Payment Status', 'Amount', 'Entered', 'Entered At', 'Notes'];
    const rows = VALID_TICKET_CODES.map(c => {
      const t = tickets[c];
      return [
        c,
        t?.buyerName ? `"${t.buyerName.replace(/"/g, '""')}"` : '',
        t?.phone ? `"${t.phone}"` : '',
        t?.email ? `"${t.email}"` : '',
        t?.guests || 1,
        t?.paymentStatus || 'Pending',
        t?.amount || 0,
        t?.entered ? 'YES' : 'NO',
        t?.enteredAt ? `"${t.enteredAt}"` : '',
        t?.notes ? `"${(t.notes || '').replace(/"/g, '""')}"` : ''
      ].join(',');
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `HOH_Tickets_Export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Action 1: Toggle Entry Status
  const handleConfirmEntryToggle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entryToggleTicket) return;

    const trimmedReason = entryToggleReason.trim();
    if (!trimmedReason) {
      setActionFeedback({ type: 'error', message: 'A reason is required to change entry status.' });
      return;
    }

    setActionLoading(true);
    setActionFeedback(null);

    const targetEntered = !entryToggleTicket.entered;
    let res;
    if (onSetEntryStatus) {
      res = await onSetEntryStatus(entryToggleTicket.code, targetEntered, trimmedReason);
    } else {
      res = await sheetClient.setEntryStatus(
        entryToggleTicket.code,
        targetEntered,
        trimmedReason,
        'Ticket Register Desk'
      );
    }

    setActionLoading(false);

    if (res.ok) {
      setActionFeedback({
        type: 'success',
        message: res.message || `Ticket ${entryToggleTicket.code} marked as ${targetEntered ? 'Entered' : 'Not Entered'}.`
      });
      setEntryToggleTicket(null);
      setEntryToggleReason('');
      if (onRefreshData) onRefreshData();
    } else {
      setActionFeedback({ type: 'error', message: res.error || 'Failed to update entry status.' });
    }
  };

  // Action 2: Clear One Ticket Data
  const handleConfirmClearTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clearTicketModalData) return;

    if (clearCodeConfirm.trim().toUpperCase() !== clearTicketModalData.code) {
      setActionFeedback({ type: 'error', message: `Please type the exact code: ${clearTicketModalData.code}` });
      return;
    }

    setActionLoading(true);
    setActionFeedback(null);

    const res = await sheetClient.clearTicketData(
      clearTicketModalData.code,
      clearReason.trim() || 'Manual single-ticket clear',
      'Ticket Register Reset'
    );

    setActionLoading(false);

    if (res.ok) {
      setActionFeedback({
        type: 'success',
        message: res.message || `Ticket ${clearTicketModalData.code} buyer data cleared successfully.`
      });
      setClearTicketModalData(null);
      setClearCodeConfirm('');
      setClearReason('');
      if (onRefreshData) onRefreshData();
    } else {
      setActionFeedback({ type: 'error', message: res.error || 'Failed to clear ticket data.' });
    }
  };

  // Action 3: Reset All Ticket Data
  const handleConfirmResetAll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (resetAllConfirmText.trim() !== 'RESET HOH EVENT') {
      setActionFeedback({ type: 'error', message: 'Confirmation mismatch. You must type RESET HOH EVENT.' });
      return;
    }

    setActionLoading(true);
    setActionFeedback(null);

    const res = await sheetClient.resetAllTicketData(
      resetAllConfirmText.trim(),
      resetAllReason.trim() || 'Full event data reset',
      'Ticket Register Admin'
    );

    setActionLoading(false);

    if (res.ok) {
      setActionFeedback({
        type: 'success',
        message: res.message || 'All ticket data reset successfully. Backup created in Google Sheets!'
      });
      setResetAllModalOpen(false);
      setResetAllConfirmText('');
      setResetAllReason('');
      if (onRefreshData) onRefreshData();
    } else {
      setActionFeedback({ type: 'error', message: res.error || 'Failed to reset all ticket data.' });
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 space-y-6">
      {/* Top Banner / Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-serif font-bold text-hoh-burgundy flex items-center gap-2">
            <span>Ticket Register & Box Office</span>
            <span className="text-xs bg-hoh-burgundy/10 text-hoh-burgundy font-sans font-semibold px-2 py-0.5 rounded-full border border-hoh-burgundy/20">
              50 Tickets
            </span>
          </h2>
          <p className="text-sm text-hoh-muted mt-0.5">
            Full overview of all 50 House of Humour tickets, payments, door admission, and direct data controls.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          {onRefreshData && (
            <button
              type="button"
              onClick={onRefreshData}
              className="p-2 bg-white text-stone-700 hover:text-hoh-burgundy border border-stone-300 rounded-xl transition-all shadow-sm"
              title="Refresh tickets from Google Sheet / Storage"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}

          <button
            type="button"
            onClick={handleExportCSV}
            className="px-3.5 py-2 bg-white hover:bg-stone-50 text-hoh-burgundy border border-stone-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors"
          >
            <Download className="w-4 h-4 text-hoh-gold" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Global Feedback Alert */}
      {actionFeedback && (
        <div className={`p-4 rounded-xl border flex items-center justify-between shadow-sm animate-fade-in ${
          actionFeedback.type === 'success'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
            : 'bg-rose-50 border-rose-200 text-rose-900'
        }`}>
          <div className="flex items-center gap-2 text-sm font-medium">
            {actionFeedback.type === 'success' ? (
              <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-rose-600 flex-shrink-0" />
            )}
            <span>{actionFeedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionFeedback(null)}
            className="p-1 text-stone-400 hover:text-stone-700 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* KPI Cards Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        {/* Total Capacity */}
        <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-sm">
          <div className="text-xs text-stone-500 font-medium flex items-center gap-1">
            <Ticket className="w-3.5 h-3.5 text-hoh-burgundy" />
            <span>Total Tickets</span>
          </div>
          <div className="text-2xl font-bold font-mono text-hoh-burgundy mt-1">
            {summary.total}
          </div>
          <div className="text-[11px] text-stone-400 mt-0.5">HOH001 – HOH050</div>
        </div>

        {/* Registered / Sold */}
        <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-sm">
          <div className="text-xs text-stone-500 font-medium flex items-center gap-1">
            <Users className="w-3.5 h-3.5 text-emerald-600" />
            <span>Registered</span>
          </div>
          <div className="text-2xl font-bold font-mono text-emerald-700 mt-1">
            {summary.registered}
          </div>
          <div className="text-[11px] text-stone-400 mt-0.5">{summary.totalGuests} Guests Headcount</div>
        </div>

        {/* Available */}
        <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-sm">
          <div className="text-xs text-stone-500 font-medium flex items-center gap-1">
            <Ticket className="w-3.5 h-3.5 text-stone-400" />
            <span>Available</span>
          </div>
          <div className="text-2xl font-bold font-mono text-stone-700 mt-1">
            {summary.available}
          </div>
          <div className="text-[11px] text-stone-400 mt-0.5">Unsold seats</div>
        </div>

        {/* Venue Admitted */}
        <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-sm">
          <div className="text-xs text-stone-500 font-medium flex items-center gap-1">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
            <span>Entered</span>
          </div>
          <div className="text-2xl font-bold font-mono text-emerald-800 mt-1">
            {summary.entered}
          </div>
          <div className="text-[11px] text-stone-400 mt-0.5">Admitted at door</div>
        </div>

        {/* Pending Admission */}
        <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-sm">
          <div className="text-xs text-stone-500 font-medium flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-amber-600" />
            <span>Not Entered</span>
          </div>
          <div className="text-2xl font-bold font-mono text-amber-800 mt-1">
            {summary.notEntered}
          </div>
          <div className="text-[11px] text-stone-400 mt-0.5">Awaiting arrival</div>
        </div>

        {/* Total Revenue */}
        <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-sm">
          <div className="text-xs text-stone-500 font-medium flex items-center gap-1">
            <IndianRupee className="w-3.5 h-3.5 text-amber-600" />
            <span>Collected</span>
          </div>
          <div className="text-xl font-bold font-mono text-amber-900 mt-1 truncate">
            {formatCurrency(summary.totalRevenue)}
          </div>
          <div className="text-[11px] text-stone-400 mt-0.5">Paid bookings</div>
        </div>
      </div>

      {/* Search & Filter Strip */}
      <div className="bg-white p-4 rounded-2xl shadow-theatre border border-stone-200 space-y-3">
        <div className="flex flex-col md:flex-row items-center gap-3">
          {/* Search Box */}
          <div className="relative w-full md:flex-1">
            <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search code (HOH012), buyer name, phone number, notes..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-stone-300 text-sm focus:border-hoh-burgundy focus:ring-1 focus:ring-hoh-burgundy text-hoh-text placeholder-stone-400"
            />
          </div>

          {/* Quick Filter Buttons */}
          <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto pb-1 md:pb-0 no-scrollbar">
            <span className="text-xs text-stone-400 flex items-center gap-1 pl-1">
              <Filter className="w-3 h-3" />
            </span>
            <button
              type="button"
              onClick={() => setFilterType('all')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                filterType === 'all'
                  ? 'bg-hoh-burgundy text-white font-semibold'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              All ({summary.total})
            </button>
            <button
              type="button"
              onClick={() => setFilterType('registered')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                filterType === 'registered'
                  ? 'bg-hoh-burgundy text-white font-semibold'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              Registered ({summary.registered})
            </button>
            <button
              type="button"
              onClick={() => setFilterType('available')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                filterType === 'available'
                  ? 'bg-hoh-burgundy text-white font-semibold'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              Available ({summary.available})
            </button>
            <button
              type="button"
              onClick={() => setFilterType('entered')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                filterType === 'entered'
                  ? 'bg-hoh-burgundy text-white font-semibold'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              Entered ({summary.entered})
            </button>
          </div>
        </div>

        {/* Result count indicator */}
        <div className="flex items-center justify-between text-xs text-stone-500 pt-1">
          <span>Showing <strong>{filteredTickets.length}</strong> of 50 tickets</span>
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="text-hoh-burgundy underline hover:text-hoh-gold-dark"
            >
              Clear search
            </button>
          )}
        </div>
      </div>

      {/* 50 Tickets Table */}
      <div className="bg-white rounded-2xl shadow-theatre border border-stone-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-hoh-burgundy text-white text-xs uppercase tracking-wider font-semibold border-b border-hoh-gold/20">
                <th className="py-3.5 px-4">Code</th>
                <th className="py-3.5 px-4">Buyer Name</th>
                <th className="py-3.5 px-4">Phone</th>
                <th className="py-3.5 px-4 text-center">Guests</th>
                <th className="py-3.5 px-4">Payment</th>
                <th className="py-3.5 px-4">Amount</th>
                <th className="py-3.5 px-4">Venue Entry</th>
                <th className="py-3.5 px-4 text-right">Row Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200 text-sm">
              {filteredTickets.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-stone-500">
                    No tickets match the search query or filter.
                  </td>
                </tr>
              ) : (
                filteredTickets.map((t) => {
                  const isReg = Boolean(t.buyerName && t.buyerName.trim() !== '');

                  return (
                    <tr
                      key={t.code}
                      className={`hover:bg-hoh-warm/50 transition-colors ${
                        t.entered ? 'bg-emerald-50/30' : ''
                      }`}
                    >
                      {/* Ticket Code */}
                      <td className="py-3 px-4 font-mono font-bold text-hoh-burgundy">
                        <span className="bg-hoh-burgundy/10 px-2 py-1 rounded text-xs">
                          {t.code}
                        </span>
                      </td>

                      {/* Buyer Name */}
                      <td className="py-3 px-4">
                        {isReg ? (
                          <div className="font-semibold text-hoh-text">
                            {t.buyerName}
                            {t.email && (
                              <div className="text-xs text-stone-400 font-normal">
                                {t.email}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-stone-400 italic">
                            Unassigned
                          </span>
                        )}
                      </td>

                      {/* Phone */}
                      <td className="py-3 px-4 font-mono text-xs text-stone-600">
                        {t.phone || '—'}
                      </td>

                      {/* Guests */}
                      <td className="py-3 px-4 text-center">
                        {isReg ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-stone-100 text-stone-800">
                            {t.guests}
                          </span>
                        ) : (
                          <span className="text-stone-300">—</span>
                        )}
                      </td>

                      {/* Payment Status */}
                      <td className="py-3 px-4">
                        {isReg ? (
                          <PaymentBadge status={t.paymentStatus} size="sm" />
                        ) : (
                          <span className="text-stone-300 text-xs">—</span>
                        )}
                      </td>

                      {/* Amount */}
                      <td className="py-3 px-4 font-mono font-medium text-stone-800 text-xs">
                        {isReg ? formatCurrency(t.amount) : '—'}
                      </td>

                      {/* Entry Status (1-Click Direct Toggle Button) */}
                      <td className="py-3 px-4">
                        <div className="flex flex-col gap-1 items-start">
                          <button
                            type="button"
                            onClick={() => handleDirectEntryToggle(t)}
                            disabled={togglingCode === t.code}
                            className={`group relative inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all shadow-sm active:scale-95 cursor-pointer ${
                              t.entered
                                ? 'bg-emerald-100 text-emerald-800 hover:bg-amber-100 hover:text-amber-900 border border-emerald-300 hover:border-amber-400'
                                : 'bg-stone-100 text-stone-600 hover:bg-emerald-100 hover:text-emerald-900 border border-stone-300 hover:border-emerald-400'
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                            title={t.entered ? "Click to directly mark as Not Entered" : "Click to directly mark as Entered"}
                          >
                            {togglingCode === t.code ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-hoh-burgundy" />
                                <span>Updating...</span>
                              </>
                            ) : t.entered ? (
                              <>
                                <CheckCircle className="w-3.5 h-3.5 text-emerald-600 group-hover:hidden" />
                                <RotateCcw className="w-3.5 h-3.5 text-amber-700 hidden group-hover:inline" />
                                <span className="group-hover:hidden">Entered</span>
                                <span className="hidden group-hover:inline">Mark Not Entered</span>
                              </>
                            ) : (
                              <>
                                <Clock className="w-3.5 h-3.5 text-stone-400 group-hover:hidden" />
                                <CheckCircle className="w-3.5 h-3.5 text-emerald-600 hidden group-hover:inline" />
                                <span className="group-hover:hidden">Not Entered</span>
                                <span className="hidden group-hover:inline">Mark Entered</span>
                              </>
                            )}
                          </button>
                          {t.entered && t.enteredAt && (
                            <div className="text-[11px] text-stone-500 flex items-center gap-1 font-mono pl-1">
                              <Clock className="w-3 h-3 text-stone-400" />
                              {formatLocalTimestamp(t.enteredAt)}
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Row Actions */}
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {/* 1. Verify at Gate */}
                          <button
                            type="button"
                            onClick={() => onSelectTicketForEntry(t.code)}
                            className="p-1.5 text-hoh-burgundy hover:bg-hoh-burgundy/10 rounded-lg transition-colors"
                            title="Verify & Scan at Gate"
                          >
                            <ShieldCheck className="w-4 h-4 text-hoh-burgundy" />
                          </button>

                          {/* 2. Edit Registration */}
                          <button
                            type="button"
                            onClick={() => onSelectTicketForEdit(t.code)}
                            className="p-1.5 text-stone-600 hover:text-hoh-burgundy hover:bg-stone-100 rounded-lg transition-colors"
                            title="Edit or register buyer"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>

                          {/* 3. Manual Entry Status Toggle */}
                          <button
                            type="button"
                            onClick={() => {
                              setEntryToggleTicket(t);
                              setEntryToggleReason('');
                              setActionFeedback(null);
                            }}
                            className={`p-1.5 rounded-lg transition-colors ${
                              t.entered
                                ? 'text-amber-700 hover:bg-amber-100 hover:text-amber-900'
                                : 'text-emerald-700 hover:bg-emerald-100 hover:text-emerald-900'
                            }`}
                            title={t.entered ? 'Mark Not Entered' : 'Mark Entered'}
                          >
                            {t.entered ? (
                              <RotateCcw className="w-4 h-4" />
                            ) : (
                              <CheckCircle className="w-4 h-4" />
                            )}
                          </button>

                          {/* 4. Clear Ticket Data */}
                          <button
                            type="button"
                            onClick={() => {
                              setClearTicketModalData(t);
                              setClearCodeConfirm('');
                              setClearReason('');
                              setActionFeedback(null);
                            }}
                            className="p-1.5 text-stone-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                            title="Clear ticket data"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Danger Zone: Reset All Ticket Data (Bottom of page) */}
      <div className="bg-gradient-to-r from-rose-50 via-white to-amber-50 rounded-2xl border border-rose-200 p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 bg-rose-100 text-rose-700 rounded-xl mt-0.5">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-rose-900 flex items-center gap-2">
                <span>Reset All Ticket Data</span>
                <span className="text-[11px] font-mono px-2 py-0.5 bg-rose-200/70 text-rose-800 rounded-full font-semibold">
                  Event Reset
                </span>
              </h3>
              <p className="text-xs text-stone-600 mt-1 max-w-2xl leading-relaxed">
                Clears all buyer registrations, guest headcounts, payment records, and admission timestamps across all 50 tickets (<span className="font-mono font-bold">HOH001–HOH050</span>). An automated Google Sheet backup tab (<span className="font-mono bg-stone-100 px-1 py-0.5 rounded text-stone-700">Backup_YYYY-MM-DD_HH-mm</span>) will be created prior to clearing.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setResetAllModalOpen(true);
              setResetAllConfirmText('');
              setResetAllReason('');
              setActionFeedback(null);
            }}
            className="px-4 py-2.5 bg-rose-700 hover:bg-rose-800 text-white rounded-xl text-xs font-bold shadow-md hover:shadow-lg transition-all flex items-center gap-2 whitespace-nowrap self-stretch sm:self-auto justify-center"
          >
            <Trash2 className="w-4 h-4" />
            <span>Reset All Ticket Data</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* MODAL 1: Entry Status Toggle Confirmation */}
      {/* ========================================================================= */}
      {entryToggleTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-stone-200 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-stone-100">
              <h3 className="text-lg font-serif font-bold text-hoh-burgundy flex items-center gap-2">
                <Ticket className="w-5 h-5 text-hoh-gold" />
                <span>Confirm Entry Status Change</span>
              </h3>
              <button
                type="button"
                onClick={() => setEntryToggleTicket(null)}
                disabled={actionLoading}
                className="p-1 text-stone-400 hover:text-stone-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="bg-stone-50 p-3.5 rounded-xl border border-stone-200 text-xs space-y-2">
                <div className="flex justify-between">
                  <span className="text-stone-500 font-medium">Ticket Code:</span>
                  <span className="font-mono font-bold text-hoh-burgundy">{entryToggleTicket.code}</span>
                </div>
                {entryToggleTicket.buyerName && (
                  <div className="flex justify-between">
                    <span className="text-stone-500 font-medium">Buyer:</span>
                    <span className="font-semibold text-stone-800">{entryToggleTicket.buyerName}</span>
                  </div>
                )}
                <div className="flex justify-between items-center pt-1 border-t border-stone-200">
                  <span className="text-stone-500 font-medium">Status Change:</span>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                      entryToggleTicket.entered ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-200 text-stone-700'
                    }`}>
                      {entryToggleTicket.entered ? 'Entered' : 'Not Entered'}
                    </span>
                    <span className="text-stone-400">➔</span>
                    <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                      !entryToggleTicket.entered ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                    }`}>
                      {!entryToggleTicket.entered ? 'Entered' : 'Not Entered'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Exact Warning Requirement when changing Entered -> Not Entered */}
              {entryToggleTicket.entered && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2.5 text-xs text-amber-900">
                  <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="font-medium leading-relaxed">
                    This ticket can be used again after this change.
                  </p>
                </div>
              )}

              {/* Mandatory Reason Input */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-stone-700">
                  Reason for Manual Change <span className="text-rose-600">*</span>
                </label>
                <textarea
                  rows={2}
                  value={entryToggleReason}
                  onChange={(e) => setEntryToggleReason(e.target.value)}
                  placeholder="e.g. Guest stepped out temporarily / Correction by box office"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-stone-300 focus:border-hoh-burgundy focus:ring-1 focus:ring-hoh-burgundy text-hoh-text placeholder-stone-400"
                  required
                />
                <p className="text-[11px] text-stone-400">
                  This reason will be permanently recorded in the Google Sheet Audit Log.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-stone-100">
              <button
                type="button"
                onClick={() => setEntryToggleTicket(null)}
                disabled={actionLoading}
                className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl transition-colors"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleConfirmEntryToggle}
                disabled={actionLoading || !entryToggleReason.trim()}
                className={`px-4 py-2 text-xs font-bold text-white rounded-xl shadow transition-all flex items-center gap-1.5 ${
                  !entryToggleTicket.entered
                    ? 'bg-emerald-700 hover:bg-emerald-800'
                    : 'bg-amber-700 hover:bg-amber-800'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {actionLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>
                  {entryToggleTicket.entered ? 'Mark Not Entered' : 'Mark Entered'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: Clear One Ticket Data Confirmation */}
      {/* ========================================================================= */}
      {clearTicketModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-stone-200 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-stone-100">
              <h3 className="text-lg font-serif font-bold text-rose-900 flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-rose-600" />
                <span>Clear Ticket Data</span>
              </h3>
              <button
                type="button"
                onClick={() => setClearTicketModalData(null)}
                disabled={actionLoading}
                className="p-1 text-stone-400 hover:text-stone-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900 space-y-1.5">
                <p className="font-semibold">
                  You are about to clear all buyer and admission data for ticket <span className="font-mono font-bold text-rose-950 underline">{clearTicketModalData.code}</span>.
                </p>
                <p className="text-[11px] text-rose-700 leading-relaxed">
                  The row will not be deleted, and Code & QR Payload will remain unchanged. Buyer name, phone, email, guests, payment status, and entry status will be reset.
                </p>
              </div>

              {/* Exact Ticket Code Typing Confirmation */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-stone-700">
                  Type <span className="font-mono font-bold text-rose-700">{clearTicketModalData.code}</span> to confirm:
                </label>
                <input
                  type="text"
                  value={clearCodeConfirm}
                  onChange={(e) => setClearCodeConfirm(e.target.value)}
                  placeholder={`e.g. ${clearTicketModalData.code}`}
                  className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-stone-300 focus:border-rose-600 focus:ring-1 focus:ring-rose-600 uppercase"
                />
              </div>

              {/* Reason Field */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-stone-700">
                  Reason for Clearing (Logged to Audit Log)
                </label>
                <input
                  type="text"
                  value={clearReason}
                  onChange={(e) => setClearReason(e.target.value)}
                  placeholder="e.g. Cancellation requested by buyer"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-stone-300 focus:border-rose-600 focus:ring-1 focus:ring-rose-600 text-hoh-text"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-stone-100">
              <button
                type="button"
                onClick={() => setClearTicketModalData(null)}
                disabled={actionLoading}
                className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl transition-colors"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleConfirmClearTicket}
                disabled={actionLoading || clearCodeConfirm.trim().toUpperCase() !== clearTicketModalData.code}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {actionLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Clear Ticket Data</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: Reset All Ticket Data Confirmation */}
      {/* ========================================================================= */}
      {resetAllModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-rose-300 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-rose-100">
              <h3 className="text-lg font-serif font-bold text-rose-900 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-rose-600" />
                <span>Reset All 50 Tickets</span>
              </h3>
              <button
                type="button"
                onClick={() => setResetAllModalOpen(false)}
                disabled={actionLoading}
                className="p-1 text-stone-400 hover:text-stone-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-950 space-y-2">
                <p className="font-bold flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-700" />
                  <span>Automatic Backup Guaranteed</span>
                </p>
                <p className="text-[11px] text-stone-700 leading-relaxed">
                  Before resetting, Google Apps Script will duplicate your current sheet to a new tab named <span className="font-mono font-bold bg-white px-1.5 py-0.5 rounded border border-rose-200 text-rose-900">Backup_YYYY-MM-DD_HH-mm</span> so your data is never lost.
                </p>
                <ul className="list-disc list-inside text-[11px] text-stone-600 space-y-0.5 pt-1">
                  <li>Rows, Codes (HOH001–HOH050), and QR Payloads are never deleted.</li>
                  <li>Buyer names, phone numbers, payments, and entry records will be reset.</li>
                  <li>An entry will be recorded in the <strong className="text-stone-900">Audit Log</strong> tab.</li>
                </ul>
              </div>

              {/* Strict Text Confirmation */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-stone-700">
                  To proceed, type exactly <span className="font-mono font-bold text-rose-700">RESET HOH EVENT</span>:
                </label>
                <input
                  type="text"
                  value={resetAllConfirmText}
                  onChange={(e) => setResetAllConfirmText(e.target.value)}
                  placeholder="RESET HOH EVENT"
                  className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-stone-300 focus:border-rose-600 focus:ring-1 focus:ring-rose-600"
                />
              </div>

              {/* Optional Reason */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-stone-700">
                  Reason for Reset (Logged to Audit Log)
                </label>
                <input
                  type="text"
                  value={resetAllReason}
                  onChange={(e) => setResetAllReason(e.target.value)}
                  placeholder="e.g. New event season / rehearsal test wipe"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-stone-300 focus:border-rose-600 focus:ring-1 focus:ring-rose-600 text-hoh-text"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-stone-100">
              <button
                type="button"
                onClick={() => setResetAllModalOpen(false)}
                disabled={actionLoading}
                className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl transition-colors"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleConfirmResetAll}
                disabled={actionLoading || resetAllConfirmText.trim() !== 'RESET HOH EVENT'}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-700 hover:bg-rose-800 rounded-xl shadow transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {actionLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Reset All 50 Tickets</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
