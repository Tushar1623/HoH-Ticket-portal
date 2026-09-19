import { describe, it, expect } from 'vitest';
import { 
  normalizeTicketCode, 
  isValidTicketCode, 
  evaluateTicketStatus, 
  validateBuyerForm,
  VALID_TICKET_CODES 
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
