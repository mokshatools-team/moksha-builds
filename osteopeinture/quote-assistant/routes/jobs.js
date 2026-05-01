'use strict';
const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const router = express.Router();

// Dependencies injected via init
let db, getJob, listJobs, convertSessionToJob, getJobPayments, getJobTimeEntries,
    getJobActivityMappings, syncPaymentToSheet, scheduleBackup, DB_PATH,
    getAnthropicClient, extractTextContent, extractJsonString;

function init(deps) {
  db = deps.db;
  getJob = deps.getJob;
  listJobs = deps.listJobs;
  convertSessionToJob = deps.convertSessionToJob;
  getJobPayments = deps.getJobPayments;
  getJobTimeEntries = deps.getJobTimeEntries;
  getJobActivityMappings = deps.getJobActivityMappings;
  syncPaymentToSheet = deps.syncPaymentToSheet;
  scheduleBackup = deps.scheduleBackup;
  DB_PATH = deps.DB_PATH;
  getAnthropicClient = deps.getAnthropicClient;
  extractTextContent = deps.extractTextContent;
  extractJsonString = deps.extractJsonString;
}

// ============================================================
// JOB MANAGEMENT ROUTES
// ============================================================

// List all jobs
router.get('/api/jobs', async (req, res) => {
  try {
    const jobs = await listJobs();
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single job with summary
router.get('/api/jobs/:id', async (req, res) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const payments = await getJobPayments(job.id);
    const totalPaidCents = payments.reduce((sum, p) => sum + p.amount_cents, 0);
    const timeEntries = await getJobTimeEntries(job.id);
    const mappings = await getJobActivityMappings(job.id);
    const changeOrders = await db.all('SELECT * FROM job_change_orders WHERE job_id = ? ORDER BY created_at', [job.id]);
    // Cash jobs: balance is based on agreed_total, no taxes.
    // Declared jobs: balance is based on quote_total (includes taxes).
    const effectiveTotalCents = job.payment_type === 'cash' && job.agreed_total_cents
      ? job.agreed_total_cents
      : job.quote_total_cents;

    res.json({
      ...job,
      payments,
      totalPaidCents,
      effectiveTotalCents,
      balanceRemainingCents: effectiveTotalCents - totalPaidCents,
      timeEntryCount: timeEntries.length,
      unmappedCount: timeEntries.filter(e => e.mapping_status === 'unmapped').length,
      activityMappings: mappings,
      changeOrders,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Convert quote session to job
router.post('/api/sessions/:id/convert-to-job', express.json(), async (req, res) => {
  try {
    const job = await convertSessionToJob(req.params.id, req.body || {});
    res.json(job);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update job details
router.patch('/api/jobs/:id', express.json(), async (req, res) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const now = new Date().toISOString();
    const fields = req.body;
    const updates = [];
    const params = [];
    for (const [key, value] of Object.entries(fields)) {
      const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (['job_number','client_name','client_email','client_phone','language','address','project_title',
           'project_type','status','payment_terms_text','start_date','target_end_date',
           'completion_date','internal_notes','scratchpad','payment_type','agreed_total_cents','job_sections'].includes(col)) {
        updates.push(`${col} = ?`);
        params.push(value);
      }
    }
    if (updates.length === 0) return res.status(400).json({ error: 'No valid fields to update' });
    updates.push('updated_at = ?');
    params.push(now, req.params.id);
    await db.run(`UPDATE jobs SET ${updates.join(', ')} WHERE id = ?`, [...params]);
    res.json(await getJob(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a job (soft delete). Unlinks the source session so it can be re-converted.
router.delete('/api/jobs/:id', async (req, res) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const jobId = job.id;
    await db.transaction(async (tx) => {
      await tx.run('UPDATE sessions SET converted_job_id = NULL, accepted_at = NULL WHERE converted_job_id = ?', [jobId]);
      await tx.run('UPDATE jobs SET deleted_at = NOW() WHERE id = ?', [jobId]);
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Record a payment. Saves to DB but does NOT auto-sync to the finance sheet —
// the client must explicitly confirm via POST /api/payments/:id/sync. This
// enforces the editable-outputs contract: no write to the finance sheet
// without explicit user approval.
router.post('/api/jobs/:id/payments', express.json(), async (req, res) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const { amount, date, method, reference, notes } = req.body;
    if (!amount || !date) return res.status(400).json({ error: 'amount and date are required' });
    const now = new Date().toISOString();
    const paymentId = uuidv4();
    const amountCents = Math.round(amount * 100);
    const resolvedMethod = method || 'e_transfer';
    await db.run(`
      INSERT INTO payments (id, job_id, payment_date, amount_cents, method, reference, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [paymentId, job.id, date, amountCents, resolvedMethod, reference || null, notes || null, now]);

    scheduleBackup(DB_PATH);

    // Return a preview of what would be written to the finance sheet.
    // The client must POST to /api/payments/:id/sync to actually write it.
    res.json({
      id: paymentId,
      message: 'Payment recorded — awaiting finance sync confirmation',
      sync_preview: {
        date,
        amount: Number(amount),
        amount_formatted: '$' + Number(amount).toLocaleString('fr-CA'),
        method: resolvedMethod,
        // Show the project ID (e.g. LACHANCE_01), not the client name —
        // the project ID is what gets written to the finance sheet.
        job_name: job.job_number,
        job_number: job.job_number,
        category: 'Contract Revenue',
        reference: reference || null,
        destination: 'Finance Google Sheet — Transactions tab',
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Edit a payment (date, amount, method, reference, notes)
router.patch('/api/payments/:id', express.json(), async (req, res) => {
  try {
    const payment = await db.get('SELECT * FROM payments WHERE id = ?', [req.params.id]);
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    const updates = [];
    const params = [];
    const allowed = ['payment_date', 'amount_cents', 'method', 'reference', 'notes'];
    for (const [key, value] of Object.entries(req.body || {})) {
      if (allowed.includes(key)) {
        updates.push(`${key} = ?`);
        params.push(value);
      }
    }
    if (!updates.length) return res.status(400).json({ error: 'No valid fields to update' });
    params.push(req.params.id);
    await db.run(`UPDATE payments SET ${updates.join(', ')} WHERE id = ?`, params);
    const updated = await db.get('SELECT * FROM payments WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Confirm and execute the finance sheet sync for a previously recorded payment.
router.post('/api/payments/:id/sync', express.json(), async (req, res) => {
  try {
    const payment = await db.get('SELECT * FROM payments WHERE id = ?', [req.params.id]);
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    const job = await getJob(payment.job_id);
    if (!job) return res.status(404).json({ error: 'Parent job not found' });
    if (payment.finance_sync_status === 'synced') {
      return res.json({ ok: true, status: 'already_synced', synced_at: payment.finance_synced_at });
    }
    await syncPaymentToSheet(payment.id, job, {
      date: payment.payment_date,
      amountCents: payment.amount_cents,
      method: payment.method,
      reference: payment.reference,
    });
    const updated = await db.get('SELECT finance_sync_status, finance_synced_at FROM payments WHERE id = ?', [payment.id]);
    res.json({ ok: true, status: updated.finance_sync_status, synced_at: updated.finance_synced_at });
  } catch (err) {
    console.error('[finance-sync] Confirm-sync failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get job payments
router.get('/api/jobs/:id/payments', async (req, res) => {
  try {
    res.json(await getJobPayments(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SMART PASTE — Apple Notes parser ───────────────────────────────────────
// Takes raw Apple Note text, calls Claude to extract structured job fields,
// and returns a preview. Does NOT write anything — the client must call
// /api/jobs/:id/smart-paste/apply after user confirms.
router.post('/api/jobs/:id/smart-paste', express.json(), async (req, res) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const text = (req.body && typeof req.body.text === 'string') ? req.body.text.trim() : '';
    if (!text) return res.status(400).json({ error: 'text is required' });
    if (text.length > 20000) return res.status(400).json({ error: 'text too long (max 20000 chars)' });

    const prompt = [
      'You are parsing a raw Apple Note for a painting job run by OstéoPeinture.',
      'Extract structured data and return ONLY a single JSON object with this exact shape:',
      '',
      '{',
      '  "clientName": string|null,',
      '  "address": string|null,',
      '  "phone": string|null,',
      '  "contractTotal": number|null,',
      '  "paintTotal": number|null,',
      '  "consumablesTotal": number|null,',
      '  "laborCost": number|null,',
      '  "payments": [',
      '    { "date": "YYYY-MM-DD"|null, "amount": number, "method": "cash"|"e_transfer"|"cheque"|null, "note": string|null }',
      '  ],',
      '  "todo": string,',
      '  "toClarify": string,',
      '  "toBring": string,',
      '  "products": string,',
      '  "remainder": string',
      '}',
      '',
      'Rules:',
      '- Numbers only in amount fields: no currency symbols, no thousands separators (e.g. 17000 not "17,000$").',
      '- Dates: try to parse to YYYY-MM-DD. If only month+day is given, use 2026 as the year. If no date at all, use null.',
      '- method: "cash" for cash/espèces, "e_transfer" for e-transfer/virement/interac, "cheque" for cheque. If unclear, null.',
      '- Ignore lines that have a ✅ or check mark — those are already-confirmed, still include them as payments.',
      '- If "deposit" or "dépôt" is mentioned, it is a payment.',
      '- balance/BALANCE is NOT a payment — it is what is still owing. Skip it.',
      '',
      'SECTION ROUTING (each is a multi-line string preserving the original lines):',
      '- "todo": tasks, room status, action items, things still to be done. Lines like "SUNROOM — standby", "TODO: ...", "À faire", "to do".',
      '- "toClarify": questions, unknowns, things to ask the client. Lines like "TO CLARIFY", "À clarifier", "?".',
      '- "toBring": tools, equipment, materials to bring on site. Lines like "TO BRING", "À apporter", @mentions of crew bringing things ("@Lubo hammer drill").',
      '- "products": paint, primer, stain, consumables — anything paint-product related. Lines like "PAINT", "BM ORDERS", "WALLS: 19 gal BM Regal", "Trim - advance OC-17", "ceiling 4 gal", or any line mentioning paint brand names (BM, SW, Regal, Advance, Duration, Ultra Spec, etc.) or quantities in gallons.',
      '- "remainder": EVERYTHING ELSE that is not a structured field above — door codes, lockboxes, free-form notes, addresses for context, dates, etc.',
      '',
      '- Each section string preserves line breaks. Empty section = empty string "" (NOT null).',
      '- A line goes to ONLY ONE section — pick the best fit.',
      '- If a structured top-level field (clientName, etc.) is not present, use null.',
      '- Return ONLY the JSON object. No markdown fence, no prose before or after.',
      '',
      'Here is the note:',
      '---',
      text,
      '---',
    ].join('\n');

    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });
    const assistantText = extractTextContent(response.content);
    const jsonString = extractJsonString(assistantText);
    if (!jsonString) {
      return res.status(502).json({ error: 'Could not parse Claude response', raw: assistantText.slice(0, 500) });
    }
    let extracted;
    try {
      extracted = JSON.parse(jsonString);
    } catch (e) {
      return res.status(502).json({ error: 'Invalid JSON from Claude', raw: assistantText.slice(0, 500) });
    }

    // Detect conflicts with existing job fields (for the UI's overwrite prompt)
    const conflicts = {};
    if (extracted.clientName && job.client_name && extracted.clientName !== job.client_name) {
      conflicts.clientName = { existing: job.client_name, incoming: extracted.clientName };
    }
    if (extracted.address && job.address && extracted.address !== job.address) {
      conflicts.address = { existing: job.address, incoming: extracted.address };
    }
    if (extracted.phone && job.client_phone && extracted.phone !== job.client_phone) {
      conflicts.phone = { existing: job.client_phone, incoming: extracted.phone };
    }
    if (extracted.contractTotal && job.quote_total_cents && Math.round(extracted.contractTotal * 100) !== job.quote_total_cents) {
      conflicts.contractTotal = { existing: job.quote_total_cents / 100, incoming: extracted.contractTotal };
    }

    res.json({ extracted, conflicts });
  } catch (err) {
    console.error('[smart-paste] Failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Apply a previously-previewed smart paste result to the job.
router.post('/api/jobs/:id/smart-paste/apply', express.json(), async (req, res) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const { extracted, overwrite } = req.body || {};
    if (!extracted || typeof extracted !== 'object') {
      return res.status(400).json({ error: 'extracted object is required' });
    }
    const now = new Date().toISOString();

    const updates = [];
    const params = [];
    const applied = [];

    function maybeSet(col, incoming, existing) {
      if (incoming == null || incoming === '') return;
      if (existing && !overwrite) return;
      updates.push(`${col} = ?`);
      params.push(incoming);
      applied.push(col);
    }
    maybeSet('client_name', extracted.clientName, job.client_name);
    maybeSet('address', extracted.address, job.address);
    maybeSet('client_phone', extracted.phone, job.client_phone);

    if (extracted.contractTotal && (!job.quote_total_cents || overwrite)) {
      const cents = Math.round(Number(extracted.contractTotal) / 50) * 5000;
      const taxCents = Math.round(cents * 0.14975);
      updates.push('quote_subtotal_cents = ?', 'quote_tax_cents = ?', 'quote_total_cents = ?');
      params.push(cents, taxCents, cents + taxCents);
      applied.push('contract_total');
    }

    // Sections: route extracted content to job_sections JSON keys instead of scratchpad
    const existingSections = job.job_sections
      ? (typeof job.job_sections === 'string' ? JSON.parse(job.job_sections) : job.job_sections)
      : {};
    const newSections = { ...existingSections };
    let sectionsChanged = false;
    const SECTION_KEYS = ['todo', 'toClarify', 'toBring', 'products'];
    for (const key of SECTION_KEYS) {
      const incoming = (typeof extracted[key] === 'string' ? extracted[key] : '').trim();
      if (!incoming) continue;
      const existing = (existingSections[key] || '').trim();
      newSections[key] = existing && !overwrite ? existing + '\n\n' + incoming : incoming;
      sectionsChanged = true;
      applied.push(key);
    }
    if (sectionsChanged) {
      updates.push('job_sections = ?');
      params.push(JSON.stringify(newSections));
    }

    // Remainder → scratchpad (only stuff that didn't fit into a section)
    if (typeof extracted.remainder === 'string' && extracted.remainder.trim()) {
      const incoming = extracted.remainder.trim();
      const existing = (job.scratchpad || '').trim();
      const newContent = existing && !overwrite ? existing + '\n\n' + incoming : incoming;
      updates.push('scratchpad = ?');
      params.push(newContent);
      applied.push('scratchpad');
    }

    if (updates.length > 0) {
      updates.push('updated_at = ?');
      params.push(now, job.id);
      await db.run(`UPDATE jobs SET ${updates.join(', ')} WHERE id = ?`, [...params]);
    }

    // Payments — insert each as a pending (unsynced) record.
    const insertedPayments = [];
    if (Array.isArray(extracted.payments)) {
      const ins = await db.run(`
        INSERT INTO payments (id, job_id, payment_date, amount_cents, method, reference, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const p of extracted.payments) {
        if (!p || typeof p.amount !== 'number' || p.amount <= 0) continue;
        const pid = uuidv4();
        const date = p.date || now.slice(0, 10);
        const method = ['cash', 'e_transfer', 'cheque'].includes(p.method) ? p.method : 'cash';
        const amtCents = Math.round(p.amount * 100);
        ins.run(pid, job.id, date, amtCents, method, null, p.note || null, now);
        insertedPayments.push({ id: pid, date, amount: p.amount, method });
      }
      if (insertedPayments.length > 0) applied.push(`payments(${insertedPayments.length})`);
    }

    scheduleBackup(DB_PATH);
    res.json({ ok: true, applied, insertedPayments, job: await getJob(job.id) });
  } catch (err) {
    console.error('[smart-paste-apply] Failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Import Jibble CSV
router.post('/api/jobs/:id/imports/jibble', multer({ storage: multer.memoryStorage() }).single('file'), async (req, res) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const now = new Date().toISOString();
    const batchId = uuidv4();
    const content = req.file.buffer.toString('utf-8').replace(/^\uFEFF/, '');
    const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return res.status(400).json({ error: 'CSV has no data rows' });

    // Parse headers
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const activityIdx = headers.findIndex(h => h === 'activity');
    const memberIdx = headers.findIndex(h => h === 'member');
    const timeIdx = headers.findIndex(h => h.includes('tracked time') || h.includes('duration'));
    const dateIdx = headers.findIndex(h => h === 'date' || h.includes('work date'));

    if (activityIdx === -1 || memberIdx === -1 || timeIdx === -1) {
      return res.status(400).json({ error: 'CSV must have Activity, Member, and Tracked Time columns' });
    }

    // Get existing mappings for this job
    const mappings = {};
    await getJobActivityMappings(job.id).forEach(m => { mappings[m.source_activity_name] = m; });

    let inserted = 0, duplicates = 0, unmapped = 0;
    const dataLines = lines.slice(1);

    for (const line of dataLines) {
      const cols = line.split(',').map(c => c.trim());
      const activity = cols[activityIdx] || '';
      const member = cols[memberIdx] || '';
      const timeStr = cols[timeIdx] || '';
      const workDate = dateIdx >= 0 ? cols[dateIdx] : null;

      if (!activity || !member) continue;

      // Parse "Xh Ym" to minutes
      const match = timeStr.match(/(\d+)h\s*(\d+)m/);
      const minutes = match ? parseInt(match[1]) * 60 + parseInt(match[2]) : 0;
      if (minutes === 0) continue;

      // Generate dedup key
      const rowKey = crypto.createHash('sha1')
        .update(`${job.id}|${workDate || ''}|${member}|${activity}|${minutes}`)
        .digest('hex');

      // Check for duplicate
      const existing = await db.get('SELECT id FROM time_entries WHERE external_row_key = ?', [rowKey]);
      if (existing) { duplicates++; continue; }

      // Check mapping
      const mapping = mappings[activity];
      const mappingStatus = mapping ? 'mapped' : 'unmapped';
      if (!mapping) unmapped++;

      const entryId = uuidv4();
      await db.run(`
        INSERT INTO time_entries (id, batch_id, job_id, external_row_key, work_date, employee_name,
          source_activity_name, mapped_phase_code, mapped_label_en, mapped_label_fr,
          mapping_status, duration_minutes, billable_minutes, raw_row_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [entryId, batchId, job.id, rowKey, workDate, member, activity,
        mapping ? mapping.phase_code : null,
        mapping ? mapping.client_label_en : null,
        mapping ? mapping.client_label_fr : null,
        mappingStatus, minutes,
        mapping && mapping.billable ? minutes : 0,
        JSON.stringify(cols), now
      ]);
      inserted++;
    }

    // Save batch record
    await db.run(`
      INSERT INTO time_import_batches (id, job_id, file_name, imported_at, row_count, inserted_count, duplicate_count, unmapped_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [batchId, job.id, req.file.originalname || 'jibble.csv', now, dataLines.length, inserted, duplicates, unmapped]);

    res.json({ batchId, inserted, duplicates, unmapped, total: dataLines.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get/set activity mappings for a job
router.get('/api/jobs/:id/activity-mappings', async (req, res) => {
  try {
    const mappings = await getJobActivityMappings(req.params.id);
    // Also get unmapped activities
    const unmapped = await db.run(`
      SELECT DISTINCT source_activity_name FROM time_entries
      WHERE job_id = ? AND mapping_status = 'unmapped'
    `, [req.params.id]);
    res.json({ mappings, unmappedActivities: unmapped.map(r => r.source_activity_name) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/api/jobs/:id/activity-mappings', express.json(), async (req, res) => {
  try {
    const jobId = req.params.id;
    const { mappings } = req.body; // array of { sourceActivityName, phaseCode, clientLabelEn, clientLabelFr, billable, showOnUpdate, sortOrder }
    if (!Array.isArray(mappings)) return res.status(400).json({ error: 'mappings must be an array' });

    for (const m of mappings) {
      const id = uuidv4();
      await db.all(`
        INSERT INTO job_activity_mappings (id, job_id, source_activity_name, phase_code, client_label_en, client_label_fr, billable, show_on_update, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(job_id, source_activity_name) DO UPDATE SET
          phase_code = excluded.phase_code,
          client_label_en = excluded.client_label_en,
          client_label_fr = excluded.client_label_fr,
          billable = excluded.billable,
          show_on_update = excluded.show_on_update,
          sort_order = excluded.sort_order
      `, [id, jobId, m.sourceActivityName, m.phaseCode || 'other',
        m.clientLabelEn || m.sourceActivityName, m.clientLabelFr || m.sourceActivityName,
        m.billable !== false ? 1 : 0, m.showOnUpdate !== false ? 1 : 0, m.sortOrder || 100]);

      // Retro-apply mapping to existing unmapped entries
      await db.run(`
        UPDATE time_entries SET mapping_status = 'mapped',
          mapped_phase_code = ?, mapped_label_en = ?, mapped_label_fr = ?,
          billable_minutes = CASE WHEN ? = 1 THEN duration_minutes ELSE 0 END
        WHERE job_id = ? AND source_activity_name = ? AND mapping_status = 'unmapped'
      `, [m.phaseCode || 'other', m.clientLabelEn || m.sourceActivityName,
        m.clientLabelFr || m.sourceActivityName, m.billable !== false ? 1 : 0,
        jobId, m.sourceActivityName]);
    }

    res.json({ updated: mappings.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get time entries for a job
router.get('/api/jobs/:id/time-entries', async (req, res) => {
  try {
    res.json(await getJobTimeEntries(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PAST QUOTES SEARCH ─────────────────────────────────────────────────
// Searches the past_quotes table for historical quote data. Used by
// the Claude tool to reference past pricing during new quote conversations.
router.get('/api/past-quotes/search', async (req, res) => {
  try {
    const { q, type, limit } = req.query;
    const maxResults = Math.min(parseInt(limit) || 5, 10);
    let sql = 'SELECT * FROM past_quotes WHERE 1=1';
    const params = [];
    let paramIdx = 0;
    if (q) {
      paramIdx++;
      sql += ` AND (client_name ILIKE $${paramIdx} OR project_id ILIKE $${paramIdx} OR address ILIKE $${paramIdx})`;
      params.push('%' + q + '%');
    }
    if (type) {
      paramIdx++;
      sql += ` AND job_type = $${paramIdx}`;
      params.push(type);
    }
    paramIdx++;
    sql += ` ORDER BY date DESC LIMIT $${paramIdx}`;
    params.push(maxResults);
    // Use raw pool.query since we have $N placeholders already
    const { getPool } = require('../db');
    const { rows } = await getPool().query(sql, params);
    // Parse JSON fields for the response
    const results = rows.map(r => ({
      ...r,
      sections: r.sections_json ? JSON.parse(r.sections_json) : null,
      paints: r.paints_json ? JSON.parse(r.paints_json) : null,
    }));
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, init };
