import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { Ticket } from '../models/Ticket';
import { Booking } from '../models/Booking';
import { Counter } from '../models/Counter';
import { EventBackup } from '../models/EventBackup';
import { logAudit } from '../services/auditService';
import { fastCache } from '../services/cacheService';

/**
 * Helper to safely extract string param from Express 5 req.params/req.body
 */
function extractParam(val: any): string {
  if (Array.isArray(val)) return String(val[0] || '').trim();
  return String(val || '').trim();
}

/**
 * Helper to ensure MongoDB is ready
 */
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
 * GET /api/dashboard
 * Live statistics calculated directly from MongoDB
 */
export const getDashboardStats = async (req: Request, res: Response): Promise<void> => {
  if (!isDbReady()) {
    res.status(503).json(DB_UNAVAILABLE_RESPONSE);
    return;
  }

  try {
    const totalTickets = await Ticket.countDocuments();
    const available = await Ticket.countDocuments({
      status: 'available',
      bookingId: null
    });
    const registered = await Ticket.countDocuments({
      status: { $in: ['registered', 'entered'] },
      bookingId: { $ne: null }
    });
    const entered = await Ticket.countDocuments({
      status: 'entered',
      entered: true
    });
    const notEntered = await Ticket.countDocuments({
      status: 'registered',
      bookingId: { $ne: null }
    });
    const cancelled = await Ticket.countDocuments({
      status: 'cancelled'
    });
    const attendanceRate = registered > 0 ? Math.round((entered / registered) * 100) : 0;

    // Financial & Booking Totals
    const allBookings = await Booking.find({}).lean();
    const totalBookings = allBookings.length;
    const totalTicketsSold = allBookings.reduce((sum, b) => sum + (b.ticketQuantity || 0), 0);
    const totalRevenue = allBookings
      .filter(b => b.paymentStatus !== 'Cancelled' && b.paymentStatus !== 'Refunded')
      .reduce((sum, b) => sum + (b.amountPaid ?? b.totalAmount ?? 0), 0);

    // Today's Sales Calculation
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const todayBookings = allBookings.filter(b => new Date(b.createdAt) >= startOfToday);
    const todayTicketsSold = todayBookings.reduce((sum, b) => sum + (b.ticketQuantity || 0), 0);
    const todayRevenue = todayBookings
      .filter(b => b.paymentStatus !== 'Cancelled' && b.paymentStatus !== 'Refunded')
      .reduce((sum, b) => sum + (b.amountPaid ?? b.totalAmount ?? 0), 0);

    const cashRevenue = todayBookings
      .filter(b => (b.paymentMethod === 'CASH' || !b.paymentMethod) && b.paymentStatus !== 'Cancelled')
      .reduce((sum, b) => sum + (b.amountPaid ?? b.totalAmount ?? 0), 0);

    const upiRevenue = todayBookings
      .filter(b => b.paymentMethod === 'UPI' && b.paymentStatus !== 'Cancelled')
      .reduce((sum, b) => sum + (b.amountPaid ?? b.totalAmount ?? 0), 0);

    const otherRevenue = todayBookings
      .filter(b => (b.paymentMethod === 'CARD' || b.paymentMethod === 'OTHER') && b.paymentStatus !== 'Cancelled')
      .reduce((sum, b) => sum + (b.amountPaid ?? b.totalAmount ?? 0), 0);

    const pendingRevenue = todayBookings
      .filter(b => (b.paymentStatus === 'Pending' || b.paymentStatus === 'PENDING' || b.paymentStatus === 'PARTIAL'))
      .reduce((sum, b) => sum + Math.max(0, (b.totalAmount || 0) - (b.amountPaid || 0)), 0);

    const payload = {
      success: true,
      data: {
        totalTickets,
        registered,
        available,
        entered,
        notEntered,
        cancelled,
        attendanceRate,
        totalBookings,
        totalTicketsSold,
        totalRevenue,
        todaySales: {
          ticketsSold: todayTicketsSold,
          bookings: todayBookings.length,
          revenue: todayRevenue,
          cash: cashRevenue,
          upi: upiRevenue,
          other: otherRevenue,
          pending: pendingRevenue
        }
      }
    };
    res.json(payload);
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: {
        code: 'STATS_ERROR',
        message: 'Failed to compute dashboard stats: ' + err.message
      }
    });
  }
};

/**
 * GET /api/tickets
 * Fetch tickets from MongoDB with optional search and filter
 */
export const getTickets = async (req: Request, res: Response): Promise<void> => {
  if (!isDbReady()) {
    res.status(503).json(DB_UNAVAILABLE_RESPONSE);
    return;
  }

  try {
    const { search, status, entered } = req.query;

    const query: any = {};

    if (status && typeof status === 'string') {
      const s = status.toLowerCase();
      if (s === 'available') {
        query.status = 'available';
        query.bookingId = null;
      } else if (s === 'registered') {
        query.status = { $in: ['registered', 'entered'] };
        query.bookingId = { $ne: null };
      } else if (s === 'entered') {
        query.status = 'entered';
        query.entered = true;
      } else if (s === 'not-entered') {
        query.status = 'registered';
        query.entered = false;
        query.bookingId = { $ne: null };
      } else if (s === 'cancelled') {
        query.status = 'cancelled';
      }
    }

    if (entered !== undefined) {
      query.entered = entered === 'true';
    }

    if (search && typeof search === 'string' && search.trim()) {
      const term = search.trim();
      const regex = new RegExp(term, 'i');
      query.$or = [
        { code: regex },
        { buyerName: regex },
        { phone: regex },
        { email: regex }
      ];
    }

    const tickets = await Ticket.find(query).sort({ serialNumber: 1 }).lean();

    // Enrich with booking code and payment details
    const bookingIds = tickets.map(t => t.bookingId).filter(Boolean);
    const bookings = bookingIds.length > 0 ? await Booking.find({ _id: { $in: bookingIds } }).lean() : [];
    const bookingMap = new Map(bookings.map(b => [b._id.toString(), b]));

    const enriched = tickets.map(t => {
      const b = t.bookingId ? bookingMap.get(t.bookingId.toString()) : null;
      return {
        ...t,
        status: t.status,
        buyerName: t.buyerName || b?.buyerName || '',
        phone: t.phone || b?.phone || '',
        email: t.email || b?.email || '',
        bookingCode: b?.bookingCode || '',
        paymentStatus: b?.paymentStatus || 'Paid',
        totalAmount: b?.totalAmount || 0
      };
    });

    // Compute exact stats directly from MongoDB
    const totalTickets = await Ticket.countDocuments();
    const availableCount = await Ticket.countDocuments({ status: 'available', bookingId: null });
    const registeredCount = await Ticket.countDocuments({ status: { $in: ['registered', 'entered'] }, bookingId: { $ne: null } });
    const enteredCount = await Ticket.countDocuments({ status: 'entered', entered: true });
    const notEnteredCount = await Ticket.countDocuments({ status: 'registered', bookingId: { $ne: null } });
    const cancelledCount = await Ticket.countDocuments({ status: 'cancelled' });
    const attendanceRate = registeredCount > 0 ? Math.round((enteredCount / registeredCount) * 100) : 0;

    res.json({
      success: true,
      count: enriched.length,
      data: enriched,
      tickets: enriched,
      stats: {
        totalTickets,
        registered: registeredCount,
        available: availableCount,
        entered: enteredCount,
        notEntered: notEnteredCount,
        cancelled: cancelledCount,
        attendanceRate
      }
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_TICKETS_ERROR',
        message: 'Failed to fetch tickets from MongoDB: ' + err.message
      }
    });
  }
};

/**
 * GET /api/tickets/:code
 * Single ticket lookup
 */
export const getTicketByCode = async (req: Request, res: Response): Promise<void> => {
  if (!isDbReady()) {
    res.status(503).json(DB_UNAVAILABLE_RESPONSE);
    return;
  }

  try {
    const code = extractParam(req.params.code).toUpperCase();
    const ticket = await Ticket.findOne({
      $or: [{ code }, { qrPayload: code }]
    }).lean();

    if (!ticket) {
      res.status(404).json({
        success: false,
        error: {
          code: 'TICKET_NOT_FOUND',
          message: `Ticket ${code} was not found in the event database.`
        }
      });
      return;
    }

    let booking = null;
    if (ticket.bookingId) {
      booking = await Booking.findById(ticket.bookingId).lean();
    }

    res.json({
      success: true,
      data: {
        ...ticket,
        bookingCode: booking?.bookingCode || '',
        paymentStatus: booking?.paymentStatus || 'Paid',
        totalAmount: booking?.totalAmount || 0
      }
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: {
        code: 'LOOKUP_ERROR',
        message: 'Error looking up ticket: ' + err.message
      }
    });
  }
};

/**
 * PUT /api/tickets/:code/entry
 * Manual Entry: Mark ticket as ENTERED
 */
export const markTicketEntered = async (req: Request, res: Response): Promise<void> => {
  if (!isDbReady()) {
    res.status(503).json(DB_UNAVAILABLE_RESPONSE);
    return;
  }

  try {
    const code = extractParam(req.params.code || req.body.code).toUpperCase();

    if (!code) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_CODE', message: 'Ticket code is required.' }
      });
      return;
    }

    const existing = await Ticket.findOne({ code });
    if (!existing) {
      res.status(404).json({
        success: false,
        error: { code: 'TICKET_NOT_FOUND', message: `Ticket ${code} not found.` }
      });
      return;
    }

    if (existing.status !== 'registered' && existing.status !== 'entered' && !existing.buyerName) {
      res.status(400).json({
        success: false,
        error: {
          code: 'CANNOT_ENTER_UNREGISTERED',
          message: `Ticket ${code} is ${existing.status.toUpperCase()}. Only registered tickets can be marked as ENTERED.`
        }
      });
      return;
    }

    const now = new Date();
    const ticket = await Ticket.findOneAndUpdate(
      { code },
      { $set: { status: 'entered', entered: true, enteredAt: now, entryCount: 1 } },
      { new: true }
    );

    logAudit({
      action: 'MARK_ENTERED',
      ticketCode: code,
      bookingId: ticket?.bookingId,
      newValue: { entered: true, enteredAt: now, entryCount: 1 },
      adminUsername: req.user?.username
    });

    fastCache.invalidateAll();
    res.json({
      success: true,
      message: `Ticket ${code} marked as ENTERED.`,
      data: ticket,
      ticket
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: { code: 'UPDATE_ERROR', message: 'Failed to update entry status: ' + err.message }
    });
  }
};

/**
 * POST /api/tickets/verify
 * QR verification returning minimal gate information
 */
export const verifyTicket = async (req: Request, res: Response): Promise<void> => {
  if (!isDbReady()) {
    res.status(503).json(DB_UNAVAILABLE_RESPONSE);
    return;
  }

  try {
    const code = extractParam(req.body.code || req.query.code || req.params.code).toUpperCase();
    if (!code) {
      res.status(400).json({ ok: false, error: 'Ticket code is required' });
      return;
    }

    const ticket = await Ticket.findOne({
      $or: [{ code }, { qrPayload: code }]
    }).lean();

    if (!ticket) {
      res.status(404).json({ ok: false, error: `Ticket ${code} was not found in database.` });
      return;
    }

    let booking = null;
    if (ticket.bookingId) {
      booking = await Booking.findById(ticket.bookingId).lean();
    }

    res.json({
      ok: true,
      ticket: {
        code: ticket.code,
        buyerName: ticket.buyerName || (booking?.buyerName || ''),
        bookingCode: booking?.bookingCode || '',
        status: ticket.status,
        entered: ticket.entered,
        enteredAt: ticket.enteredAt,
        guestsAllowed: ticket.guestsAllowed || 1
      }
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

/**
 * PUT /api/tickets/:code/not-entry
 * Manual Entry Undo: Mark ticket as NOT ENTERED (returns to registered)
 */
export const markTicketNotEntered = async (req: Request, res: Response): Promise<void> => {
  if (!isDbReady()) {
    res.status(503).json(DB_UNAVAILABLE_RESPONSE);
    return;
  }

  try {
    const code = extractParam(req.params.code || req.body.code).toUpperCase();

    if (!code) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_CODE', message: 'Ticket code is required.' }
      });
      return;
    }

    const ticket = await Ticket.findOneAndUpdate(
      { code },
      { $set: { status: 'registered', entered: false, enteredAt: null, entryCount: 0 } },
      { new: true }
    );

    if (!ticket) {
      res.status(404).json({
        success: false,
        error: { code: 'TICKET_NOT_FOUND', message: `Ticket ${code} not found.` }
      });
      return;
    }

    logAudit({
      action: 'MARK_NOT_ENTERED',
      ticketCode: code,
      bookingId: ticket.bookingId,
      newValue: { entered: false, enteredAt: null },
      adminUsername: req.user?.username
    });

    fastCache.invalidateAll();
    res.json({
      success: true,
      message: `Ticket ${code} marked as NOT ENTERED.`,
      data: ticket,
      ticket
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: { code: 'UPDATE_ERROR', message: 'Failed to update entry status: ' + err.message }
    });
  }
};

/**
 * POST /api/tickets/entry-status (Compatibility endpoint)
 */
export const setEntryStatus = async (req: Request, res: Response): Promise<void> => {
  const { code, entered } = req.body;
  req.params.code = code;
  if (entered) {
    return markTicketEntered(req, res);
  } else {
    return markTicketNotEntered(req, res);
  }
};

/**
 * PUT /api/tickets/:code & POST /api/tickets/update
 * Admin edit ticket customer details
 */
export const updateTicket = async (req: Request, res: Response): Promise<void> => {
  if (!isDbReady()) {
    res.status(503).json(DB_UNAVAILABLE_RESPONSE);
    return;
  }

  try {
    const code = extractParam(req.params.code || req.body.code).toUpperCase();
    const { buyerName, phone, email, paymentStatus, totalAmount, notes } = req.body;

    if (!code) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_CODE', message: 'Ticket code is required.' }
      });
      return;
    }

    const ticket = await Ticket.findOne({ code });
    if (!ticket) {
      res.status(404).json({
        success: false,
        error: { code: 'TICKET_NOT_FOUND', message: `Ticket ${code} not found.` }
      });
      return;
    }

    let booking = ticket.bookingId ? await Booking.findById(ticket.bookingId) : null;

    if (!booking && buyerName) {
      const { getNextBookingCode } = await import('../models/Counter');
      const bookingCode = await getNextBookingCode();
      booking = await Booking.create({
        bookingCode,
        buyerName: buyerName.trim(),
        phone: (phone || '').trim(),
        email: (email || '').trim(),
        ticketQuantity: 1,
        ticketCodes: [ticket.code],
        paymentStatus: paymentStatus || 'Paid',
        totalAmount: Number(totalAmount) || 500,
        notes: notes || ''
      });
      ticket.bookingId = booking._id;
    } else if (booking) {
      if (buyerName !== undefined) booking.buyerName = buyerName.trim();
      if (phone !== undefined) booking.phone = phone.trim();
      if (email !== undefined) booking.email = email.trim();
      if (paymentStatus) booking.paymentStatus = paymentStatus;
      if (totalAmount !== undefined) booking.totalAmount = Number(totalAmount);
      if (notes !== undefined) booking.notes = notes;
      await booking.save();
    }

    if (buyerName !== undefined) ticket.buyerName = buyerName.trim() || null;
    if (phone !== undefined) ticket.phone = phone.trim() || null;
    if (email !== undefined) ticket.email = email.trim() || null;
    ticket.status = ticket.entered ? 'entered' : (ticket.buyerName ? 'registered' : 'available');

    await ticket.save();

    logAudit({
      action: 'EDIT_TICKET',
      ticketCode: code,
      bookingId: ticket.bookingId,
      adminUsername: req.user?.username,
      newValue: { buyerName: ticket.buyerName, phone: ticket.phone }
    });

    fastCache.invalidateAll();
    res.json({
      success: true,
      message: `Ticket ${code} updated successfully.`,
      data: {
        ...ticket.toObject(),
        bookingCode: booking?.bookingCode || '',
        paymentStatus: booking?.paymentStatus || 'Paid',
        totalAmount: booking?.totalAmount || 0
      },
      ticket: {
        ...ticket.toObject(),
        bookingCode: booking?.bookingCode || '',
        paymentStatus: booking?.paymentStatus || 'Paid',
        totalAmount: booking?.totalAmount || 0
      }
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: { code: 'UPDATE_ERROR', message: 'Failed to update ticket: ' + err.message }
    });
  }
};

/**
 * DELETE /api/tickets/:code/booking & POST /api/tickets/clear
 * Clear single ticket's booking and return to AVAILABLE
 */
export const clearTicketBooking = async (req: Request, res: Response): Promise<void> => {
  if (!isDbReady()) {
    res.status(503).json(DB_UNAVAILABLE_RESPONSE);
    return;
  }

  try {
    const code = extractParam(req.params.code || req.body.code).toUpperCase();

    if (!code) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_CODE', message: 'Ticket code is required.' }
      });
      return;
    }

    const ticket = await Ticket.findOne({ code });
    if (!ticket) {
      res.status(404).json({
        success: false,
        error: { code: 'TICKET_NOT_FOUND', message: `Ticket ${code} not found.` }
      });
      return;
    }

    const confirmEntered = req.body.confirmEntered === true || req.body.force === true;
    if (ticket.entered && !confirmEntered) {
      res.status(400).json({
        success: false,
        warning: 'TICKET_ALREADY_ENTERED',
        error: {
          code: 'TICKET_ALREADY_ENTERED',
          message: `This ticket has already been marked ENTERED. Clearing it will remove its booking assignment and entry state. Confirm to proceed.`
        }
      });
      return;
    }

    const previousBookingId = ticket.bookingId;

    if (previousBookingId) {
      const booking = await Booking.findById(previousBookingId);
      if (booking) {
        booking.ticketCodes = booking.ticketCodes.filter(c => c !== code);
        booking.ticketQuantity = booking.ticketCodes.length;
        if (booking.ticketQuantity === 0) {
          await Booking.deleteOne({ _id: booking._id });
        } else {
          await booking.save();
        }
      }
    }

    ticket.bookingId = null;
    ticket.buyerName = null;
    ticket.phone = null;
    ticket.email = null;
    ticket.status = 'available';
    ticket.entered = false;
    ticket.enteredAt = null;
    ticket.entryCount = 0;
    ticket.registeredAt = null;
    ticket.cancellationReason = null;

    await ticket.save();

    logAudit({
      action: 'CLEAR_TICKET',
      ticketCode: code,
      bookingId: previousBookingId,
      adminUsername: req.user?.username,
      reason: 'Ticket cleared by admin'
    });

    fastCache.invalidateAll();
    res.json({
      success: true,
      message: `Ticket ${code} cleared and returned to AVAILABLE pool.`,
      data: ticket,
      ticket
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: { code: 'CLEAR_ERROR', message: 'Failed to clear ticket: ' + err.message }
    });
  }
};

/**
 * POST /api/event/reset
 * Admin event reset:
 * - Deletes all bookings.
 * - Resets all 50 tickets to available, entered=false.
 * - Resets atomic booking counter.
 * - Preserves HOH001–HOH050 and the Admin account!
 */
export const resetEvent = async (req: Request, res: Response): Promise<void> => {
  if (!isDbReady()) {
    res.status(503).json(DB_UNAVAILABLE_RESPONSE);
    return;
  }

  try {
    const confirmation = (req.body.confirmText || req.body.confirmation || '').trim();
    if (confirmation !== 'RESET HOH EVENT') {
      res.status(400).json({
        success: false,
        error: {
          code: 'CONFIRMATION_REQUIRED',
          message: 'Confirmation phrase "RESET HOH EVENT" is required to perform an event reset.'
        }
      });
      return;
    }

    // 1. Snapshot all current tickets & bookings into eventBackups
    const ticketsSnapshot = await Ticket.find({}).lean();
    const bookingsSnapshot = await Booking.find({}).lean();

    const backup = await EventBackup.create({
      resetToken: `reset_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      reason: req.body.reason || 'Admin event reset',
      performedBy: {
        userId: req.user?.userId && mongoose.Types.ObjectId.isValid(req.user.userId) ? new mongoose.Types.ObjectId(req.user.userId) : undefined,
        name: req.user?.username || 'Admin',
        role: 'admin'
      },
      ticketsSnapshot,
      bookingsSnapshot,
      createdAt: new Date()
    });

    if (!backup || !backup._id) {
      res.status(500).json({
        success: false,
        error: {
          code: 'BACKUP_FAILED',
          message: 'Failed to create pre-reset backup snapshot. Reset aborted to preserve data.'
        }
      });
      return;
    }

    // 2. Delete all bookings
    await Booking.deleteMany({});

    // 3. Reset all 50 tickets to clean available state
    await Ticket.updateMany(
      {},
      {
        $set: {
          bookingId: null,
          buyerName: null,
          phone: null,
          email: null,
          status: 'available',
          entered: false,
          enteredAt: null,
          entryCount: 0,
          registeredAt: null,
          cancellationReason: null
        }
      }
    );

    // 4. Reset booking code counter
    await Counter.findByIdAndUpdate(
      'bookingCode',
      { $set: { seq: 0 } },
      { upsert: true }
    );

    logAudit({
      action: 'RESET_EVENT',
      adminUsername: req.user?.username,
      reason: `Complete event reset performed by admin. Backup ID: ${backup._id}`
    });

    fastCache.invalidateAll();
    res.json({
      success: true,
      message: 'All event bookings deleted. All 50 tickets reset to AVAILABLE. Backup snapshot created successfully. Admin account preserved.',
      backupId: backup._id
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: { code: 'RESET_ERROR', message: 'Failed to reset event: ' + err.message }
    });
  }
};

/**
 * PUT /api/tickets/:code/cancel
 * Cancel/void a physical ticket (LOST, DAMAGED, VOID, OTHER)
 */
export const cancelTicket = async (req: Request, res: Response): Promise<void> => {
  if (!isDbReady()) {
    res.status(503).json(DB_UNAVAILABLE_RESPONSE);
    return;
  }

  try {
    const code = extractParam(req.params.code).toUpperCase();
    const reason = (req.body.reason || 'VOID').toUpperCase().trim();

    const ticket = await Ticket.findOne({ code });
    if (!ticket) {
      res.status(404).json({
        success: false,
        error: { code: 'TICKET_NOT_FOUND', message: `Ticket ${code} not found.` }
      });
      return;
    }

    if (ticket.status === 'registered' || ticket.status === 'entered' || ticket.bookingId) {
      res.status(400).json({
        success: false,
        error: {
          code: 'CANNOT_CANCEL_REGISTERED',
          message: `Ticket ${code} is currently registered to a booking. Clear the booking before cancelling the physical ticket.`
        }
      });
      return;
    }

    ticket.status = 'cancelled';
    ticket.cancellationReason = reason;
    ticket.entered = false;
    ticket.enteredAt = null;
    await ticket.save();

    logAudit({
      action: 'TICKET_CANCELLED',
      ticketCode: code,
      adminUsername: req.user?.username,
      reason: `Physical ticket marked as cancelled: ${reason}`
    });

    fastCache.invalidateAll();
    res.json({
      success: true,
      message: `Ticket ${code} has been cancelled (${reason}) and excluded from allocation.`,
      data: ticket,
      ticket
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: { code: 'CANCEL_ERROR', message: 'Failed to cancel ticket: ' + err.message }
    });
  }
};

/**
 * PUT /api/tickets/:code/uncancel
 * Restore a cancelled ticket back to AVAILABLE
 */
export const uncancelTicket = async (req: Request, res: Response): Promise<void> => {
  if (!isDbReady()) {
    res.status(503).json(DB_UNAVAILABLE_RESPONSE);
    return;
  }

  try {
    const code = extractParam(req.params.code).toUpperCase();

    const ticket = await Ticket.findOne({ code });
    if (!ticket) {
      res.status(404).json({
        success: false,
        error: { code: 'TICKET_NOT_FOUND', message: `Ticket ${code} not found.` }
      });
      return;
    }

    ticket.status = 'available';
    ticket.cancellationReason = null;
    ticket.bookingId = null;
    ticket.buyerName = null;
    ticket.entered = false;
    ticket.enteredAt = null;
    await ticket.save();

    logAudit({
      action: 'TICKET_UNCANCELLED',
      ticketCode: code,
      adminUsername: req.user?.username,
      reason: 'Physical ticket restored to AVAILABLE'
    });

    fastCache.invalidateAll();
    res.json({
      success: true,
      message: `Ticket ${code} restored to AVAILABLE.`,
      data: ticket,
      ticket
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: { code: 'UNCANCEL_ERROR', message: 'Failed to restore ticket: ' + err.message }
    });
  }
};

/**
 * GET /api/admin/database-status
 * ADMIN-protected database diagnostic endpoint
 */
export const getDatabaseStatus = async (req: Request, res: Response): Promise<void> => {
  if (!isDbReady()) {
    res.status(503).json(DB_UNAVAILABLE_RESPONSE);
    return;
  }

  try {
    const total = await Ticket.countDocuments();
    const available = await Ticket.countDocuments({
      status: 'available',
      bookingId: null
    });
    const registered = await Ticket.countDocuments({
      status: 'registered',
      bookingId: { $ne: null }
    });
    const entered = await Ticket.countDocuments({
      status: 'entered',
      entered: true
    });
    const cancelled = await Ticket.countDocuments({
      status: 'cancelled'
    });
    const totalBookings = await Booking.countDocuments();

    // Consistency verification check
    const allBookings = await Booking.find({}).lean();
    const inconsistencies: string[] = [];
    for (const b of allBookings) {
      const associatedTickets = await Ticket.find({ bookingId: b._id }).lean();
      if (associatedTickets.length !== b.ticketQuantity) {
        inconsistencies.push(`Booking ${b.bookingCode}: quantity (${b.ticketQuantity}) != associated tickets (${associatedTickets.length})`);
      }
      const ticketCodes = associatedTickets.map(t => t.code).sort();
      const bookingCodes = [...(b.ticketCodes || [])].sort();
      if (ticketCodes.join(',') !== bookingCodes.join(',')) {
        inconsistencies.push(`Booking ${b.bookingCode}: ticket code mismatch`);
      }
    }

    res.json({
      success: true,
      database: 'mongodb-atlas',
      connected: true,
      tickets: {
        total,
        available,
        registered,
        entered,
        cancelled
      },
      bookings: {
        total: totalBookings
      },
      consistency: {
        isConsistent: inconsistencies.length === 0,
        issues: inconsistencies
      }
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: {
        code: 'DIAGNOSTIC_ERROR',
        message: 'Failed to retrieve database status: ' + err.message
      }
    });
  }
};

/**
 * GET /api/admin/test-sale-readiness
 * Non-destructive admin diagnostic to verify MongoDB connection, transaction capability, and HOH001 status
 */
export const getTestSaleReadiness = async (req: Request, res: Response): Promise<void> => {
  if (!isDbReady()) {
    res.status(503).json(DB_UNAVAILABLE_RESPONSE);
    return;
  }

  try {
    // 1. Verify transaction capability non-destructively
    let transactionSupported = false;
    let transactionError: string | null = null;
    try {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          await Ticket.findOne({ code: 'HOH001' }).session(session);
        });
        transactionSupported = true;
      } finally {
        await session.endSession();
      }
    } catch (txErr: any) {
      transactionSupported = false;
      transactionError = txErr.message;
    }

    // 2. Verify HOH001 existence and state without modifying data
    const ticket001 = await Ticket.findOne({ code: 'HOH001' }).lean();

    res.json({
      success: true,
      database: 'mongodb-atlas',
      connected: true,
      transactionSupported,
      transactionError,
      ticketHOH001: ticket001 ? {
        exists: true,
        code: ticket001.code,
        serialNumber: ticket001.serialNumber,
        status: ticket001.status,
        isAvailable: ticket001.status === 'available' && ticket001.bookingId === null,
        bookingId: ticket001.bookingId,
        buyerName: ticket001.buyerName || null,
        phone: ticket001.phone || null,
        entered: ticket001.entered
      } : {
        exists: false
      }
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: {
        code: 'READINESS_CHECK_ERROR',
        message: 'Diagnostic check failed: ' + err.message
      }
    });
  }
};

/**
 * GET /api/admin/ticket-integrity
 * Complete diagnostic endpoint querying MongoDB directly to audit all 50 physical tickets
 */
export const getTicketIntegrity = async (req: Request, res: Response): Promise<void> => {
  if (!isDbReady()) {
    res.status(503).json(DB_UNAVAILABLE_RESPONSE);
    return;
  }

  try {
    const allTickets = await Ticket.find({}).sort({ serialNumber: 1 }).lean();
    const allBookings = await Booking.find({}, { _id: 1, bookingCode: 1, ticketCodes: 1 }).lean();
    const bookingIdMap = new Map(allBookings.map(b => [String(b._id), b]));

    const expectedCodes = Array.from({ length: 50 }, (_, i) => `HOH${String(i + 1).padStart(3, '0')}`);
    const existingCodes = new Set(allTickets.map(t => t.code.toUpperCase()));
    const missingCodes = expectedCodes.filter(c => !existingCodes.has(c));

    // Detect duplicate codes
    const duplicateAgg = await Ticket.aggregate([
      { $group: { _id: "$code", count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } }
    ]);
    const duplicateCodes = duplicateAgg.map(d => d._id);

    const invalidSerialNumbers: string[] = [];
    const invalidStatuses: string[] = [];
    const registeredTickets: string[] = [];
    const cancelledTickets: string[] = [];
    const orphanBookings: string[] = [];

    const validStatuses = ['available', 'registered', 'entered', 'cancelled'];

    for (const t of allTickets) {
      const match = t.code.match(/^HOH(\d+)$/i);
      const expectedNum = match ? parseInt(match[1], 10) : -1;
      if (t.serialNumber !== expectedNum || t.serialNumber < 1 || t.serialNumber > 50) {
        invalidSerialNumbers.push(t.code);
      }

      if (!validStatuses.includes(t.status)) {
        invalidStatuses.push(t.code);
      }

      if (t.status === 'registered' || t.status === 'entered' || t.bookingId !== null) {
        registeredTickets.push(t.code);
      }

      if (t.status === 'cancelled') {
        cancelledTickets.push(t.code);
      }

      // Check orphan bookings
      if (t.bookingId && !bookingIdMap.has(String(t.bookingId))) {
        orphanBookings.push(`Ticket ${t.code} references nonexistent bookingId ${t.bookingId}`);
      }
    }

    // Also check bookings referencing missing tickets
    const ticketCodeSet = new Set(allTickets.map(t => t.code));
    for (const b of allBookings) {
      if (Array.isArray(b.ticketCodes)) {
        for (const tc of b.ticketCodes) {
          if (!ticketCodeSet.has(tc)) {
            orphanBookings.push(`Booking ${b.bookingCode} references missing ticket ${tc}`);
          }
        }
      }
    }

    // Do NOT expose customer phone/email unnecessarily
    const sanitizedTickets = allTickets.map(t => ({
      code: t.code,
      serialNumber: t.serialNumber,
      status: t.status,
      bookingId: t.bookingId ? String(t.bookingId) : null,
      buyerName: t.buyerName || null
    }));

    const availableCodes = allTickets
      .filter(t => (t.status === 'available' || String(t.status).toLowerCase() === 'available') && t.bookingId === null)
      .map(t => t.code);

    res.json({
      success: true,
      total: allTickets.length,
      missing: missingCodes,
      missingCodes,
      duplicateCodes,
      invalidSerialNumbers,
      invalidMappings: invalidSerialNumbers,
      invalidStatuses,
      registered: registeredTickets,
      registeredTickets,
      available: availableCodes,
      cancelledTickets,
      orphanBookings,
      tickets: sanitizedTickets
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: {
        code: 'INTEGRITY_CHECK_ERROR',
        message: 'Ticket integrity inspection failed: ' + err.message
      }
    });
  }
};

/**
 * GET /api/admin/test-all-50-allocations
 * Non-destructive admin diagnostic to test anchor allocation for all 50 tickets HOH001-HOH050
 */
export const testAll50Allocations = async (req: Request, res: Response): Promise<void> => {
  if (!isDbReady()) {
    res.status(503).json(DB_UNAVAILABLE_RESPONSE);
    return;
  }

  try {
    const { findConsecutiveFromAnchor } = await import('../services/allocationService');
    const allTickets = await Ticket.find({}).lean();
    const ticketMap = new Map(allTickets.map(t => [t.code, t]));

    const results: Array<{
      code: string;
      status: 'PASS' | 'FAIL';
      ticketStatus: string;
      allocatedTickets?: string[];
      reason?: string;
    }> = [];

    let passedCount = 0;
    let failedCount = 0;

    for (let i = 1; i <= 50; i++) {
      const code = `HOH${String(i).padStart(3, '0')}`;
      const doc = ticketMap.get(code);

      if (!doc) {
        results.push({ code, status: 'FAIL', ticketStatus: 'MISSING', reason: 'Ticket does not exist' });
        failedCount++;
        continue;
      }

      const alloc = await findConsecutiveFromAnchor(code, 1);
      const isAvailable = (doc.status === 'available' || String(doc.status).toLowerCase() === 'available') && doc.bookingId === null;

      if (isAvailable) {
        if (alloc.success && alloc.tickets.length === 1 && alloc.tickets[0].code === code) {
          results.push({ code, status: 'PASS', ticketStatus: doc.status, allocatedTickets: [code] });
          passedCount++;
        } else {
          results.push({ code, status: 'FAIL', ticketStatus: doc.status, reason: alloc.message || 'Allocation failed for available ticket' });
          failedCount++;
        }
      } else {
        // For registered or cancelled tickets, findConsecutiveFromAnchor should safely reject with proper reason
        if (!alloc.success && (alloc.reason === 'ANCHOR_ALREADY_REGISTERED' || alloc.reason === 'ANCHOR_CANCELLED')) {
          results.push({ code, status: 'PASS', ticketStatus: doc.status, reason: alloc.reason });
          passedCount++;
        } else {
          results.push({ code, status: 'FAIL', ticketStatus: doc.status, reason: `Unexpected allocation result for ${doc.status} ticket: success=${alloc.success}` });
          failedCount++;
        }
      }
    }

    res.json({
      success: true,
      total: 50,
      passed: passedCount,
      failed: failedCount,
      results
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: {
        code: 'ALLOCATION_TEST_ERROR',
        message: 'Failed to run 50-ticket allocation test: ' + err.message
      }
    });
  }
};

// Compatibility aliases
export const clearTicket = clearTicketBooking;
export const clearEventData = resetEvent;

