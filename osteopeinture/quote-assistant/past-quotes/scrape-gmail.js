#!/usr/bin/env node
/**
 * scrape-gmail.js — Export relevant Ostéopeinture Gmail quote / lead context.
 * Saves quote PDFs to ./pdfs/ and structured email history to ./email-history/.
 *
 * Run: node past-quotes/scrape-gmail.js
 */

const Imap = require('./node_modules/node-imap');
const { simpleParser } = require('./node_modules/mailparser');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function loadAccounts() {
  const accounts = [
    {
      user: process.env.GMAIL_SCRAPE_PRIMARY_USER || process.env.SMTP_USER || '',
      pass: process.env.GMAIL_SCRAPE_PRIMARY_PASS || process.env.SMTP_PASS || '',
    },
    {
      user: process.env.GMAIL_SCRAPE_SECONDARY_USER || '',
      pass: process.env.GMAIL_SCRAPE_SECONDARY_PASS || '',
    },
  ].filter((account) => account.user && account.pass);

  if (!accounts.length) {
    throw new Error('Missing Gmail scrape credentials. Set GMAIL_SCRAPE_PRIMARY_USER/PASS and optionally GMAIL_SCRAPE_SECONDARY_USER/PASS in .env.');
  }

  return accounts;
}

const ACCOUNTS = loadAccounts();
const OWN_MAILBOXES = new Set(ACCOUNTS.map((account) => account.user.toLowerCase()));

const PDF_DIR = path.join(__dirname, 'pdfs');
const EMAIL_HISTORY_DIR = path.join(__dirname, 'email-history');
const THREADS_PATH = path.join(EMAIL_HISTORY_DIR, 'threads.json');
const MESSAGES_PATH = path.join(EMAIL_HISTORY_DIR, 'messages.json');
const ATTACHMENTS_PATH = path.join(EMAIL_HISTORY_DIR, 'attachments.json');
const PARSE_FAILURES_PATH = path.join(EMAIL_HISTORY_DIR, 'parse-failures.json');
const RUN_METADATA_PATH = path.join(EMAIL_HISTORY_DIR, 'run-metadata.json');

const SEARCH_START = '1-Jan-2025';
const FOLDER_NAMES = ['[Gmail]/Sent Mail', 'INBOX', '[Gmail]/All Mail'];
const REPLY_PREFIX_RE = /^((re|fwd?|fw):\s*)+/i;
const SIGN_OFF_RE = /^(best|thanks|thank you|regards|kind regards|sincerely|cheers|cordialement|merci|salutations|bien a vous|a bientot)[,!.:\s]*$/i;
const QUOTE_SIGNALS = [
  'quote',
  'quotation',
  'estimate',
  'estimation',
  'soumission',
  'devis',
  'proposal',
  'follow up',
  'follow-up',
  'followup',
  'relance',
  'suivi',
  'mise a jour',
  'mise à jour',
  'revision',
  'revised',
  'updated quote',
  'quote revision',
  're quote',
  're-quote',
  'checking in',
  'circling back',
  'any update',
  'more info',
  'more information',
  'site visit',
  'visit',
  'photos',
  'photo',
  'availability',
  'booked',
  'lead',
  'intake',
  'questionnaire',
  'painting quote',
];
const LEAD_SIGNALS = [
  'painting services',
  'painting service',
  'painting project',
  'paint project',
  'interior painting',
  'exterior painting',
  'cabinet painting',
  'wallpaper',
  'papier peint',
  'plaster',
  'platrage',
  'repaint',
  'repainting',
  'need painting',
  'need painters',
  'need a painter',
  'looking for painters',
  'looking for a painter',
  'looking for someone to paint',
  'paint my',
  'paint our',
  'projet de peinture',
  'travaux de peinture',
  'demande d estimé',
  'demande d estime',
];
const QUOTE_ATTACHMENT_SIGNALS = [
  'quote',
  'quotation',
  'estimate',
  'estimation',
  'soumission',
  'devis',
  'proposal',
  'revision',
  'revised',
  'updated',
];
const NOISE_SIGNALS = [
  'your electronic receipt',
  'votre reçu électronique',
  'votre recu électronique',
  'ereceipt',
  'receipt',
  'recu',
  'invoice',
  'facture',
  'purchase order',
  'purchaseorder',
  'resume',
  'curriculum vitae',
  'cv',
  'insurance',
  'assurance',
  'policy',
  'claim',
  'remittance',
  'payment receipt',
  'order confirmation',
  'confirmation de commande',
];
const GENERIC_THREAD_SUBJECTS = new Set([
  'quote',
  'estimate',
  'project',
  'painting quote',
  'soumission',
  'devis',
  'proposal',
  're quote',
  're estimate',
  're project',
]);

for (const dir of [PDF_DIR, EMAIL_HISTORY_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function sanitize(str) {
  return String(str || '')
    .replace(/[^a-zA-Z0-9À-ÿ\-_.]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'item';
}

function normalizeDiacritics(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeWhitespace(str) {
  return String(str || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeSubject(subject) {
  return normalizeWhitespace(String(subject || '')
    .replace(REPLY_PREFIX_RE, '')
    .replace(/\s*\[[^\]]+\]\s*/g, ' ')
    .replace(/\s+/g, ' '));
}

function normalizeEmailBody(text) {
  return normalizeWhitespace(text);
}

function extractHeaderValue(headers, headerName) {
  if (!headers) return null;
  const wanted = String(headerName || '').toLowerCase();

  if (typeof headers.get === 'function') {
    const value = headers.get(wanted) ?? headers.get(headerName);
    if (Array.isArray(value)) return value.join(', ');
    if (value != null) return String(value);
  }

  if (typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers)) {
      if (String(key).toLowerCase() === wanted) {
        if (Array.isArray(value)) return value.join(', ');
        if (value != null) return String(value);
      }
    }
  }

  return null;
}

function parseAddressList(list) {
  const values = Array.isArray(list?.value) ? list.value : [];
  return values.map((entry) => ({
    name: entry.name || null,
    address: entry.address || null,
  }));
}

function compactAddressText(list) {
  return parseAddressList(list)
    .map((entry) => {
      if (entry.name && entry.address) return `${entry.name} <${entry.address}>`;
      return entry.address || entry.name || '';
    })
    .filter(Boolean)
    .join(', ');
}

function parseHeaderIds(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[,\s]+/)
    .map((value) => normalizeHeaderId(value))
    .filter(Boolean);
}

function normalizeHeaderId(raw) {
  return String(raw || '').trim().replace(/[<>]/g, '').toLowerCase() || null;
}

function normalizeEmailAddress(raw) {
  return String(raw || '').trim().toLowerCase() || null;
}

function stripQuotedReply(text) {
  const lines = String(text || '').split('\n');
  const output = [];

  for (const line of lines) {
    if (/^\s*>/.test(line)) continue;
    if (/^-----Original Message-----$/i.test(line.trim())) break;
    if (/^On .+ wrote:$/i.test(line.trim())) break;
    if (/^From:\s.+$/i.test(line.trim()) && output.length) break;
    output.push(line);
  }

  return normalizeWhitespace(output.join('\n'));
}

function extractSignOff(text) {
  const lines = normalizeEmailBody(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i--) {
    const normalized = normalizeDiacritics(lines[i]).toLowerCase();
    if (SIGN_OFF_RE.test(normalized)) {
      return lines[i];
    }
    if (i < lines.length - 1 && lines.length - i <= 6 && /^[A-Za-zÀ-ÿ' -]+$/.test(lines[i])) {
      if (SIGN_OFF_RE.test(normalizeDiacritics(lines[i - 1] || '').toLowerCase())) {
        return lines[i - 1];
      }
    }
  }

  return null;
}

function extractSignatureBlock(text, signOff) {
  const lines = normalizeEmailBody(text)
    .split('\n')
    .map((line) => line.trimEnd());

  if (!lines.length) return null;

  let startIndex = -1;
  if (signOff) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (normalizeDiacritics(lines[i]).toLowerCase() === normalizeDiacritics(signOff).toLowerCase()) {
        startIndex = i;
        break;
      }
    }
  }

  if (startIndex === -1) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].trim()) continue;
      startIndex = Math.max(0, i - 3);
      break;
    }
  }

  if (startIndex < 0) return null;

  const block = lines.slice(startIndex).join('\n').trim();
  return block || null;
}

function isPdfAttachment(att) {
  const filenameIsPdf = Boolean(att?.filename && /\.pdf$/i.test(att.filename));
  const contentTypeIsPdf = Boolean(att?.contentType && /pdf/i.test(att.contentType));
  return filenameIsPdf || contentTypeIsPdf;
}

function collectAttachmentMetadata(att, messageMeta) {
  return {
    account: messageMeta.account,
    folder: messageMeta.folder,
    uid: messageMeta.uid,
    attachmentIndex: att.attachmentIndex,
    attachmentKey: att.attachmentKey,
    messageId: messageMeta.messageId,
    date: messageMeta.date,
    direction: messageMeta.direction,
    filename: att.filename || null,
    contentType: att.contentType || null,
    size: att.size || (att.content ? att.content.length : 0) || 0,
    isPdf: isPdfAttachment(att),
    contentId: att.contentId || null,
    checksum: att.checksum || null,
  };
}

function normalizeForSearch(value) {
  return normalizeDiacritics(String(value || '').toLowerCase());
}

function collectSignalHits(text, signals) {
  const haystack = normalizeForSearch(text);
  return signals.filter((signal) => haystack.includes(normalizeForSearch(signal)));
}

function isNoisePdfAttachment(att) {
  return collectSignalHits(att?.filename || '', NOISE_SIGNALS).length > 0;
}

function isQuotePdfAttachment(att) {
  return collectSignalHits(att?.filename || '', QUOTE_ATTACHMENT_SIGNALS).length > 0;
}

function isNoiseMessage(message) {
  const haystack = normalizeForSearch(getSearchText(message));
  const attachmentText = (message.attachments || [])
    .map((att) => att.filename || '')
    .join(' ');
  const noiseHits = [
    ...collectSignalHits(haystack, NOISE_SIGNALS),
    ...collectSignalHits(attachmentText, NOISE_SIGNALS),
  ];
  const quoteHits = [
    ...collectSignalHits(haystack, QUOTE_SIGNALS),
    ...collectSignalHits(haystack, LEAD_SIGNALS),
    ...collectSignalHits(attachmentText, QUOTE_ATTACHMENT_SIGNALS),
  ];
  return noiseHits.length > 0 && quoteHits.length === 0;
}

function getSearchText(message) {
  return [
    message.subject,
    message.normalizedSubject,
    message.normalizedText,
    message.fromText,
    message.toText,
    message.ccText,
    ...(message.attachments || []).map((att) => att.filename || ''),
  ]
    .filter(Boolean)
    .join(' ');
}

function isRelevantEmailRecord(message) {
  const haystack = normalizeForSearch(getSearchText(message));
  const subjectText = normalizeForSearch(message.subject || message.normalizedSubject || '');
  const attachmentText = (message.attachments || [])
    .map((att) => att.filename || '')
    .join(' ');

  const quoteHits = collectSignalHits(haystack, QUOTE_SIGNALS);
  const leadHits = collectSignalHits(haystack, LEAD_SIGNALS);
  const subjectNoiseHits = collectSignalHits(subjectText, NOISE_SIGNALS);
  const bodyNoiseHits = collectSignalHits(haystack, NOISE_SIGNALS);
  const attachmentNoiseHits = collectSignalHits(attachmentText, NOISE_SIGNALS);
  const attachmentQuoteHits = collectSignalHits(attachmentText, QUOTE_ATTACHMENT_SIGNALS);
  const noiseHits = [...new Set([...subjectNoiseHits, ...bodyNoiseHits, ...attachmentNoiseHits])];
  const positiveHits = [...new Set([...quoteHits, ...leadHits, ...attachmentQuoteHits])];

  if (noiseHits.length && !positiveHits.length) {
    return {
      relevant: false,
      reasons: noiseHits,
    };
  }

  if (positiveHits.length) {
    return {
      relevant: true,
      reasons: positiveHits,
    };
  }

  const isShortLeadReply = /^(hello|hi|bonjour|salut|thanks|merci)\b/.test(haystack) &&
    (haystack.includes('quote') || haystack.includes('estimate') || haystack.includes('soumission') || haystack.includes('devis'));
  if (isShortLeadReply) {
    return { relevant: true, reasons: ['lead-reply'] };
  }

  return { relevant: false, reasons: [] };
}

function messageDateValue(message) {
  return message.date ? new Date(message.date).getTime() : 0;
}

function countPopulatedHeaderFields(message) {
  return [
    message.messageId,
    message.inReplyTo,
    message.references,
    message.fromText,
    message.toText,
    message.ccText,
    message.subject,
    message.normalizedText,
  ].filter(Boolean).length;
}

function attachmentSignature(message) {
  return (message.attachments || [])
    .map((att) => [att.filename || '', att.contentType || '', att.size || 0].join(':'))
    .sort()
    .join('|');
}

function messageDedupKey(message) {
  const messageId = normalizeHeaderId(message.messageId);
  if (messageId) return `mid::${messageId}`;

  const datePart = message.date || 'no-date';
  const subjectPart = message.normalizedSubject || 'no-subject';
  const participantPart = [
    ...(message.fromEmails || []),
    ...(message.toEmails || []),
    ...(message.ccEmails || []),
  ]
    .map(normalizeEmailAddress)
    .filter(Boolean)
    .sort()
    .join('|');
  const bodyPart = normalizeForSearch(message.normalizedText || '').slice(0, 160);
  const attachmentPart = attachmentSignature(message);
  return `fallback::${datePart}::${subjectPart}::${participantPart}::${bodyPart}::${attachmentPart}`;
}

function messageDedupScore(message) {
  const attachmentCount = (message.attachments || []).length;
  const pdfCount = (message.attachments || []).filter((att) => att.isPdf).length;
  const textLength = (message.normalizedText || '').length;
  const headerCount = countPopulatedHeaderFields(message);
  const folderPenalty = /all mail/i.test(message.folder || '') ? -20 : 0;
  const directionBonus = message.direction === 'sent' ? 4 : 0;
  const relevanceBonus = message.isRelevant ? 1000 : 0;

  return (
    relevanceBonus +
    pdfCount * 25 +
    attachmentCount * 10 +
    Math.min(textLength, 5000) / 25 +
    headerCount * 6 +
    directionBonus +
    folderPenalty
  );
}

function dedupeMessages(messages) {
  const byKey = new Map();

  for (const message of messages) {
    const key = messageDedupKey(message);
    const score = messageDedupScore(message);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, { message, score });
      continue;
    }

    if (score > existing.score) {
      byKey.set(key, { message, score });
      continue;
    }

    if (score === existing.score) {
      const existingTime = messageDateValue(existing.message);
      const currentTime = messageDateValue(message);
      if (currentTime > existingTime) {
        byKey.set(key, { message, score });
      }
    }
  }

  return Array.from(byKey.values()).map((entry) => entry.message);
}

function participantsKey(message) {
  return [
    message.fromEmails.join('|'),
    message.toEmails.join('|'),
    message.ccEmails.join('|'),
  ].join('::');
}

function buildMessageRecord({ user, folder, uid, parsed }) {
  const rawText = parsed.text || (parsed.html ? stripHtml(parsed.html) : '');
  const normalizedText = normalizeEmailBody(stripQuotedReply(rawText));
  const signOff = extractSignOff(normalizedText);
  const signatureBlock = extractSignatureBlock(normalizedText, signOff);
  const messageDate = parsed.date ? new Date(parsed.date) : null;
  const safeDate = messageDate && !Number.isNaN(messageDate.getTime()) ? messageDate : null;
  const messageId = extractHeaderValue(parsed.headers, 'message-id');
  const inReplyTo = extractHeaderValue(parsed.headers, 'in-reply-to');
  const references = extractHeaderValue(parsed.headers, 'references');

  const message = {
    account: user,
    folder,
    uid,
    date: safeDate ? safeDate.toISOString() : null,
    direction: /sent/i.test(folder) ? 'sent' : 'received',
    subject: parsed.subject || '',
    normalizedSubject: normalizeSubject(parsed.subject),
    from: parseAddressList(parsed.from),
    to: parseAddressList(parsed.to),
    cc: parseAddressList(parsed.cc),
    fromText: compactAddressText(parsed.from),
    toText: compactAddressText(parsed.to),
    ccText: compactAddressText(parsed.cc),
    fromEmails: parseAddressList(parsed.from).map((entry) => entry.address).filter(Boolean),
    toEmails: parseAddressList(parsed.to).map((entry) => entry.address).filter(Boolean),
    ccEmails: parseAddressList(parsed.cc).map((entry) => entry.address).filter(Boolean),
    messageId: messageId ? String(messageId) : null,
    inReplyTo: inReplyTo ? String(inReplyTo) : null,
    references: references ? String(references) : null,
    normalizedText,
    signOff,
    signatureBlock,
    attachments: (parsed.attachments || []).map((att, index) => {
      const attachmentKey = [
        user,
        folder,
        uid,
        index,
        normalizeHeaderId(att.contentId || att.checksum || att.filename || ''),
      ].join('::');

      return collectAttachmentMetadata({
        ...att,
        attachmentIndex: index,
        attachmentKey,
      }, {
        account: user,
        folder,
        uid,
        messageId: messageId ? String(messageId) : null,
        date: safeDate ? safeDate.toISOString() : null,
        direction: /sent/i.test(folder) ? 'sent' : 'received',
      });
    }),
  };

  const relevance = isRelevantEmailRecord(message);
  message.isRelevant = relevance.relevant;
  message.relevanceReasons = relevance.reasons;
  return message;
}

function saveRelevantPdfs(message) {
  const datePart = message.date ? message.date.slice(0, 10) : 'unknown-date';
  const subjectPart = sanitize(message.normalizedSubject || message.subject || 'no-subject');
  const accountPart = sanitize(message.account.split('@')[0] || 'account');

  for (const att of message.attachments) {
    if (!att.isPdf) continue;
    const messageHasQuoteContext = collectSignalHits(`${message.subject}\n${message.normalizedText}`, QUOTE_SIGNALS).length > 0;
    if (isNoisePdfAttachment(att) && !isQuotePdfAttachment(att)) continue;
    if (!isQuotePdfAttachment(att) && !messageHasQuoteContext) continue;
    const original = att.filename || 'attachment.pdf';
    const baseName = sanitize(original.replace(/\.pdf$/i, ''));
    const attachmentPart = typeof att.attachmentIndex === 'number' ? `att${att.attachmentIndex}` : 'att';
    const outName = `${datePart}_${accountPart}_${subjectPart}_${message.uid}_${attachmentPart}_${baseName}.pdf`;
    const outPath = path.join(PDF_DIR, outName);

    if (fs.existsSync(outPath)) continue;

    const attachment = typeof att.attachmentIndex === 'number'
      ? message._parsedAttachments?.[att.attachmentIndex]
      : message._parsedAttachments?.find((item, index) => index === att.attachmentIndex || item.contentId === att.contentId || item.filename === att.filename);
    if (!attachment?.content) continue;
    fs.writeFileSync(outPath, attachment.content);
    console.log(`\n  ✓ ${outName} (${Math.round(attachment.content.length / 1024)}kb)`);
  }
}

function createUnionFind(size) {
  const parent = Array.from({ length: size }, (_, i) => i);

  function find(x) {
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  }

  function union(a, b) {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  }

  return { find, union };
}

function buildThreads(messages) {
  const indexed = messages.map((message, index) => ({ ...message, __index: index }));
  const { find, union } = createUnionFind(indexed.length);
  const byMessageId = new Map();

  for (const message of indexed) {
    const normalizedMessageId = normalizeHeaderId(message.messageId);
    if (normalizedMessageId) byMessageId.set(normalizedMessageId, message.__index);
  }

  for (const message of indexed) {
    const refs = [
      message.inReplyTo ? [message.inReplyTo] : [],
      parseHeaderIds(message.references),
    ].flat();

    for (const ref of refs) {
      const target = byMessageId.get(normalizeHeaderId(ref));
      if (target != null) union(message.__index, target);
    }
  }

  const fallbackBuckets = new Map();
  for (const message of indexed) {
    const subjectKey = message.normalizedSubject || 'no-subject';
    const bucketKey = subjectKey;
    if (!fallbackBuckets.has(bucketKey)) fallbackBuckets.set(bucketKey, []);
    fallbackBuckets.get(bucketKey).push(message);
  }

  for (const bucket of fallbackBuckets.values()) {
    bucket.sort((a, b) => messageDateValue(a) - messageDateValue(b));
    for (let i = 1; i < bucket.length; i++) {
      const prev = bucket[i - 1];
      const curr = bucket[i];
      if (!prev.date || !curr.date) continue;
      const gapDays = Math.abs(messageDateValue(curr) - messageDateValue(prev)) / (1000 * 60 * 60 * 24);
      const prevParticipants = new Set([...prev.fromEmails, ...prev.toEmails, ...prev.ccEmails].map(normalizeEmailAddress).filter(Boolean));
      const currParticipants = new Set([...curr.fromEmails, ...curr.toEmails, ...curr.ccEmails].map(normalizeEmailAddress).filter(Boolean));
      const sharedParticipants = [...prevParticipants].filter((value) => currParticipants.has(value));
      const sharedExternalParticipants = sharedParticipants.filter((value) => !OWN_MAILBOXES.has(value));
      const sameSubject = prev.normalizedSubject === curr.normalizedSubject;
      const genericSubject = GENERIC_THREAD_SUBJECTS.has(normalizeForSearch(prev.normalizedSubject));

      if (!genericSubject && sameSubject && sharedParticipants.length >= 2 && sharedExternalParticipants.length >= 1 && gapDays <= 14) {
        union(prev.__index, curr.__index);
      }
    }
  }

  const groups = new Map();
  for (const message of indexed) {
    const root = find(message.__index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(message);
  }

    const threads = [];
  let syntheticCounter = 0;

  for (const group of groups.values()) {
    group.sort((a, b) => {
      const aTime = messageDateValue(a) || 0;
      const bTime = messageDateValue(b) || 0;
      if (aTime !== bTime) return aTime - bTime;
      return a.uid - b.uid;
    });

    const hasHeaderLink = group.some((message) => message.messageId || message.inReplyTo || (message.references && message.references.length));
    const first = group[0];
    const threadId = hasHeaderLink
      ? (normalizeHeaderId(first.messageId) || normalizeHeaderId(first.inReplyTo) || parseHeaderIds(first.references)[0] || `${first.account}-thread-${syntheticCounter++}`)
      : `${first.account}-subject-${sanitize(first.normalizedSubject || 'no-subject')}-${syntheticCounter++}`;

    const participants = new Map();
    for (const message of group) {
      for (const entry of [...message.from, ...message.to, ...message.cc]) {
        const key = entry.address || entry.name;
        if (!key) continue;
        if (!participants.has(key)) participants.set(key, entry);
      }
    }

    const combinedText = group.map((message) => `${message.subject}\n${message.normalizedText}`).join('\n');
    const haystack = normalizeForSearch(combinedText);

    threads.push({
      id: threadId,
      account: first.account,
      firstDate: first.date,
      lastDate: group[group.length - 1].date,
      participants: Array.from(participants.values()),
      normalizedSubject: first.normalizedSubject,
      messageIds: Array.from(new Set(group.map((message) => normalizeHeaderId(message.messageId)).filter(Boolean))),
      directions: Array.from(new Set(group.map((message) => message.direction))),
      hasPdfQuote: group.some((message) => (message.attachments || []).some((att) => att.isPdf)),
      includesEstimateVisit: haystack.includes('estimate') || haystack.includes('visit') || haystack.includes('site visit') || haystack.includes('soumission'),
      includesPhotoRequest: haystack.includes('photo') || haystack.includes('photos'),
      includesFormRequest: haystack.includes('form') || haystack.includes('questionnaire') || haystack.includes('details') || haystack.includes('intake'),
      messageCount: group.length,
      threadingMode: hasHeaderLink ? 'headers' : 'subject-participant-date',
      isRelevant: group.some((message) => message.isRelevant),
    });

    for (const message of group) {
      message.threadId = threadId;
    }
  }

  return { threads, messages: indexed.map(({ __index, ...rest }) => rest) };
}

async function scrapeAccount({ user, pass }) {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user,
      password: pass,
      host: 'imap.gmail.com',
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      keepalive: true,
      authTimeout: 10000,
    });

    const accountMessages = [];
    let saved = 0;
    let skipped = 0;
    let zeroResultFolders = 0;
    let accountErrors = 0;
    let parseErrors = 0;
    const parseFailures = [];
    let folderIndex = 0;

    function processNextFolder() {
      if (folderIndex >= FOLDER_NAMES.length) {
        imap.end();
        return;
      }

      const folder = FOLDER_NAMES[folderIndex++];
      console.log(`\n  Folder: ${folder}`);

      imap.openBox(folder, true, (err) => {
        if (err) {
          accountErrors++;
          console.log(`  Skipping (${err.message})`);
          processNextFolder();
          return;
        }

        imap.search([['SINCE', SEARCH_START]], (searchErr, uids) => {
          if (searchErr) {
            accountErrors++;
            console.log(`  Search error: ${searchErr.message}`);
            processNextFolder();
            return;
          }

          if (!uids || !uids.length) {
            zeroResultFolders++;
            console.log('  No messages found.');
            processNextFolder();
            return;
          }

          console.log(`  Scanning ${uids.length} messages...`);
          let processed = 0;
          let pendingParses = 0;
          let fetchEnded = false;
          let folderFinished = false;

          function finishFolder() {
            if (folderFinished) return;
            folderFinished = true;
            console.log(`\n  Done: ${saved} saved, ${skipped} skipped`);
            processNextFolder();
          }

          function maybeFinishFolder() {
            if (!folderFinished && fetchEnded && pendingParses === 0) {
              finishFolder();
            }
          }

          const fetch = imap.fetch(uids, { bodies: '', struct: true });

          fetch.on('message', (msg) => {
            const chunks = [];
            let uid = null;

            msg.on('attributes', (attrs) => {
              uid = attrs.uid;
            });

            msg.on('body', (stream) => {
              stream.on('data', (chunk) => chunks.push(chunk));
            });

            msg.once('end', () => {
              processed++;
              if (processed % 10 === 0) {
                process.stdout.write(`  [${processed}/${uids.length}]\r`);
              }

              pendingParses++;
              (async () => {
                try {
                  const raw = Buffer.concat(chunks);
                  const parsed = await simpleParser(raw);
                  const safeDate = parsed.date && !Number.isNaN(new Date(parsed.date).getTime())
                    ? new Date(parsed.date)
                    : null;
                  if (safeDate && safeDate.getTime() > Date.now()) return;

                  const message = buildMessageRecord({ user, folder, uid, parsed });
                  accountMessages.push(message);
                  if (message.isRelevant) {
                    message._parsedAttachments = parsed.attachments || [];
                    saveRelevantPdfs(message);
                    delete message._parsedAttachments;

                    for (const att of message.attachments) {
                      if (att.isPdf) saved++;
                      else skipped++;
                    }
                  }
                } catch (e) {
                  parseErrors++;
                  skipped++;
                  parseFailures.push({
                    account: user,
                    folder,
                    uid,
                    errorMessage: e.message,
                  });
                  console.error(`  Parse failure [${user} ${folder} uid=${uid || 'unknown'}]: ${e.message}`);
                } finally {
                  pendingParses--;
                  maybeFinishFolder();
                }
              })();
            });
          });

          fetch.once('error', (err) => {
            accountErrors++;
            console.error(`\n  Fetch error: ${err.message}`);
            fetchEnded = true;
            maybeFinishFolder();
          });

          fetch.once('end', () => {
            fetchEnded = true;
            maybeFinishFolder();
          });
        });
      });
    }

    imap.once('ready', () => {
      console.log(`\n${'─'.repeat(50)}`);
      console.log(`Account: ${user}`);
      console.log('─'.repeat(50));
      processNextFolder();
    });

    imap.once('error', (err) => {
      console.error(`\nIMAP error (${user}):`, err.message);
      err.accountStats = {
        accountMessages,
        saved,
        skipped,
        zeroResultFolders,
        accountErrors: accountErrors + 1,
        parseErrors,
        parseFailures,
      };
      reject(err);
    });

    imap.once('end', () => {
      resolve({ accountMessages, saved, skipped, zeroResultFolders, accountErrors, parseErrors, parseFailures });
    });

    imap.connect();
  });
}

async function main() {
  const allMessages = [];
  let grandSaved = 0;
  let grandSkipped = 0;
  let grandZeroResultFolders = 0;
  let grandAccountErrors = 0;
  let grandParseErrors = 0;
  const grandParseFailures = [];

  for (const account of ACCOUNTS) {
    try {
      const { accountMessages, saved, skipped, zeroResultFolders, accountErrors, parseErrors, parseFailures } = await scrapeAccount(account);
      allMessages.push(...accountMessages);
      grandSaved += saved;
      grandSkipped += skipped;
      grandZeroResultFolders += zeroResultFolders;
      grandAccountErrors += accountErrors;
      grandParseErrors += parseErrors;
      grandParseFailures.push(...parseFailures);
    } catch (e) {
      console.error(`\n✗ Failed for ${account.user}:`, e.message);
      if (e.accountStats) {
        allMessages.push(...e.accountStats.accountMessages);
        grandSaved += e.accountStats.saved;
        grandSkipped += e.accountStats.skipped;
        grandZeroResultFolders += e.accountStats.zeroResultFolders;
        grandAccountErrors += e.accountStats.accountErrors;
        grandParseErrors += e.accountStats.parseErrors;
        grandParseFailures.push(...(e.accountStats.parseFailures || []));
      } else {
        grandAccountErrors++;
      }
    }
  }

  const dedupedMessages = dedupeMessages(allMessages);
  const { threads, messages } = buildThreads(dedupedMessages);
  const relevantThreadIds = new Set(threads.filter((thread) => thread.isRelevant).map((thread) => thread.id));
  const selectedThreads = threads.filter((thread) => relevantThreadIds.has(thread.id));
  const selectedMessages = messages.filter((message) =>
    relevantThreadIds.has(message.threadId) && (message.isRelevant || !isNoiseMessage(message)));
  const attachments = [];

  for (const message of selectedMessages) {
    for (const att of message.attachments || []) {
      attachments.push({
        ...att,
        threadId: message.threadId || null,
      });
    }
  }

  const suspicious = selectedMessages.length === 0 || grandAccountErrors > 0 || grandParseErrors > 0;

  writeJson(MESSAGES_PATH, selectedMessages);
  writeJson(THREADS_PATH, selectedThreads);
  writeJson(ATTACHMENTS_PATH, attachments);

  if (grandParseFailures.length) {
    writeJson(PARSE_FAILURES_PATH, grandParseFailures);
  }

  writeJson(RUN_METADATA_PATH, {
    generatedAt: new Date().toISOString(),
    searchStart: SEARCH_START,
    accounts: ACCOUNTS.map((account) => account.user),
    suspicious,
    relevantMessages: selectedMessages.length,
    relevantThreads: selectedThreads.length,
    attachmentRecords: attachments.length,
    pdfAttachmentsSaved: grandSaved,
    nonPdfSkips: grandSkipped,
    zeroResultFolders: grandZeroResultFolders,
    accountErrors: grandAccountErrors,
    parseErrors: grandParseErrors,
    parseFailureCount: grandParseFailures.length,
  });

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  Relevant messages saved: ${selectedMessages.length}`);
  console.log(`  Relevant threads saved: ${selectedThreads.length}`);
  console.log(`  Attachment records saved: ${attachments.length}`);
  console.log(`  PDF attachments saved: ${grandSaved}`);
  console.log(`  Attachment non-PDF skips: ${grandSkipped}`);
  console.log(`  Zero-result folders: ${grandZeroResultFolders}`);
  console.log(`  Account errors: ${grandAccountErrors}`);
  console.log(`  Parse errors: ${grandParseErrors}`);
  console.log(`  Dataset folder: ${EMAIL_HISTORY_DIR}`);
  console.log(`  Run status: ${suspicious ? 'suspicious' : 'ok'}`);
  console.log('  Dataset publish: written');
  console.log('═'.repeat(50) + '\n');

  if (suspicious) {
    console.warn('  Suspicious run: zero-result folders and/or account/parse errors were detected.');
  }
}

main().catch((e) => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
