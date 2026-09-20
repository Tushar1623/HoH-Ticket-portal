import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Types } from 'mongoose';
import { Ticket } from '../../server/models/Ticket';
import {
  findConsecutiveFromAnchor,
  previewPhysicalSale
} from '../../server/services/allocationService';

describe('Physical Offline Ticket Sales & Anchor Allocation Engine', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('allocates exact consecutive tickets starting from anchor ticket HOH021 for qty=4', async () => {
    const mockAnchor = {
      _id: new Types.ObjectId(),
      code: 'HOH021',
      serialNumber: 21,
      status: 'available',
      bookingId: null
    };

    const mockCandidates = [
      mockAnchor,
      { _id: new Types.ObjectId(), code: 'HOH022', serialNumber: 22, status: 'available', bookingId: null },
      { _id: new Types.ObjectId(), code: 'HOH023', serialNumber: 23, status: 'available', bookingId: null },
      { _id: new Types.ObjectId(), code: 'HOH024', serialNumber: 24, status: 'available', bookingId: null }
    ];

    vi.spyOn(Ticket, 'findOne').mockReturnValue({
      session: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue(mockAnchor)
    } as any);

    vi.spyOn(Ticket, 'find').mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      session: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue(mockCandidates)
    } as any);

    const result = await findConsecutiveFromAnchor('HOH021', 4);

    expect(result.success).toBe(true);
    expect(result.isConsecutive).toBe(true);
    expect(result.tickets.map(t => t.code)).toEqual(['HOH021', 'HOH022', 'HOH023', 'HOH024']);
  });

  it('rejects allocation when anchor ticket is already registered/sold', async () => {
    const mockAnchor = {
      _id: new Types.ObjectId(),
      code: 'HOH021',
      serialNumber: 21,
      status: 'registered',
      buyerName: 'Rahul Sharma',
      bookingId: new Types.ObjectId()
    };

    vi.spyOn(Ticket, 'findOne').mockReturnValue({
      session: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue(mockAnchor)
    } as any);

    const result = await findConsecutiveFromAnchor('HOH021', 4);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('ANCHOR_ALREADY_REGISTERED');
    expect(result.message).toContain('already registered');
    expect(result.message).toContain('Rahul Sharma');
  });

  it('halts allocation and reports blocked ticket when next consecutive ticket is registered', async () => {
    const mockAnchor = {
      _id: new Types.ObjectId(),
      code: 'HOH021',
      serialNumber: 21,
      status: 'available',
      bookingId: null
    };

    // HOH022 is registered
    const mockCandidates = [
      mockAnchor,
      { _id: new Types.ObjectId(), code: 'HOH022', serialNumber: 22, status: 'registered', bookingId: new Types.ObjectId() },
      { _id: new Types.ObjectId(), code: 'HOH023', serialNumber: 23, status: 'available', bookingId: null },
      { _id: new Types.ObjectId(), code: 'HOH024', serialNumber: 24, status: 'available', bookingId: null }
    ];

    vi.spyOn(Ticket, 'findOne').mockReturnValue({
      session: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue(mockAnchor)
    } as any);

    vi.spyOn(Ticket, 'find').mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      session: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue(mockCandidates)
    } as any);

    const result = await findConsecutiveFromAnchor('HOH021', 4, undefined, false);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('CONSECUTIVE_UNAVAILABLE');
    expect(result.blockedTicket).toBe('HOH022');
    expect(result.message).toContain('HOH022 is already registered');
  });

  it('allows explicit admin override for non-consecutive allocation when enabled', async () => {
    const mockAnchor = {
      _id: new Types.ObjectId(),
      code: 'HOH021',
      serialNumber: 21,
      status: 'available',
      bookingId: null
    };

    const mockCandidates = [
      mockAnchor,
      { _id: new Types.ObjectId(), code: 'HOH022', serialNumber: 22, status: 'registered', bookingId: new Types.ObjectId() },
      { _id: new Types.ObjectId(), code: 'HOH023', serialNumber: 23, status: 'available', bookingId: null },
      { _id: new Types.ObjectId(), code: 'HOH024', serialNumber: 24, status: 'available', bookingId: null }
    ];

    const mockNextAvailable = [
      { _id: new Types.ObjectId(), code: 'HOH023', serialNumber: 23, status: 'available', bookingId: null },
      { _id: new Types.ObjectId(), code: 'HOH024', serialNumber: 24, status: 'available', bookingId: null },
      { _id: new Types.ObjectId(), code: 'HOH025', serialNumber: 25, status: 'available', bookingId: null }
    ];

    vi.spyOn(Ticket, 'findOne').mockReturnValue({
      session: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue(mockAnchor)
    } as any);

    vi.spyOn(Ticket, 'find')
      .mockReturnValueOnce({
        sort: vi.fn().mockReturnThis(),
        session: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue(mockCandidates)
      } as any)
      .mockReturnValueOnce({
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        session: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue(mockNextAvailable)
      } as any);

    const result = await findConsecutiveFromAnchor('HOH021', 4, undefined, true);

    expect(result.success).toBe(true);
    expect(result.isConsecutive).toBe(false);
    expect(result.tickets.map(t => t.code)).toEqual(['HOH021', 'HOH023', 'HOH024', 'HOH025']);
    expect(result.skippedTickets).toEqual(['HOH022']);
  });

  it('prevents allocation beyond HOH050 (end-of-inventory rule)', async () => {
    const mockAnchor = {
      _id: new Types.ObjectId(),
      code: 'HOH049',
      serialNumber: 49,
      status: 'available',
      bookingId: null
    };

    vi.spyOn(Ticket, 'findOne').mockReturnValue({
      session: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue(mockAnchor)
    } as any);

    const result = await findConsecutiveFromAnchor('HOH049', 3, undefined, false);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('END_OF_INVENTORY');
    expect(result.message).toContain('Only 2 ticket numbers remain from HOH049');
  });

  it('rejects allocation when physical ticket is cancelled/void', async () => {
    const mockAnchor = {
      _id: new Types.ObjectId(),
      code: 'HOH015',
      serialNumber: 15,
      status: 'cancelled',
      cancellationReason: 'DAMAGED',
      bookingId: null
    };

    vi.spyOn(Ticket, 'findOne').mockReturnValue({
      session: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue(mockAnchor)
    } as any);

    const result = await findConsecutiveFromAnchor('HOH015', 2);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('ANCHOR_CANCELLED');
    expect(result.message).toContain('cancelled (DAMAGED)');
  });
});
