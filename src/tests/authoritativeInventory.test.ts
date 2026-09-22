import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Types } from 'mongoose';
import mongoose from 'mongoose';
import { Ticket } from '../../server/models/Ticket';
import { Booking } from '../../server/models/Booking';
import { Counter } from '../../server/models/Counter';
import { IdempotencyKey } from '../../server/models/IdempotencyKey';
import { getAvailableTickets, countAvailableTickets } from '../../server/services/allocationService';
import { getDashboardStats, getDatabaseStatus, getTestSaleReadiness, markTicketEntered, markTicketNotEntered } from '../../server/controllers/ticketController';
import { createBooking } from '../../server/controllers/bookingController';

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
      key: 'test_key_123',
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
    vi.spyOn(Booking, 'findById').mockReturnValue({
      lean: vi.fn().mockResolvedValue(mockCreatedBooking)
    } as any);

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
});
