import { ITicket } from '../models/Ticket';
import { IBooking } from '../models/Booking';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname2, '../../data');
const TICKETS_FILE = path.join(DATA_DIR, 'tickets.json');
const BOOKINGS_FILE = path.join(DATA_DIR, 'bookings.json');
const COUNTER_FILE = path.join(DATA_DIR, 'counter.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function readJSON(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch { return fallback; }
}

function writeJSON(filePath, data) {
  try { fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8'); }
  catch (e) { console.warn('[LocalDataStore] Disk write failed:', e); }
}

export interface LocalTicket {
  _id: string; code: string; serialNumber: number; qrPayload: string;
  bookingId: string | null; buyerName: string | null; phone: string | null;
  email: string | null; bookingCode: string | null;
  status: 'available' | 'registered' | 'cancelled';
  entered: boolean; enteredAt: Date | null; entryCount: number;
  cancellationReason?: string | null; version: number;
  createdAt: Date; updatedAt: Date;
}

export interface LocalBooking {
  _id: string; bookingCode: string; buyerName: string; phone: string;
  email?: string; ticketQuantity: number; ticketCodes: string[];
  paymentStatus: 'PAID' | 'PARTIAL' | 'PENDING' | 'CANCELLED';
  paymentMethod: 'CASH' | 'UPI' | 'CARD' | 'OTHER';
  totalAmount: number; amountPaid: number; notes?: string;
  source: 'OFFLINE' | 'ONLINE' | 'ADMIN'; enteredCount: number;
  createdAt: Date; updatedAt: Date;
}

class LocalDataStore {
  private tickets: Map<string, LocalTicket> = new Map();
  private bookings: Map<string, LocalBooking> = new Map();
  private bookingCounter = 1000;
  private backups: any[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.loadFromDisk();
    this.initTickets();
    console.log(`[LocalDataStore] Loaded from disk — ${this.tickets.size} tickets, ${this.bookings.size} bookings`);
  }

  private loadFromDisk(): void {
    const savedTickets = readJSON(TICKETS_FILE, []) as LocalTicket[];
    for (const t of savedTickets) {
      t.createdAt = new Date(t.createdAt);
      t.updatedAt = new Date(t.updatedAt);
      t.enteredAt = t.enteredAt ? new Date(t.enteredAt) : null;
      this.tickets.set(t.code, t);
    }
    const savedBookings = readJSON(BOOKINGS_FILE, []) as LocalBooking[];
    for (const b of savedBookings) {
      b.createdAt = new Date(b.createdAt);
      b.updatedAt = new Date(b.updatedAt);
      this.bookings.set(b._id, b);
    }
    const savedCounter = readJSON(COUNTER_FILE, { counter: 1000 }) as { counter: number };
    this.bookingCounter = savedCounter.counter;
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveToDisk(), 300);
  }

  public saveToDisk(): void {
    writeJSON(TICKETS_FILE, Array.from(this.tickets.values()));
    writeJSON(BOOKINGS_FILE, Array.from(this.bookings.values()));
    writeJSON(COUNTER_FILE, { counter: this.bookingCounter });
  }

  public initTickets(): void {
    const now = new Date();
    let changed = false;
    for (let i = 1; i <= 50; i++) {
      const code = `HOH${String(i).padStart(3, '0')}`;
      if (!this.tickets.has(code)) {
        this.tickets.set(code, {
          _id: `local_ticket_${i}`, code, serialNumber: i, qrPayload: code,
          bookingId: null, buyerName: null, phone: null, email: null,
          bookingCode: null, status: 'available', entered: false,
          enteredAt: null, entryCount: 0, version: 1, createdAt: now, updatedAt: now
        });
        changed = true;
      }
    }
    if (changed) this.scheduleSave();
  }

  public getTickets(filter?: { status?: string; search?: string }): LocalTicket[] {
    this.initTickets();
    let list = Array.from(this.tickets.values()).sort((a, b) => a.serialNumber - b.serialNumber);
    if (filter?.status && filter.status !== 'all') {
      if (filter.status === 'available') list = list.filter(t => t.status === 'available' && !t.buyerName);
      else if (filter.status === 'registered') list = list.filter(t => t.status === 'registered' || !!t.buyerName);
      else if (filter.status === 'entered') list = list.filter(t => t.entered);
      else if (filter.status === 'not-entered') list = list.filter(t => (t.status === 'registered' || !!t.buyerName) && !t.entered);
      else if (filter.status === 'cancelled') list = list.filter(t => t.status === 'cancelled');
    }
    if (filter?.search) {
      const term = filter.search.toLowerCase().trim();
      list = list.filter(t =>
        t.code.toLowerCase().includes(term) ||
        (t.buyerName || '').toLowerCase().includes(term) ||
        (t.phone || '').toLowerCase().includes(term) ||
        (t.bookingCode || '').toLowerCase().includes(term)
      );
    }
    return list;
  }

  public getTicketByCode(code: string): LocalTicket | null {
    this.initTickets();
    return this.tickets.get(code.toUpperCase().trim()) || null;
  }

  public markEntry(code: string): { success: boolean; ticket?: LocalTicket; message?: string } {
    const t = this.getTicketByCode(code);
    if (!t) return { success: false, message: `Ticket ${code} not found.` };
    if (t.status === 'cancelled') return { success: false, message: `Ticket ${code} is cancelled.` };
    const wasEntered = t.entered;
    t.entered = true; t.enteredAt = new Date();
    t.entryCount = (t.entryCount || 0) + 1; t.updatedAt = new Date();
    if (t.bookingId) {
      const b = this.bookings.get(t.bookingId) || Array.from(this.bookings.values()).find(x => x.bookingCode === t.bookingCode);
      if (b && !wasEntered) { b.enteredCount = (b.enteredCount || 0) + 1; b.updatedAt = new Date(); }
    }
    this.scheduleSave();
    return { success: true, ticket: t };
  }

  public markNotEntered(code: string): { success: boolean; ticket?: LocalTicket; message?: string } {
    const t = this.getTicketByCode(code);
    if (!t) return { success: false, message: `Ticket ${code} not found.` };
    const wasEntered = t.entered;
    t.entered = false; t.enteredAt = null; t.updatedAt = new Date();
    if (t.bookingId && wasEntered) {
      const b = this.bookings.get(t.bookingId) || Array.from(this.bookings.values()).find(x => x.bookingCode === t.bookingCode);
      if (b) { b.enteredCount = Math.max(0, (b.enteredCount || 0) - 1); b.updatedAt = new Date(); }
    }
    this.scheduleSave();
    return { success: true, ticket: t };
  }

  public cancelTicket(code: string, reason?: string): { success: boolean; ticket?: LocalTicket; message?: string } {
    const t = this.getTicketByCode(code);
    if (!t) return { success: false, message: `Ticket ${code} not found.` };
    if (t.status === 'registered' || t.buyerName)
      return { success: false, message: `Cannot cancel registered ticket ${code}. Clear booking first.` };
    t.status = 'cancelled'; t.cancellationReason = reason || 'DAMAGED'; t.updatedAt = new Date();
    this.scheduleSave();
    return { success: true, ticket: t };
  }

  public uncancelTicket(code: string): { success: boolean; ticket?: LocalTicket; message?: string } {
    const t = this.getTicketByCode(code);
    if (!t) return { success: false, message: `Ticket ${code} not found.` };
    t.status = 'available'; t.cancellationReason = null; t.updatedAt = new Date();
    this.scheduleSave();
    return { success: true, ticket: t };
  }

  public clearTicket(code: string): { success: boolean; ticket?: LocalTicket; message?: string } {
    const t = this.getTicketByCode(code);
    if (!t) return { success: false, message: `Ticket ${code} not found.` };
    const oldBookingCode = t.bookingCode;
    t.buyerName = null; t.phone = null; t.email = null;
    t.bookingId = null; t.bookingCode = null; t.status = 'available';
    t.entered = false; t.enteredAt = null; t.entryCount = 0;
    t.version = (t.version || 1) + 1; t.updatedAt = new Date();
    if (oldBookingCode) {
      const b = Array.from(this.bookings.values()).find(x => x.bookingCode === oldBookingCode);
      if (b) { b.ticketCodes = b.ticketCodes.filter(c => c !== t.code); b.ticketQuantity = b.ticketCodes.length; b.updatedAt = new Date(); }
    }
    this.scheduleSave();
    return { success: true, ticket: t };
  }

  public updateTicket(code: string, updates: { buyerName?: string; phone?: string; email?: string; paymentStatus?: string; totalAmount?: number; notes?: string }): { success: boolean; ticket?: LocalTicket; message?: string } {
    const t = this.getTicketByCode(code);
    if (!t) return { success: false, message: `Ticket ${code} not found.` };
    if (updates.buyerName !== undefined) t.buyerName = updates.buyerName.trim() || null;
    if (updates.phone !== undefined) t.phone = updates.phone.trim() || null;
    if (updates.email !== undefined) t.email = updates.email?.trim() || null;
    t.updatedAt = new Date();
    if (t.bookingCode) {
      const b = Array.from(this.bookings.values()).find(x => x.bookingCode === t.bookingCode);
      if (b) {
        if (updates.buyerName !== undefined) b.buyerName = updates.buyerName.trim();
        if (updates.phone !== undefined) b.phone = updates.phone.trim();
        if (updates.email !== undefined) b.email = updates.email?.trim();
        b.updatedAt = new Date();
      }
    }
    this.scheduleSave();
    return { success: true, ticket: t };
  }

  public createBooking(data: { buyerName: string; phone: string; email?: string; ticketQuantity: number; ticketCodes: string[]; paymentStatus?: 'PAID' | 'PARTIAL' | 'PENDING'; paymentMethod?: 'CASH' | 'UPI' | 'CARD' | 'OTHER'; totalAmount?: number; amountPaid?: number; notes?: string }): { success: boolean; booking?: LocalBooking; tickets?: LocalTicket[]; error?: string } {
    this.initTickets();
    const codes = data.ticketCodes.map(c => c.toUpperCase().trim());
    for (const code of codes) {
      const t = this.tickets.get(code);
      if (!t) return { success: false, error: `Ticket ${code} does not exist.` };
      if (t.status === 'cancelled') return { success: false, error: `Ticket ${code} is void/cancelled.` };
      if (t.status === 'registered' || t.buyerName) return { success: false, error: `Ticket ${code} is already registered.` };
    }
    this.bookingCounter++;
    const bookingCode = `BKG-${this.bookingCounter}`;
    const bookingId = `local_bkg_${this.bookingCounter}`;
    const now = new Date();
    const qty = data.ticketQuantity || codes.length;
    const amount = data.totalAmount ?? data.amountPaid ?? qty * 500;
    const paid = data.amountPaid ?? amount;
    const booking: LocalBooking = {
      _id: bookingId, bookingCode, buyerName: data.buyerName.trim(), phone: data.phone.trim(),
      email: data.email?.trim() || undefined, ticketQuantity: qty, ticketCodes: codes,
      paymentStatus: data.paymentStatus || 'PAID', paymentMethod: data.paymentMethod || 'CASH',
      totalAmount: amount, amountPaid: paid, notes: data.notes?.trim(),
      source: 'OFFLINE', enteredCount: 0, createdAt: now, updatedAt: now
    };
    this.bookings.set(bookingId, booking);
    const updatedTickets: LocalTicket[] = [];
    for (const code of codes) {
      const t = this.tickets.get(code)!;
      t.status = 'registered'; t.buyerName = booking.buyerName; t.phone = booking.phone;
      t.email = booking.email || null; t.bookingId = bookingId; t.bookingCode = bookingCode;
      t.version = (t.version || 1) + 1; t.updatedAt = now;
      updatedTickets.push(t);
    }
    this.scheduleSave();
    return { success: true, booking, tickets: updatedTickets };
  }

  public listBookings(): LocalBooking[] {
    return Array.from(this.bookings.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  public getBookingById(id: string): LocalBooking | null {
    return this.bookings.get(id) || Array.from(this.bookings.values()).find(b => b.bookingCode === id) || null;
  }

  public updateBooking(id: string, updates: Partial<LocalBooking>): { success: boolean; booking?: LocalBooking; error?: string } {
    const b = this.getBookingById(id);
    if (!b) return { success: false, error: 'Booking not found.' };
    if (updates.buyerName) b.buyerName = updates.buyerName.trim();
    if (updates.phone) b.phone = updates.phone.trim();
    if (updates.email !== undefined) b.email = updates.email?.trim();
    if (updates.paymentStatus) b.paymentStatus = updates.paymentStatus;
    if (updates.paymentMethod) b.paymentMethod = updates.paymentMethod;
    if (updates.totalAmount !== undefined) b.totalAmount = updates.totalAmount;
    if (updates.amountPaid !== undefined) b.amountPaid = updates.amountPaid;
    if (updates.notes !== undefined) b.notes = updates.notes?.trim();
    b.updatedAt = new Date();
    for (const tc of b.ticketCodes) {
      const t = this.tickets.get(tc);
      if (t) { t.buyerName = b.buyerName; t.phone = b.phone; t.email = b.email || null; t.updatedAt = new Date(); }
    }
    this.scheduleSave();
    return { success: true, booking: b };
  }

  public clearBooking(idOrCode: string): { success: boolean; message?: string; error?: string } {
    const b = this.getBookingById(idOrCode);
    if (!b) return { success: false, error: 'Booking not found.' };
    for (const tc of b.ticketCodes) {
      const t = this.tickets.get(tc);
      if (t) {
        t.status = 'available'; t.buyerName = null; t.phone = null; t.email = null;
        t.bookingId = null; t.bookingCode = null; t.entered = false;
        t.enteredAt = null; t.entryCount = 0; t.updatedAt = new Date();
      }
    }
    this.bookings.delete(b._id);
    this.scheduleSave();
    return { success: true, message: `Booking ${b.bookingCode} cleared and tickets released.` };
  }

  public resetEvent(reason?: string): { success: boolean; backupId: string; message: string } {
    this.initTickets();
    const backupId = `backup_${Date.now()}`;
    this.backups.push({
      _id: backupId, reason: reason || 'Admin Event Reset',
      tickets: Array.from(this.tickets.values()).map(t => ({ ...t })),
      bookings: Array.from(this.bookings.values()).map(b => ({ ...b })),
      createdAt: new Date()
    });
    this.tickets.clear(); this.bookings.clear(); this.bookingCounter = 1000;
    this.initTickets(); this.saveToDisk();
    return { success: true, backupId, message: 'All 50 tickets reset to available.' };
  }

  public getDashboardStats(): any {
    this.initTickets();
    const all = Array.from(this.tickets.values());
    const totalTickets = 50;
    const entered = all.filter(t => t.entered).length;
    const cancelled = all.filter(t => t.status === 'cancelled').length;
    const registered = all.filter(t => t.status === 'registered' || !!t.buyerName).length;
    const available = Math.max(0, totalTickets - registered - cancelled);
    const notEntered = Math.max(0, registered - entered);
    const attendanceRate = registered > 0 ? Math.round((entered / registered) * 100) : 0;
    const bList = Array.from(this.bookings.values());
    const totalBookings = bList.length;
    const totalTicketsSold = bList.reduce((sum, b) => sum + (b.ticketQuantity || 0), 0);
    const totalRevenue = bList.reduce((sum, b) => sum + (b.amountPaid || b.totalAmount || 0), 0);
    const todayCash = bList.filter(b => b.paymentMethod === 'CASH').reduce((sum, b) => sum + (b.amountPaid || b.totalAmount || 0), 0);
    const todayUpi = bList.filter(b => b.paymentMethod === 'UPI').reduce((sum, b) => sum + (b.amountPaid || b.totalAmount || 0), 0);
    const todayOther = bList.filter(b => b.paymentMethod !== 'CASH' && b.paymentMethod !== 'UPI').reduce((sum, b) => sum + (b.amountPaid || b.totalAmount || 0), 0);
    return {
      success: true,
      stats: { totalTickets, available, registered, entered, notEntered, cancelled, attendanceRate, totalBookings, totalTicketsSold: totalTicketsSold || registered, totalRevenue, todaySales: { bookings: bList.length, revenue: totalRevenue, cash: todayCash, upi: todayUpi, other: todayOther, pending: 0 } },
      system: { database: 'local_persistent', isLive: true, totalConfiguredSeats: 50, currency: 'INR' }
    };
  }
}

export const localDataStore = new LocalDataStore();
