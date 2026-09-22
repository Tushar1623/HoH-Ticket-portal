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
import { fastCache } from '../services/cacheService';

function extractParam(val: any): string {
  if (Array.isArray(val)) return String(val[0] || '').trim();
  return String(val || '').trim();
}

function isDbReady(): boolean {
  return mongoose.connection.readyState === 1;
}

const DB_UNAVAILABLE_RESPONSE = {
  success: false,
  error: {
    code: 'DATABASE_UNAVAILABLE',
    message: 'MongoDB Atlas is unavailable. No ticket or booking changes were saved.'
  }
};

/**
 * POST /api/tickets/:code/preview-sale & POST /api/bookings/preview
 * Preview allocation for physical ticket scan directly against MongoDB
 */
export const previewSale = async (req: Request, res: Response): Promise<void> => {
  if (!isDbReady()) {
    res.status(503).json(DB_UNAVAILABLE_RESPONSE);
    return;
  }

  try {
    const anchorCode = extractParam(req.params.code || req.body.anchorTicket || req.body.startCode).toUpperCase();
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
 * Create physical ticket booking with ACID transactional ticket claiming and idempotency
 */
export const createBooking = async (req: Request, res: Response): Promise<void> => {
  if (!isDbReady()) {
    res.status(503).json(DB_UNAVAILABLE_RESPONSE);
    return;
  }

  // 1. Validate request payload upfront
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

  const idempotencyKey = extractParam(req.headers['idempotency-key'] || req.body.idempotencyKey);
  const anchor = extractParam(anchorTicket || startCode).toUpperCase();
  const canOverride = allowNonConsecutive || allowOverride;

  console.log(`[BOOKING_START] anchor=${anchor || 'AUTO'} qty=${qty} idempotencyKey=${idempotencyKey || 'none'}`);

  // 2. Check existing IdempotencyKey outside transaction to short-circuit fast duplicate retries
  if (idempotencyKey) {
    try {
      const existingKey = await IdempotencyKey.findOne({ key: idempotencyKey });
      if (existingKey && existingKey.response) {
        console.log(`[IDEMPOTENCY_MATCH] key=${idempotencyKey} returning saved response.`);
        res.status(existingKey.statusCode || 200).json(existingKey.response);
        return;
      }
    } catch (idempErr: any) {
      console.warn('[IDEMPOTENCY_CHECK_WARN]', idempErr.message);
    }
  }

  // 3. Begin MongoDB Session & ACID Transaction
  const session = await mongoose.startSession();
  let sessionCommitted = false;

  try {
    let responsePayload: any = null;
    let savedBooking: any = null;
    let assignedTicketCodes: string[] = [];
    let isConsecutive = true;

    await session.withTransaction(async () => {
      // Re-check Idempotency inside transaction for strict race condition isolation
      if (idempotencyKey) {
        const existingTxKey = await IdempotencyKey.findOne({ key: idempotencyKey }).session(session);
        if (existingTxKey && existingTxKey.response) {
          responsePayload = existingTxKey.response;
          return;
        }
      }

      // Step A: Perform ticket allocation using session
      let assignedTicketIds: any[] = [];

      if (anchor) {
        const allocation = await findConsecutiveFromAnchor(anchor, qty, session, canOverride);
        if (!allocation.success || allocation.tickets.length !== qty) {
          const allocErr: any = new Error(allocation.message || `Could not allocate ${qty} tickets starting from ${anchor}.`);
          allocErr.code = allocation.reason || 'ALLOCATION_FAILED';
          allocErr.status = 400;
          allocErr.blockedTicket = allocation.blockedTicket;
          throw allocErr;
        }
        assignedTicketCodes = allocation.tickets.map(t => t.code);
        assignedTicketIds = allocation.tickets.map(t => t._id);
        isConsecutive = allocation.isConsecutive;
      } else {
        const allocation = await findConsecutiveTickets(qty, session, canOverride);
        if (!allocation.success || allocation.tickets.length !== qty) {
          const allocErr: any = new Error(allocation.error || `No consecutive block of ${qty} tickets is available.`);
          allocErr.code = 'ALLOCATION_FAILED';
          allocErr.status = 400;
          allocErr.availableSingles = allocation.availableSingles;
          throw allocErr;
        }
        assignedTicketCodes = allocation.tickets.map(t => t.code);
        assignedTicketIds = allocation.tickets.map(t => t._id);
      }

      console.log(`[ALLOCATION_SUCCESS] tickets=${assignedTicketCodes.join(',')}`);

      // Step B: Generate unique booking code using transactional counter
      const bookingCode = await getNextBookingCode(session);

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

      // Step C: Create Booking document in transaction
      const [booking] = await Booking.create(
        [
          {
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
            createdBy: req.user?.userId && mongoose.Types.ObjectId.isValid(req.user.userId) ? new mongoose.Types.ObjectId(req.user.userId) : undefined
          }
        ],
        { session }
      );

      savedBooking = booking;

      // Step D: Atomically and conditionally claim tickets inside transaction
      // Must match status: 'available' and bookingId: null at update execution time!
      const updateResult = await Ticket.updateMany(
        {
          _id: { $in: assignedTicketIds },
          status: 'available',
          bookingId: null
        },
        {
          $set: {
            bookingId: booking._id,
            buyerName: buyerName.trim(),
            phone: phone.trim(),
            email: email.trim(),
            status: 'registered',
            registeredAt: now,
            entered: false,
            enteredAt: null,
            entryCount: 0
          }
        },
        { session }
      );

      if (updateResult.modifiedCount !== assignedTicketIds.length) {
        const conflictErr: any = new Error(
          'One or more selected tickets were taken before the sale completed. No booking or ticket changes were saved.'
        );
        conflictErr.code = 'TICKET_CONFLICT';
        conflictErr.status = 409;
        throw conflictErr;
      }

      // Step E: Construct definitive response
      responsePayload = {
        success: true,
        message: `Successfully completed offline sale of ${qty} ticket${qty > 1 ? 's' : ''}: ${assignedTicketCodes.join(', ')}.`,
        booking: {
          _id: booking._id,
          bookingCode: booking.bookingCode,
          buyerName: booking.buyerName,
          phone: booking.phone,
          email: booking.email,
          ticketQuantity: booking.ticketQuantity,
          ticketCodes: booking.ticketCodes,
          paymentStatus: booking.paymentStatus,
          paymentMethod: booking.paymentMethod,
          totalAmount: booking.totalAmount,
          amountPaid: booking.amountPaid,
          source: booking.source
        },
        tickets: assignedTicketCodes.map(code => ({
          code,
          status: 'registered',
          bookingId: booking._id,
          buyerName: booking.buyerName,
          phone: booking.phone,
          email: booking.email,
          entered: false,
          enteredAt: null
        })),
        data: {
          booking,
          tickets: assignedTicketCodes,
          isConsecutive
        }
      };

      // Step F: Record IdempotencyKey inside transaction
      if (idempotencyKey) {
        await IdempotencyKey.create(
          [
            {
              key: idempotencyKey,
              response: responsePayload,
              statusCode: 201,
              createdAt: now
            }
          ],
          { session }
        );
      }
    });

    sessionCommitted = true;

    console.log(`[BOOKING_TRANSACTION_COMMIT] bookingCode=${savedBooking?.bookingCode} tickets=${assignedTicketCodes.join(',')}`);

    // Invalidate cache only AFTER successful transaction commit
    fastCache.invalidateAll();

    if (savedBooking) {
      logAudit({
        action: 'OFFLINE_SALE_CREATED',
        bookingId: savedBooking._id,
        ticketCode: assignedTicketCodes.join(', '),
        adminUsername: req.user?.username,
        newValue: {
          bookingCode: savedBooking.bookingCode,
          buyerName: savedBooking.buyerName,
          phone: savedBooking.phone,
          quantity: qty,
          tickets: assignedTicketCodes,
          totalAmount: savedBooking.totalAmount,
          amountPaid: savedBooking.amountPaid,
          isConsecutive
        }
      });
    }

    res.status(201).json(responsePayload);
  } catch (err: any) {
    console.warn(`[BOOKING_TRANSACTION_ROLLBACK] reason=${err.message}`);
    const statusCode = err.status || (err.code === 'TICKET_CONFLICT' ? 409 : 500);
    res.status(statusCode).json({
      success: false,
      error: {
        code: err.code || 'BOOKING_ERROR',
        message: err.message || 'Registration failed.'
      }
    });
  } finally {
    await session.endSession();
  }
};

/**
 * GET /api/bookings
 * Fetch all bookings with live entry progress counts
 */
export const listBookings = async (req: Request, res: Response): Promise<void> => {
  if (!isDbReady()) {
    res.status(503).json(DB_UNAVAILABLE_RESPONSE);
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
    res.status(503).json(DB_UNAVAILABLE_RESPONSE);
    return;
  }

  try {
    const id = extractParam(req.params.id);
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
  if (!isDbReady()) {
    res.status(503).json(DB_UNAVAILABLE_RESPONSE);
    return;
  }

  try {
    const bookingId = extractParam(req.params.id);
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

    fastCache.invalidateAll();
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
    const bookingId = extractParam(req.params.id);
    const ticketCode = extractParam(req.params.code).toUpperCase();
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
      ticket.entryCount = 0;
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

    fastCache.invalidateAll();
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
  if (!isDbReady()) {
    res.status(503).json(DB_UNAVAILABLE_RESPONSE);
    return;
  }

  try {
    const bookingCode = extractParam(req.body.bookingCode);

    if (!bookingCode) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_CODE', message: 'bookingCode is required.' }
      });
      return;
    }

    const booking = await Booking.findOne({ bookingCode });
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

    fastCache.invalidateAll();
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
