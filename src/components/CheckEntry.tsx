import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import confetti from 'canvas-confetti';
import {
  QrCode, Camera, CameraOff, Search, CheckCircle2, User, Phone, Users,
  IndianRupee, Clock, ArrowRight, ShieldCheck, RefreshCw, AlertCircle,
  Upload, Sparkles, Volume2, VolumeX, AlertTriangle
} from 'lucide-react';
import { TicketRecord, TicketStatus } from '../types/ticket';
import {
  evaluateTicketStatus,
  formatCurrency,
  formatLocalTimestamp,
  isValidTicketCode,
  normalizeTicketCode,
  VALID_TICKET_CODES
} from '../lib/ticketRules';
import { PaymentBadge, TicketStatusBanner } from './StatusBadge';

interface CheckEntryProps {
  tickets: Record<string, TicketRecord>;
  onMarkEntered: (code: string) => Promise<{ ok: boolean; message?: string; error?: string }>;
  onNavigateToRegistration: (code: string) => void;
  staffRole: string;
}

export const CheckEntry: React.FC<CheckEntryProps> = ({
  tickets,
  onMarkEntered,
  onNavigateToRegistration,
  staffRole
}) => {
  const [inputCode, setInputCode] = useState<string>('');
  const [activeCode, setActiveCode] = useState<string>('');
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [isMarking, setIsMarking] = useState<boolean>(false);
  const [entryMessage, setEntryMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [recentAdmissions, setRecentAdmissions] = useState<Array<{ code: string; name: string; time: string; guests: number }>>([]);

  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const scannerContainerId = 'hoh-qr-reader-container';

  // Current ticket record and classification
  const currentTicket = activeCode ? tickets[activeCode] : undefined;
  const ticketStatus: TicketStatus | null = activeCode
    ? evaluateTicketStatus(currentTicket, activeCode)
    : null;

  // Sound effects via Web Audio API (no external asset dependencies)
  const playChime = (success: boolean) => {
    if (!soundEnabled) return;
    try {
      const AudioContext = window.AudioContext || (window as unknown as { webkitAudioContext: typeof window.AudioContext }).webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (success) {
        // High pleasant major chord chime
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
        osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1); // A5
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      } else {
        // Low buzz warning
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(160, ctx.currentTime);
        osc.frequency.setValueAtTime(110, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.4, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
        osc.start();
        osc.stop(ctx.currentTime + 0.4);
      }
    } catch {
      // Audio autoplay policy or not supported, ignore silently
    }
  };

  // Perform lookup on a given code
  const handleLookup = (code: string) => {
    setEntryMessage(null);
    const normalized = normalizeTicketCode(code);
    setActiveCode(normalized);
    setInputCode(normalized);

    const ticket = tickets[normalized];
    const status = evaluateTicketStatus(ticket, normalized);

    if (status === 'VALID') {
      playChime(true);
      // Trigger subtle vibration if mobile
      if (navigator.vibrate) navigator.vibrate(50);
    } else {
      playChime(false);
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    }
  };

  // Mark ticket as entered
  const handleConfirmAdmission = async () => {
    if (!activeCode || isMarking) return;

    setIsMarking(true);
    setEntryMessage(null);

    try {
      const result = await onMarkEntered(activeCode);
      if (result.ok) {
        setEntryMessage({ type: 'success', text: result.message || 'Admission Confirmed!' });
        playChime(true);

        // Confetti celebration
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#541D2B', '#E0A526', '#17623B', '#F7E7B4']
        });

        // Add to recent admissions list
        const updatedTicket = tickets[activeCode];
        setRecentAdmissions(prev => [
          {
            code: activeCode,
            name: updatedTicket?.buyerName || 'Guest',
            time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            guests: updatedTicket?.guests || 1
          },
          ...prev.slice(0, 9)
        ]);
      } else {
        setEntryMessage({ type: 'error', text: result.error || 'Failed to mark ticket entered.' });
        playChime(false);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setEntryMessage({ type: 'error', text: `Admission error: ${errMsg}` });
      playChime(false);
    } finally {
      setIsMarking(false);
    }
  };

  // Start Camera QR Scanner
  const startScanner = async () => {
    setScannerError(null);
    try {
      if (!html5QrCodeRef.current) {
        html5QrCodeRef.current = new Html5Qrcode(scannerContainerId, {
          formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
          verbose: false
        });
      }

      await html5QrCodeRef.current.start(
        { facingMode: 'environment' }, // Prefer back camera on mobile phones
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0
        },
        (decodedText) => {
          // Success callback
          handleLookup(decodedText);
        },
        () => {
          // Frame error (e.g. no QR in frame), safe to ignore
        }
      );

      setIsScanning(true);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('QR Scanner start error:', err);
      setScannerError(`Camera access denied or unavailable: ${errMsg}. You can type the code or use the sample QR simulator below.`);
      setIsScanning(false);
    }
  };

  // Stop Camera QR Scanner
  const stopScanner = async () => {
    if (html5QrCodeRef.current && isScanning) {
      try {
        await html5QrCodeRef.current.stop();
        setIsScanning(false);
      } catch (err) {
        console.error('Error stopping QR scanner:', err);
      }
    }
  };

  // Clean up scanner on unmount
  useEffect(() => {
    return () => {
      if (html5QrCodeRef.current) {
        try {
          if (html5QrCodeRef.current.isScanning) {
            html5QrCodeRef.current.stop().catch(() => { });
          }
          html5QrCodeRef.current.clear();
        } catch {
          // ignore cleanup errors
        }
      }
    };
  }, []);

  // Quick file drop or image scan
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      if (!html5QrCodeRef.current) {
        html5QrCodeRef.current = new Html5Qrcode(scannerContainerId);
      }
      const decodedResult = await html5QrCodeRef.current.scanFile(file, true);
      handleLookup(decodedResult);
    } catch (err) {
      setScannerError('Could not decode QR code from the selected image. Please try another image or enter manually.');
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 sm:px-6 space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-serif font-bold text-hoh-burgundy flex items-center gap-2">
            <span>Venue Entry Verification</span>
            <span className="text-xs bg-emerald-100 text-emerald-800 font-sans font-semibold px-2 py-0.5 rounded-full border border-emerald-300">
              Live Gate
            </span>
          </h2>
          <p className="text-sm text-hoh-muted mt-0.5">
            Scan guest QR code or enter ticket number to verify validity and prevent duplicate entry.
          </p>
        </div>

        {/* Audio Toggle */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition-all ${soundEnabled
                ? 'bg-hoh-burgundy text-hoh-gold border-hoh-gold/30'
                : 'bg-stone-200 text-stone-600 border-stone-300'
              }`}
          >
            {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            <span>{soundEnabled ? 'Chimes ON' : 'Muted'}</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Scanner & Code Input (5 cols on lg) */}
        <div className="lg:col-span-5 space-y-5">
          {/* QR Camera Card */}
          <div className="bg-white rounded-2xl shadow-theatre border border-stone-200 p-5 overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-sm text-hoh-burgundy flex items-center gap-1.5">
                <Camera className="w-4 h-4 text-hoh-gold" />
                <span>Camera QR Scanner</span>
              </h3>
              {isScanning && (
                <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 animate-pulse">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  Active
                </span>
              )}
            </div>

            {/* Video Preview Container */}
            <div className="relative rounded-xl overflow-hidden bg-stone-900 border border-stone-300 min-h-[240px] flex items-center justify-center">
              <div id={scannerContainerId} className="w-full"></div>
              {!isScanning && (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-stone-900/95 text-stone-300">
                  <QrCode className="w-12 h-12 text-hoh-gold/70 mb-2" />
                  <p className="text-xs text-stone-300 max-w-[200px]">
                    Click below to open phone camera and point at printed or mobile QR code.
                  </p>
                </div>
              )}
            </div>

            {/* Camera Controls */}
            <div className="mt-4 flex gap-2">
              {!isScanning ? (
                <button
                  type="button"
                  onClick={startScanner}
                  className="flex-1 py-2.5 px-4 bg-hoh-burgundy hover:bg-hoh-burgundy-light text-white font-semibold text-xs rounded-xl transition-colors shadow-sm flex items-center justify-center gap-2"
                >
                  <Camera className="w-4 h-4 text-hoh-gold" />
                  <span>Start Camera Scanner</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopScanner}
                  className="flex-1 py-2.5 px-4 bg-stone-700 hover:bg-stone-800 text-white font-semibold text-xs rounded-xl transition-colors shadow-sm flex items-center justify-center gap-2"
                >
                  <CameraOff className="w-4 h-4" />
                  <span>Stop Camera</span>
                </button>
              )}
            </div>

            {scannerError && (
              <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-300 text-xs text-amber-900 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <span>{scannerError}</span>
              </div>
            )}

            {/* Image File Upload Option */}
            <div className="mt-4 pt-3 border-t border-stone-100 flex items-center justify-between">
              <span className="text-xs text-stone-500 flex items-center gap-1">
                <Upload className="w-3.5 h-3.5" />
                Scan QR from image file:
              </span>
              <label className="cursor-pointer text-xs font-semibold text-hoh-burgundy hover:text-hoh-gold-dark underline">
                Browse file
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          {/* Manual Code Input Card */}
          <div className="bg-white rounded-2xl shadow-theatre border border-stone-200 p-5">
            <h3 className="font-bold text-sm text-hoh-burgundy flex items-center gap-1.5 mb-3">
              <Search className="w-4 h-4 text-hoh-gold" />
              <span>Manual Ticket Code Entry</span>
            </h3>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleLookup(inputCode);
              }}
              className="space-y-3"
            >
              <div className="relative">
                <input
                  type="text"
                  value={inputCode}
                  onChange={(e) => setInputCode(e.target.value)}
                  placeholder="e.g. HOH017 or 17"
                  className="w-full px-4 py-3 rounded-xl border-2 border-stone-300 focus:border-hoh-burgundy focus:ring-2 focus:ring-hoh-burgundy/10 text-hoh-burgundy font-mono font-bold text-lg uppercase tracking-wider transition-all placeholder-stone-400"
                />
                <button
                  type="submit"
                  className="absolute right-2 top-1/2 -translate-y-1/2 px-4 py-2 bg-hoh-burgundy hover:bg-hoh-burgundy-light text-hoh-gold font-bold text-xs rounded-lg transition-colors shadow-sm"
                >
                  Verify
                </button>
              </div>
              <p className="text-xs text-stone-500">
                Type any code from HOH001 to HOH050 (case-insensitive).
              </p>
            </form>

            {/* Quick Test Sample QR Selector */}
            <div className="mt-4 pt-4 border-t border-stone-200">
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="quick-test-select" className="text-xs font-semibold text-stone-700 flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-hoh-gold" />
                  Quick Test with Sample Codes:
                </label>
              </div>
              <select
                id="quick-test-select"
                onChange={(e) => {
                  if (e.target.value) handleLookup(e.target.value);
                }}
                className="w-full text-xs bg-stone-50 border border-stone-300 rounded-lg px-3 py-2 font-mono text-stone-800 focus:ring-1 focus:ring-hoh-burgundy cursor-pointer"
                defaultValue=""
              >
                <option value="" disabled>-- Simulate Scanning a Ticket --</option>
                <option value="HOH001">HOH001</option>
                <option value="HOH005">HOH005</option>
                <option value="HOH012">HOH012</option>
                <option value="HOH025">HOH025</option>
                <option value="HOH050">HOH050</option>
                <option value="HOH051">HOH051 (Simulate Invalid Code)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Right Column: Verification Result & Admission Action (7 cols on lg) */}
        <div className="lg:col-span-7 space-y-5">
          {/* Active Ticket Result Card */}
          {activeCode ? (
            <div className="bg-white rounded-2xl shadow-theatre border border-stone-200 overflow-hidden">
              {/* Card Header with Ticket Code */}
              <div className="bg-gradient-to-r from-hoh-burgundy to-hoh-burgundy-dark p-4 sm:p-5 text-white flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-hoh-gold/20 border border-hoh-gold/40 flex items-center justify-center font-mono font-black text-xl text-hoh-gold">
                    {activeCode.replace('HOH', '#')}
                  </div>
                  <div>
                    <h3 className="font-mono font-bold text-xl sm:text-2xl tracking-wider text-white">
                      {activeCode}
                    </h3>
                    <div className="text-xs text-hoh-gold-light/80">House of Humour Admission</div>
                  </div>
                </div>

                {currentTicket && (
                  <div className="text-right">
                    <PaymentBadge status={currentTicket.paymentStatus} />
                  </div>
                )}
              </div>

              {/* Status Banner */}
              <div className="p-4 sm:p-6 pb-2">
                {ticketStatus && (
                  <TicketStatusBanner
                    status={ticketStatus}
                    enteredAt={formatLocalTimestamp(currentTicket?.enteredAt)}
                  />
                )}
              </div>

              {/* Ticket Details Body */}
              <div className="p-4 sm:p-6 pt-2 space-y-4">
                {currentTicket && currentTicket.buyerName ? (
                  <div className="bg-hoh-warm/60 rounded-xl p-4 border border-hoh-warm-dark space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                      {/* Buyer Name */}
                      <div>
                        <div className="text-xs font-medium text-stone-500 flex items-center gap-1">
                          <User className="w-3.5 h-3.5 text-hoh-burgundy" />
                          <span>Ticket Holder</span>
                        </div>
                        <div className="font-bold text-base text-hoh-text mt-0.5">
                          {currentTicket.buyerName}
                        </div>
                      </div>

                      {/* Phone */}
                      <div>
                        <div className="text-xs font-medium text-stone-500 flex items-center gap-1">
                          <Phone className="w-3.5 h-3.5 text-hoh-burgundy" />
                          <span>Contact Phone</span>
                        </div>
                        <div className="font-mono font-semibold text-stone-800 mt-0.5">
                          {currentTicket.phone || '—'}
                        </div>
                      </div>

                      {/* Guests Covered */}
                      <div>
                        <div className="text-xs font-medium text-stone-500 flex items-center gap-1">
                          <Users className="w-3.5 h-3.5 text-hoh-burgundy" />
                          <span>Admit Capacity</span>
                        </div>
                        <div className="font-bold text-hoh-burgundy text-base mt-0.5 flex items-center gap-1.5">
                          <span>{currentTicket.guests} {currentTicket.guests === 1 ? 'Guest' : 'Guests'}</span>
                          <span className="text-xs bg-hoh-gold/30 text-hoh-burgundy font-semibold px-2 py-0.2 rounded">
                            Admit Together
                          </span>
                        </div>
                      </div>

                      {/* Amount */}
                      <div>
                        <div className="text-xs font-medium text-stone-500 flex items-center gap-1">
                          <IndianRupee className="w-3.5 h-3.5 text-hoh-burgundy" />
                          <span>Payment</span>
                        </div>
                        <div className="font-semibold text-stone-800 mt-0.5">
                          {formatCurrency(currentTicket.amount)}
                        </div>
                      </div>
                    </div>

                    {/* Operational Notes */}
                    {currentTicket.notes && (
                      <div className="pt-2 border-t border-stone-200 text-xs">
                        <span className="font-semibold text-stone-600">Notes: </span>
                        <span className="text-stone-700 italic">{currentTicket.notes}</span>
                      </div>
                    )}
                  </div>
                ) : ticketStatus === 'NOT_REGISTERED' ? (
                  <div className="text-center p-6 bg-stone-50 rounded-xl border border-stone-200">
                    <p className="text-sm text-stone-600 mb-3">
                      This ticket code has not been assigned to a buyer yet.
                    </p>
                    <button
                      type="button"
                      onClick={() => onNavigateToRegistration(activeCode)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-hoh-burgundy text-hoh-gold font-semibold text-xs rounded-lg hover:bg-hoh-burgundy-light transition-all shadow-sm"
                    >
                      <span>Register Buyer for {activeCode}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : null}

                {/* Admission Feedback Message */}
                {entryMessage && (
                  <div
                    className={`p-3 rounded-xl flex items-center gap-2 text-sm font-medium ${entryMessage.type === 'success'
                        ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                        : 'bg-rose-100 text-rose-900 border border-rose-300'
                      }`}
                  >
                    {entryMessage.type === 'success' ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-5 h-5 text-rose-700 shrink-0" />
                    )}
                    <span>{entryMessage.text}</span>
                  </div>
                )}

                {/* Primary Action: Mark as Entered */}
                <div className="pt-3">
                  {ticketStatus === 'VALID' ? (
                    <button
                      type="button"
                      disabled={isMarking}
                      onClick={handleConfirmAdmission}
                      className="w-full py-4 bg-hoh-success hover:bg-emerald-800 text-white font-bold text-lg rounded-xl shadow-theatre transition-all transform active:scale-[0.99] flex items-center justify-center gap-3 disabled:opacity-50"
                    >
                      {isMarking ? (
                        <>
                          <RefreshCw className="w-6 h-6 animate-spin" />
                          <span>Verifying & Locking Entry...</span>
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="w-6 h-6 text-hoh-gold-light" />
                          <span>MARK AS ENTERED ({currentTicket?.guests} {currentTicket?.guests === 1 ? 'Guest' : 'Guests'})</span>
                        </>
                      )}
                    </button>
                  ) : ticketStatus === 'ALREADY_ENTERED' ? (
                    <div className="w-full py-3.5 bg-rose-100 border-2 border-rose-400 text-rose-900 font-bold text-center rounded-xl flex items-center justify-center gap-2">
                      <AlertCircle className="w-5 h-5 text-rose-700" />
                      <span>ENTRY BLOCKED: ALREADY ADMITTED</span>
                    </div>
                  ) : (
                    <div className="w-full py-3 bg-stone-100 border border-stone-200 text-stone-500 font-semibold text-center rounded-xl text-sm">
                      Cannot Admit: Ticket is not eligible for entry.
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl shadow-theatre border border-stone-200 p-8 text-center flex flex-col items-center justify-center min-h-[300px]">
              <div className="w-16 h-16 rounded-full bg-hoh-burgundy/10 text-hoh-burgundy flex items-center justify-center mb-3">
                <QrCode className="w-8 h-8" />
              </div>
              <h3 className="font-serif font-bold text-xl text-hoh-burgundy">
                Ready to Verify Tickets
              </h3>
              <p className="text-sm text-hoh-muted max-w-sm mt-1">
                Scan the customer QR code with your camera or enter the ticket number on the left to verify admission.
              </p>
            </div>
          )}

          {/* Recent Gate Admissions (Audit stream for bouncers) */}
          <div className="bg-white rounded-2xl shadow-theatre border border-stone-200 p-4 sm:p-5">
            <h4 className="font-bold text-xs uppercase tracking-wider text-hoh-burgundy mb-3 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-hoh-gold" />
              <span>Recent Gate Admissions (This Session)</span>
            </h4>

            {recentAdmissions.length === 0 ? (
              <p className="text-xs text-stone-400 italic">No tickets marked entered yet in this session.</p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {recentAdmissions.map((adm, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2.5 rounded-lg bg-stone-50 border border-stone-200 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-hoh-burgundy bg-white px-2 py-0.5 rounded border border-stone-200">
                        {adm.code}
                      </span>
                      <span className="font-semibold text-stone-800">{adm.name}</span>
                      <span className="text-[11px] text-stone-500">({adm.guests} {adm.guests === 1 ? 'guest' : 'guests'})</span>
                    </div>
                    <span className="font-mono text-stone-500">{adm.time}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
