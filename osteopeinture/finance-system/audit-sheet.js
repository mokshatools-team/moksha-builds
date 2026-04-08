/**
 * audit-sheet.js
 * Reads the existing OstéoPeinture Google Sheet and outputs a plain-language audit.
 * Uses the TOA OAuth credentials (web client, localhost:5001).
 *
 * Usage: node audit-sheet.js
 * First run: opens browser for Google auth, saves token to token.json
 */

const { google } = require('googleapis');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// ── Config ─────────────────────────────────────────────────────────────────
const CREDENTIALS_PATH = path.join(
  '/Users/loric/MOKSHA/FIDELIO Automations/text-overlay-assistant/client_secrets.json'
);
const TOKEN_PATH = path.join(__dirname, 'token.json');
const SHEET_ID = '1O2t1MwUHwhafLRVrlpmOo46EIImfLoD-11aCaEyHijk';
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];
const REDIRECT_PORT = 5001;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/auth/callback`;

// ── Auth ────────────────────────────────────────────────────────────────────
function loadCredentials() {
  const raw = fs.readFileSync(CREDENTIALS_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  const creds = parsed.web || parsed.installed;
  return creds;
}

function getAuthClient(creds) {
  return new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    REDIRECT_URI
  );
}

async function authenticate() {
  const creds = loadCredentials();
  const auth = getAuthClient(creds);

  // Reuse saved token if available
  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    auth.setCredentials(token);
    // Refresh if expired
    if (token.expiry_date && token.expiry_date < Date.now()) {
      console.log('Token expired — refreshing...');
      const { credentials } = await auth.refreshAccessToken();
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(credentials, null, 2));
      auth.setCredentials(credentials);
    }
    return auth;
  }

  // First-time OAuth flow
  const authUrl = auth.generateAuthUrl({ access_type: 'offline', scope: SCOPES });
  console.log('\nOpening browser for Google authentication...');
  console.log('If it does not open, visit:\n', authUrl, '\n');
  exec(`open "${authUrl}"`);

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const parsed = url.parse(req.url, true);
      if (!parsed.pathname.startsWith('/auth/callback')) return;

      const code = parsed.query.code;
      if (!code) {
        res.end('No code received. Please try again.');
        server.close();
        return reject(new Error('No auth code'));
      }

      try {
        const { tokens } = await auth.getToken(code);
        auth.setCredentials(tokens);
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
        res.end('<h2>Authenticated! You can close this tab.</h2>');
        server.close();
        resolve(auth);
      } catch (err) {
        res.end('Auth error: ' + err.message);
        server.close();
        reject(err);
      }
    });

    server.listen(REDIRECT_PORT, () => {
      console.log(`Waiting for OAuth callback on port ${REDIRECT_PORT}...`);
    });
  });
}

// ── Sheet reading ───────────────────────────────────────────────────────────
async function getSheetTabs(sheets) {
  const res = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  return res.data.sheets.map(s => ({
    title: s.properties.title,
    id: s.properties.sheetId,
    rows: s.properties.gridProperties.rowCount,
    cols: s.properties.gridProperties.columnCount,
  }));
}

async function readTab(sheets, tabName, maxRows = 200) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `'${tabName}'!A1:Z${maxRows}`,
    });
    return res.data.values || [];
  } catch (err) {
    return null;
  }
}

function formatTable(rows, maxDataRows = 10) {
  if (!rows || rows.length === 0) return '  (empty)';
  const headers = rows[0];
  const data = rows.slice(1, maxDataRows + 1);
  const widths = headers.map((h, i) => {
    const colVals = [h, ...data.map(r => String(r[i] || ''))];
    return Math.min(30, Math.max(...colVals.map(v => v.length)));
  });

  const line = (row) => row.map((cell, i) => String(cell || '').slice(0, widths[i]).padEnd(widths[i])).join(' | ');
  const sep = widths.map(w => '-'.repeat(w)).join('-+-');

  return [
    '  ' + line(headers),
    '  ' + sep,
    ...data.map(r => '  ' + line(r.concat(Array(headers.length).fill('')))),
    rows.length > maxDataRows + 1 ? `  ... (${rows.length - 1} total rows)` : '',
  ].filter(l => l !== '').join('\n');
}

// ── Main audit ──────────────────────────────────────────────────────────────
async function main() {
  console.log('=== OstéoPeinture Finance Sheet Audit ===\n');

  const auth = await authenticate();
  const sheets = google.sheets({ version: 'v4', auth });

  // List all tabs
  const tabs = await getSheetTabs(sheets);
  console.log(`Sheet has ${tabs.length} tabs:\n`);
  tabs.forEach(t => console.log(`  • ${t.title} (${t.rows} rows × ${t.cols} cols)`));
  console.log('');

  // Read and display key tabs
  const KEY_TABS = [
    { name: null, match: /categor/i, label: 'CATEGORIES TAB', maxRows: 300 },
    { name: null, match: /transaction/i, label: 'TRANSACTIONS TAB', maxRows: 25 },
    { name: null, match: /wage|worker|labour|labor/i, label: 'WAGES TAB', maxRows: 25 },
    { name: null, match: /balance|account|summary/i, label: 'BALANCES / SUMMARY TAB', maxRows: 50 },
    { name: null, match: /dashboard/i, label: 'DASHBOARD TAB', maxRows: 50 },
  ];

  // Match tabs by name
  for (const kt of KEY_TABS) {
    const match = tabs.find(t => kt.match.test(t.title));
    if (match) kt.name = match.title;
  }

  const output = [];

  for (const kt of KEY_TABS) {
    if (!kt.name) {
      output.push(`\n── ${kt.label} ──\n  (no matching tab found)\n`);
      continue;
    }

    console.log(`Reading: ${kt.name}...`);
    const rows = await readTab(sheets, kt.name, kt.maxRows);
    output.push(`\n── ${kt.label} (tab: "${kt.name}") ──\n${formatTable(rows, kt.maxRows - 1)}\n`);
  }

  // Also dump any tab we haven't covered
  const coveredNames = KEY_TABS.map(k => k.name).filter(Boolean);
  const remaining = tabs.filter(t => !coveredNames.includes(t.title));

  if (remaining.length > 0) {
    output.push('\n── OTHER TABS ──');
    for (const t of remaining) {
      console.log(`Reading: ${t.title}...`);
      const rows = await readTab(sheets, t.title, 20);
      output.push(`\n  Tab: "${t.title}"\n${formatTable(rows || [], 10)}`);
    }
  }

  // Write full output to file
  const reportPath = path.join(__dirname, 'audit-report.txt');
  const fullOutput = output.join('\n');
  fs.writeFileSync(reportPath, fullOutput, 'utf8');

  console.log('\n' + fullOutput);
  console.log(`\n✓ Full audit saved to: ${reportPath}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
