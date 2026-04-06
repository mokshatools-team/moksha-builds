/**
 * db-backup.js
 * Automatic SQLite backup to Google Drive
 *
 * - On startup: if local DB is empty/missing, restore from Drive
 * - After saves: debounced backup to Drive (every 5 minutes max)
 * - On demand: manual backup via API route
 *
 * Requires:
 *   GOOGLE_SERVICE_ACCOUNT_JSON env var (full JSON string)
 *   DB_BACKUP_FOLDER_ID env var (Google Drive folder ID for backups)
 */

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const BACKUP_FILENAME = 'quote-assistant-sessions.db';
let driveClient = null;
let backupFolderId = null;
let lastBackupTime = 0;
const BACKUP_DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes

function initDriveClient() {
  if (driveClient) return driveClient;

  const credJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const folderId = process.env.DB_BACKUP_FOLDER_ID;

  if (!credJson || !folderId) {
    console.log('[db-backup] Missing GOOGLE_SERVICE_ACCOUNT_JSON or DB_BACKUP_FOLDER_ID — backup disabled');
    return null;
  }

  try {
    const creds = JSON.parse(credJson);
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });
    driveClient = google.drive({ version: 'v3', auth });
    backupFolderId = folderId;
    console.log('[db-backup] Drive client initialized');
    return driveClient;
  } catch (err) {
    console.error('[db-backup] Failed to init Drive client:', err.message);
    return null;
  }
}

/**
 * Find the latest backup file in Drive
 */
async function findLatestBackup() {
  const drive = initDriveClient();
  if (!drive) return null;

  try {
    const res = await drive.files.list({
      q: `'${backupFolderId}' in parents and name = '${BACKUP_FILENAME}' and trashed = false`,
      orderBy: 'modifiedTime desc',
      pageSize: 1,
      fields: 'files(id,name,modifiedTime,size)',
    });
    return res.data.files && res.data.files.length > 0 ? res.data.files[0] : null;
  } catch (err) {
    console.error('[db-backup] Error finding backup:', err.message);
    return null;
  }
}

/**
 * Restore DB from Drive backup
 */
async function restoreFromDrive(localDbPath) {
  const drive = initDriveClient();
  if (!drive) return false;

  const backup = await findLatestBackup();
  if (!backup) {
    console.log('[db-backup] No backup found on Drive');
    return false;
  }

  console.log(`[db-backup] Restoring from Drive backup (${backup.modifiedTime}, ${backup.size} bytes)`);

  try {
    const res = await drive.files.get(
      { fileId: backup.id, alt: 'media' },
      { responseType: 'stream' }
    );

    const dest = fs.createWriteStream(localDbPath);
    await new Promise((resolve, reject) => {
      res.data.pipe(dest);
      dest.on('finish', resolve);
      dest.on('error', reject);
    });

    console.log(`[db-backup] Restored DB to ${localDbPath}`);
    return true;
  } catch (err) {
    console.error('[db-backup] Restore failed:', err.message);
    return false;
  }
}

/**
 * Backup local DB to Drive
 */
async function backupToDrive(localDbPath) {
  const drive = initDriveClient();
  if (!drive) return false;

  if (!fs.existsSync(localDbPath)) {
    console.log('[db-backup] No local DB to backup');
    return false;
  }

  try {
    // Check if backup file already exists
    const existing = await findLatestBackup();

    const media = {
      mimeType: 'application/x-sqlite3',
      body: fs.createReadStream(localDbPath),
    };

    if (existing) {
      // Update existing file
      await drive.files.update({
        fileId: existing.id,
        media,
      });
      console.log(`[db-backup] Updated backup on Drive (${existing.id})`);
    } else {
      // Create new file
      await drive.files.create({
        requestBody: {
          name: BACKUP_FILENAME,
          parents: [backupFolderId],
        },
        media,
      });
      console.log('[db-backup] Created new backup on Drive');
    }

    lastBackupTime = Date.now();
    return true;
  } catch (err) {
    console.error('[db-backup] Backup failed:', err.message);
    return false;
  }
}

/**
 * Debounced backup — call after any DB write, only actually backs up every 5 min
 */
function scheduleBackup(localDbPath) {
  if (Date.now() - lastBackupTime < BACKUP_DEBOUNCE_MS) return;
  // Run backup in background, don't await
  backupToDrive(localDbPath).catch(err => {
    console.error('[db-backup] Scheduled backup error:', err.message);
  });
}

/**
 * Startup routine: restore if local DB is empty or missing
 */
async function ensureDatabase(localDbPath) {
  const exists = fs.existsSync(localDbPath);
  const isEmpty = exists && fs.statSync(localDbPath).size < 1000;

  if (!exists || isEmpty) {
    console.log(`[db-backup] Local DB ${exists ? 'is empty' : 'not found'} — attempting restore from Drive`);
    const restored = await restoreFromDrive(localDbPath);
    if (restored) {
      console.log('[db-backup] Database restored successfully');
      return 'restored';
    } else {
      console.log('[db-backup] No backup available — starting fresh');
      return 'fresh';
    }
  }

  console.log('[db-backup] Local DB exists and has data');
  // Do an initial backup to make sure Drive has the latest
  backupToDrive(localDbPath).catch(() => {});
  return 'existing';
}

module.exports = {
  initDriveClient,
  ensureDatabase,
  backupToDrive,
  restoreFromDrive,
  scheduleBackup,
};
