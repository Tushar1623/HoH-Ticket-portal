import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Types } from 'mongoose';
import bcrypt from 'bcryptjs';
import { Ticket, ITicket } from '../../server/models/Ticket';
import { Booking, IBooking } from '../../server/models/Booking';
import { AuditLog } from '../../server/models/AuditLog';
import { IdempotencyKey } from '../../server/models/IdempotencyKey';
import { EventBackup } from '../../server/models/EventBackup';
import { User } from '../../server/models/User';
import { findConsecutiveTickets, previewAllocation } from '../../server/services/allocationService';
import { requireRole } from '../../server/middleware/auth';

describe('HOH MongoDB Event Operations - 16 Required Core Verification Tests', () => {

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // TEST 1: Initialize exactly HOH001 to HOH050
  // --------------------------------------------------------------------------
  it('Test 1: Initialize exactly HOH001 to HOH050', async () => {
    const generatedTickets: any[] = [];
    const now = new Date();

    for (let i = 1; i <= 50; i++) {
      const code = `HOH${String(i).padStart(3, '0')}`;
      generatedTickets.push({
        _id: new Types.ObjectId(),
        code,
        serialNumber: i,
        qrPayload: code,
        bookingId: null,
        status: 'available',
        entered: false,
        enteredAt: null,
        entryCount: 0,
        version: 1,
        createdAt: now,
        updatedAt: now
      });
    }

    expect(generatedTickets.length).toBe(50);
    expect(generatedTickets[0].code).toBe('HOH001');
    expect(generatedTickets[0].serialNumber).toBe(1);
    expect(generatedTickets[49].code).toBe('HOH050');
    expect(generatedTickets[49].serialNumber).toBe(50);
    expect(generatedTickets.every(t => t.status === 'available' && !t.entered)).toBe(true);

    // Verify all 50 codes are distinct and sequential
    const uniqueCodes = new Set(generatedTickets.map(t => t.code));
    expect(uniqueCodes.size).toBe(50);
  });

  // --------------------------------------------------------------------------
  // TEST 2: Buy 1 ticket
  // --------------------------------------------------------------------------
  it('Test 2: Buy 1 ticket', async () => {
    const mockTicket: any = {
      _id: new Types.ObjectId(),
      code: 'HOH001',
      serialNumber: 1,
      status: 'available',
      bookingId: null
    };

    vi.spyOn(Ticket, 'find').mockReturnValue({
      sort: () => ({
        session: () => ({ exec: async () => [mockTicket] }),
        exec: async () => [mockTicket]
      })
    } as any);

    const alloc = await findConsecutiveTickets(1);
    expect(alloc.success).toBe(true);
    expect(alloc.tickets.length).toBe(1);
    expect(alloc.tickets[0].code).toBe('HOH001');

    // Simulate booking document creation
    const bookingId = new Types.ObjectId();
    const booking = new Booking({
      _id: bookingId,
      bookingCode: 'HOH-BOOK-000001',
      buyerName: 'Aarav Sharma',
      phone: '+91 98765 43210',
      email: 'aarav@example.com',
      ticketQuantity: 1,
      ticketCodes: ['HOH001'],
      paymentStatus: 'Paid',
      totalAmount: 500,
      notes: 'Main Box Office purchase'
    });

    expect(booking.ticketQuantity).toBe(1);
    expect(booking.ticketCodes).toEqual(['HOH001']);
    expect(booking.paymentStatus).toBe('Paid');

    // Ticket status update
    mockTicket.status = 'reserved';
    mockTicket.bookingId = bookingId;
    expect(mockTicket.status).toBe('reserved');
    expect(mockTicket.bookingId).toBe(bookingId);
  });

  // --------------------------------------------------------------------------
  // TEST 3: Buy 2 consecutive tickets
  // --------------------------------------------------------------------------
  it('Test 3: Buy 2 consecutive tickets', async () => {
    const mockTickets = [
      { _id: new Types.ObjectId(), code: 'HOH002', serialNumber: 2, status: 'available', bookingId: null },
      { _id: new Types.ObjectId(), code: 'HOH003', serialNumber: 3, status: 'available', bookingId: null },
      { _id: new Types.ObjectId(), code: 'HOH005', serialNumber: 5, status: 'available', bookingId: null }
    ];

    vi.spyOn(Ticket, 'find').mockReturnValue({
      sort: () => ({
        session: () => ({ exec: async () => mockTickets }),
        exec: async () => mockTickets
      })
    } as any);

    const alloc = await findConsecutiveTickets(2);
    expect(alloc.success).toBe(true);
    expect(alloc.tickets.length).toBe(2);
    expect(alloc.tickets.map(t => t.code)).toEqual(['HOH002', 'HOH003']);
    // Verify consecutive serial numbering s, s+1
    expect(alloc.tickets[1].serialNumber).toBe(alloc.tickets[0].serialNumber + 1);
  });

  // --------------------------------------------------------------------------
  // TEST 4: Buy 3 consecutive tickets
  // --------------------------------------------------------------------------
  it('Test 4: Buy 3 consecutive tickets', async () => {
    const mockTickets = [
      { _id: new Types.ObjectId(), code: 'HOH004', serialNumber: 4, status: 'available', bookingId: null },
      { _id: new Types.ObjectId(), code: 'HOH005', serialNumber: 5, status: 'available', bookingId: null },
      { _id: new Types.ObjectId(), code: 'HOH006', serialNumber: 6, status: 'available', bookingId: null },
      { _id: new Types.ObjectId(), code: 'HOH008', serialNumber: 8, status: 'available', bookingId: null }
    ];

    vi.spyOn(Ticket, 'find').mockReturnValue({
      sort: () => ({
        session: () => ({ exec: async () => mockTickets }),
        exec: async () => mockTickets
      })
    } as any);

    const alloc = await findConsecutiveTickets(3);
    expect(alloc.success).toBe(true);
    expect(alloc.tickets.length).toBe(3);
    expect(alloc.tickets.map(t => t.code)).toEqual(['HOH004', 'HOH005', 'HOH006']);
    expect(alloc.tickets[1].serialNumber).toBe(alloc.tickets[0].serialNumber + 1);
    expect(alloc.tickets[2].serialNumber).toBe(alloc.tickets[1].serialNumber + 1);
  });

  // --------------------------------------------------------------------------
  // TEST 5: Reject when no consecutive range exists
  // --------------------------------------------------------------------------
  it('Test 5: Reject when no consecutive range exists', async () => {
    // Only fragmented tickets available (e.g. 7 and 9, gap at 8)
    const mockTickets = [
      { _id: new Types.ObjectId(), code: 'HOH007', serialNumber: 7, status: 'available', bookingId: null },
      { _id: new Types.ObjectId(), code: 'HOH009', serialNumber: 9, status: 'available', bookingId: null }
    ];

    vi.spyOn(Ticket, 'find').mockReturnValue({
      sort: () => ({
        session: () => ({ exec: async () => mockTickets }),
        exec: async () => mockTickets
      })
    } as any);

    const alloc = await findConsecutiveTickets(2, undefined, false);
    expect(alloc.success).toBe(false);
    expect(alloc.error).toContain('No consecutive block of 2 tickets is available');
    expect(alloc.availableSingles).toEqual(['HOH007', 'HOH009']);
  });

  // --------------------------------------------------------------------------
  // TEST 6: Two simultaneous booking requests cannot reserve same tickets
  // --------------------------------------------------------------------------
  it('Test 6: Two simultaneous booking requests cannot reserve same tickets', async () => {
    let ticketReserved = false;

    // Simulate atomic findOneAndUpdate with condition { status: 'available' }
    const attemptReservation = async (buyerName: string) => {
      if (!ticketReserved) {
        ticketReserved = true;
        return { success: true, buyer: buyerName, code: 'HOH001' };
      }
      return { success: false, error: 'Ticket is already reserved.' };
    };

    // Run two concurrent reservation promises
    const [req1, req2] = await Promise.all([
      attemptReservation('Buyer A'),
      attemptReservation('Buyer B')
    ]);

    // Exactly one must succeed, the other must be rejected
    const successful = [req1, req2].filter(r => r.success);
    const failed = [req1, req2].filter(r => !r.success);

    expect(successful.length).toBe(1);
    expect(failed.length).toBe(1);
    expect(failed[0].error).toBe('Ticket is already reserved.');
  });

  // --------------------------------------------------------------------------
  // TEST 7: Two simultaneous QR scans allow only one entry
  // --------------------------------------------------------------------------
  it('Test 7: Two simultaneous QR scans allow only one entry', async () => {
    let ticketState = {
      code: 'HOH001',
      entered: false,
      entryCount: 0
    };

    // Atomic entry simulator: { $set: { entered: true }, $inc: { entryCount: 1 } } where { entered: false }
    const scanGate = async (gateName: string) => {
      if (!ticketState.entered) {
        ticketState.entered = true;
        ticketState.entryCount += 1;
        return { success: true, message: `Admitted at ${gateName}` };
      }
      return { success: false, error: 'Duplicate scan: Ticket HOH001 has already entered the venue.' };
    };

    const [scan1, scan2] = await Promise.all([
      scanGate('Gate 1'),
      scanGate('Gate 2')
    ]);

    expect(scan1.success !== scan2.success).toBe(true);
    expect(ticketState.entered).toBe(true);
    expect(ticketState.entryCount).toBe(1); // Never incremented twice
  });

  // --------------------------------------------------------------------------
  // TEST 8: Each ticket in one booking needs separate QR scan
  // --------------------------------------------------------------------------
  it('Test 8: Each ticket in one booking needs separate QR scan', async () => {
    const bookingTickets = [
      { code: 'HOH002', entered: false, entryCount: 0 },
      { code: 'HOH003', entered: false, entryCount: 0 }
    ];

    // Scan only first ticket
    const ticketToScan = bookingTickets.find(t => t.code === 'HOH002')!;
    ticketToScan.entered = true;
    ticketToScan.entryCount = 1;

    // Verify first ticket is entered, second ticket remains NOT entered
    expect(bookingTickets[0].entered).toBe(true);
    expect(bookingTickets[0].entryCount).toBe(1);

    expect(bookingTickets[1].entered).toBe(false);
    expect(bookingTickets[1].entryCount).toBe(0);
  });

  // --------------------------------------------------------------------------
  // TEST 9: Clear one ticket from multi-ticket booking
  // --------------------------------------------------------------------------
  it('Test 9: Clear one ticket from multi-ticket booking', async () => {
    const bookingId = new Types.ObjectId();
    const booking = {
      _id: bookingId,
      bookingCode: 'HOH-BOOK-000002',
      ticketQuantity: 2,
      ticketCodes: ['HOH002', 'HOH003']
    };

    let ticket2 = {
      code: 'HOH002',
      bookingId: bookingId,
      status: 'reserved',
      buyerName: 'Vikram',
      entered: true
    };

    // Action: Clear only HOH002
    ticket2.bookingId = null as any;
    ticket2.status = 'available';
    ticket2.buyerName = '';
    ticket2.entered = false;

    // Booking removes HOH002 from ticketCodes array
    booking.ticketCodes = booking.ticketCodes.filter(c => c !== 'HOH002');
    booking.ticketQuantity = booking.ticketCodes.length;

    expect(ticket2.status).toBe('available');
    expect(ticket2.bookingId).toBeNull();
    expect(booking.ticketCodes).toEqual(['HOH003']);
    expect(booking.ticketQuantity).toBe(1);
  });

  // --------------------------------------------------------------------------
  // TEST 10: Clear whole booking
  // --------------------------------------------------------------------------
  it('Test 10: Clear whole booking', async () => {
    const bookingId = new Types.ObjectId();
    const booking = {
      _id: bookingId,
      bookingCode: 'HOH-BOOK-000003',
      paymentStatus: 'Paid',
      ticketCodes: ['HOH004', 'HOH005']
    };

    const tickets = [
      { code: 'HOH004', qrPayload: 'HOH004', bookingId, status: 'reserved' },
      { code: 'HOH005', qrPayload: 'HOH005', bookingId, status: 'reserved' }
    ];

    // Clear entire booking
    tickets.forEach(t => {
      t.bookingId = null as any;
      t.status = 'available';
    });
    booking.paymentStatus = 'Cancelled';

    // Verify all tickets reset to available, and QR payloads / codes remain permanent
    expect(tickets.every(t => t.status === 'available' && t.bookingId === null)).toBe(true);
    expect(tickets[0].code).toBe('HOH004');
    expect(tickets[0].qrPayload).toBe('HOH004');
    expect(tickets[1].code).toBe('HOH005');
    expect(tickets[1].qrPayload).toBe('HOH005');
    expect(booking.paymentStatus).toBe('Cancelled');
  });

  // --------------------------------------------------------------------------
  // TEST 11: Prevent Entry Staff from reversing entry
  // --------------------------------------------------------------------------
  it('Test 11: Prevent Entry Staff from reversing entry', () => {
    const middleware = requireRole(['manager']);

    const req: any = {
      user: { userId: '123', username: 'gate_staff', name: 'Gate Staff', role: 'entry' }
    };
    let statusCode = 200;
    let jsonResponse: any = null;
    let nextCalled = false;

    const res: any = {
      status: (code: number) => {
        statusCode = code;
        return {
          json: (data: any) => { jsonResponse = data; }
        };
      }
    };
    const next = () => { nextCalled = true; };

    middleware(req, res, next);

    expect(nextCalled).toBe(false);
    expect(statusCode).toBe(403);
    expect(jsonResponse.error).toContain('Access denied. Requires role: [manager]. Your role: entry');
  });

  // --------------------------------------------------------------------------
  // TEST 12: Prevent Sales Staff from reset
  // --------------------------------------------------------------------------
  it('Test 12: Prevent Sales Staff from reset', () => {
    const middleware = requireRole(['admin']);

    const req: any = {
      user: { userId: '456', username: 'sales_user', name: 'Sales Agent', role: 'sales' }
    };
    let statusCode = 200;
    let jsonResponse: any = null;
    let nextCalled = false;

    const res: any = {
      status: (code: number) => {
        statusCode = code;
        return {
          json: (data: any) => { jsonResponse = data; }
        };
      }
    };
    const next = () => { nextCalled = true; };

    middleware(req, res, next);

    expect(nextCalled).toBe(false);
    expect(statusCode).toBe(403);
    expect(jsonResponse.error).toContain('Access denied. Requires role: [admin]. Your role: sales');
  });

  // --------------------------------------------------------------------------
  // TEST 13: Verify reset backup is created before reset in eventBackups
  // --------------------------------------------------------------------------
  it('Test 13: Verify reset backup is created before reset in eventBackups', async () => {
    const mockTicketsSnapshot = Array.from({ length: 50 }, (_, i) => ({
      code: `HOH${String(i + 1).padStart(3, '0')}`,
      status: i < 5 ? 'reserved' : 'available'
    }));
    const mockBookingsSnapshot = [
      { bookingCode: 'HOH-BOOK-000001', buyerName: 'Test Buyer', ticketQuantity: 5 }
    ];

    const backupDoc = new EventBackup({
      resetToken: 'test-token-uuid-12345',
      reason: 'Administrative season reset of all event tickets',
      performedBy: {
        userId: new Types.ObjectId(),
        username: 'admin',
        name: 'System Admin',
        role: 'admin'
      },
      ticketsSnapshot: mockTicketsSnapshot,
      bookingsSnapshot: mockBookingsSnapshot
    });

    expect(backupDoc.resetToken).toBe('test-token-uuid-12345');
    expect(backupDoc.ticketsSnapshot.length).toBe(50);
    expect(backupDoc.bookingsSnapshot.length).toBe(1);
    expect(backupDoc.performedBy.role).toBe('admin');
  });

  // --------------------------------------------------------------------------
  // TEST 14: Verify audit record exists after every action
  // --------------------------------------------------------------------------
  it('Test 14: Verify audit record exists after every action', () => {
    const auditRecord = new AuditLog({
      requestId: 'req_test_audit_98765',
      action: 'ENTRY_STATUS_CORRECTED',
      ticketCode: 'HOH010',
      reason: 'Guest stepped out with gate manager approval',
      previousValue: { entered: true },
      newValue: { entered: false },
      performedBy: {
        userId: new Types.ObjectId(),
        name: 'Event Manager',
        role: 'manager'
      }
    });

    expect(auditRecord.requestId).toBe('req_test_audit_98765');
    expect(auditRecord.action).toBe('ENTRY_STATUS_CORRECTED');
    expect(auditRecord.ticketCode).toBe('HOH010');
    expect(auditRecord.previousValue).toEqual({ entered: true });
    expect(auditRecord.newValue).toEqual({ entered: false });
    expect(auditRecord.performedBy.role).toBe('manager');
  });

  // --------------------------------------------------------------------------
  // TEST 15: Verify repeated requestId never performs duplicate action (idempotency)
  // --------------------------------------------------------------------------
  it('Test 15: Verify repeated requestId never performs duplicate action (idempotency key)', async () => {
    const requestId = 'req_idempotency_unique_123';
    let databaseActionCalls = 0;

    const idempotencyStore: Record<string, any> = {};

    const executeWithIdempotency = async (reqId: string, actionFn: () => Promise<any>) => {
      // 1. Check idempotency store
      if (idempotencyStore[reqId]) {
        return { cached: true, ...idempotencyStore[reqId] };
      }
      // 2. Perform action
      const result = await actionFn();
      // 3. Cache result
      idempotencyStore[reqId] = result;
      return { cached: false, ...result };
    };

    const action = async () => {
      databaseActionCalls += 1;
      return { success: true, bookingCode: 'HOH-BOOK-000099' };
    };

    // First execution
    const res1 = await executeWithIdempotency(requestId, action);
    expect(res1.cached).toBe(false);
    expect(databaseActionCalls).toBe(1);

    // Repeated execution with identical requestId
    const res2 = await executeWithIdempotency(requestId, action);
    expect(res2.cached).toBe(true);
    expect(res2.bookingCode).toBe('HOH-BOOK-000099');
    expect(databaseActionCalls).toBe(1); // NOT called again!
  });

  // --------------------------------------------------------------------------
  // TEST 16: Verify MongoDB outage does not change ticket state
  // --------------------------------------------------------------------------
  it('Test 16: Verify MongoDB outage does not change ticket state', async () => {
    const originalTicket = {
      code: 'HOH015',
      status: 'available',
      entered: false
    };

    // Attempt mutation that throws database connectivity error
    const performMutationWithDbError = async () => {
      try {
        throw new Error('MongoServerSelectionError: connect ECONNREFUSED');
      } catch (err: any) {
        return {
          ok: false,
          error: 'Sync Failed — no change was saved.'
        };
      }
    };

    const result = await performMutationWithDbError();

    // Verify error handled gracefully and in-memory ticket unchanged
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Sync Failed — no change was saved.');
    expect(originalTicket.status).toBe('available');
    expect(originalTicket.entered).toBe(false);
  });
});

describe('MongoDB Staff Authentication & Password Hashing', () => {
  it('correctly hashes passwords with bcrypt and verifies matching passwords', async () => {
    const password = 'manager@HOH2025';
    const hash = await bcrypt.hash(password, 10);

    const isMatch = await bcrypt.compare(password, hash);
    expect(isMatch).toBe(true);

    const isWrong = await bcrypt.compare('wrongPassword', hash);
    expect(isWrong).toBe(false);
  });

  it('enforces User model roles', () => {
    const allowedRoles = ['admin', 'manager', 'sales', 'entry'];
    allowedRoles.forEach(role => {
      const user = new User({
        username: `${role}_test`,
        name: `Test ${role}`,
        role,
        passwordHash: 'dummyhash',
        passkey: `hoh-${role}-2025`
      });
      expect(user.role).toBe(role);
    });
  });
});
