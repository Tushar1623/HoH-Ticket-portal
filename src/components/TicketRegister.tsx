import React, { useState, useMemo, useEffect } from 'react';
import { 
  Search, Download, Edit3, CheckCircle, Clock,
  Users, IndianRupee, ShieldCheck, Ticket, Filter, RefreshCw,
  RotateCcw, Trash2, AlertTriangle, X, Check, Lock, Loader2, Info, ArrowRight
} from 'lucide-react';
import { PrepareResetResult, StaffRole, TicketRecord } from '../types/ticket';
import { calculateSummary, apiClient } from '../lib/apiClient';
import { 
  canClearTicket, 
  canEditBuyer, 
  canExportData, 
  canRequestCorrection, 
  canResetEvent, 
  formatCurrency, 
  formatLocalTimestamp, 
  VALID_TICKET_CODES,
  validateClearTicket,
  validateConfirmReset,
  validateEntryStatusCorrection,
  validatePrepareReset
} from '../lib/ticketRules';
import { PaymentBadge, EntryBadge } from './StatusBadge';

interface TicketRegisterProps {
  tickets: Record<string, TicketRecord>;
  onSelectTicketForEntry: (code: string) => void;
  onSelectTicketForEdit: (code: string) => void;
  onRefreshData?: () => void;
  staffRole?: StaffRole;
}

export const TicketRegister: React.FC<TicketRegisterProps> = ({
  tickets,
  onSelectTicketForEntry,
  onSelectTicketForEdit,
  onRefreshData,
  staffRole = 'manager'
}) => {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [filterType, setFilterType] = useState<'all' | 'registered' | 'available' | 'paid' | 'pending' | 'entered' | 'not-entered'>('all');

  // Modal A: Request Entry Status Correction
  const [correctionTicket, setCorrectionTicket] = useState<TicketRecord | null>(null);
  const [correctionReason, setCorrectionReason] = useState<string>('');
  const [correctionCodeConfirm, setCorrectionCodeConfirm] = useState<string>('');

  // Modal B: Clear Ticket Data
  const [clearTicketModalData, setClearTicketModalData] = useState<TicketRecord | null>(null);
  const [clearCodeConfirm, setClearCodeConfirm] = useState<string>('');
  const [clearReason, setClearReason] = useState<string>('');
  const [clearScope, setClearScope] = useState<'single' | 'booking'>('single');

  // Modal C: Two-Step Reset All Ticket Data
  const [resetAllModalOpen, setResetAllModalOpen] = useState<boolean>(false);
  const [resetStep, setResetStep] = useState<'prepare' | 'confirm'>('prepare');
  const [resetReason, setResetReason] = useState<string>('');
  const [preparedResetData, setPreparedResetData] = useState<PrepareResetResult | null>(null);
  const [resetCountdown, setResetCountdown] = useState<number>(300);
  const [resetConfirmText, setResetConfirmText] = useState<string>('');

  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [actionFeedback, setActionFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Countdown timer for prepared reset token
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (resetAllModalOpen && resetStep === 'confirm' && resetCountdown > 0) {
      timer = setInterval(() => {
        setResetCountdown(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            setPreparedResetData(null);
            setResetStep('prepare');
            setActionFeedback({ type: 'error', message: 'Reset token expired. Please prepare reset again.' });
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [resetAllModalOpen, resetStep, resetCountdown]);

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

      // Search match
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

  // Export to CSV (Event Manager or Super Admin only)
  const handleExportCSV = () => {
    if (!canExportData(staffRole)) {
      setActionFeedback({ type: 'error', message: 'Unauthorized: Only Event Manager or Super Admin can export buyer data.' });
      return;
    }

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

  // Safe Action A: Request Entry Status Correction
  const handleConfirmCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!correctionTicket) return;

    const targetEntered = !correctionTicket.entered;
    const val = validateEntryStatusCorrection({
      code: correctionTicket.code,
      entered: targetEntered,
      reason: correctionReason,
      confirmCode: correctionCodeConfirm,
      ticket: correctionTicket
    });

    if (!val.valid) {
      setActionFeedback({ type: 'error', message: val.error || 'Validation failed.' });
      return;
    }

    setActionLoading(true);
    setActionFeedback(null);

    const res = await apiClient.correctStatus({
      code: correctionTicket.code,
      entered: targetEntered,
      reason: correctionReason.trim()
    });

    setActionLoading(false);

    if (res.ok) {
      setActionFeedback({
        type: 'success',
        message: res.message || `Entry status for ${correctionTicket.code} updated to ${targetEntered ? 'Entered' : 'Not Entered'}.`
      });
      setCorrectionTicket(null);
      setCorrectionReason('');
      setCorrectionCodeConfirm('');
      if (onRefreshData) onRefreshData();
    } else {
      setActionFeedback({
        type: 'error',
        message: res.error || 'Sync Failed — no change was saved.'
      });
    }
  };

  // Safe Action B: Clear Ticket Data (or whole booking)
  const handleConfirmClearTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clearTicketModalData) return;

    if (clearScope === 'booking' && clearTicketModalData.bookingCode) {
      const trimmedConfirm = clearCodeConfirm.trim().toUpperCase();
      if (trimmedConfirm !== clearTicketModalData.bookingCode && trimmedConfirm !== clearTicketModalData.code) {
        setActionFeedback({ 
          type: 'error', 
          message: `Confirmation code must match booking code "${clearTicketModalData.bookingCode}" or ticket code "${clearTicketModalData.code}".` 
        });
        return;
      }

      if (clearReason.trim().length < 10) {
        setActionFeedback({ type: 'error', message: 'Reason must be at least 10 characters.' });
        return;
      }

      setActionLoading(true);
      setActionFeedback(null);

      const res = await apiClient.clearBooking({
        bookingCode: clearTicketModalData.bookingCode,
        reason: clearReason.trim()
      });

      setActionLoading(false);

      if (res.ok) {
        setActionFeedback({
          type: 'success',
          message: res.message || `Booking ${clearTicketModalData.bookingCode} cleared successfully.`
        });
        setClearTicketModalData(null);
        setClearCodeConfirm('');
        setClearReason('');
        setClearScope('single');
        if (onRefreshData) onRefreshData();
      } else {
        setActionFeedback({
          type: 'error',
          message: res.error || 'Sync Failed — no change was saved.'
        });
      }
      return;
    }

    const val = validateClearTicket({
      code: clearTicketModalData.code,
      reason: clearReason,
      confirmCode: clearCodeConfirm
    });

    if (!val.valid) {
      setActionFeedback({ type: 'error', message: val.error || 'Validation failed.' });
      return;
    }

    setActionLoading(true);
    setActionFeedback(null);

    const res = await apiClient.clearTicketData({
      code: clearTicketModalData.code,
      reason: clearReason.trim(),
      confirmCode: clearCodeConfirm.trim()
    });

    setActionLoading(false);

    if (res.ok) {
      setActionFeedback({
        type: 'success',
        message: res.message || `Ticket ${clearTicketModalData.code} buyer data cleared successfully.`
      });
      setClearTicketModalData(null);
      setClearCodeConfirm('');
      setClearReason('');
      setClearScope('single');
      if (onRefreshData) onRefreshData();
    } else {
      setActionFeedback({
        type: 'error',
        message: res.error || 'Sync Failed — no change was saved.'
      });
    }
  };

  // Safe Action C Step 1: Prepare Reset
  const handlePrepareResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = validatePrepareReset(resetReason);
    if (!val.valid) {
      setActionFeedback({ type: 'error', message: val.error || 'Reason must be at least 20 characters.' });
      return;
    }

    setActionLoading(true);
    setActionFeedback(null);

    const res = await apiClient.prepareEventReset(resetReason.trim());
    setActionLoading(false);

    if (res.ok && res.data) {
      setPreparedResetData({
        resetToken: res.data.resetToken,
        expiresInSeconds: 300,
        registeredCount: summary.registered,
        enteredCount: summary.entered
      });
      setResetCountdown(300);
      setResetStep('confirm');
      setResetConfirmText('');
    } else {
      setActionFeedback({
        type: 'error',
        message: res.error || 'Failed to prepare event reset. Super Admin authority required.'
      });
    }
  };

  // Safe Action C Step 2: Confirm Reset
  const handleConfirmResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!preparedResetData) return;

    const val = validateConfirmReset({
      token: preparedResetData.resetToken,
      confirmText: resetConfirmText
    });

    if (!val.valid) {
      setActionFeedback({ type: 'error', message: val.error || 'You must type RESET HOH EVENT.' });
      return;
    }

    setActionLoading(true);
    setActionFeedback(null);

    const res = await apiClient.confirmEventReset({
      token: preparedResetData.resetToken,
      confirmText: 'RESET-ALL-HOH-TICKETS-CONFIRM',
      reason: resetReason.trim()
    });

    setActionLoading(false);

    if (res.ok) {
      setActionFeedback({
        type: 'success',
        message: res.message || 'All 50 tickets successfully reset to available status. Backup snapshot saved to audit log.'
      });
      setResetAllModalOpen(false);
      setResetStep('prepare');
      setPreparedResetData(null);
      setResetReason('');
      setResetConfirmText('');
      if (onRefreshData) onRefreshData();
    } else {
      setActionFeedback({
        type: 'error',
        message: res.error || 'Sync Failed — no change was saved.'
      });
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
            Full overview of all 50 House of Humour tickets, payments, door admission, and protected data controls.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          {onRefreshData && (
            <button
              type="button"
              onClick={onRefreshData}
              className="p-2 bg-white text-stone-700 hover:text-hoh-burgundy border border-stone-300 rounded-xl transition-all shadow-sm"
              title="Refresh tickets from MongoDB Atlas"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}

          {canExportData(staffRole) && (
            <button
              type="button"
              onClick={handleExportCSV}
              className="px-3.5 py-2 bg-white hover:bg-stone-50 text-hoh-burgundy border border-stone-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors"
            >
              <Download className="w-4 h-4 text-hoh-gold" />
              <span>Export CSV</span>
            </button>
          )}
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
          <div className="text-[11px] text-stone-400 mt-0.5">
            {Math.round((summary.registered / summary.total) * 100)}% sold
          </div>
        </div>

        {/* Available */}
        <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-sm">
          <div className="text-xs text-stone-500 font-medium flex items-center gap-1">
            <RotateCcw className="w-3.5 h-3.5 text-amber-600" />
            <span>Available</span>
          </div>
          <div className="text-2xl font-bold font-mono text-amber-700 mt-1">
            {summary.available}
          </div>
          <div className="text-[11px] text-stone-400 mt-0.5">Ready for booking</div>
        </div>

        {/* Admitted / Entered */}
        <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-sm">
          <div className="text-xs text-stone-500 font-medium flex items-center gap-1">
            <CheckCircle className="w-3.5 h-3.5 text-blue-600" />
            <span>Admitted</span>
          </div>
          <div className="text-2xl font-bold font-mono text-blue-700 mt-1">
            {summary.entered}
          </div>
          <div className="text-[11px] text-stone-400 mt-0.5">Scanned at door</div>
        </div>

        {/* Total Guests Expected */}
        <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-sm">
          <div className="text-xs text-stone-500 font-medium flex items-center gap-1">
            <Users className="w-3.5 h-3.5 text-purple-600" />
            <span>Total Guests</span>
          </div>
          <div className="text-2xl font-bold font-mono text-purple-700 mt-1">
            {summary.totalGuests}
          </div>
          <div className="text-[11px] text-stone-400 mt-0.5">Across bookings</div>
        </div>

        {/* Total Collections */}
        <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-sm">
          <div className="text-xs text-stone-500 font-medium flex items-center gap-1">
            <IndianRupee className="w-3.5 h-3.5 text-hoh-gold" />
            <span>Collections</span>
          </div>
          <div className="text-2xl font-bold font-mono text-hoh-burgundy mt-1">
            {formatCurrency(summary.totalRevenue)}
          </div>
          <div className="text-[11px] text-stone-400 mt-0.5">Paid receipts</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search code (HOH001), buyer name, phone..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-xs sm:text-sm rounded-xl border border-stone-300 focus:border-hoh-burgundy focus:ring-1 focus:ring-hoh-burgundy text-hoh-text placeholder-stone-400"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 sm:pb-0">
          <Filter className="w-3.5 h-3.5 text-stone-400 hidden sm:inline" />
          {[
            { id: 'all', label: `All (${summary.total})` },
            { id: 'registered', label: `Registered (${summary.registered})` },
            { id: 'available', label: `Available (${summary.available})` },
            { id: 'entered', label: `Entered (${summary.entered})` },
            { id: 'not-entered', label: `Not Entered (${summary.notEntered})` },
            { id: 'paid', label: 'Paid' },
            { id: 'pending', label: 'Pending' }
          ].map(f => (
            <button
              key={f.id}
              onClick={() => setFilterType(f.id as any)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                filterType === f.id
                  ? 'bg-hoh-burgundy text-white shadow-sm'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Tickets Table */}
      <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs sm:text-sm">
            <thead>
              <tr className="bg-hoh-burgundy text-[#F7E7B4] text-xs font-serif font-semibold border-b border-hoh-gold/30">
                <th className="py-3 px-4">Code</th>
                <th className="py-3 px-4">Buyer Name</th>
                <th className="py-3 px-4">Phone</th>
                <th className="py-3 px-4 text-center">Guests</th>
                <th className="py-3 px-4">Payment</th>
                <th className="py-3 px-4">Amount</th>
                <th className="py-3 px-4">Door Status</th>
                <th className="py-3 px-4 text-right">Protected Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 font-sans">
              {filteredTickets.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-10 text-stone-400">
                    No tickets found matching current filters.
                  </td>
                </tr>
              ) : (
                filteredTickets.map(t => {
                  const isReg = Boolean(t.buyerName && t.buyerName.trim() !== '');

                  return (
                    <tr 
                      key={t.code} 
                      className={`hover:bg-stone-50/80 transition-colors ${
                        t.entered ? 'bg-emerald-50/20' : ''
                      }`}
                    >
                      {/* Ticket Code & Booking Reference */}
                      <td className="py-3 px-4 font-mono font-bold text-hoh-burgundy">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="bg-hoh-burgundy/10 px-2 py-1 rounded text-xs">
                            {t.code}
                          </span>
                          {t.bookingCode && (
                            <span className="bg-hoh-gold/15 text-stone-700 font-mono text-[10px] px-1.5 py-0.5 rounded border border-hoh-gold/40" title={`Booking: ${t.bookingCode}`}>
                              {t.bookingCode.replace('HOH-BOOK-', '#')}
                            </span>
                          )}
                        </div>
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

                      {/* Door Entry Status (Zero 1-Click Toggle: Pure Badge) */}
                      <td className="py-3 px-4">
                        <EntryBadge entered={t.entered} enteredAt={t.enteredAt} />
                      </td>

                      {/* Row Actions: 4 Protected Safe Actions */}
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {/* 1. Verify at Gate */}
                          <button
                            type="button"
                            onClick={() => onSelectTicketForEntry(t.code)}
                            className="p-1.5 text-hoh-burgundy hover:bg-hoh-burgundy/10 rounded-lg transition-colors cursor-pointer"
                            title="Verify at Gate"
                          >
                            <ShieldCheck className="w-4 h-4 text-hoh-burgundy" />
                          </button>

                          {/* 2. Edit Buyer Details */}
                          {canEditBuyer(staffRole) && (
                            <button
                              type="button"
                              onClick={() => onSelectTicketForEdit(t.code)}
                              className="p-1.5 text-stone-600 hover:text-hoh-burgundy hover:bg-stone-100 rounded-lg transition-colors cursor-pointer"
                              title="Edit Buyer Details"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                          )}

                          {/* 3. Request Entry Status Correction */}
                          {canRequestCorrection(staffRole) && (
                            <button
                              type="button"
                              onClick={() => {
                                setCorrectionTicket(t);
                                setCorrectionReason('');
                                setCorrectionCodeConfirm('');
                                setActionFeedback(null);
                              }}
                              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                                t.entered
                                  ? 'text-amber-700 hover:bg-amber-100 hover:text-amber-900'
                                  : 'text-emerald-700 hover:bg-emerald-100 hover:text-emerald-900'
                              }`}
                              title="Request Entry Status Correction"
                            >
                              {t.entered ? (
                                <RotateCcw className="w-4 h-4" />
                              ) : (
                                <CheckCircle className="w-4 h-4" />
                              )}
                            </button>
                          )}

                          {/* 4. Clear Ticket Data */}
                          {canClearTicket(staffRole) && (
                            <button
                              type="button"
                              onClick={() => {
                                setClearTicketModalData(t);
                                setClearCodeConfirm('');
                                setClearReason('');
                                setActionFeedback(null);
                              }}
                              className="p-1.5 text-stone-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                              title="Clear Ticket Data"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
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

      {/* Bottom Danger Zone: Two-Step Reset All Ticket Data (Super Admin Only) */}
      {canResetEvent(staffRole) && (
        <div className="bg-white rounded-2xl border border-rose-200 p-6 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-serif font-bold text-rose-900 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-rose-600" />
                <span>Reset All Ticket Data</span>
              </h3>
              <p className="text-xs text-stone-600 mt-1">
                Protected two-step Super Admin workflow with automatic MongoDB backup snapshot and 10-minute cooldown.
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                setResetAllModalOpen(true);
                setResetStep('prepare');
                setPreparedResetData(null);
                setResetReason('');
                setResetConfirmText('');
                setActionFeedback(null);
              }}
              className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all flex items-center gap-2 cursor-pointer self-start sm:self-auto"
            >
              <Trash2 className="w-4 h-4" />
              <span>Reset All Ticket Data</span>
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL A: Request Entry Status Correction */}
      {/* ========================================================================= */}
      {correctionTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-stone-200 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-stone-100">
              <h3 className="text-lg font-serif font-bold text-hoh-burgundy flex items-center gap-2">
                <RotateCcw className="w-5 h-5 text-hoh-gold" />
                <span>Request Entry Status Correction</span>
              </h3>
              <button
                type="button"
                onClick={() => setCorrectionTicket(null)}
                disabled={actionLoading}
                className="p-1 text-stone-400 hover:text-stone-700 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmCorrection} className="space-y-3">
              {/* Ticket Details Box */}
              <div className="bg-stone-50 p-3.5 rounded-xl border border-stone-200 text-xs space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-stone-500 font-medium">Ticket Code:</span>
                  <span className="font-mono font-bold text-hoh-burgundy text-sm">{correctionTicket.code}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-stone-500 font-medium">Buyer Name:</span>
                  <span className="font-semibold text-stone-800">{correctionTicket.buyerName || 'Unregistered'}</span>
                </div>
                {correctionTicket.enteredAt && (
                  <div className="flex justify-between items-center">
                    <span className="text-stone-500 font-medium">First Entry Timestamp:</span>
                    <span className="font-mono text-stone-700">{formatLocalTimestamp(correctionTicket.enteredAt)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center pt-2 border-t border-stone-200">
                  <span className="text-stone-500 font-medium">Status Transition:</span>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                      correctionTicket.entered ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-200 text-stone-700'
                    }`}>
                      {correctionTicket.entered ? 'Entered' : 'Not Entered'}
                    </span>
                    <span className="text-stone-400 font-bold">➔</span>
                    <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                      !correctionTicket.entered ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                    }`}>
                      {!correctionTicket.entered ? 'Entered' : 'Not Entered'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Exact Warning Requirement when changing Entered -> Not Entered */}
              {correctionTicket.entered && (
                <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl flex items-start gap-2.5 text-xs text-amber-900">
                  <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="font-medium leading-relaxed">
                    This allows the QR ticket to be used again. Confirm only after venue-manager approval.
                  </p>
                </div>
              )}

              {/* Exact Ticket Code Confirmation Field */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-stone-700">
                  Type <span className="font-mono font-bold text-hoh-burgundy">{correctionTicket.code}</span> to confirm <span className="text-rose-600">*</span>:
                </label>
                <input
                  type="text"
                  value={correctionCodeConfirm}
                  onChange={(e) => setCorrectionCodeConfirm(e.target.value)}
                  placeholder={`e.g. ${correctionTicket.code}`}
                  className="w-full px-3 py-2 text-xs font-mono uppercase rounded-xl border border-stone-300 focus:border-hoh-burgundy focus:ring-1 focus:ring-hoh-burgundy"
                  required
                />
              </div>

              {/* Mandatory Reason Field (min 10 characters) */}
              <div className="space-y-1">
                <div className="flex justify-between items-center text-xs">
                  <label className="font-semibold text-stone-700">
                    Required Reason (minimum 10 characters) <span className="text-rose-600">*</span>
                  </label>
                  <span className={`text-[11px] font-mono ${
                    correctionReason.trim().length >= 10 ? 'text-emerald-600' : 'text-stone-400'
                  }`}>
                    {correctionReason.trim().length}/10 chars
                  </span>
                </div>
                <textarea
                  rows={2}
                  value={correctionReason}
                  onChange={(e) => setCorrectionReason(e.target.value)}
                  placeholder="e.g. Guest stepped out with venue manager consent / accidental scan"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-stone-300 focus:border-hoh-burgundy focus:ring-1 focus:ring-hoh-burgundy text-hoh-text placeholder-stone-400"
                  required
                />
                <p className="text-[11px] text-stone-400">
                  This action is permanently logged in the MongoDB Audit Log.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setCorrectionTicket(null)}
                  disabled={actionLoading}
                  className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={
                    actionLoading ||
                    correctionCodeConfirm.trim().toUpperCase() !== correctionTicket.code ||
                    correctionReason.trim().length < 10
                  }
                  className={`px-4 py-2 text-xs font-bold text-white rounded-xl shadow transition-all flex items-center gap-1.5 cursor-pointer ${
                    !correctionTicket.entered
                      ? 'bg-emerald-700 hover:bg-emerald-800'
                      : 'bg-amber-700 hover:bg-amber-800'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {actionLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{correctionTicket.entered ? 'Confirm Not Entered' : 'Confirm Entered'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL B: Clear Ticket Data */}
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
                className="p-1 text-stone-400 hover:text-stone-700 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmClearTicket} className="space-y-3">
              {/* Scope Selector if ticket belongs to a multi-ticket or single-ticket booking */}
              {clearTicketModalData.bookingCode && (
                <div className="flex rounded-xl bg-stone-100 p-1 text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => {
                      setClearScope('single');
                      setClearCodeConfirm('');
                    }}
                    className={`flex-1 py-1.5 rounded-lg transition-all ${
                      clearScope === 'single'
                        ? 'bg-white text-stone-900 shadow-sm'
                        : 'text-stone-500 hover:text-stone-800'
                    }`}
                  >
                    This Ticket Only ({clearTicketModalData.code})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setClearScope('booking');
                      setClearCodeConfirm('');
                    }}
                    className={`flex-1 py-1.5 rounded-lg transition-all ${
                      clearScope === 'booking'
                        ? 'bg-rose-600 text-white shadow-sm'
                        : 'text-stone-500 hover:text-stone-800'
                    }`}
                  >
                    Entire Booking ({clearTicketModalData.bookingCode.replace('HOH-BOOK-', '#')})
                  </button>
                </div>
              )}

              {/* Ticket Details & Current Buyer */}
              <div className="p-3 bg-stone-50 border border-stone-200 rounded-xl text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-stone-500 font-medium">Ticket Code:</span>
                  <span className="font-mono font-bold text-rose-950">{clearTicketModalData.code}</span>
                </div>
                {clearTicketModalData.bookingCode && (
                  <div className="flex justify-between">
                    <span className="text-stone-500 font-medium">Booking Code:</span>
                    <span className="font-mono font-bold text-hoh-burgundy">{clearTicketModalData.bookingCode}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-stone-500 font-medium">Current Buyer:</span>
                  <span className="font-semibold text-stone-800">{clearTicketModalData.buyerName || 'Unregistered'}</span>
                </div>
              </div>

              {/* Exact Warning Requirement */}
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
                <p className="font-medium leading-relaxed">
                  {clearScope === 'booking' && clearTicketModalData.bookingCode
                    ? `This will release ALL tickets assigned to order ${clearTicketModalData.bookingCode} back to the available pool. Ticket codes & serials remain permanent.`
                    : 'This will remove buyer, payment, and entry details. Code and QR payload will remain.'}
                </p>
              </div>

              {/* Exact Ticket / Booking Code Typing Confirmation */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-stone-700">
                  {clearScope === 'booking' && clearTicketModalData.bookingCode ? (
                    <>
                      Type <span className="font-mono font-bold text-rose-700">{clearTicketModalData.bookingCode}</span> or <span className="font-mono font-bold text-rose-700">{clearTicketModalData.code}</span> to confirm <span className="text-rose-600">*</span>:
                    </>
                  ) : (
                    <>
                      Type <span className="font-mono font-bold text-rose-700">{clearTicketModalData.code}</span> to confirm <span className="text-rose-600">*</span>:
                    </>
                  )}
                </label>
                <input
                  type="text"
                  value={clearCodeConfirm}
                  onChange={(e) => setClearCodeConfirm(e.target.value)}
                  placeholder={clearScope === 'booking' && clearTicketModalData.bookingCode ? `e.g. ${clearTicketModalData.bookingCode}` : `e.g. ${clearTicketModalData.code}`}
                  className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-stone-300 focus:border-rose-600 focus:ring-1 focus:ring-rose-600 uppercase"
                  required
                />
              </div>

              {/* Mandatory Reason Field (min 10 characters) */}
              <div className="space-y-1">
                <div className="flex justify-between items-center text-xs">
                  <label className="font-semibold text-stone-700">
                    Required Reason (minimum 10 characters) <span className="text-rose-600">*</span>
                  </label>
                  <span className={`text-[11px] font-mono ${
                    clearReason.trim().length >= 10 ? 'text-emerald-600' : 'text-stone-400'
                  }`}>
                    {clearReason.trim().length}/10 chars
                  </span>
                </div>
                <textarea
                  rows={2}
                  value={clearReason}
                  onChange={(e) => setClearReason(e.target.value)}
                  placeholder="e.g. Buyer cancelled order / ticket released back to pool"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-stone-300 focus:border-rose-600 focus:ring-1 focus:ring-rose-600 text-hoh-text placeholder-stone-400"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => {
                    setClearTicketModalData(null);
                    setClearScope('single');
                  }}
                  disabled={actionLoading}
                  className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={
                    actionLoading ||
                    clearReason.trim().length < 10 ||
                    (clearScope === 'booking' && clearTicketModalData.bookingCode
                      ? clearCodeConfirm.trim().toUpperCase() !== clearTicketModalData.bookingCode &&
                        clearCodeConfirm.trim().toUpperCase() !== clearTicketModalData.code
                      : clearCodeConfirm.trim().toUpperCase() !== clearTicketModalData.code)
                  }
                  className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {actionLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>
                    {clearScope === 'booking' && clearTicketModalData.bookingCode
                      ? 'Clear Entire Booking'
                      : 'Clear Ticket Data'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL C: Reset All Ticket Data (Two-Step Workflow) */}
      {/* ========================================================================= */}
      {resetAllModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-rose-300 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-rose-100">
              <h3 className="text-lg font-serif font-bold text-rose-900 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-rose-600" />
                <span>Reset All 50 Tickets — Step {resetStep === 'prepare' ? '1 of 2' : '2 of 2'}</span>
              </h3>
              <button
                type="button"
                onClick={() => setResetAllModalOpen(false)}
                disabled={actionLoading}
                className="p-1 text-stone-400 hover:text-stone-700 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* STEP 1: Prepare Event Reset */}
            {resetStep === 'prepare' && (
              <form onSubmit={handlePrepareResetSubmit} className="space-y-4">
                <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-950 space-y-2">
                  <p className="font-bold flex items-center gap-1.5 text-rose-900">
                    <ShieldCheck className="w-4 h-4 text-emerald-700" />
                    <span>Protected Server Reset Workflow</span>
                  </p>
                  <p className="text-[11px] text-stone-700 leading-relaxed">
                    Step 1 issues a cryptographically secure one-time reset token with a 5-minute expiry.
                    Before touching event data in Step 2, a complete snapshot in the MongoDB <strong className="text-stone-900">eventBackups</strong> collection will be created and verified.
                  </p>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between items-center text-xs">
                    <label className="font-semibold text-stone-700">
                      Mandatory Reason (minimum 20 characters) <span className="text-rose-600">*</span>
                    </label>
                    <span className={`text-[11px] font-mono ${
                      resetReason.trim().length >= 20 ? 'text-emerald-600' : 'text-stone-400'
                    }`}>
                      {resetReason.trim().length}/20 chars
                    </span>
                  </div>
                  <textarea
                    rows={3}
                    value={resetReason}
                    onChange={(e) => setResetReason(e.target.value)}
                    placeholder="Provide a detailed administrative reason for resetting all event ticket data..."
                    className="w-full px-3 py-2 text-xs rounded-xl border border-stone-300 focus:border-rose-600 focus:ring-1 focus:ring-rose-600 text-hoh-text"
                    required
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-stone-100">
                  <button
                    type="button"
                    onClick={() => setResetAllModalOpen(false)}
                    disabled={actionLoading}
                    className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    disabled={actionLoading || resetReason.trim().length < 20}
                    className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {actionLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>Issue Reset Token (Step 1)</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </form>
            )}

            {/* STEP 2: Confirm Event Reset */}
            {resetStep === 'confirm' && preparedResetData && (
              <form onSubmit={handleConfirmResetSubmit} className="space-y-4">
                <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl text-xs space-y-2">
                  <div className="flex justify-between items-center font-semibold text-amber-950">
                    <span>One-Time Token Issued:</span>
                    <span className="font-mono bg-white px-2 py-0.5 rounded border border-amber-200">
                      {preparedResetData.resetToken}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-amber-900">
                    <span>Token Expiration:</span>
                    <span className="font-mono font-bold text-rose-700">
                      {Math.floor(resetCountdown / 60)}:{(resetCountdown % 60).toString().padStart(2, '0')}
                    </span>
                  </div>
                  <div className="pt-2 border-t border-amber-200/80 flex justify-between text-[11px] text-stone-700">
                    <span>Active Registered Bookings: <strong>{preparedResetData.registeredCount}</strong></span>
                    <span>Admitted Tickets: <strong>{preparedResetData.enteredCount}</strong></span>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-stone-700">
                    Type exactly <span className="font-mono font-bold text-rose-700">RESET HOH EVENT</span> to finalize <span className="text-rose-600">*</span>:
                  </label>
                  <input
                    type="text"
                    value={resetConfirmText}
                    onChange={(e) => setResetConfirmText(e.target.value)}
                    placeholder="RESET HOH EVENT"
                    className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-stone-300 focus:border-rose-600 focus:ring-1 focus:ring-rose-600"
                    required
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-stone-100">
                  <button
                    type="button"
                    onClick={() => {
                      setResetStep('prepare');
                      setPreparedResetData(null);
                    }}
                    disabled={actionLoading}
                    className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl transition-colors cursor-pointer"
                  >
                    Back
                  </button>

                  <button
                    type="submit"
                    disabled={actionLoading || resetConfirmText.trim() !== 'RESET HOH EVENT'}
                    className="px-4 py-2 text-xs font-bold text-white bg-rose-700 hover:bg-rose-800 rounded-xl shadow transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {actionLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>Confirm & Reset All Tickets</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
export default TicketRegister;
