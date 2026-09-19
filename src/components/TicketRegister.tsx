import React, { useState, useMemo } from 'react';
import { 
  Search, Download, Edit3, CheckCircle, Clock,
  Users, IndianRupee, ShieldCheck, Ticket, Filter, RefreshCw 
} from 'lucide-react';
import { TicketRecord } from '../types/ticket';
import { calculateSummary } from '../lib/sheetClient';
import { formatCurrency, formatLocalTimestamp, VALID_TICKET_CODES } from '../lib/ticketRules';
import { PaymentBadge, EntryBadge } from './StatusBadge';

interface TicketRegisterProps {
  tickets: Record<string, TicketRecord>;
  onSelectTicketForEntry: (code: string) => void;
  onSelectTicketForEdit: (code: string) => void;
  onRefreshData?: () => void;
}

export const TicketRegister: React.FC<TicketRegisterProps> = ({
  tickets,
  onSelectTicketForEntry,
  onSelectTicketForEdit,
  onRefreshData
}) => {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [filterType, setFilterType] = useState<'all' | 'registered' | 'available' | 'paid' | 'pending' | 'entered' | 'not-entered'>('all');

  // Calculate live KPI counts
  const summary = useMemo(() => calculateSummary(tickets), [tickets]);

  // Filter tickets
  const filteredTickets = useMemo(() => {
    return VALID_TICKET_CODES.map(code => tickets[code] || {
      code,
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
            Full overview of all 50 House of Humour tickets, payments, and gate admission.
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
            <Users className="w-3.5 h-3.5 text-hoh-gold-dark" />
            <span>Registered</span>
          </div>
          <div className="text-2xl font-bold font-mono text-stone-900 mt-1">
            {summary.registered}
          </div>
          <div className="text-[11px] text-stone-400 mt-0.5">
            {Math.round((summary.registered / summary.total) * 100)}% Booked
          </div>
        </div>

        {/* Available */}
        <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-sm">
          <div className="text-xs text-stone-500 font-medium flex items-center gap-1">
            <Ticket className="w-3.5 h-3.5 text-emerald-600" />
            <span>Available</span>
          </div>
          <div className="text-2xl font-bold font-mono text-emerald-700 mt-1">
            {summary.available}
          </div>
          <div className="text-[11px] text-stone-400 mt-0.5">Ready to assign</div>
        </div>

        {/* Admitted / Entered */}
        <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-sm">
          <div className="text-xs text-stone-500 font-medium flex items-center gap-1">
            <CheckCircle className="w-3.5 h-3.5 text-hoh-success" />
            <span>Entered</span>
          </div>
          <div className="text-2xl font-bold font-mono text-hoh-success mt-1">
            {summary.entered}
          </div>
          <div className="text-[11px] text-stone-400 mt-0.5">
            {summary.registered > 0 ? `${Math.round((summary.entered / summary.registered) * 100)}% of buyers` : '0%'}
          </div>
        </div>

        {/* Guests Admitted */}
        <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-sm">
          <div className="text-xs text-stone-500 font-medium flex items-center gap-1">
            <Users className="w-3.5 h-3.5 text-indigo-600" />
            <span>Total Guests</span>
          </div>
          <div className="text-2xl font-bold font-mono text-indigo-800 mt-1">
            {summary.totalGuests}
          </div>
          <div className="text-[11px] text-stone-400 mt-0.5">Across bookings</div>
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
                <th className="py-3.5 px-4 text-right">Actions</th>
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

                      {/* Entry Status */}
                      <td className="py-3 px-4">
                        {isReg ? (
                          <div>
                            <EntryBadge entered={t.entered} size="sm" />
                            {t.entered && t.enteredAt && (
                              <div className="text-[11px] text-stone-500 mt-0.5 flex items-center gap-1 font-mono">
                                <Clock className="w-3 h-3 text-stone-400" />
                                {formatLocalTimestamp(t.enteredAt)}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-stone-400">Available</span>
                        )}
                      </td>

                      {/* Row Actions */}
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {/* Check / Verify Action */}
                          <button
                            type="button"
                            onClick={() => onSelectTicketForEntry(t.code)}
                            className="p-1.5 text-hoh-burgundy hover:bg-hoh-burgundy/10 rounded-lg transition-colors"
                            title="Verify at gate"
                          >
                            <ShieldCheck className="w-4 h-4 text-hoh-burgundy" />
                          </button>

                          {/* Edit Registration Action */}
                          <button
                            type="button"
                            onClick={() => onSelectTicketForEdit(t.code)}
                            className="p-1.5 text-stone-600 hover:text-hoh-burgundy hover:bg-stone-100 rounded-lg transition-colors"
                            title="Edit or register buyer"
                          >
                            <Edit3 className="w-4 h-4" />
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
    </div>
  );
};
