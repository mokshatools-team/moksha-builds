#!/usr/bin/env node
/**
 * import-past-emails.js
 *
 * Imports the 197 *sent* messages from past-quotes/email-history/messages.json
 * into the Supabase past_emails table. The standalone email draft endpoint
 * uses these as tone-reference examples so generated drafts match the actual
 * voice of past OstéoPeinture correspondence (instead of generic Claude).
 *
 * Idempotent: ON CONFLICT (message_id) DO NOTHING — safe to re-run.
 *
 * Run:  node scripts/import-past-emails.js
 * Env:  DATABASE_URL (Supabase Session Pooler)
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../db');

const MESSAGES_PATH = path.join(__dirname, '..', 'past-quotes', 'email-history', 'messages.json');

/**
 * Infer signer (Loric / Graeme / Lubo / unknown) from signature block.
 * The signature block is the cleanest signal — it contains the actual
 * typed name, not the From-header (which is always "OstéoPeinture").
 */
function inferSigner(signatureBlock, normalizedText) {
  const sig = (signatureBlock || '').toLowerCase();
  const body = (normalizedText || '').toLowerCase();
  if (sig.includes('loric') || body.includes('loric st-onge')) return 'Loric';
  if (sig.includes('graeme')) return 'Graeme';
  if (sig.includes('lubo')) return 'Lubo';
  return 'Unknown';
}

/**
 * Cheap French/English detector from accent density. Stored at import so the
 * draft endpoint can filter examples to match the requested draft language.
 */
function inferLanguage(text) {
  if (!text) return 'unknown';
  const sample = text.slice(0, 1500);
  const accentChars = (sample.match(/[àâçéèêëîïôûùüÿœÀÂÇÉÈÊËÎÏÔÛÙÜŸŒ]/g) || []).length;
  const letters = (sample.match(/[a-zA-Z]/g) || []).length;
  if (letters < 50) return 'unknown';
  // FR sent emails average ~3-5% accents; EN ~0%. Threshold 1% catches FR reliably.
  return (accentChars / letters) > 0.01 ? 'french' : 'english';
}

/**
 * Crude scenario classifier from subject + body keywords.
 * Used at query time to fetch matching tone references. We tag at import
 * to keep the runtime query fast (no LIKE scans across 197 bodies).
 */
function inferScenario(subject, body) {
  const s = (subject || '').toLowerCase();
  const b = (body || '').toLowerCase().slice(0, 500); // first chunk only
  const text = s + ' ' + b;
  if (/voici la soumission|here'?s the quote|please find|ci-joint|attached/.test(text)) return 'quote_send';
  if (/r[ée]vis|updated|nouvelle version/.test(text)) return 'quote_revision';
  if (/follow.?up|relance|suivi|just checking|toujours int[ée]ress/.test(text)) return 'quote_follow_up';
  if (/d[ée]sol|decline|pass|on ne peut pas|cannot take/.test(text)) return 'decline';
  if (/plus d'info|more info|quelques questions|a few questions|d[ée]tails/.test(text)) return 'lead_more_info';
  if (/avancement|update|progress|on est rendu/.test(text)) return 'project_update';
  return 'other';
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set. Source .env or export it.');
    process.exit(1);
  }

  console.log('[import] Loading messages.json…');
  const all = JSON.parse(fs.readFileSync(MESSAGES_PATH, 'utf8'));
  const sent = all.filter(m => m.direction === 'sent' && m.normalizedText && m.normalizedText.length > 50);
  console.log(`[import] ${all.length} messages total → ${sent.length} sent w/ body`);

  // Make sure the table exists (idempotent — matches the schema we created
  // manually in Supabase). Adding here so a fresh dev DB also works.
  await db.run(`
    CREATE TABLE IF NOT EXISTS past_emails (
      id TEXT PRIMARY KEY,
      message_id TEXT UNIQUE,
      sent_at TEXT,
      subject TEXT,
      to_address TEXT,
      to_name TEXT,
      body TEXT,
      sign_off TEXT,
      signer TEXT,
      scenario TEXT,
      language TEXT,
      thread_id TEXT,
      relevance_reasons TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Columns added after initial schema — safe on re-run
  await db.run(`ALTER TABLE past_emails ADD COLUMN IF NOT EXISTS scenario TEXT`);
  await db.run(`ALTER TABLE past_emails ADD COLUMN IF NOT EXISTS language TEXT`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_past_emails_signer ON past_emails(signer)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_past_emails_scenario ON past_emails(scenario)`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_past_emails_language ON past_emails(language)`);

  let inserted = 0;
  let skipped = 0;
  for (const m of sent) {
    const id = m.messageId || `${m.account}-${m.uid}`;
    const messageId = m.messageId || null;
    const sentAt = m.date || null;
    const subject = m.subject || '';
    const toAddress = (m.toEmails && m.toEmails[0]) || (m.to && m.to[0] && m.to[0].address) || '';
    const toName = (m.to && m.to[0] && m.to[0].name) || '';
    const body = m.normalizedText || '';
    const signOff = m.signOff || '';
    const signer = inferSigner(m.signatureBlock, m.normalizedText);
    const scenario = inferScenario(subject, body);
    const language = inferLanguage(body);
    const threadId = m.threadId || null;
    const relevanceReasons = (m.relevanceReasons || []).join(', ') || null;

    // UPSERT so re-running backfills new columns (e.g. language added later)
    const result = await db.run(
      `INSERT INTO past_emails
       (id, message_id, sent_at, subject, to_address, to_name, body, sign_off, signer, scenario, language, thread_id, relevance_reasons)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         signer = EXCLUDED.signer,
         scenario = EXCLUDED.scenario,
         language = EXCLUDED.language`,
      [id, messageId, sentAt, subject, toAddress, toName, body, signOff, signer, scenario, language, threadId, relevanceReasons]
    );
    if (result.rowCount > 0) inserted++;
    else skipped++;
  }

  console.log(`[import] Inserted: ${inserted} | Skipped (already present): ${skipped}`);

  // Quick stats
  const { rows: stats } = await db.getPool().query(`
    SELECT signer, scenario, language, COUNT(*)::int AS n
    FROM past_emails
    GROUP BY signer, scenario, language
    ORDER BY n DESC
  `);
  console.log('[import] Distribution:');
  stats.forEach(s => console.log(`  ${s.signer.padEnd(10)} ${(s.scenario||'?').padEnd(20)} ${(s.language||'?').padEnd(8)} ${s.n}`));

  await db.getPool().end();
}

main().catch(err => {
  console.error('[import] FAILED:', err);
  process.exit(1);
});
