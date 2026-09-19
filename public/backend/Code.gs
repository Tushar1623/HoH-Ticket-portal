/**
 * =========================================================================
 * HOUSE OF HUMOUR - Official Ticket Portal Backend
 * Google Apps Script Web App
 *
 * Target Google Sheet:
 * https://docs.google.com/spreadsheets/d/1nJAMZQnqbsyciIHz-x4xaRiNzgcRPK861ae1No-tBGI/edit
 *
 * Implements: HOH Ticket Portal Data Storage & Google Sheets Integration PRD
 * =========================================================================
 */

const TARGET_SPREADSHEET_ID = '1nJAMZQnqbsyciIHz-x4xaRiNzgcRPK861ae1No-tBGI';
const SHEET_NAME = 'Tickets';

// Required Header Names (Section 4 & 13)
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

/**
 * Helper to get the Spreadsheet (Active or Target ID)
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
 * Initialize sheet with headers and pre-populate HOH001 to HOH050
 */
function initSheet() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  // Format header row (Burgundy #541D2B, White bold text)
  const headerRange = sheet.getRange(1, 1, 1, REQUIRED_HEADERS.length);
  headerRange.setValues([REQUIRED_HEADERS]);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#541D2B');
  headerRange.setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);

  // Read existing codes in column A
  const lastRow = sheet.getLastRow();
  let existingCodes = [];
  if (lastRow > 1) {
    existingCodes = sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(function(r) {
      return normalizeCode(r[0]);
    });
  }

  // Populate HOH001 to HOH050 if missing
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
  Logger.log('HOH Sheet initialized successfully with 50 ticket rows.');
}

/**
 * Dynamic Column Header Mapping (Section 13)
 * Returns object mapping field name to 1-indexed column number, or throws error if missing.
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

  // Check required headers
  for (let j = 0; j < REQUIRED_HEADERS.length; j++) {
    const required = REQUIRED_HEADERS[j];
    if (!map[required]) {
      throw new Error('Google Sheet configuration error. Required column is missing: ' + required);
    }
  }

  return map;
}

/**
 * Normalizes payment status (Section 7)
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
      const tickets = getAllTickets(sheet);
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

    if (action === 'lookup') {
      const code = normalizeCode(payload.code);
      const sheet = getOrCreateSheet();
      const ticket = getTicketByCode(sheet, code);
      if (ticket) {
        return jsonResponse({ ok: true, data: ticket, ticket: ticket });
      } else {
        return jsonResponse({ ok: false, error: 'Invalid Ticket. Code ' + code + ' not found.' });
      }
    }

    if (action === 'upsert') {
      return jsonResponse(upsertTicketWithLock(payload));
    }

    if (action === 'markEntered') {
      return jsonResponse(markEnteredWithLock(payload));
    }

    return jsonResponse({ ok: false, error: 'Invalid or missing action in request' });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.toString() });
  }
}

/**
 * Atomic UPSERT Operation (Section 8, 9, 10, 13, 14, 15, 16)
 */
function upsertTicketWithLock(payload) {
  const data = payload.record || payload;
  const rawCode = data.code;
  if (!rawCode) {
    return { ok: false, error: 'Missing required field: code' };
  }

  const code = normalizeCode(rawCode);
  // Validate code range HOH001 to HOH050
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
  const updatedBy = String(data.updatedBy || 'Staff').trim();
  const qrPayload = String(data.qrPayload || code).trim();

  // Server-side lock (Section 15)
  const lock = LockService.getDocumentLock();
  try {
    lock.waitLock(10000);

    const sheet = getOrCreateSheet();
    const colMap = getColumnMap(sheet); // Validates all required headers dynamically

    // Find row index by searching Code column (Section 14)
    const codeCol = colMap['Code'];
    const lastRow = sheet.getLastRow();
    let targetRow = -1;
    let existingRecord = null;

    if (lastRow > 1) {
      const codeValues = sheet.getRange(2, codeCol, lastRow - 1, 1).getValues();
      for (let i = 0; i < codeValues.length; i++) {
        if (normalizeCode(codeValues[i][0]) === code) {
          targetRow = i + 2;
          existingRecord = readRow(sheet, targetRow, colMap);
          break;
        }
      }
    }

    const now = new Date().toISOString();

    if (targetRow > 0 && existingRecord) {
      // EXISTING RECORD UPDATE (Section 9, 16)
      // MUST preserve Entered, Entered At, and Registered At!
      const preservedEntered = existingRecord.entered;
      const preservedEnteredAt = existingRecord.enteredAt || '';
      const preservedRegisteredAt = existingRecord.registeredAt || now;

      sheet.getRange(targetRow, colMap['QR Payload']).setValue(qrPayload);
      sheet.getRange(targetRow, colMap['Buyer Name']).setValue(buyerName);
      sheet.getRange(targetRow, colMap['Phone']).setValue("'" + phone); // Preserve as text (TEST 5)
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

      return {
        ok: true,
        message: 'Record updated successfully.',
        ticket: updatedRecord,
        data: updatedRecord
      };
    } else {
      // NEW TICKET ROW (Section 10)
      const newRow = lastRow + 1;
      sheet.getRange(newRow, colMap['Code']).setValue(code);
      sheet.getRange(newRow, colMap['QR Payload']).setValue(qrPayload);
      sheet.getRange(newRow, colMap['Buyer Name']).setValue(buyerName);
      sheet.getRange(newRow, colMap['Phone']).setValue("'" + phone);
      sheet.getRange(newRow, colMap['Email']).setValue(email);
      sheet.getRange(newRow, colMap['Guests']).setValue(guests);
      sheet.getRange(newRow, colMap['Payment Status']).setValue(paymentStatus);
      sheet.getRange(newRow, colMap['Amount']).setValue(amount);
      sheet.getRange(newRow, colMap['Notes']).setValue(notes);
      sheet.getRange(newRow, colMap['Entered']).setValue(false);
      sheet.getRange(newRow, colMap['Entered At']).setValue('');
      sheet.getRange(newRow, colMap['Registered At']).setValue(now);
      sheet.getRange(newRow, colMap['Updated At']).setValue(now);
      sheet.getRange(newRow, colMap['Updated By']).setValue(updatedBy);

      SpreadsheetApp.flush();

      const createdRecord = {
        code: code,
        qrPayload: qrPayload,
        buyerName: buyerName,
        phone: phone,
        email: email,
        guests: guests,
        paymentStatus: paymentStatus,
        amount: amount,
        notes: notes,
        entered: false,
        enteredAt: '',
        registeredAt: now,
        updatedAt: now,
        updatedBy: updatedBy
      };

      return {
        ok: true,
        message: 'Ticket registered successfully.',
        ticket: createdRecord,
        data: createdRecord
      };
    }
  } catch (err) {
    return { ok: false, error: err.message || err.toString() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Atomic Entry Marking (Section 15, 16, TEST 9)
 */
function markEnteredWithLock(payload) {
  const code = normalizeCode(payload.code);
  if (!code || !isValidCode(code)) {
    return { ok: false, error: 'Invalid Ticket. Range must be HOH001 to HOH050.' };
  }

  const staffId = payload.staffId || payload.updatedBy || 'Gate Staff';

  const lock = LockService.getDocumentLock();
  try {
    lock.waitLock(10000);

    const sheet = getOrCreateSheet();
    const colMap = getColumnMap(sheet);

    const codeCol = colMap['Code'];
    const lastRow = sheet.getLastRow();
    let targetRow = -1;
    let existing = null;

    if (lastRow > 1) {
      const codeValues = sheet.getRange(2, codeCol, lastRow - 1, 1).getValues();
      for (let i = 0; i < codeValues.length; i++) {
        if (normalizeCode(codeValues[i][0]) === code) {
          targetRow = i + 2;
          existing = readRow(sheet, targetRow, colMap);
          break;
        }
      }
    }

    if (targetRow === -1 || !existing) {
      return { ok: false, error: 'Invalid ticket code ' + code };
    }

    if (!existing.buyerName || existing.buyerName.trim() === '') {
      return { ok: false, error: 'Admission denied: Ticket has no registered buyer.' };
    }

    if (existing.paymentStatus === 'Cancelled' || existing.paymentStatus === 'Refunded') {
      return { ok: false, error: 'Admission denied: Ticket is ' + existing.paymentStatus + '.' };
    }

    // Duplicate admission check
    if (existing.entered === true) {
      return {
        ok: false,
        error: 'Already Entered at ' + (existing.enteredAt || 'earlier session') + '. Duplicate admission blocked!'
      };
    }

    const now = new Date().toISOString();
    sheet.getRange(targetRow, colMap['Entered']).setValue(true);
    sheet.getRange(targetRow, colMap['Entered At']).setValue(now);
    sheet.getRange(targetRow, colMap['Updated At']).setValue(now);
    sheet.getRange(targetRow, colMap['Updated By']).setValue(staffId);

    SpreadsheetApp.flush();

    existing.entered = true;
    existing.enteredAt = now;
    existing.updatedAt = now;
    existing.updatedBy = staffId;

    return {
      ok: true,
      message: 'Admission confirmed! Ticket marked Entered.',
      ticket: existing,
      data: existing
    };
  } catch (err) {
    return { ok: false, error: err.message || err.toString() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Read row data mapped to TicketRecord
 */
function readRow(sheet, rowIdx, colMap) {
  return {
    code: normalizeCode(sheet.getRange(rowIdx, colMap['Code']).getValue()),
    qrPayload: String(sheet.getRange(rowIdx, colMap['QR Payload']).getValue() || ''),
    buyerName: String(sheet.getRange(rowIdx, colMap['Buyer Name']).getValue() || ''),
    phone: String(sheet.getRange(rowIdx, colMap['Phone']).getValue() || '').replace(/^'/, ''),
    email: String(sheet.getRange(rowIdx, colMap['Email']).getValue() || ''),
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

function getAllTickets(sheet) {
  const colMap = getColumnMap(sheet);
  const lastRow = sheet.getLastRow();
  const result = {};

  if (lastRow > 1) {
    for (let r = 2; r <= lastRow; r++) {
      const ticket = readRow(sheet, r, colMap);
      if (ticket.code) {
        result[ticket.code] = ticket;
      }
    }
  }
  return result;
}

function getTicketByCode(sheet, code) {
  const colMap = getColumnMap(sheet);
  const codeCol = colMap['Code'];
  const lastRow = sheet.getLastRow();

  if (lastRow > 1) {
    const codeValues = sheet.getRange(2, codeCol, lastRow - 1, 1).getValues();
    for (let i = 0; i < codeValues.length; i++) {
      if (normalizeCode(codeValues[i][0]) === code) {
        return readRow(sheet, i + 2, colMap);
      }
    }
  }
  return null;
}

function isTruthy(val) {
  return val === true || String(val).toLowerCase() === 'true';
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
