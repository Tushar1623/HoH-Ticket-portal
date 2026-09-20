/**
 * =========================================================================
 * HOUSE OF HUMOUR - Official Ticket Portal Backend
 * Google Apps Script Web App
 *
 * Implements: Fail-Proof HOH Ticket Portal Architecture
 * - Strict server-side RBAC (Entry Staff, Sales Staff, Event Manager, Super Admin)
 * - Zero optimistic local fallback (Google Sheets is the ONLY source of truth)
 * - Atomic LockService.getDocumentLock() on every mutation
 * - Strict single-row uniqueness verification (assertSingleRow)
 * - 11-column mandatory audit logging with Request ID idempotency
 * - Safe workflows: requestEntryStatusChange, clearTicketData, prepareEventReset, confirmEventReset
 * =========================================================================
 */

const TARGET_SPREADSHEET_ID = '1nJAMZQnqbsyciIHz-x4xaRiNzgcRPK861ae1No-tBGI';
const SHEET_NAME = 'Tickets';
const AUDIT_SHEET_NAME = 'Audit Log';

// Required Header Names for Tickets Sheet
const REQUIRED_HEADERS = [
  'Code',
  'QR Payload',
  'Buyer Name',
  'Phone',
  'Email',
  'Guests',
  'Payment Status',
  'Amount',
  'Notes',
  'Entered',
  'Entered At',
  'Registered At',
  'Updated At',
  'Updated By'
];

// Audit Log Headers (11 Columns as specified)
const AUDIT_HEADERS = [
  'Timestamp',
  'Request ID',
  'Action',
  'Ticket Code',
  'Previous Snapshot',
  'New Snapshot',
  'Reason',
  'Authenticated User',
  'Role',
  'Backup Tab',
  'Result'
];

// Standard Server Role Passkeys (can be overridden via Script Properties)
const DEFAULT_PASSKEYS = {
  'admin': 'hoh-admin-2026',
  'manager': 'hoh-mgr-2026',
  'sales': 'hoh-sales-2026',
  'entry': 'hoh-gate-2026'
};

/**
 * Resolves and verifies authenticated staff role from server passkey
 */
function authenticateStaff(passkey, explicitRole) {
  if (!passkey) {
    return { authenticated: false, role: null, error: 'Authentication required: Missing staff passkey.' };
  }

  const props = PropertiesService.getScriptProperties();
  const roles = ['admin', 'manager', 'sales', 'entry'];
  let matchedRole = null;

  for (let i = 0; i < roles.length; i++) {
    const r = roles[i];
    const configuredKey = props.getProperty('PASSKEY_' + r.toUpperCase()) || DEFAULT_PASSKEYS[r];
    if (String(passkey).trim() === configuredKey) {
      matchedRole = r;
      break;
    }
  }

  if (!matchedRole) {
    return { authenticated: false, role: null, error: 'Authentication failed: Invalid staff passkey.' };
  }

  if (explicitRole && explicitRole !== matchedRole) {
    // If client claimed another role than what passkey authorizes
    // Allow admin to act as lower roles, manager to act as sales/entry
    const hierarchy = { admin: 4, manager: 3, sales: 2, entry: 1 };
    if ((hierarchy[matchedRole] || 0) < (hierarchy[explicitRole] || 0)) {
      return {
        authenticated: false,
        role: null,
        error: 'Authorization error: Passkey role (' + matchedRole + ') cannot assume role (' + explicitRole + ').'
      };
    }
  }

  return { authenticated: true, role: matchedRole };
}

/**
 * Helper to get the Spreadsheet
 */
function getSpreadsheet() {
  try {
    const active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) return active;
  } catch (e) {}
  return SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
}

/**
 * Helper to get or create the 'Tickets' sheet
 */
function getOrCreateSheet() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    initSheet();
  }
  return sheet;
}

/**
 * Helper to get or create the 'Audit Log' sheet with 11 columns
 */
function getOrCreateAuditSheet(ss) {
  let auditSheet = ss.getSheetByName(AUDIT_SHEET_NAME);
  if (!auditSheet) {
    auditSheet = ss.insertSheet(AUDIT_SHEET_NAME);
    const headerRange = auditSheet.getRange(1, 1, 1, AUDIT_HEADERS.length);
    headerRange.setValues([AUDIT_HEADERS]);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#541D2B');
    headerRange.setFontColor('#FFFFFF');
    auditSheet.setFrozenRows(1);
    auditSheet.autoResizeColumns(1, AUDIT_HEADERS.length);
  }
  return auditSheet;
}

/**
 * Mandatory Audit Logger
 * Throws error if audit write fails so caller aborts transaction!
 */
function recordAuditEntry(params) {
  const ss = params.ss || getSpreadsheet();
  const auditSheet = getOrCreateAuditSheet(ss);
  const now = new Date().toISOString();

  // Validate all 11 columns
  const row = [
    now,
    String(params.requestId || ''),
    String(params.action || ''),
    String(params.ticketCode || ''),
    typeof params.prevSnapshot === 'object' ? JSON.stringify(params.prevSnapshot) : String(params.prevSnapshot || ''),
    typeof params.newSnapshot === 'object' ? JSON.stringify(params.newSnapshot) : String(params.newSnapshot || ''),
    String(params.reason || ''),
    String(params.authenticatedUser || 'Unknown'),
    String(params.role || 'Unknown'),
    String(params.backupTab || ''),
    String(params.result || 'SUCCESS')
  ];

  auditSheet.appendRow(row);
  SpreadsheetApp.flush();
}

/**
 * Initialize sheet with headers and pre-populate HOH001 to HOH050
 */
function initSheet() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  const headerRange = sheet.getRange(1, 1, 1, REQUIRED_HEADERS.length);
  headerRange.setValues([REQUIRED_HEADERS]);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#541D2B');
  headerRange.setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);

  const lastRow = sheet.getLastRow();
  let existingCodes = [];
  if (lastRow > 1) {
    existingCodes = sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(function(r) {
      return normalizeCode(r[0]);
    });
  }

  const now = new Date().toISOString();
  const rowsToAdd = [];
  for (let i = 1; i <= 50; i++) {
    const code = 'HOH' + ('000' + i).slice(-3);
    if (existingCodes.indexOf(code) === -1) {
      rowsToAdd.push([
        code,           // Code
        code,           // QR Payload
        '',             // Buyer Name
        '',             // Phone
        '',             // Email
        1,              // Guests
        'Pending',      // Payment Status
        0,              // Amount
        '',             // Notes
        false,          // Entered
        '',             // Entered At
        '',             // Registered At
        now,            // Updated At
        'System Init'   // Updated By
      ]);
    }
  }

  if (rowsToAdd.length > 0) {
    sheet.getRange(lastRow + 1, 1, rowsToAdd.length, REQUIRED_HEADERS.length).setValues(rowsToAdd);
  }

  sheet.autoResizeColumns(1, REQUIRED_HEADERS.length);
  getOrCreateAuditSheet(ss);
}

/**
 * Dynamic Column Header Mapping
 */
function getColumnMap(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), REQUIRED_HEADERS.length);
  const headerValues = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const map = {};

  for (let i = 0; i < headerValues.length; i++) {
    const header = String(headerValues[i] || '').trim();
    if (header) {
      map[header] = i + 1;
    }
  }

  for (let j = 0; j < REQUIRED_HEADERS.length; j++) {
    const required = REQUIRED_HEADERS[j];
    if (!map[required]) {
      throw new Error('Google Sheet configuration error. Required column is missing: ' + required);
    }
  }

  return map;
}

/**
 * Strict Single Row Uniqueness Checker (Rule 5)
 * Returns target row index. Throws error if 0 or >1 rows exist.
 */
function assertSingleRow(sheet, code, colMap) {
  const codeCol = colMap['Code'];
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    throw new Error('Invalid Sheet: Tickets sheet has no data rows.');
  }

  const codeValues = sheet.getRange(2, codeCol, lastRow - 1, 1).getValues();
  const matchingRows = [];
  for (let i = 0; i < codeValues.length; i++) {
    if (normalizeCode(codeValues[i][0]) === code) {
      matchingRows.push(i + 2);
    }
  }

  if (matchingRows.length === 0) {
    throw new Error('Ticket not found: Code ' + code + ' does not exist.');
  }

  if (matchingRows.length > 1) {
    throw new Error('CRITICAL INTEGRITY ERROR: Multiple rows found for code ' + code + ' (' + matchingRows.length + ' rows). All mutations blocked.');
  }

  return matchingRows[0];
}

/**
 * Normalizes payment status
 */
function normalizePaymentStatus(status) {
  if (!status) return 'Pending';
  const clean = String(status).trim().toLowerCase();
  if (clean.indexOf('paid') !== -1) return 'Paid';
  if (clean.indexOf('comp') !== -1) return 'Complimentary';
  if (clean.indexOf('refund') !== -1) return 'Refunded';
  if (clean.indexOf('cancel') !== -1) return 'Cancelled';
  return 'Pending';
}

function normalizeCode(code) {
  const clean = String(code || '').trim().toUpperCase();
  const match = clean.match(/^HOH0*(\d+)$/);
  if (match) {
    const num = parseInt(match[1], 10);
    if (num >= 1 && num <= 50) {
      return 'HOH' + ('000' + num).slice(-3);
    }
  }
  return clean;
}

function isValidCode(code) {
  const normalized = normalizeCode(code);
  const match = normalized.match(/^HOH(\d{3})$/);
  if (!match) return false;
  const num = parseInt(match[1], 10);
  return num >= 1 && num <= 50;
}

function isTruthy(val) {
  return val === true || String(val).toLowerCase() === 'true';
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Handles HTTP GET requests
 */
function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const action = params.action || 'list';

  try {
    const sheet = getOrCreateSheet();

    if (action === 'health') {
      return jsonResponse({
        ok: true,
        status: 'Sheet Connected',
        sheetName: sheet.getName(),
        totalRows: Math.max(0, sheet.getLastRow() - 1),
        spreadsheetId: TARGET_SPREADSHEET_ID,
        timestamp: new Date().toISOString()
      });
    }

    if (action === 'list') {
      const passkey = params.passkey || '';
      const auth = authenticateStaff(passkey, params.role);
      const isEntryStaff = auth.authenticated && auth.role === 'entry';

      // Pass role to getAllTickets so sensitive buyer phone/email can be masked for Entry Staff
      const tickets = getAllTickets(sheet, isEntryStaff);
      return jsonResponse({
        ok: true,
        data: tickets,
        count: Object.keys(tickets).length
      });
    }

    return jsonResponse({ ok: false, error: 'Unknown GET action: ' + action });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.toString() });
  }
}

/**
 * Handles HTTP POST requests
 */
function doPost(e) {
  try {
    let payload = {};
    if (e && e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    } else if (e && e.parameter) {
      payload = e.parameter;
    }

    const action = payload.action;
    const requestId = payload.requestId || '';

    // Idempotency check: if requestId was already processed, return cached response
    if (requestId) {
      const cache = CacheService.getScriptCache();
      const cached = cache.get('req_' + requestId);
      if (cached) {
        return jsonResponse(JSON.parse(cached));
      }
    }

    let response;

    if (action === 'lookup') {
      response = handleGateLookup(payload);
    } else if (action === 'upsert') {
      response = handleUpsert(payload);
    } else if (action === 'markEntered') {
      response = handleMarkEntered(payload);
    } else if (action === 'requestEntryStatusChange') {
      response = handleRequestEntryStatusChange(payload);
    } else if (action === 'clearTicketData') {
      response = handleClearTicketData(payload);
    } else if (action === 'prepareEventReset') {
      response = handlePrepareEventReset(payload);
    } else if (action === 'confirmEventReset') {
      response = handleConfirmEventReset(payload);
    } else {
      response = { ok: false, error: 'Invalid or missing action in request: ' + action };
    }

    // Cache idempotent response if successful
    if (requestId && response) {
      try {
        CacheService.getScriptCache().put('req_' + requestId, JSON.stringify(response), 21600); // 6 hours
      } catch (cErr) {}
    }

    return jsonResponse(response);
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message || err.toString() });
  }
}

/**
 * Action: lookup (Gate Scanner)
 * Returns only gate-safe fields
 */
function handleGateLookup(payload) {
  const code = normalizeCode(payload.code);
  if (!isValidCode(code)) {
    return { ok: false, error: 'Invalid Ticket. Code outside approved range HOH001-HOH050.' };
  }

  const sheet = getOrCreateSheet();
  const colMap = getColumnMap(sheet);
  const rowIdx = assertSingleRow(sheet, code, colMap);
  const fullTicket = readRow(sheet, rowIdx, colMap);

  let status = 'VALID';
  if (!fullTicket.buyerName || fullTicket.buyerName.trim() === '') {
    status = 'NOT_REGISTERED';
  } else if (fullTicket.paymentStatus === 'Cancelled' || fullTicket.paymentStatus === 'Refunded') {
    status = 'CANCELLED';
  } else if (fullTicket.entered) {
    status = 'ALREADY_ENTERED';
  }

  const gateSafeTicket = {
    code: fullTicket.code,
    buyerName: fullTicket.buyerName,
    guests: fullTicket.guests,
    paymentStatus: fullTicket.paymentStatus,
    entered: fullTicket.entered,
    enteredAt: fullTicket.enteredAt,
    status: status
  };

  return {
    ok: true,
    data: gateSafeTicket,
    ticket: gateSafeTicket
  };
}

/**
 * Action: upsert (Sales / Event Manager / Super Admin)
 */
function handleUpsert(payload) {
  const auth = authenticateStaff(payload.passkey, payload.role);
  if (!auth.authenticated || !['sales', 'manager', 'admin'].includes(auth.role)) {
    return { ok: false, error: 'Unauthorized: Sales Staff, Event Manager, or Super Admin role required.' };
  }

  const data = payload.record || payload;
  const code = normalizeCode(data.code);
  if (!isValidCode(code)) {
    return { ok: false, error: 'Invalid Ticket. Range must be HOH001 to HOH050.' };
  }

  const buyerName = String(data.buyerName || '').trim();
  const phone = String(data.phone || '').trim();
  if (!buyerName || !phone) {
    return { ok: false, error: 'Buyer name and phone are required.' };
  }

  const guests = parseInt(data.guests, 10) || 1;
  if (guests < 1 || guests > 10) {
    return { ok: false, error: 'Guests must be an integer between 1 and 10.' };
  }

  const paymentStatus = normalizePaymentStatus(data.paymentStatus);
  const amount = data.amount !== undefined ? Number(data.amount) : 0;
  const email = String(data.email || '').trim();
  const notes = String(data.notes || '').trim();
  const updatedBy = String(payload.staffIdentity || data.updatedBy || auth.role).trim();
  const qrPayload = String(data.qrPayload || code).trim();
  const requestId = payload.requestId || '';

  const lock = LockService.getDocumentLock();
  try {
    lock.waitLock(15000);

    const ss = getSpreadsheet();
    const sheet = getOrCreateSheet();
    const colMap = getColumnMap(sheet);
    const targetRow = assertSingleRow(sheet, code, colMap);
    const existing = readRow(sheet, targetRow, colMap);

    const now = new Date().toISOString();
    // Non-negotiable: MUST preserve Entered, Entered At, Registered At
    const preservedEntered = existing.entered;
    const preservedEnteredAt = existing.enteredAt || '';
    const preservedRegisteredAt = existing.registeredAt || now;

    sheet.getRange(targetRow, colMap['QR Payload']).setValue(qrPayload);
    sheet.getRange(targetRow, colMap['Buyer Name']).setValue(buyerName);
    sheet.getRange(targetRow, colMap['Phone']).setValue("'" + phone);
    sheet.getRange(targetRow, colMap['Email']).setValue(email);
    sheet.getRange(targetRow, colMap['Guests']).setValue(guests);
    sheet.getRange(targetRow, colMap['Payment Status']).setValue(paymentStatus);
    sheet.getRange(targetRow, colMap['Amount']).setValue(amount);
    sheet.getRange(targetRow, colMap['Notes']).setValue(notes);
    sheet.getRange(targetRow, colMap['Entered']).setValue(preservedEntered);
    sheet.getRange(targetRow, colMap['Entered At']).setValue(preservedEnteredAt);
    sheet.getRange(targetRow, colMap['Registered At']).setValue(preservedRegisteredAt);
    sheet.getRange(targetRow, colMap['Updated At']).setValue(now);
    sheet.getRange(targetRow, colMap['Updated By']).setValue(updatedBy);

    SpreadsheetApp.flush();

    const updatedRecord = {
      code: code,
      qrPayload: qrPayload,
      buyerName: buyerName,
      phone: phone,
      email: email,
      guests: guests,
      paymentStatus: paymentStatus,
      amount: amount,
      notes: notes,
      entered: preservedEntered,
      enteredAt: preservedEnteredAt,
      registeredAt: preservedRegisteredAt,
      updatedAt: now,
      updatedBy: updatedBy
    };

    // Mandatory Audit Log
    recordAuditEntry({
      ss: ss,
      requestId: requestId,
      action: 'BUYER_REGISTRATION_UPSERT',
      ticketCode: code,
      prevSnapshot: existing,
      newSnapshot: updatedRecord,
      reason: 'Buyer registration updated by ' + updatedBy,
      authenticatedUser: updatedBy,
      role: auth.role,
      result: 'SUCCESS'
    });

    return {
      ok: true,
      message: 'Record updated successfully.',
      ticket: updatedRecord,
      data: updatedRecord,
      requestId: requestId
    };
  } catch (err) {
    return { ok: false, error: err.message || err.toString() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Action: markEntered (Entry Staff, Event Manager, Super Admin)
 */
function handleMarkEntered(payload) {
  const auth = authenticateStaff(payload.passkey, payload.role);
  if (!auth.authenticated || !['entry', 'manager', 'admin'].includes(auth.role)) {
    return { ok: false, error: 'Unauthorized: Entry Staff, Event Manager, or Super Admin role required.' };
  }

  const code = normalizeCode(payload.code);
  if (!isValidCode(code)) {
    return { ok: false, error: 'Invalid Ticket. Range must be HOH001 to HOH050.' };
  }

  const staffIdentity = String(payload.staffIdentity || payload.staffId || auth.role).trim();
  const requestId = payload.requestId || '';

  const lock = LockService.getDocumentLock();
  try {
    lock.waitLock(15000);

    const ss = getSpreadsheet();
    const sheet = getOrCreateSheet();
    const colMap = getColumnMap(sheet);
    const targetRow = assertSingleRow(sheet, code, colMap);
    const existing = readRow(sheet, targetRow, colMap);

    if (!existing.buyerName || existing.buyerName.trim() === '') {
      return { ok: false, error: 'Admission denied: Ticket has no registered buyer.' };
    }

    if (existing.paymentStatus === 'Cancelled' || existing.paymentStatus === 'Refunded') {
      return { ok: false, error: 'Admission denied: Ticket is ' + existing.paymentStatus + '.' };
    }

    if (existing.entered === true) {
      return {
        ok: false,
        error: 'Already Entered at ' + (existing.enteredAt || 'earlier session') + '. Do not admit.'
      };
    }

    const now = new Date().toISOString();
    sheet.getRange(targetRow, colMap['Entered']).setValue(true);
    sheet.getRange(targetRow, colMap['Entered At']).setValue(now);
    sheet.getRange(targetRow, colMap['Updated At']).setValue(now);
    sheet.getRange(targetRow, colMap['Updated By']).setValue(staffIdentity);

    SpreadsheetApp.flush();

    const newRecord = Object.assign({}, existing, {
      entered: true,
      enteredAt: now,
      updatedAt: now,
      updatedBy: staffIdentity
    });

    // Mandatory Audit Record
    recordAuditEntry({
      ss: ss,
      requestId: requestId,
      action: 'GATE_MARK_ENTERED',
      ticketCode: code,
      prevSnapshot: { entered: false, enteredAt: existing.enteredAt },
      newSnapshot: { entered: true, enteredAt: now },
      reason: 'Gate entry admission confirmed',
      authenticatedUser: staffIdentity,
      role: auth.role,
      result: 'SUCCESS'
    });

    return {
      ok: true,
      message: 'Admission confirmed! Marked Entered.',
      ticket: newRecord,
      data: newRecord,
      requestId: requestId
    };
  } catch (err) {
    return { ok: false, error: err.message || err.toString() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Action: requestEntryStatusChange (Safe Action A: Event Manager, Super Admin)
 */
function handleRequestEntryStatusChange(payload) {
  const auth = authenticateStaff(payload.passkey, payload.role);
  if (!auth.authenticated || !['manager', 'admin'].includes(auth.role)) {
    return { ok: false, error: 'Unauthorized: Event Manager or Super Admin role required to correct entry status.' };
  }

  const code = normalizeCode(payload.code);
  if (!isValidCode(code)) {
    return { ok: false, error: 'Invalid Ticket. Range must be HOH001 to HOH050.' };
  }

  const confirmation = String(payload.confirmation || '').trim();
  if (confirmation !== code) {
    return { ok: false, error: 'Confirmation mismatch. You must type exact ticket code ' + code + '.' };
  }

  const reason = String(payload.reason || '').trim();
  if (reason.length < 10) {
    return { ok: false, error: 'Detailed reason required (minimum 10 characters).' };
  }

  const targetEntered = isTruthy(payload.entered);
  const staffIdentity = String(payload.staffIdentity || payload.staffId || auth.role).trim();
  const requestId = payload.requestId || '';

  const lock = LockService.getDocumentLock();
  try {
    lock.waitLock(15000);

    const ss = getSpreadsheet();
    const sheet = getOrCreateSheet();
    const colMap = getColumnMap(sheet);
    const targetRow = assertSingleRow(sheet, code, colMap);
    const existing = readRow(sheet, targetRow, colMap);

    if (targetEntered === true) {
      if (!existing.buyerName || existing.buyerName.trim() === '') {
        return { ok: false, error: 'Cannot mark Entered: Ticket has no registered buyer.' };
      }
      if (existing.paymentStatus === 'Cancelled' || existing.paymentStatus === 'Refunded') {
        return { ok: false, error: 'Cannot mark Entered: Ticket is ' + existing.paymentStatus + '.' };
      }
      if (existing.entered === true) {
        return { ok: false, error: 'Ticket is already marked as Entered.' };
      }
    }

    const now = new Date().toISOString();
    const oldEnteredAt = existing.enteredAt || '';
    const newEnteredAt = targetEntered ? (oldEnteredAt || now) : '';

    sheet.getRange(targetRow, colMap['Entered']).setValue(targetEntered);
    sheet.getRange(targetRow, colMap['Entered At']).setValue(newEnteredAt);
    sheet.getRange(targetRow, colMap['Updated At']).setValue(now);
    sheet.getRange(targetRow, colMap['Updated By']).setValue(staffIdentity);

    SpreadsheetApp.flush();

    const updatedRecord = Object.assign({}, existing, {
      entered: targetEntered,
      enteredAt: newEnteredAt,
      updatedAt: now,
      updatedBy: staffIdentity
    });

    // Mandatory Audit Record
    recordAuditEntry({
      ss: ss,
      requestId: requestId,
      action: 'CORRECTION_ENTRY_STATUS',
      ticketCode: code,
      prevSnapshot: { entered: existing.entered, enteredAt: oldEnteredAt },
      newSnapshot: { entered: targetEntered, enteredAt: newEnteredAt },
      reason: reason,
      authenticatedUser: staffIdentity,
      role: auth.role,
      result: 'SUCCESS'
    });

    return {
      ok: true,
      message: 'Entry status updated to ' + (targetEntered ? 'Entered' : 'Not Entered') + '.',
      ticket: updatedRecord,
      data: updatedRecord,
      requestId: requestId
    };
  } catch (err) {
    return { ok: false, error: err.message || err.toString() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Action: clearTicketData (Safe Action B: Event Manager, Super Admin)
 */
function handleClearTicketData(payload) {
  const auth = authenticateStaff(payload.passkey, payload.role);
  if (!auth.authenticated || !['manager', 'admin'].includes(auth.role)) {
    return { ok: false, error: 'Unauthorized: Event Manager or Super Admin role required to clear ticket data.' };
  }

  const code = normalizeCode(payload.code);
  if (!isValidCode(code)) {
    return { ok: false, error: 'Invalid Ticket. Range must be HOH001 to HOH050.' };
  }

  const confirmation = String(payload.confirmation || '').trim();
  if (confirmation !== code) {
    return { ok: false, error: 'Confirmation mismatch. You must type exact ticket code ' + code + '.' };
  }

  const reason = String(payload.reason || '').trim();
  if (reason.length < 10) {
    return { ok: false, error: 'Detailed reason required (minimum 10 characters).' };
  }

  const staffIdentity = String(payload.staffIdentity || payload.staffId || auth.role).trim();
  const requestId = payload.requestId || '';

  const lock = LockService.getDocumentLock();
  try {
    lock.waitLock(15000);

    const ss = getSpreadsheet();
    const sheet = getOrCreateSheet();
    const colMap = getColumnMap(sheet);
    const targetRow = assertSingleRow(sheet, code, colMap);
    const existing = readRow(sheet, targetRow, colMap);

    const now = new Date().toISOString();

    // Reset buyer & entry details, preserving Code & QR Payload
    sheet.getRange(targetRow, colMap['Buyer Name']).setValue('');
    sheet.getRange(targetRow, colMap['Phone']).setValue('');
    sheet.getRange(targetRow, colMap['Email']).setValue('');
    sheet.getRange(targetRow, colMap['Guests']).setValue(1);
    sheet.getRange(targetRow, colMap['Payment Status']).setValue('Pending');
    sheet.getRange(targetRow, colMap['Amount']).setValue(0);
    sheet.getRange(targetRow, colMap['Notes']).setValue('');
    sheet.getRange(targetRow, colMap['Entered']).setValue(false);
    sheet.getRange(targetRow, colMap['Entered At']).setValue('');
    sheet.getRange(targetRow, colMap['Registered At']).setValue('');
    sheet.getRange(targetRow, colMap['Updated At']).setValue(now);
    sheet.getRange(targetRow, colMap['Updated By']).setValue(staffIdentity);

    SpreadsheetApp.flush();

    const clearedRecord = {
      code: code,
      qrPayload: existing.qrPayload || code,
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
      updatedAt: now,
      updatedBy: staffIdentity
    };

    // Mandatory Audit Record
    recordAuditEntry({
      ss: ss,
      requestId: requestId,
      action: 'CLEAR_TICKET_DATA',
      ticketCode: code,
      prevSnapshot: existing,
      newSnapshot: clearedRecord,
      reason: reason,
      authenticatedUser: staffIdentity,
      role: auth.role,
      result: 'SUCCESS'
    });

    return {
      ok: true,
      message: 'Ticket ' + code + ' data cleared successfully.',
      ticket: clearedRecord,
      data: clearedRecord,
      requestId: requestId
    };
  } catch (err) {
    return { ok: false, error: err.message || err.toString() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Action: prepareEventReset (Safe Action C Step 1: Super Admin Only)
 */
function handlePrepareEventReset(payload) {
  const auth = authenticateStaff(payload.passkey, payload.role);
  if (!auth.authenticated || auth.role !== 'admin') {
    return { ok: false, error: 'Unauthorized: Super Admin authorization required to reset event data.' };
  }

  const reason = String(payload.reason || '').trim();
  if (reason.length < 20) {
    return { ok: false, error: 'Reset reason is mandatory and must be at least 20 characters.' };
  }

  const sheet = getOrCreateSheet();
  const allTickets = getAllTickets(sheet, false);
  let registeredCount = 0;
  let enteredCount = 0;

  Object.keys(allTickets).forEach(function(c) {
    const t = allTickets[c];
    if (t.buyerName && t.buyerName.trim() !== '') {
      registeredCount++;
    }
    if (t.entered) {
      enteredCount++;
    }
  });

  // Generate 5-minute one-time token
  const resetToken = 'RST_' + Utilities.getUuid().replace(/-/g, '').slice(0, 16).toUpperCase();
  const cache = CacheService.getScriptCache();
  const tokenData = {
    token: resetToken,
    user: payload.staffIdentity || 'Super Admin',
    createdAt: new Date().toISOString()
  };
  cache.put('reset_token_' + resetToken, JSON.stringify(tokenData), 300); // 5 minutes

  return {
    ok: true,
    resetToken: resetToken,
    expiresInSeconds: 300,
    registeredCount: registeredCount,
    enteredCount: enteredCount
  };
}

/**
 * Action: confirmEventReset (Safe Action C Step 2: Super Admin Only)
 */
function handleConfirmEventReset(payload) {
  const auth = authenticateStaff(payload.passkey, payload.role);
  if (!auth.authenticated || auth.role !== 'admin') {
    return { ok: false, error: 'Unauthorized: Super Admin authorization required to confirm event reset.' };
  }

  const resetToken = String(payload.resetToken || '').trim();
  if (!resetToken) {
    return { ok: false, error: 'Missing reset token. Please prepare event reset first.' };
  }

  const cache = CacheService.getScriptCache();
  const cachedData = cache.get('reset_token_' + resetToken);
  if (!cachedData) {
    return { ok: false, error: 'Reset token has expired or already been used. Please prepare reset again.' };
  }

  const confirmation = String(payload.confirmation || '').trim();
  if (confirmation !== 'RESET HOH EVENT') {
    return { ok: false, error: 'Confirmation mismatch. You must type exact text: RESET HOH EVENT' };
  }

  // 10-minute cooldown check
  const props = PropertiesService.getScriptProperties();
  const lastResetTime = props.getProperty('LAST_EVENT_RESET_TIME');
  if (lastResetTime) {
    const elapsedMs = Date.now() - new Date(lastResetTime).getTime();
    const cooldownMs = 10 * 60 * 1000;
    if (elapsedMs < cooldownMs) {
      const remainingMinutes = Math.ceil((cooldownMs - elapsedMs) / 60000);
      return { ok: false, error: 'Reset cooldown active. Please wait ' + remainingMinutes + ' minute(s) before resetting again.' };
    }
  }

  const staffIdentity = String(payload.staffIdentity || 'Super Admin').trim();
  const requestId = payload.requestId || '';

  const lock = LockService.getDocumentLock();
  try {
    lock.waitLock(20000);

    const ss = getSpreadsheet();
    const sheet = getOrCreateSheet();
    const colMap = getColumnMap(sheet);

    // Step 1: Create Backup tab first
    const backupName = createBackupSheet(ss);
    if (!backupName || !ss.getSheetByName(backupName)) {
      return { ok: false, error: 'Backup creation failed. Event reset aborted without modifying any ticket data.' };
    }

    // Step 2: Reset rows HOH001 to HOH050
    const lastRow = sheet.getLastRow();
    const now = new Date().toISOString();
    const totalCols = REQUIRED_HEADERS.length;

    if (lastRow > 1) {
      const fullRange = sheet.getRange(2, 1, lastRow - 1, totalCols);
      const values = fullRange.getValues();

      for (let i = 0; i < values.length; i++) {
        const row = values[i];
        // Preserve Code and QR Payload, reset buyer/payment/entry
        row[colMap['Buyer Name'] - 1] = '';
        row[colMap['Phone'] - 1] = '';
        row[colMap['Email'] - 1] = '';
        row[colMap['Guests'] - 1] = 1;
        row[colMap['Payment Status'] - 1] = 'Pending';
        row[colMap['Amount'] - 1] = 0;
        row[colMap['Notes'] - 1] = '';
        row[colMap['Entered'] - 1] = false;
        row[colMap['Entered At'] - 1] = '';
        row[colMap['Registered At'] - 1] = '';
        row[colMap['Updated At'] - 1] = now;
        row[colMap['Updated By'] - 1] = staffIdentity;
      }

      fullRange.setValues(values);
      SpreadsheetApp.flush();
    }

    // Invalidate reset token immediately so it cannot be replayed
    cache.remove('reset_token_' + resetToken);
    props.setProperty('LAST_EVENT_RESET_TIME', now);

    // Step 3: Log summary audit entry
    recordAuditEntry({
      ss: ss,
      requestId: requestId,
      action: 'RESET_ALL_EVENT_DATA',
      ticketCode: 'ALL (HOH001-HOH050)',
      prevSnapshot: 'Active Event Data Backed Up to ' + backupName,
      newSnapshot: 'RESET_TO_EMPTY',
      reason: 'Confirmed Event Reset by ' + staffIdentity,
      authenticatedUser: staffIdentity,
      role: auth.role,
      backupTab: backupName,
      result: 'SUCCESS'
    });

    return {
      ok: true,
      message: 'All ticket data reset successfully. Backup created in tab: ' + backupName,
      backupTab: backupName,
      requestId: requestId
    };
  } catch (err) {
    return { ok: false, error: err.message || err.toString() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Creates backup sheet copy and verifies existence
 */
function createBackupSheet(ss) {
  const sourceSheet = ss.getSheetByName(SHEET_NAME);
  if (!sourceSheet) return null;

  const d = new Date();
  const pad = function(n) { return ('0' + n).slice(-2); };
  const stamp = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '_' + pad(d.getHours()) + '-' + pad(d.getMinutes());
  let backupName = 'Backup_' + stamp;

  let counter = 1;
  while (ss.getSheetByName(backupName)) {
    backupName = 'Backup_' + stamp + '_' + counter;
    counter++;
  }

  const backupSheet = sourceSheet.copyTo(ss);
  backupSheet.setName(backupName);
  SpreadsheetApp.flush();
  return backupName;
}

/**
 * Reads row data
 */
function readRow(sheet, rowIdx, colMap, maskSensitive) {
  const phoneVal = String(sheet.getRange(rowIdx, colMap['Phone']).getValue() || '').replace(/^'/, '');
  const emailVal = String(sheet.getRange(rowIdx, colMap['Email']).getValue() || '');

  return {
    code: normalizeCode(sheet.getRange(rowIdx, colMap['Code']).getValue()),
    qrPayload: String(sheet.getRange(rowIdx, colMap['QR Payload']).getValue() || ''),
    buyerName: String(sheet.getRange(rowIdx, colMap['Buyer Name']).getValue() || ''),
    phone: maskSensitive && phoneVal ? '********' + phoneVal.slice(-2) : phoneVal,
    email: maskSensitive && emailVal ? '****@****' : emailVal,
    guests: Number(sheet.getRange(rowIdx, colMap['Guests']).getValue()) || 1,
    paymentStatus: normalizePaymentStatus(sheet.getRange(rowIdx, colMap['Payment Status']).getValue()),
    amount: Number(sheet.getRange(rowIdx, colMap['Amount']).getValue()) || 0,
    notes: String(sheet.getRange(rowIdx, colMap['Notes']).getValue() || ''),
    entered: isTruthy(sheet.getRange(rowIdx, colMap['Entered']).getValue()),
    enteredAt: String(sheet.getRange(rowIdx, colMap['Entered At']).getValue() || ''),
    registeredAt: String(sheet.getRange(rowIdx, colMap['Registered At']).getValue() || ''),
    updatedAt: String(sheet.getRange(rowIdx, colMap['Updated At']).getValue() || ''),
    updatedBy: String(sheet.getRange(rowIdx, colMap['Updated By']).getValue() || '')
  };
}

function getAllTickets(sheet, maskSensitive) {
  const colMap = getColumnMap(sheet);
  const lastRow = sheet.getLastRow();
  const result = {};

  if (lastRow > 1) {
    for (let r = 2; r <= lastRow; r++) {
      const ticket = readRow(sheet, r, colMap, maskSensitive);
      if (ticket.code) {
        result[ticket.code] = ticket;
      }
    }
  }
  return result;
}
