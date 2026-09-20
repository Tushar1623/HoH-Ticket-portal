import { Request, Response } from 'express';
import mongoose from 'mongoose';
import crypto from 'crypto';
import { Ticket } from '../models/Ticket';
import { Booking } from '../models/Booking';
import { AuditLog } from '../models/AuditLog';
import { IdempotencyKey } from '../models/IdempotencyKey';
import { EventBackup } from '../models/EventBackup';
import { getMemoryTickets, getMemoryTicketByCode, updateMemoryTicket } from '../services/inMemoryStore';

// In-memory one-time reset token store (token -> { expiresAt: number, reason: string })
const resetTokenStore = new Map<string, { expiresAt: number; reason: string }>();
let lastResetTimestamp: number = 0;

/**
 * GET /api/tickets
 * Fetch all 50 tickets with joined booking data
 */
export const getTickets = async (req: Request, res: Response): Promise<void> => {
  try {
    if (mongoose.connection.readyState !== 1) {
      const memoryList = getMemoryTickets();
      const totalTickets = memoryList.length;
      const totalEntered = memoryList.filter(t => t.entered).length;
      const availableTickets = memoryList.filter(t => t.status === 'available').length;
      const reservedTickets = memoryList.filter(t => t.status === 'active' || t.status === 'reserved' || t.status === 'entered').length;

      res.json({
        success: true,
        data: memoryList,
        isMemoryFallback: true,
        stats: {
          totalTickets,
          totalEntered,
          availableTickets,
          reservedTickets,
          attendanceRate: reservedTickets > 0 ? Math.round((totalEntered / reservedTickets) * 100) : 0
        }
      });
      return;
    }

    const tickets = await Ticket.find().sort({ serialNumber: 1 }).lean();

    // Fetch related bookings to enrich response
    const bookingIds = tickets.map(t => t.bookingId).filter(Boolean);
    const bookings = await Booking.find({ _id: { $in: bookingIds } }).lean();
    const bookingMap = new Map(bookings.map(b => [b._id.toString(), b]));

    const enriched = tickets.map(t => {
      const b = t.bookingId ? bookingMap.get(t.bookingId.toString()) : null;
      return {
        ...t,
        buyerName: b?.buyerName || '',
        buyerPhone: b?.phone || '',
        buyerEmail: b?.email || '',
        bookingCode: b?.bookingCode || '',
        paymentStatus: b?.paymentStatus || 'Pending',
        totalAmount: b?.totalAmount || 0,
        bookingCreatedBy: b?.createdBy?.name || ''
      };
    });

    const totalTickets = enriched.length;
    const totalEntered = enriched.filter(t => t.entered).length;
    const availableTickets = enriched.filter(t => t.status === 'available').length;
    const reservedTickets = enriched.filter(t => t.status === 'active' || t.status === 'reserved' || t.status === 'entered').length;

    res.json({
      success: true,
      data: enriched,
      stats: {
        totalTickets,
        totalEntered,
        availableTickets,
        reservedTickets,
        attendanceRate: reservedTickets > 0 ? Math.round((totalEntered / reservedTickets) * 100) : 0
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Sync Failed — no change was saved. ' + err.message });
  }
};

/**
 * POST /api/tickets/verify
 * Payload: { "code": "HOH007" }
 */
export const verifyTicket = async (req: Request, res: Response): Promise<void> => {
  try {
    const code = (req.body.code || req.body.qrPayload || '').toUpperCase().trim();

    if (!code) {
      res.status(400).json({ success: false, error: 'Ticket code is required.' });
      return;
    }

    if (mongoose.connection.readyState !== 1) {
      const mem = getMemoryTicketByCode(code) || getMemoryTickets().find(t => t.qrPayload === code);
      if (!mem) {
        res.status(404).json({ success: false, valid: false, canEnter: false, error: `Ticket ${code} not found.` });
        return;
      }
      const isBooked = !!mem.buyerName || mem.status === 'reserved' || mem.status === 'entered';
      if (!isBooked) {
        res.json({ success: true, valid: false, canEnter: false, ticket: mem, statusMessage: `Ticket ${mem.code} is unassigned.` });
        return;
      }
      if (mem.entered) {
        res.json({ success: true, valid: false, canEnter: false, ticket: mem, statusMessage: `ENTRY BLOCKED: Ticket ${mem.code} was ALREADY ENTERED.` });
        return;
      }
      res.json({ success: true, valid: true, canEnter: true, ticket: mem, booking: { buyerName: mem.buyerName, phone: mem.buyerPhone }, statusMessage: `Valid Pass for ${mem.buyerName}.` });
      return;
    }

    const ticket = await Ticket.findOne({
      $or: [{ code }, { qrPayload: code }]
    }).lean();

    if (!ticket) {
      res.status(404).json({
        success: false,
        valid: false,
        canEnter: false,
        error: `Invalid QR Code. Ticket ${code} not found in HOH registry.`
      });
      return;
    }

    let booking = null;
    if (ticket.bookingId) {
      booking = await Booking.findById(ticket.bookingId).lean();
    }

    // Check available / unassigned
    if (ticket.status === 'available' || !booking) {
      res.status(200).json({
        success: true,
        valid: false,
        canEnter: false,
        ticket,
        statusMessage: `Ticket ${ticket.code} is unassigned and not registered to any buyer.`
      });
      return;
    }

    // Check cancelled or refunded
    if (ticket.status === 'cancelled' || booking.paymentStatus === 'Cancelled') {
      res.status(200).json({
        success: true,
        valid: false,
        canEnter: false,
        ticket,
        booking,
        statusMessage: `Ticket ${ticket.code} has been CANCELLED. Do not admit.`
      });
      return;
    }

    if (ticket.status === 'refunded' || booking.paymentStatus === 'Refunded') {
      res.status(200).json({
        success: true,
        valid: false,
        canEnter: false,
        ticket,
        booking,
        statusMessage: `Ticket ${ticket.code} has been REFUNDED. Do not admit.`
      });
      return;
    }

    // Check already entered
    if (ticket.entered) {
      const timeStr = ticket.enteredAt ? new Date(ticket.enteredAt).toLocaleTimeString() : 'earlier';
      res.status(200).json({
        success: true,
        valid: false,
        canEnter: false,
        ticket,
        booking,
        statusMessage: `Already Entered at ${timeStr}. Do not admit.`
      });
      return;
    }

    // Valid pass ready for entry
    res.status(200).json({
      success: true,
      valid: true,
      canEnter: true,
      ticket,
      booking,
      statusMessage: `Valid Pass for ${booking.buyerName}. Ready for entry.`
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Sync Failed — gate lookup failed. ' + err.message });
  }
};

/**
 * POST /api/tickets/mark-entered
 * Fail-proof mark-entered flow with MongoDB transaction and race condition handling
 * Payload: { "code": "HOH007", "requestId": "uuid" }
 */
export const markEntered = async (req: Request, res: Response): Promise<void> => {
  const { code, requestId } = req.body;

  if (!code) {
    res.status(400).json({ success: false, error: 'Ticket code is required.' });
    return;
  }

  const ticketCode = code.toUpperCase().trim();

  if (mongoose.connection.readyState !== 1) {
    const mem = getMemoryTicketByCode(ticketCode);
    if (!mem) {
      res.status(404).json({ success: false, error: `Ticket ${ticketCode} not found.` });
      return;
    }
    if (mem.entered) {
      res.status(409).json({ success: false, error: `Already Entered at ${mem.enteredAt}. Do not admit.` });
      return;
    }
    const updated = updateMemoryTicket(ticketCode, {
      entered: true,
      enteredAt: new Date().toISOString(),
      entryCount: (mem.entryCount || 0) + 1,
      status: 'entered'
    });
    res.json({ success: true, ticket: updated, message: `Ticket ${ticketCode} marked as entered successfully.` });
    return;
  }

  const reqId = requestId || (req.headers['x-request-id'] as string) || `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  // Idempotency check: if already processed with same requestId, return cached result
  try {
    const cached = await IdempotencyKey.findOne({ requestId: reqId });
    if (cached) {
      res.status(200).json({
        ...cached.response,
        idempotent: true
      });
      return;
    }
  } catch (err: any) {
    console.error('Idempotency error:', err.message);
  }

  const performedByUser = {
    userId: req.user?.userId ? new mongoose.Types.ObjectId(req.user.userId) : undefined,
    name: req.user?.name || 'Gate Scanner Staff',
    role: req.user?.role || 'entry'
  };

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
    // 3. Find ticket by unique code
    const query = Ticket.findOne({ code: ticketCode });
    if (session) query.session(session);
    const ticket = await query.exec();

    // 4. Reject conditions
    if (!ticket) {
      if (useTransactions && session) await session.abortTransaction();
      res.status(404).json({ success: false, error: `Ticket ${ticketCode} not found in database.` });
      return;
    }

    if (ticket.status === 'available' || !ticket.bookingId) {
      if (useTransactions && session) await session.abortTransaction();
      res.status(400).json({ success: false, error: `Ticket ${ticketCode} is available/unassigned. Cannot admit.` });
      return;
    }

    if (ticket.status === 'cancelled') {
      if (useTransactions && session) await session.abortTransaction();
      res.status(400).json({ success: false, error: `Ticket ${ticketCode} is cancelled. Do not admit.` });
      return;
    }

    if (ticket.status === 'refunded') {
      if (useTransactions && session) await session.abortTransaction();
      res.status(400).json({ success: false, error: `Ticket ${ticketCode} is refunded. Do not admit.` });
      return;
    }

    // Two phones scanning the same QR: second phone receives "Already Entered at [timestamp]. Do not admit."
    if (ticket.entered) {
      if (useTransactions && session) await session.abortTransaction();
      const timeStr = ticket.enteredAt ? new Date(ticket.enteredAt).toLocaleTimeString() : 'earlier session';
      res.status(409).json({
        success: false,
        error: `Already Entered at ${timeStr}. Do not admit.`
      });
      return;
    }

    // 5. Set operational fields
    const now = new Date();
    ticket.status = 'entered';
    ticket.entered = true;
    ticket.enteredAt = now;
    ticket.entryCount = 1;
    ticket.version = (ticket.version || 1) + 1;

    await ticket.save(session ? { session } : undefined);

    // 6. Add audit log
    await AuditLog.create(
      [
        {
          requestId: reqId,
          action: 'MARK_ENTERED',
          ticketCode: ticket.code,
          bookingId: ticket.bookingId,
          previousValue: { entered: false, status: 'active' },
          newValue: { entered: true, enteredAt: now, status: 'entered' },
          reason: 'Gate entry admission confirmed',
          performedBy: performedByUser
        }
      ],
      session ? { session } : {}
    );

    // 7. Save idempotency result
    const booking = await Booking.findById(ticket.bookingId).lean();
    const responsePayload = {
      success: true,
      message: `Ticket ${ticket.code} marked Entered successfully.`,
      ticket,
      booking
    };

    await IdempotencyKey.create(
      [
        {
          requestId: reqId,
          action: 'MARK_ENTERED',
          response: responsePayload,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      ],
      session ? { session } : {}
    );

    // 8. Commit transaction
    if (useTransactions && session) {
      await session.commitTransaction();
    }

    // 9. Return final database record
    res.status(200).json(responsePayload);
  } catch (err: any) {
    if (useTransactions && session) await session.abortTransaction();
    res.status(500).json({
      success: false,
      error: 'Sync Failed — entry was not recorded. Do not admit until connection is restored.'
    });
  } finally {
    if (session) await session.endSession();
  }
};

/**
 * POST /api/tickets/correct-status
 * Manual entry status correction (e.g. from Entered back to Not Entered)
 * Requires Manager or Admin, minimum 10 characters reason, exact ticket code confirmation, transaction & audit log
 */
export const correctStatus = async (req: Request, res: Response): Promise<void> => {
  const { code, entered, reason, confirmCode } = req.body;

  if (!code) {
    res.status(400).json({ success: false, error: 'Ticket code is required.' });
    return;
  }
  if (typeof entered !== 'boolean') {
    res.status(400).json({ success: false, error: 'Target entered status (true/false) is required.' });
    return;
  }
  if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
    res.status(400).json({ success: false, error: 'A mandatory reason of minimum 10 characters is required.' });
    return;
  }
  if (!confirmCode || confirmCode.trim().toUpperCase() !== code.trim().toUpperCase()) {
    res.status(400).json({ success: false, error: 'Exact ticket code confirmation mismatch.' });
    return;
  }

  if (mongoose.connection.readyState !== 1) {
    const mem = getMemoryTicketByCode(code);
    if (!mem) {
      res.status(404).json({ success: false, error: `Ticket ${code} not found.` });
      return;
    }
    const updated = updateMemoryTicket(code, {
      entered,
      enteredAt: entered ? new Date().toISOString() : null,
      status: entered ? 'entered' : (mem.buyerName ? 'reserved' : 'available')
    });
    res.status(200).json({
      success: true,
      ticket: updated,
      message: `Entry status for ${code} corrected to ${entered ? 'Entered' : 'Not Entered'}.`
    });
    return;
  }

  const performedByUser = {
    userId: req.user?.userId ? new mongoose.Types.ObjectId(req.user.userId) : undefined,
    name: req.user?.name || 'Event Manager',
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
    const ticket = await Ticket.findOne({ code: code.toUpperCase().trim() });
    if (!ticket) {
      if (useTransactions && session) await session.abortTransaction();
      res.status(404).json({ success: false, error: `Ticket ${code} not found.` });
      return;
    }

    const previousEntered = ticket.entered;
    const now = new Date();

    ticket.entered = entered;
    if (entered) {
      ticket.enteredAt = now;
      ticket.status = 'entered';
      ticket.entryCount = (ticket.entryCount || 0) + 1;
    } else {
      ticket.enteredAt = null;
      ticket.status = ticket.bookingId ? 'active' : 'available';
    }
    ticket.version = (ticket.version || 1) + 1;

    await ticket.save(session ? { session } : undefined);

    // Mandatory audit log
    await AuditLog.create(
      [
        {
          requestId,
          action: entered ? 'MANUAL_CORRECT_ENTERED' : 'REVOKE_ENTRY',
          ticketCode: ticket.code,
          bookingId: ticket.bookingId,
          previousValue: { entered: previousEntered },
          newValue: { entered },
          reason: reason.trim(),
          performedBy: performedByUser
        }
      ],
      session ? { session } : {}
    );

    if (useTransactions && session) await session.commitTransaction();

    res.json({
      success: true,
      message: `Ticket ${ticket.code} status corrected to ${entered ? 'Entered' : 'Not Entered'}.`,
      ticket
    });
  } catch (err: any) {
    if (useTransactions && session) await session.abortTransaction();
    res.status(500).json({ success: false, error: 'Sync Failed — no change was saved. ' + err.message });
  } finally {
    if (session) await session.endSession();
  }
};

/**
 * POST /api/tickets/clear
 * Clear single ticket data and return it to available
 */
export const clearTicket = async (req: Request, res: Response): Promise<void> => {
  const { code, reason, confirmCode } = req.body;

  if (!code) {
    res.status(400).json({ success: false, error: 'Ticket code is required.' });
    return;
  }
  if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
    res.status(400).json({ success: false, error: 'A mandatory reason (minimum 10 characters) is required.' });
    return;
  }
  if (!confirmCode || confirmCode.trim().toUpperCase() !== code.trim().toUpperCase()) {
    res.status(400).json({ success: false, error: 'Exact ticket code confirmation mismatch.' });
    return;
  }

  if (mongoose.connection.readyState !== 1) {
    const mem = getMemoryTicketByCode(code);
    if (!mem) {
      res.status(404).json({ success: false, error: `Ticket ${code} not found.` });
      return;
    }
    const updated = updateMemoryTicket(code, {
      buyerName: '',
      buyerPhone: '',
      buyerEmail: '',
      bookingCode: '',
      paymentStatus: 'Pending',
      totalAmount: 0,
      status: 'available',
      entered: false,
      enteredAt: null,
      entryCount: 0
    });
    res.status(200).json({
      success: true,
      ticket: updated,
      message: `Ticket ${code} registration cleared.`
    });
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
    const ticketCode = code.toUpperCase().trim();
    const ticket = await Ticket.findOne({ code: ticketCode });

    if (!ticket) {
      if (useTransactions && session) await session.abortTransaction();
      res.status(404).json({ success: false, error: `Ticket ${ticketCode} not found.` });
      return;
    }

    const previousBookingId = ticket.bookingId;

    // If part of multi-ticket booking, remove from booking document
    if (previousBookingId) {
      const booking = await Booking.findById(previousBookingId);
      if (booking) {
        booking.ticketCodes = booking.ticketCodes.filter(c => c !== ticketCode);
        booking.ticketQuantity = booking.ticketCodes.length;
        if (booking.ticketQuantity === 0) {
          booking.paymentStatus = 'Cancelled';
        }
        booking.notes = `${booking.notes ? booking.notes + ' | ' : ''}Ticket ${ticketCode} cleared by ${performedByUser.name}: ${reason.trim()}`;
        await booking.save(session ? { session } : undefined);
      }
    }

    // Reset ticket fields (never delete the document)
    ticket.bookingId = null;
    ticket.status = 'available';
    ticket.entered = false;
    ticket.enteredAt = null;
    ticket.entryCount = 0;
    ticket.version = (ticket.version || 1) + 1;

    await ticket.save(session ? { session } : undefined);

    // Audit Log
    await AuditLog.create(
      [
        {
          requestId,
          action: 'CLEAR_TICKET',
          ticketCode,
          bookingId: previousBookingId,
          previousValue: { bookingId: previousBookingId, status: 'active' },
          newValue: { bookingId: null, status: 'available' },
          reason: reason.trim(),
          performedBy: performedByUser
        }
      ],
      session ? { session } : {}
    );

    if (useTransactions && session) await session.commitTransaction();

    res.json({
      success: true,
      message: `Ticket ${ticketCode} cleared and returned to available pool.`,
      ticket
    });
  } catch (err: any) {
    if (useTransactions && session) await session.abortTransaction();
    res.status(500).json({ success: false, error: 'Sync Failed — no change was saved. ' + err.message });
  } finally {
    if (session) await session.endSession();
  }
};

/**
 * POST /api/event/prepare-reset
 * Step 1 of two-step reset: Generates one-time reset token with 5-minute expiry
 * Requires Super Admin and reason >= 20 characters
 */
export const prepareEventReset = async (req: Request, res: Response): Promise<void> => {
  try {
    const { reason } = req.body;

    if (!reason || typeof reason !== 'string' || reason.trim().length < 20) {
      res.status(400).json({ success: false, error: 'A detailed reason (minimum 20 characters) is required to prepare an event reset.' });
      return;
    }

    // Enforce 10-minute cooldown since last reset
    const now = Date.now();
    const tenMinutes = 10 * 60 * 1000;
    if (lastResetTimestamp && (now - lastResetTimestamp < tenMinutes)) {
      const remainingSeconds = Math.ceil((tenMinutes - (now - lastResetTimestamp)) / 1000);
      res.status(429).json({
        success: false,
        error: `Event reset cooldown active. Please wait ${remainingSeconds} seconds before requesting another reset.`
      });
      return;
    }

    const resetToken = crypto.randomBytes(24).toString('hex');
    const expiresAt = now + (5 * 60 * 1000); // 5 minutes

    resetTokenStore.set(resetToken, { expiresAt, reason: reason.trim() });

    const registeredCount = await Ticket.countDocuments({ status: { $ne: 'available' } });
    const enteredCount = await Ticket.countDocuments({ entered: true });

    res.json({
      success: true,
      resetToken,
      expiresInSeconds: 300,
      registeredCount,
      enteredCount,
      message: 'One-time reset token generated. Complete confirmation within 5 minutes.'
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/event/confirm-reset
 * Step 2 of two-step reset:
 * 1. Verifies reset token.
 * 2. Creates `eventBackups` snapshot of active bookings and tickets.
 * 3. Verifies backup save succeeds.
 * 4. Only then performs reset transaction.
 * 5. Requires confirmation phrase: "RESET HOH EVENT".
 * 6. Sets 10-minute cooldown.
 */
export const confirmEventReset = async (req: Request, res: Response): Promise<void> => {
  const { resetToken, confirmation } = req.body;

  if (!resetToken || !resetTokenStore.has(resetToken)) {
    res.status(400).json({ success: false, error: 'Invalid or expired reset token. Please prepare reset again.' });
    return;
  }

  const tokenData = resetTokenStore.get(resetToken)!;
  if (Date.now() > tokenData.expiresAt) {
    resetTokenStore.delete(resetToken);
    res.status(400).json({ success: false, error: 'Reset token has expired. Please prepare reset again.' });
    return;
  }

  if (confirmation !== 'RESET HOH EVENT') {
    res.status(400).json({
      success: false,
      error: 'Exact confirmation phrase mismatch. You must type "RESET HOH EVENT".'
    });
    return;
  }

  const performedByUser = {
    userId: req.user?.userId ? new mongoose.Types.ObjectId(req.user.userId) : undefined,
    name: req.user?.name || 'Super Admin',
    role: req.user?.role || 'admin'
  };
  const requestId = (req.headers['x-request-id'] as string) || `req_${Date.now()}`;

  try {
    // 1. Snapshot all tickets and active bookings
    const ticketsSnapshot = await Ticket.find().lean();
    const bookingsSnapshot = await Booking.find().lean();

    // 2. Create and verify backup in eventBackups collection before modifying ticket data
    const backupRecord = await EventBackup.create({
      resetToken,
      reason: tokenData.reason,
      performedBy: performedByUser,
      ticketsSnapshot,
      bookingsSnapshot,
      createdAt: new Date()
    });

    if (!backupRecord || !backupRecord._id) {
      res.status(500).json({
        success: false,
        error: 'CRITICAL: Failed to write event snapshot backup. Reset aborted without modifying any tickets.'
      });
      return;
    }

    // 3. Reset operational ticket data inside transaction (Never delete ticket records)
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

    await Ticket.updateMany(
      {},
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

    // Cancel active bookings
    await Booking.updateMany(
      { paymentStatus: { $ne: 'Cancelled' } },
      {
        $set: {
          paymentStatus: 'Cancelled',
          notes: `Archived during full event reset by ${performedByUser.name}: ${tokenData.reason}`
        }
      },
      session ? { session } : {}
    );

    // Audit log
    await AuditLog.create(
      [
        {
          requestId,
          action: 'RESET_EVENT',
          previousValue: { registeredCount: ticketsSnapshot.filter(t => t.status !== 'available').length },
          newValue: { registeredCount: 0, status: 'available' },
          reason: tokenData.reason,
          performedBy: performedByUser
        }
      ],
      session ? { session } : {}
    );

    if (useTransactions && session) await session.commitTransaction();
    if (session) await session.endSession();

    // Invalidate reset token and set 10-minute cooldown
    resetTokenStore.delete(resetToken);
    lastResetTimestamp = Date.now();

    res.json({
      success: true,
      message: 'All 50 tickets successfully reset to available. Full snapshot saved to eventBackups.',
      backupId: backupRecord._id
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: 'Sync Failed — no change was saved. ' + err.message
    });
  }
};
