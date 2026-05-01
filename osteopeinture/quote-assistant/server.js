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
const db = require('./db');
const DB_PATH = path.join(DATA_DIR, 'sessions.db');
sessionService.init(db, DB_PATH);
jobService.init(db, DB_PATH, sessionService);
attachmentService.init(db, supabase);

// Seed QUOTING_LOGIC.md to DATA_DIR on first run so it persists on the volume.
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

// Run soft-delete migration early so queries work even in tests
(async function runMigrations() {
  try {
    await db.run('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL');
    await db.run('ALTER TABLE jobs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL');
  } catch (e) { /* already exists or test env */ }
})();

// Service shortcuts
const getSession = sessionService.getSession;
const saveSession = sessionService.saveSession;
const listSessions = sessionService.listSessions;
const nextProjectId = sessionService.nextProjectId;

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

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'Transactions!A:N',
      valueInputOption: 'RAW',
      requestBody: {
        values: [[
          payment.date,
          `Invoice paid — ${job.client_name} — ${job.job_number}`,
          account, '',
          amountDollars,
          'Contract Revenue', '',
          month, job.job_number,
          'Invoice', entryId,
          'quote-assistant', paymentId,
          new Date().toISOString(),
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

// ── EMAIL HELPERS (used by email routes + buildEmailDraft) ────────────────

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
    .join('\n').toLowerCase();
  const userText = (session?.messages || [])
    .filter((message) => message && message.role === 'user')
    .map((message) => extractTextContent(message.content))
    .join('\n').toLowerCase();
  const quoteText = [
    session?.quoteJson?.projectId || '',
    session?.quoteJson?.address || '',
    session?.quoteJson?.notes || '',
  ].join('\n').toLowerCase();
  const text = `${assistantText}\n${userText}\n${quoteText}`;

  if (/prefer not to|pass this time|pass our turn|laisser passer notre tour|fully booked|booked til|booked until|not a fit|impossible for us/.test(text)) return 'decline';
  if (/coming soon|haven't forgotten|have not forgotten|you will receive it|prepare your quote|patience/.test(text)) return 'quote_promise';
  if (/follow up|follow-up|suivi/.test(text)) return session?.quoteJson ? 'quote_follow_up' : 'lead_follow_up';
  if (/updated quote|revised quote|soumission ajustee|soumission ajustée|soumission revisee|soumission révisée|erratum|corrected version/.test(text)) return 'quote_revision';
  if (/project update|mise-a-jour|mise à jour|cost breakdown|cost to completion|projection des couts|projection des coûts|ventilation des couts|ventilation des coûts/.test(text)) return 'project_update';
  if (/photos|send photos|envoyez|availability|disponibilit|site visit|estimate visit|details/.test(text)) return session?.quoteJson ? 'quote_send' : 'lead_more_info';
  if (!session?.quoteJson) return 'lead_more_info';
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
      english: { signOff: 'Best,', signature: ['Loric', 'For Ostéopeinture', '514-266-2028'] },
      french: { signOff: 'Merci,', signature: ['Loric', 'Pour Ostéopeinture', '514-266-2028'] },
    },
    Graeme: {
      english: { signOff: 'Thank you,', signature: ['Graeme', 'For Ostéopeinture', '514-266-2028'] },
      french: { signOff: 'Regards,', signature: ['Graeme', 'Pour Ostéopeinture', '514-266-2028'] },
    },
    Lubo: {
      english: { signOff: 'Thank you,', signature: ['Lubo', 'For Ostéopeinture', '514-266-2028'] },
      french: { signOff: 'Cordialement,', signature: ['Lubo', 'Pour Ostéopeinture', '514-266-2028'] },
    },
  };
  const signerProfile = profiles[signer] || profiles.Loric;
  return signerProfile[language] || signerProfile.english;
}

function joinParagraphs(parts) { return parts.filter(Boolean).join('\n\n'); }

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
      : (language === 'french' ? `Voici la soumission ci-jointe${locationText}.` : `Please find the attached quote${locationText}.`);
    const cta = language === 'french' ? "N'hésitez pas si vous avez des questions ou si vous voulez qu'on avance." : "Let me know if you have any questions or if you want to move ahead.";
    body = joinParagraphs([greeting, framing, cta]);
  } else if (emailMeta.scenario === 'quote_revision') {
    const framing = language === 'french' ? "Voici la version révisée de la soumission ci-jointe." : "Please find the revised quote attached.";
    const detail = emailMeta.detailLevel === 'detailed'
      ? (language === 'french' ? "J'ai ajusté le document pour refléter les changements discutés. Si vous voulez, on peut aussi revoir une option ou une phase plus précisément." : "I updated it to reflect the changes we discussed. If you want, we can also revisit an option or a phase more precisely.")
      : '';
    const cta = language === 'french' ? "Dites-moi si cette version vous convient." : "Let me know if this version works for you.";
    body = joinParagraphs([greeting, framing, detail, cta]);
  } else if (emailMeta.scenario === 'quote_follow_up') {
    body = joinParagraphs([greeting, language === 'french' ? "Petit suivi par rapport à la soumission envoyée." : "Just following up on the quote we sent.", language === 'french' ? "Dites-moi si vous avez des questions ou si vous voulez qu'on en discute." : "Let me know if you have any questions or if you want to talk it through."]);
  } else if (emailMeta.scenario === 'quote_promise') {
    body = joinParagraphs([greeting, language === 'french' ? "Simplement pour vous dire qu'on ne vous a pas oublié. Vous devriez recevoir la soumission sous peu." : "Just a quick note to say we haven't forgotten about your quote. You should receive it shortly.", emailMeta.detailLevel === 'detailed' ? (language === 'french' ? "Merci pour votre patience entre-temps." : "Thanks for your patience in the meantime.") : '']);
  } else if (emailMeta.scenario === 'lead_follow_up') {
    body = joinParagraphs([greeting, language === 'french' ? "Je voulais simplement vérifier si vous cherchez encore des peintres pour votre projet." : "I just wanted to check whether you are still looking for painters for your project.", language === 'french' ? "Si oui, répondez-moi ici et on pourra voir la suite." : "If so, reply here and we can figure out the next step."]);
  } else if (emailMeta.scenario === 'lead_more_info') {
    body = joinParagraphs([greeting, language === 'french' ? "Ça semble intéressant de notre côté, mais avant de fixer quoi que ce soit, ce serait utile d'avoir quelques détails de plus." : "This looks potentially interesting on our end, but before locking anything in it would help to get a bit more detail.", language === 'french' ? "Si vous pouvez, envoyez-nous quelques photos, une idée du timing, et vos disponibilités pour une éventuelle visite." : "If you can, send us a few photos, a rough timing target, and your availability for a possible visit."]);
  } else if (emailMeta.scenario === 'project_update') {
    body = joinParagraphs([greeting, language === 'french' ? "Voici une mise à jour du projet et des coûts à ce stade." : "Here is a project and cost update at this stage.", emailMeta.detailLevel === 'detailed' ? (language === 'french' ? "J'ai résumé les ajustements importants de façon claire pour que vous ayez une bonne vue d'ensemble de ce qui a changé." : "I summarized the important adjustments clearly so you have a good overview of what changed.") : '', language === 'french' ? "Dites-moi si vous voulez qu'on passe un point en revue ensemble." : "Let me know if you want to go over any part of it together."]);
  } else if (emailMeta.scenario === 'decline') {
    body = joinParagraphs([greeting, language === 'french' ? "Merci d'avoir pensé à nous pour ce projet. Malheureusement, on va devoir passer notre tour cette fois-ci." : "Thanks for thinking of us for this project. Unfortunately, we're going to have to pass this time.", emailMeta.detailLevel === 'detailed' ? (language === 'french' ? "Notre horaire / notre contexte actuel ne nous permet pas de prendre ce mandat convenablement." : "Our current schedule / setup doesn't let us take this on properly right now.") : '']);
  } else {
    body = joinParagraphs([greeting, language === 'french' ? `Voici la soumission ci-jointe${locationText}.` : `Please find the attached quote${locationText}.`]);
  }
  return joinParagraphs([body, signer.signOff, signer.signature.join('\n')]);
}

function buildEmailDraft(session) {
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
    if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Each image must be 20MB or smaller' });
    if (error.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: `A maximum of ${MAX_IMAGE_COUNT} images can be uploaded at once` });
    if (error.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ error: 'Unexpected upload field' });
    return res.status(400).json({ error: error.message || 'Invalid upload' });
  }
  return null;
}

// ============================================================
// ROUTE MODULES
// ============================================================

const adminRoutes = require('./routes/admin');
adminRoutes.init({
  db, pgBackup, DB_PATH, backupToDrive, getQuotingLogic,
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
  db, getSession, saveSession, getJob, getEmailLogic,
  buildEmailDraft, buildEmailSubject, extractTextContent,
  renderQuoteHTML, generateQuotePDF, getPastEmailExamples,
});
app.use(emailRoutes.router);

const invoiceRoutes = require('./routes/invoices');
invoiceRoutes.init({
  db, getJob, getJobPayments, renderQuoteHTML, esc,
  generateQuotePDF, syncPaymentToSheet,
});
app.use(invoiceRoutes.router);

const jobRoutes = require('./routes/jobs');
jobRoutes.init({
  db, getJob, listJobs, convertSessionToJob,
  getJobPayments, getJobTimeEntries, getJobActivityMappings,
  syncPaymentToSheet, scheduleBackup, DB_PATH,
  getAnthropicClient: () => anthropic,
  extractTextContent, extractJsonString,
});
app.use(jobRoutes.router);

const quoteRoutes = require('./routes/quotes');
quoteRoutes.init({
  db,
  getAnthropicClient: () => anthropic,
  getSession, saveSession, listSessions, nextProjectId,
  buildEmailDraft, renderQuoteHTML, generateQuotePDF,
  mergeQuoteJson, extractJsonString, buildCompactStoredUserContent,
  extractTextContent, calculateScaffold, attachmentService,
  upload, sendUploadError,
  normalizeImages, buildAnthropicImageParts,
  MAX_IMAGE_COUNT, UploadError,
  getQuotingLogic,
});
app.use(quoteRoutes.router);

// ============================================================
// START SERVER
// ============================================================

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
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
    // Run Postgres JSON backup 15 seconds after startup
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
  createSessionHandler: quoteRoutes.createSessionHandler,
  getSession,
  handleSessionMessage: quoteRoutes.handleSessionMessage,
  sendUploadError,
  setAnthropicClient,
};
