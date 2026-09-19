import { ApiResponse, ConnectionMode, SummaryCounts, TicketRecord } from '../types/ticket';
import { isValidTicketCode, normalizeTicketCode, VALID_TICKET_CODES } from './ticketRules';

const LOCAL_STORAGE_KEY = 'hoh_tickets_db';
const SCRIPT_URL_KEY = 'hoh_apps_script_url';

/**
 * Creates empty initial 50 tickets HOH001 through HOH050
 */
export function createDefaultTickets(): Record<string, TicketRecord> {
  const map: Record<string, TicketRecord> = {};
  const now = new Date().toISOString();
  
  VALID_TICKET_CODES.forEach(code => {
    map[code] = {
      code,
      buyerName: '',
      phone: '',
      email: '',
      guests: 1,
      paymentStatus: 'Pending',
      amount: 0,
      notes: '',
      entered: false,
      updatedAt: now
    };
  });

  return map;
}

/**
 * Gets configured Apps Script Web App URL from localStorage
 */
export function getStoredScriptUrl(): string {
  return localStorage.getItem(SCRIPT_URL_KEY) || '';
}

/**
 * Saves Apps Script Web App URL to localStorage
 */
export function setStoredScriptUrl(url: string): void {
  if (url.trim()) {
    localStorage.setItem(SCRIPT_URL_KEY, url.trim());
  } else {
    localStorage.removeItem(SCRIPT_URL_KEY);
  }
}

/**
 * Reads local storage ticket database
 */
export function getLocalTickets(): Record<string, TicketRecord> {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) {
      const initial = createDefaultTickets();
      saveLocalTickets(initial);
      return initial;
    }
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (e) {
    console.error('Error reading local tickets:', e);
    return createDefaultTickets();
  }
}

/**
 * Writes tickets to local storage
 */
export function saveLocalTickets(tickets: Record<string, TicketRecord>): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(tickets));
  } catch (e) {
    console.error('Error saving local tickets:', e);
  }
}

/**
 * Calculates summary statistics for all 50 tickets
 */
export function calculateSummary(tickets: Record<string, TicketRecord>): SummaryCounts {
  const list = Object.values(tickets);
  let registered = 0;
  let entered = 0;
  let totalGuests = 0;
  let totalRevenue = 0;

  list.forEach(t => {
    const isReg = Boolean(t.buyerName && t.buyerName.trim() !== '');
    if (isReg) {
      registered++;
      totalGuests += (t.guests || 1);
      if (t.paymentStatus === 'Paid' && t.amount) {
        totalRevenue += Number(t.amount);
      }
    }
    if (t.entered) {
      entered++;
    }
  });

  const total = VALID_TICKET_CODES.length;
  const available = total - registered;
  const notEntered = registered - entered;

  return {
    total,
    registered,
    available,
    entered,
    notEntered,
    totalGuests,
    totalRevenue
  };
}

/**
 * API client to interact with Google Sheet (Apps Script) or Local Storage
 */
export class SheetClient {
  private scriptUrl: string;

  constructor() {
    this.scriptUrl = getStoredScriptUrl();
  }

  public setScriptUrl(url: string) {
    this.scriptUrl = url.trim();
    setStoredScriptUrl(this.scriptUrl);
  }

  public getScriptUrl(): string {
    return this.scriptUrl;
  }

  public getConnectionMode(): ConnectionMode {
    if (!this.scriptUrl) return 'device';
    return 'connected';
  }

  /**
   * Health check / Connection test
   */
  public async testConnection(url?: string): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const targetUrl = url || this.scriptUrl;
    if (!targetUrl) {
      return { ok: false, latencyMs: 0, error: 'No Apps Script URL provided.' };
    }

    const start = performance.now();
    try {
      const pingUrl = `${targetUrl}${targetUrl.includes('?') ? '&' : '?'}action=health&_t=${Date.now()}`;
      const res = await fetch(pingUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });
      const latencyMs = Math.round(performance.now() - start);

      if (!res.ok) {
        return { ok: false, latencyMs, error: `HTTP ${res.status}: ${res.statusText}` };
      }

      const json = await res.json();
      if (json && json.ok) {
        return { ok: true, latencyMs };
      } else {
        return { ok: false, latencyMs, error: json.error || 'Invalid API response format' };
      }
    } catch (err: unknown) {
      const latencyMs = Math.round(performance.now() - start);
      const errMsg = err instanceof Error ? err.message : String(err);
      return { ok: false, latencyMs, error: `Connection failed: ${errMsg}` };
    }
  }

  /**
   * Fetch all 50 ticket records
   */
  public async fetchTickets(): Promise<ApiResponse<Record<string, TicketRecord>>> {
    if (this.scriptUrl) {
      try {
        const url = `${this.scriptUrl}${this.scriptUrl.includes('?') ? '&' : '?'}action=list&_t=${Date.now()}`;
        const res = await fetch(url);
        if (res.ok) {
          const json = await res.json();
          if (json && json.ok && json.data) {
            // Update local backup
            saveLocalTickets(json.data);
            return { ok: true, data: json.data };
          }
        }
      } catch (err) {
        console.warn('Google Sheet fetch failed, falling back to local store:', err);
      }
    }

    // Local Storage fallback
    const localData = getLocalTickets();
    return { ok: true, data: localData };
  }

  /**
   * Lookup single ticket by code
   */
  public async lookupTicket(code: string): Promise<ApiResponse<TicketRecord>> {
    const normalized = normalizeTicketCode(code);
    if (!isValidTicketCode(normalized)) {
      return { ok: false, error: `Invalid ticket code '${normalized}'. Range is HOH001-HOH050.` };
    }

    if (this.scriptUrl) {
      try {
        const res = await fetch(this.scriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // Apps Script preferred
          body: JSON.stringify({ action: 'lookup', code: normalized })
        });
        if (res.ok) {
          const json = await res.json();
          if (json && json.ok && json.data) {
            return { ok: true, data: json.data };
          }
        }
      } catch (err) {
        console.warn('Google Sheet lookup failed, checking local store:', err);
      }
    }

    const localData = getLocalTickets();
    const ticket = localData[normalized];
    if (ticket) {
      return { ok: true, data: ticket };
    }

    return { ok: false, error: 'Ticket not found' };
  }

  /**
   * Register or update buyer details (FR 01 - FR 05)
   */
  public async upsertBuyer(record: Partial<TicketRecord> & { code: string }): Promise<ApiResponse<TicketRecord>> {
    const normalized = normalizeTicketCode(record.code);
    if (!isValidTicketCode(normalized)) {
      return { ok: false, error: `Invalid code ${record.code}. Range is HOH001 to HOH050.` };
    }

    const now = new Date().toISOString();
    const localData = getLocalTickets();
    const existing = localData[normalized] || {
      code: normalized,
      buyerName: '',
      phone: '',
      guests: 1,
      paymentStatus: 'Pending',
      entered: false,
      updatedAt: now
    };

    const updatedRecord: TicketRecord = {
      ...existing,
      ...record,
      code: normalized,
      registeredAt: existing.registeredAt || now,
      updatedAt: now,
      updatedBy: record.updatedBy || 'Staff'
    };

    // If online with Sheet
    if (this.scriptUrl) {
      try {
        const res = await fetch(this.scriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'upsert',
            record: updatedRecord
          })
        });

        if (res.ok) {
          const json = await res.json();
          if (json && json.ok && json.data) {
            localData[normalized] = json.data;
            saveLocalTickets(localData);
            return { ok: true, data: json.data, message: 'Saved to Google Sheet successfully!' };
          } else {
            return { ok: false, error: json.error || 'Failed saving to Sheet' };
          }
        }
      } catch (err: unknown) {
        console.warn('Sheet upsert failed, saving to local device:', err);
      }
    }

    // Save locally
    localData[normalized] = updatedRecord;
    saveLocalTickets(localData);
    return { 
      ok: true, 
      data: updatedRecord, 
      message: this.scriptUrl ? 'Sheet offline. Saved to Device Storage.' : 'Saved to Device Storage.' 
    };
  }

  /**
   * Mark ticket as Entered (FR 10, FR 11, BR 05, BR 06)
   * Prevents duplicate admissions atomically
   */
  public async markEntered(code: string, staffRole: string = 'Entry Staff'): Promise<ApiResponse<TicketRecord>> {
    const normalized = normalizeTicketCode(code);
    if (!isValidTicketCode(normalized)) {
      return { ok: false, error: 'Invalid ticket code' };
    }

    const now = new Date().toISOString();

    // Check remote Google Sheet if connected
    if (this.scriptUrl) {
      try {
        const res = await fetch(this.scriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'markEntered',
            code: normalized,
            staffId: staffRole,
            timestamp: now
          })
        });

        if (res.ok) {
          const json = await res.json();
          if (json && json.ok && json.data) {
            // Update local cache
            const localData = getLocalTickets();
            localData[normalized] = json.data;
            saveLocalTickets(localData);
            return { ok: true, data: json.data, message: 'Ticket marked Entered successfully!' };
          } else {
            // Server error / already entered on sheet
            return { ok: false, error: json.error || 'Failed to mark entered on Sheet' };
          }
        }
      } catch (err) {
        console.warn('Network error marking entered on Sheet, falling back to local:', err);
      }
    }

    // Local Storage atomic check
    const localData = getLocalTickets();
    const existing = localData[normalized];

    if (!existing || !existing.buyerName) {
      return { ok: false, error: 'Cannot mark entered: Ticket has no buyer registered.' };
    }

    if (existing.paymentStatus === 'Cancelled' || existing.paymentStatus === 'Refunded') {
      return { ok: false, error: `Admission denied: Ticket is ${existing.paymentStatus}.` };
    }

    if (existing.entered) {
      return { 
        ok: false, 
        error: `Already Entered at ${existing.enteredAt || 'earlier session'}. Duplicate entry blocked!` 
      };
    }

    // Mark entered
    existing.entered = true;
    existing.enteredAt = now;
    existing.updatedAt = now;
    existing.updatedBy = staffRole;

    localData[normalized] = existing;
    saveLocalTickets(localData);

    return { 
      ok: true, 
      data: existing, 
      message: 'Admission confirmed! Marked Entered.' 
    };
  }

  /**
   * Reset local storage to initial clean 50 tickets
   */
  public resetLocalDatabase(): Record<string, TicketRecord> {
    const clean = createDefaultTickets();
    saveLocalTickets(clean);
    return clean;
  }
}

export const sheetClient = new SheetClient();
