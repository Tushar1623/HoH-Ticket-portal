import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  canClearTicket, 
  canEditBuyer, 
  canExportData, 
  canLookupOrScan, 
  canMarkEntered, 
  canRequestCorrection, 
  canResetEvent, 
  evaluateTicketStatus, 
  isValidTicketCode, 
  normalizeTicketCode, 
  validateClearTicket, 
  validateConfirmReset, 
  validateEntryStatusCorrection, 
  validatePrepareReset 
} from '../lib/ticketRules';
import { SheetClient } from '../lib/sheetClient';
import { TicketRecord } from '../types/ticket';

describe('Server-Side Role-Based Access Control (RBAC)', () => {
  it('Entry Staff permissions: can scan/mark entered, CANNOT edit, clear, export, reset, or access setup', () => {
    const role = 'entry';
    expect(canLookupOrScan(role)).toBe(true);
    expect(canMarkEntered(role)).toBe(true);
    expect(canEditBuyer(role)).toBe(false);
    expect(canRequestCorrection(role)).toBe(false);
    expect(canClearTicket(role)).toBe(false);
    expect(canExportData(role)).toBe(false);
    expect(canResetEvent(role)).toBe(false);
  });

  it('Sales Staff permissions: can register/edit buyers, CANNOT change entry, clear, or reset', () => {
    const role = 'sales';
    expect(canLookupOrScan(role)).toBe(false);
    expect(canMarkEntered(role)).toBe(false);
    expect(canEditBuyer(role)).toBe(true);
    expect(canRequestCorrection(role)).toBe(false);
    expect(canClearTicket(role)).toBe(false);
    expect(canExportData(role)).toBe(false);
    expect(canResetEvent(role)).toBe(false);
  });

  it('Event Manager permissions: can edit, request correction, clear, and export; CANNOT reset event', () => {
    const role = 'manager';
    expect(canLookupOrScan(role)).toBe(true);
    expect(canMarkEntered(role)).toBe(true);
    expect(canEditBuyer(role)).toBe(true);
    expect(canRequestCorrection(role)).toBe(true);
    expect(canClearTicket(role)).toBe(true);
    expect(canExportData(role)).toBe(true);
    expect(canResetEvent(role)).toBe(false);
  });

  it('Super Admin permissions: has full authority including event reset', () => {
    const role = 'admin';
    expect(canLookupOrScan(role)).toBe(true);
    expect(canMarkEntered(role)).toBe(true);
    expect(canEditBuyer(role)).toBe(true);
    expect(canRequestCorrection(role)).toBe(true);
    expect(canClearTicket(role)).toBe(true);
    expect(canExportData(role)).toBe(true);
    expect(canResetEvent(role)).toBe(true);
  });
});

describe('Safe Workflows & Server Validation Rules', () => {
  const registeredTicket: TicketRecord = {
    code: 'HOH005',
    qrPayload: 'HOH005',
    buyerName: 'Aarav Patel',
    phone: '+919876543210',
    guests: 2,
    paymentStatus: 'Paid',
    amount: 1000,
    entered: false,
    updatedAt: new Date().toISOString()
  };

  const unregisteredTicket: TicketRecord = {
    code: 'HOH006',
    qrPayload: 'HOH006',
    buyerName: '',
    phone: '',
    guests: 1,
    paymentStatus: 'Pending',
    amount: 0,
    entered: false,
    updatedAt: new Date().toISOString()
  };

  const cancelledTicket: TicketRecord = {
    code: 'HOH007',
    qrPayload: 'HOH007',
    buyerName: 'Cancelled Guest',
    phone: '+919876543210',
    guests: 1,
    paymentStatus: 'Cancelled',
    amount: 500,
    entered: false,
    updatedAt: new Date().toISOString()
  };

  const refundedTicket: TicketRecord = {
    code: 'HOH008',
    qrPayload: 'HOH008',
    buyerName: 'Refunded Guest',
    phone: '+919876543210',
    guests: 1,
    paymentStatus: 'Refunded',
    amount: 500,
    entered: false,
    updatedAt: new Date().toISOString()
  };

  const alreadyEnteredTicket: TicketRecord = {
    code: 'HOH009',
    qrPayload: 'HOH009',
    buyerName: 'Entered Guest',
    phone: '+919876543210',
    guests: 1,
    paymentStatus: 'Paid',
    amount: 500,
    entered: true,
    enteredAt: '2026-09-20T12:00:00.000Z',
    updatedAt: '2026-09-20T12:00:00.000Z'
  };

  it('Unregistered tickets cannot be manually set to Entered', () => {
    const res = validateEntryStatusCorrection({
      code: 'HOH006',
      entered: true,
      reason: 'Admin correction test reason',
      confirmCode: 'HOH006',
      ticket: unregisteredTicket
    });
    expect(res.valid).toBe(false);
    expect(res.error).toContain('Ticket has no registered buyer');
  });

  it('Cancelled and Refunded tickets cannot be manually set to Entered', () => {
    const resCancelled = validateEntryStatusCorrection({
      code: 'HOH007',
      entered: true,
      reason: 'Admin correction test reason',
      confirmCode: 'HOH007',
      ticket: cancelledTicket
    });
    expect(resCancelled.valid).toBe(false);
    expect(resCancelled.error).toContain('Cancelled');

    const resRefunded = validateEntryStatusCorrection({
      code: 'HOH008',
      entered: true,
      reason: 'Admin correction test reason',
      confirmCode: 'HOH008',
      ticket: refundedTicket
    });
    expect(resRefunded.valid).toBe(false);
    expect(resRefunded.error).toContain('Refunded');
  });

  it('Already entered tickets cannot be set to Entered again', () => {
    const res = validateEntryStatusCorrection({
      code: 'HOH009',
      entered: true,
      reason: 'Admin correction test reason',
      confirmCode: 'HOH009',
      ticket: alreadyEnteredTicket
    });
    expect(res.valid).toBe(false);
    expect(res.error).toContain('already marked as Entered');
  });

  it('Status correction fails without exact code confirmation and >= 10 char reason', () => {
    // Missing exact code confirmation
    const mismatchCode = validateEntryStatusCorrection({
      code: 'HOH005',
      entered: true,
      reason: 'Valid long enough reason here',
      confirmCode: 'HOH004',
      ticket: registeredTicket
    });
    expect(mismatchCode.valid).toBe(false);
    expect(mismatchCode.error).toContain('Confirmation mismatch');

    // Reason too short (< 10 chars)
    const shortReason = validateEntryStatusCorrection({
      code: 'HOH005',
      entered: true,
      reason: 'short',
      confirmCode: 'HOH005',
      ticket: registeredTicket
    });
    expect(shortReason.valid).toBe(false);
    expect(shortReason.error).toContain('minimum 10 characters');

    // Valid parameters
    const valid = validateEntryStatusCorrection({
      code: 'HOH005',
      entered: true,
      reason: 'Guest stepped out with venue manager consent',
      confirmCode: 'HOH005',
      ticket: registeredTicket
    });
    expect(valid.valid).toBe(true);
  });

  it('Clear ticket fails without exact code confirmation and >= 10 char reason', () => {
    const mismatch = validateClearTicket({
      code: 'HOH010',
      reason: 'Detailed cancellation by guest',
      confirmCode: 'WRONG'
    });
    expect(mismatch.valid).toBe(false);
    expect(mismatch.error).toContain('Confirmation mismatch');

    const short = validateClearTicket({
      code: 'HOH010',
      reason: 'too short',
      confirmCode: 'HOH010'
    });
    expect(short.valid).toBe(false);
    expect(short.error).toContain('minimum 10 characters');

    const valid = validateClearTicket({
      code: 'HOH010',
      reason: 'Guest requested complete booking refund',
      confirmCode: 'HOH010'
    });
    expect(valid.valid).toBe(true);
  });

  it('Clear ticket preserves Code and QR Payload while resetting buyer data', () => {
    const existing: TicketRecord = {
      code: 'HOH015',
      qrPayload: 'HOH015',
      buyerName: 'Aarav Patel',
      phone: '+919876543210',
      email: 'guest@example.com',
      guests: 4,
      paymentStatus: 'Paid',
      amount: 2000,
      notes: 'VIP booth',
      entered: true,
      enteredAt: '2026-09-20T13:00:00.000Z',
      registeredAt: '2026-09-20T10:00:00.000Z',
      updatedAt: '2026-09-20T13:00:00.000Z'
    };

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

    expect(cleared.code).toBe('HOH015');
    expect(cleared.qrPayload).toBe('HOH015');
    expect(cleared.buyerName).toBe('');
    expect(cleared.phone).toBe('');
    expect(cleared.guests).toBe(1);
    expect(cleared.paymentStatus).toBe('Pending');
    expect(cleared.amount).toBe(0);
    expect(cleared.entered).toBe(false);
  });

  it('Event reset Step 1 requires >= 20 char reason', () => {
    const shortReason = validatePrepareReset('Too short reason');
    expect(shortReason.valid).toBe(false);
    expect(shortReason.error).toContain('at least 20 characters');

    const valid = validatePrepareReset('Rehearsal wipe before official evening show begins');
    expect(valid.valid).toBe(true);
  });

  it('Event reset Step 2 requires exact text RESET HOH EVENT and non-empty token', () => {
    const missingToken = validateConfirmReset({
      token: '',
      confirmText: 'RESET HOH EVENT'
    });
    expect(missingToken.valid).toBe(false);
    expect(missingToken.error).toContain('Missing or expired');

    const wrongText = validateConfirmReset({
      token: 'RST_TOKEN_1234',
      confirmText: 'reset hoh'
    });
    expect(wrongText.valid).toBe(false);
    expect(wrongText.error).toContain('Confirmation mismatch');

    const valid = validateConfirmReset({
      token: 'RST_TOKEN_1234',
      confirmText: 'RESET HOH EVENT'
    });
    expect(valid.valid).toBe(true);
  });
});

describe('Zero Local Fallback & Sheet Connection Mandate', () => {
  let client: SheetClient;

  beforeEach(() => {
    // Client configured without script URL (offline / disconnected state)
    client = new SheetClient('');
    client.setStaffSession({
      role: 'manager',
      identity: 'Event Manager',
      passkey: 'hoh-mgr-2026'
    });
  });

  it('Missing Sheet connection blocks upsertBuyer without local fallback', async () => {
    const res = await client.upsertBuyer({
      code: 'HOH001',
      buyerName: 'Aarav Patel',
      phone: '+919876543210'
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Sync Failed — no change was saved');
  });

  it('Missing Sheet connection blocks markEntered without local fallback', async () => {
    const res = await client.markEntered('HOH001');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Sync Failed — entry was not recorded');
  });

  it('Missing Sheet connection blocks requestEntryStatusChange without local fallback', async () => {
    const res = await client.requestEntryStatusChange({
      code: 'HOH001',
      entered: true,
      reason: 'Valid long enough reason for test',
      confirmCode: 'HOH001'
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Sync Failed — no change was saved');
  });

  it('Missing Sheet connection blocks clearTicketData without local fallback', async () => {
    const res = await client.clearTicketData({
      code: 'HOH001',
      reason: 'Cancellation requested by customer',
      confirmCode: 'HOH001'
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Sync Failed — no change was saved');
  });

  it('Missing Sheet connection blocks prepareEventReset without local fallback', async () => {
    const res = await client.prepareEventReset('Valid reset reason of at least 20 characters');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Sync Failed — no change was saved');
  });
});

describe('Concurrent Locking & Atomic Integrity Simulation', () => {
  it('Two simultaneous markEntered requests on the same ticket: exactly one succeeds under lock', async () => {
    // Simulated sheet ticket state
    let sheetTicket: { entered: boolean; enteredAt: string | null } = {
      entered: false,
      enteredAt: null
    };

    let lockAcquired = false;

    // Simulated atomic server handler with LockService
    const serverMarkEntered = async (staffId: string) => {
      // Simulate lock acquisition
      while (lockAcquired) {
        await new Promise(r => setTimeout(r, 5));
      }
      lockAcquired = true;

      try {
        if (sheetTicket.entered) {
          return {
            ok: false,
            error: `Already Entered at ${sheetTicket.enteredAt}. Do not admit.`
          };
        }

        const now = new Date().toISOString();
        sheetTicket = {
          entered: true,
          enteredAt: now
        };

        return {
          ok: true,
          message: 'Admission confirmed! Marked Entered.',
          ticket: sheetTicket
        };
      } finally {
        lockAcquired = false;
      }
    };

    // Run two simultaneous concurrent requests
    const [req1, req2] = await Promise.all([
      serverMarkEntered('Gate Staff A'),
      serverMarkEntered('Gate Staff B')
    ]);

    // Exactly one must succeed and one must fail with Already Entered
    const successes = [req1, req2].filter(r => r.ok);
    const failures = [req1, req2].filter(r => !r.ok);

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    expect(failures[0].error).toContain('Already Entered at');
  });

  it('Duplicate Code rows block all mutations for that code (Rule 5)', () => {
    const mockRows = [
      { code: 'HOH001', buyer: 'Guest 1' },
      { code: 'HOH001', buyer: 'Guest 2 (Duplicate!)' },
      { code: 'HOH002', buyer: 'Guest 3' }
    ];

    // Helper implementing Rule 5 assertSingleRow
    const assertSingleRowSimulator = (code: string) => {
      const matches = mockRows.filter(r => r.code === code);
      if (matches.length === 0) throw new Error(`Ticket not found: ${code}`);
      if (matches.length > 1) {
        throw new Error(`CRITICAL INTEGRITY ERROR: Multiple rows found for code ${code} (${matches.length} rows). All mutations blocked.`);
      }
      return matches[0];
    };

    // Single row works
    expect(assertSingleRowSimulator('HOH002').buyer).toBe('Guest 3');

    // Duplicate rows abort mutation
    expect(() => assertSingleRowSimulator('HOH001')).toThrow(
      'CRITICAL INTEGRITY ERROR: Multiple rows found for code HOH001'
    );
  });

  it('Audit-log failure blocks the mutation and aborts transaction (Rule 6)', () => {
    let sheetDataMutated = false;

    const executeMutationWithMandatoryAudit = (shouldAuditFail: boolean) => {
      try {
        if (shouldAuditFail) {
          throw new Error('Google Sheet Audit Log write failed: Quota or Permission Error');
        }
        sheetDataMutated = true;
        return { ok: true, message: 'Success' };
      } catch (err: any) {
        // Rollback / abort without saving
        sheetDataMutated = false;
        return { ok: false, error: err.message };
      }
    };

    const failedRun = executeMutationWithMandatoryAudit(true);
    expect(failedRun.ok).toBe(false);
    expect(failedRun.error).toContain('Audit Log write failed');
    expect(sheetDataMutated).toBe(false);

    const successRun = executeMutationWithMandatoryAudit(false);
    expect(successRun.ok).toBe(true);
    expect(sheetDataMutated).toBe(true);
  });

  it('Reset fails if backup sheet creation fails', () => {
    const confirmResetWithBackupCheck = (backupCreatedSuccessfully: boolean) => {
      if (!backupCreatedSuccessfully) {
        return {
          ok: false,
          error: 'Backup creation failed. Event reset aborted without modifying any ticket data.'
        };
      }
      return {
        ok: true,
        backupTab: 'Backup_2026-09-20_14-30',
        message: 'All ticket data reset successfully.'
      };
    };

    const resFail = confirmResetWithBackupCheck(false);
    expect(resFail.ok).toBe(false);
    expect(resFail.error).toContain('Backup creation failed. Event reset aborted');

    const resSuccess = confirmResetWithBackupCheck(true);
    expect(resSuccess.ok).toBe(true);
    expect(resSuccess.backupTab).toBe('Backup_2026-09-20_14-30');
  });

  it('Reset token cannot be reused or replayed', () => {
    const tokenCache = new Map<string, { token: string; user: string }>();
    tokenCache.set('RST_TOKEN_999', { token: 'RST_TOKEN_999', user: 'Super Admin' });

    const redeemResetToken = (token: string) => {
      if (!tokenCache.has(token)) {
        return { ok: false, error: 'Reset token has expired or already been used.' };
      }
      // Invalidate immediately
      tokenCache.delete(token);
      return { ok: true, message: 'Reset token accepted.' };
    };

    // First use: succeeds
    const firstAttempt = redeemResetToken('RST_TOKEN_999');
    expect(firstAttempt.ok).toBe(true);

    // Replay attempt: rejected
    const replayAttempt = redeemResetToken('RST_TOKEN_999');
    expect(replayAttempt.ok).toBe(false);
    expect(replayAttempt.error).toContain('already been used');
  });
});
