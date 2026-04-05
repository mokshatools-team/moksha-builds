/**
 * create-sheet.gs
 * OstéoPeinture 2026 Finance System
 *
 * Paste this entire file into Google Apps Script (script.google.com),
 * then click Run > createFinanceSheet2026.
 *
 * Creates a brand new spreadsheet with all tabs, headers, dropdowns,
 * and report formulas. Does NOT modify any existing sheet.
 */

function createFinanceSheet2026() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('Building into spreadsheet: ' + ss.getUrl());

  // ── Build tabs in order ───────────────────────────────────────────────────
  buildTransactions(ss);
  buildWages(ss);
  buildCategories(ss);
  buildAccounts(ss);
  buildMonthlyPL(ss);
  buildAccountBalances(ss);
  buildOwnerBalances(ss);
  buildPerJobPL(ss);
  buildGSTQST(ss);
  buildReconciliation(ss);
  buildDashboard(ss);
  buildImport(ss);

  // Remove default blank sheet
  const defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet) ss.deleteSheet(defaultSheet);

  Logger.log('✓ Done. Open: ' + ss.getUrl());
  SpreadsheetApp.getUi().alert('Sheet created!\n\n' + ss.getUrl());
}

// ── REFERENCE DATA ──────────────────────────────────────────────────────────

const ACCOUNTS = [
  'RBC',
  'BMO MC',
  'CIBC',
  'Cash',
  'Owner: Loric',
  'Owner: Graeme',
  'Owner: Lubo',
  'Owner: BOSS',
  'Loan: Alex',
  'Receivable: Client',
  'Receivable: OP',
  'Asset: Gear',
];

const CATEGORIES = [
  // Revenue
  'Contract Revenue',
  'Contract Deposits',
  // COGS
  'Supplies (Paint & Consumables)',
  'Labor Wages',
  // Operating Expenses
  'Accounting & Bank Charges',
  'Equipment Purchase',
  'Equipment Purchase (200$+)',
  'Equipment Rentals',
  'Gas & Transportation - Casual rental',
  'Gas & Transportation - Communauto',
  'Interest charges on Loan',
  'Legal Fees',
  'Legal Fees - Insurances',
  'Legal Fees - Licences, Permits',
  'Legal Fees - REQ',
  'Losses & Other',
  'Office Supplies',
  'S&M — Ads',
  'S&M — Clothing',
  'S&M — Promotional Material',
  'S&M — Website',
  'Sales & Marketing',
  'Storage Rental',
  'Tax',
  'Trainings',
  'Van - Entretien',
  'Van - Gas',
  'Van - General',
  'Van - Nettoyage',
  'Van - Plate, insurances and licenses',
  'Dividends',
  'Depreciation',
  // Transfer (excluded from P&L)
  'Transfer',
];

const TRANSFER_TYPES = [
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

const SOURCES = ['Bank Import', 'Manual', 'Wages'];

// Super Group → Group → Category mapping (for P&L grouping)
const CATEGORY_HIERARCHY = [
  // [SuperGroup, Group, Category]
  ['Revenue', 'Revenue', 'Contract Revenue'],
  ['Revenue', 'Revenue', 'Contract Deposits'],
  ['COGS', 'Direct Costs', 'Supplies (Paint & Consumables)'],
  ['COGS', 'Direct Costs', 'Labor Wages'],
  ['COGS', 'Direct Costs', 'Equipment Rentals'],
  ['Expenses', 'Vehicle', 'Van - Gas'],
  ['Expenses', 'Vehicle', 'Van - Entretien'],
  ['Expenses', 'Vehicle', 'Van - Nettoyage'],
  ['Expenses', 'Vehicle', 'Van - General'],
  ['Expenses', 'Vehicle', 'Van - Plate, insurances and licenses'],
  ['Expenses', 'Transportation', 'Gas & Transportation - Casual rental'],
  ['Expenses', 'Transportation', 'Gas & Transportation - Communauto'],
  ['Expenses', 'Equipment', 'Equipment Purchase'],
  ['Expenses', 'Equipment', 'Equipment Purchase (200$+)'],
  ['Expenses', 'Equipment', 'Depreciation'],
  ['Expenses', 'Sales & Marketing', 'S&M — Ads'],
  ['Expenses', 'Sales & Marketing', 'S&M — Website'],
  ['Expenses', 'Sales & Marketing', 'S&M — Clothing'],
  ['Expenses', 'Sales & Marketing', 'S&M — Promotional Material'],
  ['Expenses', 'Sales & Marketing', 'Sales & Marketing'],
  ['Expenses', 'Legal & Admin', 'Legal Fees'],
  ['Expenses', 'Legal & Admin', 'Legal Fees - REQ'],
  ['Expenses', 'Legal & Admin', 'Legal Fees - Insurances'],
  ['Expenses', 'Legal & Admin', 'Legal Fees - Licences, Permits'],
  ['Expenses', 'Legal & Admin', 'Accounting & Bank Charges'],
  ['Expenses', 'Legal & Admin', 'Office Supplies'],
  ['Expenses', 'Legal & Admin', 'Trainings'],
  ['Expenses', 'Legal & Admin', 'Storage Rental'],
  ['Expenses', 'Other', 'Tax'],
  ['Expenses', 'Other', 'Losses & Other'],
  ['Expenses', 'Other', 'Interest charges on Loan'],
  ['Expenses', 'Other', 'Dividends'],
];

// ITC-eligible categories (can claim GST/QST input tax credits)
const ITC_ELIGIBLE = [
  'Supplies (Paint & Consumables)',
  'Equipment Rentals',
  'Equipment Purchase',
  'Equipment Purchase (200$+)',
  'Gas & Transportation - Casual rental',
  'Gas & Transportation - Communauto',
  'Van - Gas',
  'Van - Entretien',
  'Van - General',
  'Van - Nettoyage',
  'Van - Plate, insurances and licenses',
  'S&M — Ads',
  'S&M — Website',
  'S&M — Clothing',
  'S&M — Promotional Material',
  'Sales & Marketing',
  'Accounting & Bank Charges',
  'Office Supplies',
  'Storage Rental',
  'Legal Fees',
  'Legal Fees - Insurances',
  'Legal Fees - Licences, Permits',
  'Legal Fees - REQ',
];

// ── TAB BUILDERS ─────────────────────────────────────────────────────────────

function buildTransactions(ss) {
  const sh = ss.insertSheet('Transactions');
  sh.setFrozenRows(1);

  const headers = ['Date', 'Description', 'Account', 'Counterpart', 'Amount',
                   'Category', 'Transfer Type', 'Month', 'Job', 'Source'];
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold')
    .setBackground('#1a1a2e')
    .setFontColor('#ffffff');

  // Column widths
  sh.setColumnWidth(1, 100); // Date
  sh.setColumnWidth(2, 280); // Description
  sh.setColumnWidth(3, 130); // Account
  sh.setColumnWidth(4, 130); // Counterpart
  sh.setColumnWidth(5, 100); // Amount
  sh.setColumnWidth(6, 220); // Category
  sh.setColumnWidth(7, 160); // Transfer Type
  sh.setColumnWidth(8, 80);  // Month
  sh.setColumnWidth(9, 100); // Job
  sh.setColumnWidth(10, 110); // Source

  // Data validation dropdowns (rows 2–2000)
  const maxRows = 2000;
  const accountRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(ACCOUNTS, true).build();
  const categoryRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(CATEGORIES, true).build();
  const transferRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(TRANSFER_TYPES, true).build();
  const sourceRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(SOURCES, true).build();

  sh.getRange(2, 3, maxRows, 1).setDataValidation(accountRule);
  sh.getRange(2, 4, maxRows, 1).setDataValidation(accountRule);
  sh.getRange(2, 6, maxRows, 1).setDataValidation(categoryRule);
  sh.getRange(2, 7, maxRows, 1).setDataValidation(transferRule);
  sh.getRange(2, 10, maxRows, 1).setDataValidation(sourceRule);

  // Month auto-formula in col 8 (formula only; filled by script when rows added)
  // We'll leave it blank and let the cash entry sidebar / import script fill it.
  // Manual note: =TEXT(A2,"YYYY-MM")

  // Amount column: number format
  sh.getRange(2, 5, maxRows, 1).setNumberFormat('#,##0.00;(#,##0.00)');
  // Date column: date format
  sh.getRange(2, 1, maxRows, 1).setNumberFormat('yyyy-mm-dd');

  // Alternate row shading
  const rule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=MOD(ROW(),2)=0')
    .setBackground('#f5f5f5')
    .setRanges([sh.getRange(2, 1, maxRows, headers.length)])
    .build();
  sh.setConditionalFormatRules([rule]);
}

function buildWages(ss) {
  const sh = ss.insertSheet('Wages');
  sh.setFrozenRows(1);

  const headers = ['Date', 'Worker', 'Job', 'Hours', 'Rate', 'Total',
                   'Payment Method', 'Paid', 'Balance Owed', 'Notes'];
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold')
    .setBackground('#1a1a2e')
    .setFontColor('#ffffff');

  sh.setColumnWidth(1, 100);
  sh.setColumnWidth(2, 130);
  sh.setColumnWidth(3, 110);
  sh.setColumnWidth(4, 70);
  sh.setColumnWidth(5, 80);
  sh.setColumnWidth(6, 90);
  sh.setColumnWidth(7, 130);
  sh.setColumnWidth(8, 90);
  sh.setColumnWidth(9, 110);
  sh.setColumnWidth(10, 200);

  // Total = Hours × Rate
  // These formulas will be in col 6 starting row 2
  const maxRows = 500;
  for (let i = 2; i <= maxRows; i++) {
    sh.getRange(i, 6).setFormula(`=IF(D${i}="","",D${i}*E${i})`);
    sh.getRange(i, 9).setFormula(`=IF(F${i}="","",F${i}-H${i})`);
  }

  const pmRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Cash', 'E-transfer'], true).build();
  sh.getRange(2, 7, maxRows, 1).setDataValidation(pmRule);

  sh.getRange(2, 4, maxRows, 1).setNumberFormat('0.00');
  sh.getRange(2, 5, maxRows, 3).setNumberFormat('#,##0.00');
  sh.getRange(2, 8, maxRows, 2).setNumberFormat('#,##0.00');
  sh.getRange(2, 1, maxRows, 1).setNumberFormat('yyyy-mm-dd');
}

function buildCategories(ss) {
  const sh = ss.insertSheet('Categories');
  sh.setFrozenRows(1);

  const headers = ['Category', 'Group', 'Super Group', 'ITC Eligible (Y/N)'];
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold')
    .setBackground('#1a1a2e')
    .setFontColor('#ffffff');

  sh.setColumnWidth(1, 240);
  sh.setColumnWidth(2, 160);
  sh.setColumnWidth(3, 130);
  sh.setColumnWidth(4, 150);

  const rows = CATEGORY_HIERARCHY.map(([sg, g, cat]) => [
    cat, g, sg, ITC_ELIGIBLE.includes(cat) ? 'Y' : 'N'
  ]);
  // Add Transfer (not in hierarchy)
  rows.push(['Transfer', 'Transfer', 'Transfer', 'N']);

  sh.getRange(2, 1, rows.length, 4).setValues(rows);

  const itcRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Y', 'N'], true).build();
  sh.getRange(2, 4, rows.length, 1).setDataValidation(itcRule);
}

function buildAccounts(ss) {
  const sh = ss.insertSheet('Accounts');
  sh.setFrozenRows(1);

  const headers = ['Account', 'Type', 'Opening Balance', 'Notes'];
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold')
    .setBackground('#1a1a2e')
    .setFontColor('#ffffff');

  sh.setColumnWidth(1, 160);
  sh.setColumnWidth(2, 130);
  sh.setColumnWidth(3, 140);
  sh.setColumnWidth(4, 250);

  const accountData = [
    ['RBC', 'Bank', '', 'Primary business account'],
    ['BMO MC', 'Credit Card', '', 'Business credit card'],
    ['CIBC', 'Bank', '', 'Secondary business account'],
    ['Cash', 'Cash', '', 'Physical cash on hand'],
    ['Owner: Loric', 'Owner', '', 'Negative = company owes Loric'],
    ['Owner: Graeme', 'Owner', '', 'Negative = company owes Graeme'],
    ['Owner: Lubo', 'Owner', '', 'Negative = company owes Lubo'],
    ['Owner: BOSS', 'Owner', '', 'Negative = company owes BOSS'],
    ['Loan: Alex', 'Loan', '', ''],
    ['Receivable: Client', 'Receivable', '', 'Invoiced but not yet paid'],
    ['Receivable: OP', 'Receivable', '', 'Internal OP receivable'],
    ['Asset: Gear', 'Asset', '', 'Equipment and tools'],
  ];

  sh.getRange(2, 1, accountData.length, 4).setValues(accountData);
  sh.getRange(2, 3, accountData.length, 1).setNumberFormat('#,##0.00;(#,##0.00)');

  sh.getRange(2, 1, accountData.length, 4)
    .setNote('Opening Balance: enter 2025-12-31 closing figure for each account as a Transactions row (Category=Transfer, Transfer Type=Opening Balance), then this column auto-updates via Account Balances tab.');
}

function buildMonthlyPL(ss) {
  const sh = ss.insertSheet('Monthly P&L');
  sh.setFrozenRows(3);
  sh.setFrozenColumns(3);

  // Header rows
  sh.getRange(1, 1).setValue('Monthly P&L — 2026').setFontWeight('bold').setFontSize(13);
  sh.getRange(2, 1).setValue('Excludes transfers. Positive = revenue/surplus, Negative = cost/loss.')
    .setFontColor('#666666');

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','YTD'];
  sh.getRange(3, 1).setValue('Super Group').setFontWeight('bold');
  sh.getRange(3, 2).setValue('Group').setFontWeight('bold');
  sh.getRange(3, 3).setValue('Category').setFontWeight('bold');
  for (let i = 0; i < months.length; i++) {
    sh.getRange(3, 4 + i).setValue(months[i]).setFontWeight('bold').setHorizontalAlignment('right');
  }

  sh.getRange(3, 1, 1, 16).setBackground('#1a1a2e').setFontColor('#ffffff');

  // Data rows — one per category in hierarchy order
  let row = 4;
  const catRows = {}; // category -> row number (for formula reference)

  CATEGORY_HIERARCHY.forEach(([sg, g, cat]) => {
    sh.getRange(row, 1).setValue(sg);
    sh.getRange(row, 2).setValue(g);
    sh.getRange(row, 3).setValue(cat);

    for (let m = 0; m < 12; m++) {
      const monthStr = `2026-${String(m + 1).padStart(2, '0')}`;
      const formula = `=IFERROR(SUMPRODUCT((Transactions!F$2:F$2000="${cat}")*(Transactions!H$2:H$2000="${monthStr}")*(Transactions!E$2:E$2000)),0)`;
      sh.getRange(row, 4 + m).setFormula(formula).setNumberFormat('#,##0.00;(#,##0.00)');
    }
    // YTD
    sh.getRange(row, 16).setFormula(`=SUM(D${row}:O${row})`).setNumberFormat('#,##0.00;(#,##0.00)');

    catRows[cat] = row;
    row++;
  });

  // Gross Profit row
  sh.getRange(row, 3).setValue('── Gross Profit ──').setFontWeight('bold').setFontStyle('italic');
  for (let m = 0; m < 12; m++) {
    const col = 4 + m;
    const colLetter = columnToLetter(col);
    const revenueRows = CATEGORY_HIERARCHY
      .filter(([sg]) => sg === 'Revenue')
      .map(([,, cat]) => catRows[cat])
      .map(r => `${colLetter}${r}`).join('+');
    const cogsRows = CATEGORY_HIERARCHY
      .filter(([sg]) => sg === 'COGS')
      .map(([,, cat]) => catRows[cat])
      .map(r => `${colLetter}${r}`).join('+');
    sh.getRange(row, col).setFormula(`=${revenueRows}+${cogsRows}`)
      .setNumberFormat('#,##0.00;(#,##0.00)').setFontWeight('bold');
  }
  sh.getRange(row, 16).setFormula(`=SUM(D${row}:O${row})`).setNumberFormat('#,##0.00;(#,##0.00)').setFontWeight('bold');
  sh.getRange(row, 1, 1, 16).setBackground('#e8f4f8');
  row++;

  // Net Income row
  sh.getRange(row, 3).setValue('── Net Income ──').setFontWeight('bold').setFontStyle('italic');
  for (let m = 0; m < 12; m++) {
    const col = 4 + m;
    const colLetter = columnToLetter(col);
    const allRows = CATEGORY_HIERARCHY
      .map(([,, cat]) => catRows[cat])
      .map(r => `${colLetter}${r}`).join('+');
    sh.getRange(row, col).setFormula(`=${allRows}`)
      .setNumberFormat('#,##0.00;(#,##0.00)').setFontWeight('bold');
  }
  sh.getRange(row, 16).setFormula(`=SUM(D${row}:O${row})`).setNumberFormat('#,##0.00;(#,##0.00)').setFontWeight('bold');
  sh.getRange(row, 1, 1, 16).setBackground('#d4edda');

  sh.setColumnWidth(1, 120);
  sh.setColumnWidth(2, 160);
  sh.setColumnWidth(3, 240);
  for (let i = 4; i <= 16; i++) sh.setColumnWidth(i, 90);
}

function buildAccountBalances(ss) {
  const sh = ss.insertSheet('Account Balances');
  sh.setFrozenRows(2);

  sh.getRange(1, 1).setValue('Account Balances — 2026').setFontWeight('bold').setFontSize(13);

  const headers = ['Account', 'Type', 'Balance', 'Last Transaction'];
  sh.getRange(2, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#ffffff');

  const accountTypes = {
    'RBC': 'Bank', 'BMO MC': 'Credit Card', 'CIBC': 'Bank', 'Cash': 'Cash',
    'Owner: Loric': 'Owner', 'Owner: Graeme': 'Owner', 'Owner: Lubo': 'Owner', 'Owner: BOSS': 'Owner',
    'Loan: Alex': 'Loan', 'Receivable: Client': 'Receivable',
    'Receivable: OP': 'Receivable', 'Asset: Gear': 'Asset',
  };

  ACCOUNTS.forEach((acct, i) => {
    const row = 3 + i;
    sh.getRange(row, 1).setValue(acct);
    sh.getRange(row, 2).setValue(accountTypes[acct] || '');
    sh.getRange(row, 3).setFormula(
      `=IFERROR(SUMIF(Transactions!C$2:C$2000,"${acct}",Transactions!E$2:E$2000),0)`
    ).setNumberFormat('#,##0.00;(#,##0.00)');
    sh.getRange(row, 4).setFormula(
      `=IFERROR(TEXT(MAXIFS(Transactions!A$2:A$2000,Transactions!C$2:C$2000,"${acct}"),"yyyy-mm-dd"),"-")`
    );
  });

  sh.setColumnWidth(1, 160);
  sh.setColumnWidth(2, 130);
  sh.setColumnWidth(3, 130);
  sh.setColumnWidth(4, 140);

  // Alternate shading
  ACCOUNTS.forEach((_, i) => {
    if (i % 2 === 0) sh.getRange(3 + i, 1, 1, 4).setBackground('#f5f5f5');
  });
}

function buildOwnerBalances(ss) {
  const sh = ss.insertSheet('Owner Balances');
  sh.setFrozenRows(2);

  sh.getRange(1, 1).setValue('Owner Balances — 2026').setFontWeight('bold').setFontSize(13);
  sh.getRange(1, 3).setValue('Negative = company owes that owner').setFontColor('#666666');

  const headers = ['Owner', 'Advances Paid (YTD)', 'Profit Allocated (YTD)', 'Net Balance'];
  sh.getRange(2, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#ffffff');

  ['Loric', 'Graeme', 'Lubo', 'BOSS'].forEach((owner, i) => {
    const row = 3 + i;
    const acct = `Owner: ${owner}`;
    sh.getRange(row, 1).setValue(owner);
    sh.getRange(row, 2).setFormula(
      `=IFERROR(SUMPRODUCT((Transactions!C$2:C$2000="${acct}")*(Transactions!G$2:G$2000="Owner Advance")*(Transactions!E$2:E$2000)),0)`
    ).setNumberFormat('#,##0.00;(#,##0.00)');
    sh.getRange(row, 3).setFormula(
      `=IFERROR(SUMPRODUCT((Transactions!C$2:C$2000="${acct}")*(Transactions!G$2:G$2000="Owner Payment")*(Transactions!E$2:E$2000)),0)`
    ).setNumberFormat('#,##0.00;(#,##0.00)');
    sh.getRange(row, 4).setFormula(`=SUMIF(Transactions!C$2:C$2000,"${acct}",Transactions!E$2:E$2000)`)
      .setNumberFormat('#,##0.00;(#,##0.00)').setFontWeight('bold');
  });

  sh.setColumnWidth(1, 120);
  sh.setColumnWidth(2, 180);
  sh.setColumnWidth(3, 180);
  sh.setColumnWidth(4, 140);
}

function buildPerJobPL(ss) {
  const sh = ss.insertSheet('Per-Job P&L');
  sh.setFrozenRows(2);

  sh.getRange(1, 1).setValue('Per-Job P&L — 2026').setFontWeight('bold').setFontSize(13);
  sh.getRange(1, 3).setValue('Only rows with a Job code. Add job codes to Transactions!I column.')
    .setFontColor('#666666');

  const headers = ['Job', 'Revenue', 'Labor (Wages)', 'Direct Expenses', 'Net'];
  sh.getRange(2, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#ffffff');

  sh.getRange(3, 1).setValue('(Jobs appear automatically as you tag transactions)');
  sh.getRange(3, 1).setFontColor('#999999').setFontStyle('italic');

  // Dynamic job list pulled from Transactions
  sh.getRange(3, 1).setFormula(
    '=IFERROR(UNIQUE(FILTER(Transactions!I$2:I$2000,Transactions!I$2:I$2000<>"")),"")'
  );

  // These formulas reference col A dynamically
  for (let row = 3; row <= 100; row++) {
    sh.getRange(row, 2).setFormula(
      `=IF(A${row}="","",IFERROR(SUMPRODUCT((Transactions!I$2:I$2000=A${row})*(Transactions!F$2:F$2000="Contract Revenue")*(Transactions!E$2:E$2000)),0))`
    ).setNumberFormat('#,##0.00;(#,##0.00)');
    sh.getRange(row, 3).setFormula(
      `=IF(A${row}="","",IFERROR(SUMIF(Wages!C$2:C$500,A${row},Wages!F$2:F$500)*-1,0))`
    ).setNumberFormat('#,##0.00;(#,##0.00)');
    sh.getRange(row, 4).setFormula(
      `=IF(A${row}="","",IFERROR(SUMPRODUCT((Transactions!I$2:I$2000=A${row})*(Transactions!F$2:F$2000<>"Contract Revenue")*(Transactions!F$2:F$2000<>"Transfer")*(Transactions!E$2:E$2000)),0))`
    ).setNumberFormat('#,##0.00;(#,##0.00)');
    sh.getRange(row, 5).setFormula(
      `=IF(A${row}="","",B${row}+C${row}+D${row})`
    ).setNumberFormat('#,##0.00;(#,##0.00)').setFontWeight('bold');
  }

  sh.setColumnWidth(1, 120);
  for (let i = 2; i <= 5; i++) sh.setColumnWidth(i, 150);
}

function buildGSTQST(ss) {
  const sh = ss.insertSheet('GST/QST Tracker');
  sh.setFrozenRows(3);

  sh.getRange(1, 1).setValue('GST/QST Tracker — 2026').setFontWeight('bold').setFontSize(13);
  sh.getRange(2, 1).setValue('GST 5% · QST 9.975% · Annual filing · Confirm ITC eligibility with accountant')
    .setFontColor('#666666');

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Annual'];
  sh.getRange(3, 1).setValue('').setFontWeight('bold');
  for (let i = 0; i < months.length; i++) {
    sh.getRange(3, 2 + i).setValue(months[i]).setFontWeight('bold').setHorizontalAlignment('right');
  }
  sh.getRange(3, 1, 1, 15).setBackground('#1a1a2e').setFontColor('#ffffff');

  const taxRows = [
    { label: 'Taxable Revenue', formula: (monthStr) =>
      `=IFERROR(SUMPRODUCT((Transactions!F$2:F$2000="Contract Revenue")*(Transactions!H$2:H$2000="${monthStr}")*(Transactions!E$2:E$2000)),0)` },
    { label: 'GST Collected (5%)', formula: (monthStr, revRow) =>
      `=${columnToLetter(2 + months.indexOf(monthStr.slice(5, 8).replace(/^0/, match => match)))}${revRow}*0.05` },
    { label: 'QST Collected (9.975%)', formula: (monthStr, revRow) =>
      `=${columnToLetter(2 + months.indexOf(monthStr.slice(5, 8).replace(/^0/, match => match)))}${revRow}*0.09975` },
    { label: '── ITC-Eligible Expenses', formula: () => '' },
    { label: 'GST Paid on Expenses (ITC)', formula: (monthStr) =>
      `=IFERROR(SUMPRODUCT((ISNUMBER(MATCH(Transactions!F$2:F$2000,Categories!A$2:A$100,0)))*(VLOOKUP(Transactions!F$2:F$2000,Categories!A$2:D$100,4,0)="Y")*(Transactions!H$2:H$2000="${monthStr}")*(Transactions!E$2:E$2000))*-0.05,0)` },
    { label: 'QST Paid on Expenses (ITC)', formula: (monthStr) =>
      `=IFERROR(SUMPRODUCT((ISNUMBER(MATCH(Transactions!F$2:F$2000,Categories!A$2:A$100,0)))*(VLOOKUP(Transactions!F$2:F$2000,Categories!A$2:D$100,4,0)="Y")*(Transactions!H$2:H$2000="${monthStr}")*(Transactions!E$2:E$2000))*-0.09975,0)` },
    { label: '── Net Remittance', formula: () => '' },
    { label: 'GST Net Owing', formula: () => '' },
    { label: 'QST Net Owing', formula: () => '' },
  ];

  let dataRow = 4;
  const rowMap = {};

  taxRows.forEach((tr, idx) => {
    sh.getRange(dataRow, 1).setValue(tr.label).setFontWeight(
      tr.label.startsWith('──') ? 'bold' : 'normal'
    );
    if (tr.label.startsWith('──')) {
      sh.getRange(dataRow, 1, 1, 15).setBackground('#e8f4f8');
    }
    rowMap[tr.label] = dataRow;
    dataRow++;
  });

  // Fill in monthly formulas for simple rows
  const simpleRows = ['Taxable Revenue', 'GST Collected (5%)', 'QST Collected (9.975%)',
                       'GST Paid on Expenses (ITC)', 'QST Paid on Expenses (ITC)'];

  simpleRows.forEach(label => {
    const row = rowMap[label];
    for (let m = 0; m < 12; m++) {
      const monthStr = `2026-${String(m + 1).padStart(2, '0')}`;
      let formula;
      if (label === 'Taxable Revenue') {
        formula = `=IFERROR(SUMPRODUCT((Transactions!F$2:F$2000="Contract Revenue")*(Transactions!H$2:H$2000="${monthStr}")*(Transactions!E$2:E$2000)),0)`;
      } else if (label === 'GST Collected (5%)') {
        formula = `=${columnToLetter(2 + m)}${rowMap['Taxable Revenue']}*0.05`;
      } else if (label === 'QST Collected (9.975%)') {
        formula = `=${columnToLetter(2 + m)}${rowMap['Taxable Revenue']}*0.09975`;
      } else if (label === 'GST Paid on Expenses (ITC)') {
        formula = `=IFERROR(SUMPRODUCT((COUNTIFS(Categories!A$2:A$100,Transactions!F$2:F$2000,Categories!D$2:D$100,"Y")>0)*(Transactions!H$2:H$2000="${monthStr}")*(Transactions!E$2:E$2000)*-1)*0.05,0)`;
      } else if (label === 'QST Paid on Expenses (ITC)') {
        formula = `=IFERROR(SUMPRODUCT((COUNTIFS(Categories!A$2:A$100,Transactions!F$2:F$2000,Categories!D$2:D$100,"Y")>0)*(Transactions!H$2:H$2000="${monthStr}")*(Transactions!E$2:E$2000)*-1)*0.09975,0)`;
      }
      sh.getRange(row, 2 + m).setFormula(formula).setNumberFormat('#,##0.00');
    }
    // Annual
    sh.getRange(row, 14).setFormula(`=SUM(B${row}:M${row})`).setNumberFormat('#,##0.00').setFontWeight('bold');
  });

  // Net owing rows
  const gstNetRow = rowMap['GST Net Owing'];
  const qstNetRow = rowMap['QST Net Owing'];
  for (let m = 0; m < 12; m++) {
    const col = columnToLetter(2 + m);
    sh.getRange(gstNetRow, 2 + m)
      .setFormula(`=${col}${rowMap['GST Collected (5%)']}-${col}${rowMap['GST Paid on Expenses (ITC)']}`)
      .setNumberFormat('#,##0.00').setFontWeight('bold');
    sh.getRange(qstNetRow, 2 + m)
      .setFormula(`=${col}${rowMap['QST Collected (9.975%)']}-${col}${rowMap['QST Paid on Expenses (ITC)']}`)
      .setNumberFormat('#,##0.00').setFontWeight('bold');
  }
  sh.getRange(gstNetRow, 14).setFormula(`=SUM(B${gstNetRow}:M${gstNetRow})`).setNumberFormat('#,##0.00').setFontWeight('bold');
  sh.getRange(qstNetRow, 14).setFormula(`=SUM(B${qstNetRow}:M${qstNetRow})`).setNumberFormat('#,##0.00').setFontWeight('bold');
  sh.getRange(gstNetRow, 1, 1, 15).setBackground('#d4edda');
  sh.getRange(qstNetRow, 1, 1, 15).setBackground('#d4edda');

  sh.setColumnWidth(1, 240);
  for (let i = 2; i <= 15; i++) sh.setColumnWidth(i, 90);
}

function buildReconciliation(ss) {
  const sh = ss.insertSheet('Reconciliation');
  sh.setFrozenRows(2);

  sh.getRange(1, 1).setValue('Reconciliation — 2026').setFontWeight('bold').setFontSize(13);
  sh.getRange(1, 4).setValue('Enter actual bank balances in column C monthly')
    .setFontColor('#666666');

  const headers = ['Account', 'Ledger Balance', 'Actual Bank Balance', 'Difference', 'Status'];
  sh.getRange(2, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#ffffff');

  const bankAccounts = ['RBC', 'BMO MC', 'CIBC', 'Cash'];
  bankAccounts.forEach((acct, i) => {
    const row = 3 + i;
    sh.getRange(row, 1).setValue(acct);
    sh.getRange(row, 2).setFormula(
      `=IFERROR(SUMIF(Transactions!C$2:C$2000,"${acct}",Transactions!E$2:E$2000),0)`
    ).setNumberFormat('#,##0.00;(#,##0.00)');
    sh.getRange(row, 3).setValue('').setNumberFormat('#,##0.00;(#,##0.00)')
      .setNote('Enter actual balance from bank statement here');
    sh.getRange(row, 4).setFormula(`=IF(C${row}="","",C${row}-B${row})`)
      .setNumberFormat('#,##0.00;(#,##0.00)');
    sh.getRange(row, 5).setFormula(
      `=IF(C${row}="","–",IF(ABS(D${row})<0.01,"✓ Reconciled","⚠ Discrepancy"))`
    );
  });

  sh.setColumnWidth(1, 130);
  sh.setColumnWidth(2, 150);
  sh.setColumnWidth(3, 160);
  sh.setColumnWidth(4, 120);
  sh.setColumnWidth(5, 130);
}

function buildDashboard(ss) {
  const sh = ss.insertSheet('Dashboard');

  sh.getRange(1, 1).setValue('OstéoPeinture — 2026 Dashboard')
    .setFontWeight('bold').setFontSize(16);
  sh.getRange(2, 1).setValue('Live summary — updates automatically as Transactions are entered')
    .setFontColor('#666666');

  // Current month label
  sh.getRange(4, 1).setValue('Current Month').setFontWeight('bold');
  sh.getRange(4, 2).setFormula('=TEXT(TODAY(),"MMMM YYYY")');

  // Bank balances section
  sh.getRange(6, 1).setValue('BANK BALANCES').setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#ffffff');
  sh.getRange(6, 2).setValue('Balance').setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#ffffff');

  ['RBC', 'BMO MC', 'CIBC', 'Cash'].forEach((acct, i) => {
    sh.getRange(7 + i, 1).setValue(acct);
    sh.getRange(7 + i, 2).setFormula(
      `=IFERROR(SUMIF(Transactions!C$2:C$2000,"${acct}",Transactions!E$2:E$2000),0)`
    ).setNumberFormat('#,##0.00;(#,##0.00)');
  });

  // Owner balances section
  sh.getRange(6, 4).setValue('OWNER BALANCES').setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#ffffff');
  sh.getRange(6, 5).setValue('Balance').setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#ffffff');
  sh.getRange(6, 6).setValue('(neg = owed to owner)').setFontColor('#666666');

  ['Loric', 'Graeme', 'Lubo', 'BOSS'].forEach((owner, i) => {
    sh.getRange(7 + i, 4).setValue(owner);
    sh.getRange(7 + i, 5).setFormula(
      `=IFERROR(SUMIF(Transactions!C$2:C$2000,"Owner: ${owner}",Transactions!E$2:E$2000),0)`
    ).setNumberFormat('#,##0.00;(#,##0.00)');
  });

  // YTD P&L section
  sh.getRange(12, 1).setValue('YTD P&L').setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#ffffff');
  sh.getRange(12, 2).setValue('Amount').setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#ffffff');

  sh.getRange(13, 1).setValue('Revenue');
  sh.getRange(13, 2).setFormula(
    '=IFERROR(SUMIF(Transactions!F$2:F$2000,"Contract Revenue",Transactions!E$2:E$2000),0)'
  ).setNumberFormat('#,##0.00;(#,##0.00)');

  sh.getRange(14, 1).setValue('Total Expenses');
  sh.getRange(14, 2).setFormula(
    '=IFERROR(SUMPRODUCT((Transactions!F$2:F$2000<>"Transfer")*(Transactions!F$2:F$2000<>"Contract Revenue")*(Transactions!F$2:F$2000<>"Contract Deposits")*(Transactions!E$2:E$2000)),0)'
  ).setNumberFormat('#,##0.00;(#,##0.00)');

  sh.getRange(15, 1).setValue('Net Income').setFontWeight('bold');
  sh.getRange(15, 2).setFormula('=B13+B14').setNumberFormat('#,##0.00;(#,##0.00)').setFontWeight('bold');

  // Current month P&L
  sh.getRange(12, 4).setValue('THIS MONTH').setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#ffffff');
  sh.getRange(12, 5).setValue('Amount').setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#ffffff');

  sh.getRange(13, 4).setValue('Revenue');
  sh.getRange(13, 5).setFormula(
    '=IFERROR(SUMPRODUCT((Transactions!F$2:F$2000="Contract Revenue")*(Transactions!H$2:H$2000=TEXT(TODAY(),"YYYY-MM"))*(Transactions!E$2:E$2000)),0)'
  ).setNumberFormat('#,##0.00;(#,##0.00)');

  sh.getRange(14, 4).setValue('Expenses');
  sh.getRange(14, 5).setFormula(
    '=IFERROR(SUMPRODUCT((Transactions!F$2:F$2000<>"Transfer")*(Transactions!F$2:F$2000<>"Contract Revenue")*(Transactions!F$2:F$2000<>"Contract Deposits")*(Transactions!H$2:H$2000=TEXT(TODAY(),"YYYY-MM"))*(Transactions!E$2:E$2000)),0)'
  ).setNumberFormat('#,##0.00;(#,##0.00)');

  sh.getRange(15, 4).setValue('Net').setFontWeight('bold');
  sh.getRange(15, 5).setFormula('=E13+E14').setNumberFormat('#,##0.00;(#,##0.00)').setFontWeight('bold');

  sh.setColumnWidth(1, 160);
  sh.setColumnWidth(2, 130);
  sh.setColumnWidth(3, 40);
  sh.setColumnWidth(4, 160);
  sh.setColumnWidth(5, 130);
  sh.setColumnWidth(6, 200);
}

function buildImport(ss) {
  const sh = ss.insertSheet('Import');
  sh.setFrozenRows(2);

  sh.getRange(1, 1).setValue('Import Staging — Bank CSV').setFontWeight('bold').setFontSize(13);
  sh.getRange(1, 5).setValue('Paste CSV data below. Review, assign categories, then click "Push to Transactions".')
    .setFontColor('#666666');

  const headers = ['Date', 'Description', 'Amount', 'Account (auto)', 'Category', 'Transfer Type', 'Job', 'Duplicate?'];
  sh.getRange(2, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#374151').setFontColor('#ffffff');

  // Duplicate check formula
  for (let row = 3; row <= 200; row++) {
    sh.getRange(row, 8).setFormula(
      `=IF(A${row}="","",IF(COUNTIFS(Transactions!A$2:A$2000,A${row},Transactions!E$2:E$2000,C${row},Transactions!C$2:C$2000,D${row})>0,"⚠ DUPLICATE",""))`
    ).setFontColor('#cc0000');
  }

  const categoryRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(CATEGORIES, true).build();
  const transferRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(TRANSFER_TYPES, true).build();
  const accountRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(ACCOUNTS, true).build();

  sh.getRange(3, 4, 198, 1).setDataValidation(accountRule);
  sh.getRange(3, 5, 198, 1).setDataValidation(categoryRule);
  sh.getRange(3, 6, 198, 1).setDataValidation(transferRule);

  sh.setColumnWidth(1, 100);
  sh.setColumnWidth(2, 300);
  sh.setColumnWidth(3, 110);
  sh.setColumnWidth(4, 130);
  sh.setColumnWidth(5, 220);
  sh.setColumnWidth(6, 160);
  sh.setColumnWidth(7, 100);
  sh.setColumnWidth(8, 110);

  // Push button placeholder note
  sh.getRange(1, 8).setValue('← Add "Push to Transactions" button here via Apps Script menu')
    .setFontColor('#999999').setFontStyle('italic');
}

// ── UTILITIES ────────────────────────────────────────────────────────────────

function columnToLetter(col) {
  let letter = '';
  while (col > 0) {
    const mod = (col - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    col = Math.floor((col - 1) / 26);
  }
  return letter;
}

// ── FIXUP: Add BOSS owner to live sheet ──────────────────────────────────────
// Run once after initial sheet creation to add Owner: BOSS everywhere.

function addBossOwner() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Accounts tab — add row after Lubo
  const accountSh = ss.getSheetByName('Accounts');
  if (accountSh) {
    const data = accountSh.getRange(2, 1, accountSh.getLastRow(), 1).getValues();
    const luboRow = data.findIndex(r => r[0] === 'Owner: Lubo');
    if (luboRow >= 0) {
      accountSh.insertRowAfter(luboRow + 2);
      accountSh.getRange(luboRow + 3, 1, 1, 4).setValues([
        ['Owner: BOSS', 'Owner', '', 'Negative = company owes BOSS']
      ]);
    }
  }

  // 2. Owner Balances tab — add BOSS row
  const ownerSh = ss.getSheetByName('Owner Balances');
  if (ownerSh) {
    const nextRow = ownerSh.getLastRow() + 1;
    ownerSh.getRange(nextRow, 1).setValue('BOSS');
    ownerSh.getRange(nextRow, 2).setFormula(
      `=IFERROR(SUMPRODUCT((Transactions!C$2:C$2000="Owner: BOSS")*(Transactions!G$2:G$2000="Owner Advance")*(Transactions!E$2:E$2000)),0)`
    ).setNumberFormat('#,##0.00;(#,##0.00)');
    ownerSh.getRange(nextRow, 3).setFormula(
      `=IFERROR(SUMPRODUCT((Transactions!C$2:C$2000="Owner: BOSS")*(Transactions!G$2:G$2000="Owner Payment")*(Transactions!E$2:E$2000)),0)`
    ).setNumberFormat('#,##0.00;(#,##0.00)');
    ownerSh.getRange(nextRow, 4).setFormula(
      `=SUMIF(Transactions!C$2:C$2000,"Owner: BOSS",Transactions!E$2:E$2000)`
    ).setNumberFormat('#,##0.00;(#,##0.00)').setFontWeight('bold');
  }

  // 3. Account Balances tab — add BOSS row
  const balSh = ss.getSheetByName('Account Balances');
  if (balSh) {
    const nextRow = balSh.getLastRow() + 1;
    balSh.getRange(nextRow, 1).setValue('Owner: BOSS');
    balSh.getRange(nextRow, 2).setValue('Owner');
    balSh.getRange(nextRow, 3).setFormula(
      `=IFERROR(SUMIF(Transactions!C$2:C$2000,"Owner: BOSS",Transactions!E$2:E$2000),0)`
    ).setNumberFormat('#,##0.00;(#,##0.00)');
    balSh.getRange(nextRow, 4).setFormula(
      `=IFERROR(TEXT(MAXIFS(Transactions!A$2:A$2000,Transactions!C$2:C$2000,"Owner: BOSS"),"yyyy-mm-dd"),"-")`
    );
  }

  // 4. Dashboard — add BOSS to owner balances section
  const dashSh = ss.getSheetByName('Dashboard');
  if (dashSh) {
    // BOSS goes in row 10 (after Lubo at row 9)
    dashSh.getRange(10, 4).setValue('BOSS');
    dashSh.getRange(10, 5).setFormula(
      `=IFERROR(SUMIF(Transactions!C$2:C$2000,"Owner: BOSS",Transactions!E$2:E$2000),0)`
    ).setNumberFormat('#,##0.00;(#,##0.00)');
  }

  // 5. Update Account dropdown validation in Transactions tab (cols C and D)
  const txnSh = ss.getSheetByName('Transactions');
  if (txnSh) {
    const newAccounts = [
      'RBC','BMO MC','CIBC','Cash',
      'Owner: Loric','Owner: Graeme','Owner: Lubo','Owner: BOSS',
      'Loan: Alex','Receivable: Client','Receivable: OP','Asset: Gear'
    ];
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(newAccounts, true).build();
    txnSh.getRange(2, 3, 1999, 1).setDataValidation(rule); // Account col
    txnSh.getRange(2, 4, 1999, 1).setDataValidation(rule); // Counterpart col
  }

  // 6. Update Import tab Account dropdown
  const importSh = ss.getSheetByName('Import');
  if (importSh) {
    const newAccounts = [
      'RBC','BMO MC','CIBC','Cash',
      'Owner: Loric','Owner: Graeme','Owner: Lubo','Owner: BOSS',
      'Loan: Alex','Receivable: Client','Receivable: OP','Asset: Gear'
    ];
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(newAccounts, true).build();
    importSh.getRange(3, 4, 198, 1).setDataValidation(rule);
  }

  SpreadsheetApp.getUi().alert('✓ Owner: BOSS added to all tabs and dropdowns.');
}
