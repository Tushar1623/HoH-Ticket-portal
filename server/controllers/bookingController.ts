import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { Booking } from '../models/Booking';
import { Ticket } from '../models/Ticket';
import { AuditLog } from '../models/AuditLog';
import { IdempotencyKey } from '../models/IdempotencyKey';
import { findConsecutiveTickets, previewAllocation } from '../services/allocationService';

/**
 * Generate unique booking code e.g. "HOH-BOOK-000001"
 */
async function generateBookingCode(): Promise<string> {
  const count = await Booking.countDocuments();
  const num = String(count + 1).padStart(6, '0');
  return `HOH-BOOK-${num}`;
}

/**
 * POST /api/bookings/preview
 */
export const previewBooking = async (req: Request, res: Response): Promise<void> => {
  try {
    const quantity = parseInt(req.body.quantity || req.body.count, 10) || 1;
    const startCode = req.body.startCode ? String(req.body.startCode).trim().toUpperCase() : undefined;
    const preview = await previewAllocation(quantity, startCode);
    res.json(preview);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/bookings
 * Atomic transaction-based booking creation with DSA consecutive serial allocation
 */
export const createBooking = async (req: Request, res: Response): Promise<void> => {
  const {
    buyerName,
    phone,
    email = '',
    ticketQuantity,
    quantity,
    startCode,
    paymentStatus = 'Paid',
    totalAmount = 0,
    notes = '',
    requestId,
    allowNonConsecutive = false
  } = req.body;

  // 1. Input Validation
  if (!buyerName || typeof buyerName !== 'string' || !buyerName.trim()) {
    res.status(400).json({ success: false, error: 'Buyer full name is required.' });
    return;
  }
  if (!phone || typeof phone !== 'string' || !phone.trim()) {
    res.status(400).json({ success: false, error: 'Phone number is required.' });
    return;
  }
  const qty = parseInt(ticketQuantity || quantity, 10);
  if (isNaN(qty) || qty < 1 || qty > 10) {
    res.status(400).json({ success: false, error: 'Ticket quantity must be an integer between 1 and 10.' });
    return;
  }

  const reqId = requestId || (req.headers['x-request-id'] as string) || `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  // 2. Idempotency Check: Return cached response if already processed
  try {
    const cachedIdempotency = await IdempotencyKey.findOne({ requestId: reqId });
    if (cachedIdempotency) {
      res.status(200).json({
        ...cachedIdempotency.response,
        idempotent: true
      });
      return;
    }
  } catch (err: any) {
    console.error('Idempotency lookup error:', err.message);
  }

  // 3. Authorization check for non-consecutive override
  if (allowNonConsecutive && req.user && !['manager', 'admin'].includes(req.user.role)) {
    res.status(403).json({
      success: false,
      error: 'Non-consecutive ticket allocation requires Manager or Admin authorization.'
    });
    return;
  }

  const performedByUser = {
    userId: req.user?.userId ? new mongoose.Types.ObjectId(req.user.userId) : undefined,
    name: req.user?.name || 'Box Office Staff',
    role: req.user?.role || 'sales'
  };

  // 4. Start MongoDB session & transaction
  let session: mongoose.ClientSession | null = null;
  let useTransactions = false;

  try {
    session = await mongoose.startSession();
    useTransactions = !!(mongoose.connection.db?.admin() && mongoose.connection.client.options.replicaSet);
    if (useTransactions) {
      session.startTransaction();
    }
  } catch {
    useTransactions = false;
    session = null;
  }

  try {
    // 5. Find first available consecutive ticket range using DSA sliding window
    const allocation = await findConsecutiveTickets(qty, session || undefined, allowNonConsecutive, startCode);
    if (!allocation.success || allocation.tickets.length !== qty) {
      if (useTransactions && session) await session.abortTransaction();
      res.status(400).json({
        success: false,
        error: allocation.error || `No consecutive block of ${qty} tickets is available.`,
        availableSingles: allocation.availableSingles
      });
      return;
    }

    const assignedTicketCodes = allocation.tickets.map(t => t.code);
    const assignedTicketIds = allocation.tickets.map(t => t._id);

    // 6. Recheck ticket status inside transaction (prevent race conditions)
    const recheckQuery = Ticket.find({
      _id: { $in: assignedTicketIds },
      status: 'available',
      bookingId: null
    });
    if (session) recheckQuery.session(session);
    const verifiedAvailable = await recheckQuery.exec();

    if (verifiedAvailable.length !== qty) {
      if (useTransactions && session) await session.abortTransaction();
      res.status(409).json({
        success: false,
        error: 'Concurrency conflict: One or more selected tickets were reserved by another transaction. Please try again.'
      });
      return;
    }

    // 7. Create booking document
    const bookingCode = await generateBookingCode();
    const [booking] = await Booking.create(
      [
        {
          bookingCode,
          buyerName: buyerName.trim(),
          phone: phone.trim(),
          email: email.trim(),
          ticketQuantity: qty,
          ticketCodes: assignedTicketCodes,
          paymentStatus,
          totalAmount: Number(totalAmount) || 0,
          notes: notes.trim(),
          createdBy: performedByUser
        }
      ],
      session ? { session } : {}
    );

    // 8. Update selected ticket documents
    await Ticket.updateMany(
      { _id: { $in: assignedTicketIds } },
      {
        $set: {
          bookingId: booking._id,
          status: 'active',
          entered: false,
          enteredAt: null,
          entryCount: 0
        },
        $inc: { version: 1 }
      },
      session ? { session } : {}
    );

    // 9. Write audit log (mandatory - if audit fails, main action fails)
    await AuditLog.create(
      [
        {
          requestId: reqId,
          action: 'CREATE_BOOKING',
          bookingId: booking._id,
          previousValue: { status: 'available' },
          newValue: {
            bookingCode,
            ticketCodes: assignedTicketCodes,
            buyerName: buyerName.trim(),
            quantity: qty
          },
          reason: notes.trim() || 'New ticket booking',
          performedBy: performedByUser
        }
      ],
      session ? { session } : {}
    );

    // 10. Save idempotency record (expires in 24 hours)
    const responsePayload = {
      success: true,
      booking,
      tickets: assignedTicketCodes,
      message: `Successfully booked ${qty} ticket${qty > 1 ? 's' : ''}: ${assignedTicketCodes.join(', ')}.`
    };

    await IdempotencyKey.create(
      [
        {
          requestId: reqId,
          action: 'CREATE_BOOKING',
          response: responsePayload,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      ],
      session ? { session } : {}
    );

    // 11. Commit transaction
    if (useTransactions && session) {
      await session.commitTransaction();
    }

    // 12. Return booking with assigned ticket codes
    res.status(201).json(responsePayload);
  } catch (err: any) {
    if (useTransactions && session) {
      await session.abortTransaction();
    }
    console.error('Booking creation error:', err);
    res.status(500).json({
      success: false,
      error: 'Sync Failed — no change was saved. ' + (err.message || 'Transaction aborted.')
    });
  } finally {
    if (session) {
      await session.endSession();
    }
  }
};

/**
 * POST /api/bookings/clear
 * Clear entire booking and return all associated tickets to available
 */
export const clearBooking = async (req: Request, res: Response): Promise<void> => {
  const { bookingCode, reason, confirmText } = req.body;

  if (!bookingCode || typeof bookingCode !== 'string') {
    res.status(400).json({ success: false, error: 'Valid bookingCode is required.' });
    return;
  }
  if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
    res.status(400).json({ success: false, error: 'A mandatory reason (minimum 10 characters) is required to clear a booking.' });
    return;
  }
  if (confirmText && confirmText.trim() !== bookingCode.trim()) {
    res.status(400).json({ success: false, error: 'Confirmation text must match the booking code.' });
    return;
  }

  const performedByUser = {
    userId: req.user?.userId ? new mongoose.Types.ObjectId(req.user.userId) : undefined,
    name: req.user?.name || 'Manager',
    role: req.user?.role || 'manager'
  };
  const requestId = (req.headers['x-request-id'] as string) || `req_${Date.now()}`;

  let session: mongoose.ClientSession | null = null;
  let useTransactions = false;

  try {
    session = await mongoose.startSession();
    useTransactions = !!(mongoose.connection.db?.admin() && mongoose.connection.client.options.replicaSet);
    if (useTransactions) session.startTransaction();
  } catch {
    session = null;
    useTransactions = false;
  }

  try {
    const booking = await Booking.findOne({ bookingCode: bookingCode.trim() });
    if (!booking) {
      if (useTransactions && session) await session.abortTransaction();
      res.status(404).json({ success: false, error: `Booking ${bookingCode} not found.` });
      return;
    }

    const previousCodes = [...booking.ticketCodes];

    // Release all tickets back to available
    await Ticket.updateMany(
      { bookingId: booking._id },
      {
        $set: {
          bookingId: null,
          status: 'available',
          entered: false,
          enteredAt: null,
          entryCount: 0
        },
        $inc: { version: 1 }
      },
      session ? { session } : {}
    );

    booking.paymentStatus = 'Cancelled';
    booking.notes = `${booking.notes ? booking.notes + ' | ' : ''}Cleared by ${performedByUser.name}: ${reason.trim()}`;
    await booking.save(session ? { session } : undefined);

    // Audit Log
    await AuditLog.create(
      [
        {
          requestId,
          action: 'CLEAR_BOOKING',
          bookingId: booking._id,
          previousValue: { ticketCodes: previousCodes, paymentStatus: 'Paid' },
          newValue: { ticketCodes: [], paymentStatus: 'Cancelled' },
          reason: reason.trim(),
          performedBy: performedByUser
        }
      ],
      session ? { session } : {}
    );

    if (useTransactions && session) await session.commitTransaction();

    res.json({
      success: true,
      message: `Booking ${bookingCode} cleared. Tickets (${previousCodes.join(', ')}) returned to available.`,
      clearedTickets: previousCodes
    });
  } catch (err: any) {
    if (useTransactions && session) await session.abortTransaction();
    res.status(500).json({
      success: false,
      error: 'Sync Failed — no change was saved. ' + err.message
    });
  } finally {
    if (session) await session.endSession();
  }
};
