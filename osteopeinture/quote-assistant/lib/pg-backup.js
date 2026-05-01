'use strict';

const fs = require('fs');
const path = require('path');

const BACKUP_DIR = process.env.BACKUP_DIR || '/tmp/op-hub-backups';
const MAX_BACKUPS = 7;

async function exportAllData(db) {
  const sessions = await db.all('SELECT * FROM sessions WHERE deleted_at IS NULL');
  const jobs = await db.all('SELECT * FROM jobs WHERE deleted_at IS NULL');
  const payments = await db.all('SELECT * FROM payments');
  const attachments = await db.all('SELECT * FROM attachments');

  let changeOrders = [];
  try {
    changeOrders = await db.all('SELECT * FROM job_change_orders');
  } catch (e) { /* table may not exist */ }

  return {
    exportedAt: new Date().toISOString(),
    counts: {
      sessions: sessions.length,
      jobs: jobs.length,
      payments: payments.length,
      attachments: attachments.length,
      changeOrders: changeOrders.length,
    },
    sessions,
    jobs,
    payments,
    attachments,
    changeOrders,
  };
}

async function saveBackup(db) {
  const data = await exportAllData(db);
  const date = new Date().toISOString().slice(0, 10);
  const filename = 'op-hub-backup-' + date + '.json';

  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const filePath = path.join(BACKUP_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log('[backup] Saved:', filePath, '(' + data.counts.sessions + ' sessions, ' + data.counts.jobs + ' jobs)');

  // Rotate: keep only MAX_BACKUPS most recent
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(function(f) { return f.startsWith('op-hub-backup-') && f.endsWith('.json'); })
    .sort()
    .reverse();

  if (files.length > MAX_BACKUPS) {
    for (var i = MAX_BACKUPS; i < files.length; i++) {
      fs.unlinkSync(path.join(BACKUP_DIR, files[i]));
      console.log('[backup] Rotated out:', files[i]);
    }
  }

  return { ok: true, filename: filename, counts: data.counts };
}

async function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter(function(f) { return f.startsWith('op-hub-backup-') && f.endsWith('.json'); })
    .sort()
    .reverse()
    .map(function(f) {
      var stat = fs.statSync(path.join(BACKUP_DIR, f));
      return { filename: f, size: stat.size, date: f.replace('op-hub-backup-', '').replace('.json', '') };
    });
}

function getBackupPath(filename) {
  var filePath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(filePath)) return null;
  return filePath;
}

module.exports = { exportAllData, saveBackup, listBackups, getBackupPath };
