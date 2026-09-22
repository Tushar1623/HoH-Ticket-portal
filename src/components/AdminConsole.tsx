import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Search,
  CheckCircle2,
  XCircle,
  Edit3,
  Trash2,
  UserPlus,
  RefreshCw,
  LogOut,
  AlertTriangle,
  Ticket as TicketIcon,
  Users,
  ShieldAlert,
  X,
  Phone,
  Mail,
  User,
  Check,
  Calendar,
  QrCode,
  ArrowUpDown,
  Smartphone,
  CreditCard,
  DollarSign,
  LayoutGrid,
  ListOrdered,
  TrendingUp,
  Ban,
  RotateCcw,
  ArrowRight,
  Mic2,
  Trophy,
  MapPin,
  Sparkles
} from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import {
  TicketItem,
  BookingItem,
  DashboardStats,
  apiClient
} from '../lib/apiClient';

interface AdminConsoleProps {
  onLogout: () => void;
}

export const AdminConsole: React.FC<AdminConsoleProps> = ({ onLogout }) => {
  // Navigation
  const [activeNav, setActiveNav] = useState<'dashboard' | 'scan' | 'tickets' | 'inventory' | 'bookings' | 'sales'>('dashboard');

  // Core Data
  const [tickets, setTickets] = useState<TicketItem[]>([]);
  const [bookings, setBookings] = useState<BookingItem[]>([]);
  const [stats, setStats] = useState<DashboardStats>({
    totalTickets: 50,
    registered: 0,
    available: 50,
    entered: 0,
    notEntered: 0,
    cancelled: 0,
    attendanceRate: 0,
    totalBookings: 0,
    totalTicketsSold: 0,
    totalRevenue: 0,
    todaySales: {
      ticketsSold: 0,
      bookings: 0,
      revenue: 0,
      cash: 0,
      upi: 0,
      other: 0,
      pending: 0
    }
  });

  const [loading, setLoading] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'available' | 'registered' | 'entered' | 'not-entered' | 'cancelled'>('all');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Scan & Manual Lookup State
  const [manualTicketInput, setManualTicketInput] = useState<string>('');
  const [scannedTicketResult, setScannedTicketResult] = useState<TicketItem | null>(null);
  const [isScannerRunning, setIsScannerRunning] = useState<boolean>(false);

  // Offline Sale Modal
  const [showSaleModal, setShowSaleModal] = useState<boolean>(false);
  const [saleAnchor, setSaleAnchor] = useState<string>('HOH001');
  const [saleBuyerName, setSaleBuyerName] = useState<string>('');
  const [salePhone, setSalePhone] = useState<string>('');
  const [saleEmail, setSaleEmail] = useState<string>('');
  const [saleQuantity, setSaleQuantity] = useState<number>(1);
  const [salePaymentStatus, setSalePaymentStatus] = useState<'PAID' | 'PARTIAL' | 'PENDING'>('PAID');
  const [salePaymentMethod, setSalePaymentMethod] = useState<'CASH' | 'UPI' | 'CARD' | 'OTHER'>('CASH');
  const [saleTotalAmount, setSaleTotalAmount] = useState<number>(500);
  const [saleAmountPaid, setSaleAmountPaid] = useState<number>(500);
  const [saleNotes, setSaleNotes] = useState<string>('');
  const [saleAllowOverride, setSaleAllowOverride] = useState<boolean>(false);
  const [salePreview, setSalePreview] = useState<{
    success: boolean;
    proposedCodes: string[];
    isConsecutive: boolean;
    blockedTicket?: string;
    message: string;
    loading: boolean;
  }>({ success: false, proposedCodes: [], isConsecutive: true, message: '', loading: false });

  // Other Modals
  const [selectedTicketDetail, setSelectedTicketDetail] = useState<TicketItem | null>(null);
  const [selectedBookingDetail, setSelectedBookingDetail] = useState<BookingItem | null>(null);
  const [editingBooking, setEditingBooking] = useState<BookingItem | null>(null);
  const [editingTicket, setEditingTicket] = useState<TicketItem | null>(null);
  const [showCancelModal, setShowCancelModal] = useState<TicketItem | null>(null);
  const [cancelReason, setCancelReason] = useState<'LOST' | 'DAMAGED' | 'VOID' | 'OTHER'>('DAMAGED');
  const [showResetModal, setShowResetModal] = useState<boolean>(false);
  const [resetConfirmInput, setResetConfirmInput] = useState<string>('');
  const [saleSuccessData, setSaleSuccessData] = useState<{
    booking: BookingItem;
    tickets: string[];
  } | null>(null);
  const [enteredWarningModal, setEnteredWarningModal] = useState<{
    type: 'ticket' | 'booking';
    code: string;
    action: () => Promise<void>;
  } | null>(null);

  // Show Toast
  const showToast = (type: 'success' | 'error', text: string) => {
    setToast({ type, text });
    setTimeout(() => {
      setToast(null);
    }, 4000);
  };

  // Load Authoritative MongoDB Data (with concurrency guard and zero-flicker refresh)
  const isFetchingRef = React.useRef(false);
  const loadData = useCallback(async (silent = false) => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    if (!silent) setLoading(true);

    try {
      const [ticketsRes, statsRes, bookingsRes] = await Promise.all([
        apiClient.fetchTickets(),
        apiClient.fetchDashboard(),
        apiClient.fetchBookings()
      ]);

      if (ticketsRes.success && ticketsRes.data) {
        setTickets(ticketsRes.data);
      } else if (ticketsRes.error && !silent) {
        showToast('error', ticketsRes.error.message);
      }

      if (statsRes.success && statsRes.data) {
        setStats(statsRes.data);
      }

      if (bookingsRes.success && bookingsRes.data) {
        setBookings(bookingsRes.data);
      }
    } catch {
      if (!silent) showToast('error', 'Unable to connect to database.');
    } finally {
      isFetchingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle QR Camera Scanner in 'scan' tab safely without crashing
  useEffect(() => {
    let html5QrCode: Html5Qrcode | null = null;
    let isCancelled = false;
    let isRunning = false;

    if (activeNav === 'scan') {
      const startScanner = async () => {
        // Wait one frame to ensure DOM element is mounted
        await new Promise((resolve) => setTimeout(resolve, 80));
        if (isCancelled) return;

        const readerElem = document.getElementById('qr-camera-reader');
        if (!readerElem) return;

        try {
          html5QrCode = new Html5Qrcode('qr-camera-reader');
          await html5QrCode.start(
            { facingMode: 'environment' },
            { fps: 10, qrbox: { width: 250, height: 250 } },
            async (decodedText) => {
              if (isCancelled) return;
              const cleanCode = decodedText.trim().toUpperCase();
              handleTicketIdentified(cleanCode);
            },
            () => {}
          );
          if (!isCancelled) {
            isRunning = true;
            setIsScannerRunning(true);
          } else {
            // Cancelled while start was in flight
            await html5QrCode.stop().catch(() => {});
            html5QrCode.clear();
          }
        } catch (err) {
          console.warn('QR Camera initialization notice:', err);
          if (!isCancelled) setIsScannerRunning(false);
        }
      };

      startScanner();
    }

    return () => {
      isCancelled = true;
      setIsScannerRunning(false);
      if (html5QrCode && isRunning) {
        html5QrCode.stop().then(() => html5QrCode?.clear()).catch(() => {});
      }
    };
  }, [activeNav]);

  // Handle Ticket Identification from Scanner or Manual Input
  const handleTicketIdentified = async (inputCode: string) => {
    const norm = inputCode.trim().toUpperCase();
    if (!norm) return;

    setActionLoading(norm);
    try {
      const res = await apiClient.getTicket(norm);
      if (res.success && res.data) {
        setScannedTicketResult(res.data);
      } else {
        showToast('error', res.error?.message || `Ticket ${norm} not found.`);
        setScannedTicketResult(null);
      }
    } catch {
      showToast('error', 'Failed to look up ticket.');
    } finally {
      setActionLoading(null);
    }
  };

  // Open Sale Modal from Anchor Ticket
  const openSaleModalWithAnchor = (ticket: TicketItem) => {
    setSaleAnchor(ticket.code);
    setSaleBuyerName('');
    setSalePhone('');
    setSaleEmail('');
    setSaleQuantity(1);
    setSalePaymentStatus('PAID');
    setSalePaymentMethod('CASH');
    setSaleTotalAmount(500);
    setSaleAmountPaid(500);
    setSaleNotes('');
    setSaleAllowOverride(false);
    setShowSaleModal(true);
    triggerSalePreview(ticket.code, 1, false);
  };

  // Trigger Sale Preview
  const triggerSalePreview = async (anchor: string, qty: number, override: boolean) => {
    setSalePreview(prev => ({ ...prev, loading: true }));
    try {
      const res = await apiClient.previewSale(anchor, qty, override);
      setSalePreview({
        success: res.success,
        proposedCodes: res.proposedCodes || [],
        isConsecutive: res.isConsecutive,
        blockedTicket: res.blockedTicket,
        message: res.message || '',
        loading: false
      });
    } catch {
      setSalePreview({
        success: false,
        proposedCodes: [],
        isConsecutive: false,
        message: 'Failed to preview ticket allocation.',
        loading: false
      });
    }
  };

  // When quantity or override changes in Sale Modal
  const handleQuantityChange = (newQty: number) => {
    const val = Math.max(1, Math.min(50, newQty));
    setSaleQuantity(val);
    const unitPrice = 500;
    const total = val * unitPrice;
    setSaleTotalAmount(total);
    setSaleAmountPaid(total);
    triggerSalePreview(saleAnchor, val, saleAllowOverride);
  };

  const handleOverrideToggle = (override: boolean) => {
    setSaleAllowOverride(override);
    triggerSalePreview(saleAnchor, saleQuantity, override);
  };

  // Confirm Offline Sale
  const handleConfirmSale = async () => {
    if (!saleBuyerName.trim()) {
      showToast('error', 'Customer Full Name is required.');
      return;
    }
    if (!salePhone.trim()) {
      showToast('error', 'Customer Phone Number is required.');
      return;
    }
    if (!salePreview.success || salePreview.proposedCodes.length !== saleQuantity) {
      showToast('error', salePreview.message || 'Cannot confirm sale with current allocation.');
      return;
    }

    setActionLoading('confirm-sale');
    const idempotencyKey = `sale_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    try {
      const res = await apiClient.registerBooking({
        buyerName: saleBuyerName.trim(),
        phone: salePhone.trim(),
        email: saleEmail.trim(),
        ticketQuantity: saleQuantity,
        anchorTicket: saleAnchor,
        paymentStatus: salePaymentStatus,
        paymentMethod: salePaymentMethod,
        totalAmount: saleTotalAmount,
        amountPaid: saleAmountPaid,
        notes: saleNotes.trim(),
        allowOverride: saleAllowOverride,
        idempotencyKey
      });

      if (res.success) {
        showToast('success', res.message || `Sale confirmed for ${salePreview.proposedCodes.join(', ')}`);
        setShowSaleModal(false);
        setScannedTicketResult(null);
        const bookingResult = res.data?.booking;
        const ticketsResult = res.data?.tickets || salePreview.proposedCodes;
        if (bookingResult) {
          setSaleSuccessData({
            booking: bookingResult,
            tickets: ticketsResult
          });
        }
        await loadData();
      } else {
        showToast('error', res.error?.message || 'Sale could not be completed.');
      }
    } catch {
      showToast('error', 'Sale failed due to network or server error.');
    } finally {
      setActionLoading(null);
    }
  };

  // 1-Click Entry Toggle: Instant, zero secondary verification
  const handleToggleEntry = async (code: string, currentEntered: boolean) => {
    setActionLoading(`entry-${code}`);
    try {
      const res = currentEntered
        ? await apiClient.markNotEntered(code)
        : await apiClient.markEntered(code);

      if (res.success) {
        // Optimistic UI update
        setTickets(prev =>
          prev.map(t =>
            t.code === code
              ? { ...t, entered: !currentEntered, enteredAt: !currentEntered ? new Date().toISOString() : null }
              : t
          )
        );
        showToast('success', `${code} marked as ${!currentEntered ? 'ENTERED' : 'NOT ENTERED'}`);
        // Reload dashboard stats
        apiClient.fetchDashboard().then(r => r.data && setStats(r.data));
      } else {
        showToast('error', res.error?.message || 'Failed to update entry status.');
      }
    } catch {
      showToast('error', 'Network error updating entry status.');
    } finally {
      setActionLoading(null);
    }
  };

  // Ticket Cancellation
  const handleConfirmCancelTicket = async () => {
    if (!showCancelModal) return;
    setActionLoading('cancel-ticket');
    try {
      const res = await apiClient.cancelTicket(showCancelModal.code, cancelReason);
      if (res.success) {
        showToast('success', res.message || `Ticket ${showCancelModal.code} cancelled.`);
        setShowCancelModal(null);
        await loadData();
      } else {
        showToast('error', res.error?.message || 'Failed to cancel ticket.');
      }
    } catch {
      showToast('error', 'Network error cancelling ticket.');
    } finally {
      setActionLoading(null);
    }
  };

  // Ticket Uncancel
  const handleUncancelTicket = async (code: string) => {
    setActionLoading(`uncancel-${code}`);
    try {
      const res = await apiClient.uncancelTicket(code);
      if (res.success) {
        showToast('success', `Ticket ${code} restored to AVAILABLE.`);
        await loadData();
      } else {
        showToast('error', res.error?.message || 'Failed to uncancel ticket.');
      }
    } catch {
      showToast('error', 'Network error restoring ticket.');
    } finally {
      setActionLoading(null);
    }
  };

  // Clear Single Ticket
  const handleClearTicket = async (code: string, confirmEntered = false) => {
    const t = tickets.find(ticket => ticket.code === code);
    if (t?.entered && !confirmEntered) {
      setEnteredWarningModal({
        type: 'ticket',
        code,
        action: async () => {
          await executeClearTicket(code, true);
        }
      });
      return;
    }

    if (!confirmEntered && !window.confirm(`Clear booking for ${code}? The ticket will return to AVAILABLE.`)) return;
    await executeClearTicket(code, confirmEntered);
  };

  const executeClearTicket = async (code: string, confirmEntered = false) => {
    setActionLoading(`clear-${code}`);
    try {
      const res = await apiClient.clearTicket(code, confirmEntered);
      if (res.success) {
        showToast('success', `Ticket ${code} cleared and returned to AVAILABLE.`);
        setEnteredWarningModal(null);
        setSelectedTicketDetail(null);
        await loadData();
      } else {
        showToast('error', res.error?.message || 'Failed to clear ticket.');
      }
    } catch {
      showToast('error', 'Network error clearing ticket.');
    } finally {
      setActionLoading(null);
    }
  };

  // Clear Entire Booking
  const handleClearBooking = async (booking: BookingItem, confirmEntered = false) => {
    const hasEntered = (booking.enteredCount || 0) > 0;
    if (hasEntered && !confirmEntered) {
      setEnteredWarningModal({
        type: 'booking',
        code: booking.bookingCode,
        action: async () => {
          await executeClearBooking(booking.bookingCode, true);
        }
      });
      return;
    }

    if (!confirmEntered && !window.confirm(`Clear booking ${booking.bookingCode}? All associated tickets will return to AVAILABLE.`)) return;
    await executeClearBooking(booking.bookingCode, confirmEntered);
  };

  const executeClearBooking = async (bookingCode: string, confirmEntered = false) => {
    setActionLoading(`clear-booking-${bookingCode}`);
    try {
      const res = await apiClient.clearBooking(bookingCode, confirmEntered);
      if (res.success) {
        showToast('success', `Booking ${bookingCode} cleared and tickets returned to AVAILABLE.`);
        setEnteredWarningModal(null);
        setSelectedBookingDetail(null);
        await loadData();
      } else {
        showToast('error', res.error?.message || 'Failed to clear booking.');
      }
    } catch {
      showToast('error', 'Network error clearing booking.');
    } finally {
      setActionLoading(null);
    }
  };

  // Event Reset
  const handleConfirmEventReset = async () => {
    if (resetConfirmInput.trim() !== 'RESET HOH EVENT') {
      showToast('error', 'Please type "RESET HOH EVENT" exactly to confirm.');
      return;
    }
    setActionLoading('reset-event');
    try {
      const res = await apiClient.resetEvent('RESET HOH EVENT');
      if (res.success) {
        showToast('success', 'Event successfully reset. All 50 tickets are available.');
        setShowResetModal(false);
        setResetConfirmInput('');
        await loadData();
      } else {
        showToast('error', res.error?.message || 'Failed to reset event.');
      }
    } catch {
      showToast('error', 'Network error resetting event.');
    } finally {
      setActionLoading(null);
    }
  };

  // Filtered Tickets for Table / Cards
  const filteredTickets = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return tickets.filter(t => {
      const isRegistered = t.status === 'registered' || !!t.buyerName;
      const isCancelled = t.status === 'cancelled';

      if (filterStatus === 'available' && (isRegistered || isCancelled)) return false;
      if (filterStatus === 'registered' && !isRegistered) return false;
      if (filterStatus === 'entered' && !t.entered) return false;
      if (filterStatus === 'not-entered' && (!isRegistered || t.entered)) return false;
      if (filterStatus === 'cancelled' && !isCancelled) return false;

      if (!term) return true;
      return (
        t.code.toLowerCase().includes(term) ||
        (t.buyerName || '').toLowerCase().includes(term) ||
        (t.phone || '').toLowerCase().includes(term) ||
        (t.bookingCode || '').toLowerCase().includes(term)
      );
    });
  }, [tickets, searchTerm, filterStatus]);

  return (
    <div className="min-h-screen bg-[#0a0204] text-amber-50 flex flex-col font-sans relative overflow-x-hidden selection:bg-amber-500 selection:text-black">
      {/* Background Ambience: Spotlight & Curtains */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-amber-500/10 rounded-full blur-[140px]" />
        <div className="hidden lg:block absolute left-0 top-0 bottom-0 w-20 bg-gradient-to-r from-[#2a050c] to-transparent opacity-60" />
        <div className="hidden lg:block absolute right-0 top-0 bottom-0 w-20 bg-gradient-to-l from-[#2a050c] to-transparent opacity-60" />
      </div>

      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3 border text-sm font-medium transition-all transform animate-in fade-in slide-in-from-top-4 duration-200 ${
            toast.type === 'success'
              ? 'bg-emerald-950/95 text-emerald-200 border-emerald-500/60 shadow-emerald-950/80'
              : 'bg-rose-950/95 text-rose-200 border-rose-500/60 shadow-rose-950/80'
          }`}
        >
          {toast.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-400" /> : <AlertTriangle className="w-5 h-5 text-rose-400" />}
          <span className="font-medium">{toast.text}</span>
          <button onClick={() => setToast(null)} className="ml-2 hover:opacity-75">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Top Theater Header */}
      <header className="bg-gradient-to-r from-[#120205] via-[#24050b] to-[#120205] backdrop-blur-md border-b-2 border-amber-500/30 sticky top-0 z-40 px-4 lg:px-8 py-2.5 flex flex-wrap items-center justify-between gap-4 shadow-xl shadow-black/90">
        <div className="flex items-center gap-3">
          <div className="relative group cursor-pointer" onClick={() => setActiveNav('dashboard')}>
            <div className="absolute inset-0 rounded-full bg-amber-500/20 blur-md group-hover:bg-amber-500/35 transition-all" />
            <img 
              src="/hoh-logo.png" 
              alt="HOH Logo" 
              className="relative w-12 h-12 rounded-full border-2 border-amber-400/80 object-contain bg-black shadow-[0_0_16px_rgba(245,158,11,0.35)] transition-transform group-hover:scale-105 p-0.5"
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-extrabold tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-amber-100 via-amber-300 to-amber-500 font-bebas drop-shadow">
                HOUSE OF HUMOUR
              </h1>
              <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-red-900/80 text-amber-200 border border-amber-500/40 font-cinzel tracking-wider">
                Box Office
              </span>
            </div>
            <p className="text-[11px] text-amber-200/70 font-cinzel tracking-wider flex items-center gap-2">
              <span>The Satire Club • Kolkata</span>
              <span className="text-amber-500">•</span>
              <span className="text-amber-400 font-bold">Win ₹15,000</span>
              <span className="text-amber-500">•</span>
              <span className="text-stone-400">50 Seats</span>
              <span className="text-amber-500 hidden sm:inline">•</span>
              <span className="text-amber-400/70 hidden sm:inline text-[10px]">North • South • East • West</span>
            </p>
          </div>
        </div>

        {/* Global Nav Tabs */}
        <nav className="flex items-center gap-1.5 bg-[#0e0204]/90 p-1 rounded-xl border border-amber-500/30 overflow-x-auto shadow-inner">
          <button
            onClick={() => setActiveNav('dashboard')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap font-cinzel ${
              activeNav === 'dashboard'
                ? 'bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 text-stone-950 shadow-[0_0_15px_rgba(245,158,11,0.35)]'
                : 'text-amber-200/70 hover:text-amber-100 hover:bg-[#2c060d]/80'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            Dashboard
          </button>
          <button
            onClick={() => setActiveNav('scan')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap font-cinzel ${
              activeNav === 'scan'
                ? 'bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 text-stone-950 shadow-[0_0_15px_rgba(245,158,11,0.35)]'
                : 'text-amber-200/70 hover:text-amber-100 hover:bg-[#2c060d]/80'
            }`}
          >
            <QrCode className="w-3.5 h-3.5" />
            Scan & Sell
          </button>
          <button
            onClick={() => setActiveNav('tickets')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap font-cinzel ${
              activeNav === 'tickets'
                ? 'bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 text-stone-950 shadow-[0_0_15px_rgba(245,158,11,0.35)]'
                : 'text-amber-200/70 hover:text-amber-100 hover:bg-[#2c060d]/80'
            }`}
          >
            <TicketIcon className="w-3.5 h-3.5" />
            Tickets ({tickets.length})
          </button>
          <button
            onClick={() => setActiveNav('inventory')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap font-cinzel ${
              activeNav === 'inventory'
                ? 'bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 text-stone-950 shadow-[0_0_15px_rgba(245,158,11,0.35)]'
                : 'text-amber-200/70 hover:text-amber-100 hover:bg-[#2c060d]/80'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            Physical Stock (50)
          </button>
          <button
            onClick={() => setActiveNav('bookings')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap font-cinzel ${
              activeNav === 'bookings'
                ? 'bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 text-stone-950 shadow-[0_0_15px_rgba(245,158,11,0.35)]'
                : 'text-amber-200/70 hover:text-amber-100 hover:bg-[#2c060d]/80'
            }`}
          >
            <ListOrdered className="w-3.5 h-3.5" />
            Bookings ({bookings.length})
          </button>
          <button
            onClick={() => setActiveNav('sales')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap font-cinzel ${
              activeNav === 'sales'
                ? 'bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 text-stone-950 shadow-[0_0_15px_rgba(245,158,11,0.35)]'
                : 'text-amber-200/70 hover:text-amber-100 hover:bg-[#2c060d]/80'
            }`}
          >
            <CreditCard className="w-3.5 h-3.5" />
            Offline Sales
          </button>
        </nav>

        {/* User / Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => loadData()}
            disabled={loading}
            className="p-2 rounded-xl bg-[#240409] hover:bg-[#380710] text-amber-300 transition-all border border-amber-500/30 disabled:opacity-50 cursor-pointer shadow"
            title="Sync live data"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-amber-400' : ''}`} />
          </button>
          <button
            onClick={onLogout}
            className="px-3.5 py-1.5 rounded-xl bg-red-950/60 hover:bg-red-900/80 text-amber-200 border border-red-700/50 text-xs font-bold font-cinzel flex items-center gap-1.5 transition-all shadow cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5 text-amber-400" />
            Exit
          </button>
        </div>
      </header>

      {/* Main Viewport */}
      <main className="flex-1 p-4 lg:p-8 max-w-7xl w-full mx-auto space-y-6">
        {/* ========================================================================= */}
        {/* TAB 1: DASHBOARD                                                          */}
        {/* ========================================================================= */}
        {activeNav === 'dashboard' && (
          <div className="space-y-6">
            {/* Quick Action Station */}
            <div className="theatre-placard rounded-2xl p-5 sm:p-6 shadow-2xl relative overflow-hidden backdrop-blur-md flex flex-wrap items-center justify-between gap-4">
              {/* Corner Brass Brackets */}
              <div className="absolute top-2 left-2 w-3 h-3 border-t-2 border-l-2 border-amber-500/60 pointer-events-none" />
              <div className="absolute top-2 right-2 w-3 h-3 border-t-2 border-r-2 border-amber-500/60 pointer-events-none" />
              <div className="absolute bottom-2 left-2 w-3 h-3 border-b-2 border-l-2 border-amber-500/60 pointer-events-none" />
              <div className="absolute bottom-2 right-2 w-3 h-3 border-b-2 border-r-2 border-amber-500/60 pointer-events-none" />

              <div className="flex items-center gap-4">
                <div className="relative group flex-shrink-0">
                  <div className="absolute inset-0 rounded-full bg-amber-500/25 blur-md" />
                  <img 
                    src="/hoh-logo.png" 
                    alt="House of Humour" 
                    className="relative w-14 h-14 rounded-full border-2 border-amber-400/80 object-contain bg-black p-0.5 shadow-lg shadow-amber-500/20"
                  />
                </div>
                <div>
                  <h2 className="text-2xl sm:text-3xl font-bold text-amber-100 font-bebas tracking-wider flex items-center gap-2 drop-shadow">
                    LIVE BOX OFFICE & ADMISSIONS
                  </h2>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-amber-200/80 font-cinzel">
                    <span>THE SATIRE CLUB • KOLKATA</span>
                    <span className="text-amber-500">•</span>
                    <span className="text-amber-300 font-bold">WIN ₹15,000</span>
                    <span className="text-amber-500">•</span>
                    <span className="text-amber-400/80 font-mono">HOH001–HOH050</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  onClick={() => setActiveNav('scan')}
                  className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 hover:from-amber-400 hover:to-amber-300 text-stone-950 font-black text-xs font-cinzel tracking-wider flex items-center gap-2 shadow-[0_4px_15px_rgba(245,158,11,0.35)] transition-all transform active:scale-95 cursor-pointer"
                >
                  <QrCode className="w-4 h-4 text-stone-950" />
                  SCAN TICKET
                </button>
                <button
                  onClick={() => {
                    const firstAvail = tickets.find(t => (t.status === 'available' || String(t.status).toLowerCase() === 'available') && !t.bookingId && !t.buyerName);
                    if (firstAvail) openSaleModalWithAnchor(firstAvail);
                    else showToast('error', 'No available physical tickets in inventory.');
                  }}
                  className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 text-white font-bold text-xs font-cinzel flex items-center gap-2 shadow-md transition-all cursor-pointer"
                >
                  <UserPlus className="w-4 h-4 text-emerald-100" />
                  + SELL TICKET
                </button>
                <button
                  onClick={() => setActiveNav('inventory')}
                  className="px-4 py-2.5 rounded-xl bg-[#240409] hover:bg-[#380710] text-amber-200 font-bold text-xs font-cinzel border border-amber-500/40 flex items-center gap-2 transition-all cursor-pointer shadow"
                >
                  <LayoutGrid className="w-4 h-4 text-amber-400" />
                  50 SEATS
                </button>
                <button
                  onClick={() => setShowResetModal(true)}
                  className="px-3.5 py-2.5 rounded-xl bg-red-950/70 hover:bg-red-900/80 text-red-200 font-bold text-xs font-cinzel border border-red-700/50 flex items-center gap-2 transition-all cursor-pointer shadow"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-red-400" />
                  RESET EVENT
                </button>
              </div>
            </div>

            {/* Inventory KPI Stat Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
              <div className="bg-gradient-to-b from-[#1b0307] to-[#100204] border border-amber-500/30 rounded-2xl p-4 shadow-lg">
                <span className="text-[11px] font-bold text-amber-200/70 uppercase tracking-wider font-cinzel">TOTAL SEATS</span>
                <div className="text-3xl font-black text-amber-100 font-bebas mt-1 drop-shadow">{stats.totalTickets}</div>
                <span className="text-[10px] text-amber-400/50 font-cinzel">Fixed Capacity</span>
              </div>

              <div className="bg-gradient-to-b from-[#1b0307] to-[#100204] border border-emerald-500/40 rounded-2xl p-4 shadow-lg">
                <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider font-cinzel">AVAILABLE</span>
                <div className="text-3xl font-black text-emerald-400 font-bebas mt-1 drop-shadow">{stats.available}</div>
                <span className="text-[10px] text-emerald-500/80 font-cinzel">Ready to Sell</span>
              </div>

              <div className="bg-gradient-to-b from-[#1b0307] to-[#100204] border border-sky-500/40 rounded-2xl p-4 shadow-lg">
                <span className="text-[11px] font-bold text-sky-400 uppercase tracking-wider font-cinzel">REGISTERED</span>
                <div className="text-3xl font-black text-sky-300 font-bebas mt-1 drop-shadow">{stats.registered}</div>
                <span className="text-[10px] text-sky-500/80 font-cinzel">Physical Sold</span>
              </div>

              <div className="bg-gradient-to-b from-[#1b0307] to-[#100204] border border-emerald-500/50 rounded-2xl p-4 shadow-lg shadow-emerald-950/30">
                <span className="text-[11px] font-bold text-emerald-300 uppercase tracking-wider font-cinzel">ENTERED</span>
                <div className="text-3xl font-black text-emerald-300 font-bebas mt-1 drop-shadow">{stats.entered}</div>
                <span className="text-[10px] text-emerald-400/70 font-cinzel">Through Door</span>
              </div>

              <div className="bg-gradient-to-b from-[#1b0307] to-[#100204] border border-amber-500/40 rounded-2xl p-4 shadow-lg">
                <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wider font-cinzel">NOT ENTERED</span>
                <div className="text-3xl font-black text-amber-300 font-bebas mt-1 drop-shadow">{stats.notEntered}</div>
                <span className="text-[10px] text-amber-400/60 font-cinzel">Awaiting Arrival</span>
              </div>

              <div className="bg-gradient-to-b from-[#1b0307] to-[#100204] border border-rose-500/40 rounded-2xl p-4 shadow-lg">
                <span className="text-[11px] font-bold text-rose-400 uppercase tracking-wider font-cinzel">CANCELLED</span>
                <div className="text-3xl font-black text-rose-400 font-bebas mt-1 drop-shadow">{stats.cancelled || 0}</div>
                <span className="text-[10px] text-rose-500/70 font-cinzel">Void / Damaged</span>
              </div>
            </div>

            {/* Financial Overview & Today's Offline Sales */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* Today's Sales Card */}
              <div className="bg-gradient-to-b from-[#1b0307] to-[#100204] border border-amber-500/30 rounded-2xl p-5 shadow-xl lg:col-span-2 space-y-4">
                <div className="flex items-center justify-between border-b border-amber-500/20 pb-3">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-amber-400" />
                    <h3 className="font-bold text-sm text-amber-100 font-cinzel tracking-wide">Today's Offline Box Office Ledger</h3>
                  </div>
                  <span className="text-xs text-amber-200/60 font-mono">Kolkata Live</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-[#0b0103]/80 p-3 rounded-xl border border-amber-500/20">
                    <span className="text-[10px] uppercase text-amber-200/60 font-bold font-cinzel">Tickets Sold</span>
                    <div className="text-2xl font-bold font-bebas text-emerald-400 mt-0.5">{stats.todaySales?.ticketsSold || 0}</div>
                  </div>
                  <div className="bg-[#0b0103]/80 p-3 rounded-xl border border-amber-500/20">
                    <span className="text-[10px] uppercase text-amber-200/60 font-bold font-cinzel">Transactions</span>
                    <div className="text-2xl font-bold font-bebas text-amber-200 mt-0.5">{stats.todaySales?.bookings || 0}</div>
                  </div>
                  <div className="bg-[#0b0103]/80 p-3 rounded-xl border border-amber-500/20">
                    <span className="text-[10px] uppercase text-amber-200/60 font-bold font-cinzel">Revenue Collected</span>
                    <div className="text-2xl font-bold font-bebas text-amber-400 mt-0.5">₹{(stats.todaySales?.revenue || 0).toLocaleString()}</div>
                  </div>
                  <div className="bg-[#0b0103]/80 p-3 rounded-xl border border-amber-500/20">
                    <span className="text-[10px] uppercase text-amber-200/60 font-bold font-cinzel">Pending Dues</span>
                    <div className="text-2xl font-bold font-bebas text-rose-400 mt-0.5">₹{(stats.todaySales?.pending || 0).toLocaleString()}</div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 pt-1">
                  <div className="bg-[#140306] p-3 rounded-xl border border-amber-500/20">
                    <div className="flex items-center justify-between text-xs text-amber-200/80">
                      <span className="font-cinzel">Cash Desk</span>
                      <span className="font-mono font-bold text-emerald-400">₹{(stats.todaySales?.cash || 0).toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="bg-[#140306] p-3 rounded-xl border border-amber-500/20">
                    <div className="flex items-center justify-between text-xs text-amber-200/80">
                      <span className="font-cinzel">UPI QR</span>
                      <span className="font-mono font-bold text-sky-400">₹{(stats.todaySales?.upi || 0).toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="bg-[#140306] p-3 rounded-xl border border-amber-500/20">
                    <div className="flex items-center justify-between text-xs text-amber-200/80">
                      <span className="font-cinzel">Card / Other</span>
                      <span className="font-mono font-bold text-purple-400">₹{(stats.todaySales?.other || 0).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Event Totals & Attendance */}
              <div className="bg-gradient-to-b from-[#1b0307] to-[#100204] border border-amber-500/30 rounded-2xl p-5 shadow-xl space-y-4">
                <div className="flex items-center justify-between border-b border-amber-500/20 pb-3">
                  <h3 className="font-bold text-sm text-amber-100 font-cinzel tracking-wide flex items-center gap-2">
                    <Users className="w-4 h-4 text-amber-400" />
                    Audience Turnout & Gate
                  </h3>
                </div>

                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-xs text-amber-200/80 mb-1 font-cinzel">
                      <span>Gate Turnout Rate</span>
                      <span className="font-bold text-amber-300 font-mono">{stats.attendanceRate}%</span>
                    </div>
                    <div className="w-full bg-[#0a0103] h-3 rounded-full overflow-hidden border border-amber-500/30 p-0.5">
                      <div
                        className="bg-gradient-to-r from-amber-500 via-amber-400 to-emerald-400 h-full rounded-full transition-all duration-500 shadow-sm shadow-amber-500/50"
                        style={{ width: `${Math.min(100, stats.attendanceRate)}%` }}
                      />
                    </div>
                  </div>

                  <div className="pt-2 border-t border-amber-500/20 space-y-2 text-xs font-cinzel">
                    <div className="flex justify-between">
                      <span className="text-amber-200/70">Total Customer Bookings:</span>
                      <span className="font-semibold text-white font-mono">{stats.totalBookings || bookings.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-amber-200/70">Physical Tickets Sold:</span>
                      <span className="font-semibold text-white font-mono">{stats.totalTicketsSold || stats.registered} / 50</span>
                    </div>
                    <div className="flex justify-between text-sm pt-2 border-t border-amber-500/20 font-bold">
                      <span className="text-amber-200">Total Event Revenue:</span>
                      <span className="text-amber-400 font-bebas text-xl">₹{(stats.totalRevenue || 0).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: SCAN & SELL (PHYSICAL TICKET SCAN STATION)                         */}
        {/* ========================================================================= */}
        {activeNav === 'scan' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left Column: Camera QR Scanner & Manual Lookup */}
              <div className="theatre-placard rounded-2xl p-6 shadow-2xl space-y-5 relative overflow-hidden">
                {/* Corner Brass Brackets */}
                <div className="absolute top-2 left-2 w-3 h-3 border-t-2 border-l-2 border-amber-500/60 pointer-events-none" />
                <div className="absolute top-2 right-2 w-3 h-3 border-t-2 border-r-2 border-amber-500/60 pointer-events-none" />
                <div className="absolute bottom-2 left-2 w-3 h-3 border-b-2 border-l-2 border-amber-500/60 pointer-events-none" />
                <div className="absolute bottom-2 right-2 w-3 h-3 border-b-2 border-r-2 border-amber-500/60 pointer-events-none" />

                <div className="border-b border-amber-500/20 pb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-lg bg-[#881326]/60 border border-amber-500/40 text-amber-300">
                      <QrCode className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-amber-100 font-bebas tracking-wide">
                        SCAN TO REGISTER
                      </h3>
                      <p className="text-[10px] text-amber-200/60 font-cinzel">Live Optical Ticket Identifier</p>
                    </div>
                  </div>
                  <span className="text-[10px] uppercase font-cinzel font-bold px-2.5 py-1 rounded-full bg-[#1b0307] text-amber-300 border border-amber-500/40">
                    Live Camera
                  </span>
                </div>

                {/* Camera Viewport */}
                <div className="relative bg-[#070102] rounded-xl overflow-hidden border-2 border-amber-500/30 min-h-[260px] flex items-center justify-center shadow-inner">
                  <div id="qr-camera-reader" className="w-full h-full min-h-[260px]"></div>
                  {!isScannerRunning && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0e0204]/90 p-4 text-center pointer-events-none space-y-2">
                      <Smartphone className="w-9 h-9 text-amber-500/70 animate-bounce drop-shadow" />
                      <p className="text-xs text-amber-200/80 font-cinzel font-medium max-w-xs">
                        Present the physical ticket QR code to the camera lens, or enter the code below.
                      </p>
                    </div>
                  )}
                </div>

                {/* Manual Ticket Number Fallback */}
                <div className="bg-[#0e0204]/90 p-4 rounded-xl border border-amber-500/30 space-y-2.5">
                  <label className="text-xs font-bold text-amber-200/90 font-cinzel flex items-center gap-1.5 uppercase tracking-wide">
                    <Search className="w-3.5 h-3.5 text-amber-400" />
                    Manual Ticket Number Fallback
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="e.g. HOH021"
                      value={manualTicketInput}
                      onChange={(e) => setManualTicketInput(e.target.value.toUpperCase())}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleTicketIdentified(manualTicketInput);
                      }}
                      className="flex-1 bg-[#160205] border border-amber-500/40 rounded-xl px-3.5 py-2.5 text-sm text-amber-100 font-mono placeholder:text-stone-600 focus:outline-none focus:border-amber-400 uppercase font-bold"
                    />
                    <button
                      onClick={() => handleTicketIdentified(manualTicketInput)}
                      disabled={!manualTicketInput.trim() || actionLoading === manualTicketInput.trim()}
                      className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 text-stone-950 font-black text-xs font-cinzel rounded-xl transition-all disabled:opacity-50 shadow-md cursor-pointer"
                    >
                      {actionLoading === manualTicketInput.trim() ? 'LOOKING UP...' : 'LOOKUP'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Right Column: Scan Result & Quick Sell Flow */}
              <div className="theatre-placard rounded-2xl p-6 shadow-2xl space-y-4 relative overflow-hidden">
                {/* Corner Brass Brackets */}
                <div className="absolute top-2 left-2 w-3 h-3 border-t-2 border-l-2 border-amber-500/60 pointer-events-none" />
                <div className="absolute top-2 right-2 w-3 h-3 border-t-2 border-r-2 border-amber-500/60 pointer-events-none" />
                <div className="absolute bottom-2 left-2 w-3 h-3 border-b-2 border-l-2 border-amber-500/60 pointer-events-none" />
                <div className="absolute bottom-2 right-2 w-3 h-3 border-b-2 border-r-2 border-amber-500/60 pointer-events-none" />

                <div className="border-b border-amber-500/20 pb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-amber-400" />
                    <h3 className="text-xl font-bold text-amber-100 font-bebas tracking-wide">
                      TICKET SCAN RESULT
                    </h3>
                  </div>
                  {scannedTicketResult && (
                    <button
                      onClick={() => setScannedTicketResult(null)}
                      className="text-xs text-amber-200/60 hover:text-amber-100 font-cinzel font-bold cursor-pointer"
                    >
                      Clear Card
                    </button>
                  )}
                </div>

                {!scannedTicketResult ? (
                  <div className="h-64 flex flex-col items-center justify-center text-center p-6 border-2 border-dashed border-amber-500/20 rounded-xl text-amber-200/40 space-y-2.5">
                    <TicketIcon className="w-12 h-12 text-amber-500/30" />
                    <p className="text-sm font-bold text-amber-200/80 font-cinzel">Ready for Scanning</p>
                    <p className="text-xs text-amber-200/50 max-w-xs font-sans">
                      Scan a physical ticket QR code or type a ticket number like <span className="text-amber-400 font-mono font-bold">HOH021</span> to inspect and register offline sales.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4 animate-in fade-in duration-200">
                    {/* Ticket Header Card */}
                    <div className="bg-[#120205] p-4 rounded-xl border border-amber-500/30 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="text-4xl font-black font-bebas text-amber-300 drop-shadow">{scannedTicketResult.code}</div>
                        <div>
                          <div className="text-[11px] text-amber-200/60 font-cinzel">Physical Ticket #{scannedTicketResult.serialNumber}</div>
                          <div className="text-[10px] text-stone-500 font-mono">1 Person / Guest</div>
                        </div>
                      </div>

                      {/* Status Tag */}
                      <div>
                        {scannedTicketResult.status === 'cancelled' ? (
                          <span className="px-3 py-1 rounded-full bg-rose-950/90 text-rose-300 border border-rose-600/50 text-xs font-bold font-cinzel flex items-center gap-1">
                            <Ban className="w-3.5 h-3.5" /> CANCELLED
                          </span>
                        ) : scannedTicketResult.status === 'registered' || scannedTicketResult.buyerName ? (
                          <span className="px-3 py-1 rounded-full bg-red-950/90 text-amber-300 border border-amber-500/50 text-xs font-bold font-cinzel flex items-center gap-1 shadow">
                            <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" /> REGISTERED
                          </span>
                        ) : (
                          <span className="px-3 py-1 rounded-full bg-emerald-950/90 text-emerald-300 border border-emerald-500/60 text-xs font-bold font-cinzel flex items-center gap-1 shadow">
                            <Check className="w-3.5 h-3.5 text-emerald-400" /> AVAILABLE
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Action conditional on status */}
                    {scannedTicketResult.status === 'available' && !scannedTicketResult.buyerName && (
                      <div className="bg-emerald-950/30 border border-emerald-500/40 rounded-xl p-4 space-y-3">
                        <div className="text-xs text-emerald-300 font-cinzel font-bold flex items-center gap-1.5">
                          <span>✓ Physical ticket</span>
                          <span className="font-mono text-amber-300 font-bold">{scannedTicketResult.code}</span>
                          <span>is ready for offline registration.</span>
                        </div>
                        <button
                          onClick={() => openSaleModalWithAnchor(scannedTicketResult)}
                          className="w-full py-3.5 bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 hover:from-amber-400 text-stone-950 font-black text-xs uppercase tracking-wider font-cinzel rounded-xl transition-all shadow-[0_0_20px_rgba(245,158,11,0.35)] flex items-center justify-center gap-2 cursor-pointer"
                        >
                          <UserPlus className="w-4 h-4 text-stone-950" />
                          SELL TICKET (ANCHOR: {scannedTicketResult.code})
                        </button>
                      </div>
                    )}

                    {(scannedTicketResult.status === 'registered' || scannedTicketResult.buyerName) && (
                      <div className="bg-[#120205] p-4 rounded-xl border border-amber-500/30 space-y-3">
                        <div className="text-xs text-rose-300 font-semibold font-cinzel flex items-center gap-1.5">
                          <AlertTriangle className="w-4 h-4 text-rose-400" />
                          Physical ticket already assigned to an attendee.
                        </div>

                        <div className="grid grid-cols-2 gap-2.5 text-xs bg-[#0a0103] p-3 rounded-lg border border-amber-500/20 font-cinzel">
                          <div>
                            <span className="text-amber-200/60">Customer Name:</span>
                            <div className="font-bold text-white text-sm font-sans">{scannedTicketResult.buyerName || 'N/A'}</div>
                          </div>
                          <div>
                            <span className="text-amber-200/60">Phone:</span>
                            <div className="font-mono text-amber-200 text-sm">{scannedTicketResult.phone || 'N/A'}</div>
                          </div>
                          <div>
                            <span className="text-amber-200/60">Booking Code:</span>
                            <div className="font-mono text-amber-400 font-bold">{scannedTicketResult.bookingCode || 'N/A'}</div>
                          </div>
                          <div>
                            <span className="text-amber-200/60">Gate Admission:</span>
                            <div className={`font-bold ${scannedTicketResult.entered ? 'text-emerald-400' : 'text-amber-400'}`}>
                              {scannedTicketResult.entered ? '✓ ENTERED' : '⏳ NOT ENTERED'}
                            </div>
                          </div>
                        </div>

                        {/* 1-Click Entry Toggle */}
                        <div className="pt-2 flex gap-2">
                          <button
                            onClick={() => handleToggleEntry(scannedTicketResult.code, scannedTicketResult.entered)}
                            className={`flex-1 py-3 rounded-xl text-xs font-bold font-cinzel transition-all flex items-center justify-center gap-1.5 shadow-md cursor-pointer ${
                              scannedTicketResult.entered
                                ? 'bg-[#2a0409] hover:bg-[#3d0810] text-amber-300 border border-amber-500/40'
                                : 'bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 text-slate-950 font-black'
                            }`}
                          >
                            {scannedTicketResult.entered ? 'MARK AS NOT ENTERED' : 'MARK AS ENTERED'}
                          </button>
                        </div>
                      </div>
                    )}

                    {scannedTicketResult.status === 'cancelled' && (
                      <div className="bg-rose-950/30 border border-rose-500/40 rounded-xl p-4 space-y-3">
                        <div className="text-xs text-rose-300 font-semibold font-cinzel flex items-center gap-1.5">
                          <Ban className="w-4 h-4 text-rose-400" />
                          Physical ticket voided ({scannedTicketResult.cancellationReason || 'VOID'}).
                        </div>
                        <button
                          onClick={() => handleUncancelTicket(scannedTicketResult.code)}
                          className="w-full py-2.5 bg-[#2a0409] hover:bg-[#3d0810] text-amber-200 text-xs font-bold font-cinzel rounded-xl border border-amber-500/40 cursor-pointer"
                        >
                          RESTORE TO AVAILABLE
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: TICKETS (MANAGEMENT TABLE & MOBILE CARDS)                          */}
        {/* ========================================================================= */}
        {activeNav === 'tickets' && (
          <div className="space-y-4">
            {/* Filter & Search Bar */}
            <div className="theatre-placard rounded-2xl p-4 sm:p-5 shadow-xl flex flex-wrap items-center justify-between gap-3">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="w-4 h-4 text-amber-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search ticket code, customer, phone, booking..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-[#0d0103] border border-amber-500/30 rounded-xl pl-10 pr-4 py-2.5 text-xs text-amber-50 placeholder:text-stone-600 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400/50 font-medium"
                />
              </div>

              {/* Status Filter Tabs */}
              <div className="flex flex-wrap items-center gap-1 bg-[#0d0103] p-1 rounded-xl border border-amber-500/25 text-xs font-cinzel">
                {(['all', 'available', 'registered', 'entered', 'not-entered', 'cancelled'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setFilterStatus(tab)}
                    className={`px-3 py-1.5 rounded-lg font-bold capitalize transition-all cursor-pointer ${
                      filterStatus === tab
                        ? 'bg-gradient-to-r from-amber-500 to-amber-400 text-stone-950 shadow-md'
                        : 'text-amber-200/70 hover:text-amber-100'
                    }`}
                  >
                    {tab.replace('-', ' ')}
                  </button>
                ))}
              </div>
            </div>

            {/* Desktop Table View */}
            <div className="hidden lg:block theatre-placard rounded-2xl overflow-hidden shadow-2xl">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#100204]/90 text-amber-200/80 border-b border-amber-500/30 uppercase tracking-wider font-cinzel font-bold">
                    <th className="py-3.5 px-4">Ticket</th>
                    <th className="py-3.5 px-4">Customer</th>
                    <th className="py-3.5 px-4">Phone</th>
                    <th className="py-3.5 px-4">Status</th>
                    <th className="py-3.5 px-4">Gate Admission</th>
                    <th className="py-3.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-amber-500/10">
                  {filteredTickets.map((t) => {
                    const isRegistered = t.status === 'registered' || !!t.buyerName;
                    const isCancelled = t.status === 'cancelled';

                    return (
                      <tr key={t.code} className="hover:bg-[#25050c]/60 transition-colors">
                        {/* Ticket Code */}
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-2">
                            <span className="font-bebas text-lg font-bold text-amber-300 drop-shadow">{t.code}</span>
                            <span className="text-[10px] text-amber-200/50 font-cinzel">#{t.serialNumber}</span>
                          </div>
                        </td>

                        {/* Customer */}
                        <td className="py-3.5 px-4">
                          {isRegistered ? (
                            <div>
                              <div className="font-bold text-white text-sm font-sans">{t.buyerName}</div>
                              {t.bookingCode && <div className="text-[10px] font-mono text-amber-400 font-bold">{t.bookingCode}</div>}
                            </div>
                          ) : isCancelled ? (
                            <span className="text-rose-400 italic font-cinzel">Void ({t.cancellationReason || 'VOID'})</span>
                          ) : (
                            <span className="text-amber-200/40 font-mono">—</span>
                          )}
                        </td>

                        {/* Phone */}
                        <td className="py-3.5 px-4 font-mono text-amber-200/90 text-xs">
                          {t.phone || '—'}
                        </td>

                        {/* Status Badge */}
                        <td className="py-3.5 px-4 font-cinzel">
                          {isCancelled ? (
                            <span className="px-2.5 py-1 rounded-full bg-rose-950/80 text-rose-300 border border-rose-700/50 text-[10px] font-bold">
                              CANCELLED
                            </span>
                          ) : isRegistered ? (
                            <span className="px-2.5 py-1 rounded-full bg-red-950/80 text-amber-300 border border-amber-500/50 text-[10px] font-bold shadow-sm">
                              REGISTERED
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 rounded-full bg-emerald-950/80 text-emerald-300 border border-emerald-600/50 text-[10px] font-bold shadow-sm">
                              AVAILABLE
                            </span>
                          )}
                        </td>

                        {/* 1-Click Manual Entry Toggle */}
                        <td className="py-3.5 px-4">
                          {isRegistered ? (
                            <button
                              onClick={() => handleToggleEntry(t.code, t.entered)}
                              disabled={actionLoading === `entry-${t.code}`}
                              className={`px-3 py-1.5 rounded-xl text-xs font-bold font-cinzel transition-all flex items-center gap-1.5 shadow-sm cursor-pointer ${
                                t.entered
                                  ? 'bg-[#2a0409] hover:bg-[#3d0810] text-amber-300 border border-amber-500/40'
                                  : 'bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 text-slate-950 font-black shadow-md'
                              }`}
                            >
                              {t.entered ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-amber-400" />
                                  ENTERED
                                </>
                              ) : (
                                <>
                                  <AlertTriangle className="w-3.5 h-3.5" />
                                  MARK ENTERED
                                </>
                              )}
                            </button>
                          ) : (
                            <span className="text-amber-200/30 text-xs font-mono">—</span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="py-3.5 px-4 text-right space-x-1.5 font-cinzel">
                          {isRegistered ? (
                            <>
                              <button
                                onClick={() => setSelectedTicketDetail(t)}
                                className="px-2.5 py-1 bg-[#240409] hover:bg-[#380710] text-amber-200 rounded-lg text-[11px] font-bold border border-amber-500/30 cursor-pointer"
                              >
                                View
                              </button>
                              <button
                                onClick={() => handleClearTicket(t.code)}
                                className="px-2.5 py-1 bg-red-950/50 hover:bg-red-900/70 text-rose-300 rounded-lg text-[11px] font-bold border border-rose-800/40 cursor-pointer"
                              >
                                Clear
                              </button>
                            </>
                          ) : isCancelled ? (
                            <button
                              onClick={() => handleUncancelTicket(t.code)}
                              className="px-2.5 py-1 bg-[#240409] hover:bg-[#380710] text-amber-300 rounded-lg text-[11px] font-bold border border-amber-500/40 cursor-pointer"
                            >
                              Restore
                            </button>
                          ) : (
                            <>
                              <button
                                onClick={() => openSaleModalWithAnchor(t)}
                                className="px-3.5 py-1 bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 text-stone-950 font-black rounded-lg text-[11px] shadow cursor-pointer"
                              >
                                Sell
                              </button>
                              <button
                                onClick={() => setShowCancelModal(t)}
                                className="px-2.5 py-1 bg-[#1a0307] hover:bg-[#2b050c] text-amber-200/60 hover:text-rose-400 rounded-lg text-[11px] border border-amber-500/20 cursor-pointer"
                              >
                                Void
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Card View */}
            <div className="lg:hidden space-y-3">
              {filteredTickets.map((t) => {
                const isRegistered = t.status === 'registered' || !!t.buyerName;
                const isCancelled = t.status === 'cancelled';

                return (
                  <div key={t.code} className="theatre-placard rounded-xl p-4 space-y-3 shadow-lg">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xl font-black font-bebas text-amber-300 drop-shadow">{t.code}</span>
                        <span className="text-xs text-amber-200/50 font-cinzel">#{t.serialNumber}</span>
                      </div>
                      <div>
                        {isCancelled ? (
                          <span className="px-2.5 py-0.5 rounded-full bg-rose-950/80 text-rose-300 text-[10px] font-bold border border-rose-800/40 font-cinzel">
                            CANCELLED
                          </span>
                        ) : isRegistered ? (
                          <span className="px-2.5 py-0.5 rounded-full bg-red-950/80 text-amber-300 text-[10px] font-bold border border-amber-500/40 font-cinzel shadow">
                            REGISTERED
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded-full bg-emerald-950/80 text-emerald-300 text-[10px] font-bold border border-emerald-600/50 font-cinzel shadow">
                            AVAILABLE
                          </span>
                        )}
                      </div>
                    </div>

                    {isRegistered && (
                      <div className="text-xs space-y-1 bg-[#0d0103] p-3 rounded-lg border border-amber-500/20 font-cinzel">
                        <div className="font-bold text-white text-sm font-sans">{t.buyerName}</div>
                        <div className="text-amber-200/80 font-mono">{t.phone}</div>
                        {t.bookingCode && <div className="text-amber-400 font-mono font-bold text-xs">{t.bookingCode}</div>}
                      </div>
                    )}

                    {/* Entry Toggle Button on Mobile */}
                    {isRegistered && (
                      <button
                        onClick={() => handleToggleEntry(t.code, t.entered)}
                        className={`w-full py-2.5 rounded-xl text-xs font-bold font-cinzel flex items-center justify-center gap-2 cursor-pointer ${
                          t.entered
                            ? 'bg-[#2a0409] text-amber-300 border border-amber-500/40'
                            : 'bg-gradient-to-r from-emerald-600 to-emerald-500 text-slate-950 font-black'
                        }`}
                      >
                        {t.entered ? '✓ ENTERED (CLICK TO UNDO)' : 'MARK AS ENTERED'}
                      </button>
                    )}

                    {!isRegistered && !isCancelled && (
                      <button
                        onClick={() => openSaleModalWithAnchor(t)}
                        className="w-full py-2.5 bg-gradient-to-r from-amber-500 to-amber-400 text-stone-950 font-black font-cinzel rounded-xl text-xs flex items-center justify-center gap-1.5 shadow cursor-pointer"
                      >
                        <UserPlus className="w-3.5 h-3.5 text-stone-950" />
                        SELL THIS TICKET
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 4: PHYSICAL INVENTORY GRID (50 TICKETS)                              */}
        {/* ========================================================================= */}
        {activeNav === 'inventory' && (
          <div className="theatre-placard rounded-2xl p-6 shadow-2xl space-y-6 relative overflow-hidden">
            {/* Corner Brass Brackets */}
            <div className="absolute top-2 left-2 w-3 h-3 border-t-2 border-l-2 border-amber-500/60 pointer-events-none" />
            <div className="absolute top-2 right-2 w-3 h-3 border-t-2 border-r-2 border-amber-500/60 pointer-events-none" />
            <div className="absolute bottom-2 left-2 w-3 h-3 border-b-2 border-l-2 border-amber-500/60 pointer-events-none" />
            <div className="absolute bottom-2 right-2 w-3 h-3 border-b-2 border-r-2 border-amber-500/60 pointer-events-none" />

            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-amber-500/20 pb-4">
              <div>
                <h3 className="text-2xl font-bold text-amber-100 font-bebas tracking-wide flex items-center gap-2">
                  <LayoutGrid className="w-6 h-6 text-amber-400" />
                  PHYSICAL SEAT INVENTORY (HOH001 TO HOH050)
                </h3>
                <p className="text-xs text-amber-200/60 font-cinzel mt-1">
                  Click any seat stub to sell with anchor or view attendee credentials.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs font-cinzel">
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-[#1e0409] border border-amber-500/50"></span> Available</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-[#0f172a] border border-sky-500/50"></span> Sold</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-600 border border-emerald-400"></span> Entered</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-rose-900 border border-rose-600"></span> Void</span>
              </div>
            </div>

            {/* 50 Ticket Grid */}
            <div className="grid grid-cols-5 sm:grid-cols-10 gap-2.5 sm:gap-3">
              {Array.from({ length: 50 }, (_, i) => {
                const code = `HOH${String(i + 1).padStart(3, '0')}`;
                const ticket = tickets.find(t => t.code === code);
                const isRegistered = ticket?.status === 'registered' || !!ticket?.buyerName;
                const isEntered = ticket?.entered;
                const isCancelled = ticket?.status === 'cancelled';

                let bgClass = 'border-amber-500/40 bg-[#1e0409] text-amber-200 hover:border-amber-300 hover:bg-[#2d070f] shadow';
                if (isCancelled) bgClass = 'border-rose-800/40 bg-[#160205] text-rose-400/80 shadow';
                else if (isEntered) bgClass = 'border-emerald-400 bg-gradient-to-b from-emerald-600 to-emerald-700 text-slate-950 font-black shadow-[0_0_12px_rgba(16,185,129,0.4)]';
                else if (isRegistered) bgClass = 'border-sky-500/50 bg-[#0f172a] text-sky-200 shadow';

                return (
                  <button
                    key={code}
                    onClick={() => {
                      if (ticket) {
                        if (isRegistered) setSelectedTicketDetail(ticket);
                        else openSaleModalWithAnchor(ticket);
                      }
                    }}
                    className={`h-16 rounded-xl border p-1 flex flex-col items-center justify-center transition-all transform active:scale-95 cursor-pointer relative overflow-hidden group ${bgClass}`}
                  >
                    <span className="font-bebas text-base tracking-wider drop-shadow">{code}</span>
                    <span className="text-[9px] uppercase font-cinzel font-bold tracking-wider">
                      {isCancelled ? 'VOID' : isEntered ? 'ENTERED' : isRegistered ? 'SOLD' : 'AVAIL'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 5: BOOKINGS LIST & DETAILS                                            */}
        {/* ========================================================================= */}
        {activeNav === 'bookings' && (
          <div className="space-y-4">
            <div className="theatre-placard rounded-2xl overflow-hidden shadow-2xl relative">
              {/* Corner Brass Brackets */}
              <div className="absolute top-2 left-2 w-3 h-3 border-t-2 border-l-2 border-amber-500/60 pointer-events-none" />
              <div className="absolute top-2 right-2 w-3 h-3 border-t-2 border-r-2 border-amber-500/60 pointer-events-none" />

              <div className="p-4 sm:p-5 border-b border-amber-500/20 bg-[#120205]/90 flex items-center justify-between">
                <h3 className="font-bold text-base text-amber-100 font-bebas tracking-wide flex items-center gap-2">
                  <ListOrdered className="w-5 h-5 text-amber-400" />
                  ALL CUSTOMER BOOKINGS ({bookings.length})
                </h3>
                <span className="text-[11px] font-cinzel text-amber-200/60">House of Humour Ledger</span>
              </div>

              {bookings.length === 0 ? (
                <div className="p-12 text-center text-amber-200/50 text-xs font-cinzel">
                  No bookings created yet. Use "Scan & Sell" or "+ Sell Ticket" to create bookings.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-[#120205] text-amber-200/80 border-b border-amber-500/30 uppercase tracking-wider font-cinzel font-bold">
                        <th className="py-3.5 px-4">Booking Code</th>
                        <th className="py-3.5 px-4">Customer</th>
                        <th className="py-3.5 px-4">Tickets Assigned</th>
                        <th className="py-3.5 px-4">Payment</th>
                        <th className="py-3.5 px-4">Gate Progress</th>
                        <th className="py-3.5 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-amber-500/10">
                      {bookings.map((b) => (
                        <tr key={b._id} className="hover:bg-[#25050c]/60 transition-colors">
                          <td className="py-3.5 px-4 font-mono font-bold text-amber-300">
                            <span className="font-bebas text-base tracking-wider">{b.bookingCode}</span>
                          </td>
                          <td className="py-3.5 px-4">
                            <div className="font-bold text-white text-sm font-sans">{b.buyerName}</div>
                            <div className="text-amber-200/70 font-mono text-[11px]">{b.phone}</div>
                          </td>
                          <td className="py-3.5 px-4">
                            <div className="flex flex-wrap gap-1">
                              {b.ticketCodes.map(tc => (
                                <span key={tc} className="font-bebas text-xs px-2 py-0.5 bg-[#1b0307] text-amber-300 rounded border border-amber-500/40">
                                  {tc}
                                </span>
                              ))}
                            </div>
                            <span className="text-[10px] text-amber-200/50 font-cinzel">Qty: {b.ticketQuantity}</span>
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="font-bold text-amber-100 text-sm">₹{(b.amountPaid || b.totalAmount).toLocaleString()}</span>
                            <div className="text-[10px] text-amber-200/60 font-cinzel">{b.paymentMethod || 'CASH'} • {b.paymentStatus}</div>
                          </td>
                          <td className="py-3.5 px-4 font-cinzel">
                            <span className="text-xs font-bold text-emerald-400">
                              {b.enteredCount || 0} / {b.ticketQuantity} Entered
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-right space-x-1.5 font-cinzel">
                            <button
                              onClick={() => setSelectedBookingDetail(b)}
                              className="px-2.5 py-1 bg-[#240409] hover:bg-[#380710] text-amber-200 rounded-lg text-[11px] font-bold border border-amber-500/30 cursor-pointer"
                            >
                              Details
                            </button>
                            <button
                              onClick={() => setEditingBooking(b)}
                              className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 rounded-lg text-[11px] font-bold border border-amber-500/40 cursor-pointer"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleClearBooking(b)}
                              className="px-2.5 py-1 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 rounded-lg text-[11px] font-bold border border-rose-800/40 cursor-pointer"
                            >
                              Clear
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 6: OFFLINE SALES LEDGER & ANALYTICS                                   */}
        {/* ========================================================================= */}
        {activeNav === 'sales' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div className="theatre-placard p-4 rounded-xl relative overflow-hidden shadow-lg">
                <span className="text-xs text-amber-200/70 uppercase font-cinzel font-bold tracking-wider">Today's Revenue</span>
                <div className="text-3xl font-black text-amber-300 mt-1 font-bebas tracking-wide drop-shadow">₹{(stats.todaySales?.revenue || 0).toLocaleString()}</div>
              </div>
              <div className="theatre-placard p-4 rounded-xl relative overflow-hidden shadow-lg">
                <span className="text-xs text-amber-200/70 uppercase font-cinzel font-bold tracking-wider">Cash Collected</span>
                <div className="text-3xl font-black text-emerald-400 mt-1 font-bebas tracking-wide drop-shadow">₹{(stats.todaySales?.cash || 0).toLocaleString()}</div>
              </div>
              <div className="theatre-placard p-4 rounded-xl relative overflow-hidden shadow-lg">
                <span className="text-xs text-amber-200/70 uppercase font-cinzel font-bold tracking-wider">UPI Collected</span>
                <div className="text-3xl font-black text-sky-400 mt-1 font-bebas tracking-wide drop-shadow">₹{(stats.todaySales?.upi || 0).toLocaleString()}</div>
              </div>
              <div className="theatre-placard p-4 rounded-xl relative overflow-hidden shadow-lg">
                <span className="text-xs text-amber-200/70 uppercase font-cinzel font-bold tracking-wider">Total Tickets Sold</span>
                <div className="text-3xl font-black text-amber-100 mt-1 font-bebas tracking-wide drop-shadow">{stats.registered} / 50</div>
              </div>
            </div>

            {/* Offline Sales Ledger */}
            <div className="theatre-placard rounded-2xl overflow-hidden shadow-2xl relative">
              {/* Corner Brass Brackets */}
              <div className="absolute top-2 left-2 w-3 h-3 border-t-2 border-l-2 border-amber-500/60 pointer-events-none" />
              <div className="absolute top-2 right-2 w-3 h-3 border-t-2 border-r-2 border-amber-500/60 pointer-events-none" />

              <div className="p-4 sm:p-5 border-b border-amber-500/20 bg-[#120205]/90 flex items-center justify-between">
                <h3 className="font-bold text-base text-amber-100 font-bebas tracking-wide flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-emerald-400" />
                  OFFLINE BOX OFFICE TRANSACTIONS
                </h3>
                <span className="text-[11px] font-cinzel text-amber-200/60">Astra Towers Box Office</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#120205] text-amber-200/80 border-b border-amber-500/30 uppercase tracking-wider font-cinzel font-bold">
                      <th className="py-3.5 px-4">Time</th>
                      <th className="py-3.5 px-4">Booking</th>
                      <th className="py-3.5 px-4">Customer</th>
                      <th className="py-3.5 px-4">Tickets</th>
                      <th className="py-3.5 px-4">Amount</th>
                      <th className="py-3.5 px-4">Payment</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-500/10">
                    {bookings.map((b) => (
                      <tr key={b._id} className="hover:bg-[#25050c]/60 transition-colors">
                        <td className="py-3.5 px-4 text-amber-200/70 font-mono">
                          {new Date(b.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="py-3.5 px-4 font-mono font-bold text-amber-300">
                          <span className="font-bebas text-base tracking-wider">{b.bookingCode}</span>
                        </td>
                        <td className="py-3.5 px-4 font-bold text-white font-sans">{b.buyerName}</td>
                        <td className="py-3.5 px-4">
                          <div className="flex flex-wrap gap-1">
                            {b.ticketCodes.map(tc => (
                              <span key={tc} className="font-bebas text-xs px-2 py-0.5 bg-[#1b0307] text-amber-300 rounded border border-amber-500/40">
                                {tc}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 font-bold text-emerald-400 text-sm">₹{(b.amountPaid || b.totalAmount).toLocaleString()}</td>
                        <td className="py-3.5 px-4 font-cinzel">
                          <span className="px-2.5 py-0.5 rounded-full bg-[#1e0409] border border-amber-500/40 text-[10px] font-bold text-amber-300">
                            {b.paymentMethod || 'CASH'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ========================================================================= */}
      {/* MODAL: OFFLINE SALE WITH ANCHOR-BASED CONSECUTIVE ALLOCATION               */}
      {/* ========================================================================= */}
      {showSaleModal && (
        <div className="fixed inset-0 z-50 bg-[#070102]/85 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
          <div className="theatre-placard w-full max-w-lg rounded-2xl shadow-2xl p-6 sm:p-7 space-y-5 animate-in fade-in zoom-in-95 duration-200 relative overflow-hidden">
            {/* Corner Brass Brackets */}
            <div className="absolute top-2 left-2 w-3.5 h-3.5 border-t-2 border-l-2 border-amber-500/70 pointer-events-none" />
            <div className="absolute top-2 right-2 w-3.5 h-3.5 border-t-2 border-r-2 border-amber-500/70 pointer-events-none" />
            <div className="absolute bottom-2 left-2 w-3.5 h-3.5 border-b-2 border-l-2 border-amber-500/70 pointer-events-none" />
            <div className="absolute bottom-2 right-2 w-3.5 h-3.5 border-b-2 border-r-2 border-amber-500/70 pointer-events-none" />

            <div className="flex items-center justify-between border-b border-amber-500/30 pb-3">
              <div className="flex items-center gap-3">
                <img src="/hoh-logo.png" alt="HOH" className="w-10 h-10 rounded-full border border-amber-400/80 bg-black object-contain p-0.5 shadow-md" />
                <div>
                  <h3 className="font-bold text-xl text-amber-100 font-bebas tracking-wide flex items-center gap-2">
                    PHYSICAL TICKET SALE REGISTRATION
                  </h3>
                  <p className="text-xs text-amber-200/70 font-cinzel mt-0.5">
                    Anchor Ticket: <span className="font-bebas text-base text-amber-300 tracking-wider ml-1">{saleAnchor}</span>
                  </p>
                </div>
              </div>
              <button onClick={() => setShowSaleModal(false)} className="text-amber-300/70 hover:text-amber-100 p-1 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Customer Full Name */}
              <div>
                <label className="block text-amber-200/80 font-cinzel font-bold mb-1">Customer Full Name *</label>
                <input
                  type="text"
                  placeholder="e.g. Rahul Sharma"
                  value={saleBuyerName}
                  onChange={(e) => setSaleBuyerName(e.target.value)}
                  className="w-full bg-[#0d0103] border border-amber-500/40 rounded-xl px-3.5 py-2.5 text-amber-50 placeholder:text-stone-600 focus:outline-none focus:border-amber-400 text-sm font-medium"
                />
              </div>

              {/* Phone & Email */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-amber-200/80 font-cinzel font-bold mb-1">Phone Number *</label>
                  <input
                    type="tel"
                    placeholder="9876543210"
                    value={salePhone}
                    onChange={(e) => setSalePhone(e.target.value)}
                    className="w-full bg-[#0d0103] border border-amber-500/40 rounded-xl px-3.5 py-2.5 text-amber-50 font-mono placeholder:text-stone-600 focus:outline-none focus:border-amber-400 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-amber-200/80 font-cinzel font-bold mb-1">Email Address (Optional)</label>
                  <input
                    type="email"
                    placeholder="customer@example.com"
                    value={saleEmail}
                    onChange={(e) => setSaleEmail(e.target.value)}
                    className="w-full bg-[#0d0103] border border-amber-500/40 rounded-xl px-3.5 py-2.5 text-amber-50 placeholder:text-stone-600 focus:outline-none focus:border-amber-400 text-sm font-medium"
                  />
                </div>
              </div>

              {/* Number of Tickets / Seats */}
              <div>
                <label className="block text-amber-200/80 font-cinzel font-bold mb-1">
                  Number of Tickets / Seats *
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={saleQuantity}
                    onChange={(e) => handleQuantityChange(parseInt(e.target.value, 10) || 1)}
                    className="w-24 bg-[#0d0103] border border-amber-500/40 rounded-xl px-3 py-2 text-amber-200 font-bebas text-xl font-bold focus:outline-none focus:border-amber-400 text-center"
                  />
                  <div className="flex gap-1.5">
                    {[1, 2, 3, 4, 5].map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => handleQuantityChange(q)}
                        className={`w-9 h-9 rounded-xl border text-xs font-bold transition-all cursor-pointer font-bebas text-base ${
                          saleQuantity === q
                            ? 'bg-gradient-to-r from-amber-500 to-amber-400 text-stone-950 border-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.4)]'
                            : 'bg-[#1b0307] text-amber-200/80 border-amber-500/30 hover:bg-[#2d070f]'
                        }`}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Real-time Allocation Preview Box */}
              <div className="bg-[#0b0103] border border-amber-500/30 rounded-xl p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-amber-200 font-cinzel flex items-center gap-1.5">
                    <TicketIcon className="w-4 h-4 text-amber-400" />
                    Automatic Consecutive Allocation Preview
                  </span>
                  {salePreview.loading && <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />}
                </div>

                {salePreview.success ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {salePreview.proposedCodes.map((code) => (
                        <span
                          key={code}
                          className={`font-bebas text-base px-3 py-1 rounded-lg font-bold border tracking-wider shadow ${
                            code === saleAnchor
                              ? 'bg-gradient-to-r from-amber-500 to-amber-400 text-stone-950 border-amber-300'
                              : 'bg-emerald-950 text-emerald-300 border-emerald-600/50'
                          }`}
                        >
                          ✓ {code} {code === saleAnchor ? '(Anchor)' : ''}
                        </span>
                      ))}
                    </div>
                    <p className="text-[11px] text-emerald-400 font-cinzel">{salePreview.message}</p>
                  </div>
                ) : (
                  <div className="space-y-2 bg-rose-950/30 p-3 rounded-lg border border-rose-800/40">
                    <div className="text-rose-300 font-semibold flex items-center gap-1.5 font-cinzel">
                      <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                      <span>{salePreview.message || 'Consecutive allocation unavailable.'}</span>
                    </div>
                    {salePreview.blockedTicket && (
                      <p className="text-[11px] text-amber-200/80 font-cinzel">
                        Ticket <span className="font-bebas text-sm font-bold text-amber-400">{salePreview.blockedTicket}</span> is already sold or void.
                      </p>
                    )}
                    {/* Admin Override Toggle Button */}
                    <button
                      type="button"
                      onClick={() => handleOverrideToggle(!saleAllowOverride)}
                      className="mt-1 px-3 py-1.5 rounded-lg bg-[#250409] hover:bg-[#380710] text-amber-300 border border-amber-500/40 text-[11px] font-bold font-cinzel cursor-pointer"
                    >
                      {saleAllowOverride ? '✓ NON-CONSECUTIVE OVERRIDE ACTIVE' : 'USE NEXT AVAILABLE TICKETS (OVERRIDE)'}
                    </button>
                  </div>
                )}
              </div>

              {/* Payment Settings */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-amber-200/80 font-cinzel font-bold mb-1">Payment Method</label>
                  <select
                    value={salePaymentMethod}
                    onChange={(e) => setSalePaymentMethod(e.target.value as any)}
                    className="w-full bg-[#0d0103] border border-amber-500/40 rounded-xl px-2.5 py-2 text-amber-100 font-semibold text-xs cursor-pointer"
                  >
                    <option value="CASH">CASH</option>
                    <option value="UPI">UPI</option>
                    <option value="CARD">CARD</option>
                    <option value="OTHER">OTHER</option>
                  </select>
                </div>

                <div>
                  <label className="block text-amber-200/80 font-cinzel font-bold mb-1">Payment Status</label>
                  <select
                    value={salePaymentStatus}
                    onChange={(e) => setSalePaymentStatus(e.target.value as any)}
                    className="w-full bg-[#0d0103] border border-amber-500/40 rounded-xl px-2.5 py-2 text-amber-100 font-semibold text-xs cursor-pointer"
                  >
                    <option value="PAID">PAID</option>
                    <option value="PARTIAL">PARTIAL</option>
                    <option value="PENDING">PENDING</option>
                  </select>
                </div>

                <div>
                  <label className="block text-amber-200/80 font-cinzel font-bold mb-1">Amount Paid (₹)</label>
                  <input
                    type="number"
                    value={saleAmountPaid}
                    onChange={(e) => setSaleAmountPaid(Number(e.target.value))}
                    className="w-full bg-[#0d0103] border border-amber-500/40 rounded-xl px-3 py-2 text-amber-200 font-mono text-sm"
                  />
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-2 border-t border-amber-500/30">
              <button
                type="button"
                onClick={() => setShowSaleModal(false)}
                className="flex-1 py-2.5 rounded-xl bg-[#1e0409] hover:bg-[#2d070f] text-amber-200/80 font-cinzel font-bold text-xs border border-amber-500/30 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmSale}
                disabled={actionLoading === 'confirm-sale' || !salePreview.success}
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 hover:from-amber-400 text-stone-950 font-black font-cinzel text-xs shadow-lg shadow-amber-500/25 transition-all disabled:opacity-50 cursor-pointer"
              >
                {actionLoading === 'confirm-sale' ? 'REGISTERING...' : `CONFIRM SALE (₹${saleAmountPaid})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: TICKET DETAIL                                                      */}
      {/* ========================================================================= */}
      {selectedTicketDetail && (
        <div className="fixed inset-0 z-50 bg-[#070102]/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="theatre-placard w-full max-w-md rounded-2xl shadow-2xl p-6 space-y-4 relative overflow-hidden">
            {/* Corner Brass Brackets */}
            <div className="absolute top-2 left-2 w-3 h-3 border-t-2 border-l-2 border-amber-500/60 pointer-events-none" />
            <div className="absolute top-2 right-2 w-3 h-3 border-t-2 border-r-2 border-amber-500/60 pointer-events-none" />

            <div className="flex items-center justify-between border-b border-amber-500/30 pb-3">
              <div className="flex items-center gap-2">
                <span className="font-bebas text-2xl font-black text-amber-300 drop-shadow">{selectedTicketDetail.code}</span>
                <span className="text-xs text-amber-200/50 font-cinzel">#{selectedTicketDetail.serialNumber}</span>
              </div>
              <button onClick={() => setSelectedTicketDetail(null)} className="text-amber-200/60 hover:text-amber-100 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="bg-[#0b0103] p-4 rounded-xl border border-amber-500/20 space-y-2">
                <div className="flex justify-between">
                  <span className="text-amber-200/60 font-cinzel">Customer:</span>
                  <span className="font-bold text-white font-sans">{selectedTicketDetail.buyerName || 'Unassigned'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-amber-200/60 font-cinzel">Phone:</span>
                  <span className="font-mono text-amber-200/90">{selectedTicketDetail.phone || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-amber-200/60 font-cinzel">Booking:</span>
                  <span className="font-mono text-amber-400 font-bold">{selectedTicketDetail.bookingCode || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-amber-200/60 font-cinzel">Entry State:</span>
                  <span className={`font-bold font-cinzel ${selectedTicketDetail.entered ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {selectedTicketDetail.entered ? 'ENTERED' : 'NOT ENTERED'}
                  </span>
                </div>
              </div>

              {/* Entry Toggle */}
              {selectedTicketDetail.status === 'registered' && (
                <button
                  onClick={() => {
                    handleToggleEntry(selectedTicketDetail.code, selectedTicketDetail.entered);
                    setSelectedTicketDetail(prev => prev ? { ...prev, entered: !prev.entered } : null);
                  }}
                  className={`w-full py-2.5 rounded-xl font-bold font-cinzel text-xs cursor-pointer shadow ${
                    selectedTicketDetail.entered
                      ? 'bg-[#2a0409] text-amber-300 border border-amber-500/40'
                      : 'bg-gradient-to-r from-emerald-600 to-emerald-500 text-slate-950 font-black'
                  }`}
                >
                  {selectedTicketDetail.entered ? 'MARK AS NOT ENTERED' : 'MARK AS ENTERED'}
                </button>
              )}
            </div>

            <div className="pt-2 space-y-2">
              {selectedTicketDetail.status === 'registered' && (
                <button
                  onClick={() => {
                    handleClearTicket(selectedTicketDetail.code);
                  }}
                  className="w-full py-2 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/40 rounded-xl text-xs font-bold font-cinzel cursor-pointer"
                >
                  CLEAR TICKET FROM BOOKING
                </button>
              )}
              <button
                onClick={() => setSelectedTicketDetail(null)}
                className="w-full py-2 bg-[#1b0307] hover:bg-[#2d070f] text-amber-200/80 rounded-xl text-xs font-semibold font-cinzel border border-amber-500/30 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: TICKET CANCELLATION                                                */}
      {/* ========================================================================= */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 bg-[#070102]/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="theatre-placard w-full max-w-sm rounded-2xl shadow-2xl p-6 space-y-4 relative overflow-hidden">
            {/* Corner Brass Brackets */}
            <div className="absolute top-2 left-2 w-3 h-3 border-t-2 border-l-2 border-amber-500/60 pointer-events-none" />
            <div className="absolute top-2 right-2 w-3 h-3 border-t-2 border-r-2 border-amber-500/60 pointer-events-none" />

            <div className="flex items-center justify-between border-b border-amber-500/30 pb-3">
              <h3 className="font-bold text-sm text-white font-cinzel flex items-center gap-2">
                <Ban className="w-4 h-4 text-rose-400" />
                Cancel Ticket ({showCancelModal.code})
              </h3>
              <button onClick={() => setShowCancelModal(null)} className="text-amber-200/60 hover:text-amber-100 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-amber-200/70 font-cinzel">
              Cancelled physical tickets cannot be automatically allocated for offline sales.
            </p>

            <div className="space-y-1.5 text-xs">
              <label className="block text-amber-200/80 font-cinzel font-bold">Reason for Cancellation</label>
              <select
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value as any)}
                className="w-full bg-[#0d0103] border border-amber-500/40 rounded-xl p-2.5 text-amber-100 cursor-pointer"
              >
                <option value="DAMAGED">DAMAGED (Torn / Printed Defect)</option>
                <option value="LOST">LOST (Misplaced Physical Stock)</option>
                <option value="VOID">VOID (Administrative)</option>
                <option value="OTHER">OTHER</option>
              </select>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setShowCancelModal(null)}
                className="flex-1 py-2 bg-[#1b0307] text-amber-200/80 rounded-xl text-xs font-cinzel font-bold border border-amber-500/30 cursor-pointer"
              >
                Back
              </button>
              <button
                onClick={handleConfirmCancelTicket}
                className="flex-1 py-2 bg-gradient-to-r from-rose-700 to-rose-600 hover:from-rose-600 text-white font-bold rounded-xl text-xs shadow-lg shadow-rose-700/20 font-cinzel cursor-pointer"
              >
                Confirm Void
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: EVENT RESET                                                        */}
      {/* ========================================================================= */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 bg-[#070102]/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="theatre-placard border-2 border-rose-600/60 w-full max-w-md rounded-2xl shadow-2xl p-6 sm:p-7 space-y-5 relative overflow-hidden">
            {/* Corner Brass Brackets */}
            <div className="absolute top-2 left-2 w-3.5 h-3.5 border-t-2 border-l-2 border-rose-500 pointer-events-none" />
            <div className="absolute top-2 right-2 w-3.5 h-3.5 border-t-2 border-r-2 border-rose-500 pointer-events-none" />

            <div className="flex items-center gap-3 text-rose-400 border-b border-rose-900/40 pb-3">
              <div className="w-10 h-10 rounded-xl bg-rose-950/80 border border-rose-700/60 flex items-center justify-center">
                <ShieldAlert className="w-6 h-6 text-rose-400" />
              </div>
              <div>
                <h3 className="font-bold text-xl text-amber-100 font-bebas tracking-wide">RESET ENTIRE EVENT</h3>
                <span className="text-xs text-rose-400 font-cinzel">Irreversible Event Cleanup</span>
              </div>
            </div>

            <div className="text-xs text-amber-100/90 space-y-2 bg-rose-950/30 border border-rose-800/40 p-4 rounded-xl font-cinzel">
              <p className="font-bold text-rose-300">This will permanently clear:</p>
              <ul className="list-disc list-inside space-y-1 text-amber-200/70">
                <li>All customer information & bookings</li>
                <li>All ticket assignments (HOH001 to HOH050 reset to available)</li>
                <li>All gate entry records</li>
                <li>Financial revenue & payment logs</li>
              </ul>
              <p className="pt-1 text-emerald-400 font-bold">
                ✓ Exactly 50 physical ticket numbers will remain intact.
                <br />
                ✓ Admin credentials are preserved.
              </p>
            </div>

            <div className="space-y-1.5 pt-1">
              <label className="block text-[11px] text-amber-200/80 font-cinzel font-bold">
                Type <span className="font-mono font-bold text-rose-400">RESET HOH EVENT</span> to confirm:
              </label>
              <input
                type="text"
                value={resetConfirmInput}
                onChange={(e) => setResetConfirmInput(e.target.value)}
                placeholder="RESET HOH EVENT"
                className="w-full bg-[#0d0103] border border-rose-800/60 focus:border-rose-500 rounded-xl px-3.5 py-2.5 text-white font-mono text-xs focus:outline-none"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => {
                  setShowResetModal(false);
                  setResetConfirmInput('');
                }}
                className="flex-1 py-2.5 bg-[#1b0307] hover:bg-[#2d070f] text-amber-200/80 font-cinzel font-bold rounded-xl text-xs border border-amber-500/30 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmEventReset}
                disabled={actionLoading === 'reset-event' || resetConfirmInput !== 'RESET HOH EVENT'}
                className="flex-1 py-2.5 bg-gradient-to-r from-rose-700 to-rose-600 hover:from-rose-600 text-white font-black font-cinzel rounded-xl text-xs shadow-lg shadow-rose-700/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                {actionLoading === 'reset-event' ? 'RESETTING...' : 'YES, RESET EVENT'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ENTERED OVERRIDE WARNING                                           */}
      {/* ========================================================================= */}
      {enteredWarningModal && (
        <div className="fixed inset-0 z-50 bg-[#070102]/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="theatre-placard w-full max-w-md rounded-2xl shadow-2xl p-6 space-y-4 animate-in fade-in zoom-in-95 duration-200 relative overflow-hidden">
            {/* Corner Brass Brackets */}
            <div className="absolute top-2 left-2 w-3 h-3 border-t-2 border-l-2 border-amber-500/60 pointer-events-none" />
            <div className="absolute top-2 right-2 w-3 h-3 border-t-2 border-r-2 border-amber-500/60 pointer-events-none" />

            <div className="flex items-center gap-3 text-amber-400 border-b border-amber-500/30 pb-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0" />
              </div>
              <div>
                <h3 className="font-bold text-lg text-amber-100 font-bebas tracking-wide">ALREADY ENTERED WARNING</h3>
                <span className="text-xs text-amber-400 font-cinzel">Confirmation Required</span>
              </div>
            </div>
            <p className="text-xs text-amber-100/90 leading-relaxed font-cinzel">
              {enteredWarningModal.type === 'ticket' ? (
                <>This ticket (<span className="font-bebas text-base text-amber-300">{enteredWarningModal.code}</span>) has already been marked <strong>ENTERED</strong>. Clearing it will remove its customer assignment and reset its entry status.</>
              ) : (
                <>This booking (<span className="font-bebas text-base text-amber-300">{enteredWarningModal.code}</span>) contains tickets that have already been marked <strong>ENTERED</strong>. Clearing it will remove all ticket assignments and reset entry statuses.</>
              )}
            </p>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setEnteredWarningModal(null)}
                className="flex-1 py-2.5 bg-[#1b0307] hover:bg-[#2d070f] text-amber-200/80 font-cinzel font-bold rounded-xl text-xs border border-amber-500/30 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={enteredWarningModal.action}
                disabled={!!actionLoading}
                className="flex-1 py-2.5 bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 text-stone-950 font-black font-cinzel rounded-xl text-xs shadow-lg shadow-amber-500/20 cursor-pointer"
              >
                {actionLoading ? 'Clearing...' : enteredWarningModal.type === 'ticket' ? 'Yes, Clear Ticket' : 'Yes, Clear Booking'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: SALE SUCCESS CONFIRMATION                                          */}
      {/* ========================================================================= */}
      {saleSuccessData && (
        <div className="fixed inset-0 z-50 bg-[#070102]/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="theatre-placard-glow border-2 border-amber-500/80 w-full max-w-md rounded-2xl shadow-2xl p-6 sm:p-7 space-y-5 animate-in fade-in zoom-in-95 duration-200 relative overflow-hidden">
            {/* Corner Brass Brackets */}
            <div className="absolute top-2 left-2 w-3.5 h-3.5 border-t-2 border-l-2 border-amber-400 pointer-events-none" />
            <div className="absolute top-2 right-2 w-3.5 h-3.5 border-t-2 border-r-2 border-amber-400 pointer-events-none" />
            <div className="absolute bottom-2 left-2 w-3.5 h-3.5 border-b-2 border-l-2 border-amber-400 pointer-events-none" />
            <div className="absolute bottom-2 right-2 w-3.5 h-3.5 border-b-2 border-r-2 border-amber-400 pointer-events-none" />

            <div className="flex items-center gap-3.5 text-amber-400 border-b border-amber-500/30 pb-3">
              <div className="relative flex-shrink-0">
                <div className="absolute inset-0 rounded-full bg-amber-500/30 blur-md" />
                <img 
                  src="/hoh-logo.png" 
                  alt="House of Humour" 
                  className="relative w-12 h-12 rounded-full border-2 border-amber-400 object-contain bg-black p-0.5 shadow-md"
                />
              </div>
              <div>
                <h3 className="font-bold text-2xl text-amber-100 font-bebas tracking-wide">SALE REGISTERED</h3>
                <p className="text-xs text-amber-300 font-cinzel font-bold">Physical tickets issued successfully</p>
              </div>
            </div>

            <div className="bg-[#0b0103] border border-amber-500/30 rounded-xl p-4 space-y-2.5 text-xs font-cinzel">
              <div className="flex justify-between items-center py-1 border-b border-amber-500/10">
                <span className="text-amber-200/60">Booking Code:</span>
                <span className="font-bebas font-bold text-amber-300 text-lg tracking-wider">{saleSuccessData.booking.bookingCode}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-amber-500/10">
                <span className="text-amber-200/60">Customer Name:</span>
                <span className="font-bold text-white font-sans text-sm">{saleSuccessData.booking.buyerName}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-amber-500/10">
                <span className="text-amber-200/60">Phone:</span>
                <span className="font-mono text-amber-200/90">{saleSuccessData.booking.phone}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-amber-500/10">
                <span className="text-amber-200/60">Tickets Allocated:</span>
                <div className="flex flex-wrap gap-1.5 justify-end max-w-[200px]">
                  {saleSuccessData.tickets.map(t => (
                    <span key={t} className="font-bebas text-sm font-bold px-2 py-0.5 bg-emerald-950 text-emerald-300 border border-emerald-600/50 rounded shadow">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-amber-500/10">
                <span className="text-amber-200/60">Total Quantity:</span>
                <span className="font-bold text-white">{saleSuccessData.booking.ticketQuantity} {saleSuccessData.booking.ticketQuantity === 1 ? 'ticket' : 'tickets'}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-amber-500/10">
                <span className="text-amber-200/60">Payment:</span>
                <span className="font-bold text-emerald-400">
                  {saleSuccessData.booking.paymentStatus} ({saleSuccessData.booking.paymentMethod || 'CASH'})
                </span>
              </div>
              <div className="flex justify-between items-center pt-1">
                <span className="text-amber-200/60">Amount Paid:</span>
                <span className="font-bebas font-bold text-amber-300 text-xl tracking-wider">
                  ₹{(saleSuccessData.booking.amountPaid || saleSuccessData.booking.totalAmount || 0).toLocaleString()}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-1 font-cinzel">
              <button
                onClick={() => setSaleSuccessData(null)}
                className="py-2.5 px-3 bg-[#1e0409] hover:bg-[#2d070f] text-amber-200 font-bold rounded-xl text-xs border border-amber-500/30 transition-colors cursor-pointer"
              >
                DONE
              </button>
              <button
                onClick={() => {
                  const b = saleSuccessData.booking;
                  setSaleSuccessData(null);
                  setActiveNav('bookings');
                  setSelectedBookingDetail(b);
                }}
                className="py-2.5 px-3 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-bold rounded-xl text-xs transition-colors cursor-pointer"
              >
                VIEW BOOKING
              </button>
              <button
                onClick={() => {
                  setSaleSuccessData(null);
                  setActiveNav('scan');
                }}
                className="py-2.5 px-3 bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 text-stone-950 font-black rounded-xl text-xs shadow-lg shadow-amber-500/25 transition-colors cursor-pointer"
              >
                NEW SALE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: BOOKING DETAIL                                                     */}
      {/* ========================================================================= */}
      {selectedBookingDetail && (
        <div className="fixed inset-0 z-50 bg-[#070102]/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="theatre-placard w-full max-w-md rounded-2xl shadow-2xl p-6 space-y-4 relative overflow-hidden">
            {/* Corner Brass Brackets */}
            <div className="absolute top-2 left-2 w-3 h-3 border-t-2 border-l-2 border-amber-500/60 pointer-events-none" />
            <div className="absolute top-2 right-2 w-3 h-3 border-t-2 border-r-2 border-amber-500/60 pointer-events-none" />

            <div className="flex items-center justify-between border-b border-amber-500/30 pb-3">
              <div className="flex items-center gap-2">
                <span className="font-bebas text-xl font-black text-amber-300 drop-shadow">{selectedBookingDetail.bookingCode}</span>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#1e0409] text-amber-200/80 font-cinzel font-bold border border-amber-500/30">
                  {selectedBookingDetail.source || 'OFFLINE'}
                </span>
              </div>
              <button onClick={() => setSelectedBookingDetail(null)} className="text-amber-200/60 hover:text-amber-100 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs font-cinzel">
              <div className="bg-[#0b0103] p-4 rounded-xl border border-amber-500/20 space-y-2">
                <div className="flex justify-between">
                  <span className="text-amber-200/60">Customer:</span>
                  <span className="font-bold text-white font-sans text-sm">{selectedBookingDetail.buyerName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-amber-200/60">Phone:</span>
                  <span className="font-mono text-amber-200/90">{selectedBookingDetail.phone}</span>
                </div>
                {selectedBookingDetail.email && (
                  <div className="flex justify-between">
                    <span className="text-amber-200/60">Email:</span>
                    <span className="text-amber-200/80">{selectedBookingDetail.email}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-amber-200/60">Tickets ({selectedBookingDetail.ticketQuantity}):</span>
                  <div className="flex flex-wrap gap-1.5 justify-end max-w-[220px]">
                    {selectedBookingDetail.ticketCodes.map(code => (
                      <span key={code} className="font-bebas text-sm font-bold px-2 py-0.5 bg-[#1b0307] text-amber-300 border border-amber-500/40 rounded">
                        {code}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex justify-between">
                  <span className="text-amber-200/60">Payment:</span>
                  <span className="font-bold text-emerald-400">
                    ₹{(selectedBookingDetail.amountPaid || selectedBookingDetail.totalAmount).toLocaleString()} • {selectedBookingDetail.paymentMethod || 'CASH'} ({selectedBookingDetail.paymentStatus})
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-amber-200/60">Gate Progress:</span>
                  <span className="font-bold text-emerald-400">
                    {selectedBookingDetail.enteredCount || 0} / {selectedBookingDetail.ticketQuantity} Entered
                  </span>
                </div>
                {selectedBookingDetail.notes && (
                  <div className="pt-1 border-t border-amber-500/20 text-amber-200/70 italic">
                    "{selectedBookingDetail.notes}"
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-2 pt-2 font-cinzel">
              <button
                onClick={() => {
                  const b = selectedBookingDetail;
                  setSelectedBookingDetail(null);
                  setEditingBooking(b);
                }}
                className="flex-1 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-bold rounded-xl text-xs cursor-pointer"
              >
                Edit Details
              </button>
              <button
                onClick={() => handleClearBooking(selectedBookingDetail)}
                disabled={actionLoading === `clear-booking-${selectedBookingDetail.bookingCode}`}
                className="flex-1 py-2 bg-rose-950/50 hover:bg-rose-900/60 text-rose-300 border border-rose-800/50 font-bold rounded-xl text-xs cursor-pointer"
              >
                Clear Booking
              </button>
              <button
                onClick={() => setSelectedBookingDetail(null)}
                className="py-2 px-4 bg-[#1b0307] hover:bg-[#2d070f] text-amber-200/80 rounded-xl text-xs font-semibold border border-amber-500/30 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: EDIT BOOKING                                                       */}
      {/* ========================================================================= */}
      {editingBooking && (
        <div className="fixed inset-0 z-50 bg-[#070102]/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="theatre-placard w-full max-w-md rounded-2xl shadow-2xl p-6 space-y-4 relative overflow-hidden">
            {/* Corner Brass Brackets */}
            <div className="absolute top-2 left-2 w-3 h-3 border-t-2 border-l-2 border-amber-500/60 pointer-events-none" />
            <div className="absolute top-2 right-2 w-3 h-3 border-t-2 border-r-2 border-amber-500/60 pointer-events-none" />

            <div className="flex items-center justify-between border-b border-amber-500/30 pb-3">
              <h3 className="font-bold text-lg text-amber-100 font-bebas tracking-wide">Edit Booking {editingBooking.bookingCode}</h3>
              <button onClick={() => setEditingBooking(null)} className="text-amber-200/60 hover:text-amber-100 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-amber-200/80 font-cinzel font-bold mb-1">Customer Name</label>
                <input
                  type="text"
                  value={editingBooking.buyerName}
                  onChange={(e) => setEditingBooking({ ...editingBooking, buyerName: e.target.value })}
                  className="w-full bg-[#0d0103] border border-amber-500/40 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-amber-400 font-sans"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-amber-200/80 font-cinzel font-bold mb-1">Phone</label>
                  <input
                    type="tel"
                    value={editingBooking.phone}
                    onChange={(e) => setEditingBooking({ ...editingBooking, phone: e.target.value })}
                    className="w-full bg-[#0d0103] border border-amber-500/40 rounded-xl px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-amber-400"
                  />
                </div>
                <div>
                  <label className="block text-amber-200/80 font-cinzel font-bold mb-1">Email</label>
                  <input
                    type="email"
                    value={editingBooking.email || ''}
                    onChange={(e) => setEditingBooking({ ...editingBooking, email: e.target.value })}
                    className="w-full bg-[#0d0103] border border-amber-500/40 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-amber-400"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-amber-200/80 font-cinzel font-bold mb-1">Payment Status</label>
                  <select
                    value={editingBooking.paymentStatus}
                    onChange={(e) => setEditingBooking({ ...editingBooking, paymentStatus: e.target.value as any })}
                    className="w-full bg-[#0d0103] border border-amber-500/40 rounded-xl px-2.5 py-2 text-white text-xs cursor-pointer"
                  >
                    <option value="PAID">PAID</option>
                    <option value="PARTIAL">PARTIAL</option>
                    <option value="PENDING">PENDING</option>
                  </select>
                </div>
                <div>
                  <label className="block text-amber-200/80 font-cinzel font-bold mb-1">Payment Method</label>
                  <select
                    value={editingBooking.paymentMethod || 'CASH'}
                    onChange={(e) => setEditingBooking({ ...editingBooking, paymentMethod: e.target.value as any })}
                    className="w-full bg-[#0d0103] border border-amber-500/40 rounded-xl px-2.5 py-2 text-white text-xs cursor-pointer"
                  >
                    <option value="CASH">CASH</option>
                    <option value="UPI">UPI</option>
                    <option value="CARD">CARD</option>
                    <option value="OTHER">OTHER</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-2 font-cinzel">
              <button
                onClick={() => setEditingBooking(null)}
                className="flex-1 py-2 bg-[#1b0307] text-amber-200/80 rounded-xl text-xs font-bold border border-amber-500/30 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setActionLoading('save-booking');
                  try {
                    const res = await apiClient.updateBooking(editingBooking._id, {
                      buyerName: editingBooking.buyerName,
                      phone: editingBooking.phone,
                      email: editingBooking.email,
                      paymentStatus: editingBooking.paymentStatus,
                      paymentMethod: editingBooking.paymentMethod
                    });
                    if (res.success) {
                      showToast('success', 'Booking updated successfully.');
                      setEditingBooking(null);
                      await loadData();
                    } else {
                      showToast('error', res.error?.message || 'Failed to update booking.');
                    }
                  } catch {
                    showToast('error', 'Network error updating booking.');
                  } finally {
                    setActionLoading(null);
                  }
                }}
                disabled={actionLoading === 'save-booking'}
                className="flex-1 py-2 bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 text-stone-950 font-black rounded-xl text-xs shadow cursor-pointer"
              >
                {actionLoading === 'save-booking' ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminConsole;
