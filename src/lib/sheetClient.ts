import { ApiResponse, ConnectionMode, SummaryCounts, TicketRecord } from '../types/ticket';
import { isValidTicketCode, normalizePaymentStatus, normalizeTicketCode, VALID_TICKET_CODES } from './ticketRules';

const LOCAL_STORAGE_KEY = 'hoh_tickets_db';
const SCRIPT_URL_KEY = 'hoh_apps_script_url';
export const DEFAULT_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz0H1B4qNI_FTEeZoMnQVp8tizk6Ar_5KrWS7Mk-lykd9aEQIhLrJJWBx6dK_Z_F3zB/exec';

/**
 * Creates empty initial 50 tickets HOH001 through HOH050
 */
export function createDefaultTickets(): Record<string, TicketRecord> {
  const map: Record<string, TicketRecord> = {};
  const now = new Date().toISOString();
  
  VALID_TICKET_CODES.forEach(code => {
    map[code] = {
      code,
      qrPayload: code,
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
 * Gets configured Apps Script Web App URL from localStorage or default deployment
 */
export function getStoredScriptUrl(): string {
  try {
    const stored = localStorage.getItem(SCRIPT_URL_KEY);
    if (stored && stored.includes('AKfycbz0H1B4qNI_FTEeZoMnQVp8tizk6Ar_5KrWS7Mk-lykd9aEQIhLrJJWBx6dK_Z_F3zB')) {
      return stored;
    }
    // Clean up broken/outdated deployment URLs if they exist in localStorage
    if (stored && (stored.includes('AKfycbzKc6Z3JTJkIqBxYbck') || stored.includes('AKfycbzjqQu3wSA8sMkYB4oxbByHyLi'))) {
      localStorage.setItem(SCRIPT_URL_KEY, DEFAULT_SCRIPT_URL);
      return DEFAULT_SCRIPT_URL;
    }
    if (stored && stored.trim()) {
      return stored;
    }
  } catch (e) {
    console.error('Error reading stored script URL:', e);
  }
  return DEFAULT_SCRIPT_URL;
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
   * Health check / Connection test (Section 11, 17)
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
        redirect: 'follow'
      });
      const latencyMs = Math.round(performance.now() - start);

      const text = await res.text();
      let json: Record<string, unknown> | null = null;
      try {
        json = JSON.parse(text);
      } catch {
        if (text.includes('accounts.google.com') || text.includes('ServiceLogin') || text.includes('authorization')) {
          return {
            ok: false,
            latencyMs,
            error: 'Authorization Required: The Apps Script needs permission to run. In Google Apps Script, select "initSheet" from the toolbar and click "▶ Run" once to authorize it.'
          };
        }
        return {
          ok: false,
          latencyMs,
          error: `Unexpected response from Google (HTTP ${res.status}): ${text.slice(0, 150)}`
        };
      }

      if (json && json.ok) {
        return { ok: true, latencyMs };
      } else {
        return {
          ok: false,
          latencyMs,
          error: String(json?.error || 'Google Sheet returned ok=false')
        };
      }
    } catch (err: unknown) {
      const latencyMs = Math.round(performance.now() - start);
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        latencyMs,
        error: `Sync Failed (${errMsg}). Please check internet connectivity and ensure "Anyone" access is deployed.`
      };
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
            saveLocalTickets(json.data);
            return { ok: true, data: json.data };
          }
        }
      } catch (err) {
        console.warn('Google Sheet fetch failed, using local store:', err);
      }
    }

    const localData = getLocalTickets();
    return { ok: true, data: localData };
  }

  /**
   * Lookup single ticket by code (Section 11)
   */
  public async lookupTicket(code: string): Promise<ApiResponse<TicketRecord>> {
    const normalized = normalizeTicketCode(code);
    if (!isValidTicketCode(normalized)) {
      return { ok: false, error: 'Invalid Ticket. Code outside approved range HOH001-HOH050.' };
    }

    if (this.scriptUrl) {
      try {
        const res = await fetch(this.scriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'lookup', code: normalized })
        });
        if (res.ok) {
          const json = await res.json();
          const ticketData = json.ticket || json.data;
          if (json && json.ok && ticketData) {
            return { ok: true, data: ticketData };
          } else if (json && json.error) {
            return { ok: false, error: json.error };
          }
        }
      } catch {
        console.warn('Sheet lookup failed, checking local store.');
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
   * Register or update buyer details (Section 6, 7, 8, 9, 10, 11, 12, 18)
   */
  public async upsertBuyer(record: Partial<TicketRecord> & { code: string }): Promise<ApiResponse<TicketRecord>> {
    const normalized = normalizeTicketCode(record.code);
    if (!isValidTicketCode(normalized)) {
      return { ok: false, error: 'Invalid Ticket. Range must be HOH001 to HOH050.' };
    }

    const normalizedPayment = normalizePaymentStatus(record.paymentStatus);
    const now = new Date().toISOString();

    const localData = getLocalTickets();
    const existing = localData[normalized] || {
      code: normalized,
      qrPayload: normalized,
      buyerName: '',
      phone: '',
      guests: 1,
      paymentStatus: 'Pending',
      entered: false,
      updatedAt: now
    };

    const isUpdate = Boolean(existing.buyerName && existing.buyerName.trim() !== '');

    // Data contract object (Section 6)
    const payload = {
      action: 'upsert',
      code: normalized,
      qrPayload: record.qrPayload || normalized,
      buyerName: (record.buyerName || '').trim(),
      phone: String(record.phone || '').trim(),
      email: (record.email || '').trim(),
      guests: Number(record.guests || 1),
      paymentStatus: normalizedPayment,
      amount: Number(record.amount || 0),
      notes: (record.notes || '').trim(),
      updatedBy: record.updatedBy || 'Staff'
    };

    // If connected to Google Sheet
    if (this.scriptUrl) {
      try {
        const res = await fetch(this.scriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          return { ok: false, error: 'Sync Failed. Please check your connection.' };
        }

        const json = await res.json();
        const savedTicket = json.ticket || json.data;

        if (json && json.ok && savedTicket) {
          localData[normalized] = savedTicket;
          saveLocalTickets(localData);
          return {
            ok: true,
            data: savedTicket,
            message: json.message || (isUpdate ? 'Record updated successfully.' : 'Ticket registered successfully.')
          };
        } else {
          return {
            ok: false,
            error: json.error || 'Google Sheet configuration error. Required column is missing.'
          };
        }
      } catch {
        return {
          ok: false,
          error: 'Sync Failed. Please check your connection.'
        };
      }
    }

    // Local Storage fallback when in Device Mode
    const updatedRecord: TicketRecord = {
      ...existing,
      ...record,
      code: normalized,
      qrPayload: payload.qrPayload,
      paymentStatus: normalizedPayment,
      registeredAt: existing.registeredAt || now,
      updatedAt: now,
      updatedBy: payload.updatedBy
    };

    localData[normalized] = updatedRecord;
    saveLocalTickets(localData);

    return {
      ok: true,
      data: updatedRecord,
      message: isUpdate ? 'Record updated successfully (Device Storage).' : 'Ticket registered successfully (Device Storage).'
    };
  }

  /**
   * Mark ticket as Entered (Section 15, 16)
   */
  public async markEntered(code: string, staffRole: string = 'Gate Staff'): Promise<ApiResponse<TicketRecord>> {
    const normalized = normalizeTicketCode(code);
    if (!isValidTicketCode(normalized)) {
      return { ok: false, error: 'Invalid Ticket. Code outside approved range.' };
    }

    const now = new Date().toISOString();

    if (this.scriptUrl) {
      try {
        const res = await fetch(this.scriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'markEntered',
            code: normalized,
            staffId: staffRole
          })
        });

        if (!res.ok) {
          return { ok: false, error: 'Sync Failed. Please check your connection.' };
        }

        const json = await res.json();
        const ticketData = json.ticket || json.data;

        if (json && json.ok && ticketData) {
          const localData = getLocalTickets();
          localData[normalized] = ticketData;
          saveLocalTickets(localData);
          return { ok: true, data: ticketData, message: json.message || 'Admission confirmed! Marked Entered.' };
        } else {
          return { ok: false, error: json.error || 'Failed to mark ticket entered.' };
        }
      } catch {
        return { ok: false, error: 'Sync Failed. Please check your connection.' };
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
        error: `Already Entered at ${existing.enteredAt || 'earlier session'}. Duplicate admission blocked!`
      };
    }

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
   * 1. Manual Entry Status Toggle with mandatory reason
   */
  public async setEntryStatus(
    code: string,
    entered: boolean,
    reason: string = 'Direct manual toggle',
    staffId: string = 'Ticket Register Staff'
  ): Promise<ApiResponse<TicketRecord>> {
    const normalized = normalizeTicketCode(code);
    if (!isValidTicketCode(normalized)) {
      return { ok: false, error: 'Invalid Ticket. Code outside approved range HOH001-HOH050.' };
    }

    const cleanReason = String(reason || 'Direct manual toggle').trim();
    const now = new Date().toISOString();

    if (this.scriptUrl) {
      try {
        const res = await fetch(this.scriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'setEntryStatus',
            code: normalized,
            entered,
            reason: cleanReason,
            staffId
          })
        });

        if (!res.ok) {
          return { ok: false, error: 'Sync Failed. Please check your connection.' };
        }

        const json = await res.json();
        const ticketData = json.ticket || json.data;

        if (json && json.ok && ticketData) {
          const localData = getLocalTickets();
          localData[normalized] = ticketData;
          saveLocalTickets(localData);
          return { ok: true, data: ticketData, message: json.message || `Entry status updated to ${entered ? 'Entered' : 'Not Entered'}.` };
        } else if (json && json.error && (json.error.includes('Invalid or missing action') || json.error.includes('not found') || json.error.includes('action'))) {
          const localData = getLocalTickets();
          const existing = localData[normalized] || {
            code: normalized,
            qrPayload: normalized,
            buyerName: '',
            phone: '',
            guests: 1,
            paymentStatus: 'Pending',
            amount: 0,
            entered: false,
            updatedAt: now
          };
          existing.entered = entered;
          existing.enteredAt = entered ? (existing.enteredAt || now) : '';
          existing.updatedAt = now;
          existing.updatedBy = staffId;
          localData[normalized] = existing;
          saveLocalTickets(localData);
          return {
            ok: true,
            data: existing,
            message: `Status changed to ${entered ? 'Entered' : 'Not Entered'}! (Deploy "New version" in Apps Script to sync with Google Sheets).`
          };
        } else {
          return { ok: false, error: json.error || 'Failed to update entry status.' };
        }
      } catch {
        return { ok: false, error: 'Sync Failed. Please check your connection.' };
      }
    }

    // Local Storage fallback
    const localData = getLocalTickets();
    const existing = localData[normalized];
    if (!existing) {
      return { ok: false, error: `Ticket ${code} not found.` };
    }

    existing.entered = entered;
    existing.enteredAt = entered ? (existing.enteredAt || now) : '';
    existing.updatedAt = now;
    existing.updatedBy = staffId;

    localData[normalized] = existing;
    saveLocalTickets(localData);

    return {
      ok: true,
      data: existing,
      message: `Entry status updated to ${entered ? 'Entered' : 'Not Entered'}.`
    };
  }

  /**
   * 2. Clear One Ticket's Buyer Data
   */
  public async clearTicketData(
    code: string,
    reason: string = 'Manual ticket clear',
    staffId: string = 'Ticket Register Reset'
  ): Promise<ApiResponse<TicketRecord>> {
    const normalized = normalizeTicketCode(code);
    if (!isValidTicketCode(normalized)) {
      return { ok: false, error: 'Invalid Ticket. Code outside approved range HOH001-HOH050.' };
    }

    const now = new Date().toISOString();

    if (this.scriptUrl) {
      try {
        const res = await fetch(this.scriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'clearTicketData',
            code: normalized,
            reason: reason.trim(),
            staffId
          })
        });

        if (!res.ok) {
          return { ok: false, error: 'Sync Failed. Please check your connection.' };
        }

        const json = await res.json();
        const ticketData = json.ticket || json.data;

        if (json && json.ok && ticketData) {
          const localData = getLocalTickets();
          localData[normalized] = ticketData;
          saveLocalTickets(localData);
          return { ok: true, data: ticketData, message: json.message || `Ticket ${code} data cleared successfully.` };
        } else {
          return { ok: false, error: json.error || 'Failed to clear ticket data.' };
        }
      } catch {
        return { ok: false, error: 'Sync Failed. Please check your connection.' };
      }
    }

    // Local Storage fallback
    const localData = getLocalTickets();
    const existing = localData[normalized];
    const cleared: TicketRecord = {
      code: normalized,
      qrPayload: existing?.qrPayload || normalized,
      buyerName: '',
      phone: '',
      email: '',
      guests: 1,
      paymentStatus: 'Pending',
      amount: 0,
      notes: '',
      entered: false,
      enteredAt: '',
      registeredAt: '',
      updatedAt: now,
      updatedBy: staffId
    };

    localData[normalized] = cleared;
    saveLocalTickets(localData);

    return {
      ok: true,
      data: cleared,
      message: `Ticket ${code} data cleared successfully.`
    };
  }

  /**
   * 3. Reset All Ticket Data with Automatic Backup
   */
  public async resetAllTicketData(
    confirmation: string,
    reason: string = 'Full event reset',
    staffId: string = 'Ticket Register Admin'
  ): Promise<ApiResponse<{ backupTab?: string }>> {
    const cleanConfirmation = String(confirmation || '').trim();
    if (cleanConfirmation !== 'RESET HOH EVENT') {
      return { ok: false, error: 'Confirmation mismatch. You must type RESET HOH EVENT.' };
    }

    if (this.scriptUrl) {
      try {
        const res = await fetch(this.scriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'resetAllTicketData',
            confirmation: cleanConfirmation,
            reason: reason.trim(),
            staffId
          })
        });

        if (!res.ok) {
          return { ok: false, error: 'Sync Failed. Please check your connection.' };
        }

        const json = await res.json();
        if (json && json.ok) {
          this.resetLocalDatabase();
          return {
            ok: true,
            message: json.message || 'All ticket data reset successfully.',
            data: { backupTab: json.backupTab }
          };
        } else {
          return { ok: false, error: json.error || 'Failed to reset all tickets.' };
        }
      } catch {
        return { ok: false, error: 'Sync Failed. Please check your connection.' };
      }
    }

    // Local Storage fallback
    this.resetLocalDatabase();
    return {
      ok: true,
      message: 'All ticket data reset successfully in local storage.'
    };
  }

  public resetLocalDatabase(): Record<string, TicketRecord> {
    const clean = createDefaultTickets();
    saveLocalTickets(clean);
    return clean;
  }
}

export const sheetClient = new SheetClient();
