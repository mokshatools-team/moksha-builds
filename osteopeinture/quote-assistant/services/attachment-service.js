'use strict';

const { v4: uuidv4 } = require('uuid');

const STORAGE_BUCKET = 'op-hub-attachments';

let db;
let supabase;

function init(database, supabaseClient) {
  db = database;
  supabase = supabaseClient;
}

/**
 * Upload a single normalized image to Supabase storage and record in DB.
 * @param {Object} opts
 * @param {Object} opts.file - normalized image { mediaType, buffer/data, originalName }
 * @param {string} opts.sessionId - optional session ID
 * @param {string} opts.jobId - optional job ID
 * @param {string} opts.pathPrefix - storage path prefix (e.g. 'sessions/abc' or 'jobs/xyz')
 * @returns {{ id, public_url, original_name } | null} - null if upload failed
 */
async function uploadAttachment({ file, sessionId, jobId, pathPrefix }) {
  if (!supabase) { console.warn('[storage] no supabase'); return null; }
  const imgBuffer = file.buffer || file.data;
  if (!imgBuffer) { console.warn('[storage] no buffer for image', file.originalName); return null; }

  const fileId = uuidv4();
  const ext = file.mediaType === 'image/png' ? 'png' : 'jpeg';
  const storagePath = `${pathPrefix}/${fileId}.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, imgBuffer, { contentType: file.mediaType, upsert: false });
  if (uploadErr) { console.warn('[storage] upload failed:', uploadErr.message); return null; }

  const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);

  await db.run(
    'INSERT INTO attachments (id, session_id, job_id, filename, original_name, content_type, size_bytes, storage_path, public_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [fileId, sessionId || null, jobId || null, `${fileId}.${ext}`, file.originalName || `${fileId}.${ext}`, file.mediaType, imgBuffer.length, storagePath, urlData.publicUrl, new Date().toISOString()]
  );

  return { id: fileId, public_url: urlData.publicUrl, original_name: file.originalName };
}

/**
 * List attachments for a session or job.
 */
async function listAttachments({ sessionId, jobId }) {
  if (sessionId) {
    return await db.all('SELECT * FROM attachments WHERE session_id = ? ORDER BY created_at', [sessionId]);
  }
  if (jobId) {
    return await db.all('SELECT * FROM attachments WHERE job_id = ? ORDER BY created_at', [jobId]);
  }
  return [];
}

/**
 * Delete an attachment from storage and DB.
 */
async function deleteAttachment(attachmentId) {
  const att = await db.get('SELECT * FROM attachments WHERE id = ?', [attachmentId]);
  if (!att) return null;
  if (supabase) {
    await supabase.storage.from(STORAGE_BUCKET).remove([att.storage_path]);
  }
  await db.run('DELETE FROM attachments WHERE id = ?', [attachmentId]);
  return att;
}

module.exports = { init, uploadAttachment, listAttachments, deleteAttachment, STORAGE_BUCKET };
