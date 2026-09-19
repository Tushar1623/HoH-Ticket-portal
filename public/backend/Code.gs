/**
 * =========================================================================
 * HOUSE OF HUMOUR - Official Ticket Portal Backend
 * Google Apps Script Web App
 * 
 * Target Google Sheet:
 * https://docs.google.com/spreadsheets/d/1nJAMZQnqbsyciIHz-x4xaRiNzgcRPK861ae1No-tBGI/edit
 * =========================================================================
 */

const TARGET_SPREADSHEET_ID = '1nJAMZQnqbsyciIHz-x4xaRiNzgcRPK861ae1No-tBGI';
const SHEET_NAME = 'Tickets';
const HEADERS = [
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
 * Helper to get the Spreadsheet (either Active or by Target ID)
 */
function getSpreadsheet() {
  try {
    const active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) return active;
  } catch (e) {
    // fallback to target ID
  }
  return SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
}

/**
 * Initialize the Sheet with standard headers and 50 ticket rows (HOH001 to HOH050)
 * Run this function once from the Apps Script toolbar!
 */
function initSheet() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  // Set header styling in House of Humour burgundy and gold
  const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
  headerRange.setValues([HEADERS]);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#541D2B');
  headerRange.setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);

  // Check existing codes
  const lastRow = sheet.getLastRow();
  let existingCodes = [];
  if (lastRow > 1) {
    existingCodes = sheet.getRange(2, 1, lastRow - 1, 1).getValues().map(r => r[0]);
  }

  // Populate HOH001 to HOH050 if missing
  const now = new Date().toISOString();
  const rowsToAdd = [];
  for (let i = 1; i <= 50; i++) {
    const code = 'HOH' + ('000' + i).slice(-3);
    if (!existingCodes.includes(code)) {
      // Code, QR Payload, Buyer Name, Phone, Email, Guests, Payment Status, Amount, Notes, Entered, Entered At, Registered At, Updated At, Updated By
      rowsToAdd.push([code, code, '', '', '', 1, 'Pending', 0, '', false, '', '', now, 'System Init']);
    }
  }

  if (rowsToAdd.length > 0) {
    sheet.getRange(lastRow + 1, 1, rowsToAdd.length, HEADERS.length).setValues(rowsToAdd);
  }

  // Auto-resize columns
  sheet.autoResizeColumns(1, HEADERS.length);
  Logger.log('HOH Sheet ' + TARGET_SPREADSHEET_ID + ' initialized with 50 ticket rows.');
}

/**
 * Handles HTTP GET requests (list, health)
 */
function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const action = params.action || 'list';

  try {
    if (action === 'health') {
      const ss = getSpreadsheet();
      const sheet = ss.getSheetByName(SHEET_NAME);
      return jsonResponse({
        ok: true,
        status: 'Sheet Connected',
        sheetName: SHEET_NAME,
        spreadsheetId: TARGET_SPREADSHEET_ID,
        totalRows: sheet ? sheet.getLastRow() - 1 : 0,
        timestamp: new Date().toISOString()
      });
    }

    if (action === 'list') {
      const data = getAllTickets();
      return jsonResponse({ ok: true, data: data });
    }

    return jsonResponse({ ok: false, error: 'Unknown GET action: ' + action });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.toString() });
  }
}

/**
 * Handles HTTP POST requests (lookup, upsert, markEntered)
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
      const ticket = getTicketByCode(code);
      if (ticket) {
        return jsonResponse({ ok: true, data: ticket });
      } else {
        return jsonResponse({ ok: false, error: 'Ticket ' + code + ' not found.' });
      }
    }

    if (action === 'upsert') {
      const result = upsertTicketWithLock(payload.record);
      return jsonResponse(result);
    }

    if (action === 'markEntered') {
      const code = normalizeCode(payload.code);
      const staffId = payload.staffId || 'Venue Staff';
      const result = markEnteredWithLock(code, staffId);
      return jsonResponse(result);
    }

    return jsonResponse({ ok: false, error: 'Unknown POST action: ' + action });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.toString() });
  }
}

/**
 * Atomic Entry Verification with Document Lock (BR 05, BR 06)
 */
function markEnteredWithLock(code, staffId) {
  const lock = LockService.getDocumentLock();
  try {
    lock.waitLock(10000);

    const sheet = getOrCreateSheet();
    const rowInfo = findRowByCode(sheet, code);

    if (!rowInfo) {
      return { ok: false, error: 'Invalid ticket code ' + code };
    }

    const rowIdx = rowInfo.row;
    const ticket = rowInfo.ticket;

    if (!ticket.buyerName || ticket.buyerName.trim() === '') {
      return { ok: false, error: 'Admission denied: Ticket has no registered buyer.' };
    }

    if (ticket.paymentStatus === 'Cancelled' || ticket.paymentStatus === 'Refunded') {
      return { ok: false, error: 'Admission denied: Ticket is ' + ticket.paymentStatus + '.' };
    }

    if (ticket.entered === true || ticket.entered === 'true') {
      return {
        ok: false,
        error: 'Already Entered at ' + (ticket.enteredAt || 'earlier') + '. Duplicate admission blocked!'
      };
    }

    const now = new Date().toISOString();
    sheet.getRange(rowIdx, 10).setValue(true);
    sheet.getRange(rowIdx, 11).setValue(now);
    sheet.getRange(rowIdx, 13).setValue(now);
    sheet.getRange(rowIdx, 14).setValue(staffId);

    ticket.entered = true;
    ticket.enteredAt = now;
    ticket.updatedAt = now;
    ticket.updatedBy = staffId;

    return { ok: true, data: ticket, message: 'Ticket marked Entered successfully!' };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Atomic Registration / Update with Document Lock (FR 03, FR 04)
 */
function upsertTicketWithLock(record) {
  if (!record || !record.code) {
    return { ok: false, error: 'Missing ticket record or code' };
  }

  const code = normalizeCode(record.code);
  const lock = LockService.getDocumentLock();
  try {
    lock.waitLock(10000);

    const sheet = getOrCreateSheet();
    const rowInfo = findRowByCode(sheet, code);
    const now = new Date().toISOString();

    if (!rowInfo) {
      return { ok: false, error: 'Ticket code ' + code + ' not found in registered range.' };
    }

    const rowIdx = rowInfo.row;
    const existing = rowInfo.ticket;

    const registeredAt = existing.registeredAt || now;
    const guests = record.guests || 1;
    const amount = record.amount !== undefined ? record.amount : (existing.amount || 0);

    sheet.getRange(rowIdx, 2).setValue(record.qrPayload || code);
    sheet.getRange(rowIdx, 3).setValue(record.buyerName || '');
    sheet.getRange(rowIdx, 4).setValue(record.phone ? "'" + record.phone : '');
    sheet.getRange(rowIdx, 5).setValue(record.email || '');
    sheet.getRange(rowIdx, 6).setValue(guests);
    sheet.getRange(rowIdx, 7).setValue(record.paymentStatus || 'Pending');
    sheet.getRange(rowIdx, 8).setValue(amount);
    sheet.getRange(rowIdx, 9).setValue(record.notes || '');
    sheet.getRange(rowIdx, 12).setValue(registeredAt);
    sheet.getRange(rowIdx, 13).setValue(now);
    sheet.getRange(rowIdx, 14).setValue(record.updatedBy || 'Staff');

    const updated = {
      code: code,
      qrPayload: record.qrPayload || code,
      buyerName: record.buyerName || '',
      phone: record.phone || '',
      email: record.email || '',
      guests: guests,
      paymentStatus: record.paymentStatus || 'Pending',
      amount: amount,
      notes: record.notes || '',
      entered: existing.entered,
      enteredAt: existing.enteredAt,
      registeredAt: registeredAt,
      updatedAt: now,
      updatedBy: record.updatedBy || 'Staff'
    };

    return { ok: true, data: updated, message: 'Buyer details saved to Google Sheet!' };
  } finally {
    lock.releaseLock();
  }
}

function findRowByCode(sheet, code) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const data = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  for (let i = 0; i < data.length; i++) {
    const rowCode = normalizeCode(data[i][0]);
    if (rowCode === code) {
      return {
        row: i + 2,
        ticket: rowToTicket(data[i])
      };
    }
  }
  return null;
}

function getAllTickets() {
  const sheet = getOrCreateSheet();
  const lastRow = sheet.getLastRow();
  const result = {};

  if (lastRow > 1) {
    const data = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
    for (let i = 0; i < data.length; i++) {
      const ticket = rowToTicket(data[i]);
      result[ticket.code] = ticket;
    }
  }
  return result;
}

function rowToTicket(row) {
  return {
    code: normalizeCode(row[0]),
    qrPayload: String(row[1] || ''),
    buyerName: String(row[2] || ''),
    phone: String(row[3] || '').replace(/^'/, ''),
    email: String(row[4] || ''),
    guests: Number(row[5]) || 1,
    paymentStatus: String(row[6] || 'Pending'),
    amount: Number(row[7]) || 0,
    notes: String(row[8] || ''),
    entered: row[9] === true || String(row[9]).toLowerCase() === 'true',
    enteredAt: row[10] ? String(row[10]) : '',
    registeredAt: row[11] ? String(row[11]) : '',
    updatedAt: row[12] ? String(row[12]) : '',
    updatedBy: row[13] ? String(row[13]) : ''
  };
}

function normalizeCode(str) {
  return String(str || '').trim().toUpperCase();
}

function getOrCreateSheet() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    initSheet();
    sheet = ss.getSheetByName(SHEET_NAME);
  }
  return sheet;
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
