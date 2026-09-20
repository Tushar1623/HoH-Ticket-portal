import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  User, Phone, Mail, Users, IndianRupee, FileText, CheckCircle, 
  AlertTriangle, Save, RefreshCw, Sparkles, ArrowRight, Ticket,
  Layers, ShieldAlert, Check
} from 'lucide-react';
import { PaymentStatus, TicketRecord } from '../types/ticket';
import { VALID_TICKET_CODES, formatCurrency, canEditBuyer, calculateConsecutiveSeats } from '../lib/ticketRules';
import { PaymentBadge } from './StatusBadge';
import { apiClient } from '../lib/apiClient';

interface BuyerRegistrationProps {
  tickets: Record<string, TicketRecord>;
  selectedCode?: string;
  onSave: (record: Partial<TicketRecord> & { code: string }) => Promise<{ ok: boolean; message?: string; error?: string }>;
  onNavigateToCheckEntry: (code: string) => void;
  staffRole: string;
}

export const BuyerRegistration: React.FC<BuyerRegistrationProps> = ({
  tickets,
  selectedCode = 'HOH001',
  onSave,
  onNavigateToCheckEntry,
  staffRole
}) => {
  const [code, setCode] = useState<string>(selectedCode);
  const [quantity, setQuantity] = useState<number>(1);
  const [buyerName, setBuyerName] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('Paid');
  const [pricePerTicket, setPricePerTicket] = useState<number>(500);
  const [notes, setNotes] = useState<string>('');
  const [allowNonConsecutive, setAllowNonConsecutive] = useState<boolean>(false);

  // Immediate synchronous calculation whenever code, quantity, tickets, or allowNonConsecutive changes
  const localAllocation = useMemo(() => {
    return calculateConsecutiveSeats(tickets, quantity, code, allowNonConsecutive);
  }, [tickets, quantity, code, allowNonConsecutive]);

  // Live Allocation Preview state
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [previewData, setPreviewData] = useState<{
    success: boolean;
    proposedCodes: string[];
    message: string;
    isConsecutive: boolean;
    availableTotal: number;
  } | null>(localAllocation);

  const [saving, setSaving] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string; bookedCodes?: string[]; bookingCode?: string } | null>(null);

  const totalAmount = quantity * pricePerTicket;

  useEffect(() => {
    if (selectedCode && VALID_TICKET_CODES.includes(selectedCode)) {
      setCode(selectedCode);
    }
  }, [selectedCode]);

  // Synchronize previewData with local calculation immediately (0ms latency)
  useEffect(() => {
    setPreviewData(localAllocation);
  }, [localAllocation]);

  // If single ticket selected, populate form from existing ticket if registered
  useEffect(() => {
    if (quantity === 1) {
      const existing = tickets[code];
      if (existing && existing.buyerName) {
        setBuyerName(existing.buyerName);
        setPhone(existing.phone || '');
        setEmail(existing.email || '');
        setPaymentStatus(existing.paymentStatus || 'Paid');
        setPricePerTicket(existing.amount !== undefined ? existing.amount : 500);
        setNotes(existing.notes || '');
      } else {
        setBuyerName('');
        setPhone('');
        setEmail('');
        setPaymentStatus('Paid');
        setPricePerTicket(500);
        setNotes('');
      }
    }
    setFeedback(null);
  }, [code, quantity, tickets]);

  // Fetch live consecutive allocation preview when quantity or starting seat changes
  const fetchPreview = useCallback(async (qty: number, startCode: string) => {
    if (qty <= 0 || qty > 10) return;
    setPreviewLoading(true);
    try {
      const result = await apiClient.previewAllocation(qty, startCode);
      if (result && result.proposedCodes && result.proposedCodes.length > 0) {
        setPreviewData(result);
      }
    } catch {
      // keep localAllocation
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPreview(quantity, code);
  }, [quantity, code, fetchPreview]);

  // The active list of proposed consecutive codes
  const proposedCodes = useMemo(() => {
    if (previewData && previewData.proposedCodes && previewData.proposedCodes.length > 0) {
      return previewData.proposedCodes;
    }
    return localAllocation.proposedCodes;
  }, [previewData, localAllocation]);

  const currentTicket = tickets[code];
  const isExistingSingle = quantity === 1 && Boolean(currentTicket && currentTicket.buyerName);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    if (!canEditBuyer(staffRole)) {
      setFeedback({ type: 'error', message: 'Unauthorized: Entry Staff cannot register or edit buyer details.' });
      return;
    }

    if (!buyerName.trim()) {
      setFeedback({ type: 'error', message: 'Buyer full name is required.' });
      return;
    }

    if (!phone.trim()) {
      setFeedback({ type: 'error', message: 'Phone number is required.' });
      return;
    }

    setSaving(true);
    try {
      // 1. Single Ticket Update
      if (quantity === 1 && isExistingSingle) {
        const result = await onSave({
          code,
          buyerName: buyerName.trim(),
          phone: phone.trim(),
          email: email.trim(),
          guests: 1,
          paymentStatus,
          amount: Number(pricePerTicket) || 0,
          notes: notes.trim(),
          updatedBy: staffRole
        });

        if (result.ok) {
          setFeedback({
            type: 'success',
            message: result.message || `Ticket ${code} saved successfully!`
          });
        } else {
          setFeedback({
            type: 'error',
            message: result.error || 'Failed to save ticket details.'
          });
        }
      } else {
        // 2. Multi-Ticket or New Consecutive Booking
        const bookingRes = await apiClient.createBooking({
          buyerName: buyerName.trim(),
          phone: phone.trim(),
          email: email.trim() || undefined,
          ticketQuantity: quantity,
          startCode: code,
          paymentStatus,
          totalAmount,
          notes: notes.trim() || undefined,
          allowNonConsecutive
        });

        if (bookingRes.ok && bookingRes.data) {
          const booked = bookingRes.data.booking;
          const assigned = bookingRes.data.tickets.map((t: any) => t.code);
          setFeedback({
            type: 'success',
            message: `Booking created successfully for ${buyerName}!`,
            bookedCodes: assigned,
            bookingCode: booked.bookingCode
          });
          // Reset form fields
          setBuyerName('');
          setPhone('');
          setEmail('');
          setNotes('');
          fetchPreview(quantity, code);
        } else {
          setFeedback({
            type: 'error',
            message: bookingRes.error || 'Sync Failed — no ticket change was saved.'
          });
        }
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setFeedback({ type: 'error', message: `Save error: ${errMsg}` });
    } finally {
      setSaving(false);
    }
  };

  const handleSelectNextAvailable = () => {
    const nextAvailable = VALID_TICKET_CODES.find(c => !tickets[c] || !tickets[c].buyerName);
    if (nextAvailable) {
      setCode(nextAvailable);
      setQuantity(1);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-4 sm:px-6 space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-stone-200 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-black p-0.5 border border-hoh-gold shrink-0">
            <img src="/hoh-logo.png" alt="HOH Logo" className="w-full h-full object-cover rounded-full" />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-serif font-bold text-hoh-burgundy flex items-center gap-2">
              <span>Box Office Buyer Registration</span>
              <span className="text-[11px] bg-hoh-gold/20 text-hoh-gold-dark font-sans font-semibold px-2 py-0.5 rounded-full border border-hoh-gold/40">
                MongoDB Atlas Engine
              </span>
            </h2>
            <p className="text-xs text-hoh-muted">
              Consecutive multi-ticket seat allocation & buyer registry for HOH001–HOH050.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSelectNextAvailable}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-hoh-burgundy bg-hoh-gold/20 hover:bg-hoh-gold/30 border border-hoh-gold/40 rounded-xl transition-colors shadow-sm self-start sm:self-auto"
        >
          <Sparkles className="w-4 h-4 text-hoh-gold-dark" />
          <span>Pick Next Single Available</span>
        </button>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`p-5 rounded-2xl flex flex-col gap-3 transition-all ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-2 border-emerald-500 text-emerald-950 shadow-md'
              : 'bg-rose-50 border-2 border-rose-500 text-rose-950 shadow-md'
          }`}
        >
          <div className="flex items-start gap-3">
            {feedback.type === 'success' ? (
              <CheckCircle className="w-6 h-6 text-emerald-600 mt-0.5 shrink-0" />
            ) : (
              <AlertTriangle className="w-6 h-6 text-rose-600 mt-0.5 shrink-0" />
            )}
            <div className="flex-1">
              <div className="text-base font-bold">{feedback.message}</div>
              {feedback.bookingCode && (
                <div className="text-xs font-mono text-emerald-800 mt-1">
                  Booking Reference: <strong>{feedback.bookingCode}</strong>
                </div>
              )}
            </div>
          </div>

          {feedback.bookedCodes && feedback.bookedCodes.length > 0 && (
            <div className="mt-2 pt-3 border-t border-emerald-200">
              <span className="text-xs font-bold text-emerald-900 block mb-2">
                Assigned Ticket Passes (Each ticket must be scanned separately at the door):
              </span>
              <div className="flex flex-wrap gap-2">
                {feedback.bookedCodes.map((tc) => (
                  <div
                    key={tc}
                    className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-emerald-300 rounded-xl shadow-sm"
                  >
                    <span className="font-mono font-black text-sm text-hoh-burgundy">{tc}</span>
                    <button
                      type="button"
                      onClick={() => onNavigateToCheckEntry(tc)}
                      className="text-[11px] text-emerald-700 hover:text-emerald-900 font-bold underline flex items-center gap-0.5"
                    >
                      <span>Gate Pass</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Side: The Form */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-white rounded-2xl shadow-theatre border border-stone-200 overflow-hidden">
            {/* Quantity Selector & Mode Bar */}
            <div className="bg-gradient-to-r from-[#2A0C13] via-[#541D2B] to-[#2A0C13] p-5 text-white border-b border-hoh-gold/30">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                <label className="block text-xs font-bold uppercase tracking-wider text-hoh-gold-light flex items-center gap-2">
                  <Layers className="w-4 h-4 text-hoh-gold" />
                  <span>Select Ticket Quantity (1 to 10 Seats) *</span>
                </label>
                
                {/* Starting Seat Quick Picker */}
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-amber-200/90">Starting Seat:</span>
                  <select
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="px-2.5 py-1 bg-black/60 border border-hoh-gold/60 rounded-lg text-xs font-mono font-bold text-hoh-gold focus:outline-none focus:border-hoh-gold cursor-pointer"
                  >
                    {VALID_TICKET_CODES.map((c) => {
                      const t = tickets[c];
                      const isBooked = Boolean(t && t.buyerName);
                      return (
                        <option key={c} value={c} className="bg-stone-900 text-white">
                          {c} {isBooked ? '• Booked' : '• Available'}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              {/* Quantity Stepper & Buttons */}
              <div className="flex flex-wrap items-center gap-2">
                {[1, 2, 3, 4, 5, 6, 8, 10].map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setQuantity(q)}
                    className={`px-3 py-1.5 rounded-xl font-mono text-sm font-bold transition-all ${
                      quantity === q
                        ? 'bg-hoh-gold text-stone-900 shadow-gold-glow scale-105'
                        : 'bg-white/10 hover:bg-white/20 text-white border border-white/20'
                    }`}
                  >
                    {q} {q === 1 ? 'Seat' : 'Seats'}
                  </button>
                ))}
              </div>

              {/* Automatically Added & Selected Consecutive Seats Pills */}
              {quantity >= 2 && proposedCodes.length > 0 && (
                <div className="mt-3.5 p-3.5 bg-black/60 rounded-xl border border-hoh-gold/50 space-y-2.5 shadow-inner animate-fade-in">
                  <div className="flex items-center justify-between text-[11px] font-bold text-hoh-gold uppercase tracking-wider">
                    <span className="flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-hoh-gold" />
                      <span>Automatically Added & Selected ({proposedCodes.length} Consecutive Seats)</span>
                    </span>
                    <span className="text-emerald-400 font-mono text-[10px] bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-500/50">
                      Sequential Block
                    </span>
                  </div>

                  {/* Visual seat pills */}
                  <div className="flex flex-wrap items-center gap-2">
                    {proposedCodes.map((tc, idx) => (
                      <div
                        key={tc}
                        className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-hoh-gold/25 via-hoh-gold/15 to-transparent border border-hoh-gold/80 rounded-xl shadow-sm"
                      >
                        <span className="w-5 h-5 rounded-full bg-hoh-gold text-stone-950 text-[10px] font-black flex items-center justify-center shadow">
                          {idx + 1}
                        </span>
                        <span className="font-mono font-black text-sm text-white tracking-wide">
                          {tc}
                        </span>
                        <span className="text-[10px] text-amber-200/90 font-medium">
                          {idx === 0 ? 'Start' : `+Seat ${idx + 1}`}
                        </span>
                      </div>
                    ))}
                  </div>

                  <p className="text-[11px] text-amber-100/80">
                    Booking <strong className="text-white">{quantity} Seats</strong> starting from <span className="font-mono font-bold text-hoh-gold">{proposedCodes[0]}</span> automatically added and selected: <span className="font-mono font-bold text-emerald-300">{proposedCodes.join(', ')}</span>.
                  </p>
                </div>
              )}

              {/* Live Consecutive Allocation Engine Preview Box */}
              <div className="mt-3 p-3.5 bg-black/50 rounded-xl border border-hoh-gold/40 text-xs space-y-1.5">
                <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-hoh-gold font-bold">
                  <span>Allocation Engine Status</span>
                  {previewLoading && <RefreshCw className="w-3.5 h-3.5 animate-spin text-hoh-gold" />}
                </div>

                {previewData && (
                  <div>
                    {previewData.success ? (
                      <div className="text-emerald-300 font-medium flex items-center gap-2">
                        <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span>
                          {proposedCodes.length} consecutive ticket{proposedCodes.length > 1 ? 's' : ''} ready: <strong>{proposedCodes.join(', ')}</strong>
                        </span>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="text-amber-300 font-medium flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                          <span>{previewData.message}</span>
                        </div>

                        {/* Manager Override Checkbox */}
                        {['manager', 'admin'].includes(staffRole) && (
                          <label className="flex items-center gap-2 pt-2 border-t border-white/10 text-amber-200 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={allowNonConsecutive}
                              onChange={(e) => setAllowNonConsecutive(e.target.checked)}
                              className="w-4 h-4 text-hoh-burgundy rounded border-stone-300 focus:ring-hoh-gold"
                            />
                            <span className="font-bold flex items-center gap-1 text-[11px]">
                              <ShieldAlert className="w-3.5 h-3.5 text-hoh-gold" />
                              Manager Override: Allow non-consecutive seat allocation
                            </span>
                          </label>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Form Fields */}
            <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {/* Buyer Name */}
                <div className="sm:col-span-2">
                  <label htmlFor="buyerName" className="block text-xs font-bold uppercase tracking-wider text-stone-700 mb-1 flex items-center gap-1.5">
                    <User className="w-4 h-4 text-hoh-burgundy" />
                    <span>Buyer Full Name *</span>
                  </label>
                  <input
                    type="text"
                    id="buyerName"
                    value={buyerName}
                    onChange={(e) => setBuyerName(e.target.value)}
                    placeholder="e.g. Rohan Mehra"
                    required
                    className="w-full px-4 py-2.5 rounded-xl border border-stone-300 focus:ring-2 focus:ring-hoh-burgundy/20 focus:border-hoh-burgundy text-hoh-text font-semibold text-sm transition-all"
                  />
                </div>

                {/* Phone */}
                <div>
                  <label htmlFor="phone" className="block text-xs font-bold uppercase tracking-wider text-stone-700 mb-1 flex items-center gap-1.5">
                    <Phone className="w-4 h-4 text-hoh-burgundy" />
                    <span>Phone Number *</span>
                  </label>
                  <input
                    type="tel"
                    id="phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 98765 43210"
                    required
                    className="w-full px-4 py-2.5 rounded-xl border border-stone-300 focus:ring-2 focus:ring-hoh-burgundy/20 focus:border-hoh-burgundy text-hoh-text font-mono text-sm transition-all"
                  />
                </div>

                {/* Email */}
                <div>
                  <label htmlFor="email" className="block text-xs font-bold uppercase tracking-wider text-stone-700 mb-1 flex items-center gap-1.5">
                    <Mail className="w-4 h-4 text-stone-400" />
                    <span>Email (Optional)</span>
                  </label>
                  <input
                    type="email"
                    id="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="rohan@example.com"
                    className="w-full px-4 py-2.5 rounded-xl border border-stone-300 focus:ring-2 focus:ring-hoh-burgundy/20 focus:border-hoh-burgundy text-hoh-text text-sm transition-all"
                  />
                </div>

                {/* Price Per Ticket */}
                <div>
                  <label htmlFor="pricePerTicket" className="block text-xs font-bold uppercase tracking-wider text-stone-700 mb-1 flex items-center gap-1.5">
                    <IndianRupee className="w-4 h-4 text-hoh-burgundy" />
                    <span>Price Per Seat (₹)</span>
                  </label>
                  <input
                    type="number"
                    id="pricePerTicket"
                    min="0"
                    step="50"
                    value={pricePerTicket}
                    onChange={(e) => setPricePerTicket(parseFloat(e.target.value) || 0)}
                    className="w-full px-4 py-2.5 rounded-xl border border-stone-300 font-bold text-sm"
                  />
                </div>

                {/* Payment Status */}
                <div>
                  <label htmlFor="paymentStatus" className="block text-xs font-bold uppercase tracking-wider text-stone-700 mb-1">
                    Payment Status *
                  </label>
                  <select
                    id="paymentStatus"
                    value={paymentStatus}
                    onChange={(e) => setPaymentStatus(e.target.value as PaymentStatus)}
                    className="w-full px-4 py-2.5 rounded-xl border border-stone-300 focus:ring-2 focus:ring-hoh-burgundy/20 focus:border-hoh-burgundy font-medium text-sm bg-white"
                  >
                    <option value="Paid">Paid (Full Payment)</option>
                    <option value="Pending">Pending (Pay at venue)</option>
                    <option value="Complimentary">Complimentary / VIP</option>
                    <option value="Refunded">Refunded</option>
                    <option value="Cancelled">Cancelled</option>
                  </select>
                </div>

                {/* Total Summary */}
                <div className="sm:col-span-2 p-3.5 bg-stone-50 border border-stone-200 rounded-xl flex items-center justify-between">
                  <div className="text-xs text-stone-600 font-medium">
                    Order Summary: <strong>{quantity} seat{quantity > 1 ? 's' : ''}</strong> × ₹{pricePerTicket}
                  </div>
                  <div className="text-lg font-mono font-black text-hoh-burgundy">
                    Total: {formatCurrency(totalAmount)}
                  </div>
                </div>

                {/* Notes */}
                <div className="sm:col-span-2">
                  <label htmlFor="notes" className="block text-xs font-bold uppercase tracking-wider text-stone-700 mb-1 flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-stone-400" />
                    <span>Operational Notes</span>
                  </label>
                  <textarea
                    id="notes"
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. VIP seating row, booked via Instagram"
                    className="w-full px-4 py-2.5 rounded-xl border border-stone-300 text-sm placeholder-stone-400"
                  />
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="pt-4 border-t border-stone-200 flex items-center justify-between gap-3">
                <span className="text-xs text-stone-500">
                  {quantity > 1 ? `Assigning ${quantity} consecutive tickets atomically.` : isExistingSingle ? 'Updating single ticket.' : 'Creating new booking.'}
                </span>

                <button
                  type="submit"
                  disabled={Boolean(saving || (quantity > 1 && previewData && !previewData.success && !allowNonConsecutive))}
                  className="px-6 py-3 bg-hoh-burgundy hover:bg-hoh-burgundy-light text-white font-bold text-sm rounded-xl shadow-theatre flex items-center gap-2 disabled:opacity-50"
                >
                  {saving ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin text-hoh-gold" />
                      <span>Reserving Tickets...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 text-hoh-gold" />
                      <span>
                        {quantity > 1 
                          ? `Reserve ${quantity} Consecutive Tickets (${proposedCodes.join(' + ')})` 
                          : isExistingSingle 
                            ? 'Update Single Ticket' 
                            : `Save Booking (${code})`}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Right Side: Live Ticket Pass Preview */}
        <div className="lg:col-span-5 space-y-5">
          <div className="bg-white rounded-2xl shadow-theatre border border-stone-200 p-5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-hoh-burgundy flex items-center gap-2 mb-3">
              <Ticket className="w-4 h-4 text-hoh-gold" />
              <span>Box Office Admission Pass Preview</span>
            </h3>

            {/* Vintage Burgundy & Gold Ticket Graphic */}
            <div className="bg-gradient-to-b from-[#2A0C13] to-[#451622] text-white rounded-2xl p-5 border-2 border-hoh-gold/40 shadow-xl relative overflow-hidden">
              <div className="absolute -left-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-white rounded-full border border-stone-300"></div>
              <div className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-white rounded-full border border-stone-300"></div>

              {/* Logo & Show Banner */}
              <div className="flex items-center gap-3 border-b border-hoh-gold/30 pb-3 mb-3">
                <div className="w-12 h-12 rounded-full bg-black p-0.5 border border-hoh-gold shrink-0 shadow-gold-glow">
                  <img src="/hoh-logo.png" alt="HOH Logo" className="w-full h-full object-cover rounded-full" />
                </div>
                <div>
                  <div className="text-[10px] uppercase font-mono tracking-widest text-hoh-gold font-bold">
                    House of Humour
                  </div>
                  <div className="text-xs font-serif font-black text-white">
                    India's Biggest Stand-Up Hunt
                  </div>
                  <div className="text-[10px] text-amber-200/70">
                    MongoDB Verified Pass
                  </div>
                </div>
              </div>

              {/* Ticket Details Preview */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-stone-400 uppercase tracking-wider font-mono">
                      {quantity > 1 ? `Allocated Block (${proposedCodes.length} Seats)` : 'Ticket Code'}
                    </span>
                    <div className="text-xl font-mono font-black text-hoh-gold">
                      {proposedCodes.length > 0 ? proposedCodes.join(' + ') : code}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-stone-400 uppercase tracking-wider font-mono">Status</span>
                    <div><PaymentBadge status={paymentStatus} size="sm" /></div>
                  </div>
                </div>

                {/* Individual Door Pass Badges for Multi-Ticket Orders */}
                {proposedCodes.length > 1 && (
                  <div className="p-2.5 bg-black/50 rounded-xl border border-white/10 space-y-1.5">
                    <span className="text-[10px] text-stone-400 uppercase tracking-wider font-mono block">
                      Assigned Door Passes:
                    </span>
                    <div className="grid grid-cols-2 gap-1.5 text-[11px] font-mono">
                      {proposedCodes.map((tc, idx) => (
                        <div key={tc} className="flex items-center justify-between text-emerald-300 bg-white/5 px-2.5 py-1 rounded-lg border border-white/10">
                          <span className="text-stone-400 text-[10px]">Seat #{idx + 1}</span>
                          <span className="font-bold text-white">{tc}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="p-3 bg-black/40 rounded-xl border border-white/10 space-y-1.5">
                  <div className="text-xs">
                    <span className="text-stone-400 text-[11px]">Buyer: </span>
                    <span className="font-bold text-white">{buyerName || 'Guest Name'}</span>
                  </div>
                  <div className="text-xs">
                    <span className="text-stone-400 text-[11px]">Phone: </span>
                    <span className="font-mono text-stone-200">{phone || '+91 —'}</span>
                  </div>
                  <div className="text-xs flex items-center justify-between pt-1 border-t border-white/10">
                    <span className="text-stone-300 font-semibold">{quantity} {quantity === 1 ? 'Seat' : 'Seats'} Reserved</span>
                    <span className="font-mono font-bold text-hoh-gold">{formatCurrency(totalAmount)}</span>
                  </div>
                </div>

                {/* Notice that every ticket in group has independent QR code */}
                <div className="p-2.5 bg-hoh-burgundy/80 rounded-xl border border-hoh-gold/30 text-center">
                  <span className="text-[11px] text-hoh-gold-light font-medium block">
                    ★ Each individual ticket gets its own unique QR payload for single-use gate entry.
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
