import { ApiResponse, PaymentStatus, StaffRole, StaffSession, SummaryCounts, TicketRecord } from '../types/ticket';
import { VALID_TICKET_CODES, calculateConsecutiveSeats } from './ticketRules';

const LOCAL_STORAGE_KEY = 'hoh_tickets_db';
const STAFF_SESSION_KEY = 'hoh_staff_session';
const JWT_TOKEN_KEY = 'hoh_jwt_token';

export const DEFAULT_PASSKEYS: Record<StaffRole, string> = {
  admin: 'hoh-admin-2025',
  manager: 'hoh-mgr-2025',
  sales: 'hoh-sales-2025',
  entry: 'hoh-door-2025'
};

function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

export function createDefaultTickets(): Record<string, TicketRecord> {
  const map: Record<string, TicketRecord> = {};
  const now = new Date().toISOString();

  VALID_TICKET_CODES.forEach((code, index) => {
    map[code] = {
      code,
      qrPayload: `HOH-TICKET-${String(index + 1).padStart(3, '0')}`,
      serialNumber: index + 1,
      buyerName: '',
      phone: '',
      email: '',
      guests: 1,
      paymentStatus: 'Pending',
      amount: 0,
      notes: '',
      status: 'available',
      entered: false,
      entryCount: 0,
      updatedAt: now
    };
  });

  return map;
}

export function getLocalTickets(): Record<string, TicketRecord> {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) {
      const initial = createDefaultTickets();
      saveLocalTickets(initial);
      return initial;
    }
    return JSON.parse(raw);
  } catch {
    return createDefaultTickets();
  }
}

export function saveLocalTickets(tickets: Record<string, TicketRecord>): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(tickets));
  } catch (e) {
    console.error('Error saving local tickets:', e);
  }
}

export function calculateSummary(tickets: Record<string, TicketRecord>): SummaryCounts {
  const list = Object.values(tickets);
  const total = list.length;
  // A ticket is registered if it has a buyerName or is not 'available'
  const registered = list.filter(t => (t.buyerName && t.buyerName.trim() !== '') || t.status === 'reserved' || t.status === 'entered').length;
  const available = total - registered;
  const entered = list.filter(t => t.entered).length;
  const notEntered = registered - entered;
  const totalGuests = list.reduce((sum, t) => sum + (t.buyerName ? (t.guests || 1) : 0), 0);
  const totalRevenue = list.reduce((sum, t) => {
    if (t.buyerName && t.paymentStatus === 'Paid') {
      return sum + (t.amount || 0);
    }
    return sum;
  }, 0);

  return {
    total,
    registered,
    available,
    entered,
    notEntered: Math.max(0, notEntered),
    totalGuests,
    totalRevenue
  };
}

class ApiClient {
  private session: StaffSession;
  private token: string | null = null;

  constructor() {
    this.session = this.loadSession();
    this.token = typeof window !== 'undefined' ? localStorage.getItem(JWT_TOKEN_KEY) : null;
  }

  private loadSession(): StaffSession {
    try {
      const raw = localStorage.getItem(STAFF_SESSION_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch (e) {
      console.error('Failed to load session:', e);
    }
    return {
      role: 'admin',
      identity: 'Admin Staff',
      passkey: DEFAULT_PASSKEYS.admin
    };
  }

  public getSession(): StaffSession {
    return { ...this.session };
  }

  public setSession(session: StaffSession): void {
    this.session = session;
    try {
      localStorage.setItem(STAFF_SESSION_KEY, JSON.stringify(session));
    } catch (e) {
      console.error('Failed to save session:', e);
    }
  }

  public setToken(token: string | null): void {
    this.token = token;
    if (token) {
      localStorage.setItem(JWT_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(JWT_TOKEN_KEY);
    }
  }

  private getAuthHeaders(includeRequestId = true): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Staff-Passkey': this.session.passkey || ''
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    if (includeRequestId) {
      headers['X-Request-ID'] = generateRequestId();
    }
    return headers;
  }

  /**
   * Fetch all 50 tickets from MongoDB backend
   */
  public async fetchTickets(): Promise<ApiResponse<Record<string, TicketRecord>>> {
    try {
      const res = await fetch('/api/tickets', {
        headers: this.getAuthHeaders(false)
      });
      if (!res.ok) {
        return { ok: false, error: 'Failed to fetch tickets from server.' };
      }
      const json = await res.json();
      if (!json.success || !Array.isArray(json.data)) {
        return { ok: false, error: json.error || 'Invalid ticket data from server.' };
      }

      // Convert array to Record<string, TicketRecord>
      const map: Record<string, TicketRecord> = createDefaultTickets();
      json.data.forEach((t: any) => {
        map[t.code] = {
          code: t.code,
          qrPayload: t.qrPayload || t.code,
          serialNumber: t.serialNumber,
          bookingId: t.bookingId,
          bookingCode: t.bookingCode,
          buyerName: t.buyerName || '',
          phone: t.buyerPhone || t.phone || '',
          email: t.buyerEmail || t.email || '',
          guests: 1,
          paymentStatus: (t.paymentStatus as PaymentStatus) || 'Pending',
          amount: t.totalAmount || 0,
          notes: t.notes || '',
          status: t.status || (t.buyerName ? 'reserved' : 'available'),
          entered: !!t.entered,
          enteredAt: t.enteredAt,
          entryCount: t.entryCount || 0,
          updatedAt: t.updatedAt || new Date().toISOString(),
          updatedBy: t.bookingCreatedBy || 'staff'
        };
      });

      // Save to local cache
      saveLocalTickets(map);

      return {
        ok: true,
        data: map
      };
    } catch (err: any) {
      console.warn('Backend tickets fetch error, using local cache:', err.message);
      return {
        ok: true,
        data: getLocalTickets()
      };
    }
  }

  /**
   * Preview consecutive ticket allocation
   */
  public async previewAllocation(quantity: number, startCode?: string): Promise<{
    success: boolean;
    proposedCodes: string[];
    message: string;
    isConsecutive: boolean;
    availableTotal: number;
  }> {
    try {
      const res = await fetch('/api/bookings/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity, startCode })
      });
      if (res.ok) {
        const text = await res.text();
        if (text && text.trim().startsWith('{')) {
          const json = JSON.parse(text);
          if (json && typeof json.success === 'boolean') {
            return json;
          }
        }
      }
    } catch {
      // Backend not running / proxy error, gracefully fallback to local calculator
    }

    // Rock-solid client calculation from active tickets cache
    const local = getLocalTickets();
    const result = calculateConsecutiveSeats(local, quantity, startCode);
    const availableTotal = Object.values(local).filter(t => !t.buyerName).length;
    return {
      success: result.success,
      proposedCodes: result.proposedCodes,
      message: result.message,
      isConsecutive: result.isConsecutive,
      availableTotal
    };
  }

  /**
   * Create Booking (multi-ticket consecutive allocation)
   */
  public async createBooking(params: {
    buyerName: string;
    phone: string;
    email?: string;
    ticketQuantity: number;
    paymentStatus: PaymentStatus;
    totalAmount: number;
    notes?: string;
    allowNonConsecutive?: boolean;
    startCode?: string;
  }): Promise<ApiResponse<{ booking: any; tickets: any[] }>> {
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(params)
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        return {
          ok: false,
          error: json.error || 'Sync Failed — no ticket change was saved.'
        };
      }

      // Re-fetch tickets from server to keep state strictly synced
      await this.fetchTickets();

      return {
        ok: true,
        data: {
          booking: json.booking,
          tickets: json.tickets
        },
        message: json.message
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Sync Failed — no ticket change was saved. Could not connect to backend server.'
      };
    }
  }

  /**
   * Verify single ticket QR code
   */
  public async verifyTicket(codeOrPayload: string): Promise<ApiResponse<{
    valid: boolean;
    canEnter: boolean;
    ticket: any;
    booking: any;
    statusMessage: string;
  }>> {
    try {
      const isCode = codeOrPayload.toUpperCase().startsWith('HOH') && codeOrPayload.length === 6;
      const body = isCode ? { code: codeOrPayload } : { qrPayload: codeOrPayload };

      const res = await fetch('/api/tickets/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        return {
          ok: false,
          error: json.error || 'Invalid or unregistered ticket QR pass.'
        };
      }

      return {
        ok: true,
        data: json
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Scanner failed to reach server. Check backend connection.'
      };
    }
  }

  /**
   * Mark ticket entered at gate
   */
  public async markEntered(code: string, gateName = 'Main Gate', notes = ''): Promise<ApiResponse<TicketRecord>> {
    try {
      const res = await fetch('/api/tickets/mark-entered', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ code, gateName, notes })
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        return {
          ok: false,
          error: json.error || 'Sync Failed — no change was saved.'
        };
      }

      // Refresh cache from server
      await this.fetchTickets();

      return {
        ok: true,
        data: json.ticket,
        message: json.message
      };
    } catch {
      return {
        ok: false,
        error: 'Sync Failed — no change was saved.'
      };
    }
  }

  /**
   * Correct status (change entered to not entered or vice versa)
   */
  public async correctStatus(params: {
    code: string;
    entered: boolean;
    reason: string;
  }): Promise<ApiResponse<TicketRecord>> {
    try {
      const res = await fetch('/api/tickets/correct-status', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(params)
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        return {
          ok: false,
          error: json.error || 'Sync Failed — no change was saved.'
        };
      }

      await this.fetchTickets();

      return {
        ok: true,
        data: json.ticket,
        message: json.message
      };
    } catch {
      return {
        ok: false,
        error: 'Sync Failed — no change was saved.'
      };
    }
  }

  /**
   * Clear single ticket buyer data
   */
  public async clearTicketData(params: {
    code: string;
    reason: string;
    confirmCode: string;
  }): Promise<ApiResponse<TicketRecord>> {
    if (params.code !== params.confirmCode) {
      return { ok: false, error: 'Confirmation code does not match ticket code.' };
    }

    try {
      const res = await fetch('/api/tickets/clear', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          code: params.code,
          reason: params.reason
        })
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        return {
          ok: false,
          error: json.error || 'Sync Failed — no change was saved.'
        };
      }

      await this.fetchTickets();

      return {
        ok: true,
        data: json.ticket,
        message: json.message
      };
    } catch {
      return {
        ok: false,
        error: 'Sync Failed — no change was saved.'
      };
    }
  }

  /**
   * Clear entire booking (all tickets in the group)
   */
  public async clearBooking(params: {
    bookingCode: string;
    reason: string;
  }): Promise<ApiResponse<{ clearedTickets: string[] }>> {
    try {
      const res = await fetch('/api/bookings/clear', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(params)
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        return {
          ok: false,
          error: json.error || 'Sync Failed — no change was saved.'
        };
      }

      await this.fetchTickets();

      return {
        ok: true,
        data: { clearedTickets: json.clearedTickets },
        message: json.message
      };
    } catch {
      return {
        ok: false,
        error: 'Sync Failed — no change was saved.'
      };
    }
  }

  /**
   * Prepare event reset (Super Admin only - generates 5-minute one-time token)
   */
  public async prepareEventReset(reason: string): Promise<ApiResponse<{
    resetToken: string;
    expiresInSeconds: number;
    registeredCount: number;
    enteredCount: number;
  }>> {
    try {
      const res = await fetch('/api/event/prepare-reset', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ reason })
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        return {
          ok: false,
          error: json.error || 'Failed to prepare event reset.'
        };
      }

      return {
        ok: true,
        data: json
      };
    } catch {
      return {
        ok: false,
        error: 'Sync Failed — no change was saved.'
      };
    }
  }

  /**
   * Confirm full event reset with backup snapshot in eventBackups collection
   */
  public async confirmEventReset(params: {
    token: string;
    confirmText: string;
    reason?: string;
  }): Promise<ApiResponse<{ backupSaved: boolean }>> {
    try {
      const res = await fetch('/api/event/confirm-reset', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          resetToken: params.token,
          confirmation: params.confirmText
        })
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        return {
          ok: false,
          error: json.error || 'Sync Failed — no change was saved.'
        };
      }

      await this.fetchTickets();

      return {
        ok: true,
        data: { backupSaved: true },
        message: json.message
      };
    } catch {
      return {
        ok: false,
        error: 'Sync Failed — no change was saved.'
      };
    }
  }
}

export const apiClient = new ApiClient();
