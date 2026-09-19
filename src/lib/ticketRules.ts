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
