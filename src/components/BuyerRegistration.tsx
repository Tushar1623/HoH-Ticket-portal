import React, { useState, useEffect } from 'react';
import { 
  User, Phone, Mail, Users, IndianRupee, FileText, CheckCircle, 
  AlertTriangle, Save, RefreshCw, Sparkles, ArrowRight, Ticket, Calendar, MapPin 
} from 'lucide-react';
import { PaymentStatus, TicketRecord } from '../types/ticket';
import { VALID_TICKET_CODES, validateBuyerForm, formatCurrency } from '../lib/ticketRules';
import { PaymentBadge, EntryBadge } from './StatusBadge';

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
  const [buyerName, setBuyerName] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [guests, setGuests] = useState<number>(1);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('Paid');
  const [amount, setAmount] = useState<number>(500);
  const [notes, setNotes] = useState<string>('');

  const [saving, setSaving] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (selectedCode && VALID_TICKET_CODES.includes(selectedCode)) {
      setCode(selectedCode);
    }
  }, [selectedCode]);

  useEffect(() => {
    const existing = tickets[code];
    if (existing && existing.buyerName) {
      setBuyerName(existing.buyerName);
      setPhone(existing.phone || '');
      setEmail(existing.email || '');
      setGuests(existing.guests || 1);
      setPaymentStatus(existing.paymentStatus || 'Paid');
      setAmount(existing.amount !== undefined ? existing.amount : 500);
      setNotes(existing.notes || '');
    } else {
      setBuyerName('');
      setPhone('');
      setEmail('');
      setGuests(1);
      setPaymentStatus('Paid');
      setAmount(500);
      setNotes('');
    }
    setFeedback(null);
  }, [code, tickets]);

  const currentTicket = tickets[code];
  const isExistingRegistration = Boolean(currentTicket && currentTicket.buyerName);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    const validation = validateBuyerForm({
      code,
      buyerName,
      phone,
      guests,
      paymentStatus
    });

    if (!validation.valid) {
      setFeedback({ type: 'error', message: validation.error || 'Please correct errors.' });
      return;
    }

    setSaving(true);
    try {
      const result = await onSave({
        code,
        buyerName: buyerName.trim(),
        phone: phone.trim(),
        email: email.trim(),
        guests: Number(guests),
        paymentStatus,
        amount: Number(amount) || 0,
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
                Sales Desk
              </span>
            </h2>
            <p className="text-xs text-hoh-muted">
              Register buyers, contact details, guest headcount, and payment collection for HOH001–HOH050.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSelectNextAvailable}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-hoh-burgundy bg-hoh-gold/20 hover:bg-hoh-gold/30 border border-hoh-gold/40 rounded-xl transition-colors shadow-sm self-start sm:self-auto"
        >
          <Sparkles className="w-4 h-4 text-hoh-gold-dark" />
          <span>Pick Next Available Ticket</span>
        </button>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`p-4 rounded-xl flex items-start gap-3 transition-all ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-2 border-emerald-500 text-emerald-950 shadow-sm'
              : 'bg-rose-50 border-2 border-rose-500 text-rose-950 shadow-sm'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-rose-600 mt-0.5 shrink-0" />
          )}
          <div className="flex-1 text-sm font-bold">
            {feedback.message}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Side: The Form (7 cols on lg) */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-white rounded-2xl shadow-theatre border border-stone-200 overflow-hidden">
            {/* Ticket Selector Bar */}
            <div className="bg-gradient-to-r from-[#2A0C13] via-[#541D2B] to-[#2A0C13] p-4 sm:p-5 text-white border-b border-hoh-gold/30">
              <label htmlFor="ticket-code-select" className="block text-xs font-bold uppercase tracking-wider text-hoh-gold-light mb-1.5">
                Choose Ticket Code *
              </label>
              <div className="relative">
                <select
                  id="ticket-code-select"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="w-full bg-hoh-burgundy border-2 border-hoh-gold/60 rounded-xl px-4 py-2.5 text-white font-mono font-bold text-lg focus:outline-none focus:border-hoh-gold transition-colors appearance-none cursor-pointer"
                >
                  {VALID_TICKET_CODES.map((tCode) => {
                    const t = tickets[tCode];
                    const isReg = Boolean(t && t.buyerName);
                    const isEnt = Boolean(t && t.entered);
                    return (
                      <option key={tCode} value={tCode} className="bg-stone-900 text-white font-sans py-1">
                        {tCode} - {isEnt ? '✓ Entered' : isReg ? `Registered (${t.buyerName.slice(0, 15)})` : '★ Available'}
                      </option>
                    );
                  })}
                </select>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-hoh-gold font-bold">
                  ▼
                </div>
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
                    className="w-full px-4 py-2.5 rounded-xl border border-stone-300 focus:ring-2 focus:ring-hoh-burgundy/20 focus:border-hoh-burgundy text-hoh-text placeholder-stone-400 font-semibold text-sm transition-all"
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

                {/* Guests Count */}
                <div>
                  <label htmlFor="guests" className="block text-xs font-bold uppercase tracking-wider text-stone-700 mb-1 flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-hoh-burgundy" />
                    <span>Guests (1 to 10) *</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center border border-stone-300 rounded-xl overflow-hidden shadow-sm">
                      <button
                        type="button"
                        onClick={() => setGuests(Math.max(1, guests - 1))}
                        className="px-3.5 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 font-bold"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        id="guests"
                        min="1"
                        max="10"
                        value={guests}
                        onChange={(e) => setGuests(parseInt(e.target.value) || 1)}
                        className="w-14 py-2 text-center font-black text-base text-hoh-burgundy border-none focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setGuests(Math.min(10, guests + 1))}
                        className="px-3.5 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 font-bold"
                      >
                        +
                      </button>
                    </div>
                    <span className="text-xs text-stone-500 font-medium">
                      {guests === 1 ? '1 Seat' : `${guests} Seats`}
                    </span>
                  </div>
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

                {/* Amount */}
                <div className="sm:col-span-2">
                  <label htmlFor="amount" className="block text-xs font-bold uppercase tracking-wider text-stone-700 mb-1 flex items-center gap-1.5">
                    <IndianRupee className="w-4 h-4 text-hoh-burgundy" />
                    <span>Amount (INR ₹)</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-stone-500">₹</span>
                    <input
                      type="number"
                      id="amount"
                      min="0"
                      step="50"
                      value={amount}
                      onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                      className="w-full pl-8 pr-4 py-2.5 rounded-xl border border-stone-300 font-bold text-sm"
                    />
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
                    placeholder="e.g. Front row VIP seating, booked via Instagram"
                    className="w-full px-4 py-2.5 rounded-xl border border-stone-300 text-sm placeholder-stone-400"
                  />
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="pt-4 border-t border-stone-200 flex items-center justify-between gap-3">
                <span className="text-xs text-stone-500">
                  {isExistingRegistration ? 'Updating existing buyer record.' : 'Creating new booking record.'}
                </span>

                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-3 bg-hoh-burgundy hover:bg-hoh-burgundy-light text-white font-bold text-sm rounded-xl shadow-theatre flex items-center gap-2 disabled:opacity-50"
                >
                  {saving ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin text-hoh-gold" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 text-hoh-gold" />
                      <span>{isExistingRegistration ? 'Update Record' : 'Save Booking'}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Right Side: Live Comedy Club Ticket Preview (5 cols on lg) */}
        <div className="lg:col-span-5 space-y-5">
          <div className="bg-white rounded-2xl shadow-theatre border border-stone-200 p-5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-hoh-burgundy flex items-center gap-2 mb-3">
              <Ticket className="w-4 h-4 text-hoh-gold" />
              <span>Live Admission Ticket Preview</span>
            </h3>

            {/* Themed Ticket Stub Graphic */}
            <div className="bg-gradient-to-b from-[#2A0C13] to-[#451622] text-white rounded-2xl p-5 border-2 border-hoh-gold/40 shadow-xl relative overflow-hidden">
              {/* Corner Notches for Vintage Ticket Look */}
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
                    Venue Box Office Pass
                  </div>
                </div>
              </div>

              {/* Ticket Details Preview */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-stone-400 uppercase tracking-wider font-mono">Ticket Code</span>
                    <div className="text-2xl font-mono font-black text-hoh-gold">{code}</div>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-stone-400 uppercase tracking-wider font-mono">Status</span>
                    <div><PaymentBadge status={paymentStatus} size="sm" /></div>
                  </div>
                </div>

                <div className="p-3 bg-black/40 rounded-xl border border-white/10 space-y-1.5">
                  <div className="text-xs">
                    <span className="text-stone-400 text-[11px]">Guest: </span>
                    <span className="font-bold text-white">{buyerName || 'Guest Name'}</span>
                  </div>
                  <div className="text-xs">
                    <span className="text-stone-400 text-[11px]">Phone: </span>
                    <span className="font-mono text-stone-200">{phone || '+91 —'}</span>
                  </div>
                  <div className="text-xs flex items-center justify-between pt-1 border-t border-white/10">
                    <span className="text-stone-300 font-semibold">{guests} {guests === 1 ? 'Person' : 'People'} Admitted</span>
                    <span className="font-mono font-bold text-hoh-gold">{formatCurrency(amount)}</span>
                  </div>
                </div>

                {/* QR Code thumbnail for this ticket */}
                <div className="flex items-center justify-center pt-2">
                  <div className="bg-white p-2 rounded-xl border border-stone-200 text-center shadow-sm">
                    <img
                      src={`/qr-codes/${code}.png`}
                      alt={`QR Code ${code}`}
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                      className="w-20 h-20 object-contain mx-auto"
                    />
                    <span className="text-[9px] font-mono font-bold text-stone-700">{code}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
