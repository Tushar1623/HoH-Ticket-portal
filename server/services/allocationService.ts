import { ClientSession } from 'mongoose';
import { ITicket, Ticket } from '../models/Ticket';

export interface AllocationResult {
  success: boolean;
  tickets: ITicket[];
  error?: string;
  availableSingles?: string[];
}

/**
 * Authoritative Server-Side Helper for Available Physical Tickets
 * Queries MongoDB for tickets that have status: 'available' and bookingId: null,
 * sorted by serialNumber ascending.
 */
export async function getAvailableTickets(session?: ClientSession): Promise<ITicket[]> {
  const query = Ticket.find({
    status: 'available',
    bookingId: null
  }).sort({ serialNumber: 1 });
  if (session) {
    query.session(session);
  }
  const res = await query.exec();
  return res as unknown as ITicket[];
}

export async function countAvailableTickets(session?: ClientSession): Promise<number> {
  const query = Ticket.countDocuments({
    status: 'available',
    bookingId: null
  });
  if (session) {
    query.session(session);
  }
  return query.exec();
}

/**
 * DSA Consecutive Window Allocation Engine
 * Queries MongoDB for available tickets and uses sliding window
 * to find the first block of adjacent seats.
 */
export async function findConsecutiveTickets(
  quantity: number,
  session?: ClientSession,
  allowNonConsecutive: boolean = false,
  startCode?: string
): Promise<AllocationResult> {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
    return {
      success: false,
      tickets: [],
      error: 'Ticket quantity must be an integer between 1 and 50.'
    };
  }

  const availableTickets = await getAvailableTickets(session);

  if (availableTickets.length < quantity) {
    return {
      success: false,
      tickets: [],
      error: `Not enough tickets available. Requested: ${quantity}, Available: ${availableTickets.length}.`,
      availableSingles: availableTickets.map(t => t.code)
    };
  }

  // If startCode specified, check if consecutive block starting at startCode is available
  if (startCode) {
    const norm = startCode.trim().toUpperCase();
    const startIndex = availableTickets.findIndex(t => t.code === norm);
    if (startIndex !== -1 && startIndex + quantity <= availableTickets.length) {
      const candidate = availableTickets.slice(startIndex, startIndex + quantity);
      const isContiguous = candidate.every((t, idx) =>
        idx === 0 || t.serialNumber === candidate[idx - 1].serialNumber + 1
      );
      if (isContiguous) {
        return {
          success: true,
          tickets: candidate
        };
      }
    }
  }

  // If quantity is 1, return the first available ticket immediately
  if (quantity === 1) {
    return {
      success: true,
      tickets: [availableTickets[0]]
    };
  }

  // Sliding consecutive window scan
  let window: ITicket[] = [availableTickets[0]];

  for (let i = 1; i < availableTickets.length; i++) {
    const current = availableTickets[i];
    const previous = availableTickets[i - 1];

    if (current.serialNumber === previous.serialNumber + 1) {
      window.push(current);
      if (window.length === quantity) {
        return {
          success: true,
          tickets: window
        };
      }
    } else {
      window = [current];
    }
  }

  // If non-consecutive is allowed as fallback
  if (allowNonConsecutive) {
    return {
      success: true,
      tickets: availableTickets.slice(0, quantity)
    };
  }

  return {
    success: false,
    tickets: [],
    error: `No consecutive block of ${quantity} tickets is available.`,
    availableSingles: availableTickets.map(t => t.code)
  };
}

/**
 * Shared Ticket Normalization Utility
 * Supports hoh001, HOH001, hoh-001, HOH-001 -> HOH001
 */
export function normalizeTicketCode(input: string | null | undefined): string {
  if (!input) return '';
  const clean = input.trim().toUpperCase().replace(/[\s\-_]+/g, '');
  const match = clean.match(/^HOH0*([1-9]\d*)$/i);
  if (match) {
    const num = parseInt(match[1], 10);
    if (num >= 1 && num <= 50) {
      return `HOH${String(num).padStart(3, '0')}`;
    }
  }
  return clean;
}

export interface AnchorAllocationResult {
  success: boolean;
  tickets: ITicket[];
  isConsecutive: boolean;
  anchorCode?: string;
  blockedTicket?: string;
  skippedTickets?: string[];
  reason?: string;
  message?: string;
  error?: string;
}

/**
 * Anchor-Based Physical Ticket Allocation Engine (resolveTicketAllocation)
 * The scanned physical ticket is treated as the allocation anchor.
 * - Single ticket (qty=1): Returns the EXACT requested anchor ticket if available.
 * - Multi-ticket (qty>1): Derives expected codes (e.g. HOH021..HOH024) and queries by { code: { $in: expectedCodes } }.
 * - Reconstructs using Map keyed by ticket.code to ensure deterministic ordering.
 * - If blocked and not overridden, searches for the next COMPLETE contiguous block or returns an explicit error.
 */
export async function findConsecutiveFromAnchor(
  anchorCode: string,
  quantity: number,
  session?: ClientSession,
  allowOverrideNonConsecutive: boolean = false
): Promise<AnchorAllocationResult> {
  const normAnchor = normalizeTicketCode(anchorCode);

  const match = normAnchor.match(/^HOH(\d+)$/i);
  if (!match) {
    return {
      success: false,
      tickets: [],
      isConsecutive: false,
      reason: 'INVALID_ANCHOR',
      message: `Invalid ticket code '${anchorCode}'. Range must be HOH001 to HOH050.`
    };
  }

  const anchorSerial = parseInt(match[1], 10);
  if (anchorSerial < 1 || anchorSerial > 50) {
    return {
      success: false,
      tickets: [],
      isConsecutive: false,
      reason: 'OUT_OF_RANGE',
      message: `Ticket code '${anchorCode}' is out of range. Must be HOH001 to HOH050.`
    };
  }

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
    return {
      success: false,
      tickets: [],
      isConsecutive: false,
      reason: 'INVALID_QUANTITY',
      message: 'Ticket quantity must be an integer between 1 and 50.'
    };
  }

  // 1. Fetch anchor ticket directly by exact code
  const anchorQuery = Ticket.findOne({ code: normAnchor });
  if (session) anchorQuery.session(session);
  const anchor = (await anchorQuery.exec()) as unknown as ITicket | null;

  if (!anchor) {
    return {
      success: false,
      tickets: [],
      isConsecutive: false,
      reason: 'TICKET_NOT_FOUND',
      message: `Ticket ${normAnchor} was not found in inventory.`
    };
  }

  // Check anchor status
  const isAnchorAvailable = (anchor.status === 'available' || String(anchor.status).toLowerCase() === 'available') && anchor.bookingId === null;
  if (!isAnchorAvailable) {
    if (anchor.status === 'cancelled' || String(anchor.status).toLowerCase() === 'cancelled') {
      return {
        success: false,
        tickets: [],
        isConsecutive: false,
        anchorCode: normAnchor,
        reason: 'ANCHOR_CANCELLED',
        message: `Ticket ${normAnchor} is cancelled (${anchor.cancellationReason || 'VOID'}) and cannot be sold.`
      };
    }
    return {
      success: false,
      tickets: [],
      isConsecutive: false,
      anchorCode: normAnchor,
      reason: 'ANCHOR_ALREADY_REGISTERED',
      message: `${normAnchor} is already registered. Customer: ${anchor.buyerName || 'Registered Buyer'}. This physical ticket cannot be sold again.`
    };
  }

  // Single-ticket sale: return the exact anchor ticket
  if (quantity === 1) {
    return {
      success: true,
      tickets: [anchor],
      isConsecutive: true,
      anchorCode: normAnchor,
      message: `Selected ticket: ${normAnchor}.`
    };
  }

  // 2. Multi-ticket consecutive block from anchor
  const endSerial = anchorSerial + quantity - 1;
  if (endSerial > 50) {
    const remaining = 50 - anchorSerial + 1;
    if (!allowOverrideNonConsecutive) {
      return {
        success: false,
        tickets: [],
        isConsecutive: false,
        anchorCode: normAnchor,
        reason: 'END_OF_INVENTORY',
        message: `Only ${remaining} ticket numbers remain from ${normAnchor} (HOH${String(anchorSerial).padStart(3, '0')} to HOH050). Cannot allocate ${quantity} consecutive tickets.`
      };
    }
  }

  const expectedCodes = Array.from({ length: quantity }, (_, i) => `HOH${String(anchorSerial + i).padStart(3, '0')}`);
  const candidateQuery = Ticket.find({
    $or: [
      { code: { $in: expectedCodes } },
      { serialNumber: { $in: Array.from({ length: quantity }, (_, i) => anchorSerial + i) } }
    ]
  }).sort({ serialNumber: 1 });
  if (session) candidateQuery.session(session);
  const candidates = (await candidateQuery.exec()) as unknown as ITicket[];

  const candMap = new Map(candidates.map(c => [c.code, c]));
  let blockedCode: string | null = null;
  const orderedCandidates: ITicket[] = [];

  for (const expCode of expectedCodes) {
    const doc = candMap.get(expCode);
    if (!doc || (doc.status !== 'available' && String(doc.status).toLowerCase() !== 'available') || doc.bookingId !== null) {
      blockedCode = expCode;
      break;
    }
    orderedCandidates.push(doc);
  }

  if (!blockedCode && orderedCandidates.length === quantity) {
    return {
      success: true,
      tickets: orderedCandidates,
      isConsecutive: true,
      anchorCode: normAnchor,
      message: `Consecutive tickets selected: ${expectedCodes.join(', ')}.`
    };
  }

  // 3. If consecutive block is blocked and manager override is NOT requested
  if (!allowOverrideNonConsecutive) {
    return {
      success: false,
      tickets: [],
      isConsecutive: false,
      anchorCode: normAnchor,
      blockedTicket: blockedCode || undefined,
      reason: 'CONSECUTIVE_UNAVAILABLE',
      message: `Consecutive allocation unavailable. Requested: ${quantity} tickets. Starting ticket: ${normAnchor}. ${blockedCode ? blockedCode + ' is already registered or unavailable.' : 'Insufficient consecutive tickets.'} Choose an available starting ticket or use override.`
    };
  }

  // 4. Admin Override: Pick anchor + next available tickets
  const otherAvailableQuery = Ticket.find({
    status: 'available',
    bookingId: null,
    serialNumber: { $gt: anchorSerial }
  }).sort({ serialNumber: 1 }).limit(quantity - 1);
  if (session) otherAvailableQuery.session(session);
  const nextAvailable = (await otherAvailableQuery.exec()) as unknown as ITicket[];

  const combined = [anchor, ...nextAvailable];
  if (combined.length < quantity) {
    const priorQuery = Ticket.find({
      status: 'available',
      bookingId: null,
      serialNumber: { $lt: anchorSerial }
    }).sort({ serialNumber: 1 }).limit(quantity - combined.length);
    if (session) priorQuery.session(session);
    const priorAvailable = (await priorQuery.exec()) as unknown as ITicket[];
    combined.push(...priorAvailable);
  }

  if (combined.length < quantity) {
    return {
      success: false,
      tickets: [],
      isConsecutive: false,
      anchorCode: normAnchor,
      reason: 'INSUFFICIENT_TICKETS',
      message: `Not enough tickets available in total inventory (Requested: ${quantity}, Available: ${combined.length}).`
    };
  }

  const skipped = candidates.filter(c => String(c.status).toLowerCase() !== 'available' || c.bookingId !== null).map(c => c.code);

  return {
    success: true,
    tickets: combined,
    isConsecutive: false,
    anchorCode: normAnchor,
    skippedTickets: skipped,
    message: `Non-consecutive allocation selected: ${combined.map(c => c.code).join(', ')}.`
  };
}

export const resolveTicketAllocation = findConsecutiveFromAnchor;

/**
 * Preview physical sale allocation for frontend preview modal
 */
export async function previewPhysicalSale(
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
  ticketCount: number;
  availableTotal: number;
}> {
  const normAnchor = anchorCode.trim().toUpperCase();
  const availableTotal = await countAvailableTickets();

  const result = await findConsecutiveFromAnchor(normAnchor, quantity, undefined, allowOverride);

  if (result.success && result.tickets.length > 0) {
    const codes = result.tickets.map(t => t.code);
    return {
      success: true,
      anchorTicket: normAnchor,
      proposedCodes: codes,
      isConsecutive: result.isConsecutive,
      skippedTickets: result.skippedTickets,
      message: result.message || `Selected ${codes.length} ticket(s): ${codes.join(', ')}`,
      ticketCount: codes.length,
      availableTotal
    };
  }

  return {
    success: false,
    anchorTicket: normAnchor,
    proposedCodes: [],
    isConsecutive: false,
    blockedTicket: result.blockedTicket,
    reason: result.reason,
    message: result.message || 'Allocation failed.',
    ticketCount: 0,
    availableTotal
  };
}

/**
 * Preview consecutive allocation for real-time frontend feedback (general fallback)
 */
export async function previewAllocation(
  quantity: number,
  startCode?: string
): Promise<{
  success: boolean;
  proposedCodes: string[];
  message: string;
  isConsecutive: boolean;
  availableTotal: number;
  blockedTicket?: string;
}> {
  if (startCode) {
    const anchorRes = await previewPhysicalSale(startCode, quantity, false);
    return {
      success: anchorRes.success,
      proposedCodes: anchorRes.proposedCodes,
      message: anchorRes.message,
      isConsecutive: anchorRes.isConsecutive,
      availableTotal: anchorRes.availableTotal,
      blockedTicket: anchorRes.blockedTicket
    };
  }

  const availableCount = await countAvailableTickets();

  const result = await findConsecutiveTickets(quantity, undefined, false, startCode);

  if (result.success && result.tickets.length > 0) {
    const codes = result.tickets.map(t => t.code);
    return {
      success: true,
      proposedCodes: codes,
      message: `${quantity} consecutive ticket${quantity > 1 ? 's' : ''} will be assigned: ${codes.join(', ')}.`,
      isConsecutive: true,
      availableTotal: availableCount
    };
  }

  // Check if non-consecutive tickets exist
  const nonConsecutiveResult = await findConsecutiveTickets(quantity, undefined, true);
  if (nonConsecutiveResult.success && nonConsecutiveResult.tickets.length > 0) {
    const codes = nonConsecutiveResult.tickets.map(t => t.code);
    return {
      success: false,
      proposedCodes: codes,
      message: `No consecutive block of ${quantity} tickets is available. Available individual tickets: ${codes.join(', ')}.`,
      isConsecutive: false,
      availableTotal: availableCount
    };
  }

  return {
    success: false,
    proposedCodes: [],
    message: `Not enough tickets available. (Requested ${quantity}, Available ${availableCount}).`,
    isConsecutive: false,
    availableTotal: availableCount
  };
}
