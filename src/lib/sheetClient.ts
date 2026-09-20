import { ApiResponse, ConnectionMode, ConfirmResetResult, PrepareResetResult, StaffRole, StaffSession, SummaryCounts, TicketRecord } from '../types/ticket';
import { isValidTicketCode, normalizePaymentStatus, normalizeTicketCode, VALID_TICKET_CODES, validateClearTicket, validateConfirmReset, validateEntryStatusCorrection, validatePrepareReset } from './ticketRules';

const LOCAL_STORAGE_KEY = 'hoh_tickets_db';
const SCRIPT_URL_KEY = 'hoh_apps_script_url';
const STAFF_SESSION_KEY = 'hoh_staff_session';

export const DEFAULT_SCRIPT_URL = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_APPS_SCRIPT_URL) || '';

export const DEFAULT_PASSKEYS: Record<StaffRole, string> = {
  admin: 'hoh-admin-2026',
  manager: 'hoh-mgr-2026',
  sales: 'hoh-sales-2026',
  entry: 'hoh-gate-2026'
};

const hasLocalStorage = (): boolean => {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
};

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

export function getStoredScriptUrl(): string {
  if (!hasLocalStorage()) return DEFAULT_SCRIPT_URL;
  try {
    const stored = window.localStorage.getItem(SCRIPT_URL_KEY);
    if (stored && stored.trim()) {
      return stored.trim();
    }
  } catch (e) {
    console.error('Error reading stored script URL:', e);
  }
  return DEFAULT_SCRIPT_URL;
}

export function setStoredScriptUrl(url: string): void {
  if (!hasLocalStorage()) return;
  try {
    if (url.trim()) {
      window.localStorage.setItem(SCRIPT_URL_KEY, url.trim());
    } else {
      window.localStorage.removeItem(SCRIPT_URL_KEY);
    }
  } catch (e) {
    console.error('Error saving script URL:', e);
  }
}

export function getLocalTickets(): Record<string, TicketRecord> {
  if (!hasLocalStorage()) return createDefaultTickets();
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) {
      const initial = createDefaultTickets();
      saveLocalTickets(initial);
      return initial;
    }
    return JSON.parse(raw);
  } catch (e) {
    console.error('Error reading local cache:', e);
    return createDefaultTickets();
  }
}

export function saveLocalTickets(tickets: Record<string, TicketRecord>): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(tickets));
  } catch (e) {
    console.error('Error saving local cache:', e);
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
    notEntered: Math.max(0, notEntered),
    totalGuests,
    totalRevenue
  };
}

export function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'req_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

export class SheetClient {
  private scriptUrl: string;
  private connectionMode: ConnectionMode = 'connecting';
  private session: StaffSession;

  constructor(customUrl?: string) {
    this.scriptUrl = customUrl !== undefined ? customUrl : getStoredScriptUrl();
    this.session = this.loadStaffSession();
  }

  public getScriptUrl(): string {
    return this.scriptUrl;
  }

  public setScriptUrl(url: string): void {
    this.scriptUrl = url.trim();
    setStoredScriptUrl(this.scriptUrl);
  }

  public getConnectionMode(): ConnectionMode {
    return this.connectionMode;
  }

  public setConnectionMode(mode: ConnectionMode): void {
    this.connectionMode = mode;
  }

  public getStaffSession(): StaffSession {
    return this.session;
  }

  public setStaffSession(session: Partial<StaffSession>): void {
    this.session = {
      ...this.session,
      ...session
    };
    if (hasLocalStorage()) {
      try {
        window.localStorage.setItem(STAFF_SESSION_KEY, JSON.stringify(this.session));
      } catch (e) {}
    }
  }

  private loadStaffSession(): StaffSession {
    if (hasLocalStorage()) {
      try {
        const stored = window.localStorage.getItem(STAFF_SESSION_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed.role && parsed.passkey) return parsed;
        }
      } catch (e) {}
    }
    return {
      role: 'entry',
      identity: 'Gate Staff',
      passkey: DEFAULT_PASSKEYS.entry
    };
  }

  public async testConnection(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    if (!this.scriptUrl) {
      this.connectionMode = 'device';
      return { ok: false, latencyMs: 0, error: 'Google Sheet Apps Script URL is not configured.' };
    }

    const start = performance.now();
    try {
      const pingUrl = `${this.scriptUrl}${this.scriptUrl.includes('?') ? '&' : '?'}action=health&_t=${Date.now()}`;
      const res = await fetch(pingUrl, { method: 'GET' });
      const latencyMs = Math.round(performance.now() - start);

      if (!res.ok) {
        this.connectionMode = 'device';
        return {
          ok: false,
          latencyMs,
          error: `HTTP Error ${res.status}: Could not connect to Google Apps Script.`
        };
      }

      const json = await res.json();
      if (json && json.ok) {
        this.connectionMode = 'connected';
        return { ok: true, latencyMs };
      } else {
        this.connectionMode = 'device';
        return {
          ok: false,
          latencyMs,
          error: String(json?.error || 'Google Sheet returned ok=false')
        };
      }
    } catch (err: unknown) {
      this.connectionMode = 'device';
      const latencyMs = Math.round(performance.now() - start);
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        latencyMs,
        error: `Sync Failed (${errMsg}). Please check internet connectivity and ensure Apps Script is deployed to Anyone.`
      };
    }
  }

  public async fetchTickets(): Promise<ApiResponse<Record<string, TicketRecord>>> {
    if (!this.scriptUrl) {
      const localData = getLocalTickets();
      return { ok: true, data: localData };
    }

    try {
      const url = `${this.scriptUrl}${this.scriptUrl.includes('?') ? '&' : '?'}action=list&role=${this.session.role}&passkey=${encodeURIComponent(this.session.passkey)}&_t=${Date.now()}`;
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        if (json && json.ok && json.data) {
          saveLocalTickets(json.data);
          this.connectionMode = 'connected';
          return { ok: true, data: json.data };
        }
      }
    } catch (err) {
      console.warn('Google Sheet fetch error, reading cached data:', err);
    }

    const localData = getLocalTickets();
    return { ok: true, data: localData };
  }

  public async lookupTicket(code: string): Promise<ApiResponse<TicketRecord>> {
    const normalized = normalizeTicketCode(code);
    if (!isValidTicketCode(normalized)) {
      return { ok: false, error: 'Invalid Ticket. Code outside approved range HOH001-HOH050.' };
    }

    if (!this.scriptUrl) {
      const local = getLocalTickets()[normalized];
      if (!local) return { ok: false, error: 'Ticket not found.' };
      return {
        ok: true,
        data: {
          code: local.code,
          buyerName: local.buyerName,
          phone: '',
          guests: local.guests,
          paymentStatus: local.paymentStatus,
          entered: local.entered,
          enteredAt: local.enteredAt,
          updatedAt: local.updatedAt
        }
      };
    }

    try {
      const res = await fetch(this.scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'lookup',
          code: normalized,
          passkey: this.session.passkey,
          role: this.session.role
        })
      });

      if (!res.ok) {
        return { ok: false, error: `Sync Failed (${res.status}) — could not verify ticket at gate.` };
      }

      const json = await res.json();
      const ticketData = json.ticket || json.data;

      if (json && json.ok && ticketData) {
        return { ok: true, data: ticketData };
      } else {
        return { ok: false, error: json.error || `Ticket ${normalized} not found.` };
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Sync Failed (${errMsg}) — gate lookup failed.` };
    }
  }

  public async upsertBuyer(record: Partial<TicketRecord> & { code: string }): Promise<ApiResponse<TicketRecord>> {
    const normalized = normalizeTicketCode(record.code);
    if (!isValidTicketCode(normalized)) {
      return { ok: false, error: 'Invalid Ticket. Range must be HOH001 to HOH050.' };
    }

    if (!this.scriptUrl) {
      return { ok: false, error: 'Sync Failed — no change was saved. Google Sheet connection is required.' };
    }

    const requestId = generateRequestId();
    const payload = {
      action: 'upsert',
      requestId,
      passkey: this.session.passkey,
      role: this.session.role,
      staffIdentity: this.session.identity,
      record: {
        code: normalized,
        qrPayload: record.qrPayload || normalized,
        buyerName: (record.buyerName || '').trim(),
        phone: String(record.phone || '').trim(),
        email: (record.email || '').trim(),
        guests: Number(record.guests || 1),
        paymentStatus: normalizePaymentStatus(record.paymentStatus),
        amount: Number(record.amount || 0),
        notes: (record.notes || '').trim()
      }
    };

    try {
      const res = await fetch(this.scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        return { ok: false, error: 'Sync Failed — no change was saved.' };
      }

      const json = await res.json();
      const savedTicket = json.ticket || json.data;

      if (json && json.ok && savedTicket) {
        const localData = getLocalTickets();
        localData[normalized] = savedTicket;
        saveLocalTickets(localData);

        return {
          ok: true,
          data: savedTicket,
          message: json.message || 'Record updated successfully.',
          requestId
        };
      } else {
        return {
          ok: false,
          error: json.error || 'Sync Failed — no change was saved.'
        };
      }
    } catch {
      return { ok: false, error: 'Sync Failed — no change was saved.' };
    }
  }

  public async markEntered(code: string, staffIdentity?: string): Promise<ApiResponse<TicketRecord>> {
    const normalized = normalizeTicketCode(code);
    if (!isValidTicketCode(normalized)) {
      return { ok: false, error: 'Invalid Ticket. Code outside approved range HOH001-HOH050.' };
    }

    if (!this.scriptUrl) {
      return { ok: false, error: 'Sync Failed — entry was not recorded. Do not admit until connection is restored.' };
    }

    const requestId = generateRequestId();
    const identity = staffIdentity || this.session.identity || 'Gate Staff';

    try {
      const res = await fetch(this.scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'markEntered',
          requestId,
          code: normalized,
          passkey: this.session.passkey,
          role: this.session.role,
          staffIdentity: identity
        })
      });

      if (!res.ok) {
        return { ok: false, error: 'Sync Failed — entry was not recorded. Do not admit until connection is restored.' };
      }

      const json = await res.json();
      const ticketData = json.ticket || json.data;

      if (json && json.ok && ticketData) {
        const localData = getLocalTickets();
        localData[normalized] = ticketData;
        saveLocalTickets(localData);

        return {
          ok: true,
          data: ticketData,
          message: json.message || 'Admission confirmed! Marked Entered.',
          requestId
        };
      } else {
        return {
          ok: false,
          error: json.error || 'Sync Failed — entry was not recorded. Do not admit until connection is restored.'
        };
      }
    } catch {
      return { ok: false, error: 'Sync Failed — entry was not recorded. Do not admit until connection is restored.' };
    }
  }

  public async requestEntryStatusChange(params: {
    code: string;
    entered: boolean;
    reason: string;
    confirmCode: string;
    ticket?: TicketRecord;
  }): Promise<ApiResponse<TicketRecord>> {
    const val = validateEntryStatusCorrection(params);
    if (!val.valid) {
      return { ok: false, error: val.error };
    }

    const normalized = normalizeTicketCode(params.code);

    if (!this.scriptUrl) {
      return { ok: false, error: 'Sync Failed — no change was saved. Google Sheet connection is required.' };
    }

    const requestId = generateRequestId();

    try {
      const res = await fetch(this.scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'requestEntryStatusChange',
          requestId,
          code: normalized,
          entered: params.entered,
          reason: params.reason.trim(),
          confirmation: params.confirmCode.trim(),
          passkey: this.session.passkey,
          role: this.session.role,
          staffIdentity: this.session.identity
        })
      });

      if (!res.ok) {
        return { ok: false, error: 'Sync Failed — no change was saved.' };
      }

      const json = await res.json();
      const ticketData = json.ticket || json.data;

      if (json && json.ok && ticketData) {
        const localData = getLocalTickets();
        localData[normalized] = ticketData;
        saveLocalTickets(localData);

        return {
          ok: true,
          data: ticketData,
          message: json.message || `Entry status updated to ${params.entered ? 'Entered' : 'Not Entered'}.`,
          requestId
        };
      } else {
        return {
          ok: false,
          error: json.error || 'Sync Failed — no change was saved.'
        };
      }
    } catch {
      return { ok: false, error: 'Sync Failed — no change was saved.' };
    }
  }

  public async clearTicketData(params: {
    code: string;
    reason: string;
    confirmCode: string;
  }): Promise<ApiResponse<TicketRecord>> {
    const val = validateClearTicket(params);
    if (!val.valid) {
      return { ok: false, error: val.error };
    }

    const normalized = normalizeTicketCode(params.code);

    if (!this.scriptUrl) {
      return { ok: false, error: 'Sync Failed — no change was saved. Google Sheet connection is required.' };
    }

    const requestId = generateRequestId();

    try {
      const res = await fetch(this.scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'clearTicketData',
          requestId,
          code: normalized,
          reason: params.reason.trim(),
          confirmation: params.confirmCode.trim(),
          passkey: this.session.passkey,
          role: this.session.role,
          staffIdentity: this.session.identity
        })
      });

      if (!res.ok) {
        return { ok: false, error: 'Sync Failed — no change was saved.' };
      }

      const json = await res.json();
      const ticketData = json.ticket || json.data;

      if (json && json.ok && ticketData) {
        const localData = getLocalTickets();
        localData[normalized] = ticketData;
        saveLocalTickets(localData);

        return {
          ok: true,
          data: ticketData,
          message: json.message || `Ticket ${normalized} data cleared successfully.`,
          requestId
        };
      } else {
        return {
          ok: false,
          error: json.error || 'Sync Failed — no change was saved.'
        };
      }
    } catch {
      return { ok: false, error: 'Sync Failed — no change was saved.' };
    }
  }

  public async prepareEventReset(reason: string): Promise<ApiResponse<PrepareResetResult>> {
    const val = validatePrepareReset(reason);
    if (!val.valid) {
      return { ok: false, error: val.error };
    }

    if (!this.scriptUrl) {
      return { ok: false, error: 'Sync Failed — no change was saved. Google Sheet connection is required.' };
    }

    const requestId = generateRequestId();

    try {
      const res = await fetch(this.scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'prepareEventReset',
          requestId,
          reason: reason.trim(),
          passkey: this.session.passkey,
          role: this.session.role,
          staffIdentity: this.session.identity
        })
      });

      if (!res.ok) {
        return { ok: false, error: 'Sync Failed — no change was saved.' };
      }

      const json = await res.json();
      if (json && json.ok && json.resetToken) {
        return {
          ok: true,
          data: {
            resetToken: json.resetToken,
            expiresInSeconds: json.expiresInSeconds || 300,
            registeredCount: json.registeredCount || 0,
            enteredCount: json.enteredCount || 0
          },
          requestId
        };
      } else {
        return {
          ok: false,
          error: json.error || 'Failed to prepare event reset.'
        };
      }
    } catch {
      return { ok: false, error: 'Sync Failed — no change was saved.' };
    }
  }

  public async confirmEventReset(params: {
    token: string;
    confirmText: string;
  }): Promise<ApiResponse<ConfirmResetResult>> {
    const val = validateConfirmReset(params);
    if (!val.valid) {
      return { ok: false, error: val.error };
    }

    if (!this.scriptUrl) {
      return { ok: false, error: 'Sync Failed — no change was saved. Google Sheet connection is required.' };
    }

    const requestId = generateRequestId();

    try {
      const res = await fetch(this.scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'confirmEventReset',
          requestId,
          resetToken: params.token.trim(),
          confirmation: params.confirmText.trim(),
          passkey: this.session.passkey,
          role: this.session.role,
          staffIdentity: this.session.identity
        })
      });

      if (!res.ok) {
        return { ok: false, error: 'Sync Failed — no change was saved.' };
      }

      const json = await res.json();
      if (json && json.ok) {
        const clean = createDefaultTickets();
        saveLocalTickets(clean);

        return {
          ok: true,
          message: json.message || 'All ticket data reset successfully.',
          data: {
            backupTab: json.backupTab || '',
            clearedRows: 50
          },
          requestId
        };
      } else {
        return {
          ok: false,
          error: json.error || 'Sync Failed — no change was saved.'
        };
      }
    } catch {
      return { ok: false, error: 'Sync Failed — no change was saved.' };
    }
  }

  public resetLocalDatabase(): Record<string, TicketRecord> {
    const clean = createDefaultTickets();
    saveLocalTickets(clean);
    return clean;
  }
}

export const sheetClient = new SheetClient();
