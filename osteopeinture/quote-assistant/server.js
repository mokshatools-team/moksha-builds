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

  // Calculate subtotal
  let subtotal = 0;
  for (const sec of sections) {
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
    // Category-based (Bunding/renovation style)
    for (let si = 0; si < sections.length; si++) {
      const sec = sections[si];
      const secTotal = sec.total != null ? sec.total : (sec.items || []).reduce((s, i) => s + (i.price || 0), 0);
      const rangeLabel = sec.range ? ` <span style="font-size:7.5px;font-weight:400;color:#888;">${esc(sec.range)}</span>` : '';
      tableHtml += `<tr class="row-section"><td class="col-desc">${esc(sec.title || sec.name || '')}${rangeLabel}</td><td class="col-price">${secTotal ? fmt(secTotal) : ''}</td></tr>`;
      for (const item of (sec.items || [])) {
        tableHtml += `<tr class="row-item"><td class="col-desc"><span class="arrow">➛</span>${esc(item.description || '')}</td><td class="col-price">${item.price ? fmt(item.price) : ''}</td></tr>`;
      }
      if (si < sections.length - 1) {
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

You run two estimating modes: a quick ballpark mode for fast room-average guidance and a full quote mode for measured, room-by-room estimating. Gather the minimum information needed, then generate a complete quote JSON. Keep the work moving and keep replies short.

---

## CONVERSATION FLOW

**Phase 1 — Client and project overview:**
Ask for the basics first, one or two questions at a time. Collect:
- Client name and address
- Project type and a basic description of the scope
- Any immediately relevant special conditions, only if already mentioned
- After the overview, ask: "Do you want a quick ballpark or a full quote?"

**Phase 2A — Quick ballpark:**
Use standards and room-average logic by room.
- Build the ballpark from task buckets such as protection / covering, prep, priming when applicable, walls, ceilings, baseboards / trim, doors, windows, closets, and touch-ups / cleanup share
- Ask for the room list and floor grouping when relevant
- Ask whether the home or room style is modern or Victorian
- Ask whether the space should be treated as low-end, mid-end, or high-end
- Ask what surfaces are included in each room and whether closets are included when relevant
- Do not recommend getting dimensions first
- When you have enough information for a ballpark, say: "Here's your quick ballpark summary before I generate the JSON — please confirm or correct anything."

**Phase 2B — Full quote:**
Ask for room-by-room and floor-by-floor scope.
- Ask whether the user has paintable sqft, floor plans, or room dimensions
- If available, prefer measured-surface logic
- If not available, proceed with room-average fallback logic
- Ask for door-face count, window count, window type, and closet inclusion when relevant
- Ask special-condition questions only when triggered by scope

**Phase 3 — Pre-generation review:**
Quick ballpark path:
- Show a brief ballpark estimate summary before generating the JSON.
- State clearly that this is a ballpark estimate.
- State that it is based on standards / room averages.
- State the assumed home style: modern or Victorian.
- State the assumed tier: low-end, mid-end, or high-end.
- Keep the review compact and mode-specific so it does not read like the full-quote review.
- Keep the JSON structure intact, but only surface the fields that matter for the ballpark estimate.
- Keep the clean markdown summary pattern with short headers and bullet points, and make assumptions explicit before JSON generation.

Full quote path:
- Say: "Here's my full quote summary before I generate the JSON — please confirm or correct anything."
- Show ALL FOUR sections using clean readable markdown (### headers, bullet points — NO markdown tables):
### 1. Scope & General Conditions
- List what's included + general conditions

### 2. Cost Breakdown
- Room by room with subtotals and floor groupings
- Item descriptions must NOT include paint product names or finishes — keep descriptions to work type only (e.g. "Walls and ceiling — 2 coats", NOT "Walls and ceiling — 2 coats, SW Duration Home Low Sheen")

### 3. Paint & Products
- Products selected, colours, finishes, approx. material cost per product

### 4. Details & Modalities
- Start date, duration, deposit (25% rounded up to nearest $100), payment terms
- State which parts were measured vs estimated.
- Include door and window assumptions, closet inclusion, and setup and day-count assumptions.
- Mention any provisional benchmark used.

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

RULES:
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
