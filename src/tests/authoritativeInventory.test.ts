import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Types } from 'mongoose';
import mongoose from 'mongoose';
import { Ticket } from '../../server/models/Ticket';
import { Booking } from '../../server/models/Booking';
import { getAvailableTickets, countAvailableTickets } from '../../server/services/allocationService';
import { getDashboardStats, getTickets, getDatabaseStatus } from '../../server/controllers/ticketController';

describe('Authoritative MongoDB Inventory & Database Diagnostic Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('getAvailableTickets queries only status: available and bookingId: null sorted by serialNumber', async () => {
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

  it('countAvailableTickets returns authoritative count of available tickets', async () => {
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

  it('getDashboardStats computes counts strictly from MongoDB queries and returns accurate stats', async () => {
    vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(1 as any);

    // Mock counts for a clean 50-ticket DB
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

  it('getDatabaseStatus diagnostic endpoint returns 50 tickets and connected: true', async () => {
    vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(1 as any);

    vi.spyOn(Ticket, 'countDocuments').mockImplementation(((filter?: any) => {
      if (!filter || Object.keys(filter).length === 0) return Promise.resolve(50);
      if (filter.status === 'available' && filter.bookingId === null) return Promise.resolve(50);
      if (filter.status === 'registered') return Promise.resolve(0);
      if (filter.status === 'entered') return Promise.resolve(0);
      if (filter.status === 'cancelled') return Promise.resolve(0);
      return Promise.resolve(0);
    }) as any);

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
      }
    });
  });

  it('returns HTTP 503 DATABASE_UNAVAILABLE when MongoDB is disconnected', async () => {
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
        message: 'MongoDB Atlas is unavailable.'
      }
    });
  });
});
