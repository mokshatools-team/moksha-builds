'use strict';
const express = require('express');
const fs = require('fs');
const router = express.Router();

// Dependencies injected via init
let db, pgBackup, DB_PATH, backupToDrive, getQuotingLogic, writeQuotingLogic;

function init(deps) {
  db = deps.db;
  pgBackup = deps.pgBackup;
  DB_PATH = deps.DB_PATH;
  backupToDrive = deps.backupToDrive;
  getQuotingLogic = deps.getQuotingLogic;
  writeQuotingLogic = deps.writeQuotingLogic;
}

// ── POSTGRES BACKUP ──────────────────────────────────────────
router.post('/api/admin/backup', async (req, res) => {
  try {
    const result = await pgBackup.saveBackup(db);
    res.json(result);
  } catch (err) {
    console.error('[backup] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/admin/backups', async (req, res) => {
  try {
    res.json(await pgBackup.listBackups());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/admin/backups/:filename', (req, res) => {
  const filePath = pgBackup.getBackupPath(req.params.filename);
  if (!filePath) return res.status(404).json({ error: 'Backup not found' });
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="' + req.params.filename + '"');
  res.sendFile(filePath);
});

// Download DB file for manual backup (legacy SQLite)
router.get('/api/backup/download', async (req, res) => {
  if (!fs.existsSync(DB_PATH)) return res.status(404).json({ error: 'No database found' });
  res.setHeader('Content-Type', 'application/x-sqlite3');
  res.setHeader('Content-Disposition', 'attachment; filename=op-hub-sessions.db');
  fs.createReadStream(DB_PATH).pipe(res);
});

// Manual backup route (Drive — may not work on consumer accounts)
router.post('/api/backup', async (req, res) => {
  try {
    const result = await backupToDrive(DB_PATH);
    res.json({ ok: result, message: result ? 'Backup complete' : 'Backup failed or not configured' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Quoting logic — read
router.get('/api/quoting-logic', async (req, res) => {
  res.json({ content: getQuotingLogic() });
});

// Quoting logic — write
router.put('/api/quoting-logic', express.json(), async (req, res) => {
  const { content } = req.body;
  if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
  writeQuotingLogic(content);
  res.json({ ok: true });
});

// Version endpoint for deploy verification
router.get('/api/version', async (req, res) => {
  res.json({ version: '2026-04-06', features: ['jobs', 'jibble-import', 'db-backup'] });
});

module.exports = { router, init };
