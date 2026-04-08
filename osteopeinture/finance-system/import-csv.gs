/**
 * import-csv.gs
 * OstéoPeinture 2026 — Bank Import Pipeline
 *
 * How it works:
 * 1. Claude in Chrome downloads bank CSVs into a Google Drive folder
 * 2. A time-based trigger runs checkBankExportFolder() hourly
 * 3. New files are detected, parsed, normalized, and staged in the Import tab
 * 4. User reviews staged rows, adds Category/Transfer Type/Job
 * 5. User runs OstéoPeinture > Push Staged to Transactions
 *
 * Setup (run once):
 *   1. Run setupScriptProperties() and enter your Drive folder ID + Claude API key
 *   2. Run installTrigger() to activate the hourly folder check
 *   3. Done.
 */

// ── SETUP ────────────────────────────────────────────────────────────────────

/**
 * Run once to configure the script.
 * Prompts for Drive folder ID and Claude API key, stores them securely.
 */
function setupScriptProperties() {
  const ui = SpreadsheetApp.getUi();

  const folderRes = ui.prompt(
    'Setup — Drive Folder ID',
    'Paste the Google Drive folder ID for OstéoPeinture/Bank Exports/\n' +
    '(the long string in the folder URL after /folders/)',
    ui.ButtonSet.OK_CANCEL
  );
  if (folderRes.getSelectedButton() !== ui.Button.OK) return;

  const apiRes = ui.prompt(
    'Setup — Claude API Key',
    'Paste your Anthropic API key (for screenshot fallback).\n' +
    'Stored securely in Script Properties — never visible in code.',
    ui.ButtonSet.OK_CANCEL
  );
  if (apiRes.getSelectedButton() !== ui.Button.OK) return;

  const props = PropertiesService.getScriptProperties();
  props.setProperty('BANK_EXPORTS_FOLDER_ID', folderRes.getResponseText().trim());
  props.setProperty('CLAUDE_API_KEY', apiRes.getResponseText().trim());

  ui.alert('Setup complete. Now run installTrigger() to activate the hourly check.');
}

/**
 * Run once to install the hourly Drive folder watcher trigger.
 */
function installTrigger() {
  // Remove any existing trigger for this function first
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'checkBankExportFolder') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('checkBankExportFolder')
    .timeBased().everyHours(1).create();
  SpreadsheetApp.getUi().alert('Hourly trigger installed. Import will check for new files every hour.');
}

// ── CUSTOM MENU ──────────────────────────────────────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('OstéoPeinture')
    .addItem('Add Transaction', 'showCashEntry')
    .addSeparator()
    .addItem('Check Bank Export Folder Now', 'checkBankExportFolder')
    .addItem('Push Staged to Transactions', 'pushStagedToTransactions')
    .addSeparator()
    .addItem('Setup: Configure Folder & API Key', 'setupScriptProperties')
    .addItem('Setup: Install Hourly Trigger', 'installTrigger')
    .addItem('Setup: Reset Processed File Cache', 'resetProcessedFiles')
    .addToUi();
}

// ── FOLDER WATCHER ───────────────────────────────────────────────────────────

/**
 * Main entry point — called by hourly trigger and by menu.
 * Scans Drive folder for new files, routes to correct parser.
 */
function checkBankExportFolder() {
  const folderId = PropertiesService.getScriptProperties().getProperty('BANK_EXPORTS_FOLDER_ID');
  if (!folderId) {
    Logger.log('No folder ID configured. Run setupScriptProperties() first.');
    return;
  }

  const folder = DriveApp.getFolderById(folderId);
  const processed = getProcessedFileIds();
  let newCount = 0;

  // Check files directly in folder and in any YYYY-MM subfolders
  const fileSets = [folder.getFiles()];
  const subfolders = folder.getFolders();
  while (subfolders.hasNext()) {
    fileSets.push(subfolders.next().getFiles());
  }

  fileSets.forEach(files => {
    while (files.hasNext()) {
      const file = files.next();
      if (processed.has(file.getId())) continue;

      const mime = file.getMimeType();
      let result;

      if (mime === 'text/csv' || mime === 'text/plain' ||
          mime === 'application/vnd.ms-excel' ||
          file.getName().toLowerCase().endsWith('.csv')) {
        result = processCSVFile(file);
      } else if (mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/jpg') {
        result = processScreenshotFile(file);
      } else {
        Logger.log('Skipping unsupported file type: ' + file.getName() + ' (' + mime + ')');
        continue;
      }

      if (result !== null) {
        markFileProcessed(file.getId(), file.getName(), result);
        newCount++;
      }
    }
  });

  Logger.log('Folder check complete. New files processed: ' + newCount);
  if (newCount > 0) {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      newCount + ' new file(s) staged in Import tab. Review and push to Transactions.',
      'Bank Import', 10
    );
  }
}

// ── CSV PROCESSING ────────────────────────────────────────────────────────────

function processCSVFile(file) {
  // Strip BOM (byte order mark) that French-locale bank exports include
  let content = file.getBlob().getDataAsString('UTF-8');
  content = content.replace(/^\uFEFF/, '');

  const rows = Utilities.parseCsv(content);
  if (!rows || rows.length === 0) return 0;

  const bank = detectBank(rows);
  Logger.log('Detected bank: ' + bank + ' for file: ' + file.getName());

  let normalized;
  if (bank === 'RBC')    normalized = normalizeRBC(rows);
  else if (bank === 'BMO MC') normalized = normalizeBMO(rows);
  else if (bank === 'CIBC')   normalized = normalizeCIBC(rows);
  else                        normalized = normalizeUnknown(rows);

  if (normalized.length === 0) return 0;
  stageRows(normalized, file.getName());
  return normalized.length;
}

/**
 * Detect which bank a CSV belongs to by examining headers or data structure.
 */
function detectBank(rows) {
  if (!rows || rows.length === 0) return 'UNKNOWN';

  // Check first 3 rows for headers (BMO has a metadata line before the real header)
  const headerCandidates = rows.slice(0, 3).map(r =>
    r.map(c => (c || '').trim().toLowerCase()).join(',')
  );
  const allHeaders = headerCandidates.join('|||');

  // RBC: has "cad$" in header (unique to RBC, works in both EN and FR)
  if (allHeaders.includes('cad$')) {
    return 'RBC';
  }

  // BMO MC: EN "item #" + "card #" or FR "article no" + "carte no"
  if (allHeaders.includes('item #') || allHeaders.includes('card #') ||
      allHeaders.includes('article no') || allHeaders.includes('carte no')) {
    return 'BMO MC';
  }

  // CIBC: no header row — data starts on line 1.
  // Signature: 5 columns, col 5 matches masked card pattern (digits****digits)
  // Check multiple rows to be sure.
  const isCIBC = rows.slice(0, 5).every(row => {
    if (row.length < 5) return false;
    const cardCol = (row[4] || '').trim();
    return /^\d{4}\*{4,}\d{3,4}$/.test(cardCol);
  });
  if (isCIBC) return 'CIBC';

  return 'UNKNOWN';
}

// ── BANK-SPECIFIC NORMALIZERS ─────────────────────────────────────────────────

/**
 * RBC format (has header row):
 * EN: Account Number | Account Type | Transaction Date | Cheque Number | Description 1 | Description 2 | CAD$ | USD$
 * FR: Type de compte | Numéro du compte | Date de l'opération | Numéro du chèque | Description 1 | Description 2 | CAD$ | USD$
 * Note: FR column order differs — date is col 3 (index 2) in both, CAD$ is col 7 (index 6) in both.
 * Amounts are already signed (negative = debit, positive = credit).
 */
function normalizeRBC(rows) {
  const dataRows = rows.slice(1); // skip header
  return dataRows.map(row => {
    if (!row[2] || !row[6]) return null; // need date and CAD amount
    const date = normalizeDate(row[2]);
    const desc = [row[4], row[5]].filter(s => s && s.trim()).join(' — ').trim();
    const amount = parseFloat((row[6] || '0').replace(/[$,]/g, ''));
    if (isNaN(amount)) return null;
    return { date, description: desc || '(no description)', amount, account: 'RBC', ambiguous: false };
  }).filter(Boolean);
}

/**
 * BMO MC format:
 * EN: Item # | Card # | Transaction Date | Posting Date | Transaction Amount | Description
 * FR: Article no | Carte no | Date de la transaction | Date de l'inscription | Montant | Description
 * BMO French exports have a metadata line before the header ("Les données suivantes...").
 * Dates may be YYYYMMDD (no separators).
 * Amounts are positive for charges (debits) — negate them.
 * Credits (payments) appear as negative in BMO export — negate to make positive.
 */
function normalizeBMO(rows) {
  // Find the actual header row (skip metadata lines)
  let headerIdx = 0;
  for (let i = 0; i < Math.min(rows.length, 3); i++) {
    const rowStr = rows[i].map(c => (c || '').trim().toLowerCase()).join(',');
    if (rowStr.includes('item #') || rowStr.includes('card #') ||
        rowStr.includes('article no') || rowStr.includes('carte no')) {
      headerIdx = i;
      break;
    }
  }
  const dataRows = rows.slice(headerIdx + 1);
  return dataRows.map(row => {
    if (!row[2] || !row[4]) return null;
    const date = normalizeDate(row[2]);
    const desc = (row[5] || '').trim();
    const raw = parseFloat((row[4] || '0').replace(/[$,]/g, ''));
    if (isNaN(raw)) return null;
    // BMO exports charges as positive → negate for debit convention
    const amount = raw * -1;
    return { date, description: desc || '(no description)', amount, account: 'BMO MC', ambiguous: false };
  }).filter(Boolean);
}

/**
 * CIBC format (NO header row — data starts line 1):
 * Date | Description | Debit Amount | Credit Amount | Card Number
 * Debit amount present → negate (money out)
 * Credit amount present → keep positive (money in)
 * Card number in col 5 is the account identifier.
 */
function normalizeCIBC(rows) {
  return rows.map(row => {
    if (!row[0]) return null;
    const date = normalizeDate(row[0]);
    const desc = (row[1] || '').trim();
    const debit  = parseFloat((row[2] || '').replace(/[$,]/g, ''));
    const credit = parseFloat((row[3] || '').replace(/[$,]/g, ''));

    let amount;
    if (!isNaN(debit) && debit > 0) {
      amount = -debit;  // debit = money out = negative
    } else if (!isNaN(credit) && credit > 0) {
      amount = credit;  // credit = money in = positive
    } else {
      return null; // no usable amount
    }

    return { date, description: desc || '(no description)', amount, account: 'CIBC', ambiguous: false };
  }).filter(Boolean);
}

/**
 * Fallback for unrecognized CSV formats.
 * Stages rows as-is with ambiguous flag so user can review.
 */
function normalizeUnknown(rows) {
  return rows.map((row, i) => {
    if (i === 0) return null; // skip possible header
    const date = normalizeDate(row[0] || '');
    const desc = (row[1] || '').trim();
    const amount = parseFloat((row[2] || '0').replace(/[$,]/g, ''));
    return {
      date: date || '',
      description: desc || '(unknown)',
      amount: isNaN(amount) ? 0 : amount,
      account: 'UNKNOWN',
      ambiguous: true
    };
  }).filter(Boolean);
}

// ── SCREENSHOT FALLBACK ───────────────────────────────────────────────────────

/**
 * For unrecognized image files — calls Claude API to extract transactions via vision.
 * All three banks (RBC, BMO MC, CIBC) have CSV exports; this handles edge cases only.
 */
function processScreenshotFile(file) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
  if (!apiKey) {
    Logger.log('No Claude API key configured. Skipping screenshot: ' + file.getName());
    return null;
  }

  Logger.log('Processing screenshot via Claude vision: ' + file.getName());

  const imageBytes = file.getBlob().getBytes();
  const base64 = Utilities.base64Encode(imageBytes);
  const mimeType = file.getMimeType();

  const payload = {
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mimeType, data: base64 }
        },
        {
          type: 'text',
          text: 'This is a bank statement screenshot. Extract every transaction and return ONLY a JSON array. ' +
                'Each object must have exactly these fields: ' +
                '"date" (YYYY-MM-DD format), ' +
                '"description" (string), ' +
                '"amount" (number — negative for debits/charges, positive for deposits/credits), ' +
                '"account" (bank name if visible, otherwise "UNKNOWN"). ' +
                'Return only the JSON array, no explanation or markdown.'
        }
      ]
    }]
  };

  try {
    const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const result = JSON.parse(response.getContentText());
    if (result.error) {
      Logger.log('Claude API error: ' + JSON.stringify(result.error));
      return null;
    }

    const transactions = JSON.parse(result.content[0].text);
    if (!Array.isArray(transactions)) {
      Logger.log('Unexpected Claude response format for ' + file.getName());
      return null;
    }

    const normalized = transactions.map(t => ({
      date: normalizeDate(t.date || ''),
      description: (t.description || '').trim(),
      amount: parseFloat(t.amount) || 0,
      account: t.account || 'UNKNOWN',
      ambiguous: false,
      source: 'Screenshot Import'
    }));

    stageRows(normalized, file.getName());
    return normalized.length;

  } catch (err) {
    Logger.log('Screenshot processing failed for ' + file.getName() + ': ' + err.message);
    return null;
  }
}

// ── STAGING ───────────────────────────────────────────────────────────────────

/**
 * Write normalized transactions into the Import tab.
 * Columns: Date | Description | Amount | Account | Category | Transfer Type | Job | Duplicate? | Source | File
 */
function stageRows(transactions, filename) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('Import');
  if (!sh) {
    Logger.log('Import tab not found.');
    return;
  }

  // Drop transactions before 2026-01-01
  const before = transactions.length;
  transactions = transactions.filter(txn => {
    if (!txn.date) return false;
    return txn.date >= '2026-01-01';
  });
  const dropped = before - transactions.length;
  if (dropped > 0) Logger.log('Dropped ' + dropped + ' pre-2026 rows from ' + filename);
  if (transactions.length === 0) { Logger.log('No 2026 rows in ' + filename); return; }

  const lastRow = Math.max(sh.getLastRow(), 2); // never above header rows
  let insertRow = lastRow + 1;

  // Find true first empty row (skip any existing data)
  const colA = sh.getRange(3, 1, Math.max(sh.getMaxRows() - 2, 1), 1).getValues();
  let firstEmpty = 3;
  for (let i = 0; i < colA.length; i++) {
    if (colA[i][0] === '') { firstEmpty = 3 + i; break; }
    if (i === colA.length - 1) firstEmpty = 3 + i + 1;
  }
  insertRow = firstEmpty;

  transactions.forEach((txn, i) => {
    const row = insertRow + i;
    sh.getRange(row, 1).setValue(txn.date);
    sh.getRange(row, 2).setValue(txn.description);
    sh.getRange(row, 3).setValue(txn.amount).setNumberFormat('#,##0.00;(#,##0.00)');
    sh.getRange(row, 4).setValue(txn.account);
    // Cols 5, 6, 7 (Category, Transfer Type, Job) — left blank for manual review
    sh.getRange(row, 8).setFormula(
      `=IF(A${row}="","",IF(COUNTIFS(Transactions!A$2:A$2000,A${row},` +
      `Transactions!E$2:E$2000,C${row},Transactions!C$2:C$2000,D${row})>0,"⚠ DUPLICATE","✓"))`
    ).setFontColor('#cc0000');
    sh.getRange(row, 9).setValue(txn.source || 'Bank Import');
    sh.getRange(row, 10).setValue(filename);

    // Highlight ambiguous rows in yellow
    if (txn.ambiguous) {
      sh.getRange(row, 1, 1, 10).setBackground('#fff3cd');
    }
  });

  Logger.log('Staged ' + transactions.length + ' rows from ' + filename);
}

// ── PUSH TO TRANSACTIONS ──────────────────────────────────────────────────────

/**
 * Pushes reviewed Import rows to the Transactions tab.
 * Skips: duplicates, rows with no date, rows with no amount.
 * After push: marks rows as "Pushed" and grays them out.
 */
function pushStagedToTransactions() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const importSh = ss.getSheetByName('Import');
  const txnSh = ss.getSheetByName('Transactions');
  const ui = SpreadsheetApp.getUi();

  if (!importSh || !txnSh) {
    ui.alert('Cannot find Import or Transactions tab.');
    return;
  }

  const lastRow = importSh.getLastRow();
  if (lastRow < 3) {
    ui.alert('No staged rows to push.');
    return;
  }

  // Read all import rows (cols 1–10)
  const data = importSh.getRange(3, 1, lastRow - 2, 10).getValues();
  const dupFlags = importSh.getRange(3, 8, lastRow - 2, 1).getValues();

  let pushed = 0;
  let skipped = 0;

  data.forEach((row, i) => {
    const [date, desc, amount, account, category, transferType, job,, source] = row;
    const dupFlag = dupFlags[i][0];

    // Skip empty, already pushed, or duplicate rows
    if (!date || amount === '' || amount === 0) { skipped++; return; }
    if (String(dupFlag).includes('DUPLICATE')) { skipped++; return; }
    if (String(dupFlag).includes('Pushed')) { skipped++; return; }

    // Derive Month
    let month = '';
    try {
      const d = new Date(date);
      month = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM');
    } catch(e) { month = ''; }

    // Append to Transactions
    txnSh.appendRow([
      date, desc, account, '', amount,
      category || '', transferType || '', month, job || '',
      source || 'Bank Import'
    ]);

    // Mark as pushed in Import tab
    const importRow = 3 + i;
    importSh.getRange(importRow, 8).setValue('✓ Pushed');
    importSh.getRange(importRow, 1, 1, 10).setBackground('#e8e8e8').setFontColor('#999999');

    pushed++;
  });

  ui.alert(`Done.\n\n✓ Pushed: ${pushed} rows\n⏭ Skipped: ${skipped} rows (duplicates, empty, or already pushed)`);
}

// ── PROCESSED FILE TRACKING ───────────────────────────────────────────────────

function getProcessedFileIds() {
  const raw = PropertiesService.getScriptProperties().getProperty('PROCESSED_FILE_IDS') || '[]';
  return new Set(JSON.parse(raw));
}

function resetProcessedFiles() {
  PropertiesService.getScriptProperties().deleteProperty('PROCESSED_FILE_IDS');
  SpreadsheetApp.getUi().alert('Processed file cache cleared. Run "Check Bank Export Folder Now" to re-import.');
}

function markFileProcessed(fileId, fileName, rowCount) {
  const set = getProcessedFileIds();
  set.add(fileId);
  PropertiesService.getScriptProperties().setProperty(
    'PROCESSED_FILE_IDS', JSON.stringify([...set])
  );
  Logger.log(`Marked processed: ${fileName} (${rowCount} rows staged)`);
}

// ── DATE NORMALIZATION ────────────────────────────────────────────────────────

/**
 * Normalizes various date formats to YYYY-MM-DD.
 * RBC: MM/DD/YYYY or YYYY-MM-DD
 * BMO: YYYY-MM-DD
 * CIBC: YYYY-MM-DD (already correct)
 */
function normalizeDate(raw) {
  if (!raw) return '';
  const s = raw.toString().trim();

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // YYYYMMDD (BMO French export)
  if (/^\d{8}$/.test(s)) {
    return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
  }

  // MM/DD/YYYY (RBC sometimes)
  const mdyMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdyMatch) {
    return `${mdyMatch[3]}-${mdyMatch[1].padStart(2,'0')}-${mdyMatch[2].padStart(2,'0')}`;
  }

  // DD-Mon-YYYY (e.g. 31-Mar-2026)
  const dmonMatch = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (dmonMatch) {
    const months = {Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
                    Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
    const m = months[dmonMatch[2]];
    if (m) return `${dmonMatch[3]}-${m}-${dmonMatch[1].padStart(2,'0')}`;
  }

  // Let Google try
  try {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
    }
  } catch(e) {}

  return s; // return as-is if nothing works
}
