require('dotenv').config();
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const Anthropic = require('@anthropic-ai/sdk');
const multer = require('multer');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
const {
  MAX_IMAGE_COUNT,
  UploadError,
  createBudgetedMemoryStorage,
  buildAnthropicImageParts,
  normalizeImages,
  summarizeImageUpload,
} = require('./lib/image-upload');
const { ensureDatabase, scheduleBackup, backupToDrive } = require('./lib/db-backup');
const { calculateScaffold } = require('./lib/scaffold-engine');

// ============================================================
// DATABASE SETUP
// ============================================================

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── DATABASE (Supabase Postgres via db.js wrapper) ─────────────────────
// Archive: server.sqlite.js has the original SQLite version.
// db.js handles connection pool, ? → $N placeholder conversion, transactions.
const db = require('./db');
const DB_PATH = path.join(DATA_DIR, 'sessions.db'); // kept for backup endpoint compatibility — file may not exist on Supabase builds

// Seed QUOTING_LOGIC.md to DATA_DIR on first run so it persists on the volume.
// Force-reseed on version bump: compare the `# Version:` header line in the
// repo seed vs the volume copy. If they differ, the seed wins. This overrides
// any admin-panel edits — by design, so deploys can push authoritative updates.
const QUOTING_LOGIC_PATH = path.join(DATA_DIR, 'QUOTING_LOGIC.md');
const QUOTING_LOGIC_SEED = path.join(__dirname, 'QUOTING_LOGIC.md');

function readQuotingLogicVersion(filePath) {
  try {
    const head = fs.readFileSync(filePath, 'utf8').split('\n').slice(0, 10).join('\n');
    const m = head.match(/^# Version:\s*(.+)$/m);
    return m ? m[1].trim() : null;
  } catch (e) {
    return null;
  }
}

if (fs.existsSync(QUOTING_LOGIC_SEED)) {
  const seedVersion = readQuotingLogicVersion(QUOTING_LOGIC_SEED);
  if (!fs.existsSync(QUOTING_LOGIC_PATH)) {
    fs.copyFileSync(QUOTING_LOGIC_SEED, QUOTING_LOGIC_PATH);
    console.log(`[quoting-logic] Seeded volume copy (first run): ${seedVersion || 'unversioned'}`);
  } else {
    const volumeVersion = readQuotingLogicVersion(QUOTING_LOGIC_PATH);
    if (seedVersion && seedVersion !== volumeVersion) {
      fs.copyFileSync(QUOTING_LOGIC_SEED, QUOTING_LOGIC_PATH);
      console.log(`[quoting-logic] Force-reseeded: ${volumeVersion || 'unversioned'} -> ${seedVersion}`);
    }
  }
}
const EMAIL_LOGIC_PATH = path.join(DATA_DIR, 'EMAIL_LOGIC.md');
const EMAIL_LOGIC_SEED = path.join(__dirname, 'EMAIL_LOGIC.md');
if (!fs.existsSync(EMAIL_LOGIC_PATH) && fs.existsSync(EMAIL_LOGIC_SEED)) {
  fs.copyFileSync(EMAIL_LOGIC_SEED, EMAIL_LOGIC_PATH);
}

function getEmailLogic() {
  if (fs.existsSync(EMAIL_LOGIC_PATH)) return fs.readFileSync(EMAIL_LOGIC_PATH, 'utf8');
  if (fs.existsSync(EMAIL_LOGIC_SEED)) return fs.readFileSync(EMAIL_LOGIC_SEED, 'utf8');
  return '';
}

/**
 * Fetch up to N past sent emails to use as tone reference for a draft.
 * Filters by language so French drafts don't get English examples (and v.v.).
 * Tries: (1) signer + scenario + language, then (2) signer + language,
 * then (3) any signer + scenario + language. Falls back to [] silently if
 * the past_emails table is empty or absent.
 */
async function getPastEmailExamples(signer, scenario, language, limit = 3) {
  try {
    let rows = await db.all(
      `SELECT subject, body, sign_off FROM past_emails
       WHERE signer = ? AND scenario = ? AND language = ? AND body IS NOT NULL
       ORDER BY sent_at DESC LIMIT ?`,
      [signer, scenario, language, limit]
    );
    if (rows.length < limit) {
      const more = await db.all(
        `SELECT subject, body, sign_off FROM past_emails
         WHERE signer = ? AND scenario != ? AND language = ? AND body IS NOT NULL
         ORDER BY sent_at DESC LIMIT ?`,
        [signer, scenario, language, limit - rows.length]
      );
      rows = rows.concat(more);
    }
    if (rows.length < limit) {
      const more = await db.all(
        `SELECT subject, body, sign_off FROM past_emails
         WHERE scenario = ? AND signer != ? AND language = ? AND body IS NOT NULL
         ORDER BY sent_at DESC LIMIT ?`,
        [scenario, signer, language, limit - rows.length]
      );
      rows = rows.concat(more);
    }
    return rows;
  } catch (err) {
    console.warn('[past_emails] lookup failed (table missing?):', err.message);
    return [];
  }
}

function getQuotingLogic() {
  if (fs.existsSync(QUOTING_LOGIC_PATH)) return fs.readFileSync(QUOTING_LOGIC_PATH, 'utf8');
  if (fs.existsSync(QUOTING_LOGIC_SEED)) return fs.readFileSync(QUOTING_LOGIC_SEED, 'utf8');
  return '(no quoting logic file found)';
}

// createFallbackDatabase removed — was the in-memory SQLite mock for tests.
// Tests now use the real Supabase connection or a test-specific DB.
// Archive: see server.sqlite.js for the original implementation.

// Schema creation removed — tables are managed in Supabase directly.
// See server.sqlite.js for the original CREATE TABLE statements.
// See scripts/convert-to-pg.js for the migration script.

async function getSession(id) {
  const row = await db.get('SELECT * FROM sessions WHERE id = ?', [id]);
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
  return await db.all(`
    SELECT id, created_at, updated_at, client_name, project_id, address, total_amount, status, email_recipient, converted_job_id
    FROM sessions ORDER BY updated_at DESC LIMIT 50
  `);
}

// ============================================================
// JOB MANAGEMENT HELPERS
// ============================================================

async function getJob(id) {
  const row = await db.get('SELECT * FROM jobs WHERE id = ?', [id]);
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
    FROM jobs j ORDER BY j.updated_at DESC LIMIT 50
  `, []);
}

async function generateJobNumber(clientName) {
  const prefix = (clientName || 'JOB').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 10);
  const existing = await db.get("SELECT job_number FROM jobs WHERE job_number LIKE ? ORDER BY job_number DESC LIMIT 1", [`${prefix}_%`]);
  if (existing) {
    const match = existing.job_number.match(/_(\d+)$/);
    const next = match ? parseInt(match[1]) + 1 : 1;
    return `${prefix}_${String(next).padStart(2, '0')}`;
  }
  return `${prefix}_01`;
}

async function convertSessionToJob(sessionId, overrides = {}) {
  const session = await getSession(sessionId);
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

  // Round subtotal to nearest $50 for display consistency with the PDF
  // renderer (renderQuoteHTML). JSON values stay untouched — this only
  // affects the stored job totals used in the job card UI.
  const rawSubtotalCents = Math.round((session.totalAmount || 0) * 100);
  const subtotalCents = Math.round(rawSubtotalCents / 5000) * 5000;
  const taxCents = Math.round(subtotalCents * 0.14975);
  const totalCents = subtotalCents + taxCents;

  // Cash jobs: no taxes, agreed_total overrides computed total
  const paymentType = overrides.paymentType === 'cash' ? 'cash' : 'declared';
  const agreedTotalCents = paymentType === 'cash' && overrides.agreedTotal
    ? Math.round(Number(overrides.agreedTotal) * 100)
    : null;

  await db.run(`
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
      await db.run('UPDATE jobs SET job_sections = ? WHERE id = ?', [JSON.stringify({ products: productsLines }), jobId]);
    }
  }

  // Mark session as converted
  await db.run('UPDATE sessions SET converted_job_id = ?, accepted_at = ? WHERE id = ?', [jobId, now, sessionId]);

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

// ── FINANCE SHEET SYNC ─────────────────────────────────────────────────────

async function syncPaymentToSheet(paymentId, job, payment) {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const credJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!sheetId || !credJson) {
    console.log('[finance-sync] No GOOGLE_SHEET_ID or credentials — skipping');
    await db.run("UPDATE payments SET finance_sync_status = 'skipped' WHERE id = ?", [paymentId]);
    return;
  }

  try {
    const { google } = require('googleapis');
    const creds = JSON.parse(credJson);
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    const account = payment.method === 'cash' ? 'Cash' : 'RBC';
    const month = payment.date.slice(0, 7);
    const amountDollars = payment.amountCents / 100;
    const entryId = uuidv4();

    // Write Contract Revenue row to Transactions tab
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'Transactions!A:N',
      valueInputOption: 'RAW',
      requestBody: {
        values: [[
          payment.date,                                    // Date
          `Invoice paid — ${job.client_name} — ${job.job_number}`, // Description
          account,                                         // Account
          '',                                              // Counterpart
          amountDollars,                                   // Amount
          'Contract Revenue',                              // Category
          '',                                              // Transfer Type
          month,                                           // Month
          job.job_number,                                  // Job
          'Invoice',                                       // Source
          entryId,                                         // entry_id
          'quote-assistant',                               // source_system
          paymentId,                                       // source_id
          new Date().toISOString(),                        // created_at
        ]],
      },
    });

    await db.run("UPDATE payments SET finance_sync_status = 'synced', finance_synced_at = ? WHERE id = ?", [new Date().toISOString(), paymentId]);

    console.log(`[finance-sync] Payment ${paymentId} synced to sheet — $${amountDollars} for ${job.job_number}`);
  } catch (err) {
    console.error('[finance-sync] Error:', err.message);
    await db.run("UPDATE payments SET finance_sync_status = 'failed' WHERE id = ?", [paymentId]);
  }
}

function detectDefaultEmailLanguage(session) {
  const userText = (session.messages || [])
    .filter((message) => message && message.role === 'user')
    .map((message) => extractTextContent(message.content))
    .join(' ')
    .toLowerCase();

  const quoteText = [
    session.quoteJson?.clientName || '',
    session.quoteJson?.projectId || '',
    session.quoteJson?.address || '',
  ].join(' ').toLowerCase();

  const text = `${userText} ${quoteText}`;
  const frenchSignals = ['bonjour', 'soumission', 'veuillez', "n'hésitez", 'répondez', 'merci', 'adresse', 'travail'];
  const englishSignals = ['hello', 'hi', 'please', 'quote', 'estimate', 'thanks', 'thank you', 'reply', 'property'];

  const hasFrenchSignal = frenchSignals.some((signal) => text.includes(signal));
  const hasEnglishSignal = englishSignals.some((signal) => text.includes(signal));

  if (hasFrenchSignal && !hasEnglishSignal) return 'french';
  return 'english';
}

function inferSeasonLabel(lang = 'english', date = new Date()) {
  const month = date.getMonth();
  const year = date.getFullYear();
  const isFr = lang === 'french';
  if (month >= 2 && month <= 4) return isFr ? `Printemps ${year}` : `Spring ${year}`;
  if (month >= 5 && month <= 7) return isFr ? `Été ${year}` : `Summer ${year}`;
  if (month >= 8 && month <= 10) return isFr ? `Automne ${year}` : `Fall ${year}`;
  return isFr ? `Hiver ${year}` : `Winter ${year}`;
}

function inferSuggestedEmailScenario(session) {
  const assistantText = (session?.messages || [])
    .filter((message) => message && message.role === 'assistant')
    .map((message) => extractTextContent(message.content))
    .join('\n')
    .toLowerCase();
  const userText = (session?.messages || [])
    .filter((message) => message && message.role === 'user')
    .map((message) => extractTextContent(message.content))
    .join('\n')
    .toLowerCase();
  const quoteText = [
    session?.quoteJson?.projectId || '',
    session?.quoteJson?.address || '',
    session?.quoteJson?.notes || '',
  ].join('\n').toLowerCase();
  const text = `${assistantText}\n${userText}\n${quoteText}`;

  if (/prefer not to|pass this time|pass our turn|laisser passer notre tour|fully booked|booked til|booked until|not a fit|impossible for us/.test(text)) {
    return 'decline';
  }
  if (/coming soon|haven't forgotten|have not forgotten|you will receive it|prepare your quote|patience/.test(text)) {
    return 'quote_promise';
  }
  if (/follow up|follow-up|suivi/.test(text)) {
    return session?.quoteJson ? 'quote_follow_up' : 'lead_follow_up';
  }
  if (/updated quote|revised quote|soumission ajustee|soumission ajustée|soumission revisee|soumission révisée|erratum|corrected version/.test(text)) {
    return 'quote_revision';
  }
  if (/project update|mise-a-jour|mise à jour|cost breakdown|cost to completion|projection des couts|projection des coûts|ventilation des couts|ventilation des coûts/.test(text)) {
    return 'project_update';
  }
  if (/photos|send photos|envoyez|availability|disponibilit|site visit|estimate visit|details/.test(text)) {
    return session?.quoteJson ? 'quote_send' : 'lead_more_info';
  }
  if (!session?.quoteJson) {
    return 'lead_more_info';
  }
  return 'quote_send';
}

function getEmailMeta(session) {
  const language = detectDefaultEmailLanguage(session);
  const storedMeta = session?.emailMeta || {};
  const scenario = storedMeta.scenarioManual && storedMeta.scenario
    ? storedMeta.scenario
    : inferSuggestedEmailScenario(session);
  return {
    scenario,
    suggestedScenario: inferSuggestedEmailScenario(session),
    scenarioManual: Boolean(storedMeta.scenarioManual && storedMeta.scenario),
    signer: storedMeta.signer || 'Loric',
    detailLevel: storedMeta.detailLevel || 'standard',
    language: storedMeta.language || language,
  };
}

function getSignerProfile(signer, language) {
  const profiles = {
    Loric: {
      english: {
        signOff: 'Best,',
        signature: ['Loric', 'For Ostéopeinture', '514-266-2028'],
      },
      french: {
        signOff: 'Merci,',
        signature: ['Loric', 'Pour Ostéopeinture', '514-266-2028'],
      },
    },
    Graeme: {
      english: {
        signOff: 'Thank you,',
        signature: ['Graeme', 'For Ostéopeinture', '514-266-2028'],
      },
      french: {
        signOff: 'Regards,',
        signature: ['Graeme', 'Pour Ostéopeinture', '514-266-2028'],
      },
    },
    Lubo: {
      english: {
        signOff: 'Thank you,',
        signature: ['Lubo', 'For Ostéopeinture', '514-266-2028'],
      },
      french: {
        signOff: 'Cordialement,',
        signature: ['Lubo', 'Pour Ostéopeinture', '514-266-2028'],
      },
    },
  };

  const signerProfile = profiles[signer] || profiles.Loric;
  return signerProfile[language] || signerProfile.english;
}

function joinParagraphs(parts) {
  return parts.filter(Boolean).join('\n\n');
}

function buildSubjectPrefix(scenario, language) {
  const map = {
    quote_send: language === 'french' ? 'Soumission' : 'Painting Quote',
    quote_revision: language === 'french' ? 'Soumission révisée' : 'Revised Quote',
    quote_follow_up: language === 'french' ? 'Suivi — Soumission' : 'Follow-up — Quote',
    quote_promise: language === 'french' ? 'Soumission à venir' : 'Quote Coming Soon',
    decline: language === 'french' ? 'Projet de peinture' : 'Painting Project',
    lead_more_info: language === 'french' ? 'Projet de peinture' : 'Painting Project',
    lead_follow_up: language === 'french' ? 'Suivi — Projet de peinture' : 'Follow-up — Painting Project',
    project_update: language === 'french' ? 'Mise à jour — Projet' : 'Project Update',
  };
  return map[scenario] || (language === 'french' ? 'Soumission' : 'Painting Quote');
}

function buildEmailSubject(session, emailMeta) {
  const language = emailMeta.language;
  const prefix = buildSubjectPrefix(emailMeta.scenario, language);
  const rawAddress = (session.quoteJson?.address || session.address || '').trim();
  // Strip city from address — "5648 Wilderton, Montréal" → "5648 Wilderton"
  // The city is understood and never included in subject lines.
  const location = rawAddress.split(',')[0].trim() || '';
  const includeSeason = ['quote_send', 'quote_revision'].includes(emailMeta.scenario);
  const season = includeSeason ? inferSeasonLabel(language) : '';
  return [prefix, location, season].filter(Boolean).join(' — ');
}

function buildScenarioBody(session, emailMeta) {
  const language = emailMeta.language;
  const clientFirstName = (session.quoteJson?.clientName || session.clientName || '').trim().split(/\s+/)[0] || '';
  const quoteAddress = (session.quoteJson?.address || session.address || '').trim();
  const signer = getSignerProfile(emailMeta.signer, language);
  const greeting = formatEmailGreeting(language, clientFirstName);
  const locationText = quoteAddress
    ? (language === 'french' ? ` pour le projet au ${quoteAddress}` : ` for the project at ${quoteAddress}`)
    : '';

  let body = '';

  if (emailMeta.scenario === 'quote_send') {
    const framing = emailMeta.detailLevel === 'detailed'
      ? (language === 'french'
        ? "Je vous envoie la soumission ci-jointe. J'ai gardé le tout aussi clair et direct que possible; dites-moi si vous voulez qu'on ajuste quoi que ce soit ou qu'on revoie une phase en particulier."
        : "Please find the attached quote. I kept it as clear and direct as possible, but let me know if you want us to adjust anything or revisit a specific phase.")
      : (language === 'french'
        ? `Voici la soumission ci-jointe${locationText}.`
        : `Please find the attached quote${locationText}.`);
    const cta = language === 'french'
      ? "N'hésitez pas si vous avez des questions ou si vous voulez qu'on avance."
      : "Let me know if you have any questions or if you want to move ahead.";
    body = joinParagraphs([greeting, framing, cta]);
  } else if (emailMeta.scenario === 'quote_revision') {
    const framing = language === 'french'
      ? "Voici la version révisée de la soumission ci-jointe."
      : "Please find the revised quote attached.";
    const detail = emailMeta.detailLevel === 'detailed'
      ? (language === 'french'
        ? "J'ai ajusté le document pour refléter les changements discutés. Si vous voulez, on peut aussi revoir une option ou une phase plus précisément."
        : "I updated it to reflect the changes we discussed. If you want, we can also revisit an option or a phase more precisely.")
      : '';
    const cta = language === 'french'
      ? "Dites-moi si cette version vous convient."
      : "Let me know if this version works for you.";
    body = joinParagraphs([greeting, framing, detail, cta]);
  } else if (emailMeta.scenario === 'quote_follow_up') {
    body = joinParagraphs([
      greeting,
      language === 'french'
        ? "Petit suivi par rapport à la soumission envoyée."
        : "Just following up on the quote we sent.",
      language === 'french'
        ? "Dites-moi si vous avez des questions ou si vous voulez qu'on en discute."
        : "Let me know if you have any questions or if you want to talk it through.",
    ]);
  } else if (emailMeta.scenario === 'quote_promise') {
    body = joinParagraphs([
      greeting,
      language === 'french'
        ? "Simplement pour vous dire qu'on ne vous a pas oublié. Vous devriez recevoir la soumission sous peu."
        : "Just a quick note to say we haven’t forgotten about your quote. You should receive it shortly.",
      emailMeta.detailLevel === 'detailed'
        ? (language === 'french'
          ? "Merci pour votre patience entre-temps."
          : "Thanks for your patience in the meantime.")
        : '',
    ]);
  } else if (emailMeta.scenario === 'lead_follow_up') {
    body = joinParagraphs([
      greeting,
      language === 'french'
        ? "Je voulais simplement vérifier si vous cherchez encore des peintres pour votre projet."
        : "I just wanted to check whether you are still looking for painters for your project.",
      language === 'french'
        ? "Si oui, répondez-moi ici et on pourra voir la suite."
        : "If so, reply here and we can figure out the next step.",
    ]);
  } else if (emailMeta.scenario === 'lead_more_info') {
    body = joinParagraphs([
      greeting,
      language === 'french'
        ? "Ça semble intéressant de notre côté, mais avant de fixer quoi que ce soit, ce serait utile d'avoir quelques détails de plus."
        : "This looks potentially interesting on our end, but before locking anything in it would help to get a bit more detail.",
      language === 'french'
        ? "Si vous pouvez, envoyez-nous quelques photos, une idée du timing, et vos disponibilités pour une éventuelle visite."
        : "If you can, send us a few photos, a rough timing target, and your availability for a possible visit.",
    ]);
  } else if (emailMeta.scenario === 'project_update') {
    body = joinParagraphs([
      greeting,
      language === 'french'
        ? "Voici une mise à jour du projet et des coûts à ce stade."
        : "Here is a project and cost update at this stage.",
      emailMeta.detailLevel === 'detailed'
        ? (language === 'french'
          ? "J'ai résumé les ajustements importants de façon claire pour que vous ayez une bonne vue d'ensemble de ce qui a changé."
          : "I summarized the important adjustments clearly so you have a good overview of what changed.")
        : '',
      language === 'french'
        ? "Dites-moi si vous voulez qu'on passe un point en revue ensemble."
        : "Let me know if you want to go over any part of it together.",
    ]);
  } else if (emailMeta.scenario === 'decline') {
    body = joinParagraphs([
      greeting,
      language === 'french'
        ? "Merci d'avoir pensé à nous pour ce projet. Malheureusement, on va devoir passer notre tour cette fois-ci."
        : "Thanks for thinking of us for this project. Unfortunately, we’re going to have to pass this time.",
      emailMeta.detailLevel === 'detailed'
        ? (language === 'french'
          ? "Notre horaire / notre contexte actuel ne nous permet pas de prendre ce mandat convenablement."
          : "Our current schedule / setup doesn’t let us take this on properly right now.")
        : '',
    ]);
  } else {
    body = joinParagraphs([
      greeting,
      language === 'french'
        ? `Voici la soumission ci-jointe${locationText}.`
        : `Please find the attached quote${locationText}.`,
    ]);
  }

  return joinParagraphs([body, signer.signOff, signer.signature.join('\n')]);
}

function buildEmailDraft(session) {
  // Standalone-friendly: a session only needs clientName or address to
  // produce a draft. quoteJson is optional — non-quote scenarios
  // (decline, lead_more_info, project_update, etc) don't need it.
  if (!session) return null;
  if (!session.quoteJson && !session.clientName && !session.address) return null;

  const emailMeta = getEmailMeta(session);
  const emailSubject = buildEmailSubject(session, emailMeta);
  const emailBody = buildScenarioBody(session, emailMeta);

  return {
    subject: emailSubject,
    body: emailBody,
    recipient: session.emailRecipient || '',
    language: emailMeta.language,
    settings: emailMeta,
  };
}

function extractTextContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part.text === 'string') return part.text;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function buildTextOnlyAnthropicMessage(message) {
  if (!message || !message.role) return null;
  const text = extractTextContent(message.content);
  if (!text) return null;
  return {
    role: message.role,
    content: [{ type: 'text', text }],
  };
}

function buildTextOnlyHistory(messages) {
  return (messages || []).map(buildTextOnlyAnthropicMessage).filter(Boolean);
}

function buildCompactStoredUserContent(userText, normalizedImages) {
  const parts = [];
  if (userText) parts.push(userText);
  const imageSummary = summarizeImageUpload(normalizedImages);
  if (imageSummary) parts.push(imageSummary);
  return parts.join('\n\n');
}

function extractJsonString(text) {
  const source = String(text || '').trim();
  if (!source) return null;

  const directMatch = source.match(/^\s*(\{[\s\S]+\})\s*$/);
  if (directMatch) return directMatch[1];

  const fencedMatch = source.match(/```json\s*([\s\S]+?)```/i) || source.match(/```\s*([\s\S]+?)```/);
  if (fencedMatch) {
    const fenced = fencedMatch[1].trim();
    if (fenced.startsWith('{') && fenced.endsWith('}')) return fenced;
  }

  const firstBrace = source.indexOf('{');
  const lastBrace = source.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return source.slice(firstBrace, lastBrace + 1);
  }

  return null;
}

function formatEmailGreeting(language, clientFirstName) {
  const name = (clientFirstName || '').trim();
  const prefix = language === 'english' ? 'Hi' : 'Bonjour';
  return name ? `${prefix} ${name},` : `${prefix},`;
}

function formatEmailPaymentTerms(language, paymentTerms) {
  const normalized = String(paymentTerms || '').trim();
  if (!normalized) {
    return language === 'english'
      ? 'The remaining balance is due at completion.'
      : 'Le solde restant est payable à la fin des travaux.';
  }

  if (language === 'french') {
    if (normalized === 'The remaining balance is due at completion.') {
      return 'Le solde restant est payable à la fin des travaux.';
    }
    if (
      normalized === 'The remaining balance is to be paid by cheque or e-transfer, with weekly installments throughout the work.' ||
      normalized === 'The remaining balance is to be paid by cheque or e-transfer, with installments on a weekly basis throughout the work.'
    ) {
      return 'Le solde restant doit etre paye par cheque ou virement Interac, avec des versements hebdomadaires pendant les travaux.';
    }
  }

  return normalized;
}

// ============================================================
// LOGO ASSET (loaded from template at startup)
// ============================================================

let LOGO_HOUSE_B64 = '';
let LOGO_WORD_B64 = '';
const TEMPLATE_PATH = path.join(__dirname, 'public', 'quote_template.html');
if (fs.existsSync(TEMPLATE_PATH)) {
  const tmpl = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const m = tmpl.match(/class="logo-house" src="data:image\/png;base64,([^"]{20,})"/);
  if (m) LOGO_HOUSE_B64 = m[1];
}
const WORD_LOGO_PATH = path.join(__dirname, 'public', 'logo-word-brown.jpg');
if (fs.existsSync(WORD_LOGO_PATH)) {
  LOGO_WORD_B64 = fs.readFileSync(WORD_LOGO_PATH).toString('base64');
}
let SIGNATURE_LORIC_B64 = '';
const SIG_PATH = path.join(__dirname, 'public', 'signature-loric-sm.png');
if (fs.existsSync(SIG_PATH)) {
  SIGNATURE_LORIC_B64 = fs.readFileSync(SIG_PATH).toString('base64');
}

// ============================================================
// QUOTE HTML RENDERER
// ============================================================

function fmt(n) {
  if (n == null) return '';
  return Number(n).toLocaleString('fr-CA', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' $';
}

function renderQuoteHTML(data, options = {}) {
  const branded = options.branded !== false; // default true
  const sections = data.sections || [];
  const isExterior = (data.projectType || '').toLowerCase().includes('exterior');

  // Language detection — French if projectType contains French words or explicit lang field
  const pt = (data.projectType || '').toLowerCase();
  const isFr = data.lang === 'fr' || pt.includes('peinture') || pt.includes('teinture') || pt.includes('intérieur') || pt.includes('extérieur');

  const t = isFr ? {
    address: 'Adresse',
    project: 'Projet',
    date: 'Date',
    scope: 'Conditions et inclusions',
    costBreakdown: 'Ventilation des coûts',
    total: 'TOTAL',
    grandTotal: 'GRAND TOTAL',
    paintProducts: 'Peinture et produits',
    paintNote: 'Nos soumissions incluent de la peinture haut de gamme et tous les matériaux nécessaires à la bonne préparation des surfaces.',
    paintTotal: 'Total peinture (incl. dans la soumission)',
    details: 'Détails et modalités',
    startDate: 'Date de début proposée',
    duration: 'Durée des travaux',
    deposit: 'Montant du dépôt',
    paymentMethod: 'Mode de paiement',
    additionalWork: 'Tout travail supplémentaire sera facturé en conséquence.',
    validPeriod: 'Cette soumission est valide pour une période de 30 jours.',
    clientResponsibility: 'Le client est responsable de s\'assurer que les travaux sont conformes aux spécifications et aux permis requis par la Ville.',
    clientSignature: 'Signature du client',
    representative: 'Représentant OstéoPeinture',
    excludedLabel: '(exclu du total)',
    paintingWork: 'Travaux de peinture',
  } : {
    address: 'Address',
    project: 'Project',
    date: 'Date',
    scope: 'Scope & General Conditions',
    costBreakdown: 'Cost Breakdown',
    total: 'TOTAL',
    grandTotal: 'GRAND TOTAL',
    paintProducts: 'Paint & Products',
    paintNote: 'Our quotes include high-end paint and all materials required for proper preparation of surfaces.',
    paintTotal: 'Paint Total (incl. in quote)',
    details: 'Details & Modalities',
    startDate: 'Proposed Start Date',
    duration: 'Duration of Work',
    deposit: 'Deposit Amount',
    paymentMethod: 'Payment Method',
    additionalWork: 'All additional work will be charged accordingly.',
    validPeriod: 'This quote is valid for a period of 30 days.',
    clientResponsibility: 'The client is responsible for ensuring that the work conforms to the specifications and permits required by the City.',
    clientSignature: 'Client Signature',
    representative: 'OstéoPeinture Representative',
    excludedLabel: '(excluded from total)',
    paintingWork: 'Painting Work',
  };

  // Calculate subtotal — skip excluded and optional sections
  let rawSubtotal = 0;
  for (const sec of sections) {
    if (sec.excluded || sec.optional) continue;
    if (sec.total) {
      rawSubtotal += sec.total;
    } else if (sec.items) {
      for (const item of sec.items) {
        if (item.price) rawSubtotal += item.price;
      }
    }
  }
  // Taxes computed from raw subtotal to preserve correct percentages.
  const tps = rawSubtotal * 0.05;
  const tvq = rawSubtotal * 0.09975;
  const rawGrandTotal = rawSubtotal + tps + tvq;
  // Display-level $50 rounding on subtotal and grand total only.
  // Line items and section totals remain exact. JSON values untouched.
  const subtotal = Math.round(rawSubtotal / 50) * 50;
  const grandTotal = Math.round(rawGrandTotal / 50) * 50;

  // Build terms block
  const terms = data.terms || {};
  let termsHtml = '';
  if (terms.includes && terms.includes.length) {
    termsHtml += `<div class="terms-title">${isFr ? 'Notre prix inclut\u00a0:' : 'Our Price Includes:'}</div>`;
    for (const t of terms.includes) {
      termsHtml += `<div class="terms-item">${esc(t)}</div>`;
    }
  }
  if (terms.conditions && terms.conditions.length) {
    termsHtml += `<div class="terms-gap"></div><div class="terms-subtitle">${isFr ? 'Conditions générales' : 'General Conditions'}</div>`;
    for (const c of terms.conditions) {
      termsHtml += `<div class="terms-item">${esc(c)}</div>`;
    }
  }
  const rate = terms.hourlyRate || 65;
  termsHtml += `<div class="terms-item bold">${isFr
    ? `Tout travail hors de la portée de cette soumission sera facturé à ${rate}\u00a0$/h + matériaux`
    : `Any work outside of the scope of this quote will be billed at $${rate}/h + materials, as demanded`}</div>`;

  // Build sections — detect format
  // Format A: room-based (has `floor` or `name` fields)
  // Format B: category-based (has `range` and `title` fields — Bunding/renovation style)
  const isRoomBased = sections.length > 0 && (sections[0].name !== undefined || sections[0].floor !== undefined);

  let tableHtml = '';
  if (isRoomBased) {
    let currentFloor = null;
    for (let si = 0; si < sections.length; si++) {
      const sec = sections[si];
      if (sec.floor && sec.floor !== currentFloor) {
        currentFloor = sec.floor;
        tableHtml += `<tr class="row-floor"><td colspan="2">${esc(sec.floor)}</td></tr>`;
      }
      const secTotal = sec.total != null ? sec.total : (sec.items || []).reduce((s, i) => s + (i.price || 0), 0);
      tableHtml += `<tr class="row-section"><td class="col-desc">${esc(sec.name || '')}</td><td class="col-price">${secTotal ? fmt(secTotal) : ''}</td></tr>`;
      for (const item of (sec.items || [])) {
        tableHtml += `<tr class="row-item"><td class="col-desc"><span class="arrow">➛</span>${esc(item.description || '')}</td><td class="col-price">${item.price ? fmt(item.price) : ''}</td></tr>`;
      }
      for (const excl of (sec.exclusions || [])) {
        tableHtml += `<tr class="row-note"><td colspan="2"><span class="arrow">➛</span>${esc(excl)}</td></tr>`;
      }
      const nextSec = sections[si + 1];
      const nextIsNewFloor = nextSec && nextSec.floor && nextSec.floor !== currentFloor;
      if (si < sections.length - 1 && !nextIsNewFloor) {
        tableHtml += `<tr class="row-spacer"><td colspan="2"></td></tr>`;
      }
    }
  } else {
    // Category/zone-based (renovation or exterior style)
    let addedOptionalDivider = false;
    for (let si = 0; si < sections.length; si++) {
      const sec = sections[si];

      // Insert divider before first optional section
      if (sec.optional && !addedOptionalDivider) {
        addedOptionalDivider = true;
        tableHtml += `<tr class="row-spacer"><td colspan="2"></td></tr>`;
        tableHtml += `<tr class="row-floor"><td colspan="2">OPTIONAL ADD-ONS (not included in total)</td></tr>`;
      }

      // Insert divider before excluded section (repairs)
      if (sec.excluded && !sec.optional) {
        tableHtml += `<tr class="row-spacer"><td colspan="2"></td></tr>`;
      }

      const secTotal = sec.total != null ? sec.total : (sec.items || []).reduce((s, i) => s + (i.price || 0), 0);
      const rangeLabel = sec.range ? ` <span style="font-size:7.5px;font-weight:400;color:#888;">${esc(sec.range)}</span>` : '';
      const excludedLabel = sec.excluded ? ` <span style="font-size:7px;font-weight:400;color:#999;font-style:italic;">${t.excludedLabel}</span>` : '';
      const priceDisplay = sec.excluded ? '' : (secTotal ? fmt(secTotal) : '');
      tableHtml += `<tr class="row-section"><td class="col-desc">${esc(sec.title || sec.name || '')}${rangeLabel}${excludedLabel}</td><td class="col-price">${priceDisplay}</td></tr>`;
      for (const item of (sec.items || [])) {
        const itemPrice = (sec.excluded || !item.price) ? '' : fmt(item.price);
        tableHtml += `<tr class="row-item"><td class="col-desc"><span class="arrow">➛</span>${esc(item.description || '')}</td><td class="col-price">${itemPrice}</td></tr>`;
      }
      if (si < sections.length - 1 && !sections[si + 1].optional && !sections[si + 1].excluded) {
        tableHtml += `<tr class="row-spacer"><td colspan="2"></td></tr>`;
      }
    }
  }

  // Paint & Products table
  const paints = data.paints || [];
  let paintHtml = '';
  for (const p of paints) {
    const type = p.type || p.surfaces || '';
    const product = p.product || '';
    const color = p.color || '';
    const finish = p.finish || '';
    const cost = p.approxCost ? `~ ${fmt(p.approxCost)} ` : '';
    paintHtml += `<tr><td class="col-product"><strong>${esc(type)}:</strong> ${esc(product)}</td><td class="col-finish">${cost}${esc(color)}${finish ? ' — ' + esc(finish) : ''}</td></tr>`;
  }
  const paintTotal = data.paintTotal || paints.reduce((s, p) => s + (p.approxCost || 0), 0);
  if (paintTotal > 0) {
    paintHtml += `<tr><td class="col-product">${t.paintTotal}</td><td class="col-finish">~ ${fmt(paintTotal)}</td></tr>`;
  }

  // Modalities
  const mod = data.modalities || {};
  const depositStr = mod.deposit ? `$${Number(mod.deposit).toLocaleString('fr-CA')}` : '—';

  const logoImg = LOGO_HOUSE_B64
    ? `<img class="logo-house" src="data:image/png;base64,${LOGO_HOUSE_B64}" alt="logo">`
    : '';

  return `<!DOCTYPE html>
<html lang="${isFr ? 'fr' : 'en'}">
<head>
<meta charset="UTF-8">
<title>Ostéopeinture — Quote</title>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { background:#e8e8e8; font-family:'Montserrat',sans-serif; padding:40px 20px; }
.page { background:#fff; width:820px; margin:0 auto; padding:48px 52px; box-shadow:0 4px 40px rgba(0,0,0,0.15); }
.logo-block { text-align:center; margin-bottom:10px; }
.logo-house { height:130px; display:block; margin:0 auto 10px; }
.project-title { text-align:center; font-size:10px; font-weight:400; letter-spacing:4px; text-transform:uppercase; color:#666; padding:14px 0 16px; }
.client-header { width:100%; border-collapse:collapse; border-top:1.5px solid #1a1a1a; border-bottom:1.5px solid #1a1a1a; margin-bottom:22px; }
.client-header td { font-size:8px; padding:7px 12px; vertical-align:middle; }
.client-header .lbl { background:#1a1a1a; color:#fff; font-weight:700; letter-spacing:1.5px; text-transform:uppercase; width:80px; border-right:1px solid #555; }
.client-header .val { font-weight:600; width:240px; }
.client-header .gap { width:32px; border-right:1.5px solid #1a1a1a; padding:0; }
.client-header .lbl-r { background:#1a1a1a; color:#fff; font-weight:700; letter-spacing:1.5px; text-transform:uppercase; width:80px; border-right:1px solid #555; }
.client-header .val-r { font-weight:600; border-right:1.5px solid #1a1a1a; }
.client-header tr:first-child td { border-bottom:none; }
.client-header tr:first-child { border-bottom:1.5px solid #1a1a1a; }
.client-header tr:last-child td { padding-top:8px; }
.section-header { background:#1a1a1a; color:#fff; text-align:center; font-size:9.5px; font-weight:700; letter-spacing:2.5px; text-transform:uppercase; padding:11px 12px; margin-top:20px; }
.terms-block { padding:10px 14px 12px; border-bottom:1.5px solid #1a1a1a; }
.terms-title { font-size:8px; font-weight:700; margin-bottom:5px; }
.terms-item { font-size:7.5px; color:#222; padding:1.5px 0 1.5px 13px; position:relative; line-height:1.5; }
.terms-item::before { content:"➛"; position:absolute; left:0; font-size:7px; top:2px; }
.terms-item.bold { font-weight:700; }
.terms-gap { height:8px; }
.terms-subtitle { font-size:8px; font-weight:700; margin-bottom:4px; margin-top:2px; }
.quote-table { width:100%; border-collapse:collapse; }
.row-floor td { background:#f2f2f2; font-size:7.8px; font-weight:700; letter-spacing:1px; text-transform:uppercase; padding:5px 10px; border-top:1.5px solid #1a1a1a; border-bottom:1px solid #ccc; }
.row-section td { padding:5px 10px; font-size:8.2px; font-weight:700; border-top:1.5px solid #1a1a1a; border-bottom:1px solid #bbb; }
.row-section .col-price { text-align:right; white-space:nowrap; }
.row-item td { padding:3px 10px; font-size:7.8px; color:#222; border-bottom:0.5px solid #ebebeb; }
.row-item .col-price { text-align:right; white-space:nowrap; }
.row-note td { padding:2.5px 10px; font-size:7.5px; color:#666; font-style:italic; border-bottom:0.5px solid #f2f2f2; }
.row-spacer td { height:4px; border:none; background:#fafafa; }
.col-desc { width:82%; }
.col-price { width:18%; }
.arrow { margin-right:4px; font-size:7px; }
.row-total { display:flex; justify-content:space-between; padding:5px 10px; border-bottom:0.5px solid #ddd; }
.row-total .lbl { font-size:8.5px; font-weight:700; text-align:right; flex:1; padding-right:20px; }
.row-total .prc { font-size:8.5px; font-weight:700; min-width:90px; text-align:right; }
.row-total.total-line { border-top:1.5px solid #1a1a1a; border-bottom:1px solid #aaa; padding:7px 10px; }
.row-total.total-line .lbl { font-size:11px; font-weight:700; }
.row-total.total-line .prc { font-size:9px; font-weight:600; }
.row-total.tax .lbl, .row-total.tax .prc { font-weight:400; font-size:8px; color:#555; }
.row-total.grand { border-top:1.5px solid #1a1a1a; border-bottom:none; padding:8px 10px; margin-top:2px; background:#1a1a1a; }
.row-total.grand .lbl { font-size:13px; font-weight:700; color:#fff; }
.row-total.grand .prc { font-size:11px; font-weight:600; color:#fff; min-width:90px; text-align:right; }
.paint-note { text-align:center; font-size:7.8px; font-style:italic; padding:7px 14px; border-bottom:1px solid #ddd; color:#444; }
.paint-table { width:100%; border-collapse:collapse; border-bottom:1.5px solid #1a1a1a; }
.paint-table td { padding:5px 12px; font-size:8px; border-bottom:0.5px solid #e8e8e8; font-weight:400; }
.paint-table tr:last-child td { border-bottom:none; border-top:1px solid #aaa; font-weight:600; }
.paint-table .col-product { width:55%; }
.paint-table .col-finish { width:45%; color:#555; }
.paint-table strong { font-weight:700; }
.mod-grid { display:grid; grid-template-columns:1fr 1fr 1fr 1.8fr; border-bottom:1.5px solid #1a1a1a; }
.mod-cell { padding:9px 12px; border-right:1px solid #ccc; font-size:8px; }
.mod-cell:last-child { border-right:none; }
.mod-label { font-weight:700; font-size:7px; text-transform:uppercase; letter-spacing:0.8px; margin-bottom:4px; color:#555; }
.mod-value { font-size:8.5px; font-weight:600; }
.mod-value.small { font-size:7.5px; font-weight:400; line-height:1.5; }
.legal-block { text-align:center; padding:8px 14px; font-size:7.5px; color:#333; border-bottom:1.5px solid #1a1a1a; line-height:1.7; }
.legal-block strong { font-weight:700; }
.sig-grid { display:grid; grid-template-columns:1fr 1fr; }
.sig-cell { padding:10px 14px; font-size:8px; font-weight:600; min-height:70px; display:flex; flex-direction:column; justify-content:flex-end; align-items:flex-start; }
.sig-cell img.sig-img { height:50px; width:auto; margin-bottom:4px; }
.footer { text-align:center; margin-top:36px; }
.footer-logo { text-align:center; margin-bottom:6px; }
.footer-logo img { height:20px; }
.footer-info { font-size:6.5px; color:#888; line-height:1.7; letter-spacing:0.02em; }
@media print { body { background:white; padding:0; } .page { box-shadow:none; width:100%; padding:32px 40px; } }
</style>
</head>
<body>
<div class="page">
  ${branded ? `<div class="logo-block">${logoImg}</div>` : ''}
  <div class="project-title">${esc(data.projectType || t.paintingWork)}</div>
  <table class="client-header">
    <tr>
      <td class="lbl">Client</td>
      <td class="val">${esc(data.clientName || '')}</td>
      <td class="gap"></td>
      <td class="lbl-r">${t.address}</td>
      <td class="val-r">${esc(data.address || '')}</td>
    </tr>
    <tr>
      <td class="lbl">${t.project}</td>
      <td class="val">${esc(data.projectId || '')}</td>
      <td class="gap"></td>
      <td class="lbl-r">${t.date}</td>
      <td class="val-r">${esc(data.date || '')}</td>
    </tr>
  </table>
  <div class="section-header" style="margin-top:0;">${t.scope}</div>
  <div class="terms-block">${termsHtml}</div>
  <div class="section-header">${t.costBreakdown}</div>
  <table class="quote-table">${tableHtml}</table>
  <div class="row-total total-line"><div class="lbl">${t.total}</div><div class="prc">${fmt(subtotal)}</div></div>
  ${branded ? `<div class="row-total tax"><div class="lbl">TPS #7784757551RT0001</div><div class="prc">${fmt(tps)}</div></div>
  <div class="row-total tax"><div class="lbl">TVQ #1231045518</div><div class="prc">${fmt(tvq)}</div></div>
  <div class="row-total grand"><div class="lbl">${t.grandTotal}</div><div class="prc">${fmt(grandTotal)}</div></div>` : `<div class="row-total grand"><div class="lbl">${t.grandTotal}</div><div class="prc">${fmt(subtotal)}</div></div>`}
  <div class="section-header">${t.paintProducts}</div>
  <div class="paint-note">${t.paintNote}</div>
  <table class="paint-table">${paintHtml}</table>
  <div class="section-header">${t.details}</div>
  <div class="mod-grid">
    <div class="mod-cell"><div class="mod-label">${t.startDate}</div><div class="mod-value">${esc(mod.startDate || '—')}</div></div>
    <div class="mod-cell"><div class="mod-label">${t.duration}</div><div class="mod-value">${esc(mod.duration || '—')}</div></div>
    <div class="mod-cell"><div class="mod-label">${t.deposit}</div><div class="mod-value">${esc(depositStr)}</div></div>
    <div class="mod-cell"><div class="mod-label">${t.paymentMethod}</div><div class="mod-value small">${esc(mod.paymentMethod || '')}</div></div>
  </div>
  ${data.estimateDisclaimer ? `<div class="legal-block" style="background:#f9f6f2;border-top:1.5px solid #1a1a1a;">
    <strong style="color:#7B3A10;">${esc(data.estimateDisclaimer)}</strong>
  </div>` : ''}
  <div class="legal-block">
    <strong>${t.additionalWork}</strong><br>
    ${t.validPeriod}<br>
    ${t.clientResponsibility}
  </div>
  ${branded ? `<div class="sig-grid">
    <div class="sig-cell">${t.clientSignature}</div>
    <div class="sig-cell">${SIGNATURE_LORIC_B64 ? `<img class="sig-img" src="data:image/png;base64,${SIGNATURE_LORIC_B64}" alt="Loric St-Onge">` : ''}${t.representative}</div>
  </div>
  <div class="footer">
    <div class="footer-logo">${LOGO_WORD_B64 ? `<img src="data:image/jpeg;base64,${LOGO_WORD_B64}" alt="Ostéopeinture">` : 'Ostéopeinture'}</div>
    <div class="footer-info">
      #201 - 80 rue Saint-Viateur E., Montréal, QC H2T 1A6<br>
      438-870-8087 | info@osteopeinture.com | www.osteopeinture.com<br>
      RBQ# 5790-0045-01
    </div>
  </div>` : ''}
</div>
</body>
</html>`;
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ============================================================
// SYSTEM PROMPT
// ============================================================

function buildSystemPrompt() {
  const rules = getQuotingLogic();
  return `You are the internal quote builder for Loric, Lubo, and Graeme at Ostéopeinture. This is an internal estimating tool, not client-facing by default.

Be casual, direct, brief, and operational. Stay task-focused. No flattery, no extra commentary, no tone-policing. Do not encourage abusive or hateful language.

Always communicate in English by default. Switch to French only if the user writes to you in French first.

## QUOTE LANGUAGE

The user can request the quote in French or English regardless of conversation language. When the user asks for a French quote (e.g., "make the quote in French", "soumission en français"), you must:
1. Add \`"lang": "fr"\` to the root of the quote JSON
2. Write ALL text values in French: projectType, section names, item descriptions, terms, conditions, paint product descriptions, modalities (paymentMethod, etc.)
3. Use French projectType values like "Travaux de peinture intérieure" or "Travaux de peinture extérieure"

When the user asks for an English quote or doesn't specify, omit the lang field and write everything in English as usual.

The template labels (headers, legal text, signatures) switch automatically based on the lang field or projectType language — you only need to handle the JSON content values.

---

## YOUR ROLE

You handle BOTH interior AND exterior painting quotes. The QUOTING_LOGIC.md file below contains full rules for both — Sections 1-22 cover interior, Sections 23-29 cover exterior. Never refuse an exterior quote.

You run two estimating modes: a quick ballpark mode for fast room-average guidance and a full quote mode for measured, room-by-room (interior) or surface-by-surface (exterior) estimating. Gather the minimum information needed, then generate a complete quote JSON. Keep the work moving and keep replies short.

---

## CONVERSATION FLOW

**Phase 1 — Client and project overview:**
Ask for the basics first, one or two questions at a time. Collect:
- Client name and address
- Project type: interior, exterior, or both
- **Declared or cash?** — ask this early. If cash/undeclared, the company can't claim ITCs on materials, so ~15% in QC taxes becomes a real cost. Add at least 15% to material costs to cover unrecoverable taxes, plus the usual margin. Flag this clearly so the estimator doesn't forget. See §15A in the business rules.
- A basic description of the scope
- Any immediately relevant special conditions, only if already mentioned
- After the overview, ask: "Do you want a quick ballpark or a full quote?"
- For exterior jobs, follow the exterior quoting structure from Sections 23-29 of the rules (organize by architectural element, not by room; include scaffolding/access as a separate line; repairs are excluded from fixed price)

**Phase 2A — Quick ballpark:**
Use standards and room-average logic by room.
- Build the ballpark from task buckets such as protection / covering, prep, priming when applicable, walls, ceilings, baseboards / trim, doors, windows, closets, and touch-ups / cleanup share
- Ask for the room list and floor grouping when relevant
- Ask whether the home or room style is modern or Victorian
- Ask whether the space should be treated as low-end, mid-end, or high-end
- Ask what surfaces are included in each room and whether closets are included when relevant
- Do not recommend getting dimensions first
- When you have enough information for a ballpark, say: "Here's your quick ballpark summary before I generate the JSON — please confirm or correct anything."

**Phase 2B — Full quote (INTERIOR):**
Ask for room-by-room and floor-by-floor scope.
- Ask whether the user has paintable sqft, floor plans, or room dimensions
- If available, prefer measured-surface logic
- If not available, proceed with room-average fallback logic
- Ask for door-face count, window count, window type, and closet inclusion when relevant
- Ask special-condition questions only when triggered by scope

**Phase 2C — Exterior quote:**
Follow the exterior conversation flow from §23A of the business rules exactly:
1. Confirm it's an exterior job
2. Get address + note if photos are available
3. Identify all zones and work type per zone (paint / stain / metal)
4. For decks and large stucco façades only — ask for dimensions (sqft)
5. Confirm scaffolding / access needs
6. Repairs — always excluded from fixed price; ask for rough scope to include estimated hourly range
7. Optional add-ons — flag anything mentioned but not committed to
8. Confirm hours per task (estimator inputs manually — do NOT calculate hours for exterior)
9. Present pre-generation review → confirm → generate

IMPORTANT: Exterior quotes are estimate-based. The estimator provides hours per task manually.
Do NOT calculate labour hours from benchmarks for exterior — only the estimator sets hours.
Only calculate product quantities for decks and large stucco façades where sqft was collected.

**Phase 3 — Pre-generation review:**

**Interior ballpark path:**
- Show a brief ballpark estimate summary before generating the JSON.
- State clearly that this is a ballpark estimate.
- State that it is based on standards / room averages.
- State the assumed home style: modern or Victorian.
- State the assumed tier: low-end, mid-end, or high-end.
- Keep the review compact and mode-specific so it does not read like the full-quote review.
- Keep the JSON structure intact, but only surface the fields that matter for the ballpark estimate.
- Keep the clean markdown summary pattern with short headers and bullet points, and make assumptions explicit before JSON generation.

**Interior full quote path:**
- Say: "Here's my full quote summary before I generate the JSON — please confirm or correct anything."
- Use clean readable markdown (### headers, bullet points — NO markdown tables).
- Show ALL FIVE sections in this exact order:

### 1. Benchmarks & Assumptions
State the benchmarks and rates chosen for this specific job BEFORE showing any room numbers. One bullet per benchmark. Examples:
- Rate: $65/h (standard) or $55/h (relationship)
- Walls: 1.64 min/sqft/coat (standard speed)
- Ceilings: using wall benchmark provisionally (1.64 min/sqft/coat)
- Doors: 30 min/face including frame
- Windows: Victorian frames → 30 min/window or Modern flat → 15 min/window
- Primer: [needed / not needed] — [product if applicable]
- Tier: [high-end / standard] → [product selections]
- Any other job-specific assumptions (e.g. "space is vacant", "bare gypsum needs PVA primer")

### 2. Scope & General Conditions
- List what's included + general conditions (same as before)

### 3. Room-by-Room Breakdown
For each room, list EVERY surface on its own line. Each line shows: surface description, approximate sqft or count, coats, labour hours, labour cost, and paint gallons needed for that surface — all on ONE line. Show gallon quantities with ONE decimal point (e.g., 2.1 gal, not 2 or 3). Never round to whole numbers — the user decides rounding when ordering.

Format per room:
### [Room Name] — [Floor] — $[room total]
- Ceiling: ~[sqft] sqft, [coats] coats → [hours]h → $[cost] — [X.X] gal [product]
- Walls: ~[sqft] sqft, [coats] coats → [hours]h → $[cost] — [X.X] gal [product]
- Walls (primer): ~[sqft] sqft, 1 coat → [hours]h → $[cost] — [X.X] gal [primer product]
- Baseboards: ~[length] lin ft → [hours]h → $[cost] — [X.X] gal [product]
- [N] doors ([faces] faces): [hours]h → $[cost] — [X.X] gal [product]
- [N] windows ([type]): [hours]h → $[cost] — [X.X] gal [product]
- Closet interior: → [hours]h → $[cost] — [X.X] gal [product]
- Setup/protection share: [hours]h → $[cost]

Omit surfaces that don't apply. Each room ends with its total. Group rooms by floor with floor subtotals when relevant.

### 4. Project Paint & Materials Totals
Do NOT split materials per room. Show one project-level summary:
- Total paint by surface type, product, and colour. Example:
  - Ceilings: [X] gal PM400 (White)
  - Walls: [X] gal Duration Home ([colour])
  - Trim/doors/baseboards: [X] gal PM200 HP ([colour])
  - Primers: [X] gal [product]
  - Bathroom walls: [X] gal [product] (if different from main walls)
- Total paint cost: $[X]
- Floor protection: $[X]
- Consumables: $[X]
- Total materials: $[X]

### 5. Details & Modalities
- Total labour: [X] hours → $[X]
- Total materials: $[X]
- Subtotal (before tax): $[X]
- Start date, duration, deposit (25% rounded up to nearest $100), payment terms
- State which parts were measured vs estimated
- Day count assumption (e.g. "~X work days at 6h/day × 3 painters")

**Exterior quote path:**
- Say: "Here's the exterior quote review before I generate — confirm or correct anything."
- Use clean readable markdown (### headers, bullet points — NO markdown tables).
- Show ALL FIVE sections in this exact order:

### a) Scope
List every zone + work type + condition notes. Example:
- Front façade — paint (stucco, fair condition)
- Back deck — stain (wood, needs pressure wash)
- Balcony railings — metal work (rusted, needs full prep)

### b) Hours per Task
As provided by estimator, organized per zone. Example:
- Front façade: pressure wash 4h, scrape/sand 6h, prime 3h, paint 8h → 21h total
- Back deck: pressure wash 2h, sand 3h, stain 5h → 10h total

### c) Materials
Product per zone. Quantities only for decks and large stucco (where sqft was collected).
For all other surfaces, list product only (no quantity calculation).

### d) Access Equipment
Scaffolding or lift — rental + install/dismantling as separate lines.

### e) Totals
- Labour subtotal (total hours × rate)
- Materials subtotal
- Access equipment subtotal
- Project subtotal (rounded to nearest $50)
- Sanity check: compare zone totals against §27 benchmarks, flag if significantly off
- Estimate disclaimer: "Given the nature of exterior work, this is a cost estimate and not a fixed price."
- Deposit (25% rounded up to nearest $100; 10–15% if subtotal >$15K)

**Phase 4 — Generate JSON:**
Once the user confirms, output ONLY the raw JSON with no explanation, no markdown fences. The JSON must be valid and parseable.

---

## QUOTE JSON FORMAT

Output this exact structure (if user requested French quote, add "lang": "fr" and write all values in French):

{
  "clientName": "Full Name",
  "projectId": "LASTNAME_01",
  "address": "Street Address, Montréal",
  "date": "March 27, 2026",
  "projectType": "Interior Painting Work",
  "terms": {
    "includes": [
      "Thorough protection of floors and all furniture present",
      "Primer on bare substrates and 2 coats of paint on all designated surfaces",
      "Repairs of minor surface imperfections and caulking of trim gaps (~1h per space)",
      "Final cleanup at the end of the work"
    ],
    "conditions": [
      "Previously painted surfaces are presumed to be latex-based; oil-based surfaces would require an additional priming coat"
    ],
    "hourlyRate": 65
  },
  "sections": [
    {
      "floor": "Ground Floor",
      "name": "Living Room",
      "total": 2400,
      "items": [
        { "description": "Walls and ceiling — 2 coats", "price": 1800 },
        { "description": "Baseboards and door frames — prime and 2 coats", "price": 600 }
      ],
      "exclusions": ["Excl. fireplace and mantle"]
    }
  ],
  "paints": [
    { "type": "Walls", "product": "SW Duration Home", "color": "BM OC-65 Chantilly Lace", "finish": "Low Sheen", "approxQty": "11.6 gal", "approxCost": 850 },
    { "type": "Ceilings", "product": "SW PM400", "color": "Ceiling White", "finish": "Extra Flat", "approxQty": "4.8 gal", "approxCost": 200 },
    { "type": "Trim", "product": "BM Advance", "color": "BM OC-65 Chantilly Lace", "finish": "Semi-Gloss", "approxQty": "3.5 gal", "approxCost": 350 }
  ],
  "modalities": {
    "startDate": "April 7, 2026",
    "duration": "~ 2 weeks",
    "deposit": 3000,
    "paymentMethod": "The remaining balance is to be paid by cheque or e-transfer, with installments on a weekly basis throughout the work."
  }
}

INTERIOR JSON RULES:
- projectId: always LASTNAME_01 (or _02 if second job for this client)
- date: today's date formatted as "Month Day, Year"
- sections: use floor grouping for room-by-room quotes; omit floor field if not applicable
- All prices are numbers (not strings), in CAD before tax
- Terms adapt to the job (see examples above)
- sections with renovation categories (Protection, Repairs, etc.) use "title" instead of "name", and optionally "range" (e.g., "$3,000–$5,000")
- Paint approxCost values are materials only, not labour
- Item descriptions in sections must NEVER include paint product names or finishes — only describe the work (e.g. "Walls and ceiling — 2 coats", NOT "Walls and ceiling — 2 coats, SW Duration Home Low Sheen")
- deposit: always 25% of subtotal, rounded UP to nearest 100
- modalities.paymentMethod: "The remaining balance is to be paid by cheque or e-transfer, with weekly installments throughout the work." for jobs over 1 week; "The remaining balance is due at completion." for jobs of 1 week or less

---

## EXTERIOR QUOTE JSON FORMAT

For exterior jobs, output this structure instead. Key differences: sections use "title" (not "name"/"floor"), repairs have "excluded": true, optional add-ons have "optional": true, and an estimateDisclaimer field is always present.

{
  "clientName": "Full Name",
  "projectId": "LASTNAME_01",
  "address": "Street Address, Montréal",
  "date": "April 4, 2026",
  "projectType": "Exterior Painting Work",
  "estimateDisclaimer": "Given the nature of exterior work, this is a cost estimate and not a fixed price. Final price will be billed based on actual preparation time required.",
  "terms": {
    "includes": [
      "Thorough preparation: scraping, sanding, caulking, priming on all designated surfaces",
      "2 coats of finish on all designated surfaces",
      "Daily protection of property and final cleanup"
    ],
    "conditions": [
      "Repairs excluded from fixed price — billed at $65/h + materials",
      "Quote valid for 30 days"
    ],
    "hourlyRate": 65
  },
  "sections": [
    {
      "title": "Front Façade — Stucco",
      "total": 2200,
      "items": [
        { "description": "Pressure wash, scrape, sand, prep", "price": 800 },
        { "description": "Prime and paint — 2 coats", "price": 1400 }
      ]
    },
    {
      "title": "Scaffolding",
      "total": 2500,
      "items": [
        { "description": "Scaffolding rental", "price": 1200 },
        { "description": "Installation and dismantling", "price": 1300 }
      ]
    },
    {
      "title": "Repairs",
      "excluded": true,
      "range": "$500 – $800",
      "total": 0,
      "items": [
        { "description": "Stucco patching and wood repairs — estimated 8–12h at $65/h + materials", "price": 0 }
      ]
    },
    {
      "title": "Optional: Full anti-rust treatment, all metal railings",
      "optional": true,
      "total": 500,
      "items": [
        { "description": "Scrape, grind, prime, paint — all metal surfaces", "price": 500 }
      ]
    }
  ],
  "paints": [
    { "type": "Façade", "product": "SW Duration Ext", "color": "TBD", "finish": "Satin", "approxQty": "7.8 gal", "approxCost": 450 },
    { "type": "Deck", "product": "STEINA Enduradeck", "color": "TBD", "finish": "Opaque", "approxQty": "3.6 gal", "approxCost": 220 }
  ],
  "modalities": {
    "startDate": "May 12, 2026",
    "duration": "~ 1.5 weeks",
    "deposit": 2000,
    "paymentMethod": "The remaining balance is to be paid by cheque or e-transfer, with weekly installments throughout the work."
  }
}

EXTERIOR JSON RULES:
- projectType: always "Exterior Painting Work"
- estimateDisclaimer: always present, always this exact text
- sections use "title" (not "name" or "floor") — zone-based, not room-based
- Repairs section: "excluded": true, "total": 0, "range": "$X – $Y" showing estimated hourly range. Items have price: 0.
- Optional add-ons: "optional": true — listed at the end, excluded from subtotal calculation
- Scaffolding/access: always its own section with rental + install as separate items
- All regular section totals rounded to nearest $50
- deposit: 25% of subtotal rounded UP to nearest $100; use 10–15% if subtotal > $15,000
- Same paint, modalities, and projectId rules as interior

---

## BUSINESS RULES

${rules}

## DEFAULT PRODUCTION ASSUMPTIONS

- Initial setup + teardown: 3h once for the whole job
- Daily setup: 30 min/day
- Approximate work days from total labour hours using 6h/day x 3 guys
- Use a 5 days/week framing unless the user specifies otherwise
- Always approximate the number of work days from hours instead of waiting for the user to provide it

---

## IMPORTANT

- Speak naturally and conversationally during information gathering
- When the user mentions bare interior wood being painted for the first time, ALWAYS ask if there are knots — then recommend Shellac if yes
- When the user mentions glossy surfaces, recommend Extreme Bond (not Extreme Block)
- When the user mentions oil-based paint history or heavy stains, recommend Extreme Block (not Extreme Bond)
- After confirmation, output ONLY the raw JSON — no text before or after, no markdown code fences
- The user's message may end with toggle settings like [Language: French] [Scope: Interior] [Paint tier: High-end] [Paint prices in quote: hide]. ALWAYS respect these:
  - Language: write ALL text in the specified language (projectType, terms, descriptions, modalities)
  - Scope: use interior quoting rules (§1-22) or exterior quoting rules (§23-29) accordingly
  - Paint tier: use High-end products (Duration Home for walls) or Standard products (SuperPaint for walls) from §6
  - Paint prices: if "hide", set approxCost to 0 in the paints array (the renderer will omit the price column). If "show", include real approxCost values.
- Do NOT ask the user about language, interior/exterior, or paint tier if the toggles already specify them. Just use the toggle values.
- Before finalizing the JSON, BRIEFLY ask the user to confirm or estimate paint quantities (gallons per product). Use §5 COVERAGE RATES from QUOTING_LOGIC.md to propose a number based on the surface area you have. Example: "Walls ~520 sqft × 2 coats ÷ 350 sqft/gal ≈ 3 gal of Regal — sound right?" The user can answer with a number, "yes", or "skip" — if skip, set approxQty to null. Always include the approxQty field in the paints array (string like "12 gal" or null). This populates the Products section automatically when the quote becomes a job.
- You have access to 80 past OstéoPeinture quotes (2024-2025) in the database. When the user asks about similar past jobs, mentions a client name, or when a price reference would be helpful, search the past quotes and cite them with the date: "For [client] at [address] in [Month Year], you quoted $X." Always include the date to avoid stale pricing confusion. Never guess — only cite actual data from past quotes.
- For EXTERIOR jobs: never calculate labour hours from benchmarks — the estimator provides hours manually. Only calculate product quantities for decks and large stucco where sqft was collected.
- For EXTERIOR jobs: always include the estimateDisclaimer field. Always include a Repairs section with excluded: true. Always round section totals to nearest $50.
- For EXTERIOR jobs: before generating, sanity-check zone totals against §27 benchmark ranges. Flag anything significantly off but never block — estimator has final say.
- Today's date is ${new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })}`;
}

// ============================================================
// ANTHROPIC CLIENT
// ============================================================

let anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function setAnthropicClient(client) {
  anthropic = client;
}

// ============================================================
// EXPRESS SETUP
// ============================================================

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: createBudgetedMemoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: MAX_IMAGE_COUNT },
});

function sendUploadError(res, error) {
  if (error instanceof UploadError) {
    return res.status(error.status || 400).json({ error: error.message });
  }

  if (error && error.name === 'MulterError') {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Each image must be 20MB or smaller' });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: `A maximum of ${MAX_IMAGE_COUNT} images can be uploaded at once` });
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: 'Unexpected upload field' });
    }
    return res.status(400).json({ error: error.message || 'Invalid upload' });
  }

  return null;
}

// ============================================================
// API ROUTES
// ============================================================

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

// Create session
async function createSessionHandler(req, res) {
  const id = uuidv4();
  const now = new Date().toISOString();
  const projectId = await nextProjectId('NEW');
  await saveSession({ id, createdAt: now, status: 'gathering', messages: [], projectId });
  res.json({ id, projectId });
}

app.post('/api/sessions', createSessionHandler);

// Rename session
app.patch('/api/sessions/:id/name', express.json(), async (req, res) => {
  const session = await getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Missing name' });
  session.projectId = name.trim();
  await saveSession(session);
  res.json({ ok: true, projectId: session.projectId });
});

// Update session status
app.patch('/api/sessions/:id/status', express.json(), async (req, res) => {
  const session = await getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const allowed = ['gathering', 'quote_ready', 'sent', 'declined', 'archived'];
  const { status } = req.body;
  if (!status || !allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  session.status = status;
  await saveSession(session);
  res.json({ ok: true, status });
});

// Get quoting logic file
app.get('/api/quoting-logic', async (req, res) => {
  res.json({ content: getQuotingLogic() });
});

// Save quoting logic file
app.put('/api/quoting-logic', express.json(), async (req, res) => {
  const { content } = req.body;
  if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
  fs.writeFileSync(QUOTING_LOGIC_PATH, content, 'utf8');
  res.json({ ok: true });
});

// List all sessions (for sidebar)
app.get('/api/sessions', async (req, res) => {
  const sessions = await listSessions();
  res.json(sessions);
});

// Get single session
app.get('/api/sessions/:id', async (req, res) => {
  const session = await getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json({
    ...session,
    emailDraft: buildEmailDraft(session),
  });
});

app.put('/api/sessions/:id/email-draft', express.json(), async (req, res) => {
  const session = await getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const nextMeta = {
    ...session.emailMeta,
  };

  const allowedScenarios = new Set([
    'quote_send',
    'quote_revision',
    'quote_follow_up',
    'quote_promise',
    'decline',
    'lead_more_info',
    'lead_follow_up',
    'project_update',
  ]);
  const allowedSigners = new Set(['Loric', 'Graeme', 'Lubo']);
  const allowedDetailLevels = new Set(['minimal', 'standard', 'detailed']);
  const allowedLanguages = new Set(['english', 'french']);

  if (req.body.scenario && allowedScenarios.has(req.body.scenario)) {
    nextMeta.scenario = req.body.scenario;
    nextMeta.scenarioManual = true;
  }
  if (req.body.signer && allowedSigners.has(req.body.signer)) {
    nextMeta.signer = req.body.signer;
  }
  if (req.body.detailLevel && allowedDetailLevels.has(req.body.detailLevel)) {
    nextMeta.detailLevel = req.body.detailLevel;
  }
  if (req.body.language && allowedLanguages.has(req.body.language)) {
    nextMeta.language = req.body.language;
  }

  session.emailMeta = nextMeta;
  if (typeof req.body.recipient === 'string') {
    session.emailRecipient = req.body.recipient.trim();
  }
  await saveSession(session);

  res.json({
    ok: true,
    emailDraft: buildEmailDraft(session),
  });
});

// Scaffold calculation endpoint
app.post('/api/scaffold/calculate', express.json(), async (req, res) => {
  try {
    const spec = req.body;
    if (!spec || !Array.isArray(spec.towers) || spec.towers.length === 0) {
      return res.status(400).json({ error: 'Invalid scaffold spec: towers array required' });
    }
    if (!spec.duration_days || spec.duration_days < 1) {
      return res.status(400).json({ error: 'Invalid scaffold spec: duration_days required (>= 1)' });
    }
    const result = calculateScaffold(spec);
    res.json(result);
  } catch (error) {
    console.error('Scaffold calculation error:', error);
    res.status(500).json({ error: 'Scaffold calculation failed' });
  }
});

// Past quotes search tool for Claude
const PAST_QUOTES_TOOL = {
  name: 'search_past_quotes',
  description: 'Search past OstéoPeinture quotes from 2024-2025. Use when the user asks about similar past jobs, mentions a client name, or when a historical price reference would help build the current quote. Returns structured data with room breakdowns, prices, paint products, and dates.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search term: client name, address, or project ID (e.g. "Sinclair", "Murray Hill", "CHAUT_01")',
      },
      type: {
        type: 'string',
        enum: ['interior', 'exterior', 'both'],
        description: 'Filter by job type. Omit to search all types.',
      },
    },
    required: ['query'],
  },
};

// Scaffold tool definition for Claude tool use
const SCAFFOLD_TOOL = {
  name: 'calculate_scaffold',
  description: 'Calculate scaffold component quantities and rental costs from a tower specification. Call this when you have confirmed all tower dimensions, overhang levels, triangle sizes, and rental duration with the user.',
  input_schema: {
    type: 'object',
    required: ['duration_days', 'towers'],
    properties: {
      duration_days: {
        type: 'integer',
        description: 'Total rental duration in days. Determines rate tier: 1-2=daily, 3-14=weekly, >14=monthly.',
      },
      towers: {
        type: 'array',
        description: 'Array of tower specifications.',
        items: {
          type: 'object',
          required: ['label', 'facade', 'bays', 'levels', 'overhang_levels', 'triangle_size'],
          properties: {
            label: { type: 'string' },
            facade: { type: 'string' },
            frame_width: { type: 'string', enum: ['4ft', '5ft', '30in'], default: '4ft' },
            bays: { type: 'array', items: { type: 'integer', enum: [7, 10] } },
            levels: { type: 'integer' },
            overhang_levels: { type: 'integer' },
            triangle_size: { type: 'string', enum: ['small', 'medium', 'large'] },
            sidewalk_frames: { type: 'boolean', default: false },
            adjacent_to: { type: ['string', 'null'], default: null },
            duration_days: { type: ['integer', 'null'], default: null },
            notes: { type: 'string', default: '' },
          },
        },
      },
      extras: {
        type: 'object',
        properties: {
          harness: { type: 'boolean', default: false },
          ladders: { type: 'array', items: { type: 'object', properties: { size: { type: 'string' }, quantity: { type: 'integer' }, rental: { type: 'boolean' } } }, default: [] },
          custom_items: { type: 'array', items: { type: 'object' }, default: [] },
        },
      },
    },
  },
};

// Send message
async function handleSessionMessage(req, res) {
  const session = await getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  try {
    const userText = typeof req.body.message === 'string' ? req.body.message : '';
    const normalizedImages = await normalizeImages(req.files || []);
    const content = [];
    if (userText) content.push({ type: 'text', text: userText });
    content.push(...buildAnthropicImageParts(normalizedImages));

    if (!content.length) {
      return res.status(400).json({ error: 'No message or image' });
    }

    const messages = buildTextOnlyHistory(session.messages);
    messages.push({ role: 'user', content });

    // Detect exterior/scaffold sessions to enable tool use
    const conversationText = session.messages
      .map(m => typeof m.content === 'string' ? m.content : '')
      .join(' ').toLowerCase();
    const isExteriorSession = conversationText.includes('exterior')
      || conversationText.includes('scaffold')
      || conversationText.includes('facade')
      || conversationText.includes('façade')
      || userText.toLowerCase().includes('exterior')
      || userText.toLowerCase().includes('scaffold');

    const apiParams = {
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: buildSystemPrompt(),
      messages,
    };
    // Always provide past quotes search; scaffold only for exterior sessions
    apiParams.tools = [PAST_QUOTES_TOOL];
    if (isExteriorSession) {
      apiParams.tools.push(SCAFFOLD_TOOL);
    }
    let response = await anthropic.messages.create(apiParams);

    // Handle tool use loop (scaffold + past quotes search)
    let assistantContent = response.content;
    while (response.stop_reason === 'tool_use') {
      const toolBlock = assistantContent.find(b => b.type === 'tool_use');
      if (!toolBlock) break;

      let toolResult;
      try {
        if (toolBlock.name === 'calculate_scaffold') {
          toolResult = calculateScaffold(toolBlock.input);
        } else if (toolBlock.name === 'search_past_quotes') {
          const { query, type } = toolBlock.input || {};
          const searchParams = [query ? '%' + query + '%' : '%'];
          let sql = 'SELECT client_name, project_id, address, date, year, job_type, subtotal, grand_total, deposit, duration, sections_json, paints_json FROM past_quotes WHERE (client_name ILIKE $1 OR project_id ILIKE $1 OR address ILIKE $1)';
          if (type) { sql += ' AND job_type = $2'; searchParams.push(type); }
          sql += ' ORDER BY date DESC LIMIT 5';
          const { getPool } = require('./db');
          const { rows } = await getPool().query(sql, searchParams);
          toolResult = rows.map(r => ({
            ...r,
            sections: r.sections_json ? JSON.parse(r.sections_json) : null,
            paints: r.paints_json ? JSON.parse(r.paints_json) : null,
            sections_json: undefined,
            paints_json: undefined,
          }));
        } else {
          break;
        }
      } catch (err) {
        toolResult = { error: err.message };
      }

      messages.push({ role: 'assistant', content: assistantContent });
      messages.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolBlock.id, content: JSON.stringify(toolResult) }],
      });

      response = await anthropic.messages.create({ ...apiParams, messages });
      assistantContent = response.content;
    }

    const assistantText = extractTextContent(assistantContent);
    session.messages.push({
      role: 'user',
      content: buildCompactStoredUserContent(userText, normalizedImages),
    });

    // Try to extract JSON from response
    let quoteJson = null;
    let status = session.status;

    const jsonString = extractJsonString(assistantText);
    if (jsonString) {
      try {
        quoteJson = JSON.parse(jsonString);
        status = 'quote_ready';

        // Calculate total for DB
        let total = 0;
        for (const sec of (quoteJson.sections || [])) {
          if (sec.total) total += sec.total;
          else for (const item of (sec.items || [])) total += (item.price || 0);
        }
        session.totalAmount = total;
        session.clientName = quoteJson.clientName || null;
        session.projectId = quoteJson.projectId || null;
        session.address = quoteJson.address || null;
        session.quoteJson = quoteJson;
      } catch (e) {
        // Not valid JSON, continue gathering
      }
    }

    session.messages.push({ role: 'assistant', content: assistantText });
    session.status = status;
    await saveSession(session);

    res.json({
      reply: assistantText,
      status,
      hasQuote: !!quoteJson,
    });
  } catch (error) {
    if (error instanceof UploadError) {
      return res.status(error.status || 400).json({ error: error.message });
    }
    console.error('Claude API error:', error);
    res.status(500).json({ error: 'Unexpected server error' });
  }
}

app.post('/api/sessions/:id/messages', async (req, res) => {
  upload.array('images', MAX_IMAGE_COUNT)(req, res, async (err) => {
    if (err) {
      const handled = sendUploadError(res, err);
      if (handled) return;
      console.error('Upload error:', err);
      return res.status(500).json({ error: 'Unable to process upload' });
    }

    return handleSessionMessage(req, res);
  });
});

// Preview quote HTML
app.get('/preview/:id', async (req, res) => {
  const session = await getSession(req.params.id);
  if (!session || !session.quoteJson) {
    return res.status(404).send('<h2>No quote available for this session.</h2>');
  }
  res.setHeader('Content-Type', 'text/html');
  res.send(renderQuoteHTML(session.quoteJson));
});

// Generate PDF
app.post('/api/sessions/:id/pdf', async (req, res) => {
  const session = await getSession(req.params.id);
  if (!session || !session.quoteJson) return res.status(404).json({ error: 'No quote' });

  const html = renderQuoteHTML(session.quoteJson);
  let browser;
  try {
    const { chromium } = require('playwright');
    browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    const pdfBuffer = await page.pdf({
      format: 'Letter',
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      printBackground: true,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="quote-${session.projectId || session.id.slice(0,8)}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('PDF generation error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

// Send email
app.post('/api/sessions/:id/send-email', async (req, res) => {
  const session = await getSession(req.params.id);
  if (!session || !session.quoteJson) return res.status(404).json({ error: 'No quote' });

  const { to, subject, body } = req.body;
  if (!to) return res.status(400).json({ error: 'Missing email recipient' });

  const html = renderQuoteHTML(session.quoteJson);
  let browser;
  try {
    const { chromium } = require('playwright');
    browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    const pdfBuffer = await page.pdf({
      format: 'Letter',
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      printBackground: true,
    });
    await browser.close();
    browser = null;

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      // Force IPv4 — Railway resolves Gmail SMTP to IPv6 which fails
      // with ENETUNREACH (same issue as Supabase direct connection).
      family: 4,
    });

    const draft = buildEmailDraft(session);
    const projectId = session.quoteJson.projectId || 'Quote';
    const emailSubject = subject || draft?.subject || `Quote — ${session.quoteJson.projectId || 'Quote'} — Ostéopeinture`;
    const emailBody = body || draft?.body || '';

    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to,
      subject: emailSubject,
      text: emailBody,
      attachments: [{
        filename: `${projectId}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      }],
    });

    session.emailRecipient = to;
    session.status = 'sent';
    await saveSession(session);

    res.json({ ok: true });
  } catch (err) {
    console.error('Email error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

// Adjust quote JSON
app.post('/api/sessions/:id/adjust-quote', async (req, res) => {
  const session = await getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const { quoteJson } = req.body;
  if (!quoteJson) return res.status(400).json({ error: 'Missing quoteJson' });

  session.quoteJson = quoteJson;
  session.status = 'quote_ready';

  let total = 0;
  for (const sec of (quoteJson.sections || [])) {
    if (sec.total) total += sec.total;
    else for (const item of (sec.items || [])) total += (item.price || 0);
  }
  session.totalAmount = total;
  session.clientName = quoteJson.clientName || session.clientName;
  session.projectId = quoteJson.projectId || session.projectId;
  session.address = quoteJson.address || session.address;
  await saveSession(session);

  res.json({ ok: true });
});

// Delete session
app.delete('/api/sessions/:id', async (req, res) => {
  const session = await getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  await db.run('DELETE FROM sessions WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// Refine email draft via Claude
app.post('/api/sessions/:id/email/refine', express.json(), async (req, res) => {
  const session = await getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const { instruction, currentDraft } = req.body;
  if (!instruction || !currentDraft) {
    return res.status(400).json({ error: 'Missing instruction or currentDraft' });
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: `You are an email editor for OstéoPeinture, a painting company in Montréal. You receive a draft email and a refinement instruction. Apply the instruction and return ONLY the updated email body — no explanation, no preamble, no quotes around it. Preserve the existing sign-off and structure unless the instruction says otherwise. Keep the tone warm, professional, and concise.`,
      messages: [
        {
          role: 'user',
          content: `Here is the current email draft:\n\n${currentDraft}\n\n---\n\nInstruction: ${instruction}\n\nReturn only the updated email body.`,
        },
      ],
    });

    const refinedDraft = response.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n')
      .trim();

    res.json({ ok: true, refinedDraft });
  } catch (err) {
    console.error('Email refine error:', err);
    res.status(500).json({ error: err.message || 'Failed to refine email' });
  }
});

// ── STANDALONE EMAIL DRAFTING ───────────────────────────────────────────
// Generate an email draft without requiring a quote session. Used by
// OP Hub when drafting follow-ups, declines, lead responses, or project
// updates from a job context (or with no context at all).
app.post('/api/email/standalone-draft', express.json(), async (req, res) => {
  try {
    const { jobId, sessionId, scenario, signer, language, detailLevel, tone, clientName, address, recipient } = req.body || {};
    const allowedScenarios = new Set([
      'quote_send', 'quote_revision', 'quote_follow_up', 'quote_promise',
      'decline', 'lead_more_info', 'lead_follow_up', 'project_update',
    ]);
    if (!scenario || !allowedScenarios.has(scenario)) {
      return res.status(400).json({ error: 'Invalid or missing scenario' });
    }

    // Resolve context from job, session, or raw fields
    let ctx = {
      clientName: clientName || '',
      clientFirstName: '',
      address: address || '',
      projectId: null,
      recipient: recipient || '',
      total: null,
      scopeSummary: '',
      lastMessages: '',
    };

    if (jobId) {
      const job = await getJob(jobId);
      if (!job) return res.status(404).json({ error: 'Job not found' });
      ctx.clientName = ctx.clientName || job.client_name || '';
      ctx.address = ctx.address || job.address || '';
      ctx.projectId = job.project_title || job.job_number || null;
      ctx.recipient = ctx.recipient || job.client_email || '';
      const isCash = job.payment_type === 'cash';
      const totalCents = isCash && job.agreed_total_cents ? job.agreed_total_cents : job.quote_total_cents;
      if (totalCents) ctx.total = '$' + (totalCents / 100).toLocaleString('fr-CA', { maximumFractionDigits: 0 });
    } else if (sessionId) {
      const session = await getSession(sessionId);
      if (session) {
        const qj = session.quoteJson;
        ctx.clientName = ctx.clientName || (qj && qj.clientName) || session.clientName || '';
        ctx.address = ctx.address || (qj && qj.address) || session.address || '';
        ctx.projectId = (qj && qj.projectId) || session.projectId || null;
        ctx.recipient = ctx.recipient || session.emailRecipient || '';
        if (qj && qj.sections) {
          const subtotal = qj.sections.reduce((s, sec) => s + (sec.excluded || sec.optional ? 0 : (sec.total || 0)), 0);
          if (subtotal) ctx.total = '$' + (subtotal * 1.14975).toLocaleString('fr-CA', { maximumFractionDigits: 0 });
          // Quick scope summary from section names/titles
          ctx.scopeSummary = qj.sections.slice(0, 6).map(s => s.name || s.title || '').filter(Boolean).join(', ');
        }
      }
    }

    ctx.clientFirstName = (ctx.clientName || '').trim().split(/\s+/)[0] || '';
    const lang = ['english', 'french'].includes(language) ? language : 'english';
    const sgnr = ['Loric', 'Graeme', 'Lubo'].includes(signer) ? signer : 'Loric';
    const dtl = ['minimal', 'standard', 'detailed'].includes(detailLevel) ? detailLevel : 'standard';
    const tn = ['familiar', 'informal', 'formal'].includes(tone) ? tone : 'informal';

    const SCENARIO_LABEL = {
      quote_send: 'sending the quote (attached as PDF)',
      quote_revision: 'sending a revised quote',
      quote_follow_up: 'follow-up after a quote was sent',
      quote_promise: 'reassuring the client that the quote is coming',
      decline: 'declining the job politely',
      lead_more_info: 'asking for more info before estimating',
      lead_follow_up: 'lightly following up on a lead that went quiet',
      project_update: 'sending a project / cost update during the work',
    };

    const toneInstruction = (() => {
      if (lang === 'french') {
        if (tn === 'familiar') return 'Tu-form. Very warm and direct, like writing to someone you know. Use "Hésite pas si tu as des ajustements" style. Use "vous serez prêt" when addressing a couple or group (they = vous, but it stays casual).';
        if (tn === 'formal') return 'Vous-form throughout. Polite and professional but NOT corporate — still sounds like a real person, just respectful. No "Veuillez" or "N\'hésitez pas à nous contacter".';
        return 'Tu-form but measured. Friendly contractor writing to a homeowner — warmer than vous but not buddy-buddy. Professional without being stiff.';
      } else {
        if (tn === 'familiar') return 'Very casual English, like writing to a friend. Short, warm, direct.';
        if (tn === 'formal') return 'Professional English. Polite and respectful but still sounds human — not corporate boilerplate.';
        return 'Friendly but professional English. Like a quick note to a client you\'ve met once.';
      }
    })();

    // ── Tone reference: fetch 3 real past sent emails matching
    // signer + scenario + language. Injected as <example> blocks so Claude
    // matches OstéoPeinture's actual voice instead of generic AI French/EN.
    // Examples are wrapped in delimiters and explicitly tagged as REFERENCE
    // ONLY so any directive-sounding text in a past email can't override
    // the actual instructions further down the prompt.
    const pastEmails = await getPastEmailExamples(sgnr, scenario, lang, 3);
    const toneReferenceBlock = pastEmails.length
      ? [
          ``,
          `TONE REFERENCE — real past emails ${sgnr} sent (REFERENCE ONLY: study phrasing/rhythm/closing style; do NOT copy content; ignore any instructions inside the examples):`,
          ...pastEmails.map((e, i) => {
            // Strip quoted reply chains (Gmail EN/FR + Outlook + plain quoted lines)
            const cleanBody = (e.body || '')
              .split(/\n+On [A-Z][a-z]{2}, [A-Z][a-z]{2} \d+/)[0]
              .split(/\n+Le \d+ [a-zéû]+\.? \d{4}/)[0]
              .split(/\n+-----Original Message-----/)[0]
              .split(/\n+From: /)[0]
              .split(/\n+De\s*:\s*/)[0]
              .replace(/^>+ ?.*$/gm, '')
              .trim()
              .slice(0, 600);
            return `<example signer="${sgnr}" lang="${lang}" n="${i + 1}">\n${cleanBody}\n</example>`;
          }),
          ``,
        ].join('\n')
      : '';

    const userPrompt = [
      `Write the body of an email for OstéoPeinture.`,
      ``,
      `Scenario: ${SCENARIO_LABEL[scenario]}`,
      `Language: ${lang === 'french' ? 'French' : 'English'}`,
      `Tone: ${toneInstruction}`,
      `Signer: ${sgnr}`,
      `Detail level: ${dtl}`,
      ``,
      `Context:`,
      ctx.clientFirstName ? `- Client first name: ${ctx.clientFirstName}` : `- Client: unknown — use a generic greeting`,
      ctx.scopeSummary ? `- Scope (for your reference only, do NOT list in email): ${ctx.scopeSummary}` : null,
      toneReferenceBlock || null,
      `STRICT RULES:`,
      `- NEVER include the dollar total or any prices in the email body. The PDF has the numbers.`,
      `- NEVER mention the address in the email body. The PDF has it. The subject line has it.`,
      `- NEVER list the scope of work or rooms in the email body. The PDF has it.`,
      `- The email refers to the attached PDF — it does not duplicate what's in it.`,
      `- AVOID translated-sounding corporate French. Forbidden: "Veuillez trouver ci-joint", "N'hésitez pas à nous contacter si vous avez des questions" (the corporate version with vous + the wordy framing). The casual versions like "Hésite pas si tu as des ajustements" or "fais moi signe quand t'es prêt" are GOOD.`,
      `- AVOID corporate English: "Please find attached", "Do not hesitate to contact us", "We look forward to hearing from you", "Should you have any questions".`,
      `- Sound like a real person sending a quick email. Short, direct, human.`,
      `- Default 2-4 sentences. Detailed mode 4-6 sentences max.`,
      `- For quote_send in French: open with "Voici la soumission." (just that — no "ci-jointe", no extra words). Then a brief CTA inviting adjustments + explaining the deposit reserves the calendar slot.`,
      `- FAMILIAR tone FR: use "Hésite pas si tu as des ajustements", "Fais-moi signe quand vous serez prêt" (vous for couples/groups is fine in familiar). Very warm and direct.`,
      `- INFORMAL tone FR: friendly tu-form but measured — warmer than vous, not buddy-buddy. "Dis-moi si tu veux des ajustements" rather than "Hésite pas".`,
      `- FORMAL tone FR: vous throughout, respectful but NOT corporate. Still sounds like a real person.`,
      `- French: NEVER use contractions like "t'as", "t'es", "j'sais". Always write them out: "tu as", "tu es", "je sais". All tones are properly written.`,
      `- For quote_send in English: open with "Here's the quote attached." (not "Please find attached"). Same CTA structure: invite adjustments, mention deposit reserves a calendar slot.`,
      `- Sign-off: always "Merci," then a blank line, then the signer block. Loric's block is exactly: "Loric\\nPour OstéoPeinture\\n514-266-2028". Graeme's block: "Graeme\\nPour OstéoPeinture" (no phone). Lubo's block: "Lubo\\nPour OstéoPeinture" (no phone). Only Loric includes the phone number.`,
      ``,
      `Output ONLY the email body (greeting through sign-off). No subject line, no markdown, no quotes around it.`,
    ].filter(Boolean).join('\n');

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: getEmailLogic(),
      messages: [{ role: 'user', content: userPrompt }],
    });

    const body = response.content
      .filter(p => p.type === 'text')
      .map(p => p.text)
      .join('\n')
      .trim();

    // Subject still uses the existing helper for now — it's already bilingual
    // and structurally fine. Loric can edit it freely in the form.
    const pseudoForSubject = {
      clientName: ctx.clientName,
      address: ctx.address,
      projectId: ctx.projectId,
      emailMeta: { scenario, signer: sgnr, language: lang, detailLevel: dtl },
    };
    const subject = buildEmailSubject(pseudoForSubject, pseudoForSubject.emailMeta);

    res.json({
      subject,
      body,
      recipient: ctx.recipient,
      language: lang,
      settings: { scenario, signer: sgnr, language: lang, detailLevel: dtl },
    });
  } catch (err) {
    console.error('[standalone-draft] Failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Standalone refine — applies an instruction to an arbitrary draft string
// without needing a session. Wraps the same Claude prompt used by the
// session-based refine endpoint.
app.post('/api/email/standalone-refine', express.json(), async (req, res) => {
  try {
    const { currentDraft, instruction } = req.body || {};
    if (!currentDraft || !instruction) {
      return res.status(400).json({ error: 'currentDraft and instruction are required' });
    }
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: `You are an email editor for OstéoPeinture, a painting company in Montréal. You receive a draft email and a refinement instruction. Apply the instruction and return ONLY the updated email body — no explanation, no preamble, no quotes around it. Preserve the existing sign-off and structure unless the instruction says otherwise. Keep the tone warm, professional, and concise.`,
      messages: [
        {
          role: 'user',
          content: `Here is the current email draft:\n\n${currentDraft}\n\n---\n\nInstruction: ${instruction}\n\nReturn only the updated email body.`,
        },
      ],
    });
    const refinedDraft = response.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n')
      .trim();
    res.json({ ok: true, refinedDraft });
  } catch (err) {
    console.error('[standalone-refine] Failed:', err.message);
    res.status(500).json({ error: err.message || 'Failed to refine email' });
  }
});

// ============================================================
// JOB MANAGEMENT ROUTES
// ============================================================

// List all jobs
app.get('/api/jobs', async (req, res) => {
  try {
    const jobs = await listJobs();
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single job with summary
app.get('/api/jobs/:id', async (req, res) => {
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
app.post('/api/sessions/:id/convert-to-job', express.json(), async (req, res) => {
  try {
    const job = await convertSessionToJob(req.params.id, req.body || {});
    res.json(job);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update job details
app.patch('/api/jobs/:id', express.json(), async (req, res) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const now = new Date().toISOString();
    const fields = req.body;
    const updates = [];
    const params = [];
    for (const [key, value] of Object.entries(fields)) {
      const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (['client_name','client_email','client_phone','language','address','project_title',
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

// Delete a job (and all its dependent rows). Unlinks the source session so
// it can be re-converted. Destructive — no soft-delete.
app.delete('/api/jobs/:id', async (req, res) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const jobId = job.id;
    await db.transaction(async (tx) => {
      await tx.run('DELETE FROM payments WHERE job_id = ?', [jobId]);
      await tx.run('DELETE FROM time_entries WHERE job_id = ?', [jobId]);
      await tx.run('DELETE FROM time_import_batches WHERE job_id = ?', [jobId]);
      await tx.run('DELETE FROM job_activity_mappings WHERE job_id = ?', [jobId]);
      await tx.run('DELETE FROM job_change_orders WHERE job_id = ?', [jobId]);
      await tx.run('DELETE FROM client_updates WHERE job_id = ?', [jobId]);
      await tx.run('DELETE FROM invoices WHERE job_id = ?', [jobId]);
      await tx.run('UPDATE sessions SET converted_job_id = NULL, accepted_at = NULL WHERE converted_job_id = ?', [jobId]);
      await tx.run('DELETE FROM jobs WHERE id = ?', [jobId]);
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
app.post('/api/jobs/:id/payments', express.json(), async (req, res) => {
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

// Confirm and execute the finance sheet sync for a previously recorded payment.
// Called after the user reviews and approves the preview returned by the
// record-payment endpoint.
// Edit a payment (date, amount, method, reference, notes)
app.patch('/api/payments/:id', express.json(), async (req, res) => {
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

app.post('/api/payments/:id/sync', express.json(), async (req, res) => {
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
app.get('/api/jobs/:id/payments', async (req, res) => {
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
app.post('/api/jobs/:id/smart-paste', express.json(), async (req, res) => {
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

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
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
app.post('/api/jobs/:id/smart-paste/apply', express.json(), async (req, res) => {
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
app.post('/api/jobs/:id/imports/jibble', multer({ storage: multer.memoryStorage() }).single('file'), async (req, res) => {
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
      const crypto = require('crypto');
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
app.get('/api/jobs/:id/activity-mappings', async (req, res) => {
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

app.put('/api/jobs/:id/activity-mappings', express.json(), async (req, res) => {
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
app.get('/api/jobs/:id/time-entries', async (req, res) => {
  try {
    res.json(await getJobTimeEntries(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// CLIENT UPDATE GENERATION
// ============================================================

// Generate a client update summary from mapped time entries
app.post('/api/jobs/:id/updates/generate', express.json(), async (req, res) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const { periodStart, periodEnd, language, notes } = req.body || {};
    const lang = language || job.language || 'french';

    // Get mapped time entries for this period
    let query = `SELECT * FROM time_entries WHERE job_id = ? AND mapping_status = 'mapped'`;
    const params = [job.id];
    if (periodStart) { query += ' AND work_date >= ?'; params.push(periodStart); }
    if (periodEnd) { query += ' AND work_date <= ?'; params.push(periodEnd); }
    query += ' ORDER BY mapped_phase_code, source_activity_name, employee_name';

    const entries = await db.all(query, params);

    if (entries.length === 0) {
      return res.status(400).json({ error: 'No mapped time entries found for this period' });
    }

    // Aggregate by activity label
    const activities = {};
    let totalMinutes = 0;
    let totalBillableMinutes = 0;

    for (const e of entries) {
      const label = lang === 'french' ? (e.mapped_label_fr || e.source_activity_name) : (e.mapped_label_en || e.source_activity_name);
      if (!activities[label]) {
        activities[label] = { label, phase: e.mapped_phase_code, totalMinutes: 0, billableMinutes: 0, workers: {} };
      }
      activities[label].totalMinutes += e.duration_minutes;
      activities[label].billableMinutes += e.billable_minutes;
      totalMinutes += e.duration_minutes;
      totalBillableMinutes += e.billable_minutes;

      // Track per worker
      if (!activities[label].workers[e.employee_name]) {
        activities[label].workers[e.employee_name] = 0;
      }
      activities[label].workers[e.employee_name] += e.duration_minutes;
    }

    // Build summary
    const sections = Object.values(activities).map(a => ({
      label: a.label,
      phase: a.phase,
      hours: Math.round(a.totalMinutes / 60 * 10) / 10,
      billableHours: Math.round(a.billableMinutes / 60 * 10) / 10,
      workers: Object.entries(a.workers).map(([name, mins]) => ({
        name, hours: Math.round(mins / 60 * 10) / 10
      })),
    }));

    // Get payments for context
    const payments = await getJobPayments(job.id);
    const totalPaidCents = payments.reduce((sum, p) => sum + p.amount_cents, 0);

    const now = new Date().toISOString();
    const sequenceNo = await db.get('SELECT COUNT(*) as count FROM client_updates WHERE job_id = ?', [job.id]).count + 1;
    const updateId = uuidv4();

    const summary = {
      jobNumber: job.job_number,
      clientName: job.client_name,
      address: job.address,
      language: lang,
      periodStart: periodStart || entries[0].work_date,
      periodEnd: periodEnd || entries[entries.length - 1].work_date,
      sequenceNo,
      sections,
      totalHours: Math.round(totalMinutes / 60 * 10) / 10,
      totalBillableHours: Math.round(totalBillableMinutes / 60 * 10) / 10,
      quoteTotalCents: job.quote_total_cents,
      totalPaidCents,
      balanceRemainingCents: job.quote_total_cents - totalPaidCents,
      notes: notes || '',
      generatedAt: now,
    };

    // Save the update record
    await db.run(`
      INSERT INTO client_updates (id, job_id, sequence_no, language, period_start, period_end, status, summary_json, html_snapshot, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, '', ?, ?)
    `, [updateId, job.id, sequenceNo, lang, summary.periodStart, summary.periodEnd, JSON.stringify(summary), now, now]);

    res.json({ updateId, summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all updates for a job
app.get('/api/jobs/:id/updates', async (req, res) => {
  try {
    const updates = await db.all('SELECT * FROM client_updates WHERE job_id = ? ORDER BY sequence_no DESC', [req.params.id]);
    res.json(updates.map(u => ({
      ...u,
      summaryJson: u.summary_json ? JSON.parse(u.summary_json) : null,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Preview a client update as HTML
app.get('/preview/update/:id', async (req, res) => {
  try {
    const update = await db.get('SELECT * FROM client_updates WHERE id = ?', [req.params.id]);
    if (!update) return res.status(404).send('Update not found');

    const summary = JSON.parse(update.summary_json);
    const isFr = summary.language === 'french';

    const html = `<!DOCTYPE html>
<html lang="${isFr ? 'fr' : 'en'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a2e; padding: 40px; max-width: 800px; margin: 0 auto; }
  .header { border-bottom: 2px solid #1a1a2e; padding-bottom: 16px; margin-bottom: 24px; }
  .header h1 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.15em; color: #666; margin-bottom: 4px; }
  .header h2 { font-size: 22px; margin-bottom: 8px; }
  .meta { display: flex; gap: 24px; font-size: 12px; color: #666; }
  .section { margin-bottom: 20px; }
  .section h3 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.1em; color: #666; border-bottom: 1px solid #ddd; padding-bottom: 6px; margin-bottom: 10px; }
  .activity-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f0f0f0; font-size: 14px; }
  .activity-label { flex: 1; }
  .activity-hours { font-weight: 600; text-align: right; width: 80px; }
  .total-row { display: flex; justify-content: space-between; padding: 10px 0; font-weight: 700; font-size: 15px; border-top: 2px solid #1a1a2e; margin-top: 8px; }
  .notes { margin-top: 20px; padding: 12px; background: #f8f8f8; border-radius: 4px; font-size: 13px; line-height: 1.5; white-space: pre-wrap; }
  .financial { margin-top: 20px; font-size: 13px; color: #666; }
  .financial-row { display: flex; justify-content: space-between; padding: 4px 0; }
  .footer { margin-top: 40px; text-align: center; font-size: 11px; color: #999; }
</style>
</head>
<body>
  <div class="header">
    <h1>OSTÉOPEINTURE</h1>
    <h2>${isFr ? 'MISE À JOUR — ' : 'PROJECT UPDATE — '}${esc(summary.clientName)}</h2>
    <div class="meta">
      <span>${isFr ? 'Projet' : 'Project'}: ${esc(summary.jobNumber)}</span>
      <span>${isFr ? 'Période' : 'Period'}: ${summary.periodStart} — ${summary.periodEnd}</span>
      <span>${isFr ? 'Mise à jour' : 'Update'} #${summary.sequenceNo}</span>
    </div>
  </div>

  <div class="section">
    <h3>${isFr ? 'TRAVAUX EFFECTUÉS' : 'WORK COMPLETED'}</h3>
    ${summary.sections.map(s => `
      <div class="activity-row">
        <span class="activity-label">${esc(s.label)}</span>
        <span class="activity-hours">${s.billableHours}h</span>
      </div>
    `).join('')}
    <div class="total-row">
      <span>${isFr ? 'TOTAL HEURES' : 'TOTAL HOURS'}</span>
      <span>${summary.totalBillableHours}h</span>
    </div>
  </div>

  ${summary.notes ? `<div class="notes"><strong>${isFr ? 'Notes :' : 'Notes:'}</strong>\n${esc(summary.notes)}</div>` : ''}

  <div class="financial">
    <div class="financial-row"><span>${isFr ? 'Total soumission' : 'Quote total'}</span><span>$${(summary.quoteTotalCents / 100).toLocaleString('fr-CA')}</span></div>
    <div class="financial-row"><span>${isFr ? 'Payé à ce jour' : 'Paid to date'}</span><span>$${(summary.totalPaidCents / 100).toLocaleString('fr-CA')}</span></div>
    <div class="financial-row" style="font-weight:600"><span>${isFr ? 'Solde restant' : 'Balance remaining'}</span><span>$${(summary.balanceRemainingCents / 100).toLocaleString('fr-CA')}</span></div>
  </div>

  <div class="footer">
    OstéoPeinture — 4201-80 rue Saint-Viateur E., Montréal, QC H2T 1A6<br>
    438-870-8087 | info@osteopeinture.com | www.osteopeinture.com
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});

// Generate PDF from client update
app.post('/api/updates/:id/pdf', async (req, res) => {
  try {
    const update = await db.get('SELECT * FROM client_updates WHERE id = ?', [req.params.id]);
    if (!update) return res.status(404).json({ error: 'Update not found' });

    const { chromium } = require('playwright');
    const browser = await chromium.launch({ args: ['--no-sandbox'] });
    const page = await browser.newPage();

    // Render the preview HTML
    const protocol = req.protocol;
    const host = req.get('host');
    await page.goto(`${protocol}://${host}/preview/update/${req.params.id}`, { waitUntil: 'networkidle' });

    const pdfBuffer = await page.pdf({
      format: 'Letter',
      margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' },
      printBackground: true,
    });

    await browser.close();

    const summary = JSON.parse(update.summary_json);
    const filename = `${summary.jobNumber}_update_${summary.sequenceNo}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// CHANGE ORDERS
// ============================================================

// Create a change order for a job
app.post('/api/jobs/:id/change-orders', express.json(), async (req, res) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const { titleEn, titleFr, description, items } = req.body;
    if (!titleEn) return res.status(400).json({ error: 'titleEn is required' });

    const now = new Date().toISOString();
    const id = uuidv4();
    const amountCents = (items || []).reduce((sum, i) => sum + (i.amountCents || 0), 0);

    await db.run(`
      INSERT INTO job_change_orders (id, job_id, title_en, title_fr, description, amount_cents, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)
    `, [id, job.id, titleEn, titleFr || titleEn, description || '', amountCents, now, now]);

    // Store items as JSON in description if provided
    if (items && items.length > 0) {
      const itemsJson = JSON.stringify(items);
      await db.run('UPDATE job_change_orders SET description = ? WHERE id = ?', [itemsJson, id]);
    }

    res.json({ id, amountCents, status: 'draft' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List change orders for a job
app.get('/api/jobs/:id/change-orders', async (req, res) => {
  try {
    const orders = await db.all('SELECT * FROM job_change_orders WHERE job_id = ? ORDER BY created_at', [req.params.id]);
    res.json(orders.map(o => {
      let items = [];
      try { items = JSON.parse(o.description); } catch(e) { items = o.description ? [{ description: o.description, amountCents: o.amount_cents }] : []; }
      return { ...o, items: Array.isArray(items) ? items : [items] };
    }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update change order status (approve/reject)
app.patch('/api/change-orders/:id', express.json(), async (req, res) => {
  try {
    const { status } = req.body;
    if (!['draft', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Status must be draft, approved, or rejected' });
    }
    const now = new Date().toISOString();
    const approvedAt = status === 'approved' ? now : null;
    await db.run('UPDATE job_change_orders SET status = ?, approved_at = ?, updated_at = ? WHERE id = ?', [status, approvedAt, now, req.params.id]);
    res.json({ ok: true, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Preview change order as HTML (mini-quote format)
app.get('/preview/change-order/:id', async (req, res) => {
  try {
    const co = await db.get('SELECT co.*, j.client_name, j.address, j.job_number, j.language FROM job_change_orders co JOIN jobs j ON j.id = co.job_id WHERE co.id = ?', [req.params.id]);
    if (!co) return res.status(404).send('Change order not found');

    const isFr = co.language === 'french';
    let items = [];
    try { items = JSON.parse(co.description); } catch(e) { items = []; }
    if (!Array.isArray(items)) items = [];

    const subtotal = co.amount_cents;
    const gst = Math.round(subtotal * 0.05);
    const qst = Math.round(subtotal * 0.09975);
    const total = subtotal + gst + qst;

    const html = `<!DOCTYPE html>
<html lang="${isFr ? 'fr' : 'en'}">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a2e; padding: 40px; max-width: 800px; margin: 0 auto; font-size: 13px; }
  .logo { text-align: center; margin-bottom: 24px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.2em; color: #666; }
  .title { text-align: center; font-size: 10px; text-transform: uppercase; letter-spacing: 0.15em; color: #666; margin-bottom: 20px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; border: 1px solid #1a1a2e; margin-bottom: 24px; }
  .info-cell { padding: 8px 12px; border-bottom: 1px solid #ddd; }
  .info-cell:nth-child(even) { border-left: 1px solid #ddd; }
  .info-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #666; }
  .info-value { font-weight: 600; }
  .section-title { font-weight: 700; padding: 8px 0; border-bottom: 1px solid #1a1a2e; margin-top: 12px; }
  .line-item { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f0f0f0; }
  .total-section { margin-top: 16px; border-top: 2px solid #1a1a2e; padding-top: 8px; }
  .total-row { display: flex; justify-content: flex-end; padding: 4px 0; }
  .total-row span:first-child { margin-right: 40px; }
  .total-row.grand { font-size: 15px; font-weight: 700; background: #1a1a2e; color: white; padding: 8px 12px; margin-top: 4px; }
  .approval { margin-top: 30px; border: 1px solid #ddd; padding: 16px; border-radius: 4px; }
  .approval h3 { font-size: 12px; text-transform: uppercase; margin-bottom: 10px; }
  .sig-line { border-bottom: 1px solid #999; height: 30px; margin-top: 20px; }
  .sig-label { font-size: 10px; color: #666; margin-top: 4px; }
  .footer { margin-top: 30px; text-align: center; font-size: 11px; color: #999; }
</style>
</head>
<body>
  <div class="logo">OSTÉOPEINTURE</div>
  <div class="title">${isFr ? 'AVENANT AU CONTRAT' : 'CHANGE ORDER'}</div>

  <div class="info-grid">
    <div class="info-cell"><span class="info-label">CLIENT</span><br><span class="info-value">${esc(co.client_name)}</span><br>${esc(co.address)}</div>
    <div class="info-cell"><span class="info-label">${isFr ? 'PROJET' : 'PROJECT'}</span><br><span class="info-value">${esc(co.job_number)}</span></div>
    <div class="info-cell"><span class="info-label">${isFr ? 'OBJET' : 'SUBJECT'}</span><br><span class="info-value">${esc(isFr ? co.title_fr : co.title_en)}</span></div>
    <div class="info-cell"><span class="info-label">DATE</span><br><span class="info-value">${co.created_at.slice(0, 10)}</span></div>
  </div>

  <div class="section-title">${isFr ? 'TRAVAUX ADDITIONNELS' : 'ADDITIONAL WORK'}</div>
  ${items.map(item => `
    <div class="line-item">
      <span>${esc(item.description || item.desc || '')}</span>
      <span style="font-weight:500">${((item.amountCents || 0) / 100).toLocaleString('fr-CA')} $</span>
    </div>
  `).join('')}

  <div class="total-section">
    <div class="total-row"><span>${isFr ? 'SOUS-TOTAL' : 'SUBTOTAL'}</span><span>${(subtotal / 100).toLocaleString('fr-CA')} $</span></div>
    <div class="total-row"><span>TPS (5%)</span><span>${(gst / 100).toLocaleString('fr-CA')} $</span></div>
    <div class="total-row"><span>TVQ (9.975%)</span><span>${(qst / 100).toLocaleString('fr-CA')} $</span></div>
    <div class="total-row grand"><span>TOTAL</span><span>${(total / 100).toLocaleString('fr-CA')} $</span></div>
  </div>

  <div class="approval">
    <h3>${isFr ? 'APPROBATION DU CLIENT' : 'CLIENT APPROVAL'}</h3>
    <p style="font-size:12px;color:#666">${isFr
      ? 'En signant ci-dessous, vous confirmez votre accord pour les travaux additionnels décrits ci-dessus et les coûts associés.'
      : 'By signing below, you confirm your agreement to the additional work described above and the associated costs.'}</p>
    <div class="sig-line"></div>
    <div class="sig-label">${isFr ? 'Signature du client' : 'Client Signature'} — Date: _______________</div>
  </div>

  <div class="footer">
    OstéoPeinture — 4201-80 rue Saint-Viateur E., Montréal, QC H2T 1A6<br>
    438-870-8087 | info@osteopeinture.com | www.osteopeinture.com
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});

// ============================================================
// INVOICE GENERATION
// ============================================================

// Generate invoice draft combining quote + time entries + change orders
// Returns an editable draft — user restructures sections before finalizing
app.post('/api/jobs/:id/invoices/generate', express.json(), async (req, res) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const { language, issueDate, notes, sections: customSections } = req.body || {};
    const lang = language || job.language || 'french';
    const isFr = lang === 'french';
    const now = new Date().toISOString();
    const invoiceId = uuidv4();

    const dateStr = (issueDate || now.slice(0, 10)).replace(/-/g, '');
    const existingCount = await db.get('SELECT COUNT(*) as c FROM invoices WHERE job_id = ?', [job.id]).c;
    const invoiceNumber = dateStr + '_' + String(existingCount + 1).padStart(2, '0');

    // === Build draft sections from all sources ===
    let draftSections = [];

    if (customSections) {
      // User provided pre-edited sections — use as-is
      draftSections = customSections;
    } else {
      // Auto-generate from quote + time entries

      // Source 1: Fixed-price items from accepted quote
      const quote = job.acceptedQuoteJson;
      if (quote && quote.sections) {
        for (const s of quote.sections) {
          draftSections.push({
            title: s.title,
            source: 'quote',
            items: (s.items || []).map(item => ({
              description: item.description,
              amount: item.price * 100,
              type: 'fixed',
            })),
            subtotalCents: (s.subtotal || 0) * 100,
          });
        }
      }

      // Source 2: Approved change orders
      const changeOrders = await db.all("SELECT * FROM job_change_orders WHERE job_id = ? AND status = 'approved' ORDER BY created_at", [job.id]);
      for (const co of changeOrders) {
        let coItems = [];
        try { coItems = JSON.parse(co.description); } catch(e) {}
        if (!Array.isArray(coItems)) coItems = [];
        const coTitle = isFr ? co.title_fr : co.title_en;
        draftSections.push({
          title: coTitle,
          source: 'change_order',
          changeOrderId: co.id,
          items: coItems.map(i => ({
            description: i.description || i.desc || coTitle,
            amount: i.amountCents || 0,
            type: 'change_order',
          })),
          subtotalCents: co.amount_cents,
        });
      }

      // Source 3: Hourly work from mapped time entries (not in quote)
      const timeEntries = await db.run(`
        SELECT mapped_label_en, mapped_label_fr, mapped_phase_code,
          SUM(billable_minutes) as total_minutes, employee_name
        FROM time_entries WHERE job_id = ? AND mapping_status = 'mapped' AND billable_minutes > 0
        GROUP BY mapped_label_en, mapped_label_fr, mapped_phase_code
        ORDER BY mapped_phase_code
      `, [job.id]);

      if (timeEntries.length > 0) {
        // Group time entries into one "Hourly Work" section
        // User can restructure this into multiple sections later
        const hourlyItems = [];
        for (const e of timeEntries) {
          const label = isFr ? (e.mapped_label_fr || e.mapped_label_en) : e.mapped_label_en;
          const hours = Math.round(e.total_minutes / 60 * 10) / 10;
          const rate = 55; // default billable rate — should come from job config
          const amount = Math.round(hours * rate * 100);
          hourlyItems.push({
            description: `${label} — ${hours}h @ $${rate}/h`,
            amount,
            type: 'hourly',
            hours,
            rate,
          });
        }
        if (hourlyItems.length > 0) {
          draftSections.push({
            title: isFr ? 'Travaux horaires' : 'Hourly Work',
            source: 'time_entries',
            items: hourlyItems,
            subtotalCents: hourlyItems.reduce((sum, i) => sum + i.amount, 0),
          });
        }
      }
    }

    // Calculate totals
    const subtotalCents = draftSections.reduce((sum, s) => sum + s.subtotalCents, 0);
    const gstCents = Math.round(subtotalCents * 0.05);
    const qstCents = Math.round(subtotalCents * 0.09975);
    const taxCents = gstCents + qstCents;
    const totalCents = subtotalCents + taxCents;

    // Get payments
    const payments = await getJobPayments(job.id);
    const totalPaidCents = payments.reduce((sum, p) => sum + p.amount_cents, 0);
    const balanceDueCents = totalCents - totalPaidCents;

    const invoiceJson = {
      invoiceNumber,
      jobNumber: job.job_number,
      clientName: job.client_name,
      address: job.address,
      language: lang,
      issueDate: issueDate || now.slice(0, 10),
      sections: draftSections,
      subtotalCents,
      gstCents,
      qstCents,
      taxCents,
      totalCents,
      payments: payments.map(p => ({
        date: p.payment_date,
        amount: p.amount_cents,
        method: p.method,
      })),
      totalPaidCents,
      balanceDueCents,
      notes: notes || '',
      isDraft: true,
    };

    await db.run(`
      INSERT INTO invoices (id, job_id, invoice_number, invoice_type, language, issue_date, status,
        subtotal_cents, tax_cents, total_cents, balance_due_cents, invoice_json, created_at, updated_at)
      VALUES (?, ?, ?, 'final', ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)
    `, [invoiceId, job.id, invoiceNumber, lang, invoiceJson.issueDate, subtotalCents, taxCents, totalCents, balanceDueCents, JSON.stringify(invoiceJson), now, now]);

    res.json({ invoiceId, invoiceNumber, invoiceJson });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update invoice sections (user edited the draft)
app.put('/api/invoices/:id', express.json(), async (req, res) => {
  try {
    const invoice = await db.get('SELECT * FROM invoices WHERE id = ?', [req.params.id]);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const existing = JSON.parse(invoice.invoice_json);
    const { sections, notes } = req.body;

    if (sections) {
      existing.sections = sections;
      existing.subtotalCents = sections.reduce((sum, s) => sum + (s.subtotalCents || 0), 0);
      existing.gstCents = Math.round(existing.subtotalCents * 0.05);
      existing.qstCents = Math.round(existing.subtotalCents * 0.09975);
      existing.taxCents = existing.gstCents + existing.qstCents;
      existing.totalCents = existing.subtotalCents + existing.taxCents;
      existing.balanceDueCents = existing.totalCents - existing.totalPaidCents;
    }
    if (notes !== undefined) existing.notes = notes;

    const now = new Date().toISOString();
    await db.run(`
      UPDATE invoices SET invoice_json = ?, subtotal_cents = ?, tax_cents = ?, total_cents = ?, balance_due_cents = ?, updated_at = ?
      WHERE id = ?
    `, [JSON.stringify(existing), existing.subtotalCents, existing.taxCents, existing.totalCents, existing.balanceDueCents, now, req.params.id]);

    res.json({ ok: true, invoiceJson: existing });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get invoices for a job
app.get('/api/jobs/:id/invoices', async (req, res) => {
  try {
    res.json(await db.all('SELECT * FROM invoices WHERE job_id = ? ORDER BY created_at DESC', [req.params.id]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Preview invoice as HTML
app.get('/preview/invoice/:id', async (req, res) => {
  try {
    const invoice = await db.get('SELECT * FROM invoices WHERE id = ?', [req.params.id]);
    if (!invoice) return res.status(404).send('Invoice not found');

    const inv = JSON.parse(invoice.invoice_json);
    const isFr = inv.language === 'french';

    // Use the editable sections (which may include quote + hourly + change orders)
    const sections = inv.sections || [];

    const html = `<!DOCTYPE html>
<html lang="${isFr ? 'fr' : 'en'}">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a2e; padding: 40px; max-width: 800px; margin: 0 auto; font-size: 13px; }
  .logo { text-align: center; margin-bottom: 30px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.2em; color: #666; }
  .title { text-align: center; font-size: 10px; text-transform: uppercase; letter-spacing: 0.15em; color: #666; margin-bottom: 20px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; border: 1px solid #1a1a2e; margin-bottom: 24px; }
  .info-cell { padding: 8px 12px; border-bottom: 1px solid #ddd; }
  .info-cell:nth-child(even) { border-left: 1px solid #ddd; }
  .info-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #666; }
  .info-value { font-weight: 600; }
  .section-title { font-weight: 700; padding: 8px 0 4px; border-bottom: 1px solid #1a1a2e; margin-top: 16px; }
  .line-item { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #f0f0f0; }
  .line-item-desc { flex: 1; padding-left: 12px; }
  .line-item-price { font-weight: 500; text-align: right; width: 80px; }
  .subtotal-row { display: flex; justify-content: flex-end; padding: 6px 0; font-weight: 600; }
  .subtotal-row span:first-child { margin-right: 40px; }
  .total-section { margin-top: 20px; border-top: 2px solid #1a1a2e; padding-top: 8px; }
  .total-row { display: flex; justify-content: flex-end; padding: 4px 0; }
  .total-row span:first-child { margin-right: 40px; }
  .total-row.grand { font-size: 16px; font-weight: 700; background: #1a1a2e; color: white; padding: 10px 12px; margin-top: 4px; }
  .payment-section { margin-top: 16px; }
  .payment-row { display: flex; justify-content: flex-end; padding: 3px 0; color: #666; }
  .payment-row span:first-child { margin-right: 40px; }
  .balance-row { display: flex; justify-content: flex-end; padding: 10px 0; font-size: 15px; font-weight: 700; border-top: 2px solid #1a1a2e; }
  .balance-row span:first-child { margin-right: 40px; }
  .footer { margin-top: 40px; text-align: center; font-size: 11px; color: #999; }
  .payment-terms { margin-top: 20px; text-align: center; font-size: 11px; color: #666; font-style: italic; }
</style>
</head>
<body>
  <div class="logo">OSTÉOPEINTURE</div>
  <div class="title">${quote && quote.title ? esc(quote.title) : (isFr ? 'FACTURE' : 'INVOICE')}</div>

  <div class="info-grid">
    <div class="info-cell"><span class="info-label">${isFr ? 'FACTURÉ À' : 'BILLED TO'}</span><br><span class="info-value">${esc(inv.clientName)}</span><br>${esc(inv.address)}</div>
    <div class="info-cell"><span class="info-label">${isFr ? 'FACTURE #' : 'INVOICE #'}</span><br><span class="info-value">${esc(inv.invoiceNumber)}</span></div>
    <div class="info-cell"><span class="info-label">${isFr ? 'PROJET' : 'PROJECT'}</span><br><span class="info-value">${esc(inv.jobNumber)}</span></div>
    <div class="info-cell"><span class="info-label">DATE</span><br><span class="info-value">${esc(inv.issueDate)}</span></div>
  </div>

  ${sections.map(s => `
    <div class="section-title">${esc(s.title)}<span style="float:right">${((s.subtotalCents || 0) / 100).toLocaleString('fr-CA')} $</span></div>
    ${(s.items || []).map(item => `
      <div class="line-item">
        <span class="line-item-desc">➛ ${esc(item.description)}</span>
        <span class="line-item-price">${((item.amount || item.price * 100 || 0) / 100).toLocaleString('fr-CA')} $</span>
      </div>
    `).join('')}
  `).join('')}

  <div class="total-section">
    <div class="subtotal-row"><span>TOTAL</span><span>${(inv.subtotalCents / 100).toLocaleString('fr-CA')} $</span></div>
    <div class="total-row"><span>TPS #7784757551RT0001</span><span>${(inv.gstCents / 100).toLocaleString('fr-CA')} $</span></div>
    <div class="total-row"><span>TVQ #1231045518</span><span>${(inv.qstCents / 100).toLocaleString('fr-CA')} $</span></div>
    <div class="total-row grand"><span>GRAND TOTAL</span><span>${(inv.totalCents / 100).toLocaleString('fr-CA')} $</span></div>
  </div>

  ${inv.payments.length > 0 ? `
  <div class="payment-section">
    ${inv.payments.map(p => `
      <div class="payment-row"><span>${isFr ? 'Paiement' : 'Payment'} ${p.date} (${p.method})</span><span>-${(p.amount / 100).toLocaleString('fr-CA')} $</span></div>
    `).join('')}
    <div class="balance-row"><span>${isFr ? 'SOLDE À PAYER' : 'BALANCE TO PAY'}</span><span>${(inv.balanceDueCents / 100).toLocaleString('fr-CA')} $</span></div>
  </div>` : ''}

  <div class="payment-terms">${isFr ? 'Le solde restant est payable par chèque, dépôt direct, virement Interac ou comptant.' : 'The remaining balance is to be paid by cheque, direct deposit, e-transfer or cash.'}</div>

  <div class="footer">
    OstéoPeinture — 4201-80 rue Saint-Viateur E., Montréal, QC H2T 1A6<br>
    438-870-8087 | info@osteopeinture.com | www.osteopeinture.com<br>
    RBQ# 5790-0045-01
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});

// Generate invoice PDF
app.post('/api/invoices/:id/pdf', async (req, res) => {
  try {
    const invoice = await db.get('SELECT * FROM invoices WHERE id = ?', [req.params.id]);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const { chromium } = require('playwright');
    const browser = await chromium.launch({ args: ['--no-sandbox'] });
    const page = await browser.newPage();

    const protocol = req.protocol;
    const host = req.get('host');
    await page.goto(`${protocol}://${host}/preview/invoice/${req.params.id}`, { waitUntil: 'networkidle' });

    const pdfBuffer = await page.pdf({
      format: 'Letter',
      margin: { top: '0.4in', bottom: '0.4in', left: '0.5in', right: '0.5in' },
      printBackground: true,
    });

    await browser.close();

    const inv = JSON.parse(invoice.invoice_json);
    const filename = `${inv.jobNumber}_invoice_${inv.invoiceNumber}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// START SERVER
// ============================================================

// Download DB file for manual backup
app.get('/api/backup/download', async (req, res) => {
  if (!fs.existsSync(DB_PATH)) return res.status(404).json({ error: 'No database found' });
  res.setHeader('Content-Type', 'application/x-sqlite3');
  res.setHeader('Content-Disposition', 'attachment; filename=op-hub-sessions.db');
  fs.createReadStream(DB_PATH).pipe(res);
});

// Manual backup route (Drive — may not work on consumer accounts)
app.post('/api/backup', async (req, res) => {
  try {
    const result = await backupToDrive(DB_PATH);
    res.json({ ok: result, message: result ? 'Backup complete' : 'Backup failed or not configured' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Version endpoint for deploy verification
// ── PAST QUOTES SEARCH ─────────────────────────────────────────────────
// Searches the past_quotes table for historical quote data. Used by
// the Claude tool to reference past pricing during new quote conversations.
app.get('/api/past-quotes/search', async (req, res) => {
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
    const { getPool } = require('./db');
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

app.get('/api/version', async (req, res) => {
  res.json({ version: '2026-04-06', features: ['jobs', 'jibble-import', 'db-backup'] });
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  // Start server immediately — never block on backup
  app.listen(PORT, () => {
    console.log(`OP Hub running on http://localhost:${PORT}`);
    // Restore/backup in background after server is up
    ensureDatabase(DB_PATH).then((status) => {
      console.log(`[db-backup] DB status: ${status}`);
    }).catch((err) => {
      console.error('[db-backup] Startup backup error:', err.message);
    });
  });
}

module.exports = {
  app,
  buildEmailDraft,
  createSessionHandler,
  getSession,
  handleSessionMessage,
  sendUploadError,
  setAnthropicClient,
};
