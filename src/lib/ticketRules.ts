import { PaymentStatus, TicketRecord, TicketStatus } from '../types/ticket';

export const TOTAL_TICKETS = 50;
export const TICKET_PREFIX = 'HOH';

/**
 * Generate all 50 valid ticket codes: HOH001 to HOH050
 */
export const VALID_TICKET_CODES: string[] = Array.from({ length: TOTAL_TICKETS }, (_, i) => {
  const num = (i + 1).toString().padStart(3, '0');
  return `${TICKET_PREFIX}${num}`;
});

/**
 * Normalizes input string (e.g. "  hoh017  " -> "HOH017")
 */
export function normalizeTicketCode(input: string | null | undefined): string {
  if (!input) return '';
  return input.trim().toUpperCase();
}

/**
 * Validates if the normalized code is within approved range HOH001-HOH050
 */
export function isValidTicketCode(code: string): boolean {
  const normalized = normalizeTicketCode(code);
  return VALID_TICKET_CODES.includes(normalized);
}

/**
 * Evaluates the status of a ticket record and code
 */
export function evaluateTicketStatus(ticket: TicketRecord | undefined, inputCode: string): TicketStatus {
  const normalizedCode = normalizeTicketCode(inputCode);
  
  if (!isValidTicketCode(normalizedCode)) {
    return 'INVALID';
  }

  if (!ticket || !ticket.buyerName || ticket.buyerName.trim() === '') {
    return 'NOT_REGISTERED';
  }

  if (ticket.paymentStatus === 'Cancelled' || ticket.paymentStatus === 'Refunded') {
    return 'CANCELLED';
  }

  if (ticket.entered) {
    return 'ALREADY_ENTERED';
  }

  return 'VALID';
}

/**
 * Formats ISO timestamp to human-friendly local time (e.g., "19 Sep, 02:45 PM")
 */
export function formatLocalTimestamp(isoString?: string): string {
  if (!isoString) return '—';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    return new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    }).format(date);
  } catch {
    return isoString;
  }
}

/**
 * Formats currency amount in Indian Rupees (INR)
 */
export function formatCurrency(amount?: number): string {
  if (amount === undefined || amount === null || isNaN(amount)) return '₹0';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(amount);
}

/**
 * Validates buyer registration inputs
 */
export function validateBuyerForm(data: {
  code: string;
  buyerName: string;
  phone: string;
  guests: number;
  paymentStatus: PaymentStatus;
}): { valid: boolean; error?: string } {
  if (!isValidTicketCode(data.code)) {
    return { valid: false, error: 'Invalid ticket code. Must be HOH001 to HOH050.' };
  }

  if (!data.buyerName || data.buyerName.trim().length < 2) {
    return { valid: false, error: 'Buyer name is required (minimum 2 characters).' };
  }

  if (!data.phone || data.phone.trim().length < 7) {
    return { valid: false, error: 'Valid phone number is required.' };
  }

  if (!Number.isInteger(data.guests) || data.guests < 1 || data.guests > 10) {
    return { valid: false, error: 'Guest count must be an integer between 1 and 10.' };
  }

  return { valid: true };
}

/**
 * Normalizes payment status string to standard enum values (PRD Section 7)
 */
export function normalizePaymentStatus(input: string | null | undefined): PaymentStatus {
  if (!input) return 'Pending';
  const clean = input.trim().toLowerCase();
  if (clean.includes('paid')) return 'Paid';
  if (clean.includes('comp')) return 'Complimentary';
  if (clean.includes('refund')) return 'Refunded';
  if (clean.includes('cancel')) return 'Cancelled';
  return 'Pending';
}

/**
 * Server-aligned Role-Based Access Control (RBAC) permission helpers
 */
export function canLookupOrScan(role: string): boolean {
  return ['entry', 'manager', 'admin'].includes(role);
}

export function canMarkEntered(role: string): boolean {
  return ['entry', 'manager', 'admin'].includes(role);
}

export function canEditBuyer(role: string): boolean {
  return ['sales', 'manager', 'admin'].includes(role);
}

export function canRequestCorrection(role: string): boolean {
  return ['manager', 'admin'].includes(role);
}

export function canClearTicket(role: string): boolean {
  return ['manager', 'admin'].includes(role);
}

export function canExportData(role: string): boolean {
  return ['manager', 'admin'].includes(role);
}

export function canResetEvent(role: string): boolean {
  return role === 'admin';
}

export function canAccessSheetSetup(role: string): boolean {
  return ['manager', 'admin'].includes(role);
}

/**
 * Validates Request Entry Status Correction (Safe Action A)
 */
export function validateEntryStatusCorrection(params: {
  code: string;
  entered: boolean;
  reason: string;
  confirmCode: string;
  ticket?: TicketRecord;
}): { valid: boolean; error?: string } {
  const normalized = normalizeTicketCode(params.code);
  if (!isValidTicketCode(normalized)) {
    return { valid: false, error: 'Invalid Ticket. Range must be HOH001 to HOH050.' };
  }

  if (params.confirmCode.trim() !== normalized) {
    return { valid: false, error: `Confirmation mismatch. You must type exact ticket code ${normalized}.` };
  }

  const cleanReason = (params.reason || '').trim();
  if (cleanReason.length < 10) {
    return { valid: false, error: 'A detailed reason is required (minimum 10 characters).' };
  }

  // If attempting to mark entered=true
  if (params.entered === true && params.ticket) {
    if (!params.ticket.buyerName || params.ticket.buyerName.trim() === '') {
      return { valid: false, error: 'Cannot mark Entered: Ticket has no registered buyer.' };
    }
    if (params.ticket.paymentStatus === 'Cancelled' || params.ticket.paymentStatus === 'Refunded') {
      return { valid: false, error: `Cannot mark Entered: Ticket is ${params.ticket.paymentStatus}.` };
    }
    if (params.ticket.entered) {
      return { valid: false, error: 'Ticket is already marked as Entered.' };
    }
  }

  return { valid: true };
}

/**
 * Validates Clear Ticket Data (Safe Action B)
 */
export function validateClearTicket(params: {
  code: string;
  reason: string;
  confirmCode: string;
}): { valid: boolean; error?: string } {
  const normalized = normalizeTicketCode(params.code);
  if (!isValidTicketCode(normalized)) {
    return { valid: false, error: 'Invalid Ticket. Range must be HOH001 to HOH050.' };
  }

  if (params.confirmCode.trim() !== normalized) {
    return { valid: false, error: `Confirmation mismatch. You must type exact ticket code ${normalized}.` };
  }

  const cleanReason = (params.reason || '').trim();
  if (cleanReason.length < 10) {
    return { valid: false, error: 'A detailed reason is required (minimum 10 characters).' };
  }

  return { valid: true };
}

/**
 * Validates Reset Event Preparation (Safe Action C Step 1)
 */
export function validatePrepareReset(reason: string): { valid: boolean; error?: string } {
  const cleanReason = (reason || '').trim();
  if (cleanReason.length < 20) {
    return { valid: false, error: 'Event reset reason is required and must be at least 20 characters.' };
  }
  return { valid: true };
}

/**
 * Validates Reset Event Confirmation (Safe Action C Step 2)
 */
export function validateConfirmReset(params: {
  token: string;
  confirmText: string;
}): { valid: boolean; error?: string } {
  if (!params.token || params.token.trim().length === 0) {
    return { valid: false, error: 'Missing or expired one-time reset token. Please prepare reset again.' };
  }
  if (params.confirmText.trim() !== 'RESET HOH EVENT') {
    return { valid: false, error: 'Confirmation mismatch. You must type exact text: RESET HOH EVENT' };
  }
  return { valid: true };
}

export interface ConsecutiveSeatsResult {
  success: boolean;
  proposedCodes: string[];
  isConsecutive: boolean;
  message: string;
  availableTotal: number;
}

/**
 * Automatically calculates and selects consecutive seats.
 * If someone books 2 or more seats, this automatically adds the next tickets (e.g. HOH002, HOH003)
 * starting from the preferred ticket code, or slides to the next available consecutive block.
 */
export function calculateConsecutiveSeats(
  tickets: Record<string, TicketRecord>,
  quantity: number,
  preferredStartCode?: string,
  allowNonConsecutive = false
): ConsecutiveSeatsResult {
  const qty = Math.max(1, Math.min(10, Math.floor(quantity)));

  // Available tickets are those not booked
  const availableCodes = VALID_TICKET_CODES.filter(c => {
    const t = tickets[c];
    return !t || !t.buyerName || t.buyerName.trim() === '';
  });

  if (availableCodes.length < qty) {
    return {
      success: false,
      proposedCodes: availableCodes,
      isConsecutive: false,
      message: `Not enough tickets available. Requested: ${qty}, Available: ${availableCodes.length}.`,
      availableTotal: availableCodes.length
    };
  }

  const getSerial = (c: string) => parseInt(c.replace('HOH', ''), 10);

  // 1. Try starting from preferredStartCode if given and available
  if (preferredStartCode) {
    const startCodeNorm = preferredStartCode.trim().toUpperCase();
    if (VALID_TICKET_CODES.includes(startCodeNorm) && availableCodes.includes(startCodeNorm)) {
      const startSerial = getSerial(startCodeNorm);
      const candidateCodes = Array.from({ length: qty }, (_, i) => {
        const s = startSerial + i;
        return `HOH${String(s).padStart(3, '0')}`;
      });

      const allValid = candidateCodes.every(c => VALID_TICKET_CODES.includes(c));
      const allAvailable = candidateCodes.every(c => availableCodes.includes(c));

      if (allValid && allAvailable) {
        return {
          success: true,
          proposedCodes: candidateCodes,
          isConsecutive: true,
          message: `${qty} consecutive ticket${qty > 1 ? 's' : ''} automatically selected: ${candidateCodes.join(', ')}`,
          availableTotal: availableCodes.length
        };
      }
    }
  }

  // 2. Single seat allocation
  if (qty === 1) {
    const fallbackSingle = availableCodes[0];
    return {
      success: true,
      proposedCodes: [fallbackSingle],
      isConsecutive: true,
      message: `Ticket ${fallbackSingle} selected.`,
      availableTotal: availableCodes.length
    };
  }

  // 3. Sliding consecutive window scan for first contiguous block
  let window: string[] = [availableCodes[0]];
  for (let i = 1; i < availableCodes.length; i++) {
    const prev = availableCodes[i - 1];
    const curr = availableCodes[i];

    if (getSerial(curr) === getSerial(prev) + 1) {
      window.push(curr);
      if (window.length === qty) {
        return {
          success: true,
          proposedCodes: window,
          isConsecutive: true,
          message: `${qty} consecutive tickets automatically selected: ${window.join(', ')}`,
          availableTotal: availableCodes.length
        };
      }
    } else {
      window = [curr];
    }
  }

  // 4. Manager override non-consecutive fallback
  if (allowNonConsecutive) {
    const nonConCodes = availableCodes.slice(0, qty);
    return {
      success: true,
      proposedCodes: nonConCodes,
      isConsecutive: false,
      message: `Assigned ${qty} non-consecutive seats under manager override: ${nonConCodes.join(', ')}`,
      availableTotal: availableCodes.length
    };
  }

  return {
    success: false,
    proposedCodes: availableCodes.slice(0, qty),
    isConsecutive: false,
    message: `No consecutive block of ${qty} tickets is available. Available singles: ${availableCodes.slice(0, 5).join(', ')}...`,
    availableTotal: availableCodes.length
  };
}

