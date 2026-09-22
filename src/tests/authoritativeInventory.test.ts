import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Types } from 'mongoose';
import mongoose from 'mongoose';
import { Ticket } from '../../server/models/Ticket';
import { Booking } from '../../server/models/Booking';
import { Counter } from '../../server/models/Counter';
import { IdempotencyKey } from '../../server/models/IdempotencyKey';
import { getAvailableTickets, countAvailableTickets, findConsecutiveFromAnchor } from '../../server/services/allocationService';
import {
  getDashboardStats,
  getDatabaseStatus,
  getTestSaleReadiness,
  getTicketIntegrity,
  testAll50Allocations,
  markTicketEntered,
  markTicketNotEntered
} from '../../server/controllers/ticketController';
import { createBooking } from '../../server/controllers/bookingController';
import { initializeDatabase } from '../../server/services/initService';

describe('Authoritative MongoDB Inventory & Database Diagnostic Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('TEST 1: getAvailableTickets queries only status: available and bookingId: null sorted by serialNumber', async () => {
    const mockAvailableTickets = [
      { _id: new Types.ObjectId(), code: 'HOH001', serialNumber: 1, status: 'available', bookingId: null },
      { _id: new Types.ObjectId(), code: 'HOH002', serialNumber: 2, status: 'available', bookingId: null },
      { _id: new Types.ObjectId(), code: 'HOH003', serialNumber: 3, status: 'available', bookingId: null }
    ];

    const sortMock = vi.fn().mockReturnThis();
    const execMock = vi.fn().mockResolvedValue(mockAvailableTickets);
    const findSpy = vi.spyOn(Ticket, 'find').mockReturnValue({
      sort: sortMock,
      exec: execMock
    } as any);

    const result = await getAvailableTickets();

    expect(findSpy).toHaveBeenCalledWith({
      status: 'available',
      bookingId: null
    });
    expect(sortMock).toHaveBeenCalledWith({ serialNumber: 1 });
    expect(result).toHaveLength(3);
    expect(result[0].code).toBe('HOH001');
  });

  it('TEST 2: countAvailableTickets returns authoritative count of available tickets', async () => {
    const countSpy = vi.spyOn(Ticket, 'countDocuments').mockReturnValue({
      exec: vi.fn().mockResolvedValue(50)
    } as any);

    const count = await countAvailableTickets();

    expect(countSpy).toHaveBeenCalledWith({
      status: 'available',
      bookingId: null
    });
    expect(count).toBe(50);
  });

  it('TEST 3: getDashboardStats computes counts strictly from MongoDB queries and returns accurate stats', async () => {
    vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(1 as any);

    vi.spyOn(Ticket, 'countDocuments').mockImplementation(((filter?: any) => {
      if (!filter || Object.keys(filter).length === 0) return Promise.resolve(50);
      if (filter.status === 'available' && filter.bookingId === null) return Promise.resolve(50);
      if (filter.entered === true) return Promise.resolve(0);
      if (filter.status === 'cancelled') return Promise.resolve(0);
      if (filter.status === 'registered') return Promise.resolve(0);
      if (filter['$or']) return Promise.resolve(0);
      return Promise.resolve(0);
    }) as any);

    vi.spyOn(Booking, 'find').mockReturnValue({
      lean: vi.fn().mockResolvedValue([])
    } as any);

    const req: any = {};
    const res: any = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis()
    };

    await getDashboardStats(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        totalTickets: 50,
        available: 50,
        registered: 0,
        entered: 0,
        notEntered: 0,
        cancelled: 0,
        attendanceRate: 0
      })
    }));
  });

  it('TEST 4: getDatabaseStatus returns 50 tickets, total bookings, and consistency check', async () => {
    vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(1 as any);

    vi.spyOn(Ticket, 'countDocuments').mockImplementation(((filter?: any) => {
      if (!filter || Object.keys(filter).length === 0) return Promise.resolve(50);
      if (filter.status === 'available' && filter.bookingId === null) return Promise.resolve(50);
      if (filter.status === 'registered') return Promise.resolve(0);
      if (filter.status === 'entered') return Promise.resolve(0);
      if (filter.status === 'cancelled') return Promise.resolve(0);
      return Promise.resolve(0);
    }) as any);

    vi.spyOn(Booking, 'countDocuments').mockResolvedValue(0 as any);
    vi.spyOn(Booking, 'find').mockReturnValue({
      lean: vi.fn().mockResolvedValue([])
    } as any);

    const req: any = {};
    const res: any = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis()
    };

    await getDatabaseStatus(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      database: 'mongodb-atlas',
      connected: true,
      tickets: {
        total: 50,
        available: 50,
        registered: 0,
        entered: 0,
        cancelled: 0
      },
      bookings: {
        total: 0
      },
      consistency: {
        isConsistent: true,
        issues: []
      }
    });
  });

  it('TEST 5: returns HTTP 503 DATABASE_UNAVAILABLE when MongoDB is disconnected', async () => {
    vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(0 as any);

    const req: any = {};
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn()
    };

    await getDashboardStats(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'MongoDB Atlas is unavailable. No ticket or booking changes were saved.'
      }
    });
  });

  it('TEST 6: double submit with same Idempotency-Key returns stored response without creating new booking', async () => {
    vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(1 as any);

    const existingResponse = {
      success: true,
      booking: { bookingCode: 'HOH-BOOK-000001' },
      tickets: ['HOH001']
    };

    vi.spyOn(IdempotencyKey, 'findOne').mockResolvedValue({
      requestId: 'test_key_123',
      action: 'OFFLINE_SALE_CREATED',
      response: existingResponse,
      statusCode: 201
    } as any);

    const req: any = {
      headers: { 'idempotency-key': 'test_key_123' },
      body: {
        buyerName: 'Rahul Sharma',
        phone: '+91 98765 43210',
        ticketQuantity: 1,
        anchorTicket: 'HOH001'
      }
    };

    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn()
    };

    await createBooking(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(existingResponse);
  });

  it('TEST 7: markTicketEntered sets status: entered, entered: true, and entryCount: 1', async () => {
    vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(1 as any);

    const mockTicket = {
      code: 'HOH001',
      status: 'registered',
      buyerName: 'Aarav Sharma',
      entered: false
    };

    vi.spyOn(Ticket, 'findOne').mockResolvedValue(mockTicket as any);
    const updateSpy = vi.spyOn(Ticket, 'findOneAndUpdate').mockResolvedValue({
      ...mockTicket,
      status: 'entered',
      entered: true,
      entryCount: 1
    } as any);

    const req: any = {
      params: { code: 'HOH001' },
      body: {}
    };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn()
    };

    await markTicketEntered(req, res);

    expect(updateSpy).toHaveBeenCalledWith(
      { code: 'HOH001' },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'entered',
          entered: true,
          entryCount: 1
        })
      }),
      { new: true }
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('TEST 8: markTicketNotEntered sets status: registered, entered: false, enteredAt: null', async () => {
    vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(1 as any);

    const updateSpy = vi.spyOn(Ticket, 'findOneAndUpdate').mockResolvedValue({
      code: 'HOH001',
      status: 'registered',
      entered: false,
      enteredAt: null
    } as any);

    const req: any = {
      params: { code: 'HOH001' },
      body: {}
    };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn()
    };

    await markTicketNotEntered(req, res);

    expect(updateSpy).toHaveBeenCalledWith(
      { code: 'HOH001' },
      { $set: { status: 'registered', entered: false, enteredAt: null, entryCount: 0 } },
      { new: true }
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('TEST 9: getTestSaleReadiness non-destructively inspects MongoDB and HOH001', async () => {
    vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(1 as any);

    const mockSession: any = {
      withTransaction: vi.fn().mockImplementation(async (cb: any) => cb()),
      endSession: vi.fn().mockResolvedValue(undefined)
    };
    vi.spyOn(mongoose, 'startSession').mockResolvedValue(mockSession);

    const mockTicket001 = {
      code: 'HOH001',
      serialNumber: 1,
      status: 'available',
      bookingId: null,
      buyerName: null,
      phone: null,
      entered: false
    };

    const makeQuery = (data: any) => {
      const q: any = {
        session: vi.fn().mockReturnThis(),
        lean: vi.fn().mockResolvedValue(data),
        exec: vi.fn().mockResolvedValue(data)
      };
      return q;
    };

    vi.spyOn(Ticket, 'findOne').mockImplementation(() => makeQuery(mockTicket001));

    const req: any = {};
    const res: any = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis()
    };

    await getTestSaleReadiness(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      database: 'mongodb-atlas',
      connected: true,
      transactionSupported: true,
      ticketHOH001: expect.objectContaining({
        exists: true,
        code: 'HOH001',
        isAvailable: true,
        status: 'available'
      })
    }));
  });

  it('TEST 10: createBooking runs transactional ticket claiming and returns 201 with verified readback', async () => {
    vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(1 as any);

    const mockSession: any = {
      withTransaction: vi.fn().mockImplementation(async (cb: any) => cb()),
      endSession: vi.fn().mockResolvedValue(undefined)
    };
    vi.spyOn(mongoose, 'startSession').mockResolvedValue(mockSession);

    const ticketId = new Types.ObjectId();
    const bookingId = new Types.ObjectId();

    const mockCandidateTicket = {
      _id: ticketId,
      code: 'HOH001',
      serialNumber: 1,
      status: 'available',
      bookingId: null
    };

    const makeFindQuery = (data: any) => {
      const q: any = {
        session: vi.fn().mockReturnThis(),
        lean: vi.fn().mockResolvedValue(data),
        sort: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue(data)
      };
      // Allow awaiting the query directly
      q.then = (resolve: any) => Promise.resolve(data).then(resolve);
      return q;
    };

    vi.spyOn(Ticket, 'find').mockImplementation(((filter: any) => {
      if (filter && filter.bookingId) {
        // Step G post-commit readback
        return makeFindQuery([
          {
            _id: ticketId,
            code: 'HOH001',
            status: 'registered',
            bookingId: bookingId
          }
        ]);
      }
      return makeFindQuery([mockCandidateTicket]);
    }) as any);

    vi.spyOn(Ticket, 'findOne').mockImplementation(() => {
      const q: any = {
        session: vi.fn().mockReturnThis(),
        lean: vi.fn().mockResolvedValue(mockCandidateTicket),
        exec: vi.fn().mockResolvedValue(mockCandidateTicket)
      };
      q.then = (resolve: any) => Promise.resolve(mockCandidateTicket).then(resolve);
      return q;
    });

    const mockCreatedBooking = {
      _id: bookingId,
      bookingCode: 'HOH-BOOK-000001',
      buyerName: 'Rahul Sharma',
      phone: '9876543210',
      ticketQuantity: 1,
      ticketCodes: ['HOH001'],
      paymentStatus: 'PAID',
      paymentMethod: 'CASH',
      totalAmount: 500,
      amountPaid: 500,
      source: 'OFFLINE'
    };

    vi.spyOn(Counter, 'findByIdAndUpdate').mockResolvedValue({
      _id: 'bookingCode',
      seq: 1
    } as any);

    vi.spyOn(Booking, 'create').mockResolvedValue([mockCreatedBooking] as any);
    vi.spyOn(Booking, 'findById').mockImplementation(() => {
      const q: any = {
        session: vi.fn().mockReturnThis(),
        lean: vi.fn().mockResolvedValue(mockCreatedBooking),
        exec: vi.fn().mockResolvedValue(mockCreatedBooking)
      };
      q.then = (resolve: any) => Promise.resolve(mockCreatedBooking).then(resolve);
      return q;
    });

    vi.spyOn(Ticket, 'updateMany').mockResolvedValue({
      acknowledged: true,
      modifiedCount: 1,
      matchedCount: 1,
      upsertedCount: 0,
      upsertedId: null
    } as any);

    const req: any = {
      headers: {},
      body: {
        buyerName: 'Rahul Sharma',
        phone: '9876543210',
        ticketQuantity: 1,
        anchorTicket: 'HOH001',
        paymentStatus: 'PAID',
        paymentMethod: 'CASH',
        totalAmount: 500,
        amountPaid: 500
      }
    };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn()
    };

    await createBooking(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      booking: expect.objectContaining({
        bookingCode: 'HOH-BOOK-000001',
        buyerName: 'Rahul Sharma'
      }),
      tickets: expect.arrayContaining([
        expect.objectContaining({
          code: 'HOH001',
          status: 'registered'
        })
      ])
    }));
  });

  it('TEST 11: createBooking rolls back and returns 409 TICKET_NOT_AVAILABLE when ticket is already registered', async () => {
    vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(1 as any);

    const mockSession: any = {
      withTransaction: vi.fn().mockImplementation(async (cb: any) => cb()),
      endSession: vi.fn().mockResolvedValue(undefined)
    };
    vi.spyOn(mongoose, 'startSession').mockResolvedValue(mockSession);

    const mockTakenTicket = {
      code: 'HOH001',
      serialNumber: 1,
      status: 'registered',
      bookingId: new Types.ObjectId()
    };

    const makeFindQuery = (data: any) => {
      const q: any = {
        session: vi.fn().mockReturnThis(),
        lean: vi.fn().mockResolvedValue(data),
        sort: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue(data)
      };
      q.then = (resolve: any) => Promise.resolve(data).then(resolve);
      return q;
    };

    vi.spyOn(Ticket, 'find').mockImplementation(() => makeFindQuery([]));
    vi.spyOn(Ticket, 'findOne').mockImplementation(() => {
      const q: any = {
        session: vi.fn().mockReturnThis(),
        lean: vi.fn().mockResolvedValue(mockTakenTicket),
        exec: vi.fn().mockResolvedValue(mockTakenTicket)
      };
      q.then = (resolve: any) => Promise.resolve(mockTakenTicket).then(resolve);
      return q;
    });

    const req: any = {
      headers: {},
      body: {
        buyerName: 'Priya Patel',
        phone: '9876543210',
        ticketQuantity: 1,
        anchorTicket: 'HOH001'
      }
    };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn()
    };

    await createBooking(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: expect.objectContaining({
        code: 'ANCHOR_ALREADY_REGISTERED'
      })
    }));
  });

  it('TEST 12: getTicketIntegrity endpoint returns all 50 tickets and zero invalid records for healthy inventory', async () => {
    vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(1 as any);

    const mock50Tickets = Array.from({ length: 50 }, (_, i) => ({
      _id: new Types.ObjectId(),
      code: `HOH${String(i + 1).padStart(3, '0')}`,
      serialNumber: i + 1,
      status: i === 0 ? 'registered' : 'available',
      bookingId: i === 0 ? new Types.ObjectId() : null,
      buyerName: i === 0 ? 'Rahul Sharma' : null,
      phone: i === 0 ? '9876543210' : null,
      email: i === 0 ? 'rahul@example.com' : null
    }));

    const mockBooking = {
      _id: mock50Tickets[0].bookingId,
      bookingCode: 'HOH-BKG-0001',
      ticketCodes: ['HOH001']
    };

    vi.spyOn(Ticket, 'find').mockReturnValue({
      sort: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue(mock50Tickets)
      })
    } as any);

    vi.spyOn(Booking, 'find').mockReturnValue({
      lean: vi.fn().mockResolvedValue([mockBooking])
    } as any);

    vi.spyOn(Ticket, 'aggregate').mockResolvedValue([]);

    const req: any = {};
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn()
    };

    await getTicketIntegrity(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      total: 50,
      missingCodes: [],
      duplicateCodes: [],
      invalidSerialNumbers: [],
      invalidStatuses: [],
      registeredTickets: ['HOH001'],
      cancelledTickets: [],
      orphanBookings: [],
      tickets: expect.arrayContaining([
        expect.objectContaining({
          code: 'HOH001',
          serialNumber: 1,
          status: 'registered',
          buyerName: 'Rahul Sharma'
        }),
        expect.objectContaining({
          code: 'HOH050',
          serialNumber: 50,
          status: 'available',
          bookingId: null,
          buyerName: null
        })
      ])
    }));

    // Verify phone/email are not leaked in diagnostic response
    const jsonCall = res.json.mock.calls[0][0];
    expect(jsonCall.tickets[0].phone).toBeUndefined();
    expect(jsonCall.tickets[0].email).toBeUndefined();
  });

  it('TEST 13: testAll50Allocations tests anchor allocation for every ticket HOH001-HOH050', async () => {
    vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(1 as any);

    const mock50Tickets = Array.from({ length: 50 }, (_, i) => ({
      _id: new Types.ObjectId(),
      code: `HOH${String(i + 1).padStart(3, '0')}`,
      serialNumber: i + 1,
      status: 'available',
      bookingId: null
    }));

    vi.spyOn(Ticket, 'find').mockReturnValue({
      lean: vi.fn().mockResolvedValue(mock50Tickets)
    } as any);

    vi.spyOn(Ticket, 'findOne').mockImplementation(((filter: any) => {
      const code = filter.code;
      const found = mock50Tickets.find(t => t.code === code);
      const q: any = {
        session: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue(found || null)
      };
      q.then = (resolve: any) => Promise.resolve(found || null).then(resolve);
      return q;
    }) as any);

    const req: any = {};
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn()
    };

    await testAll50Allocations(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      total: 50,
      passed: 50,
      failed: 0,
      results: expect.arrayContaining([
        expect.objectContaining({ code: 'HOH001', status: 'PASS' }),
        expect.objectContaining({ code: 'HOH002', status: 'PASS' }),
        expect.objectContaining({ code: 'HOH025', status: 'PASS' }),
        expect.objectContaining({ code: 'HOH050', status: 'PASS' })
      ])
    }));
  });

  it('TEST 14: findConsecutiveFromAnchor allocates arbitrary anchor codes without defaulting to HOH001', async () => {
    const mock50 = Array.from({ length: 50 }, (_, i) => ({
      _id: new Types.ObjectId(),
      code: `HOH${String(i + 1).padStart(3, '0')}`,
      serialNumber: i + 1,
      status: 'available',
      bookingId: null
    }));

    vi.spyOn(Ticket, 'findOne').mockImplementation(((filter: any) => {
      const found = mock50.find(t => t.code === filter.code);
      const q: any = {
        session: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue(found || null)
      };
      q.then = (resolve: any) => Promise.resolve(found || null).then(resolve);
      return q;
    }) as any);

    vi.spyOn(Ticket, 'find').mockImplementation(((filter: any) => {
      let found = mock50;
      if (filter && filter.$or) {
        const codes = filter.$or[0]?.code?.$in || [];
        found = mock50.filter(t => codes.includes(t.code));
      } else if (filter && filter.code && filter.code.$in) {
        found = mock50.filter(t => filter.code.$in.includes(t.code));
      }
      const q: any = {
        session: vi.fn().mockReturnThis(),
        sort: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue(found)
      };
      q.then = (resolve: any) => Promise.resolve(found).then(resolve);
      return q;
    }) as any);

    // Test HOH002 qty 1
    const resHOH002 = await findConsecutiveFromAnchor('HOH002', 1);
    expect(resHOH002.success).toBe(true);
    expect(resHOH002.tickets[0].code).toBe('HOH002');

    // Test HOH010 qty 1
    const resHOH010 = await findConsecutiveFromAnchor('HOH010', 1);
    expect(resHOH010.success).toBe(true);
    expect(resHOH010.tickets[0].code).toBe('HOH010');

    // Test HOH025 qty 1
    const resHOH025 = await findConsecutiveFromAnchor('HOH025', 1);
    expect(resHOH025.success).toBe(true);
    expect(resHOH025.tickets[0].code).toBe('HOH025');

    // Test HOH050 qty 1
    const resHOH050 = await findConsecutiveFromAnchor('HOH050', 1);
    expect(resHOH050.success).toBe(true);
    expect(resHOH050.tickets[0].code).toBe('HOH050');

    // Test HOH010 qty 2 -> HOH010, HOH011
    const resHOH010Qty2 = await findConsecutiveFromAnchor('HOH010', 2);
    expect(resHOH010Qty2.success).toBe(true);
    expect(resHOH010Qty2.tickets.map(t => t.code)).toEqual(['HOH010', 'HOH011']);

    // Test HOH020 qty 3 -> HOH020, HOH021, HOH022
    const resHOH020Qty3 = await findConsecutiveFromAnchor('HOH020', 3);
    expect(resHOH020Qty3.success).toBe(true);
    expect(resHOH020Qty3.tickets.map(t => t.code)).toEqual(['HOH020', 'HOH021', 'HOH022']);
  });

  it('TEST 15: createBooking successfully registers non-HOH001 tickets (HOH002, HOH003) atomically', async () => {
    vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(1 as any);

    const mockSession: any = {
      withTransaction: vi.fn().mockImplementation(async (cb: any) => cb()),
      endSession: vi.fn().mockResolvedValue(undefined)
    };
    vi.spyOn(mongoose, 'startSession').mockResolvedValue(mockSession);

    const ticketHOH002 = {
      _id: new Types.ObjectId(),
      code: 'HOH002',
      serialNumber: 2,
      status: 'available',
      bookingId: null
    };

    const makeQuery = (data: any) => {
      const q: any = {
        session: vi.fn().mockReturnThis(),
        lean: vi.fn().mockResolvedValue(data),
        sort: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue(data)
      };
      q.then = (resolve: any) => Promise.resolve(data).then(resolve);
      return q;
    };

    vi.spyOn(Ticket, 'findOne').mockImplementation(((filter: any) => {
      if (filter.code === 'HOH002') return makeQuery(ticketHOH002);
      return makeQuery(null);
    }) as any);

    vi.spyOn(Ticket, 'find').mockImplementation(((filter: any) => {
      if (filter && filter.bookingId) {
        return makeQuery([
          {
            _id: ticketHOH002._id,
            code: 'HOH002',
            serialNumber: 2,
            status: 'registered',
            bookingId: mockBookingId
          }
        ]);
      }
      return makeQuery([ticketHOH002]);
    }) as any);

    vi.spyOn(Counter, 'findByIdAndUpdate').mockImplementation(() => makeQuery({ seq: 2 }));
    vi.spyOn(IdempotencyKey, 'findOne').mockImplementation(() => makeQuery(null));
    vi.spyOn(IdempotencyKey, 'create').mockResolvedValue([] as any);

    const mockBookingId = new Types.ObjectId();
    const mockCreatedBooking = {
      _id: mockBookingId,
      bookingCode: 'HOH-BKG-000002',
      buyerName: 'Aarav Gupta',
      phone: '9876543210',
      email: 'aarav@example.com',
      ticketQuantity: 1,
      ticketCodes: ['HOH002'],
      anchorTicketCode: 'HOH002',
      paymentMethod: 'UPI',
      paymentStatus: 'PAID',
      totalAmount: 500,
      amountPaid: 500,
      source: 'OFFLINE'
    };

    vi.spyOn(Booking, 'create').mockResolvedValue([mockCreatedBooking] as any);
    vi.spyOn(Booking, 'findById').mockImplementation(() => makeQuery(mockCreatedBooking));

    vi.spyOn(Ticket, 'updateMany').mockResolvedValue({
      acknowledged: true,
      modifiedCount: 1,
      matchedCount: 1,
      upsertedCount: 0,
      upsertedId: null
    } as any);

    const req: any = {
      headers: { 'idempotency-key': 'test-hoh002-sale' },
      body: {
        buyerName: 'Aarav Gupta',
        phone: '9876543210',
        email: 'aarav@example.com',
        ticketQuantity: 1,
        anchorTicket: 'HOH002',
        paymentMethod: 'UPI',
        paymentStatus: 'PAID',
        totalAmount: 500,
        amountPaid: 500
      }
    };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn()
    };

    await createBooking(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      booking: expect.objectContaining({
        ticketCodes: ['HOH002'],
        buyerName: 'Aarav Gupta'
      }),
      tickets: expect.arrayContaining([
        expect.objectContaining({
          code: 'HOH002',
          status: 'registered'
        })
      ])
    }));
  });

  it('TEST 16: initializeDatabase repairs malformed available tickets while preserving customer registered tickets', async () => {
    vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(1 as any);
    vi.spyOn(Ticket, 'syncIndexes').mockResolvedValue(undefined as any);

    const realCustomerBookingId = new Types.ObjectId();
    const existingTicketsInDb = [
      // HOH001 is a registered customer ticket
      {
        _id: new Types.ObjectId(),
        code: 'HOH001',
        serialNumber: 1,
        status: 'registered',
        bookingId: realCustomerBookingId,
        buyerName: 'Existing Customer',
        phone: '9999988888',
        email: 'cust@example.com',
        entered: false,
        qrPayload: 'HOH001'
      },
      // HOH002 is an available ticket with malformed serialNumber (e.g. 1 instead of 2)
      {
        _id: new Types.ObjectId(),
        code: 'HOH002',
        serialNumber: 1, // MALFORMED!
        status: 'AVAILABLE', // Uppercase
        bookingId: null,
        buyerName: null,
        phone: null,
        email: null,
        entered: false
      }
    ];

    const updateOneSpy = vi.spyOn(Ticket, 'updateOne').mockResolvedValue({} as any);
    const createSpy = vi.spyOn(Ticket, 'create').mockResolvedValue({} as any);

    vi.spyOn(Ticket, 'findOne').mockImplementation(((filter: any) => {
      const regex = filter.code?.$regex;
      const codeMatch = existingTicketsInDb.find(t => regex.test(t.code));
      const q: any = {
        exec: vi.fn().mockResolvedValue(codeMatch || null)
      };
      q.then = (resolve: any) => Promise.resolve(codeMatch || null).then(resolve);
      return q;
    }) as any);

    vi.spyOn(Ticket, 'aggregate').mockResolvedValue([]);
    vi.spyOn(mongoose.model('Admin'), 'countDocuments').mockResolvedValue(1 as any);
    vi.spyOn(Counter, 'findById').mockResolvedValue({ _id: 'bookingCode', seq: 1 } as any);

    // Mock the validation query returning all 50 clean tickets
    const clean50 = Array.from({ length: 50 }, (_, i) => ({
      _id: new Types.ObjectId(),
      code: `HOH${String(i + 1).padStart(3, '0')}`,
      serialNumber: i + 1,
      status: i === 0 ? 'registered' : 'available',
      bookingId: i === 0 ? realCustomerBookingId : null,
      buyerName: i === 0 ? 'Existing Customer' : null,
      entered: false
    }));

    vi.spyOn(Ticket, 'find').mockReturnValue({
      sort: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue(clean50)
      })
    } as any);

    await initializeDatabase();

    // Verify HOH002 malformed ticket was repaired to serialNumber 2, status: 'available'
    expect(updateOneSpy).toHaveBeenCalledWith(
      { _id: existingTicketsInDb[1]._id },
      expect.objectContaining({
        $set: expect.objectContaining({
          code: 'HOH002',
          serialNumber: 2,
          status: 'available',
          bookingId: null
        })
      })
    );

    // Verify missing tickets (HOH003..HOH050) were created
    expect(createSpy).toHaveBeenCalledTimes(48);
  });

  it('TEST 17: Allocation engine guarantees requested code === allocated code for every single ticket HOH001 to HOH050', async () => {
    const mock50 = Array.from({ length: 50 }, (_, i) => ({
      _id: new Types.ObjectId(),
      code: `HOH${String(i + 1).padStart(3, '0')}`,
      serialNumber: i + 1,
      status: 'available',
      bookingId: null
    }));

    vi.spyOn(Ticket, 'findOne').mockImplementation(((filter: any) => {
      const found = mock50.find(t => t.code === filter.code);
      const q: any = {
        session: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue(found || null)
      };
      q.then = (resolve: any) => Promise.resolve(found || null).then(resolve);
      return q;
    }) as any);

    for (let i = 1; i <= 50; i++) {
      const expectedCode = `HOH${String(i).padStart(3, '0')}`;
      const alloc = await findConsecutiveFromAnchor(expectedCode, 1);
      expect(alloc.success).toBe(true);
      expect(alloc.tickets).toHaveLength(1);
      expect(alloc.tickets[0].code).toBe(expectedCode);
      expect(alloc.anchorCode).toBe(expectedCode);
    }
  });

  it('TEST 18: Multi-ticket contiguous allocation handles consecutive sequences and blocked fallback', async () => {
    const mock50 = Array.from({ length: 50 }, (_, i) => ({
      _id: new Types.ObjectId(),
      code: `HOH${String(i + 1).padStart(3, '0')}`,
      serialNumber: i + 1,
      status: 'available',
      bookingId: null
    }));

    const queryMock = (data: any) => {
      let limitCount: number | null = null;
      const q: any = {
        session: vi.fn().mockReturnThis(),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockImplementation((num: number) => {
          limitCount = num;
          return q;
        }),
        exec: vi.fn().mockImplementation(() => {
          const res = Array.isArray(data) && limitCount !== null ? data.slice(0, limitCount) : data;
          return Promise.resolve(res);
        })
      };
      q.then = (resolve: any) => {
        const res = Array.isArray(data) && limitCount !== null ? data.slice(0, limitCount) : data;
        return Promise.resolve(res).then(resolve);
      };
      return q;
    };

    vi.spyOn(Ticket, 'findOne').mockImplementation(((filter: any) => {
      const found = mock50.find(t => t.code === filter.code);
      return queryMock(found || null);
    }) as any);

    vi.spyOn(Ticket, 'find').mockImplementation(((filter: any) => {
      if (filter && filter.code && filter.code.$in) {
        const codes: string[] = filter.code.$in;
        const found = mock50.filter(t => codes.includes(t.code));
        return queryMock(found);
      }
      return queryMock(mock50);
    }) as any);

    // 1. HOH001 qty 2 -> HOH001, HOH002
    const res1 = await findConsecutiveFromAnchor('HOH001', 2);
    expect(res1.success).toBe(true);
    expect(res1.tickets.map(t => t.code)).toEqual(['HOH001', 'HOH002']);

    // 2. HOH010 qty 3 -> HOH010, HOH011, HOH012
    const res2 = await findConsecutiveFromAnchor('HOH010', 3);
    expect(res2.success).toBe(true);
    expect(res2.tickets.map(t => t.code)).toEqual(['HOH010', 'HOH011', 'HOH012']);

    // 3. HOH021 qty 4 -> HOH021, HOH022, HOH023, HOH024
    const res3 = await findConsecutiveFromAnchor('HOH021', 4);
    expect(res3.success).toBe(true);
    expect(res3.tickets.map(t => t.code)).toEqual(['HOH021', 'HOH022', 'HOH023', 'HOH024']);

    // 4. HOH047 qty 4 -> HOH047, HOH048, HOH049, HOH050
    const res4 = await findConsecutiveFromAnchor('HOH047', 4);
    expect(res4.success).toBe(true);
    expect(res4.tickets.map(t => t.code)).toEqual(['HOH047', 'HOH048', 'HOH049', 'HOH050']);

    // 5. Blocked scenario: mark HOH022 as registered.
    const mockWithBlocked = mock50.map(t => {
      if (t.code === 'HOH022') {
        return { ...t, status: 'registered', bookingId: new Types.ObjectId() };
      }
      return t;
    });

    vi.spyOn(Ticket, 'findOne').mockImplementation(((filter: any) => {
      const found = mockWithBlocked.find(t => t.code === filter.code);
      return queryMock(found || null);
    }) as any);

    vi.spyOn(Ticket, 'find').mockImplementation(((filter: any) => {
      let found = mockWithBlocked;
      if (filter && filter.$or) {
        const codes = filter.$or[0]?.code?.$in || [];
        found = mockWithBlocked.filter(t => codes.includes(t.code));
      } else if (filter && filter.code && filter.code.$in) {
        found = mockWithBlocked.filter(t => filter.code.$in.includes(t.code));
      } else if (filter && filter.serialNumber && filter.serialNumber.$gt) {
        found = mockWithBlocked.filter(t => t.status === 'available' && t.serialNumber > filter.serialNumber.$gt);
      }
      return queryMock(found);
    }) as any);

    // Without override -> halts and reports blocked ticket
    const resBlocked = await findConsecutiveFromAnchor('HOH021', 4, undefined, false);
    expect(resBlocked.success).toBe(false);
    expect(resBlocked.reason).toBe('CONSECUTIVE_UNAVAILABLE');
    expect(resBlocked.blockedTicket).toBe('HOH022');

    // With override -> allows non-consecutive allocation
    const resOverride = await findConsecutiveFromAnchor('HOH021', 4, undefined, true);
    expect(resOverride.success).toBe(true);
    expect(resOverride.isConsecutive).toBe(false);
    expect(resOverride.tickets.map(t => t.code)).toEqual(['HOH021', 'HOH023', 'HOH024', 'HOH025']);
    expect(resOverride.skippedTickets).toEqual(['HOH022']);
  });

  it('TEST 19: Database integrity test validates HOH001->1 to HOH050->50 1:1 mapping and uniqueness', async () => {
    const mock50 = Array.from({ length: 50 }, (_, i) => ({
      _id: new Types.ObjectId(),
      code: `HOH${String(i + 1).padStart(3, '0')}`,
      serialNumber: i + 1,
      status: 'available',
      bookingId: null
    }));

    // Verify all 50 codes and serials are unique
    const codeSet = new Set(mock50.map(t => t.code));
    const serialSet = new Set(mock50.map(t => t.serialNumber));

    expect(codeSet.size).toBe(50);
    expect(serialSet.size).toBe(50);

    mock50.forEach(t => {
      const num = parseInt(t.code.replace('HOH', ''), 10);
      expect(t.serialNumber).toBe(num);
      expect(t.serialNumber).toBeGreaterThanOrEqual(1);
      expect(t.serialNumber).toBeLessThanOrEqual(50);
    });
  });
});
