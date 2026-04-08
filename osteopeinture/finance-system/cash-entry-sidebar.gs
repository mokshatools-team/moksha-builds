/**
 * cash-entry-sidebar.gs
 * OstéoPeinture 2026 — Mobile Cash Entry Sidebar
 *
 * Opens a sidebar for fast transaction entry in the field.
 * Works on Google Sheets iOS/Android app (via Extensions menu).
 *
 * Usage: OstéoPeinture > Add Transaction
 */

// ── MENU ENTRY ────────────────────────────────────────────────────────────────

// NOTE: This onOpen is defined in import-csv.gs and already includes 'Add Transaction'.
// Both files must be present in the same Apps Script project.

function showCashEntry() {
  const html = HtmlService
    .createHtmlOutputFromFile('sidebar')
    .setTitle('Add Transaction')
    .setWidth(320);
  SpreadsheetApp.getUi().showSidebar(html);
}

// ── DATA PROVIDERS (called from sidebar HTML via google.script.run) ───────────

function getDropdownData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Accounts from Accounts tab col A (skip header)
  const accountSheet = ss.getSheetByName('Accounts');
  const accounts = accountSheet
    ? accountSheet.getRange(2, 1, accountSheet.getLastRow() - 1, 1)
        .getValues().map(r => r[0]).filter(String)
    : ['RBC','BMO MC','CIBC','Cash','Owner: Loric','Owner: Graeme','Owner: Lubo'];

  // Categories from Categories tab col A (skip header)
  const catSheet = ss.getSheetByName('Categories');
  const categories = catSheet
    ? catSheet.getRange(2, 1, catSheet.getLastRow() - 1, 1)
        .getValues().map(r => r[0]).filter(String)
    : [];

  const transferTypes = [
    'Opening Balance',
    'Credit Card Payment',
    'Loan Received',
    'Loan Repayment',
    'Owner Advance',
    'Owner Draw',
    'Owner Payment',
    'Owner Reimbursement',
    'Asset Purchase',
    'Client Payment',
    'Vendor Payment',
    'Third Party Transfer',
  ];

  return { accounts, categories, transferTypes };
}

// ── TRANSACTION SUBMISSION ─────────────────────────────────────────────────────

/**
 * Called from sidebar when user taps Submit.
 * entry = { date, description, account, counterpart, amount, category, transferType, job, mirror }
 */
function submitTransaction(entry) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('Transactions');
  if (!sh) return { ok: false, error: 'Transactions tab not found.' };

  try {
    const month = deriveMonth(entry.date);
    const amount = parseFloat(entry.amount);
    if (isNaN(amount)) return { ok: false, error: 'Invalid amount.' };

    // Primary row
    sh.appendRow([
      entry.date,
      entry.description,
      entry.account,
      entry.counterpart || '',
      amount,
      entry.category || '',
      entry.transferType || '',
      month,
      entry.job || '',
      'Manual'
    ]);

    // Mirror row (flipped amount, accounts swapped)
    if (entry.mirror && entry.counterpart) {
      sh.appendRow([
        entry.date,
        entry.description,
        entry.counterpart,
        entry.account,
        -amount,
        entry.category || '',
        entry.transferType || '',
        month,
        entry.job || '',
        'Manual'
      ]);
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function deriveMonth(dateStr) {
  try {
    const d = new Date(dateStr);
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM');
  } catch(e) {
    return '';
  }
}
