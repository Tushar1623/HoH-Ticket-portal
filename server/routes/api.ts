import { Router } from 'express';
import { login, getMe } from '../controllers/authController';
import {
  getTickets,
  verifyTicket,
  markEntered,
  correctStatus,
  clearTicket,
  prepareEventReset,
  confirmEventReset
} from '../controllers/ticketController';
import {
  previewBooking,
  createBooking,
  clearBooking
} from '../controllers/bookingController';
import {
  authenticate,
  requireRole,
  authLimiter,
  entryLimiter,
  apiLimiter,
  requestIdMiddleware
} from '../middleware/auth';

const router = Router();

// Apply request ID middleware to all routes
router.use(requestIdMiddleware);

// Auth routes
router.post('/auth/login', authLimiter, login);
router.get('/auth/me', authenticate, getMe);

// Ticket routes
router.get('/tickets', getTickets);
router.post('/tickets/verify', entryLimiter, verifyTicket);
router.post('/tickets/mark-entered', entryLimiter, authenticate, requireRole(['entry', 'manager', 'admin']), markEntered);
router.post('/tickets/correct-status', authenticate, requireRole(['manager', 'admin']), correctStatus);
router.post('/tickets/clear', authenticate, requireRole(['manager', 'admin']), clearTicket);

// Booking routes
router.post('/bookings/preview', previewBooking);
router.post('/bookings', apiLimiter, authenticate, requireRole(['sales', 'manager', 'admin']), createBooking);
router.post('/bookings/clear', authenticate, requireRole(['manager', 'admin']), clearBooking);

// Two-step Event Reset routes (Super Admin only)
router.post('/event/prepare-reset', authenticate, requireRole(['admin']), prepareEventReset);
router.post('/event/confirm-reset', authenticate, requireRole(['admin']), confirmEventReset);

export default router;
