#!/usr/bin/env node
/**
 * One-off script to mechanically convert server.js from better-sqlite3
 * synchronous calls to the async db.js wrapper.
 *
 * Run: node scripts/convert-to-pg.js
 * Output: writes server.js in place (archive already saved as server.sqlite.js)
 */
const fs = require('fs');
const path = require('path');

const SERVER_PATH = path.join(__dirname, '..', 'server.js');
let code = fs.readFileSync(SERVER_PATH, 'utf8');
const original = code;

// ─── STEP 1: Replace the database setup section ───────────────────────
// Remove everything from `const Database = require('better-sqlite3')` or
// `function createFallbackDatabase()` through the schema creation, up to
// but not including the QUOTING_LOGIC seeding section.

// Find the marker where the DB setup ends and quoting logic begins
const quotingLogicMarker = '// Seed QUOTING_LOGIC.md';
const quotingIdx = code.indexOf(quotingLogicMarker);
if (quotingIdx === -1) {
  console.error('Could not find quoting logic marker');
  process.exit(1);
}

// Find where the DB section starts (after DATA_DIR setup)
const dataDirLine = "const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');";
const dataDirIdx = code.indexOf(dataDirLine);
if (dataDirIdx === -1) {
  console.error('Could not find DATA_DIR line');
  process.exit(1);
}

// Find the end of the DATA_DIR block (the mkdir line)
const mkdirLine = "if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });";
const mkdirIdx = code.indexOf(mkdirLine);
const dbPathLine = "const DB_PATH = path.join(DATA_DIR, 'sessions.db');";

// Replace everything between the mkdir line and the quoting logic marker
const afterMkdir = code.indexOf('\n', mkdirIdx) + 1;
const beforeQuoting = quotingIdx;

const dbSetupReplacement = `
// ── DATABASE (Supabase Postgres via db.js wrapper) ─────────────────────
// Archive: server.sqlite.js has the original SQLite version.
// db.js handles connection pool, ? → $N placeholder conversion, transactions.
const db = require('./db');

`;

code = code.slice(0, afterMkdir) + dbSetupReplacement + code.slice(beforeQuoting);

// Remove DB_PATH references (used for backup scheduling) — keep the line but make it conditional
code = code.replace(
  /const DB_PATH = path\.join\(DATA_DIR, 'sessions\.db'\);/g,
  "const DB_PATH = path.join(DATA_DIR, 'sessions.db'); // kept for backup endpoint compatibility"
);

// ─── STEP 2: Remove better-sqlite3 require ────────────────────────────
code = code.replace(/const Database = require\('better-sqlite3'\);\n?/g, '');

// ─── STEP 3: Remove createFallbackDatabase function if still present ──
// This is a large block — find and remove it
const fallbackStart = code.indexOf('function createFallbackDatabase()');
if (fallbackStart !== -1) {
  // Find the closing of this function (it returns an object, ends with `};`)
  // Actually it's complex — let's just leave it if it exists, it won't be called
}

// ─── STEP 4: Convert db.prepare().get() calls ─────────────────────────
// Pattern: db.prepare('SQL').get(params)
// → await db.get('SQL', [params])
//
// Also handles backtick strings and multiline SQL.

// Simple single-line .get() with string literal SQL
code = code.replace(
  /db\.prepare\((['"`])(.*?)\1\)\.get\((.*?)\)/g,
  (match, quote, sql, params) => {
    const paramList = params.trim() ? `[${params.trim()}]` : '[]';
    return `await db.get(${quote}${sql}${quote}, ${paramList})`;
  }
);

// ─── STEP 5: Convert db.prepare().all() calls ─────────────────────────
code = code.replace(
  /db\.prepare\((['"`])(.*?)\1\)\.all\((.*?)\)/g,
  (match, quote, sql, params) => {
    const paramList = params.trim() ? `[${params.trim()}]` : '[]';
    return `await db.all(${quote}${sql}${quote}, ${paramList})`;
  }
);

// ─── STEP 6: Convert db.prepare().run() calls (single-line) ───────────
code = code.replace(
  /db\.prepare\((['"`])(.*?)\1\)\.run\((.*?)\)/g,
  (match, quote, sql, params) => {
    const paramList = params.trim() ? `[${params.trim()}]` : '[]';
    return `await db.run(${quote}${sql}${quote}, ${paramList})`;
  }
);

// ─── STEP 7: Handle multiline db.prepare(` ... `).run/get/all ─────────
// These use backtick template literals that span multiple lines.
// The regex above won't catch them because .*? doesn't match newlines.
// Use a dotAll-style approach.

// Multiline prepare().run()
code = code.replace(
  /db\.prepare\(`([\s\S]*?)`\)\.run\(([\s\S]*?)\)/g,
  (match, sql, params) => {
    const paramList = params.trim() ? `[${params.trim()}]` : '[]';
    return `await db.run(\`${sql}\`, ${paramList})`;
  }
);

// Multiline prepare().get()
code = code.replace(
  /db\.prepare\(`([\s\S]*?)`\)\.get\(([\s\S]*?)\)/g,
  (match, sql, params) => {
    const paramList = params.trim() ? `[${params.trim()}]` : '[]';
    return `await db.get(\`${sql}\`, ${paramList})`;
  }
);

// Multiline prepare().all()
code = code.replace(
  /db\.prepare\(`([\s\S]*?)`\)\.all\(([\s\S]*?)\)/g,
  (match, sql, params) => {
    const paramList = params.trim() ? `[${params.trim()}]` : '[]';
    return `await db.all(\`${sql}\`, ${paramList})`;
  }
);

// ─── STEP 8: Convert db.transaction() ─────────────────────────────────
// Pattern: const txn = db.transaction(() => { ... }); txn();
// → await db.transaction(async (tx) => { ... });
// Inside the transaction, db.prepare calls need to use tx instead of db.
code = code.replace(
  /const txn = db\.transaction\(\(\) => \{/g,
  'await db.transaction(async (tx) => {'
);
code = code.replace(/\n\s*txn\(\);\s*\n/g, '\n');

// Inside transaction blocks, the db.run/db.get/db.all calls were already
// converted to `await db.run(...)`. We need to change `db.` to `tx.` inside
// transaction blocks. This is hard to do with regex precisely, so we'll
// handle it manually if needed.

// ─── STEP 9: Make synchronous helper functions async ──────────────────
// getSession, saveSession, getJob, listJobs, etc.
const syncFunctions = [
  'function getSession',
  'function saveSession',
  'function getJob',
  'function listJobs',
  'function generateJobNumber',
  'function convertSessionToJob',
  'function getJobPayments',
  'function getJobTimeEntries',
  'function getJobActivityMappings',
];
for (const fn of syncFunctions) {
  // Only add async if not already there
  const asyncVersion = fn.replace('function ', 'async function ');
  if (code.includes(fn) && !code.includes(asyncVersion)) {
    code = code.replace(fn, asyncVersion);
  }
}

// ─── STEP 10: Add await to calls of now-async helper functions ────────
// These functions are called in route handlers. We need to add await.
// Common patterns:
//   const session = getSession(id) → const session = await getSession(id)
//   const job = getJob(id) → const job = await getJob(id)
// But only if not already awaited.

const asyncHelpers = [
  'getSession', 'saveSession', 'getJob', 'listJobs',
  'generateJobNumber', 'convertSessionToJob',
  'getJobPayments', 'getJobTimeEntries', 'getJobActivityMappings',
];

for (const fn of asyncHelpers) {
  // Add await before function calls that aren't already awaited
  // Match: word boundary + functionName( but NOT preceded by 'await '
  // Be careful not to match function declarations
  const regex = new RegExp(`(?<!await |async function |function )\\b${fn}\\(`, 'g');
  code = code.replace(regex, `await ${fn}(`);
}

// ─── STEP 11: Remove createDatabase call ──────────────────────────────
code = code.replace(/const db = createDatabase\(.*?\);\n?/g, '');

// ─── CLEANUP: Remove any double-awaits ────────────────────────────────
code = code.replace(/await await /g, 'await ');

// ─── WRITE ────────────────────────────────────────────────────────────
fs.writeFileSync(SERVER_PATH, code, 'utf8');

// Report
const changes = [];
let diffCount = 0;
const origLines = original.split('\n');
const newLines = code.split('\n');
console.log(`Original: ${origLines.length} lines, ${original.length} bytes`);
console.log(`Converted: ${newLines.length} lines, ${code.length} bytes`);
console.log(`Lines removed: ${origLines.length - newLines.length}`);

// Count remaining db.prepare references (should be 0)
const remaining = (code.match(/db\.prepare/g) || []).length;
console.log(`Remaining db.prepare calls: ${remaining}`);

// Count await db. calls
const awaitDb = (code.match(/await db\.(get|all|run|transaction)/g) || []).length;
console.log(`New await db.* calls: ${awaitDb}`);

if (remaining > 0) {
  console.log('\n⚠️  Some db.prepare calls were not converted! Manual fix needed.');
  // Show the line numbers
  code.split('\n').forEach((line, i) => {
    if (line.includes('db.prepare')) {
      console.log(`  Line ${i+1}: ${line.trim().slice(0, 100)}`);
    }
  });
}
