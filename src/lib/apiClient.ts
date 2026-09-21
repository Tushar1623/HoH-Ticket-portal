export interface TodaySales {
  ticketsSold: number;
  bookings: number;
  revenue: number;
  cash: number;
  upi: number;
  other: number;
  pending: number;
}

export interface DashboardStats {
  totalTickets: number;
  registered: number;
  available: number;
  entered: number;
  notEntered: number;
  cancelled?: number;
  attendanceRate: number;
  totalBookings?: number;
  totalTicketsSold?: number;
  totalRevenue?: number;
  todaySales?: TodaySales;
}

export interface TicketItem {
  _id: string;
  code: string;
  serialNumber: number;
  status: 'available' | 'registered' | 'cancelled';
  bookingId: string | null;
  buyerName: string | null;
  phone: string | null;
  email: string | null;
  entered: boolean;
  enteredAt: string | null;
  registeredAt?: string | null;
  cancellationReason?: string | null;
  bookingCode?: string;
  paymentStatus?: string;
  totalAmount?: number;
  amountPaid?: number;
  paymentMethod?: string;
  updatedAt: string;
}

export interface BookingItem {
  _id: string;
  bookingCode: string;
  buyerName: string;
  phone: string;
  email: string;
  ticketQuantity: number;
  ticketCodes: string[];
  paymentStatus: 'PAID' | 'PARTIAL' | 'PENDING' | 'Paid' | 'Pending' | 'Cancelled';
  paymentMethod: 'CASH' | 'UPI' | 'CARD' | 'OTHER';
  totalAmount: number;
  amountPaid: number;
  notes: string;
  source: 'OFFLINE' | 'ONLINE';
  enteredCount?: number;
  notEnteredCount?: number;
  tickets?: TicketItem[];
  createdAt: string;
  updatedAt: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    blockedTicket?: string;
  };
  message?: string;
}

const JWT_TOKEN_KEY = 'hoh_admin_token';
const ADMIN_INFO_KEY = 'hoh_admin_info';

/**
 * Resolve the backend base URL at build time.
 * - Production (Vercel): set VITE_API_URL=https://hoh-ticket-portal.onrender.com in Vercel env vars
 * - Local development: falls back to http://localhost:5000 (Vite proxy also handles /api/* → localhost:5000)
 * Never store secrets (MONGODB_URI, JWT_SECRET, ADMIN_PASSWORD) in VITE_* variables.
 */
const API_BASE_URL = (
  import.meta.env.VITE_API_URL ||
  "http://localhost:5000"
).replace(/\/$/, "");

function apiUrl(path: string) {
  return `${API_BASE_URL}${path}`;
}

class ApiClient {
  private token: string | null = null;
  private admin: { username: string; email: string } | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem(JWT_TOKEN_KEY);
      const rawAdmin = localStorage.getItem(ADMIN_INFO_KEY);
      if (rawAdmin) {
        try {
          this.admin = JSON.parse(rawAdmin);
        } catch {
          this.admin = null;
        }
      }
    }
  }

  public getToken(): string | null {
    return this.token;
  }

  public getAdmin(): { username: string; email: string } | null {
    return this.admin;
  }

  public isAuthenticated(): boolean {
    return !!this.token;
  }

  public setSession(token: string, admin: { username: string; email: string }): void {
    this.token = token;
    this.admin = admin;
    if (typeof window !== 'undefined') {
      localStorage.setItem(JWT_TOKEN_KEY, token);
      localStorage.setItem(ADMIN_INFO_KEY, JSON.stringify(admin));
    }
  }

  public logout(): void {
    this.token = null;
    this.admin = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem(JWT_TOKEN_KEY);
      localStorage.removeItem(ADMIN_INFO_KEY);
    }
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  }

  /**
   * Admin Login
   */
  public async login(usernameOrEmail: string, password: string): Promise<ApiResponse<{ token: string; admin: any }>> {
    try {
      const res = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernameOrEmail, password })
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        return {
          success: false,
          error: json.error || { code: 'LOGIN_FAILED', message: 'Invalid username or password.' }
        };
      }

      this.setSession(json.token, json.admin || json.user);

      return {
        success: true,
        data: json
      };
    } catch {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: 'Unable to connect to database or API server.' }
      };
    }
  }

  /**
   * Fetch Live Dashboard Stats directly from MongoDB
   */
  public async fetchDashboard(): Promise<ApiResponse<DashboardStats>> {
    try {
      const res = await fetch(apiUrl('/api/dashboard'), {
        headers: this.getHeaders()
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        if (res.status === 401) this.logout();
        return {
          success: false,
          error: json.error || { code: 'STATS_ERROR', message: 'Failed to fetch stats.' }
        };
      }
      return {
        success: true,
        data: json.data || json.stats || json
      };
    } catch {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: 'Unable to connect to database.' }
      };
    }
  }

  /**
   * Fetch All 50 Tickets directly from MongoDB
   */
  public async fetchTickets(params?: { search?: string; status?: string; entered?: boolean }): Promise<ApiResponse<TicketItem[]>> {
    try {
      const searchParams = new URLSearchParams();
      if (params?.search) searchParams.append('search', params.search);
      if (params?.status) searchParams.append('status', params.status);
      if (params?.entered !== undefined) searchParams.append('entered', String(params.entered));
      const queryString = searchParams.toString();
      const ticketPath = queryString ? `/api/tickets?${queryString}` : '/api/tickets';

      const res = await fetch(apiUrl(ticketPath), {
        headers: this.getHeaders()
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        if (res.status === 401) this.logout();
        return {
          success: false,
          error: json.error || { code: 'FETCH_ERROR', message: 'Failed to fetch tickets from MongoDB.' }
        };
      }

      return {
        success: true,
        data: json.data || json.tickets || []
      };
    } catch {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: 'Unable to connect to database.' }
      };
    }
  }

  /**
   * Single Ticket Lookup (e.g. for QR Scanner)
   */
  public async getTicket(code: string): Promise<ApiResponse<TicketItem>> {
    try {
      const res = await fetch(apiUrl(`/api/tickets/${encodeURIComponent(code)}`), {
        headers: this.getHeaders()
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        return {
          success: false,
          error: json.error || { code: 'LOOKUP_FAILED', message: `Ticket ${code} was not found.` }
        };
      }
      return {
        success: true,
        data: json.data
      };
    } catch {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: 'Unable to connect to database.' }
      };
    }
  }

  /**
   * Manual Entry: Mark Ticket as ENTERED
   */
  public async markEntered(code: string): Promise<ApiResponse<TicketItem>> {
    try {
      const res = await fetch(apiUrl(`/api/tickets/${encodeURIComponent(code)}/entry`), {
        method: 'PUT',
        headers: this.getHeaders()
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        return {
          success: false,
          error: json.error || { code: 'UPDATE_FAILED', message: 'Failed to mark ticket as entered.' }
        };
      }
      return {
        success: true,
        data: json.data,
        message: json.message
      };
    } catch {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: 'Unable to connect to database.' }
      };
    }
  }

  /**
   * Manual Entry Undo: Mark Ticket as NOT ENTERED
   */
  public async markNotEntered(code: string): Promise<ApiResponse<TicketItem>> {
    try {
      const res = await fetch(apiUrl(`/api/tickets/${encodeURIComponent(code)}/not-entry`), {
        method: 'PUT',
        headers: this.getHeaders()
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        return {
          success: false,
          error: json.error || { code: 'UPDATE_FAILED', message: 'Failed to revert ticket entry.' }
        };
      }
      return {
        success: true,
        data: json.data,
        message: json.message
      };
    } catch {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: 'Unable to connect to database.' }
      };
    }
  }

  /**
   * Cancel / Void a Physical Ticket (LOST, DAMAGED, VOID, OTHER)
   */
  public async cancelTicket(code: string, reason: string = 'VOID'): Promise<ApiResponse<TicketItem>> {
    try {
      const res = await fetch(apiUrl(`/api/tickets/${encodeURIComponent(code)}/cancel`), {
        method: 'PUT',
        headers: this.getHeaders(),
        body: JSON.stringify({ reason })
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        return {
          success: false,
          error: json.error || { code: 'CANCEL_FAILED', message: 'Failed to cancel ticket.' }
        };
      }
      return {
        success: true,
        data: json.data,
        message: json.message
      };
    } catch {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: 'Unable to connect to database.' }
      };
    }
  }

  /**
   * Uncancel / Restore a Physical Ticket to AVAILABLE
   */
  public async uncancelTicket(code: string): Promise<ApiResponse<TicketItem>> {
    try {
      const res = await fetch(apiUrl(`/api/tickets/${encodeURIComponent(code)}/uncancel`), {
        method: 'PUT',
        headers: this.getHeaders()
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        return {
          success: false,
          error: json.error || { code: 'UNCANCEL_FAILED', message: 'Failed to uncancel ticket.' }
        };
      }
      return {
        success: true,
        data: json.data,
        message: json.message
      };
    } catch {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: 'Unable to connect to database.' }
      };
    }
  }

  /**
   * Register Ticket(s) / Offline Sale with Anchor-Driven Allocation
   */
  public async registerBooking(params: {
    buyerName: string;
    phone: string;
    email?: string;
    ticketQuantity: number;
    anchorTicket?: string;
    startCode?: string;
    paymentStatus?: string;
    paymentMethod?: string;
    totalAmount?: number;
    amountPaid?: number;
    notes?: string;
    allowNonConsecutive?: boolean;
    allowOverride?: boolean;
    idempotencyKey?: string;
  }): Promise<ApiResponse<{ booking: BookingItem; tickets: string[]; isConsecutive?: boolean }>> {
    try {
      const headers = this.getHeaders();
      if (params.idempotencyKey) {
        headers['Idempotency-Key'] = params.idempotencyKey;
      }

      const res = await fetch(apiUrl('/api/bookings'), {
        method: 'POST',
        headers,
        body: JSON.stringify(params)
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        return {
          success: false,
          error: json.error || { code: 'BOOKING_FAILED', message: 'Registration failed.' }
        };
      }
      return {
        success: true,
        data: json.data,
        message: json.message
      };
    } catch {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: 'Unable to connect to database.' }
      };
    }
  }

  /**
   * Preview physical ticket sale starting from anchor
   */
  public async previewSale(
    anchorCode: string,
    quantity: number,
    allowOverride: boolean = false
  ): Promise<{
    success: boolean;
    anchorTicket: string;
    proposedCodes: string[];
    isConsecutive: boolean;
    blockedTicket?: string;
    skippedTickets?: string[];
    message: string;
    reason?: string;
    availableTotal: number;
  }> {
    try {
      const res = await fetch(apiUrl(`/api/tickets/${encodeURIComponent(anchorCode)}/preview-sale`), {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ quantity, allowOverride })
      });
      return await res.json();
    } catch {
      return {
        success: false,
        anchorTicket: anchorCode,
        proposedCodes: [],
        isConsecutive: false,
        message: 'Unable to calculate ticket allocation (server unavailable).',
        availableTotal: 0
      };
    }
  }

  /**
   * Preview consecutive ticket allocation (general)
   */
  public async previewAllocation(quantity: number, startCode?: string): Promise<{
    success: boolean;
    proposedCodes: string[];
    message: string;
    isConsecutive: boolean;
    availableTotal: number;
    blockedTicket?: string;
  }> {
    try {
      const res = await fetch(apiUrl('/api/bookings/preview'), {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ quantity, startCode })
      });
      return await res.json();
    } catch {
      return {
        success: false,
        proposedCodes: [],
        message: 'Unable to check consecutive allocation (database unavailable).',
        isConsecutive: false,
        availableTotal: 0
      };
    }
  }

  /**
   * Fetch All Bookings
   */
  public async fetchBookings(): Promise<ApiResponse<BookingItem[]>> {
    try {
      const res = await fetch(apiUrl('/api/bookings'), {
        headers: this.getHeaders()
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        return {
          success: false,
          error: json.error || { code: 'FETCH_ERROR', message: 'Failed to fetch bookings.' }
        };
      }
      return {
        success: true,
        data: json.data || json.bookings || []
      };
    } catch {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: 'Unable to connect to database.' }
      };
    }
  }

  /**
   * Fetch Single Booking Detail
   */
  public async getBooking(id: string): Promise<ApiResponse<BookingItem>> {
    try {
      const res = await fetch(apiUrl(`/api/bookings/${encodeURIComponent(id)}`), {
        headers: this.getHeaders()
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        return {
          success: false,
          error: json.error || { code: 'FETCH_ERROR', message: 'Failed to fetch booking details.' }
        };
      }
      return {
        success: true,
        data: json.data
      };
    } catch {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: 'Unable to connect to database.' }
      };
    }
  }

  /**
   * Update Existing Booking Details
   */
  public async updateBooking(id: string, params: Partial<BookingItem>): Promise<ApiResponse<BookingItem>> {
    try {
      const res = await fetch(apiUrl(`/api/bookings/${encodeURIComponent(id)}`), {
        method: 'PUT',
        headers: this.getHeaders(),
        body: JSON.stringify(params)
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        return {
          success: false,
          error: json.error || { code: 'UPDATE_FAILED', message: 'Failed to update booking.' }
        };
      }
      return {
        success: true,
        data: json.data,
        message: json.message
      };
    } catch {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: 'Unable to connect to database.' }
      };
    }
  }

  /**
   * Remove Single Ticket from Booking with reason
   */
  public async removeTicketFromBooking(bookingId: string, code: string, reason: string = 'Removed by admin'): Promise<ApiResponse<BookingItem>> {
    try {
      const res = await fetch(apiUrl(`/api/bookings/${encodeURIComponent(bookingId)}/tickets/${encodeURIComponent(code)}`), {
        method: 'DELETE',
        headers: this.getHeaders(),
        body: JSON.stringify({ reason })
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        return {
          success: false,
          error: json.error || { code: 'REMOVE_FAILED', message: 'Failed to remove ticket.' }
        };
      }
      return {
        success: true,
        data: json.data,
        message: json.message
      };
    } catch {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: 'Unable to connect to database.' }
      };
    }
  }

  /**
   * Edit Single Ticket Buyer Details
   */
  public async updateTicket(code: string, params: {
    buyerName?: string;
    phone?: string;
    email?: string;
    paymentStatus?: string;
    totalAmount?: number;
    notes?: string;
  }): Promise<ApiResponse<TicketItem>> {
    try {
      const res = await fetch(apiUrl(`/api/tickets/${encodeURIComponent(code)}`), {
        method: 'PUT',
        headers: this.getHeaders(),
        body: JSON.stringify(params)
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        return {
          success: false,
          error: json.error || { code: 'UPDATE_FAILED', message: 'Failed to update ticket details.' }
        };
      }
      return {
        success: true,
        data: json.data,
        message: json.message
      };
    } catch {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: 'Unable to connect to database.' }
      };
    }
  }

  /**
   * QR Verification (POST /api/tickets/verify)
   */
  public async verifyTicket(code: string): Promise<{ ok: boolean; ticket?: any; error?: string }> {
    try {
      const res = await fetch(apiUrl('/api/tickets/verify'), {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ code: code.trim().toUpperCase() })
      });
      return await res.json();
    } catch {
      return { ok: false, error: 'Network error connecting to database.' };
    }
  }

  /**
   * Clear Ticket Booking (returns ticket to available pool, never deletes document)
   */
  public async clearTicket(code: string, confirmEntered: boolean = false): Promise<ApiResponse<TicketItem>> {
    try {
      const res = await fetch(apiUrl(`/api/tickets/${encodeURIComponent(code)}/booking`), {
        method: 'DELETE',
        headers: this.getHeaders(),
        body: JSON.stringify({ confirmEntered })
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        return {
          success: false,
          error: json.error || { code: 'CLEAR_FAILED', message: 'Failed to clear ticket.' }
        };
      }
      return {
        success: true,
        data: json.data,
        message: json.message
      };
    } catch {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: 'Unable to connect to database.' }
      };
    }
  }

  /**
   * Clear Entire Booking
   */
  public async clearBooking(bookingCode: string, confirmEntered: boolean = false): Promise<ApiResponse<{ clearedTickets: string[] }>> {
    try {
      const res = await fetch(apiUrl('/api/bookings/clear'), {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ bookingCode, confirmEntered })
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        return {
          success: false,
          error: json.error || { code: 'CLEAR_FAILED', message: 'Failed to clear booking.' }
        };
      }
      return {
        success: true,
        data: json.data,
        message: json.message
      };
    } catch {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: 'Unable to connect to database.' }
      };
    }
  }

  /**
   * Event Reset: Purge bookings, reset all 50 tickets to available, preserve admin
   */
  public async resetEvent(confirmText: string = 'RESET HOH EVENT'): Promise<ApiResponse<{ message: string; backupId?: string }>> {
    try {
      const res = await fetch(apiUrl('/api/event/reset'), {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ confirmText })
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        return {
          success: false,
          error: json.error || { code: 'RESET_FAILED', message: 'Failed to reset event.' }
        };
      }
      return {
        success: true,
        message: json.message,
        data: json
      };
    } catch {
      return {
        success: false,
        error: { code: 'NETWORK_ERROR', message: 'Unable to connect to database.' }
      };
    }
  }

  // Backward compatibility methods for tests / components
  public async adminLogin(usernameOrEmail: string, password: string) {
    return this.login(usernameOrEmail, password);
  }
  public async setEntryStatus(code: string, entered: boolean) {
    return entered ? this.markEntered(code) : this.markNotEntered(code);
  }
  public async createBooking(params: any) {
    return this.registerBooking(params);
  }
  public async clearTicketData(params: { code: string }) {
    return this.clearTicket(params.code);
  }
  public async clearEventData() {
    return this.resetEvent();
  }
}

export const apiClient = new ApiClient();
