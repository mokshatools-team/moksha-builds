require('dotenv').config();
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const Anthropic = require('@anthropic-ai/sdk');
const multer = require('multer');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const {
  MAX_IMAGE_COUNT,
  UploadError,
  createBudgetedMemoryStorage,
  buildAnthropicImageParts,
  normalizeImages,
  summarizeImageUpload,
} = require('./lib/image-upload');

// ============================================================
// DATABASE SETUP
// ============================================================

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Seed QUOTING_LOGIC.md to DATA_DIR on first run so it persists on the volume
const QUOTING_LOGIC_PATH = path.join(DATA_DIR, 'QUOTING_LOGIC.md');
const QUOTING_LOGIC_SEED = path.join(__dirname, 'QUOTING_LOGIC.md');
if (!fs.existsSync(QUOTING_LOGIC_PATH) && fs.existsSync(QUOTING_LOGIC_SEED)) {
  fs.copyFileSync(QUOTING_LOGIC_SEED, QUOTING_LOGIC_PATH);
}
const EMAIL_LOGIC_PATH = path.join(DATA_DIR, 'EMAIL_LOGIC.md');
const EMAIL_LOGIC_SEED = path.join(__dirname, 'EMAIL_LOGIC.md');
if (!fs.existsSync(EMAIL_LOGIC_PATH) && fs.existsSync(EMAIL_LOGIC_SEED)) {
  fs.copyFileSync(EMAIL_LOGIC_SEED, EMAIL_LOGIC_PATH);
}

function getQuotingLogic() {
  if (fs.existsSync(QUOTING_LOGIC_PATH)) return fs.readFileSync(QUOTING_LOGIC_PATH, 'utf8');
  if (fs.existsSync(QUOTING_LOGIC_SEED)) return fs.readFileSync(QUOTING_LOGIC_SEED, 'utf8');
  return '(no quoting logic file found)';
}

function createFallbackDatabase() {
  const sessions = new Map();

  function cloneSession(row) {
    return row ? { ...row } : null;
  }

  return {
    exec() {},
    prepare(sql) {
      if (sql.includes('SELECT * FROM sessions WHERE id = ?')) {
        return {
          get(id) {
            return cloneSession(sessions.get(id));
          },
        };
      }

      if (sql.includes('SELECT project_id FROM sessions WHERE project_id LIKE')) {
        return {
          all(prefix) {
            const rows = Array.from(sessions.values())
              .filter((r) => r.project_id && r.project_id.startsWith(prefix.replace('_%', '')))
              .sort((a, b) => String(b.project_id).localeCompare(String(a.project_id)));
            return rows.map((r) => ({ project_id: r.project_id }));
          },
        };
      }

      if (sql.includes('DELETE FROM sessions WHERE id')) {
        return {
          run(id) { sessions.delete(id); },
        };
      }

      if (sql.includes('FROM sessions ORDER BY updated_at DESC LIMIT 50')) {
        return {
          all() {
            return Array.from(sessions.values())
              .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
              .map((row) => ({
                id: row.id,
                created_at: row.created_at,
                updated_at: row.updated_at,
                client_name: row.client_name,
                project_id: row.project_id,
                address: row.address,
                total_amount: row.total_amount,
                status: row.status,
                email_recipient: row.email_recipient,
                email_meta: row.email_meta,
              }));
          },
        };
      }

      return {
        run(params) {
          sessions.set(params.id, {
            id: params.id,
            created_at: params.created_at,
            updated_at: params.updated_at,
            client_name: params.client_name,
            project_id: params.project_id,
            address: params.address,
            total_amount: params.total_amount,
            status: params.status,
            messages: params.messages,
            quote_json: params.quote_json,
            email_recipient: params.email_recipient,
            email_meta: params.email_meta,
          });
        },
      };
    },
  };
}

function createDatabase(filename) {
  if (process.env.NODE_ENV === 'test') {
    return createFallbackDatabase();
  }

  try {
    return new Database(filename);
  } catch (error) {
    return createFallbackDatabase();
  }
}

const db = createDatabase(path.join(DATA_DIR, 'sessions.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    client_name TEXT,
    project_id TEXT,
    address TEXT,
    total_amount REAL,
    status TEXT DEFAULT 'gathering',
    messages TEXT DEFAULT '[]',
    quote_json TEXT,
    email_recipient TEXT,
    email_meta TEXT
  )
`);
try {
  db.exec('ALTER TABLE sessions ADD COLUMN email_meta TEXT');
} catch (error) {
  // Column already exists in persistent databases; ignore migration failure.
}

// ── Job Management Tables (added 2026-04-05) ─────────────────────────────
try { db.exec('ALTER TABLE sessions ADD COLUMN converted_job_id TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE sessions ADD COLUMN accepted_at TEXT'); } catch(e) {}

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    quote_session_id TEXT UNIQUE,
    job_number TEXT NOT NULL UNIQUE,
    client_name TEXT NOT NULL,
    client_email TEXT,
    client_phone TEXT,
    language TEXT NOT NULL DEFAULT 'english',
    address TEXT NOT NULL,
    project_title TEXT,
    project_type TEXT DEFAULT 'hourly',
    status TEXT NOT NULL DEFAULT 'active',
    quote_subtotal_cents INTEGER NOT NULL DEFAULT 0,
    quote_tax_cents INTEGER NOT NULL DEFAULT 0,
    quote_total_cents INTEGER NOT NULL DEFAULT 0,
    accepted_quote_json TEXT,
    payment_terms_text TEXT,
    start_date TEXT,
    target_end_date TEXT,
    completion_date TEXT,
    internal_notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS job_activity_mappings (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    source_activity_name TEXT NOT NULL,
    phase_code TEXT NOT NULL DEFAULT 'other',
    client_label_en TEXT NOT NULL,
    client_label_fr TEXT NOT NULL,
    billable INTEGER NOT NULL DEFAULT 1,
    show_on_update INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 100,
    UNIQUE(job_id, source_activity_name)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS time_import_batches (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    row_count INTEGER NOT NULL DEFAULT 0,
    inserted_count INTEGER NOT NULL DEFAULT 0,
    duplicate_count INTEGER NOT NULL DEFAULT 0,
    unmapped_count INTEGER NOT NULL DEFAULT 0
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS time_entries (
    id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    external_row_key TEXT NOT NULL UNIQUE,
    work_date TEXT,
    employee_name TEXT NOT NULL,
    source_activity_name TEXT NOT NULL,
    mapped_phase_code TEXT,
    mapped_label_en TEXT,
    mapped_label_fr TEXT,
    mapping_status TEXT NOT NULL DEFAULT 'unmapped',
    duration_minutes INTEGER NOT NULL,
    billable_minutes INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    raw_row_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    invoice_number TEXT NOT NULL UNIQUE,
    invoice_type TEXT NOT NULL DEFAULT 'final',
    language TEXT NOT NULL DEFAULT 'french',
    issue_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    subtotal_cents INTEGER NOT NULL DEFAULT 0,
    tax_cents INTEGER NOT NULL DEFAULT 0,
    total_cents INTEGER NOT NULL DEFAULT 0,
    balance_due_cents INTEGER NOT NULL DEFAULT 0,
    invoice_json TEXT,
    sent_to TEXT,
    sent_at TEXT,
    paid_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    invoice_id TEXT,
    payment_date TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    method TEXT NOT NULL DEFAULT 'e_transfer',
    reference TEXT,
    notes TEXT,
    finance_sync_status TEXT NOT NULL DEFAULT 'pending',
    finance_synced_at TEXT,
    created_at TEXT NOT NULL
  )
`);

function getSession(id) {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!row) return null;
  return {
    ...row,
    messages: JSON.parse(row.messages || '[]'),
    quoteJson: row.quote_json ? JSON.parse(row.quote_json) : null,
    emailMeta: row.email_meta ? JSON.parse(row.email_meta) : {},
  };
}

function saveSession(session) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO sessions (id, created_at, updated_at, client_name, project_id, address, total_amount, status, messages, quote_json, email_recipient, email_meta)
    VALUES (@id, @created_at, @updated_at, @client_name, @project_id, @address, @total_amount, @status, @messages, @quote_json, @email_recipient, @email_meta)
    ON CONFLICT(id) DO UPDATE SET
      updated_at = @updated_at,
      client_name = @client_name,
      project_id = @project_id,
      address = @address,
      total_amount = @total_amount,
      status = @status,
      messages = @messages,
      quote_json = @quote_json,
      email_recipient = @email_recipient,
      email_meta = @email_meta
  `).run({
    id: session.id,
    created_at: session.createdAt || now,
    updated_at: now,
    client_name: session.clientName || null,
    project_id: session.projectId || null,
    address: session.address || null,
    total_amount: session.totalAmount || null,
    status: session.status || 'gathering',
    messages: JSON.stringify(session.messages || []),
    quote_json: session.quoteJson ? JSON.stringify(session.quoteJson) : null,
    email_recipient: session.emailRecipient || null,
    email_meta: JSON.stringify(session.emailMeta || {}),
  });
}

function listSessions() {
  return db.prepare(`
    SELECT id, created_at, updated_at, client_name, project_id, address, total_amount, status, email_recipient
    FROM sessions ORDER BY updated_at DESC LIMIT 50
  `).all();
}

// ============================================================
// JOB MANAGEMENT HELPERS
// ============================================================

function getJob(id) {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  if (!row) return null;
  return {
    ...row,
    acceptedQuoteJson: row.accepted_quote_json ? JSON.parse(row.accepted_quote_json) : null,
  };
}

function listJobs() {
  return db.prepare(`
    SELECT j.*,
      (SELECT COALESCE(SUM(amount_cents), 0) FROM payments WHERE job_id = j.id) as total_paid_cents
    FROM jobs j ORDER BY j.updated_at DESC LIMIT 50
  `).all();
}

function generateJobNumber(clientName) {
  const prefix = (clientName || 'JOB').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 10);
  const existing = db.prepare("SELECT job_number FROM jobs WHERE job_number LIKE ? ORDER BY job_number DESC LIMIT 1")
    .get(`${prefix}_%`);
  if (existing) {
    const match = existing.job_number.match(/_(\d+)$/);
    const next = match ? parseInt(match[1]) + 1 : 1;
    return `${prefix}_${String(next).padStart(2, '0')}`;
  }
  return `${prefix}_01`;
}

function convertSessionToJob(sessionId, overrides = {}) {
  const session = getSession(sessionId);
  if (!session) throw new Error('Session not found');
  if (session.converted_job_id) throw new Error('Session already converted to a job');

  const now = new Date().toISOString();
  const jobId = uuidv4();
  const jobNumber = overrides.jobNumber || generateJobNumber(session.clientName);
  const subtotalCents = Math.round((session.totalAmount || 0) * 100);
  const taxCents = Math.round(subtotalCents * 0.14975);
  const totalCents = subtotalCents + taxCents;

  db.prepare(`
    INSERT INTO jobs (id, quote_session_id, job_number, client_name, client_email, client_phone,
      language, address, project_title, project_type, status,
      quote_subtotal_cents, quote_tax_cents, quote_total_cents, accepted_quote_json,
      payment_terms_text, start_date, internal_notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    jobId, sessionId, jobNumber,
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
    now, now
  );

  // Mark session as converted
  db.prepare('UPDATE sessions SET converted_job_id = ?, accepted_at = ? WHERE id = ?')
    .run(jobId, now, sessionId);

  return getJob(jobId);
}

function getJobPayments(jobId) {
  return db.prepare('SELECT * FROM payments WHERE job_id = ? ORDER BY payment_date DESC').all(jobId);
}

function getJobTimeEntries(jobId) {
  return db.prepare('SELECT * FROM time_entries WHERE job_id = ? ORDER BY work_date DESC, employee_name').all(jobId);
}

function getJobActivityMappings(jobId) {
  return db.prepare('SELECT * FROM job_activity_mappings WHERE job_id = ? ORDER BY sort_order').all(jobId);
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

function inferSeasonLabel(date = new Date()) {
  const month = date.getMonth();
  const year = date.getFullYear();
  if (month >= 2 && month <= 4) return `Spring ${year}`;
  if (month >= 5 && month <= 7) return `Summer ${year}`;
  if (month >= 8 && month <= 10) return `Fall ${year}`;
  return `Winter ${year}`;
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
  const address = (session.quoteJson?.address || session.address || '').trim();
  const projectId = (session.quoteJson?.projectId || session.projectId || '').trim();
  const location = address || projectId || 'Quote';
  const includeSeason = ['quote_send', 'quote_revision'].includes(emailMeta.scenario);
  const season = includeSeason ? inferSeasonLabel() : '';
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
  if (!session || !session.quoteJson) return null;

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
const TEMPLATE_PATH = path.join(__dirname, 'public', 'quote_template.html');
if (fs.existsSync(TEMPLATE_PATH)) {
  const tmpl = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const m = tmpl.match(/class="logo-house" src="data:image\/png;base64,([^"]{20,})"/);
  if (m) LOGO_HOUSE_B64 = m[1];
}

// ============================================================
// QUOTE HTML RENDERER
// ============================================================

function fmt(n) {
  if (n == null) return '';
  return Number(n).toLocaleString('fr-CA', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' $';
}

function renderQuoteHTML(data) {
  const sections = data.sections || [];
  const isExterior = (data.projectType || '').toLowerCase().includes('exterior');

  // Calculate subtotal — skip excluded and optional sections
  let subtotal = 0;
  for (const sec of sections) {
    if (sec.excluded || sec.optional) continue;
    if (sec.total) {
      subtotal += sec.total;
    } else if (sec.items) {
      for (const item of sec.items) {
        if (item.price) subtotal += item.price;
      }
    }
  }
  const tps = subtotal * 0.05;
  const tvq = subtotal * 0.09975;
  const grandTotal = subtotal + tps + tvq;

  // Build terms block
  const terms = data.terms || {};
  let termsHtml = '';
  if (terms.includes && terms.includes.length) {
    termsHtml += `<div class="terms-title">Our Price Includes:</div>`;
    for (const t of terms.includes) {
      termsHtml += `<div class="terms-item">${esc(t)}</div>`;
    }
  }
  if (terms.conditions && terms.conditions.length) {
    termsHtml += `<div class="terms-gap"></div><div class="terms-subtitle">General Conditions</div>`;
    for (const c of terms.conditions) {
      termsHtml += `<div class="terms-item">${esc(c)}</div>`;
    }
  }
  const rate = terms.hourlyRate || 65;
  termsHtml += `<div class="terms-item bold">Any work outside of the scope of this quote will be billed at $${rate}/h + materials, as demanded</div>`;

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
      const excludedLabel = sec.excluded ? ' <span style="font-size:7px;font-weight:400;color:#999;font-style:italic;">(excluded from total)</span>' : '';
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
  paintHtml += `<tr><td class="col-product">Paint Total (incl. in quote)</td><td class="col-finish">~ ${fmt(paintTotal)}</td></tr>`;

  // Modalities
  const mod = data.modalities || {};
  const depositStr = mod.deposit ? `$${Number(mod.deposit).toLocaleString('fr-CA')}` : '—';

  const logoImg = LOGO_HOUSE_B64
    ? `<img class="logo-house" src="data:image/png;base64,${LOGO_HOUSE_B64}" alt="logo">`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
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
.client-header tr:first-child td { border-bottom:1px solid #1a1a1a; }
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
.row-section td { padding:6px 10px; font-size:9px; font-weight:700; border-top:1.5px solid #1a1a1a; border-bottom:1px solid #bbb; }
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
.sig-cell { padding:10px 14px; font-size:8px; font-weight:600; min-height:70px; display:flex; flex-direction:column; align-items:flex-start; }
.footer { text-align:center; margin-top:36px; }
.footer-logo { font-family:'Montserrat',sans-serif; font-size:10px; font-weight:600; letter-spacing:5px; color:#7B3A10; text-transform:uppercase; margin-bottom:5px; }
.footer-info { font-size:7.5px; color:#666; line-height:1.9; }
@media print { body { background:white; padding:0; } .page { box-shadow:none; width:100%; padding:32px 40px; } }
</style>
</head>
<body>
<div class="page">
  <div class="logo-block">
    ${logoImg}
  </div>
  <div class="project-title">${esc(data.projectType || 'Painting Work')}</div>
  <table class="client-header">
    <tr>
      <td class="lbl">Client</td>
      <td class="val">${esc(data.clientName || '')}</td>
      <td class="gap"></td>
      <td class="lbl-r">Address</td>
      <td class="val-r">${esc(data.address || '')}</td>
    </tr>
    <tr>
      <td class="lbl">Project</td>
      <td class="val">${esc(data.projectId || '')}</td>
      <td class="gap"></td>
      <td class="lbl-r">Date</td>
      <td class="val-r">${esc(data.date || '')}</td>
    </tr>
  </table>
  <div class="section-header" style="margin-top:0;">Scope &amp; General Conditions</div>
  <div class="terms-block">${termsHtml}</div>
  <div class="section-header">Cost Breakdown</div>
  <table class="quote-table">${tableHtml}</table>
  <div class="row-total total-line"><div class="lbl">TOTAL</div><div class="prc">${fmt(subtotal)}</div></div>
  <div class="row-total tax"><div class="lbl">TPS #7784757551RT0001</div><div class="prc">${fmt(tps)}</div></div>
  <div class="row-total tax"><div class="lbl">TVQ #1231045518</div><div class="prc">${fmt(tvq)}</div></div>
  <div class="row-total grand"><div class="lbl">GRAND TOTAL</div><div class="prc">${fmt(grandTotal)}</div></div>
  <div class="section-header">Paint &amp; Products</div>
  <div class="paint-note">Our quotes include high-end paint and all materials required for proper preparation of surfaces.</div>
  <table class="paint-table">${paintHtml}</table>
  <div class="section-header">Details &amp; Modalities</div>
  <div class="mod-grid">
    <div class="mod-cell"><div class="mod-label">Proposed Start Date</div><div class="mod-value">${esc(mod.startDate || '—')}</div></div>
    <div class="mod-cell"><div class="mod-label">Duration of Work</div><div class="mod-value">${esc(mod.duration || '—')}</div></div>
    <div class="mod-cell"><div class="mod-label">Deposit Amount</div><div class="mod-value">${esc(depositStr)}</div></div>
    <div class="mod-cell"><div class="mod-label">Payment Method</div><div class="mod-value small">${esc(mod.paymentMethod || '')}</div></div>
  </div>
  ${data.estimateDisclaimer ? `<div class="legal-block" style="background:#f9f6f2;border-top:1.5px solid #1a1a1a;">
    <strong style="color:#7B3A10;">${esc(data.estimateDisclaimer)}</strong>
  </div>` : ''}
  <div class="legal-block">
    <strong>All additional work will be charged accordingly.</strong><br>
    This quote is valid for a period of 30 days.<br>
    The client is responsible for ensuring that the work conforms to the specifications and permits required by the City.
  </div>
  <div class="sig-grid">
    <div class="sig-cell">Client Signature</div>
    <div class="sig-cell">OstéoPeinture Representative</div>
  </div>
  <div class="footer">
    <div class="footer-logo">Ostéopeinture</div>
    <div class="footer-info">
      #201 - 80 rue Saint-Viateur E., Montréal, QC H2T 1A6<br>
      438-870-8087 | info@osteopeinture.com | www.osteopeinture.com<br>
      RBQ# 5790-0045-01
    </div>
  </div>
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
For each room, list EVERY surface on its own line. Each line shows: surface description, approximate sqft or count, coats, labour hours, labour cost, and paint gallons needed for that surface — all on ONE line.

Format per room:
### [Room Name] — [Floor] — $[room total]
- Ceiling: ~[sqft] sqft, [coats] coats → [hours]h → $[cost] — [gal] gal [product]
- Walls: ~[sqft] sqft, [coats] coats → [hours]h → $[cost] — [gal] gal [product]
- Walls (primer): ~[sqft] sqft, 1 coat → [hours]h → $[cost] — [gal] gal [primer product]
- Baseboards: ~[length] lin ft → [hours]h → $[cost] — [gal] gal [product]
- [N] doors ([faces] faces): [hours]h → $[cost] — [gal] gal [product]
- [N] windows ([type]): [hours]h → $[cost] — [gal] gal [product]
- Closet interior: → [hours]h → $[cost] — [gal] gal [product]
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

Output this exact structure:

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
    { "type": "Walls", "product": "SW Duration Home", "color": "BM OC-65 Chantilly Lace", "finish": "Low Sheen", "approxCost": 850 },
    { "type": "Ceilings", "product": "SW PM400", "color": "Ceiling White", "finish": "Extra Flat", "approxCost": 200 },
    { "type": "Trim", "product": "BM Advance", "color": "BM OC-65 Chantilly Lace", "finish": "Semi-Gloss", "approxCost": 350 }
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
    { "type": "Façade", "product": "SW Duration Ext", "color": "TBD", "finish": "Satin", "approxCost": 450 },
    { "type": "Deck", "product": "STEINA Enduradeck", "color": "TBD", "finish": "Opaque", "approxCost": 220 }
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
function nextProjectId(prefix) {
  const rows = db.prepare(
    "SELECT project_id FROM sessions WHERE project_id LIKE ? ORDER BY project_id DESC LIMIT 1"
  ).all(prefix + '_%');
  let num = 1;
  if (rows.length) {
    const match = rows[0].project_id.match(/_(\d+)$/);
    if (match) num = parseInt(match[1], 10) + 1;
  }
  return `${prefix}_${String(num).padStart(2, '0')}`;
}

// Create session
function createSessionHandler(req, res) {
  const id = uuidv4();
  const now = new Date().toISOString();
  const projectId = nextProjectId('NEW');
  saveSession({ id, createdAt: now, status: 'gathering', messages: [], projectId });
  res.json({ id, projectId });
}

app.post('/api/sessions', createSessionHandler);

// Rename session
app.patch('/api/sessions/:id/name', express.json(), (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Missing name' });
  session.projectId = name.trim();
  saveSession(session);
  res.json({ ok: true, projectId: session.projectId });
});

// Get quoting logic file
app.get('/api/quoting-logic', (req, res) => {
  res.json({ content: getQuotingLogic() });
});

// Save quoting logic file
app.put('/api/quoting-logic', express.json(), (req, res) => {
  const { content } = req.body;
  if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
  fs.writeFileSync(QUOTING_LOGIC_PATH, content, 'utf8');
  res.json({ ok: true });
});

// List all sessions (for sidebar)
app.get('/api/sessions', (req, res) => {
  const sessions = listSessions();
  res.json(sessions);
});

// Get single session
app.get('/api/sessions/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json({
    ...session,
    emailDraft: buildEmailDraft(session),
  });
});

app.put('/api/sessions/:id/email-draft', express.json(), (req, res) => {
  const session = getSession(req.params.id);
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
  saveSession(session);

  res.json({
    ok: true,
    emailDraft: buildEmailDraft(session),
  });
});

// Send message
async function handleSessionMessage(req, res) {
  const session = getSession(req.params.id);
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

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: buildSystemPrompt(),
      messages,
    });

    const assistantText = extractTextContent(response.content);
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
    saveSession(session);

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

app.post('/api/sessions/:id/messages', (req, res) => {
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
app.get('/preview/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session || !session.quoteJson) {
    return res.status(404).send('<h2>No quote available for this session.</h2>');
  }
  res.setHeader('Content-Type', 'text/html');
  res.send(renderQuoteHTML(session.quoteJson));
});

// Generate PDF
app.post('/api/sessions/:id/pdf', async (req, res) => {
  const session = getSession(req.params.id);
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
  const session = getSession(req.params.id);
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
    saveSession(session);

    res.json({ ok: true });
  } catch (err) {
    console.error('Email error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

// Adjust quote JSON
app.post('/api/sessions/:id/adjust-quote', (req, res) => {
  const session = getSession(req.params.id);
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
  saveSession(session);

  res.json({ ok: true });
});

// Delete session
app.delete('/api/sessions/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  db.prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Refine email draft via Claude
app.post('/api/sessions/:id/email/refine', express.json(), async (req, res) => {
  const session = getSession(req.params.id);
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

// ============================================================
// JOB MANAGEMENT ROUTES
// ============================================================

// List all jobs
app.get('/api/jobs', (req, res) => {
  try {
    const jobs = listJobs();
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single job with summary
app.get('/api/jobs/:id', (req, res) => {
  try {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const payments = getJobPayments(job.id);
    const totalPaidCents = payments.reduce((sum, p) => sum + p.amount_cents, 0);
    const timeEntries = getJobTimeEntries(job.id);
    const mappings = getJobActivityMappings(job.id);
    res.json({
      ...job,
      payments,
      totalPaidCents,
      balanceRemainingCents: job.quote_total_cents - totalPaidCents,
      timeEntryCount: timeEntries.length,
      unmappedCount: timeEntries.filter(e => e.mapping_status === 'unmapped').length,
      activityMappings: mappings,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Convert quote session to job
app.post('/api/sessions/:id/convert-to-job', express.json(), (req, res) => {
  try {
    const job = convertSessionToJob(req.params.id, req.body || {});
    res.json(job);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update job details
app.patch('/api/jobs/:id', express.json(), (req, res) => {
  try {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const now = new Date().toISOString();
    const fields = req.body;
    const updates = [];
    const params = [];
    for (const [key, value] of Object.entries(fields)) {
      const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (['client_name','client_email','client_phone','language','address','project_title',
           'project_type','status','payment_terms_text','start_date','target_end_date',
           'completion_date','internal_notes'].includes(col)) {
        updates.push(`${col} = ?`);
        params.push(value);
      }
    }
    if (updates.length === 0) return res.status(400).json({ error: 'No valid fields to update' });
    updates.push('updated_at = ?');
    params.push(now, req.params.id);
    db.prepare(`UPDATE jobs SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json(getJob(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Record a payment
app.post('/api/jobs/:id/payments', express.json(), (req, res) => {
  try {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const { amount, date, method, reference, notes } = req.body;
    if (!amount || !date) return res.status(400).json({ error: 'amount and date are required' });
    const now = new Date().toISOString();
    const paymentId = uuidv4();
    db.prepare(`
      INSERT INTO payments (id, job_id, payment_date, amount_cents, method, reference, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(paymentId, job.id, date, Math.round(amount * 100), method || 'e_transfer', reference || null, notes || null, now);
    res.json({ id: paymentId, message: 'Payment recorded' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get job payments
app.get('/api/jobs/:id/payments', (req, res) => {
  try {
    res.json(getJobPayments(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Import Jibble CSV
app.post('/api/jobs/:id/imports/jibble', multer({ storage: multer.memoryStorage() }).single('file'), (req, res) => {
  try {
    const job = getJob(req.params.id);
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
    getJobActivityMappings(job.id).forEach(m => { mappings[m.source_activity_name] = m; });

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
      const existing = db.prepare('SELECT id FROM time_entries WHERE external_row_key = ?').get(rowKey);
      if (existing) { duplicates++; continue; }

      // Check mapping
      const mapping = mappings[activity];
      const mappingStatus = mapping ? 'mapped' : 'unmapped';
      if (!mapping) unmapped++;

      const entryId = uuidv4();
      db.prepare(`
        INSERT INTO time_entries (id, batch_id, job_id, external_row_key, work_date, employee_name,
          source_activity_name, mapped_phase_code, mapped_label_en, mapped_label_fr,
          mapping_status, duration_minutes, billable_minutes, raw_row_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        entryId, batchId, job.id, rowKey, workDate, member, activity,
        mapping ? mapping.phase_code : null,
        mapping ? mapping.client_label_en : null,
        mapping ? mapping.client_label_fr : null,
        mappingStatus, minutes,
        mapping && mapping.billable ? minutes : 0,
        JSON.stringify(cols), now
      );
      inserted++;
    }

    // Save batch record
    db.prepare(`
      INSERT INTO time_import_batches (id, job_id, file_name, imported_at, row_count, inserted_count, duplicate_count, unmapped_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(batchId, job.id, req.file.originalname || 'jibble.csv', now, dataLines.length, inserted, duplicates, unmapped);

    res.json({ batchId, inserted, duplicates, unmapped, total: dataLines.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get/set activity mappings for a job
app.get('/api/jobs/:id/activity-mappings', (req, res) => {
  try {
    const mappings = getJobActivityMappings(req.params.id);
    // Also get unmapped activities
    const unmapped = db.prepare(`
      SELECT DISTINCT source_activity_name FROM time_entries
      WHERE job_id = ? AND mapping_status = 'unmapped'
    `).all(req.params.id);
    res.json({ mappings, unmappedActivities: unmapped.map(r => r.source_activity_name) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/jobs/:id/activity-mappings', express.json(), (req, res) => {
  try {
    const jobId = req.params.id;
    const { mappings } = req.body; // array of { sourceActivityName, phaseCode, clientLabelEn, clientLabelFr, billable, showOnUpdate, sortOrder }
    if (!Array.isArray(mappings)) return res.status(400).json({ error: 'mappings must be an array' });

    for (const m of mappings) {
      const id = uuidv4();
      db.prepare(`
        INSERT INTO job_activity_mappings (id, job_id, source_activity_name, phase_code, client_label_en, client_label_fr, billable, show_on_update, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(job_id, source_activity_name) DO UPDATE SET
          phase_code = excluded.phase_code,
          client_label_en = excluded.client_label_en,
          client_label_fr = excluded.client_label_fr,
          billable = excluded.billable,
          show_on_update = excluded.show_on_update,
          sort_order = excluded.sort_order
      `).run(id, jobId, m.sourceActivityName, m.phaseCode || 'other',
        m.clientLabelEn || m.sourceActivityName, m.clientLabelFr || m.sourceActivityName,
        m.billable !== false ? 1 : 0, m.showOnUpdate !== false ? 1 : 0, m.sortOrder || 100);

      // Retro-apply mapping to existing unmapped entries
      db.prepare(`
        UPDATE time_entries SET mapping_status = 'mapped',
          mapped_phase_code = ?, mapped_label_en = ?, mapped_label_fr = ?,
          billable_minutes = CASE WHEN ? = 1 THEN duration_minutes ELSE 0 END
        WHERE job_id = ? AND source_activity_name = ? AND mapping_status = 'unmapped'
      `).run(m.phaseCode || 'other', m.clientLabelEn || m.sourceActivityName,
        m.clientLabelFr || m.sourceActivityName, m.billable !== false ? 1 : 0,
        jobId, m.sourceActivityName);
    }

    res.json({ updated: mappings.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get time entries for a job
app.get('/api/jobs/:id/time-entries', (req, res) => {
  try {
    res.json(getJobTimeEntries(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// START SERVER
// ============================================================

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Ostéopeinture Quote Assistant running on http://localhost:${PORT}`);
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
