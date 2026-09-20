import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import confetti from 'canvas-confetti';
import {
  QrCode, Camera, CameraOff, Search, CheckCircle2, User, Phone, Users,
  IndianRupee, Clock, ArrowRight, ShieldCheck, RefreshCw, AlertCircle,
  Upload, Sparkles, Volume2, VolumeX, AlertTriangle, Play
} from 'lucide-react';
import { StaffRole, TicketRecord, TicketStatus } from '../types/ticket';
import {
  evaluateTicketStatus,
  formatCurrency,
  formatLocalTimestamp,
  normalizeTicketCode
} from '../lib/ticketRules';
import { apiClient } from '../lib/apiClient';
import { PaymentBadge, TicketStatusBanner } from './StatusBadge';

interface CheckEntryProps {
  tickets: Record<string, TicketRecord>;
  onMarkEntered: (code: string) => Promise<{ ok: boolean; message?: string; error?: string }>;
  onNavigateToRegistration: (code: string) => void;
  staffRole?: StaffRole;
}

export const CheckEntry: React.FC<CheckEntryProps> = ({
  tickets,
  onMarkEntered,
  onNavigateToRegistration,
  staffRole: _staffRole
}) => {
  const [inputCode, setInputCode] = useState<string>('');
  const [activeCode, setActiveCode] = useState<string>('');
  const [liveTicket, setLiveTicket] = useState<Partial<TicketRecord> | null>(null);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scannerPaused, setScannerPaused] = useState<boolean>(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [isLookingUp, setIsLookingUp] = useState<boolean>(false);
  const [isMarking, setIsMarking] = useState<boolean>(false);
  const [entryMessage, setEntryMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [recentAdmissions, setRecentAdmissions] = useState<Array<{ code: string; name: string; time: string; guests: number }>>([]);

  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const scannerContainerId = 'hoh-qr-reader-container';

  // Fallback to local tickets if liveTicket not yet loaded
  const currentTicket: TicketRecord | undefined = (liveTicket?.code === activeCode
    ? (liveTicket as TicketRecord)
    : tickets[activeCode]) || undefined;

  const ticketStatus: TicketStatus | null = activeCode
    ? evaluateTicketStatus(currentTicket, activeCode)
    : null;

  // Sound effects via Web Audio API
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
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, ctx.currentTime);
        osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      } else {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(160, ctx.currentTime);
        osc.frequency.setValueAtTime(110, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.4, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
        osc.start();
        osc.stop(ctx.currentTime + 0.4);
      }
    } catch {}
  };

  // Perform secure backend lookup on ticket code
  const handleLookup = async (code: string) => {
    setEntryMessage(null);
    const normalized = normalizeTicketCode(code);
    setActiveCode(normalized);
    setInputCode(normalized);

    // Rule 7: Stop camera scanning after first valid QR decode until staff presses Scan Again
    if (isScanning) {
      await stopScanner();
      setScannerPaused(true);
    }

    setIsLookingUp(true);

    try {
      const res = await apiClient.verifyTicket(normalized);
      if (res.ok && res.data) {
        const t = res.data.ticket;
        const b = res.data.booking;
        const enrichedRecord: TicketRecord = {
          code: t.code,
          qrPayload: t.qrPayload || t.code,
          serialNumber: t.serialNumber,
          bookingId: t.bookingId,
          bookingCode: b?.bookingCode,
          buyerName: b?.buyerName || '',
          phone: b?.phone || '',
          email: b?.email || '',
          guests: 1,
          paymentStatus: b?.paymentStatus || 'Pending',
          amount: b?.totalAmount || 0,
          status: t.status,
          entered: !!t.entered,
          enteredAt: t.enteredAt,
          entryCount: t.entryCount || 0,
          updatedAt: t.updatedAt || new Date().toISOString()
        };
        setLiveTicket(enrichedRecord);
        const st = evaluateTicketStatus(enrichedRecord, normalized);
        if (st === 'VALID') {
          playChime(true);
          if (navigator.vibrate) navigator.vibrate(50);
        } else if (st === 'ALREADY_ENTERED' || enrichedRecord.entered) {
          playChime(false);
          const timeStr = enrichedRecord.enteredAt ? formatLocalTimestamp(enrichedRecord.enteredAt) : 'earlier session';
          setEntryMessage({
            type: 'error',
            text: `Already Entered at ${timeStr}. Do not admit.`
          });
          if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        } else {
          playChime(false);
          if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        }
      } else {
        setLiveTicket(null);
        setEntryMessage({
          type: 'error',
          text: res.error || `Invalid Ticket: Code ${normalized} not found.`
        });
        playChime(false);
      }
    } catch {
      setEntryMessage({
        type: 'error',
        text: 'Sync Failed — gate lookup failed. Check connection.'
      });
      playChime(false);
    } finally {
      setIsLookingUp(false);
    }
  };

  // Handle gate admission confirmation
  const handleConfirmAdmission = async () => {
    if (!activeCode || isMarking) return;
    setIsMarking(true);
    setEntryMessage(null);

    try {
      const res = await onMarkEntered(activeCode);
      if (res.ok) {
        setEntryMessage({ type: 'success', text: res.message || 'Admission confirmed! Marked Entered.' });
        playChime(true);
        confetti({
          particleCount: 60,
          spread: 60,
          origin: { y: 0.6 }
        });

        // Update active live ticket status to entered
        setLiveTicket(prev => prev ? { ...prev, entered: true, enteredAt: new Date().toISOString() } : null);

        if (currentTicket) {
          setRecentAdmissions(prev => [
            {
              code: activeCode,
              name: currentTicket.buyerName || 'Guest',
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              guests: currentTicket.guests || 1
            },
            ...prev.slice(0, 7)
          ]);
        }
      } else {
        const errorText = res.error?.includes('Sync Failed')
          ? 'Sync Failed — entry was not recorded. Do not admit until connection is restored.'
          : (res.error || 'Admission denied.');
        setEntryMessage({ type: 'error', text: errorText });
        playChime(false);
      }
    } catch {
      setEntryMessage({
        type: 'error',
        text: 'Sync Failed — entry was not recorded. Do not admit until connection is restored.'
      });
      playChime(false);
    } finally {
      setIsMarking(false);
    }
  };

  // Start Camera QR Scanner
  const startScanner = async () => {
    setScannerError(null);
    setScannerPaused(false);
    try {
      if (!html5QrCodeRef.current) {
        html5QrCodeRef.current = new Html5Qrcode(scannerContainerId, {
          formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
          verbose: false
        });
      }

      await html5QrCodeRef.current.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0
        },
        (decodedText) => {
          handleLookup(decodedText);
        },
        () => {}
      );

      setIsScanning(true);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('QR Scanner start error:', err);
      setScannerError(`Camera access denied or unavailable: ${errMsg}.`);
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
            html5QrCodeRef.current.stop().catch(() => {});
          }
          html5QrCodeRef.current.clear();
        } catch {}
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
    } catch {
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
            Scan guest QR code or enter ticket number for live server lookup and atomic admission recording.
          </p>
        </div>

        {/* Audio Toggle */}
        <button
          type="button"
          onClick={() => setSoundEnabled(!soundEnabled)}
          className="self-start sm:self-auto flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-stone-300 text-xs font-semibold text-stone-700 hover:bg-stone-50 transition-colors shadow-sm cursor-pointer"
        >
          {soundEnabled ? (
            <>
              <Volume2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>Gate Chimes Active</span>
            </>
          ) : (
            <>
              <VolumeX className="w-3.5 h-3.5 text-stone-400" />
              <span>Chimes Muted</span>
            </>
          )}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Camera Scanner & Code Input (5 cols on lg) */}
        <div className="lg:col-span-5 space-y-5">
          {/* Camera Scanner Card */}
          <div className="bg-white rounded-2xl shadow-theatre border border-stone-200 overflow-hidden">
            <div className="bg-gradient-to-r from-hoh-burgundy to-hoh-burgundy-dark p-4 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Camera className="w-5 h-5 text-hoh-gold" />
                <h3 className="font-serif font-bold text-sm tracking-wide">
                  Gate Camera Scanner
                </h3>
              </div>
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${
                isScanning ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-stone-700 text-stone-300'
              }`}>
                {isScanning ? 'Camera Live' : scannerPaused ? 'Scan Paused' : 'Camera Standby'}
              </span>
            </div>

            <div className="p-4 space-y-3">
              {/* Scanner Viewport Container */}
              <div className="relative rounded-xl overflow-hidden bg-stone-900 aspect-square flex items-center justify-center border-2 border-dashed border-stone-700">
                <div id={scannerContainerId} className="w-full h-full" />
                {!isScanning && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-stone-400 bg-stone-900/90 space-y-3">
                    <QrCode className="w-16 h-16 text-hoh-gold/60 animate-pulse" />
                    <div>
                      <p className="font-semibold text-stone-200 text-sm">
                        {scannerPaused ? 'Ticket Scanned & Paused' : 'Live Gate QR Scanner'}
                      </p>
                      <p className="text-xs text-stone-400 mt-1 max-w-[220px]">
                        {scannerPaused
                          ? 'Press "Scan Next Ticket" to resume camera verification.'
                          : 'Click below to activate device camera for instant verification.'}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {scannerError && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <span>{scannerError}</span>
                </div>
              )}

              {/* Camera Start / Stop / Resume Controls */}
              <div className="flex flex-col gap-2 pt-1">
                {scannerPaused ? (
                  <button
                    type="button"
                    onClick={startScanner}
                    className="w-full py-3 bg-hoh-gold hover:bg-amber-400 text-hoh-burgundy-dark font-black text-sm rounded-xl shadow-gold-glow transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>Scan Next Ticket (Scan Again)</span>
                  </button>
                ) : !isScanning ? (
                  <button
                    type="button"
                    onClick={startScanner}
                    className="w-full py-2.5 bg-hoh-burgundy hover:bg-hoh-burgundy-light text-white font-bold text-xs rounded-xl shadow transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Camera className="w-4 h-4 text-hoh-gold" />
                    <span>Activate Camera Scanner</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={stopScanner}
                    className="w-full py-2.5 bg-stone-700 hover:bg-stone-800 text-stone-200 font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <CameraOff className="w-4 h-4" />
                    <span>Pause Camera</span>
                  </button>
                )}

                {/* Upload QR image as secondary option */}
                <label className="w-full py-2 px-3 border border-stone-300 hover:bg-stone-50 rounded-xl text-xs font-semibold text-stone-700 text-center cursor-pointer flex items-center justify-center gap-1.5 transition-colors">
                  <Upload className="w-3.5 h-3.5 text-stone-500" />
                  <span>Scan QR from Image File</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          </div>

          {/* Manual Code Input Card */}
          <div className="bg-white rounded-2xl shadow-theatre border border-stone-200 p-4 sm:p-5 space-y-3">
            <h4 className="font-serif font-bold text-sm text-hoh-burgundy flex items-center gap-1.5">
              <Search className="w-4 h-4 text-hoh-gold" />
              <span>Manual Ticket Code Lookup</span>
            </h4>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (inputCode.trim()) handleLookup(inputCode.trim());
              }}
              className="space-y-2"
            >
              <div className="relative">
                <input
                  type="text"
                  value={inputCode}
                  onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                  placeholder="e.g. HOH001"
                  className="w-full pl-3 pr-24 py-2.5 font-mono text-sm font-bold uppercase rounded-xl border border-stone-300 focus:border-hoh-burgundy focus:ring-1 focus:ring-hoh-burgundy"
                />
                <button
                  type="submit"
                  disabled={!inputCode.trim() || isLookingUp}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 px-4 py-1.5 bg-hoh-burgundy hover:bg-hoh-burgundy-light text-hoh-gold font-bold text-xs rounded-lg transition-colors shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  {isLookingUp ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : 'Verify'}
                </button>
              </div>
              <p className="text-xs text-stone-500">
                Type any code from HOH001 to HOH050 (case-insensitive).
              </p>
            </form>

            {/* Quick Test Simulator */}
            <div className="pt-3 border-t border-stone-200">
              <label htmlFor="quick-test-select" className="text-xs font-semibold text-stone-700 flex items-center gap-1 mb-1.5">
                <Sparkles className="w-3.5 h-3.5 text-hoh-gold" />
                <span>Simulate Scanning Ticket Code:</span>
              </label>
              <select
                id="quick-test-select"
                onChange={(e) => {
                  if (e.target.value) handleLookup(e.target.value);
                }}
                className="w-full text-xs bg-stone-50 border border-stone-300 rounded-lg px-3 py-2 font-mono text-stone-800 focus:ring-1 focus:ring-hoh-burgundy cursor-pointer"
                defaultValue=""
              >
                <option value="" disabled>-- Select Ticket Code --</option>
                <option value="HOH001">HOH001</option>
                <option value="HOH005">HOH005</option>
                <option value="HOH012">HOH012</option>
                <option value="HOH025">HOH025</option>
                <option value="HOH050">HOH050</option>
                <option value="HOH051">HOH051 (Out of Range Check)</option>
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
                {isLookingUp ? (
                  <div className="p-4 bg-stone-50 rounded-xl border border-stone-200 flex items-center justify-center gap-2 text-stone-600 text-xs">
                    <RefreshCw className="w-4 h-4 animate-spin text-hoh-burgundy" />
                    <span>Verifying ticket with MongoDB Atlas...</span>
                  </div>
                ) : ticketStatus ? (
                  <TicketStatusBanner
                    status={ticketStatus}
                    enteredAt={formatLocalTimestamp(currentTicket?.enteredAt)}
                  />
                ) : null}
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

                      {/* Payment */}
                      <div>
                        <div className="text-xs font-medium text-stone-500 flex items-center gap-1">
                          <IndianRupee className="w-3.5 h-3.5 text-hoh-burgundy" />
                          <span>Payment Status</span>
                        </div>
                        <div className="font-semibold text-stone-800 mt-0.5">
                          {currentTicket.paymentStatus} ({formatCurrency(currentTicket.amount)})
                        </div>
                      </div>

                      {/* Phone (if available/unmasked) */}
                      {currentTicket.phone && (
                        <div>
                          <div className="text-xs font-medium text-stone-500 flex items-center gap-1">
                            <Phone className="w-3.5 h-3.5 text-hoh-burgundy" />
                            <span>Contact</span>
                          </div>
                          <div className="font-mono font-semibold text-stone-800 mt-0.5">
                            {currentTicket.phone}
                          </div>
                        </div>
                      )}
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
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-hoh-burgundy text-hoh-gold font-semibold text-xs rounded-lg hover:bg-hoh-burgundy-light transition-all shadow-sm cursor-pointer"
                    >
                      <span>Register Buyer for {activeCode}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : null}

                {/* Admission Feedback Message */}
                {entryMessage && (
                  <div
                    className={`p-3 rounded-xl flex items-center gap-2 text-sm font-medium ${
                      entryMessage.type === 'success'
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

                {/* Primary Action: Mark as Entered (Gate Staff) */}
                {/* Note: "Change to Not Entered" is strictly removed from Gate Scanner */}
                <div className="pt-3">
                  {ticketStatus === 'VALID' ? (
                    <button
                      type="button"
                      disabled={isMarking || isLookingUp}
                      onClick={handleConfirmAdmission}
                      className="w-full py-4 bg-hoh-success hover:bg-emerald-800 text-white font-bold text-lg rounded-xl shadow-theatre transition-all transform active:scale-[0.99] flex items-center justify-center gap-3 disabled:opacity-50 cursor-pointer"
                    >
                      {isMarking ? (
                        <>
                          <RefreshCw className="w-6 h-6 animate-spin" />
                          <span>Verifying & Locking Entry on MongoDB Atlas...</span>
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="w-6 h-6 text-hoh-gold-light" />
                          <span>MARK AS ENTERED ({currentTicket?.guests} {currentTicket?.guests === 1 ? 'Guest' : 'Guests'})</span>
                        </>
                      )}
                    </button>
                  ) : ticketStatus === 'ALREADY_ENTERED' ? (
                    <div className="w-full py-3.5 bg-rose-100 border-2 border-rose-400 text-rose-900 font-bold text-center rounded-xl flex items-center justify-center gap-2 shadow-sm">
                      <AlertCircle className="w-5 h-5 text-rose-700" />
                      <span>ENTRY BLOCKED: ALREADY ENTERED. DO NOT ADMIT.</span>
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
                Scan guest QR code with camera or enter the ticket number to verify live server status.
              </p>
            </div>
          )}

          {/* Recent Gate Admissions */}
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
export default CheckEntry;
