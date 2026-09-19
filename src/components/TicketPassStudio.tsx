import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { 
  Printer, Download, Eye, Sparkles, User, Users, Calendar, 
  MapPin, IndianRupee, ShieldCheck, QrCode, ArrowRight, Check 
} from 'lucide-react';
import { TicketRecord } from '../types/ticket';
import { VALID_TICKET_CODES, formatCurrency } from '../lib/ticketRules';
import { PaymentBadge } from './StatusBadge';

interface TicketPassStudioProps {
  tickets: Record<string, TicketRecord>;
  onSelectForEntry: (code: string) => void;
  onSelectForRegistration: (code: string) => void;
}

export const TicketPassStudio: React.FC<TicketPassStudioProps> = ({
  tickets,
  onSelectForEntry,
  onSelectForRegistration
}) => {
  const [selectedCode, setSelectedCode] = useState<string>('HOH001');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [printMode, setPrintMode] = useState<'single' | 'all'>('single');
  const printRef = useRef<HTMLDivElement>(null);

  const ticket = tickets[selectedCode];
  const isRegistered = Boolean(ticket && ticket.buyerName);

  // Generate high-res QR code for the selected ticket
  useEffect(() => {
    QRCode.toDataURL(selectedCode, {
      errorCorrectionLevel: 'H',
      margin: 1,
      width: 320,
      color: {
        dark: '#2A0C13',
        light: '#FFFFFF'
      }
    }).then(url => {
      setQrDataUrl(url);
    }).catch(err => {
      console.error('Error generating QR code:', err);
    });
  }, [selectedCode]);

  // Handle print
  const handlePrint = () => {
    window.print();
  };

  // Download Single Pass as Image / print layout
  const handleDownloadQR = () => {
    if (!qrDataUrl) return;
    const link = document.createElement('a');
    link.href = qrDataUrl;
    link.download = `${selectedCode}_QR_Pass.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-4 sm:px-6 space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-stone-200 shadow-sm print:hidden">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-black p-0.5 border border-hoh-gold shrink-0 shadow-gold-glow">
            <img src="/hoh-logo.png" alt="HOH Logo" className="w-full h-full object-cover rounded-full" />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-serif font-bold text-hoh-burgundy flex items-center gap-2">
              <span>Official QR Ticket Passes & Studio</span>
              <span className="text-[11px] bg-hoh-gold/20 text-hoh-gold-dark font-sans font-semibold px-2 py-0.5 rounded-full border border-hoh-gold/40">
                Design & Print
              </span>
            </h2>
            <p className="text-xs text-hoh-muted">
              Branded comedy club passes for HOH001–HOH050 ready for printing or digital delivery.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={handleDownloadQR}
            className="px-3.5 py-2 bg-white hover:bg-stone-50 text-hoh-burgundy border border-stone-300 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors"
          >
            <Download className="w-4 h-4 text-hoh-gold" />
            <span>Download QR PNG</span>
          </button>

          <button
            type="button"
            onClick={handlePrint}
            className="px-4 py-2 bg-hoh-burgundy hover:bg-hoh-burgundy-light text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-theatre transition-colors"
          >
            <Printer className="w-4 h-4 text-hoh-gold" />
            <span>Print Pass</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 print:block">
        {/* Left Side: Ticket Selector & Print Options (4 cols) */}
        <div className="lg:col-span-4 space-y-4 print:hidden">
          <div className="bg-white rounded-2xl shadow-theatre border border-stone-200 p-5 space-y-4">
            <h3 className="font-bold text-sm text-hoh-burgundy flex items-center gap-2">
              <QrCode className="w-4 h-4 text-hoh-gold" />
              <span>Select Ticket (1 to 50)</span>
            </h3>

            <div className="relative">
              <select
                value={selectedCode}
                onChange={(e) => setSelectedCode(e.target.value)}
                className="w-full bg-stone-50 border-2 border-stone-300 rounded-xl px-3 py-2.5 font-mono text-sm font-bold text-stone-900 focus:border-hoh-burgundy cursor-pointer"
              >
                {VALID_TICKET_CODES.map((c) => {
                  const t = tickets[c];
                  const isReg = Boolean(t && t.buyerName);
                  const isEnt = Boolean(t && t.entered);
                  return (
                    <option key={c} value={c}>
                      {c} - {isEnt ? '✓ Entered' : isReg ? `Registered: ${t.buyerName}` : 'Available'}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Quick Grid Selector */}
            <div className="pt-2 border-t border-stone-100">
              <span className="text-[11px] font-semibold text-stone-500 block mb-2">Quick Pick Ticket Code:</span>
              <div className="grid grid-cols-5 gap-1.5 max-h-48 overflow-y-auto pr-1">
                {VALID_TICKET_CODES.map((c) => {
                  const t = tickets[c];
                  const isReg = Boolean(t && t.buyerName);
                  const isSelected = c === selectedCode;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setSelectedCode(c)}
                      className={`text-[11px] font-mono py-1 rounded border transition-all ${
                        isSelected
                          ? 'bg-hoh-burgundy text-hoh-gold font-bold border-hoh-burgundy shadow-sm'
                          : isReg
                          ? 'bg-emerald-50 text-emerald-900 border-emerald-300 font-semibold'
                          : 'bg-white text-stone-700 border-stone-200 hover:border-hoh-gold'
                      }`}
                    >
                      {c.replace('HOH', '#')}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Actions for this Ticket */}
            <div className="pt-3 border-t border-stone-200 space-y-2">
              <button
                type="button"
                onClick={() => onSelectForEntry(selectedCode)}
                className="w-full py-2.5 px-3 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-sm transition-colors"
              >
                <ShieldCheck className="w-4 h-4 text-emerald-200" />
                <span>Verify at Gate Scanner</span>
              </button>

              <button
                type="button"
                onClick={() => onSelectForRegistration(selectedCode)}
                className="w-full py-2.5 px-3 bg-stone-100 hover:bg-stone-200 text-hoh-burgundy rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-colors border border-stone-300"
              >
                <span>{isRegistered ? 'Edit Buyer Details' : 'Register Buyer for this Code'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Right Side: The Official Branded Ticket Pass (8 cols) */}
        <div className="lg:col-span-8 flex items-center justify-center">
          <div
            ref={printRef}
            className="w-full max-w-xl bg-gradient-to-r from-[#2A0C13] via-[#43141F] to-[#2A0C13] text-white rounded-3xl shadow-2xl border-4 border-hoh-gold/60 p-6 sm:p-8 relative overflow-hidden print:border-black print:text-black print:bg-white"
          >
            {/* Top Red Ribbon */}
            <div className="bg-[#8E1B24] text-[#F7E7B4] text-[10px] sm:text-xs font-extrabold uppercase tracking-widest text-center py-1.5 rounded-full mb-5 border border-hoh-gold/40 shadow-sm flex items-center justify-center gap-2">
              <span>★ INDIA'S BIGGEST STAND-UP COMEDY TALENT HUNT ★</span>
            </div>

            {/* Header: Logo & Show Details */}
            <div className="flex items-center justify-between gap-4 pb-5 border-b border-hoh-gold/30">
              <div className="flex items-center gap-3">
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-black p-0.5 border-2 border-hoh-gold shadow-gold-glow flex items-center justify-center shrink-0">
                  <img src="/hoh-logo.png" alt="HOH Logo" className="w-full h-full object-cover rounded-full" />
                </div>
                <div>
                  <h3 className="font-serif font-black text-2xl sm:text-3xl text-white tracking-wider">
                    HOUSE <span className="text-xs font-sans text-stone-300 font-normal">OF</span>{' '}
                    <span className="text-hoh-gold">HUMOUR</span>
                  </h3>
                  <div className="text-xs text-amber-200/90 font-medium mt-0.5 flex items-center gap-1.5">
                    <span>Official Venue Admission Pass</span>
                    <span>&bull;</span>
                    <span className="font-mono text-hoh-gold font-bold">{selectedCode}</span>
                  </div>
                </div>
              </div>

              <div className="text-right">
                <div className="font-mono font-black text-2xl sm:text-3xl text-hoh-gold">
                  {selectedCode}
                </div>
                {ticket && <PaymentBadge status={ticket.paymentStatus} size="sm" />}
              </div>
            </div>

            {/* Perforated Divider Line with Notches */}
            <div className="relative my-6">
              <div className="absolute -left-10 -top-3 w-8 h-8 rounded-full bg-hoh-warm border border-stone-300 print:hidden"></div>
              <div className="absolute -right-10 -top-3 w-8 h-8 rounded-full bg-hoh-warm border border-stone-300 print:hidden"></div>
              <div className="border-t-2 border-dashed border-hoh-gold/40"></div>
            </div>

            {/* Pass Body: Details + Big Scannable QR Code */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-6 items-center">
              {/* Left Details (7 cols) */}
              <div className="sm:col-span-7 space-y-4">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-hoh-gold-light">
                    Guest / Booking Holder
                  </span>
                  <div className="font-serif font-black text-xl sm:text-2xl text-white mt-0.5">
                    {ticket?.buyerName || (
                      <span className="text-stone-400 italic">Available Box Office Seat</span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
                      Admit Capacity
                    </span>
                    <div className="font-bold text-base text-hoh-gold flex items-center gap-1 mt-0.5">
                      <Users className="w-4 h-4 text-hoh-gold" />
                      <span>{ticket?.guests || 1} {(ticket?.guests || 1) === 1 ? 'Person' : 'People'}</span>
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
                      Contact
                    </span>
                    <div className="font-mono font-semibold text-xs text-stone-200 mt-0.5 truncate">
                      {ticket?.phone || '+91 —'}
                    </div>
                  </div>
                </div>

                <div className="bg-black/40 rounded-xl p-3 border border-white/10 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-stone-400">Amount Collected:</span>
                    <span className="font-mono font-bold text-hoh-gold">{formatCurrency(ticket?.amount || 500)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-stone-400">Gate Verification:</span>
                    <span className="text-emerald-400 font-semibold">{ticket?.entered ? 'Already Admitted' : 'Valid for Entry'}</span>
                  </div>
                </div>
              </div>

              {/* Right: High-Res Scannable QR Code (5 cols) */}
              <div className="sm:col-span-5 flex flex-col items-center justify-center p-3 bg-white rounded-2xl border-2 border-hoh-gold/60 shadow-lg text-center">
                {qrDataUrl ? (
                  <div className="relative w-36 h-36 flex items-center justify-center">
                    <img
                      src={qrDataUrl}
                      alt={`QR Code ${selectedCode}`}
                      className="w-full h-full object-contain"
                    />
                  </div>
                ) : (
                  <div className="w-36 h-36 bg-stone-100 flex items-center justify-center">
                    <QrCode className="w-12 h-12 text-stone-400 animate-pulse" />
                  </div>
                )}
                <span className="font-mono font-black text-sm text-[#2A0C13] mt-1 tracking-wider">
                  {selectedCode}
                </span>
                <span className="text-[9px] text-stone-500 uppercase tracking-widest">
                  Scan at Entry Gate
                </span>
              </div>
            </div>

            {/* Terms Footer */}
            <div className="mt-6 pt-4 border-t border-hoh-gold/20 flex flex-col sm:flex-row items-center justify-between gap-2 text-[10px] text-stone-300">
              <div>
                <span>&bull; Valid for one-time admission only &bull; Non-transferable once entered</span>
              </div>
              <div className="font-mono text-hoh-gold">
                HOH-50-SYSTEM
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
