'use strict';

const { v4: uuidv4 } = require('uuid');
const { scheduleBackup } = require('../lib/db-backup');

let db;
let DB_PATH;
let sessionService;

function init(database, dbPath, _sessionService) {
  db = database;
  DB_PATH = dbPath;
  sessionService = _sessionService;
}

async function getJob(id) {
  const row = await db.get('SELECT * FROM jobs WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!row) return null;
  return {
    ...row,
    acceptedQuoteJson: row.accepted_quote_json ? JSON.parse(row.accepted_quote_json) : null,
  };
}

async function listJobs() {
  return await db.all(`
    SELECT j.*,
      (SELECT COALESCE(SUM(amount_cents), 0) FROM payments WHERE job_id = j.id) as total_paid_cents
    FROM jobs j WHERE j.deleted_at IS NULL ORDER BY j.updated_at DESC LIMIT 50
  `, []);
}

async function generateJobNumber(clientName) {
  // Use the LAST name only: "Anthony Sanford" → "SANFORD"
  const parts = (clientName || 'JOB').trim().split(/\s+/);
  const lastName = parts[parts.length - 1];
  const prefix = lastName.toUpperCase().replace(/[^A-ZÀ-ÖØ-Ý]/g, '').slice(0, 15);
  const existing = await db.get("SELECT job_number FROM jobs WHERE job_number LIKE ? ORDER BY job_number DESC LIMIT 1", [`${prefix}_%`]);
  if (existing) {
    const match = existing.job_number.match(/_(\d+)$/);
    const next = match ? parseInt(match[1]) + 1 : 1;
    return `${prefix}_${String(next).padStart(2, '0')}`;
  }
  return `${prefix}_01`;
}

async function convertSessionToJob(sessionId, overrides = {}) {
  const session = await sessionService.getSession(sessionId);
  if (!session) throw new Error('Session not found');
  if (session.converted_job_id) throw new Error('Session already converted to a job');

  const now = new Date().toISOString();
  const jobId = uuidv4();
  const jobNumber = overrides.jobNumber || await generateJobNumber(session.clientName);

  // Recompute subtotal from the current quoteJson rather than trusting the
  // cached session.totalAmount — catches edits, reloads, and manual JSON pastes.
  // Skips sections flagged as excluded (repairs) or optional (add-ons), matching renderQuoteHTML.
  let recomputed = 0;
  for (const sec of (session.quoteJson?.sections || [])) {
    if (sec.excluded || sec.optional) continue;
    if (sec.total) recomputed += sec.total;
    else for (const item of (sec.items || [])) recomputed += (item.price || 0);
  }
  if (recomputed > 0) session.totalAmount = recomputed;

  // Exact subtotal in cents — no rounding, matches renderQuoteHTML
  const subtotalCents = Math.round((session.totalAmount || 0) * 100);
  const tpsCents = Math.round(subtotalCents * 0.05);
  const tvqCents = Math.round(subtotalCents * 0.09975);
  const taxCents = tpsCents + tvqCents;
  const totalCents = subtotalCents + taxCents;

  // Cash jobs: no taxes, agreed_total overrides computed total
  const paymentType = overrides.paymentType === 'cash' ? 'cash' : 'declared';
  const agreedTotalCents = paymentType === 'cash' && overrides.agreedTotal
    ? Math.round(Number(overrides.agreedTotal) * 100)
    : null;

  await db.transaction(async (tx) => {
    await tx.run(`
      INSERT INTO jobs (id, quote_session_id, job_number, client_name, client_email, client_phone,
        language, address, project_title, project_type, status,
        quote_subtotal_cents, quote_tax_cents, quote_total_cents, accepted_quote_json,
        payment_terms_text, start_date, internal_notes, payment_type, agreed_total_cents, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [jobId, sessionId, jobNumber,
      overrides.clientName || session.clientName || 'Unknown',
      overrides.clientEmail || session.emailRecipient || null,
      overrides.clientPhone || null,
      overrides.language || 'french',
      overrides.address || session.address || '',
      overrides.projectTitle || session.projectId || null,
      overrides.projectType || 'hourly',
      subtotalCents, taxCents, totalCents,
      session.quoteJson ? JSON.stringify(session.quoteJson) : null,
      overrides.paymentTerms || null,
      overrides.startDate || null,
      overrides.internalNotes || null,
      paymentType, agreedTotalCents,
      now, now
    ]);

    // Pre-populate the Products section from the quote's paints array
    // so the user opens the new job with the paint list ready to edit.
    const paints = session.quoteJson && Array.isArray(session.quoteJson.paints) ? session.quoteJson.paints : [];
    if (paints.length) {
      const productsLines = paints.map(p => {
        const parts = [];
        if (p.type) parts.push(p.type + ':');
        if (p.approxQty) parts.push(p.approxQty);
        if (p.product) parts.push((p.approxQty ? '— ' : '') + p.product);
        if (p.finish) parts.push('— ' + p.finish);
        if (p.color) parts.push('— ' + p.color);
        return parts.join(' ');
      }).filter(Boolean).join('\n');
      if (productsLines) {
        await tx.run('UPDATE jobs SET job_sections = ? WHERE id = ?', [JSON.stringify({ products: productsLines }), jobId]);
      }
    }

    // Transfer file attachments from session to job
    await tx.run('UPDATE attachments SET job_id = ? WHERE session_id = ?', [jobId, sessionId]);

    // Mark session as converted
    await tx.run('UPDATE sessions SET converted_job_id = ?, accepted_at = ? WHERE id = ?', [jobId, now, sessionId]);
  });

  return await getJob(jobId);
}

async function getJobPayments(jobId) {
  return await db.all('SELECT * FROM payments WHERE job_id = ? ORDER BY payment_date DESC', [jobId]);
}

async function getJobTimeEntries(jobId) {
  return await db.all('SELECT * FROM time_entries WHERE job_id = ? ORDER BY work_date DESC, employee_name', [jobId]);
}

async function getJobActivityMappings(jobId) {
  return await db.all('SELECT * FROM job_activity_mappings WHERE job_id = ? ORDER BY sort_order', [jobId]);
}

module.exports = {
  init,
  getJob,
  listJobs,
  generateJobNumber,
  convertSessionToJob,
  getJobPayments,
  getJobTimeEntries,
  getJobActivityMappings,
};
