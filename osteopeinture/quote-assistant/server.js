require('dotenv').config();
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const Anthropic = require('@anthropic-ai/sdk');
const multer = require('multer');
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
const pgBackup = require('./lib/pg-backup');
const { calculateScaffold } = require('./lib/scaffold-engine');
const { renderQuoteHTML, esc } = require('./lib/quote-renderer');
const { mergeQuoteJson } = require('./lib/quote-merge');
const { extractJsonString, buildCompactStoredUserContent } = require('./lib/shared');
const sessionService = require('./services/session-service');
const jobService = require('./services/job-service');
const { generateQuotePDF } = require('./services/pdf-service');
const attachmentService = require('./services/attachment-service');

// ============================================================
// SUPABASE STORAGE (file attachments)
// ============================================================
let supabase = null;
const STORAGE_BUCKET = 'op-hub-attachments';
if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  console.log('[storage] Supabase Storage initialized');
} else {
  console.log('[storage] SUPABASE_URL/ANON_KEY not set — file attachments disabled');
}

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
sessionService.init(db, DB_PATH);
jobService.init(db, DB_PATH, sessionService);
attachmentService.init(db, supabase);

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

// Run soft-delete migration early so queries work even in tests
(async function runMigrations() {
  try {
    await db.run('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL');
    await db.run('ALTER TABLE jobs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL');
  } catch (e) { /* already exists or test env */ }
})();

// getSession, saveSession, listSessions, nextProjectId → services/session-service.js
const getSession = sessionService.getSession;
const saveSession = sessionService.saveSession;
const listSessions = sessionService.listSessions;
const nextProjectId = sessionService.nextProjectId;



// getJob, listJobs, generateJobNumber, convertSessionToJob, getJobPayments,
// getJobTimeEntries, getJobActivityMappings → services/job-service.js
const getJob = jobService.getJob;
const listJobs = jobService.listJobs;
const generateJobNumber = jobService.generateJobNumber;
const convertSessionToJob = jobService.convertSessionToJob;
const getJobPayments = jobService.getJobPayments;
const getJobTimeEntries = jobService.getJobTimeEntries;
const getJobActivityMappings = jobService.getJobActivityMappings;

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

// buildCompactStoredUserContent, extractJsonString moved to lib/shared.js

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

// LOGO ASSET + QUOTE HTML RENDERER → lib/quote-renderer.js


// renderQuoteHTML, esc, fmt moved to lib/quote-renderer.js


// ============================================================
// SYSTEM PROMPT
// ============================================================

// ── DYNAMIC SYSTEM PROMPT ────────────────────────────────────
// Instead of dumping the entire QUOTING_LOGIC.md (~12K tokens) on every
// message, scan the conversation to detect which topics are relevant and
// only include those sections. A 2-sentence clarification doesn't need
// paint prices and scaffold catalogs.

// Extract a named section from QUOTING_LOGIC.md by header number
function extractSection(full, sectionId) {
  // Match "## N." or "## NA." pattern
  const pattern = new RegExp(`(## ${sectionId}\\..*?)(?=\\n## \\d|$)`, 's');
  const match = full.match(pattern);
  return match ? match[1].trim() : '';
}

// Extract a range of sections
function extractSections(full, from, to) {
  const startPattern = new RegExp(`(## ${from}\\.)`);
  const endPattern = to ? new RegExp(`(## ${to}\\.)`) : null;
  const startIdx = full.search(startPattern);
  if (startIdx === -1) return '';
  const endIdx = endPattern ? full.search(endPattern) : full.length;
  if (endIdx === -1) return full.slice(startIdx);
  return full.slice(startIdx, endIdx).trim();
}

function buildDynamicQuotingLogic(conversationText, userText, isExterior) {
  const full = getQuotingLogic();
  const text = (conversationText + ' ' + userText).toLowerCase();

  // Always include: core rules (§1-2), cost assembly (§11), presentation (§12-13),
  // scope defaults (§15), taxes (§16), deposit (§17), project ID (§18), company (§19)
  const alwaysInclude = [
    extractSections(full, '1', '3'),    // §1-2: hierarchy + labour rates
    extractSections(full, '11', '15'),  // §11-14: cost assembly, presentation, confirmation, tier
    extractSections(full, '15', '20'),  // §15-19: scope, cash, taxes, deposit, project ID, company
  ];

  const conditional = [];

  // Benchmarks — include when discussing rooms, surfaces, hours, or generating
  const needsBenchmarks = /room|pièce|piece|surface|hour|heure|sqft|sq ft|linear|linéaire|baseboard|plinthe|crown|moulure|door|porte|window|fenêtre|closet|garde-robe|staircase|escalier|ceiling|plafond|wall|mur|benchmark|rate|generate|régénère|genere/.test(text);
  if (needsBenchmarks) {
    conditional.push(extractSections(full, '3', '5'));   // §3-4: benchmarks + surface assumptions
    conditional.push(extractSections(full, '3A', '4'));   // §3A-3C: baseboard, crown, production
  }

  // Coverage + gallon calculation
  const needsCoverage = /gallon|gal|coverage|couverture|paint qty|quantit|litre/.test(text);
  if (needsCoverage) {
    conditional.push(extractSection(full, '5'));  // §5: coverage rates
  }

  // Paint products — include when discussing products, colors, finishes, or pricing paint
  const needsPaint = /paint|peinture|product|produit|color|couleur|finish|fini|primer|apprêt|duration|superpaint|regal|advance|pm400|pm200|stain|teinture|benjamin|sherwin|bm |sw /.test(text);
  if (needsPaint) {
    conditional.push(extractSections(full, '6', '9'));  // §6-8: paint selection, primers, price ref
  }

  // Materials + consumables
  const needsMaterials = /protection|floor cover|matéri|consumable|consommable|setup|material/.test(text);
  if (needsMaterials) {
    conditional.push(extractSections(full, '9', '11'));  // §9-10A: floor protection, consumables, operational
  }

  // Confirmed benchmarks + room price benchmarks
  const needsBenchmarkRef = /benchmark|confirmed|vérifié|room price|prix par pièce|sanity/.test(text);
  if (needsBenchmarkRef) {
    conditional.push(extractSections(full, '20', '22'));  // §20-22: confirmed benchmarks, email, room prices
  }

  // JSON format — always include when generating or adjusting quotes
  const needsJson = /generate|régénère|genere|json|quote ready|adjust|modifier|regenerate/.test(text);
  // Also include on first few messages to show Claude the format early
  if (needsJson) {
    conditional.push(extractSections(full, '22', '23'));  // §22 end has interior room benchmarks
  }

  // Exterior sections
  if (isExterior) {
    conditional.push(extractSections(full, '23', '30'));  // §23-29: exterior quoting
  }

  // Scaffold/lifts — only when mentioned
  const needsScaffold = /scaffold|échafaud|lift|nacelle|emco|gamma|ladder|échelle/.test(text);
  if (needsScaffold) {
    conditional.push(extractSections(full, '30', '36'));  // §30-35: scaffold, EMCO, ladders, lifts
  }

  const assembled = [...alwaysInclude, ...conditional].filter(Boolean).join('\n\n');
  return assembled;
}

function buildSystemPrompt(isExterior = false, conversationText = '', userText = '', currentQuoteJson = null) {
  const rules = buildDynamicQuotingLogic(conversationText, userText, isExterior);

  // If the user has manually edited the quote via the Draft editor, inject the current state
  let quoteStateBlock = '';
  if (currentQuoteJson) {
    quoteStateBlock = `

## CURRENT QUOTE STATE (from Draft editor) — CRITICAL
The user has manually edited this quote in the draft editor. Their edits are the source of truth.

**MANDATORY:** When outputting updated JSON, you MUST start from the JSON below and apply ONLY the specific change requested. Do NOT regenerate the quote from scratch. Do NOT use an older version from conversation history. Copy this JSON, make the targeted edit, and output the result. Every field, section, item, price, and description that the user did not ask you to change MUST remain exactly as-is.
\`\`\`json
${JSON.stringify(currentQuoteJson, null, 2)}
\`\`\`
`;
  }

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
- Client name, address, and email address
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
For each room, list EVERY surface on its own line. Each line shows: surface description, approximate sqft or count, coats, labour hours, labour cost, and paint gallons needed for that surface — all on ONE line. Show gallon calc with 1 decimal PLUS the rounded suggestion (e.g., "2.8 gal → 3 gal"). Rounding per §5: round UP unless .1-.2 (round down).

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

EXTERIOR QUOTE REMINDERS (if exterior):
- ALWAYS include "estimateDisclaimer" field. English: "Given the nature of exterior work, this is an estimate and not a fixed price. The final price will be adjusted to reflect the actual preparation time required." French: "Étant donné la nature des travaux extérieurs, il s'agit d'une estimation et non d'un prix fixe. Le prix final sera ajusté pour refléter le temps de préparation réel requis."
- Repairs section MUST have "excluded": true, "total": 0, and a "range" field (e.g. "$500 - $800") showing estimated hourly range. Repairs are NEVER a fixed price on exterior.
- These are non-negotiable for exterior quotes.

EXTERIOR QUOTE STRUCTURE — 3 mandatory H1 sections:
1. H1: "PREPARATION & PEINTURE" (or French equivalent) — all painting zones go here as H2 sections (fenêtres, corniche, solins, toits, extension, etc.). Each H2 has H3 items describing the zone-specific work (do NOT restate prep/coats — covered in boilerplate).
2. H1: "ACCES" — scaffold, lift, ladder rental + installation/dismantling. Default: group all access costs together (rental as one H2, installation as another H2). If the user says "split scaffold per zone", instead list each zone's scaffold cost as a separate H2 so the client can see per-zone breakdown and optionally drop sections.
3. H1: "REPARATIONS" — always excluded from total, always with range. Each repair item as H2 with H3 details.

In JSON terms: use "floor" field for the H1 headers ("PREPARATION & PEINTURE", "ACCES", "REPARATIONS"). Use "name" for H2 zone names. Use "items" for H3 details.

---

## QUOTE JSON FORMAT

Output this exact structure (if user requested French quote, add "lang": "fr" and write all values in French):

{
  "clientName": "Full Name",
  "clientEmail": "client@email.com",
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
    "_NOTE_ON_CONDITIONS": "IMPORTANT: the following 3 lines are ALREADY hardcoded in the quote footer — NEVER repeat them in conditions: (1) additional work billed at $65/h + materials, (2) quote valid 30 days, (3) client responsible for permits. Also NEVER add filler like 'work limited to designated surfaces' — it's obvious and adds no value. Only include conditions that are genuinely specific to this job (e.g., substrate assumptions, access constraints, weather conditions for exterior).",
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
    },
    {
      "floor": "Ground Floor",
      "name": "Kitchen",
      "total": 1800,
      "items": [
        { "description": "Walls — 2 coats", "price": 1200 },
        { "description": "Cabinets — sand, prime, 2 coats", "price": 600 }
      ]
    },
    {
      "title": "Option A — Baseboards, 3 rooms",
      "optional": true,
      "total": 550,
      "items": [
        { "description": "Taping and 2 coats on all baseboards", "price": 550 }
      ]
    }
  ],
  "paints": [
    { "type": "Walls", "product": "SW Duration Home", "color": "BM OC-65 Chantilly Lace", "finish": "Low Sheen", "approxQty": "12 gal", "approxCost": 850 },
    { "type": "Ceilings", "product": "SW PM400", "color": "Ceiling White", "finish": "Extra Flat", "approxQty": "5 gal", "approxCost": 200 },
    { "type": "Trim", "product": "BM Advance", "color": "BM OC-65 Chantilly Lace", "finish": "Semi-Gloss", "approxQty": "4 gal", "approxCost": 350 }
  ],
  "modalities": {
    "startDate": "April 7, 2026",
    "duration": "~ 2 weeks",
    "deposit": 3000,
    "paymentMethod": "The remaining balance is to be paid by cheque or e-transfer, with installments on a weekly basis throughout the work."
  }
}

INTERIOR JSON RULES:

SECTION LAYOUT SHORTHAND — the user may use H1/H2/H3 to direct the quote layout:
- H1 = grey bar header (uppercase, full-width background). JSON: "floor" field on a room section, OR "title" field on a standalone section. Examples: PIECE 1, REPARATIONS, OPTIONS.
- H2 = bold section name with price on the right. JSON: "name" field. Examples: Chambre (bleu fonce) — 975$, Reparations de platre — 450$.
- H3 = bullet item line (arrow prefix). JSON: "items" array entries with "description" and "price". Examples: Murs — 2 couches de finition, Plinthes — 2 couches.
When the user says "put X as H1" use floor or title. "Put X as H2" use name. "Put X as H3" use items.
A section can have H1 + H2 + H3 (floor header, then name, then items), or just H1 + H3 (title header, then items directly — no name row).

- projectId: always LASTNAME_01 (or _02 if second job for this client)
- date: today's date formatted as "Month Day, Year"
- sections: use floor grouping for room-by-room quotes; omit floor field if not applicable. CRITICAL: set the "floor" field on EVERY section in the group, not just the first one. The renderer groups sections by matching floor values — if only the first section has it, the others won't be included in the group total.
- All prices are numbers (not strings), in CAD before tax
- Terms adapt to the job (see examples above)
- sections with renovation categories (Protection, Repairs, etc.) use "title" instead of "name", and optionally "range" (e.g., "$3,000–$5,000")
- Optional add-ons: any section the client has not committed to (e.g., "Option A — Ceilings", "Option B — Baseboards") MUST have "optional": true in the JSON. These are displayed under an "OPTIONAL ADD-ONS" header and excluded from the TOTAL. The total only includes confirmed scope.
- Excluded items: repairs or items billed hourly use "excluded": true — shown but not in total.
- Paint approxCost values are materials only, not labour
- Item descriptions in sections must NEVER include paint product names or finishes — only describe the work
- Item descriptions must NOT restate what is already in the boilerplate inclusions (conditions et inclusions). The inclusions already say "preparation complete", "2 coats on all designated surfaces", "daily protection and cleanup". So item lines should only describe what is UNIQUE to that zone — e.g. "9 groupes/unites (facades avant et arriere)" not "Preparation, appret et 2 couches de finition — 9 groupes/unites". The prep and coats are understood. Keep items short and zone-specific.
- CRITICAL: Item descriptions are CLIENT-FACING. NEVER include internal pricing details: no hourly rates (65$/h, 75$/h), no hour counts (39h, 6h), no markup percentages (tampon 10%), no internal material cost breakdowns (planches ~100$-200$). These are estimating internals — the client sees the total price, not how you got there. Only describe the WORK being done, not the math behind it.
- TOTALS SUM TREE: each section "total" MUST equal the sum of its items[].price values. The renderer computes H1 group totals and the grand total from these — if section totals don't match item sums, the numbers won't add up.
- deposit: always 25% of subtotal, rounded UP to nearest 100
- modalities.paymentMethod: "The remaining balance is to be paid by cheque or e-transfer, with weekly installments throughout the work." for jobs over 1 week; "The remaining balance is due at completion." for jobs of 1 week or less

---

## EXTERIOR QUOTE JSON FORMAT

For exterior jobs, output this structure instead. Key differences: sections use "floor" for H1 grouping and "name" for H2 section names (same as interior), repairs have "excluded": true, optional add-ons have "optional": true (these use "title" instead since they have no group), and an estimateDisclaimer field is always present.

IMPORTANT — totals must form a sum tree:
- Each section "total" MUST equal the sum of its items[].price values (H3 sums = H2 total)
- The H1 group total (shown in the header) is the sum of all section totals under that floor (H2 sums = H1 total)
- The TOTAL line is the sum of all H1 group totals (excluding optional/excluded sections)
Set "floor" on EVERY section in the group, not just the first one.

{
  "clientName": "Full Name",
  "clientEmail": "client@email.com",
  "projectId": "LASTNAME_01",
  "address": "Street Address, Montréal",
  "date": "April 4, 2026",
  "projectType": "Exterior Painting Work",
  "estimateDisclaimer": "Given the nature of exterior work, this is an estimate and not a fixed price. The final price will be adjusted to reflect the actual preparation time required.",
  "terms": {
    "includes": [
      "Proper preparation work, including primer where needed, and 2 coats of paint on all agreed upon surfaces",
      "Outdoor preparation includes cleaning of surfaces, chipping, and scraping of loose paint, caulking, and puttying",
      "Full rust protection treatment includes grinding of existing rust, and application of industrial rust-inhibitive metal primer",
      "Clean up at the end of each day, leaving the space clean",
      "Protection and safeguarding your property from construction damage",
      "A clean and respectful working environment to make the work period as smooth as possible for you"
    ],
    "conditions": [
      "Tout travail de peinture hors de la portée de cette soumission sera facturé à 65 $/h + matériaux",
      "Les travaux de menuiserie sont facturés à 75 $/h + matériaux"
    ],
    "hourlyRate": 65,
    "_NOTE_ON_TERMS": "The two rate lines above (painting 65$/h, carpentry 75$/h) are standard for exterior — always include them in conditions. Add job-specific notes after them (e.g. colour TBD, substrate assumptions). Do NOT add 'quote valid 30 days' or 'client responsible for permits' — those are hardcoded in the footer already."
  },
  "sections": [
    {
      "floor": "PREPARATION & PAINTING",
      "name": "Front Façade — Stucco",
      "total": 2200,
      "items": [
        { "description": "Pressure wash, scrape, sand, prep", "price": 800 },
        { "description": "Prime and paint — 2 coats", "price": 1400 }
      ]
    },
    {
      "floor": "PREPARATION & PAINTING",
      "name": "Side Façade — Wood siding",
      "total": 1800,
      "items": [
        { "description": "Scrape, sand, caulk", "price": 600 },
        { "description": "Prime and paint — 2 coats", "price": 1200 }
      ]
    },
    {
      "floor": "ACCESS",
      "name": "Scaffolding",
      "total": 2500,
      "items": [
        { "description": "Scaffolding rental", "price": 1200 },
        { "description": "Installation and dismantling", "price": 1300 }
      ]
    },
    {
      "floor": "REPAIRS",
      "name": "Repairs",
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
    { "type": "Façade", "product": "SW Duration Ext", "color": "TBD", "finish": "Satin", "approxQty": "8 gal", "approxCost": 450 },
    { "type": "Deck", "product": "STEINA Enduradeck", "color": "TBD", "finish": "Opaque", "approxQty": "4 gal", "approxCost": 220 }
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
  - Pricing mode: "fixed" = each section has a single "total" number (default for interior). "ranges" = each section has a "range" field like "$1,000 - $1,200" AND a "total" with the recommended midpoint/estimate (default for exterior). Repairs always use ranges regardless of mode. When ranges mode: the renderer shows the range in brackets on the H2 section name, e.g. "Corniche — façade avant [2,500$ – 3,500$]" with the total on the right as the estimated price. NEVER embed ranges in H1 floor names — the renderer computes and shows the H1 group total automatically.
  - Paint tier: use High-end products (Duration Home for walls) or Standard products (SuperPaint for walls) from §6
  - Paint prices: if "hide", set approxCost to 0 in the paints array (the renderer will omit the price column). If "show", include real approxCost values.
- Do NOT ask the user about language, interior/exterior, or paint tier if the toggles already specify them. Just use the toggle values.
- Before finalizing the JSON, BRIEFLY ask the user to confirm or estimate paint quantities (gallons per product). Use §5 COVERAGE RATES from QUOTING_LOGIC.md to propose a number based on the surface area you have. Example: "Walls ~520 sqft × 2 coats ÷ 350 sqft/gal ≈ 3 gal of Regal — sound right?" The user can answer with a number, "yes", or "skip" — if skip, set approxQty to null. Always include the approxQty field in the paints array (string like "12 gal" or null). This populates the Products section automatically when the quote becomes a job.
- You have access to 80 past OstéoPeinture quotes (2024-2025) in the database. When the user asks about similar past jobs, mentions a client name, or when a price reference would be helpful, search the past quotes and cite them with the date: "For [client] at [address] in [Month Year], you quoted $X." Always include the date to avoid stale pricing confusion. Never guess — only cite actual data from past quotes.
- For EXTERIOR jobs: never calculate labour hours from benchmarks — the estimator provides hours manually. Only calculate product quantities for decks and large stucco where sqft was collected.
- For EXTERIOR jobs: always include the estimateDisclaimer field. Always include a Repairs section with excluded: true. Always round section totals to nearest $50.
- For EXTERIOR jobs: before generating, sanity-check zone totals against §27 benchmark ranges. Flag anything significantly off but never block — estimator has final say.
- Today's date is ${new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })}
${quoteStateBlock}`;
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
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  maxAge: 0,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  },
}));

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
// ROUTE MODULES
// ============================================================

const adminRoutes = require('./routes/admin');
adminRoutes.init({
  db,
  pgBackup,
  DB_PATH,
  backupToDrive,
  getQuotingLogic,
  writeQuotingLogic: (content) => fs.writeFileSync(QUOTING_LOGIC_PATH, content, 'utf8'),
});
app.use(adminRoutes.router);

const scaffoldRoutes = require('./routes/scaffold');
scaffoldRoutes.init({ calculateScaffold });
app.use(scaffoldRoutes.router);

const attachmentRoutes = require('./routes/attachments');
attachmentRoutes.init({ attachmentService, getJob, upload, sendUploadError });
app.use(attachmentRoutes.router);

const emailRoutes = require('./routes/email');
emailRoutes.init({
  getAnthropicClient: () => anthropic,
  db,
  getSession,
  saveSession,
  getJob,
  getEmailLogic,
  buildEmailDraft,
  buildEmailSubject,
  extractTextContent,
  renderQuoteHTML,
  generateQuotePDF,
  getPastEmailExamples,
});
app.use(emailRoutes.router);

const invoiceRoutes = require('./routes/invoices');
invoiceRoutes.init({
  db,
  getJob,
  getJobPayments,
  renderQuoteHTML,
  esc,
  generateQuotePDF,
  syncPaymentToSheet,
});
app.use(invoiceRoutes.router);

const jobRoutes = require('./routes/jobs');
jobRoutes.init({
  db,
  getJob,
  listJobs,
  convertSessionToJob,
  getJobPayments,
  getJobTimeEntries,
  getJobActivityMappings,
  syncPaymentToSheet,
  scheduleBackup,
  DB_PATH,
  getAnthropicClient: () => anthropic,
  extractTextContent,
  extractJsonString,
});
app.use(jobRoutes.router);

// ============================================================
// API ROUTES
// ============================================================


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
  const { status, toggles } = req.body;
  if (status) {
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    session.status = status;
  }
  if (toggles) {
    if (!session.emailMeta) session.emailMeta = {};
    session.emailMeta._toggles = toggles;
  }
  if (!status && !toggles) return res.status(400).json({ error: 'Nothing to update' });
  await saveSession(session);
  res.json({ ok: true, status: session.status });
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
            levels: { type: 'number', description: 'Number of levels. Use 0.5 increments for half-height top level (e.g. 3.5 = 3 full levels + 1 half-height frame level with 6ft braces).' },
            overhang_levels: { type: 'integer' },
            triangle_size: { type: 'string', enum: ['small', 'medium', 'large'] },
            sidewalk_frames: { type: 'boolean', default: false },
            adjacent_to: { type: ['string', 'null'], default: null },
            duration_days: { type: ['integer', 'null'], default: null },
            notes: { type: 'string', default: '' },
            component_overrides: {
              type: 'object',
              description: 'Optional: override formula-calculated quantities for specific components. Keys are component names (e.g. "Platform 7ft", "Plank 8ft"), values are integer quantities. Use when the user provides explicit quantities that differ from standard formulas.',
              default: null,
            },
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

    // Upload normalized images to Supabase Storage (persist for later access)
    if (normalizedImages.length > 0) {
      for (const img of normalizedImages) {
        try {
          await attachmentService.uploadAttachment({
            file: img, sessionId: req.params.id, pathPrefix: `sessions/${req.params.id}`,
          });
        } catch (e) { console.warn('[storage] attach error:', e.message); }
      }
    }

    const content = [];
    if (userText) content.push({ type: 'text', text: userText });
    content.push(...buildAnthropicImageParts(normalizedImages));

    if (!content.length) {
      return res.status(400).json({ error: 'No message or image' });
    }

    // Send full conversation history — context is critical for quoting.
    // Strip orphaned tool_use/tool_result blocks that cause API errors.
    const fullHistory = buildTextOnlyHistory(session.messages).filter(m => {
      if (Array.isArray(m.content)) {
        return !m.content.some(b => b.type === 'tool_use' || b.type === 'tool_result');
      }
      return true;
    });
    // Ensure first message is from 'user' (Anthropic API requirement)
    while (fullHistory.length > 0 && fullHistory[0].role !== 'user') {
      fullHistory.shift();
    }
    fullHistory.push({ role: 'user', content });
    const messages = fullHistory;

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
      system: buildSystemPrompt(isExteriorSession, conversationText, userText, session.quoteJson),
      messages,
    };
    // Always provide past quotes search; scaffold only for exterior sessions
    apiParams.tools = [PAST_QUOTES_TOOL];
    if (isExteriorSession) {
      apiParams.tools.push(SCAFFOLD_TOOL);
    }
    // Helper to write SSE events
    const sse = (payload) => res.write('data: ' + JSON.stringify(payload) + '\n\n');

    // Start SSE stream
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Handle client disconnect
    let aborted = false;
    req.on('close', () => { aborted = true; });

    // Stream the first Claude call
    let assistantText = '';
    const stream = anthropic.messages.stream({ ...apiParams, messages });
    stream.on('text', (text) => {
      if (aborted) return;
      assistantText += text;
      sse({ type: 'delta', text });
    });
    const finalMessage = await stream.finalMessage();

    // If tool use, run the tool loop non-streaming then send the final result
    if (finalMessage.stop_reason === 'tool_use') {
      let assistantContent = finalMessage.content;
      let response = finalMessage;
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
      // Send the final text (replaces any partial stream from before tool use)
      assistantText = extractTextContent(assistantContent);
      if (!aborted) sse({ type: 'replace', text: assistantText });
    }

    // Save to session
    session.messages.push({
      role: 'user',
      content: buildCompactStoredUserContent(userText, normalizedImages),
    });

    let quoteJson = null;
    let status = session.status;
    const jsonString = extractJsonString(assistantText);
    if (jsonString) {
      try {
        quoteJson = JSON.parse(jsonString);
        status = 'quote_ready';

        // MERGE: field-level merge of Claude's output with the current draft.
        const existingQuote = session.quoteJson;
        if (existingQuote && existingQuote.sections && quoteJson.sections) {
          // Save snapshot for undo (persisted in emailMeta so it survives restarts)
          if (!session.emailMeta) session.emailMeta = {};
          session.emailMeta._previousQuoteJson = JSON.parse(JSON.stringify(existingQuote));

          quoteJson = mergeQuoteJson(existingQuote, quoteJson);
        }

        let total = 0;
        for (const sec of (quoteJson.sections || [])) {
          if (sec.excluded || sec.optional) continue;
          if (sec.total) total += sec.total;
          else for (const item of (sec.items || [])) total += (item.price || 0);
        }
        session.totalAmount = total;
        session.clientName = quoteJson.clientName || null;
        session.projectId = quoteJson.projectId || null;
        session.address = quoteJson.address || null;
        if (quoteJson.clientEmail) session.emailRecipient = quoteJson.clientEmail;
        session.quoteJson = quoteJson;
      } catch (e) {}
    }

    if (!session.projectId || session.projectId.startsWith('NEW_')) {
      // Check both assistant and user text for client name patterns
      const bothText = userText + '\n' + assistantText;
      // Pattern 1: explicit LASTNAME_XX format (user typed it)
      const projectIdMatch = bothText.match(/([A-ZÀ-ÖØ-Ý]{2,}[_-]\d{1,2})/);
      if (projectIdMatch) {
        session.projectId = projectIdMatch[1].replace('-', '_');
      } else {
        // Pattern 2: "Client: Name" or "Nom: Name" in assistant text
        const nameMatch = assistantText.match(/(?:client|nom|name)\s*[:—]\s*([A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ]+(?:\s+[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ]+)*)/i);
        if (nameMatch && nameMatch[1]) {
          const lastName = nameMatch[1].trim().split(/\s+/).pop().toUpperCase();
          session.projectId = lastName + '_01';
          session.clientName = nameMatch[1].trim();
        }
      }
    }

    // Extract client email from user message if not already set
    if (!session.emailRecipient) {
      const emailMatch = userText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      if (emailMatch) session.emailRecipient = emailMatch[0];
    }

    session.messages.push({ role: 'assistant', content: assistantText });
    session.status = status;
    await saveSession(session);

    if (!aborted) {
      sse({ type: 'done', status, hasQuote: !!quoteJson });
      res.end();
    }
  } catch (error) {
    if (error instanceof UploadError) {
      return res.status(error.status || 400).json({ error: error.message });
    }
    console.error('Claude API error:', error);
    // If SSE headers already sent, send error as SSE event
    if (res.headersSent) {
      try { res.write('data: ' + JSON.stringify({ type: 'error', message: error.message || 'Unexpected server error' }) + '\n\n'); } catch(e) {}
      res.end();
    } else {
      res.status(500).json({ error: 'Unexpected server error' });
    }
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

// generateQuotePDF → services/pdf-service.js

app.post('/api/sessions/:id/pdf', async (req, res) => {
  const session = await getSession(req.params.id);
  if (!session || !session.quoteJson) return res.status(404).json({ error: 'No quote' });

  try {
    const html = renderQuoteHTML(session.quoteJson);
    const pdfBuffer = await generateQuotePDF(html);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${session.projectId || 'Quote'} - Painting Quote.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('PDF generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Adjust quote JSON
// Undo last Claude quote change — restores the snapshot saved before merge
app.post('/api/sessions/:id/undo-quote', async (req, res) => {
  const session = await getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const prev = session.emailMeta && session.emailMeta._previousQuoteJson;
  if (!prev) return res.status(400).json({ error: 'Nothing to undo' });
  session.quoteJson = prev;
  delete session.emailMeta._previousQuoteJson;
  let total = 0;
  for (const sec of (session.quoteJson.sections || [])) {
    if (sec.excluded || sec.optional) continue;
    if (sec.total) total += sec.total;
    else for (const item of (sec.items || [])) total += (item.price || 0);
  }
  session.totalAmount = total;
  await saveSession(session);
  res.json({ ok: true, quoteJson: session.quoteJson, totalAmount: total });
});

app.post('/api/sessions/:id/adjust-quote', async (req, res) => {
  const session = await getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const { quoteJson } = req.body;
  if (!quoteJson) return res.status(400).json({ error: 'Missing quoteJson' });

  session.quoteJson = quoteJson;
  session.status = 'quote_ready';

  // Recompute total — skip excluded and optional sections (matches renderQuoteHTML logic)
  let total = 0;
  for (const sec of (quoteJson.sections || [])) {
    if (sec.excluded || sec.optional) continue;
    if (sec.total) total += sec.total;
    else for (const item of (sec.items || [])) total += (item.price || 0);
  }
  session.totalAmount = total;
  session.clientName = quoteJson.clientName || session.clientName;
  session.projectId = quoteJson.projectId || session.projectId;
  session.address = quoteJson.address || session.address;
  if (quoteJson.clientEmail) session.emailRecipient = quoteJson.clientEmail;
  await saveSession(session);

  res.json({ ok: true, totalAmount: total });
});

// Delete session (soft delete)
app.delete('/api/sessions/:id', async (req, res) => {
  const session = await getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  await db.run('UPDATE sessions SET deleted_at = NOW() WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// Job management, payments, smart-paste, Jibble import, activity mappings,
// time entries, and past-quotes search → routes/jobs.js

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  // Start server immediately — never block on backup
  app.listen(PORT, async () => {
    console.log(`OP Hub running on http://localhost:${PORT}`);
    // Create attachments table if it doesn't exist
    try {
      await db.run(`CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        job_id TEXT,
        filename TEXT NOT NULL,
        original_name TEXT,
        content_type TEXT,
        size_bytes INTEGER,
        storage_path TEXT NOT NULL,
        public_url TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      await db.run('CREATE INDEX IF NOT EXISTS idx_attachments_session ON attachments(session_id)');
      await db.run('CREATE INDEX IF NOT EXISTS idx_attachments_job ON attachments(job_id)');
    } catch (e) { console.log('[attachments] table setup:', e.message); }
    // Soft-delete migrations
    try {
      await db.run('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL');
      await db.run('ALTER TABLE jobs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL');
    } catch (e) { console.log('[migrations] soft-delete columns:', e.message); }
    // Restore/backup in background after server is up
    ensureDatabase(DB_PATH).then((status) => {
      console.log(`[db-backup] DB status: ${status}`);
    }).catch((err) => {
      console.error('[db-backup] Startup backup error:', err.message);
    });
    // Run Postgres JSON backup 15 seconds after startup (let app initialize first)
    setTimeout(async function() {
      try {
        await pgBackup.saveBackup(db);
      } catch (e) {
        console.error('[backup] Startup backup failed:', e.message);
      }
    }, 15000);
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
