import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { Booking } from '../models/Booking';
import { Ticket } from '../models/Ticket';
import { IdempotencyKey } from '../models/IdempotencyKey';
import { getNextBookingCode } from '../models/Counter';
import {
  findConsecutiveFromAnchor,
  findConsecutiveTickets,
  previewPhysicalSale,
  previewAllocation
} from '../services/allocationService';
import { logAudit } from '../services/auditService';
import { localDataStore } from '../services/localDataStore';
import { fastCache } from '../services/cacheService';

function isDbReady(): boolean {
  return mongoose.connection.readyState === 1;
}

const DB_UNAVAILABLE_RESPONSE = {
  success: false,
  error: {
    code: 'DATABASE_UNAVAILABLE',
    message: 'Unable to connect to database. MongoDB connection is currently unavailable.'
  }
};

/**
 * POST /api/tickets/:code/preview-sale & POST /api/bookings/preview
 * Preview allocation for physical ticket scan
 */
export const previewSale = async (req: Request, res: Response): Promise<void> => {
  if (!isDbReady()) {
    const anchorCode = (req.params.code || req.body.anchorTicket || req.body.startCode || '').trim().toUpperCase();
    const quantity = parseInt(req.body.quantity || req.body.ticketQuantity || req.body.count, 10) || 1;
    const allowOverride = req.body.allowOverride === true || req.body.allowNonConsecutive === true;

    const anchorNum = parseInt(anchorCode.replace('HOH', ''), 10);
    const proposedCodes: string[] = [];
    let blockedTicket: string | null = null;

    if (!anchorCode || isNaN(anchorNum)) {
      res.status(400).json({ success: false, error: { code: 'INVALID_ANCHOR', message: 'Valid physical anchor ticket required' } });
      return;
    }

    if (anchorNum + quantity - 1 > 50 && !allowOverride) {
      res.json({
        success: false,
        message: `Requested ${quantity} seats exceed maximum capacity. Only ${Math.max(0, 50 - anchorNum + 1)} tickets remain from ${anchorCode}.`,
        proposedCodes: [],
        blockedTicket: 'HOH051'
      });
      return;
    }

    for (let i = 0; i < quantity; i++) {
      const code = `HOH${String(anchorNum + i).padStart(3, '0')}`;
      const t = localDataStore.getTicketByCode(code);
      if (!t || t.status === 'cancelled' || t.status === 'registered' || t.buyerName) {
        blockedTicket = code;
        break;
      }
      proposedCodes.push(code);
    }

    if (blockedTicket && !allowOverride) {
      res.json({
        success: false,
        message: `Consecutive allocation unavailable. Starting ticket: ${anchorCode}. ${blockedTicket} is already sold or void.`,
        proposedCodes: [],
        blockedTicket
      });
      return;
    }

    if (blockedTicket && allowOverride) {
      const avail = localDataStore.getTickets({ status: 'available' });
      const overrideCodes = avail.slice(0, quantity).map(t => t.code);
      res.json({
        success: true,
        message: `Allocated ${quantity} non-consecutive available tickets.`,
        proposedCodes: overrideCodes,
        isConsecutive: false
      });
      return;
    }

    res.json({
      success: true,
      message: `Successfully allocated consecutive tickets from ${anchorCode} to ${proposedCodes[proposedCodes.length - 1]}.`,
      proposedCodes,
      isConsecutive: true
    });
    return;
  }

  try {
    const anchorCode = (req.params.code || req.body.anchorTicket || req.body.startCode || '').trim().toUpperCase();
    const quantity = parseInt(req.body.quantity || req.body.ticketQuantity || req.body.count, 10) || 1;
    const allowOverride = req.body.allowOverride === true || req.body.allowNonConsecutive === true;

    if (anchorCode) {
      const preview = await previewPhysicalSale(anchorCode, quantity, allowOverride);
      res.json(preview);
    } else {
      const preview = await previewAllocation(quantity);
      res.json(preview);
    }
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: { code: 'PREVIEW_ERROR', message: err.message }
    });
  }
};

export const previewBooking = previewSale;

/**
 * POST /api/bookings
 * Create physical ticket booking with anchor-driven consecutive ticket allocation
 */
export const createBooking = async (req: Request, res: Response): Promise<void> => {
  // SECURITY: Booking creation must persist to MongoDB. Reject when DB is unavailable.
  if (!isDbReady()) {
    res.status(503).json(DB_UNAVAILABLE_RESPONSE);
    return;
  }

  try {
    // 1. Check Idempotency Key
    const idempotencyKey = (req.headers['idempotency-key'] as string) || req.body.idempotencyKey;
    if (idempotencyKey) {
      const existingKey = await IdempotencyKey.findOne({ key: idempotencyKey });
      if (existingKey && existingKey.response) {
        res.status(existingKey.statusCode || 200).json(existingKey.response);
        return;
      }
    }

    const {
      buyerName,
      phone,
      email = '',
      ticketQuantity,
      quantity,
      anchorTicket,
      startCode,
      paymentStatus = 'PAID',
      paymentMethod = 'CASH',
      totalAmount = 0,
      amountPaid,
      notes = '',
      allowNonConsecutive = false,
      allowOverride = false
    } = req.body;

    if (!buyerName || typeof buyerName !== 'string' || !buyerName.trim()) {
      res.status(400).json({
        success: false,
        error: { code: 'MISSING_NAME', message: 'Customer full name is required.' }
      });
      return;
    }

    if (!phone || typeof phone !== 'string' || !phone.trim()) {
      res.status(400).json({
        success: false,
        error: { code: 'MISSING_PHONE', message: 'Customer phone number is required.' }
      });
      return;
    }

    const qty = parseInt(ticketQuantity || quantity, 10);
    if (isNaN(qty) || qty < 1 || qty > 50) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_QUANTITY', message: 'Ticket quantity must be between 1 and 50.' }
      });
      return;
    }

    const anchor = (anchorTicket || startCode || '').trim().toUpperCase();
    const canOverride = allowNonConsecutive || allowOverride;

    // 2. Perform allocation verification
    let assignedTicketCodes: string[] = [];
    let assignedTicketIds: any[] = [];
    let isConsecutive = true;

    if (anchor) {
      const allocation = await findConsecutiveFromAnchor(anchor, qty, undefined, canOverride);
      if (!allocation.success || allocation.tickets.length !== qty) {
        res.status(400).json({
          success: false,
          error: {
            code: allocation.reason || 'ALLOCATION_FAILED',
            message: allocation.message || `Could not allocate ${qty} tickets starting from ${anchor}.`,
            blockedTicket: allocation.blockedTicket
          }
        });
        return;
      }
      assignedTicketCodes = allocation.tickets.map(t => t.code);
      assignedTicketIds = allocation.tickets.map(t => t._id);
      isConsecutive = allocation.isConsecutive;
    } else {
      const allocation = await findConsecutiveTickets(qty, undefined, canOverride);
      if (!allocation.success || allocation.tickets.length !== qty) {
        res.status(400).json({
          success: false,
          error: {
            code: 'ALLOCATION_FAILED',
            message: allocation.error || `No consecutive block of ${qty} tickets is available.`,
            availableSingles: allocation.availableSingles
          }
        });
        return;
      }
      assignedTicketCodes = allocation.tickets.map(t => t.code);
      assignedTicketIds = allocation.tickets.map(t => t._id);
    }

    // 3. Re-verify in database that none of these tickets have been taken concurrently
    const currentTickets = await Ticket.find({ _id: { $in: assignedTicketIds } });
    const unavailable = currentTickets.find(t => t.status !== 'available' || t.bookingId !== null);
    if (unavailable) {
      res.status(409).json({
        success: false,
        error: {
          code: 'TICKET_CONFLICT',
          message: `Sale could not be completed. Ticket ${unavailable.code} is no longer available. No tickets were registered.`
        }
      });
      return;
    }

    // 4. Generate atomic collision-free booking code
    const bookingCode = await getNextBookingCode();

    const finalTotalAmount = Number(totalAmount) || 0;
    const finalAmountPaid = amountPaid !== undefined ? Number(amountPaid) : finalTotalAmount;
    const normPaymentMethod = (['CASH', 'UPI', 'CARD', 'OTHER'].includes(String(paymentMethod).toUpperCase())
      ? String(paymentMethod).toUpperCase()
      : 'CASH') as 'CASH' | 'UPI' | 'CARD' | 'OTHER';

    const normPaymentStatus = (['PAID', 'PARTIAL', 'PENDING'].includes(String(paymentStatus).toUpperCase())
      ? String(paymentStatus).toUpperCase()
      : paymentStatus) as any;

    const now = new Date();

    const allocationMethod = (req.body.allocationMethod === 'MANUAL' || allowNonConsecutive || allowOverride || !isConsecutive)
      ? 'MANUAL'
      : 'CONSECUTIVE';

    // 5. Create Booking document
    const booking = await Booking.create({
      bookingCode,
      buyerName: buyerName.trim(),
      phone: phone.trim(),
      email: email.trim(),
      ticketQuantity: qty,
      ticketCodes: assignedTicketCodes,
      anchorTicketCode: anchor || null,
      allocationMethod,
      paymentStatus: normPaymentStatus,
      paymentMethod: normPaymentMethod,
      totalAmount: finalTotalAmount,
      amountPaid: finalAmountPaid,
      notes: notes.trim(),
      source: 'OFFLINE',
      createdBy: req.user?.userId ? new mongoose.Types.ObjectId(req.user.userId) : undefined
    });

    // 6. Atomically update all allocated tickets
    await Ticket.updateMany(
      { _id: { $in: assignedTicketIds } },
      {
        $set: {
          bookingId: booking._id,
          buyerName: buyerName.trim(),
          phone: phone.trim(),
          email: email.trim(),
          status: 'registered',
          registeredAt: now,
          entered: false,
          enteredAt: null
        }
      }
    );

    logAudit({
      action: 'OFFLINE_SALE_CREATED',
      bookingId: booking._id,
      ticketCode: assignedTicketCodes.join(', '),
      adminUsername: req.user?.username,
      newValue: {
        bookingCode,
        buyerName: booking.buyerName,
        phone: booking.phone,
        quantity: qty,
        tickets: assignedTicketCodes,
        totalAmount: finalTotalAmount,
        amountPaid: finalAmountPaid,
        paymentMethod: normPaymentMethod,
        isConsecutive
      }
    });

    const responsePayload = {
      success: true,
      message: `Successfully completed offline sale of ${qty} ticket${qty > 1 ? 's' : ''}: ${assignedTicketCodes.join(', ')}.`,
      data: {
        booking,
        tickets: assignedTicketCodes,
        isConsecutive
      },
      booking,
      tickets: assignedTicketCodes
    };

    // Save Idempotency Key if provided
    if (idempotencyKey) {
      await IdempotencyKey.create({
        key: idempotencyKey,
        response: responsePayload,
        statusCode: 201,
        createdAt: now
      }).catch(() => {});
    }

    fastCache.invalidateAll();
    res.status(201).json(responsePayload);
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: { code: 'BOOKING_ERROR', message: 'Registration failed: ' + err.message }
    });
  }
};

/**
 * GET /api/bookings
 * Fetch all bookings with live entry progress counts
 */
export const listBookings = async (req: Request, res: Response): Promise<void> => {
  const cached = fastCache.get('bookings_list');
  if (cached) {
    res.json(cached);
    return;
  }

  if (!isDbReady()) {
    const bookings = localDataStore.listBookings();
    const payload = {
      success: true,
      data: bookings,
      bookings,
      count: bookings.length
    };
    fastCache.set('bookings_list', payload, 1500);
    res.json(payload);
    return;
  }

  try {
    const bookings = await Booking.find({}).sort({ createdAt: -1 }).lean();

    // Fetch live entry status for all tickets
    const allTickets = await Ticket.find({ bookingId: { $ne: null } }).lean();
    const ticketMap = new Map(allTickets.map(t => [t.code, t]));

    const enriched = bookings.map(b => {
      const tickets = (b.ticketCodes || []).map(code => ticketMap.get(code)).filter(Boolean);
      const enteredCount = tickets.filter(t => t?.entered).length;
      const notEnteredCount = tickets.length - enteredCount;

      return {
        ...b,
        enteredCount,
        notEnteredCount,
        tickets
      };
    });

    const payload = {
      success: true,
      data: enriched,
      bookings: enriched,
      count: enriched.length
    };
    fastCache.set('bookings_list', payload, 1500);
    res.json(payload);
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: { code: 'FETCH_BOOKINGS_ERROR', message: 'Failed to fetch bookings: ' + err.message }
    });
  }
};

/**
 * GET /api/bookings/:id
 * Single booking detail with associated tickets
 */
export const getBookingById = async (req: Request, res: Response): Promise<void> => {
  if (!isDbReady()) {
    const id = req.params.id;
    const booking = localDataStore.getBookingById(id);
    if (!booking) {
      res.status(404).json({ success: false, error: { code: 'BOOKING_NOT_FOUND', message: `Booking ${id} not found.` } });
      return;
    }
    const tickets = booking.ticketCodes.map(c => localDataStore.getTicketByCode(c)).filter(Boolean);
    res.json({ success: true, data: { ...booking, tickets }, booking, tickets });
    return;
  }

  try {
    const id = req.params.id;
    const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { bookingCode: id };
    const booking = await Booking.findOne(query).lean();

    if (!booking) {
      res.status(404).json({
        success: false,
        error: { code: 'BOOKING_NOT_FOUND', message: `Booking ${id} not found.` }
      });
      return;
    }

    const tickets = await Ticket.find({ bookingId: booking._id }).sort({ serialNumber: 1 }).lean();
    const enteredCount = tickets.filter(t => t.entered).length;

    res.json({
      success: true,
      data: {
        ...booking,
        tickets,
        enteredCount,
        notEnteredCount: tickets.length - enteredCount
      }
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: { code: 'GET_BOOKING_ERROR', message: 'Failed to fetch booking: ' + err.message }
    });
  }
};

/**
 * PUT /api/bookings/:id
 * Edit existing booking details
 */
export const updateBooking = async (req: Request, res: Response): Promise<void> => {
  // SECURITY: Booking mutations must persist to MongoDB. Reject when DB is unavailable.
  if (!isDbReady()) {
    res.status(503).json(DB_UNAVAILABLE_RESPONSE);
    return;
  }

  try {
    const bookingId = req.params.id;
    const { buyerName, phone, email, paymentStatus, paymentMethod, totalAmount, amountPaid, notes } = req.body;

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      res.status(404).json({
        success: false,
        error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' }
      });
      return;
    }

    if (buyerName !== undefined) booking.buyerName = buyerName.trim();
    if (phone !== undefined) booking.phone = phone.trim();
    if (email !== undefined) booking.email = email.trim();
    if (paymentStatus !== undefined) booking.paymentStatus = paymentStatus;
    if (paymentMethod !== undefined) booking.paymentMethod = paymentMethod;
    if (totalAmount !== undefined) booking.totalAmount = Number(totalAmount);
    if (amountPaid !== undefined) booking.amountPaid = Number(amountPaid);
    if (notes !== undefined) booking.notes = notes.trim();

    await booking.save();

    // Sync buyer details to associated tickets
    await Ticket.updateMany(
      { bookingId: booking._id },
      {
        $set: {
          buyerName: booking.buyerName,
          phone: booking.phone,
          email: booking.email
        }
      }
    );

    logAudit({
      action: 'BOOKING_EDITED',
      bookingId: booking._id,
      adminUsername: req.user?.username,
      newValue: { buyerName: booking.buyerName, phone: booking.phone, paymentStatus: booking.paymentStatus }
    });

    res.json({
      success: true,
      message: `Booking ${booking.bookingCode} updated successfully.`,
      data: booking,
      booking
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: { code: 'UPDATE_BOOKING_ERROR', message: 'Failed to update booking: ' + err.message }
    });
  }
};

/**
 * DELETE /api/bookings/:id/tickets/:code
 * Remove single ticket from a booking with reason, releasing it to AVAILABLE
 */
export const removeTicketFromBooking = async (req: Request, res: Response): Promise<void> => {
  if (!isDbReady()) {
    res.status(503).json(DB_UNAVAILABLE_RESPONSE);
    return;
  }

  try {
    const bookingId = req.params.id;
    const ticketCode = (req.params.code || '').toUpperCase().trim();
    const reason = req.body.reason || 'Removed by admin';

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      res.status(404).json({
        success: false,
        error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' }
      });
      return;
    }

    if (!booking.ticketCodes.includes(ticketCode)) {
      res.status(400).json({
        success: false,
        error: { code: 'TICKET_NOT_IN_BOOKING', message: `Ticket ${ticketCode} is not in this booking.` }
      });
      return;
    }

    const ticket = await Ticket.findOne({ code: ticketCode });
    const confirmEntered = req.body.confirmEntered === true || req.body.force === true;
    if (ticket && ticket.entered && !confirmEntered) {
      res.status(400).json({
        success: false,
        warning: 'TICKET_ALREADY_ENTERED',
        error: {
          code: 'TICKET_ALREADY_ENTERED',
          message: `Ticket ${ticketCode} has already been marked ENTERED. Removing it will clear its booking assignment and entry state. Confirm to proceed.`
        }
      });
      return;
    }

    // Release ticket
    if (ticket) {
      ticket.bookingId = null;
      ticket.buyerName = null;
      ticket.phone = null;
      ticket.email = null;
      ticket.status = 'available';
      ticket.registeredAt = null;
      ticket.entered = false;
      ticket.enteredAt = null;
      await ticket.save();
    }

    // Update booking
    booking.ticketCodes = booking.ticketCodes.filter(c => c !== ticketCode);
    booking.ticketQuantity = booking.ticketCodes.length;

    if (booking.ticketQuantity === 0) {
      await Booking.deleteOne({ _id: booking._id });
    } else {
      await booking.save();
    }

    logAudit({
      action: 'TICKET_CLEARED',
      bookingId: booking._id,
      ticketCode,
      adminUsername: req.user?.username,
      reason
    });

    res.json({
      success: true,
      message: `Ticket ${ticketCode} removed from booking and returned to AVAILABLE pool.`,
      data: booking
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: { code: 'REMOVE_TICKET_ERROR', message: 'Failed to remove ticket: ' + err.message }
    });
  }
};

/**
 * POST /api/bookings/clear
 * Clear entire booking and release all associated tickets
 */
export const clearBooking = async (req: Request, res: Response): Promise<void> => {
  // SECURITY: Booking mutations must persist to MongoDB. Reject when DB is unavailable.
  if (!isDbReady()) {
    res.status(503).json(DB_UNAVAILABLE_RESPONSE);
    return;
  }

  try {
    const { bookingCode } = req.body;

    if (!bookingCode) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_CODE', message: 'bookingCode is required.' }
      });
      return;
    }

    const booking = await Booking.findOne({ bookingCode: bookingCode.trim() });
    if (!booking) {
      res.status(404).json({
        success: false,
        error: { code: 'BOOKING_NOT_FOUND', message: `Booking ${bookingCode} not found.` }
      });
      return;
    }

    const ticketCodes = [...booking.ticketCodes];

    // Check if any tickets have already been entered
    const enteredTickets = await Ticket.find({ bookingId: booking._id, entered: true });
    const confirmEntered = req.body.confirmEntered === true || req.body.force === true;
    if (enteredTickets.length > 0 && !confirmEntered) {
      res.status(400).json({
        success: false,
        warning: 'TICKET_ALREADY_ENTERED',
        error: {
          code: 'TICKET_ALREADY_ENTERED',
          message: `${enteredTickets.length} ticket(s) in this booking have already been marked ENTERED (${enteredTickets.map(t => t.code).join(', ')}). Clearing will remove their booking and entry state. Confirm to proceed.`
        }
      });
      return;
    }

    // Release all associated tickets back to AVAILABLE
    await Ticket.updateMany(
      { bookingId: booking._id },
      {
        $set: {
          bookingId: null,
          buyerName: null,
          phone: null,
          email: null,
          status: 'available',
          registeredAt: null,
          entered: false,
          enteredAt: null,
          entryCount: 0
        }
      }
    );

    await Booking.deleteOne({ _id: booking._id });

    logAudit({
      action: 'CLEAR_BOOKING',
      bookingId: booking._id,
      ticketCode: ticketCodes.join(', '),
      adminUsername: req.user?.username,
      reason: 'Entire booking cleared by admin'
    });

    res.json({
      success: true,
      message: `Booking ${bookingCode} cleared. Tickets (${ticketCodes.join(', ')}) returned to AVAILABLE pool.`,
      clearedTickets: ticketCodes,
      data: { clearedTickets: ticketCodes }
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: { code: 'CLEAR_BOOKING_ERROR', message: 'Failed to clear booking: ' + err.message }
    });
  }
};
