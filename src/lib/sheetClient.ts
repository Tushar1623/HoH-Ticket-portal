import { ApiResponse, ConnectionMode, SummaryCounts, TicketRecord } from '../types/ticket';
import { isValidTicketCode, normalizeTicketCode, VALID_TICKET_CODES } from './ticketRules';

const LOCAL_STORAGE_KEY = 'hoh_tickets_db';
const SCRIPT_URL_KEY = 'hoh_apps_script_url';

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

export function getStoredScriptUrl(): string {
  return localStorage.getItem(SCRIPT_URL_KEY) || '';
}

export function setStoredScriptUrl(url: string): void {
  if (url.trim()) {
    localStorage.setItem(SCRIPT_URL_KEY, url.trim());
  } else {
    localStorage.removeItem(SCRIPT_URL_KEY);
  }
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
  } catch (e) {
    console.error('Error reading local tickets:', e);
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

export class SheetClient {
  private scriptUrl: string;
  private mongoConnected: boolean = false;

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

  public isMongoConnected(): boolean {
    return this.mongoConnected;
  }

  public getConnectionMode(): ConnectionMode {
    if (this.mongoConnected) return 'connected';
    if (this.scriptUrl) return 'connected';
    return 'device';
  }

  /**
   * Health check for MongoDB / Backend / Apps Script
   */
  public async testConnection(url?: string): Promise<{ ok: boolean; latencyMs: number; error?: string; database?: string }> {
    const start = performance.now();

    // 1. Try MongoDB Atlas backend via /api/health
    try {
      const res = await fetch('/api/health');
      const latencyMs = Math.round(performance.now() - start);
      if (res.ok) {
        const json = await res.json();
        if (json && json.ok) {
          this.mongoConnected = true;
          return {
            ok: true,
            latencyMs,
            database: `MongoDB Atlas (${json.cluster} - ${json.dbName})`
          };
        }
      }
    } catch {
      this.mongoConnected = false;
    }

    // 2. Try Apps Script if URL provided
    const targetUrl = url || this.scriptUrl;
    if (targetUrl) {
      try {
        const pingUrl = `${targetUrl}${targetUrl.includes('?') ? '&' : '?'}action=health&_t=${Date.now()}`;
        const res = await fetch(pingUrl);
        const latencyMs = Math.round(performance.now() - start);
        if (res.ok) {
          const json = await res.json();
          if (json && json.ok) {
            return { ok: true, latencyMs, database: 'Google Sheets (Apps Script)' };
          }
        }
      } catch (err) {
        const latencyMs = Math.round(performance.now() - start);
        return { ok: false, latencyMs, error: String(err) };
      }
    }

    return { ok: false, latencyMs: 0, error: 'Connecting to database...' };
  }

  /**
   * Fetch all 50 ticket records
   */
  public async fetchTickets(): Promise<ApiResponse<Record<string, TicketRecord>>> {
    // 1. Try MongoDB Atlas backend
    try {
      const res = await fetch('/api/tickets');
      if (res.ok) {
        const json = await res.json();
        if (json && json.ok && json.data) {
          this.mongoConnected = true;
          saveLocalTickets(json.data); // backup
          return { ok: true, data: json.data };
        }
      }
    } catch {
      this.mongoConnected = false;
    }

    // 2. Try Google Apps Script if configured
    if (this.scriptUrl) {
      try {
        const url = `${this.scriptUrl}${this.scriptUrl.includes('?') ? '&' : '?'}action=list&_t=${Date.now()}`;
        const res = await fetch(url);
        if (res.ok) {
          const json = await res.json();
          if (json && json.ok && json.data) {
            saveLocalTickets(json.data);
            return { ok: true, data: json.data };
          }
        }
      } catch (err) {
        console.warn('Google Sheet fetch failed, falling back to local store:', err);
      }
    }

    // 3. Local Storage fallback
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

    // Try MongoDB backend
    try {
      const res = await fetch(`/api/tickets/${normalized}`);
      if (res.ok) {
        const json = await res.json();
        if (json && json.ok && json.data) {
          return { ok: true, data: json.data };
        }
      }
    } catch {
      // ignore
    }

    const localData = getLocalTickets();
    const ticket = localData[normalized];
    if (ticket) {
      return { ok: true, data: ticket };
    }

    return { ok: false, error: 'Ticket not found' };
  }

  /**
   * Register or update buyer details (Atomic MongoDB upsert)
   */
  public async upsertBuyer(record: Partial<TicketRecord> & { code: string }): Promise<ApiResponse<TicketRecord>> {
    const normalized = normalizeTicketCode(record.code);
    if (!isValidTicketCode(normalized)) {
      return { ok: false, error: `Invalid code ${record.code}. Range is HOH001 to HOH050.` };
    }

    // 1. Send to MongoDB backend
    try {
      const res = await fetch('/api/tickets/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ record: { ...record, code: normalized } })
      });

      if (res.ok) {
        const json = await res.json();
        if (json && json.ok && json.data) {
          this.mongoConnected = true;
          // Update local cache
          const localData = getLocalTickets();
          localData[normalized] = json.data;
          saveLocalTickets(localData);
          return { ok: true, data: json.data, message: `Buyer details saved to MongoDB Atlas (${normalized})!` };
        }
      }
    } catch {
      this.mongoConnected = false;
    }

    // 2. Fallback to Local Storage
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

    localData[normalized] = updatedRecord;
    saveLocalTickets(localData);
    return { ok: true, data: updatedRecord, message: 'Saved to Device Storage.' };
  }

  /**
   * Mark ticket as Entered (Atomic Duplicate Prevention on MongoDB)
   */
  public async markEntered(code: string, staffRole: string = 'Entry Staff'): Promise<ApiResponse<TicketRecord>> {
    const normalized = normalizeTicketCode(code);
    if (!isValidTicketCode(normalized)) {
      return { ok: false, error: 'Invalid ticket code' };
    }

    // 1. Try MongoDB atomic mark-entered
    try {
      const res = await fetch('/api/tickets/mark-entered', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: normalized, staffId: staffRole })
      });

      const json = await res.json();
      if (res.ok && json && json.ok && json.data) {
        this.mongoConnected = true;
        const localData = getLocalTickets();
        localData[normalized] = json.data;
        saveLocalTickets(localData);
        return { ok: true, data: json.data, message: `Admission confirmed! Marked Entered in MongoDB.` };
      } else if (json && json.error) {
        // Specific business error returned by MongoDB (e.g. Already Entered or Not Registered)
        return { ok: false, error: json.error };
      }
    } catch {
      this.mongoConnected = false;
    }

    // 2. Fallback to Local Storage check
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

    const now = new Date().toISOString();
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
   * Reset database
   */
  public async resetDatabase(): Promise<void> {
    try {
      await fetch('/api/tickets/reset', { method: 'POST' });
    } catch {
      // ignore
    }
    this.resetLocalDatabase();
  }

  public resetLocalDatabase(): Record<string, TicketRecord> {
    const clean = createDefaultTickets();
    saveLocalTickets(clean);
    return clean;
  }
}

export const sheetClient = new SheetClient();
