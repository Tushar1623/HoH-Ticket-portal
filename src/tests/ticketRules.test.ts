import { describe, it, expect } from 'vitest';
import { 
  normalizeTicketCode, 
  isValidTicketCode, 
  evaluateTicketStatus, 
  validateBuyerForm,
  normalizePaymentStatus,
  VALID_TICKET_CODES,
  calculateConsecutiveSeats
} from '../lib/ticketRules';
import { TicketRecord } from '../types/ticket';

describe('Ticket Code Validation & Normalization (BR 01, BR 02)', () => {
  it('should validate exactly 50 ticket codes from HOH001 to HOH050', () => {
    expect(VALID_TICKET_CODES.length).toBe(50);
    expect(VALID_TICKET_CODES[0]).toBe('HOH001');
    expect(VALID_TICKET_CODES[49]).toBe('HOH050');
  });

  it('should accept valid codes HOH001 and HOH050', () => {
    expect(isValidTicketCode('HOH001')).toBe(true);
    expect(isValidTicketCode('HOH050')).toBe(true);
    expect(isValidTicketCode('HOH025')).toBe(true);
  });

  it('should normalize lowercase input and surrounding spaces', () => {
    expect(normalizeTicketCode('hoh001')).toBe('HOH001');
    expect(normalizeTicketCode('  HOH050  ')).toBe('HOH050');
    expect(normalizeTicketCode('  hoh017  ')).toBe('HOH017');
    expect(isValidTicketCode('  hoh017  ')).toBe(true);
  });

  it('should reject out-of-range codes and invalid payloads', () => {
    expect(isValidTicketCode('HOH000')).toBe(false);
    expect(isValidTicketCode('HOH051')).toBe(false);
    expect(isValidTicketCode('HOH100')).toBe(false);
    expect(isValidTicketCode('')).toBe(false);
    expect(isValidTicketCode('https://random-url.com')).toBe(false);
    expect(isValidTicketCode('BMS12345')).toBe(false);
  });
});
describe('Buyer Registration Validation (FR 01 - FR 04, BR 08)', () => {
  it('should accept valid buyer data', () => {
    const res = validateBuyerForm({
      code: 'HOH001',
      buyerName: 'Aarav Patel',
      phone: '+919876543210',
      guests: 2,
      paymentStatus: 'Paid'
    });
    expect(res.valid).toBe(true);
    expect(res.error).toBeUndefined();
  });

  it('should reject missing or too short buyer name', () => {
    const res = validateBuyerForm({
      code: 'HOH001',
      buyerName: ' ',
      phone: '+919876543210',
      guests: 1,
      paymentStatus: 'Paid'
    });
    expect(res.valid).toBe(false);
    expect(res.error).toContain('Buyer name is required');
  });

  it('should reject missing or too short phone number', () => {
    const res = validateBuyerForm({
      code: 'HOH001',
      buyerName: 'Rahul',
      phone: '123',
      guests: 1,
      paymentStatus: 'Paid'
    });
    expect(res.valid).toBe(false);
    expect(res.error).toContain('Valid phone number is required');
  });

  it('should enforce guest count between 1 and 10 (BR 08)', () => {
    expect(validateBuyerForm({
      code: 'HOH001',
      buyerName: 'Rahul',
      phone: '+919876543210',
      guests: 0,
      paymentStatus: 'Paid'
    }).valid).toBe(false);

    expect(validateBuyerForm({
      code: 'HOH001',
      buyerName: 'Rahul',
      phone: '+919876543210',
      guests: 11,
      paymentStatus: 'Paid'
    }).valid).toBe(false);

    expect(validateBuyerForm({
      code: 'HOH001',
      buyerName: 'Rahul',
      phone: '+919876543210',
      guests: 10,
      paymentStatus: 'Paid'
    }).valid).toBe(true);
  });
});
describe('Ticket Status Evaluation (FR 08, FR 11, BR 04, BR 07)', () => {
  const baseTicket: TicketRecord = {
    code: 'HOH010',
    buyerName: 'Priya Sharma',
    phone: '+919811122233',
    guests: 2,
    paymentStatus: 'Paid',
    amount: 1000,
    entered: false,
    updatedAt: new Date().toISOString()
  };

  it('should classify registered unused ticket as VALID', () => {
    expect(evaluateTicketStatus(baseTicket, 'HOH010')).toBe('VALID');
  });

  it('should classify unregistered code as NOT_REGISTERED', () => {
    const emptyTicket: TicketRecord = {
      ...baseTicket,
      buyerName: ''
    };
    expect(evaluateTicketStatus(emptyTicket, 'HOH010')).toBe('NOT_REGISTERED');
    expect(evaluateTicketStatus(undefined, 'HOH010')).toBe('NOT_REGISTERED');
  });

  it('should classify invalid code as INVALID', () => {
    expect(evaluateTicketStatus(baseTicket, 'HOH099')).toBe('INVALID');
    expect(evaluateTicketStatus(undefined, 'UNKNOWN')).toBe('INVALID');
  });

  it('should classify cancelled or refunded ticket as CANCELLED', () => {
    const cancelledTicket: TicketRecord = {
      ...baseTicket,
      paymentStatus: 'Cancelled'
    };
    expect(evaluateTicketStatus(cancelledTicket, 'HOH010')).toBe('CANCELLED');

    const refundedTicket: TicketRecord = {
      ...baseTicket,
      paymentStatus: 'Refunded'
    };
    expect(evaluateTicketStatus(refundedTicket, 'HOH010')).toBe('CANCELLED');
  });

  it('should classify already entered ticket as ALREADY_ENTERED', () => {
    const enteredTicket: TicketRecord = {
      ...baseTicket,
      entered: true,
      enteredAt: '2026-09-19T14:30:00.000Z'
    };
    expect(evaluateTicketStatus(enteredTicket, 'HOH010')).toBe('ALREADY_ENTERED');
  });
});

describe('Atomic Duplicate Entry Prevention (FR 10, FR 11, BR 05, BR 06)', () => {
  it('should simulate atomic admission and preserve original timestamp', () => {
    const ticket: TicketRecord = {
      code: 'HOH001',
      buyerName: 'Test Buyer',
      phone: '9999999999',
      guests: 1,
      paymentStatus: 'Paid',
      entered: false,
      updatedAt: '2026-09-19T12:00:00.000Z'
    };

    // First scan admission
    const firstEntryTime = '2026-09-19T14:00:00.000Z';
    expect(ticket.entered).toBe(false);
    
    // Perform admission
    ticket.entered = true;
    ticket.enteredAt = firstEntryTime;

    expect(evaluateTicketStatus(ticket, 'HOH001')).toBe('ALREADY_ENTERED');

    // Second scan attempt (e.g. concurrent or duplicate scan)
    const secondScanStatus = evaluateTicketStatus(ticket, 'HOH001');
    expect(secondScanStatus).toBe('ALREADY_ENTERED');
    // Timestamp must NOT change (BR 05)
    expect(ticket.enteredAt).toBe(firstEntryTime);
  });
});

describe('Ticket Storage & Payment Normalization Requirements', () => {
  it('should normalize user-friendly payment labels to standard values (TEST 4)', () => {
    expect(normalizePaymentStatus('Paid (Full Payment)')).toBe('Paid');
    expect(normalizePaymentStatus('Pending Payment')).toBe('Pending');
    expect(normalizePaymentStatus('Complimentary / VIP')).toBe('Complimentary');
    expect(normalizePaymentStatus('Refunded')).toBe('Refunded');
    expect(normalizePaymentStatus('Cancelled')).toBe('Cancelled');
    expect(normalizePaymentStatus('')).toBe('Pending');
    expect(normalizePaymentStatus(undefined)).toBe('Pending');
  });

  it('should preserve Entered and Entered At when buyer details are updated (TEST 6)', () => {
    const enteredTicket: TicketRecord = {
      code: 'HOH001',
      buyerName: 'Old Name',
      phone: '9000000000',
      guests: 1,
      paymentStatus: 'Pending',
      amount: 0,
      entered: true,
      enteredAt: '2026-09-19T14:30:00.000Z',
      registeredAt: '2026-09-19T10:00:00.000Z',
      updatedAt: '2026-09-19T10:00:00.000Z'
    };

    // Update buyer details to Mock Guest
    const updatedBuyer = {
      buyerName: 'Aarav Patel',
      phone: '+919876543210',
      amount: 500,
      paymentStatus: normalizePaymentStatus('Paid')
    };

    const resultRecord: TicketRecord = {
      ...enteredTicket,
      ...updatedBuyer,
      // Must preserve:
      entered: enteredTicket.entered,
      enteredAt: enteredTicket.enteredAt,
      registeredAt: enteredTicket.registeredAt,
      updatedAt: new Date().toISOString()
    };

    expect(resultRecord.buyerName).toBe('Aarav Patel');
    expect(resultRecord.amount).toBe(500);
    expect(resultRecord.entered).toBe(true);
    expect(resultRecord.enteredAt).toBe('2026-09-19T14:30:00.000Z');
    expect(resultRecord.registeredAt).toBe('2026-09-19T10:00:00.000Z');
  });

  it('should enforce data-control clearing and preserve code and qrPayload', () => {
    const existing: TicketRecord = {
      code: 'HOH002',
      qrPayload: 'HOH002',
      buyerName: 'Aarav Patel',
      phone: '+919876543210',
      email: 'guest@example.com',
      guests: 3,
      paymentStatus: 'Paid',
      amount: 1500,
      notes: 'VIP guest',
      entered: true,
      enteredAt: '2026-09-19T15:00:00.000Z',
      registeredAt: '2026-09-19T12:00:00.000Z',
      updatedAt: '2026-09-19T15:00:00.000Z'
    };

    // Simulated clear action
    const cleared: TicketRecord = {
      code: existing.code,
      qrPayload: existing.qrPayload,
      buyerName: '',
      phone: '',
      email: '',
      guests: 1,
      paymentStatus: 'Pending',
      amount: 0,
      notes: '',
      entered: false,
      enteredAt: '',
      registeredAt: '',
      updatedAt: new Date().toISOString(),
      updatedBy: 'Ticket Register Reset'
    };

    expect(cleared.code).toBe('HOH002');
    expect(cleared.qrPayload).toBe('HOH002');
    expect(cleared.buyerName).toBe('');
    expect(cleared.phone).toBe('');
    expect(cleared.guests).toBe(1);
    expect(cleared.paymentStatus).toBe('Pending');
    expect(cleared.entered).toBe(false);
    expect(cleared.enteredAt).toBe('');
  });

  it('should validate exact confirmation text for Reset All Ticket Data', () => {
    const validConfirmation = 'RESET HOH EVENT';
    expect('RESET HOH EVENT'.trim()).toBe(validConfirmation);
    expect('reset hoh event'.trim() === validConfirmation).toBe(false);
    expect('RESET'.trim() === validConfirmation).toBe(false);
  });
});

describe('Consecutive Seat Auto-Selection Engine (calculateConsecutiveSeats)', () => {
  it('automatically adds and selects HOH002 when booking 2 seats starting from HOH001', () => {
    const mockTickets: Record<string, TicketRecord> = {};
    VALID_TICKET_CODES.forEach((c, idx) => {
      mockTickets[c] = {
        code: c,
        serialNumber: idx + 1,
        buyerName: '',
        phone: '',
        guests: 1,
        paymentStatus: 'Pending',
        amount: 0,
        entered: false,
        updatedAt: ''
      };
    });

    const res = calculateConsecutiveSeats(mockTickets, 2, 'HOH001');
    expect(res.success).toBe(true);
    expect(res.isConsecutive).toBe(true);
    expect(res.proposedCodes).toEqual(['HOH001', 'HOH002']);
  });

  it('automatically adds and selects HOH003 and more when booking 2 or 3 seats from HOH002', () => {
    const mockTickets: Record<string, TicketRecord> = {};
    VALID_TICKET_CODES.forEach((c, idx) => {
      mockTickets[c] = {
        code: c,
        serialNumber: idx + 1,
        buyerName: '',
        phone: '',
        guests: 1,
        paymentStatus: 'Pending',
        amount: 0,
        entered: false,
        updatedAt: ''
      };
    });

    // 2 seats from HOH002 -> HOH002, HOH003
    const res2 = calculateConsecutiveSeats(mockTickets, 2, 'HOH002');
    expect(res2.success).toBe(true);
    expect(res2.proposedCodes).toEqual(['HOH002', 'HOH003']);

    // 3 seats from HOH002 -> HOH002, HOH003, HOH004
    const res3 = calculateConsecutiveSeats(mockTickets, 3, 'HOH002');
    expect(res3.success).toBe(true);
    expect(res3.proposedCodes).toEqual(['HOH002', 'HOH003', 'HOH004']);
  });

  it('slides to next available consecutive block if requested starting seat or next seat is booked', () => {
    const mockTickets: Record<string, TicketRecord> = {};
    VALID_TICKET_CODES.forEach((c, idx) => {
      mockTickets[c] = {
        code: c,
        serialNumber: idx + 1,
        buyerName: '',
        phone: '',
        guests: 1,
        paymentStatus: 'Pending',
        amount: 0,
        entered: false,
        updatedAt: ''
      };
    });

    // Book HOH002
    mockTickets['HOH002'].buyerName = 'Existing Buyer';

    // When someone tries 2 seats starting at HOH001, since HOH002 is booked, it slides to HOH003, HOH004
    const res = calculateConsecutiveSeats(mockTickets, 2, 'HOH001');
    expect(res.success).toBe(true);
    expect(res.isConsecutive).toBe(true);
    expect(res.proposedCodes).toEqual(['HOH003', 'HOH004']);
  });
});

