'use strict';

const { scheduleBackup } = require('../lib/db-backup');
const path = require('path');

let db;
let DB_PATH;

function init(database, dbPath) {
  db = database;
  DB_PATH = dbPath;
}

async function getSession(id) {
  const row = await db.get('SELECT * FROM sessions WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!row) return null;
  return {
    ...row,
    // Alias snake_case DB columns to camelCase used by the app code.
    // Without this, saveSession() reads undefined camelCase fields and
    // wipes the DB values on every subsequent save.
    clientName: row.client_name,
    projectId: row.project_id,
    totalAmount: row.total_amount,
    createdAt: row.created_at,
    emailRecipient: row.email_recipient,
    messages: JSON.parse(row.messages || '[]'),
    quoteJson: row.quote_json ? JSON.parse(row.quote_json) : null,
    emailMeta: row.email_meta ? JSON.parse(row.email_meta) : {},
  };
}

async function saveSession(session) {
  const now = new Date().toISOString();
  const params = [
    session.id,
    session.createdAt || now,
    now,
    session.clientName || null,
    session.projectId || null,
    session.address || null,
    session.totalAmount || null,
    session.status || 'gathering',
    JSON.stringify(session.messages || []),
    session.quoteJson ? JSON.stringify(session.quoteJson) : null,
    session.emailRecipient || null,
    JSON.stringify(session.emailMeta || {}),
  ];
  await db.run(`
    INSERT INTO sessions (id, created_at, updated_at, client_name, project_id, address, total_amount, status, messages, quote_json, email_recipient, email_meta)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      updated_at = EXCLUDED.updated_at,
      client_name = EXCLUDED.client_name,
      project_id = EXCLUDED.project_id,
      address = EXCLUDED.address,
      total_amount = EXCLUDED.total_amount,
      status = EXCLUDED.status,
      messages = EXCLUDED.messages,
      quote_json = EXCLUDED.quote_json,
      email_recipient = EXCLUDED.email_recipient,
      email_meta = EXCLUDED.email_meta
  `, params);
  scheduleBackup(DB_PATH);
}

async function listSessions() {
  // Auto-cleanup: soft-delete empty NEW_ sessions older than 5 minutes (abandoned starts)
  try {
    await db.run(`
      UPDATE sessions SET deleted_at = NOW()
      WHERE project_id LIKE 'NEW_%'
        AND quote_json IS NULL
        AND messages = '[]'
        AND deleted_at IS NULL
        AND updated_at < (NOW() - INTERVAL '5 minutes')
    `);
  } catch (e) { /* ignore cleanup errors */ }
  return await db.all(`
    SELECT id, created_at, updated_at, client_name, project_id, address, total_amount, status, email_recipient, converted_job_id
    FROM sessions WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 50
  `);
}

// Generate next sequential project ID with a given prefix
async function nextProjectId(prefix) {
  const rows = await db.all(
    "SELECT project_id FROM sessions WHERE project_id LIKE ? ORDER BY project_id DESC LIMIT 1",
    [prefix + '_%']
  );
  let num = 1;
  if (rows.length) {
    const match = rows[0].project_id.match(/_(\d+)$/);
    if (match) num = parseInt(match[1], 10) + 1;
  }
  return `${prefix}_${String(num).padStart(2, '0')}`;
}

module.exports = { init, getSession, saveSession, listSessions, nextProjectId };
