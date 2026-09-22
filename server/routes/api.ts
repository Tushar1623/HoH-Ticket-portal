import { Router } from 'express';
import { login, getMe } from '../controllers/authController';
import {
  getDashboardStats,
  getTickets,
  getTicketByCode,
  markTicketEntered,
  markTicketNotEntered,
  setEntryStatus,
  updateTicket,
  verifyTicket,
  cancelTicket,
  uncancelTicket,
  clearTicketBooking,
  resetEvent,
  getDatabaseStatus
} from '../controllers/ticketController';
import {
  previewBooking,
  previewSale,
  createBooking,
  listBookings,
  getBookingById,
  updateBooking,
  removeTicketFromBooking,
  clearBooking
} from '../controllers/bookingController';
import { authenticate, requestIdMiddleware } from '../middleware/auth';

const router = Router();

// Trace all incoming API requests
router.use(requestIdMiddleware);

// --- Public Auth Routes ---
router.post('/auth/login', login);
router.get('/auth/me', authenticate, getMe);

// --- Protected Dashboard & Diagnostics ---
router.get('/dashboard', authenticate, getDashboardStats);
router.get('/admin/database-status', authenticate, getDatabaseStatus);

// --- Protected Ticket Routes ---
router.get('/tickets', authenticate, getTickets);
router.get('/tickets/:code', authenticate, getTicketByCode);
router.post('/tickets/:code/preview-sale', authenticate, previewSale);
router.put('/tickets/:code/entry', authenticate, markTicketEntered);
router.put('/tickets/:code/not-entry', authenticate, markTicketNotEntered);
router.put('/tickets/:code/cancel', authenticate, cancelTicket);
router.put('/tickets/:code/uncancel', authenticate, uncancelTicket);
router.put('/tickets/:code', authenticate, updateTicket);
router.delete('/tickets/:code/booking', authenticate, clearTicketBooking);

// Compatibility Ticket Routes
router.post('/tickets/entry-status', authenticate, setEntryStatus);
router.post('/tickets/update', authenticate, updateTicket);
router.post('/tickets/clear', authenticate, clearTicketBooking);
router.post('/tickets/verify', authenticate, verifyTicket);

// --- Protected Booking Routes ---
router.get('/bookings', authenticate, listBookings);
router.get('/bookings/:id', authenticate, getBookingById);
router.post('/bookings/preview', authenticate, previewBooking);
router.post('/bookings', authenticate, createBooking);
router.put('/bookings/:id', authenticate, updateBooking);
router.delete('/bookings/:id/tickets/:code', authenticate, removeTicketFromBooking);
router.post('/bookings/clear', authenticate, clearBooking);

// --- Protected Event Reset ---
router.post('/event/reset', authenticate, resetEvent);
router.post('/event/clear', authenticate, resetEvent);

export default router;
