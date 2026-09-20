import mongoose, { ClientSession } from 'mongoose';
import { ITicket, Ticket } from '../models/Ticket';
import { getMemoryTickets } from './inMemoryStore';

export interface AllocationResult {
  success: boolean;
  tickets: ITicket[];
  error?: string;
  availableSingles?: string[];
}

/**
 * DSA Consecutive Window Allocation Engine
 * 
 * Algorithm:
 * 1. Query available tickets sorted by serialNumber ascending.
 * 2. Maintain a running consecutive window.
 * 3. For each ticket:
 *    - If current.serialNumber === previous.serialNumber + 1: extend the current block.
 *    - Otherwise: reset the block to [current].
 * 4. When block size equals requested quantity, return that range.
 * 5. If no consecutive block satisfies quantity, return descriptive error and available singles.
 * 
 * Time Complexity: O(n) where n <= 50 tickets.
 * Space Complexity: O(k) where k <= 10 requested quantity.
 */
export async function findConsecutiveTickets(
  quantity: number,
  session?: ClientSession,
  allowNonConsecutive: boolean = false,
  startCode?: string
): Promise<AllocationResult> {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
    return {
      success: false,
      tickets: [],
      error: 'Ticket quantity must be an integer between 1 and 10.'
    };
  }

  let availableTickets: ITicket[] = [];

  try {
    // 1. Query all available tickets (status = 'available', bookingId = null) sorted by serialNumber ascending
    const query = Ticket.find({ status: 'available', bookingId: null }).sort({ serialNumber: 1 });
    if (session) {
      query.session(session);
    }
    availableTickets = await query.exec();
  } catch {
    // Fallback when MongoDB is disconnected or bufferCommands = false
    availableTickets = getMemoryTickets().filter(t => t.status === 'available') as any;
  }

  if (availableTickets.length < quantity) {
    return {
      success: false,
      tickets: [],
      error: `Not enough tickets available. Requested: ${quantity}, Available: ${availableTickets.length}.`,
      availableSingles: availableTickets.map(t => t.code)
    };
  }

  // 2. If startCode specified, check if consecutive range starting at startCode is available
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

  // If quantity is 1, first available ticket is immediately returned
  if (quantity === 1) {
    return {
      success: true,
      tickets: [availableTickets[0]]
    };
  }

  // 3. Sliding consecutive window scan (O(n) linear sequence scan)
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
      // Reset window when consecutive chain breaks
      window = [current];
    }
  }

  // 4. Fallback: Manager/Admin Override allows non-consecutive
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
 * Preview allocation for real-time frontend feedback
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
}> {
  let availableCount = 0;
  try {
    availableCount = await Ticket.countDocuments({ status: 'available', bookingId: null });
  } catch {
    availableCount = getMemoryTickets().filter(t => t.status === 'available').length;
  }
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

  // Check non-consecutive available
  const nonConsecutiveResult = await findConsecutiveTickets(quantity, undefined, true);
  if (nonConsecutiveResult.success && nonConsecutiveResult.tickets.length > 0) {
    const codes = nonConsecutiveResult.tickets.map(t => t.code);
    return {
      success: false,
      proposedCodes: codes,
      message: `No consecutive block of ${quantity} tickets is available. Available individual tickets: ${codes.join(', ')}. Requires manager approval.`,
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
