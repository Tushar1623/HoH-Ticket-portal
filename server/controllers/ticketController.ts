import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { Ticket } from '../models/Ticket';
import { Booking } from '../models/Booking';
import { Counter } from '../models/Counter';
import { EventBackup } from '../models/EventBackup';
import { logAudit } from '../services/auditService';
import { localDataStore } from '../services/localDataStore';
import { fastCache } from '../services/cacheService';

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
    message: 'Unable to connect to database. MongoDB connection is currently unavailable.'
  }
};

/**
 * GET /api/dashboard
 * Live statistics directly from MongoDB with micro-caching for high throughput
 */
export const getDashboardStats = async (req: Request, res: Response): Promise<void> => {
  const cached = fastCache.get('dashboard_stats');
  if (cached) {
    res.json(cached);
    return;
  }

  if (!isDbReady()) {
    const local = localDataStore.getDashboardStats();
    const payload = {
      ...local,
      data: local.stats
    };
    fastCache.set('dashboard_stats', payload, 1500);
    res.json(payload);
    return;
  }

  try {
    const totalTickets = (await Ticket.countDocuments()) || 50;
    const entered = await Ticket.countDocuments({ entered: true });
    const cancelled = await Ticket.countDocuments({ status: 'cancelled' });
    const registered = await Ticket.countDocuments({
      status: { $in: ['registered', 'REGISTERED'] },
      buyerName: { $ne: null }
    });
    const available = Math.max(0, totalTickets - registered - cancelled);
    const notEntered = Math.max(0, registered - entered);
    const attendanceRate = registered > 0 ? Math.round((entered / registered) * 100) : 0;

    // Financial & Booking Totals
    const allBookings = await Booking.find({}).lean();
    const totalBookings = allBookings.length;
    const totalTicketsSold = allBookings.reduce((sum, b) => sum + (b.ticketQuantity || 0), 0);
    const totalRevenue = allBookings
      .filter(b => b.paymentStatus !== 'Cancelled' && b.paymentStatus !== 'Refunded')
      .reduce((sum, b) => sum + (b.amountPaid ?? b.totalAmount ?? 0), 0);

    // Today's Sales Calculation (Asia/Kolkata or server local date)
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
    fastCache.set('dashboard_stats', payload, 1500);
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
 * Fetch tickets from MongoDB with optional search and filter (micro-cached)
 */
export const getTickets = async (req: Request, res: Response): Promise<void> => {
  const cacheKey = `tickets_${req.query.status || 'all'}_${req.query.search || ''}_${req.query.entered ?? ''}`;
  const cached = fastCache.get(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  if (!isDbReady()) {
    const list = localDataStore.getTickets({
      status: req.query.status as string,
      search: req.query.search as string
    });
    const payload = {
      success: true,
      count: list.length,
      data: list,
      tickets: list
    };
    fastCache.set(cacheKey, payload, 1500);
    res.json(payload);
    return;
  }

  try {
    const { search, status, entered } = req.query;

    const query: any = {};

    if (status && typeof status === 'string') {
      const s = status.toLowerCase();
      if (s === 'available') {
        query.status = { $in: ['available', 'AVAILABLE'] };
        query.buyerName = null;
      } else if (s === 'registered') {
        query.$or = [{ status: { $in: ['registered', 'REGISTERED'] } }, { buyerName: { $ne: null } }];
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
      const isRegistered = t.status === 'registered' || t.status === 'REGISTERED' || !!t.buyerName;
      return {
        ...t,
        status: isRegistered ? 'registered' : 'available',
        buyerName: t.buyerName || b?.buyerName || '',
        phone: t.phone || b?.phone || '',
        email: t.email || b?.email || '',
        bookingCode: b?.bookingCode || '',
        paymentStatus: b?.paymentStatus || 'Paid',
        totalAmount: b?.totalAmount || 0
      };
    });

    // Compute stats
    const totalTickets = 50;
    const enteredCount = enriched.filter(t => t.entered).length;
    const registeredCount = enriched.filter(t => t.status === 'registered' || !!t.buyerName).length;
    const availableCount = Math.max(0, totalTickets - registeredCount);
    const notEnteredCount = Math.max(0, registeredCount - enteredCount);

    res.json({
      success: true,
      data: enriched,
      stats: {
        totalTickets,
        registered: registeredCount,
        available: availableCount,
        entered: enteredCount,
        notEntered: notEnteredCount,
        attendanceRate: registeredCount > 0 ? Math.round((enteredCount / registeredCount) * 100) : 0
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
    const code = (req.params.code || '').toUpperCase().trim();
    const ticket = localDataStore.getTicketByCode(code);
    if (!ticket) {
      res.status(404).json({ success: false, error: { code: 'TICKET_NOT_FOUND', message: `Ticket ${code} not found.` } });
      return;
    }
    res.json({ success: true, ticket });
    return;
  }

  try {
    const code = (req.params.code || '').toUpperCase().trim();
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
 * Zero secondary verification: immediate atomic update
 */
export const markTicketEntered = async (req: Request, res: Response): Promise<void> => {
  if (!isDbReady()) {
    const code = (req.params.code || req.body.code || '').toUpperCase().trim();
    const result = localDataStore.markEntry(code);
    if (!result.success) {
      res.status(400).json({ success: false, error: { code: 'UPDATE_ERROR', message: result.message } });
      return;
    }
    fastCache.invalidateAll();
    res.json({ success: true, message: `Ticket ${code} marked as ENTERED.`, ticket: result.ticket, data: result.ticket });
    return;
  }

  try {
    const code = (req.params.code || req.body.code || '').toUpperCase().trim();

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

    if (existing.status !== 'registered' && !existing.buyerName) {
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
      { $set: { entered: true, enteredAt: now, entryCount: 1 } },
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
    const code = (req.body.code || req.query.code || req.params.code || '').toUpperCase().trim();
    const ticket = localDataStore.getTicketByCode(code);
    if (!ticket) {
      res.status(404).json({ ok: false, error: `Ticket ${code} was not found in database.` });
      return;
    }
    res.json({
      ok: true,
      ticket: {
        code: ticket.code,
        buyerName: ticket.buyerName || '',
        bookingCode: ticket.bookingCode || '',
        status: ticket.status,
        entered: ticket.entered,
        enteredAt: ticket.enteredAt,
        guestsAllowed: 1
      }
    });
    return;
  }

  try {
    const code = (req.body.code || req.query.code || req.params.code || '').toUpperCase().trim();
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
 * Manual Entry Undo: Mark ticket as NOT ENTERED
 * Zero secondary verification: immediate atomic update
 */
export const markTicketNotEntered = async (req: Request, res: Response): Promise<void> => {
  if (!isDbReady()) {
    const code = (req.params.code || req.body.code || '').toUpperCase().trim();
    const result = localDataStore.markNotEntered(code);
    if (!result.success) {
      res.status(400).json({ success: false, error: { code: 'UPDATE_ERROR', message: result.message } });
      return;
    }
    fastCache.invalidateAll();
    res.json({ success: true, message: `Ticket ${code} marked as NOT ENTERED.`, ticket: result.ticket, data: result.ticket });
    return;
  }

  try {
    const code = (req.params.code || req.body.code || '').toUpperCase().trim();

    if (!code) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_CODE', message: 'Ticket code is required.' }
      });
      return;
    }

    const ticket = await Ticket.findOneAndUpdate(
      { code },
      { $set: { entered: false, enteredAt: null } },
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
    const code = (req.params.code || req.body.code || '').toUpperCase().trim();
    const { buyerName, phone, email } = req.body;
    const t = localDataStore.getTicketByCode(code);
    if (!t) {
      res.status(404).json({ success: false, error: { code: 'TICKET_NOT_FOUND', message: `Ticket ${code} not found.` } });
      return;
    }
    if (buyerName !== undefined) t.buyerName = buyerName.trim() || null;
    if (phone !== undefined) t.phone = phone.trim() || null;
    if (email !== undefined) t.email = email.trim() || null;
    t.status = t.buyerName ? 'registered' : 'available';
    res.json({ success: true, message: `Ticket ${code} updated successfully.`, ticket: t, data: t });
    return;
  }

  try {
    const code = (req.params.code || req.body.code || '').toUpperCase().trim();
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
      // Create new booking document using atomic counter
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
    ticket.status = ticket.buyerName ? 'registered' : 'available';

    await ticket.save();

    logAudit({
      action: 'EDIT_TICKET',
      ticketCode: code,
      bookingId: ticket.bookingId,
      adminUsername: req.user?.username,
      newValue: { buyerName: ticket.buyerName, phone: ticket.phone }
    });

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
 * NEVER deletes the ticket document itself!
 */
export const clearTicketBooking = async (req: Request, res: Response): Promise<void> => {
  if (!isDbReady()) {
    const code = (req.params.code || req.body.code || '').toUpperCase().trim();
    const result = localDataStore.clearTicket(code);
    if (!result.success) {
      res.status(400).json({ success: false, error: { code: 'CLEAR_ERROR', message: result.message } });
      return;
    }
    res.json({ success: true, message: `Ticket ${code} cleared and returned to available pool.`, ticket: result.ticket });
    return;
  }

  try {
    const code = (req.params.code || req.body.code || '').toUpperCase().trim();

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

    await ticket.save();

    logAudit({
      action: 'CLEAR_TICKET',
      ticketCode: code,
      bookingId: previousBookingId,
      adminUsername: req.user?.username,
      reason: 'Ticket cleared by admin'
    });

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
    const confirmation = (req.body.confirmText || req.body.confirmation || '').trim();
    if (confirmation !== 'RESET HOH EVENT') {
      res.status(400).json({
        success: false,
        error: { code: 'CONFIRMATION_REQUIRED', message: 'Confirmation phrase "RESET HOH EVENT" is required to perform an event reset.' }
      });
      return;
    }
    const result = localDataStore.resetEvent(req.body.reason);
    fastCache.invalidateAll();
    res.json({
      success: true,
      message: 'All event bookings deleted. All 50 tickets reset to AVAILABLE. Backup snapshot created successfully.',
      backupId: result.backupId
    });
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
    const code = (req.params.code || '').toUpperCase().trim();
    const reason = (req.body.reason || 'VOID').toUpperCase().trim();
    const result = localDataStore.cancelTicket(code, reason);
    if (!result.success) {
      res.status(400).json({ success: false, error: { code: 'CANCEL_ERROR', message: result.message } });
      return;
    }
    res.json({ success: true, message: `Ticket ${code} has been cancelled (${reason}).`, ticket: result.ticket, data: result.ticket });
    return;
  }

  try {
    const code = (req.params.code || '').toUpperCase().trim();
    const reason = (req.body.reason || 'VOID').toUpperCase().trim();

    const ticket = await Ticket.findOne({ code });
    if (!ticket) {
      res.status(404).json({
        success: false,
        error: { code: 'TICKET_NOT_FOUND', message: `Ticket ${code} not found.` }
      });
      return;
    }

    if (ticket.status === 'registered' || ticket.bookingId) {
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
    await ticket.save();

    logAudit({
      action: 'TICKET_CANCELLED',
      ticketCode: code,
      adminUsername: req.user?.username,
      reason: `Physical ticket marked as cancelled: ${reason}`
    });

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
    const code = (req.params.code || '').toUpperCase().trim();
    const result = localDataStore.uncancelTicket(code);
    if (!result.success) {
      res.status(400).json({ success: false, error: { code: 'UNCANCEL_ERROR', message: result.message } });
      return;
    }
    res.json({ success: true, message: `Ticket ${code} restored to AVAILABLE.`, ticket: result.ticket, data: result.ticket });
    return;
  }

  try {
    const code = (req.params.code || '').toUpperCase().trim();

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
    await ticket.save();

    logAudit({
      action: 'TICKET_UNCANCELLED',
      ticketCode: code,
      adminUsername: req.user?.username,
      reason: 'Physical ticket restored to AVAILABLE'
    });

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

// Compatibility aliases
export const clearTicket = clearTicketBooking;
export const clearEventData = resetEvent;
