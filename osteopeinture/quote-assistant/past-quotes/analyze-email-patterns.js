#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const EMAIL_HISTORY_DIR = path.join(__dirname, 'email-history');
const THREADS_PATH = path.join(EMAIL_HISTORY_DIR, 'threads.json');
const MESSAGES_PATH = path.join(EMAIL_HISTORY_DIR, 'messages.json');
const RUN_METADATA_PATH = path.join(EMAIL_HISTORY_DIR, 'run-metadata.json');
const OUTPUT_PATH = path.join(__dirname, 'email-patterns.md');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function compactWhitespace(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function wordCount(value) {
  return compactWhitespace(value).split(/\s+/).filter(Boolean).length;
}

function topEntries(map, limit = 10) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit);
}

function increment(map, key, amount = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
}

function inferSigner(message) {
  const haystack = normalize(`${message.signatureBlock || ''}\n${message.normalizedText || ''}`);
  if (haystack.includes('loric')) return 'Loric';
  if (haystack.includes('graeme')) return 'Graeme';
  if (haystack.includes('lubo')) return 'Lubo';
  return 'Unknown';
}

function subjectPattern(subject) {
  const text = compactWhitespace(subject);
  const normalized = normalize(text);

  if (!text) return 'Untitled';
  if (normalized.includes('painting quote')) return 'Painting Quote — [address / project]';
  if (normalized.includes('soumission')) return 'Soumission — [address / project]';
  if (normalized.includes('estimate for')) return 'Estimate for [address / project]';
  if (normalized.includes('estimate request') || normalized.includes('quote request')) return 'Quote / Estimate Request';
  if (normalized.includes('project update') || normalized.includes('mise -a-jour') || normalized.includes('mise a jour')) return 'Project Update / Cost Breakdown';
  if (normalized.includes('revised quote') || normalized.includes('updated quote')) return 'Revised / Updated Quote';
  if (normalized.includes('follow up') || normalized.includes('suivi')) return 'Follow-up';
  if (normalized.includes('demande de soumission') || normalized.includes('demande d estime') || normalized.includes('demande d estim')) return 'Demande de soumission / estimé';
  return text;
}

function collectCtas(text) {
  const haystack = normalize(text);
  const ctas = [];

  if (/let me know|faites moi savoir|faites-nous savoir|n'hesitez pas|do not hesitate|if you have any questions|si vous avez des questions/.test(haystack)) {
    ctas.push('invite_questions');
  }
  if (/send photos|envoyez.*photos|share photos|photos of the space/.test(haystack)) {
    ctas.push('request_photos');
  }
  if (/availability|disponibilit|what times work|quelles disponibilit|weekend|evening/.test(haystack)) {
    ctas.push('request_availability');
  }
  if (/book|schedule|estimate visit|site visit|visit the space|visite/.test(haystack)) {
    ctas.push('book_estimate');
  }
  if (/attached|ci-joint|joint.*soumission|jointe.*soumission|quote attached|soumission ci-jointe|estimate attached/.test(haystack)) {
    ctas.push('quote_attached_notice');
  }
  if (/approve|approval|accept|accepted|deposit|acompte|signed|signature/.test(haystack)) {
    ctas.push('approval_or_deposit');
  }

  return ctas;
}

function classifyThread(thread, threadMessages) {
  const ordered = [...threadMessages].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  const sentMessages = ordered.filter((message) => message.direction === 'sent');
  if (!sentMessages.length) return 'inbound_only';
  const text = normalize(ordered.map((message) => `${message.subject}\n${message.normalizedText}`).join('\n'));
  const sentText = normalize(sentMessages.map((message) => `${message.subject}\n${message.normalizedText}`).join('\n'));
  const patternText = sentText || text;
  const lastSent = sentMessages[sentMessages.length - 1] || null;
  const lastSentText = normalize(lastSent ? `${lastSent.subject}\n${lastSent.normalizedText}` : '');

  const hasQuoteWord = /quote|estimate|soumission|devis|proposal/.test(patternText);
  const hasUpdateWord = /updated|update|mise a jour|revised|revision|cost breakdown|phase/.test(patternText);
  const hasAttachedWord = /attached|ci-joint|jointe|quote attached|estimate attached/.test(patternText);
  const hasFollowUpWord = /follow up|follow-up|suivi|checking in|circling back|any update/.test(patternText);
  const hasDeclineWord = /prefer not to|leave pass our turn|laisser passer notre tour|fully booked|booked for the season|not a fit|not able to|cannot take|won't be able/.test(patternText);
  const hasInfoRequestWord = /photos|more info|more information|questionnaire|details|availability|disponibilit|site visit|estimate visit|visite/.test(patternText);
  const hasInvoiceWord = /invoice|facture|payment|paiement|deposit|acompte|final invoice/.test(patternText);
  const hasProjectUpdateWord = /projection des couts|ventilation des couts|cost breakdown|project update|mise a jour|update summary|cost to completion/.test(patternText);
  const hasPromiseWord = /prepare your quote|receive it by|haven't forgotten|not forgotten|coming soon|you will receive it|reviens vers vous|i'll prepare your quote/.test(patternText);
  const hasLeadFollowUpWord = /still looking for painters|encore a la recherche|cherchez vous encore|we received your demand|give me a call|discuss further|is that soon enough/.test(patternText);

  if (hasDeclineWord) return 'decline';
  if (hasInvoiceWord) return 'invoice_or_payment';
  if (hasProjectUpdateWord && !hasQuoteWord) return 'project_update';
  if (hasPromiseWord) return 'quote_promise';
  if (hasLeadFollowUpWord) return 'lead_follow_up';
  if (hasQuoteWord && hasUpdateWord) return 'quote_revision';
  if (hasQuoteWord && hasFollowUpWord) return 'quote_follow_up';
  if (hasQuoteWord && (hasAttachedWord || thread.hasPdfQuote || /quote|estimate|soumission|devis/.test(lastSentText))) return 'quote_send';
  if (hasInfoRequestWord) return 'lead_more_info';
  return 'mixed_or_other';
}

function detailBand(message) {
  const count = wordCount(message.normalizedText || '');
  if (count < 40) return 'short';
  if (count < 110) return 'medium';
  return 'detailed';
}

function formatCountList(entries, formatter) {
  if (!entries.length) return '- None';
  return entries.map(([key, value]) => `- ${formatter(key, value)}`).join('\n');
}

function scenarioExampleScore(scenario, subject) {
  const text = normalize(subject);
  if (!text) return 0;

  switch (scenario) {
    case 'quote_send':
      return [
        /quote|estimate|soumission|devis|proposal/.test(text) ? 4 : 0,
        /attached|ci-joint|jointe/.test(text) ? 2 : 0,
        /\d/.test(text) ? 1 : 0
      ].reduce((sum, value) => sum + value, 0);
    case 'quote_revision':
      return [
        /quote|estimate|soumission|devis/.test(text) ? 3 : 0,
        /revised|updated|revision|update|mise a jour|cost breakdown|phase/.test(text) ? 4 : 0
      ].reduce((sum, value) => sum + value, 0);
    case 'quote_follow_up':
      return [
        /quote|estimate|soumission|devis/.test(text) ? 3 : 0,
        /follow up|follow-up|suivi|checking in|touch base/.test(text) ? 4 : 0
      ].reduce((sum, value) => sum + value, 0);
    case 'lead_more_info':
      return [
        /contact|demande|info|lead|estimate request|quote request/.test(text) ? 3 : 0,
        /photo|photos|details|measure|availability|visite/.test(text) ? 3 : 0
      ].reduce((sum, value) => sum + value, 0);
    case 'lead_follow_up':
      return [
        /contact|nouvel envoi|contact us|contact 3/.test(text) ? 3 : 0,
        /follow|looking|encore|estimate|availability/.test(text) ? 3 : 0
      ].reduce((sum, value) => sum + value, 0);
    case 'quote_promise':
      return [
        /quote|estimate|soumission|devis/.test(text) ? 3 : 0,
        /coming soon|receive|prepare|patience|weekend/.test(text) ? 4 : 0
      ].reduce((sum, value) => sum + value, 0);
    case 'project_update':
      return [
        /update|mise a jour|cost breakdown|projection|ventilation/.test(text) ? 4 : 0,
        /cout|cost|project/.test(text) ? 2 : 0
      ].reduce((sum, value) => sum + value, 0);
    case 'invoice_or_payment':
      return [
        /invoice|facture|payment|paiement|deposit|acompte/.test(text) ? 4 : 0,
        /final/.test(text) ? 2 : 0
      ].reduce((sum, value) => sum + value, 0);
    case 'decline':
      return [
        /quote|estimate|soumission|devis/.test(text) ? 2 : 0,
        /not|unable|pass|booked|fit|turn/.test(text) ? 4 : 0
      ].reduce((sum, value) => sum + value, 0);
    default:
      return 1;
  }
}

function main() {
  const runMetadata = readJson(RUN_METADATA_PATH);
  if (runMetadata.suspicious) {
    throw new Error(`Refusing to analyze suspicious scrape output from ${runMetadata.generatedAt}. Rerun scrape-gmail.js after fixing mailbox errors first.`);
  }

  const threads = readJson(THREADS_PATH);
  const messages = readJson(MESSAGES_PATH);
  const messagesByThreadId = new Map();

  for (const message of messages) {
    if (!messagesByThreadId.has(message.threadId)) messagesByThreadId.set(message.threadId, []);
    messagesByThreadId.get(message.threadId).push(message);
  }

  const scenarioCounts = new Map();
  const subjectPatterns = new Map();
  const signOffs = new Map();
  const signerCounts = new Map();
  const signerSignOffs = new Map();
  const ctaCounts = new Map();
  const quoteDetailBands = new Map();
  const scenarioExamples = new Map();
  let quoteThreadsWithPhaseLanguage = 0;
  let quoteThreadsWithUpdateLanguage = 0;
  let quoteThreadCount = 0;
  let sentMessageCount = 0;
  let draftingThreadCount = 0;

  for (const thread of threads) {
    const threadMessages = messagesByThreadId.get(thread.id) || [];
    const scenario = classifyThread(thread, threadMessages);
    if (scenario === 'inbound_only') continue;

    draftingThreadCount += 1;
    increment(scenarioCounts, scenario);

    const exampleSubject = thread.normalizedSubject || threadMessages[0]?.subject || '';
    const exampleScore = scenarioExampleScore(scenario, exampleSubject);
    const existing = scenarioExamples.get(scenario);
    if (!existing || exampleScore > existing.score) {
      scenarioExamples.set(scenario, { subject: exampleSubject, score: exampleScore });
    }

    const threadText = normalize(threadMessages.map((message) => `${message.subject}\n${message.normalizedText}`).join('\n'));
    if (['quote_send', 'quote_revision', 'quote_follow_up'].includes(scenario)) {
      quoteThreadCount += 1;
      if (/phase/.test(threadText)) quoteThreadsWithPhaseLanguage += 1;
      if (/update|updated|mise a jour|cost breakdown/.test(threadText)) quoteThreadsWithUpdateLanguage += 1;
    }

    for (const message of threadMessages) {
      if (message.direction !== 'sent') continue;
      sentMessageCount += 1;

      increment(subjectPatterns, subjectPattern(message.normalizedSubject || message.subject));
      if (message.signOff) increment(signOffs, message.signOff);

      const signer = inferSigner(message);
      increment(signerCounts, signer);
      if (!signerSignOffs.has(signer)) signerSignOffs.set(signer, new Map());
      if (message.signOff) increment(signerSignOffs.get(signer), message.signOff);

      for (const cta of collectCtas(`${message.subject}\n${message.normalizedText}`)) {
        increment(ctaCounts, cta);
      }

      if (['quote_send', 'quote_revision'].includes(scenario)) {
        increment(quoteDetailBands, detailBand(message));
      }
    }
  }

  const quotePhasePct = quoteThreadCount ? Math.round((quoteThreadsWithPhaseLanguage / quoteThreadCount) * 100) : 0;
  const quoteUpdatePct = quoteThreadCount ? Math.round((quoteThreadsWithUpdateLanguage / quoteThreadCount) * 100) : 0;

  const signerSections = ['Loric', 'Graeme', 'Lubo', 'Unknown']
    .filter((signer) => signerCounts.has(signer))
    .map((signer) => {
      const topSignOff = topEntries(signerSignOffs.get(signer) || new Map(), 3);
      return [
        `### ${signer}`,
        `- Sent messages detected: ${signerCounts.get(signer) || 0}`,
        `- Common sign-offs: ${topSignOff.length ? topSignOff.map(([label, count]) => `${label} (${count})`).join(', ') : 'none inferred'}`,
      ].join('\n');
    })
    .join('\n\n');

  const scenarioLines = formatCountList(topEntries(scenarioCounts, 10), (key, value) => {
    const sample = scenarioExamples.get(key);
    return `${key}: ${value}${sample?.subject ? ` (example subject: ${sample.subject})` : ''}`;
  });

  const subjectLines = formatCountList(topEntries(subjectPatterns, 12), (key, value) => `${key}: ${value}`);
  const signOffLines = formatCountList(topEntries(signOffs, 10), (key, value) => `${key}: ${value}`);
  const ctaLines = formatCountList(topEntries(ctaCounts, 10), (key, value) => `${key}: ${value}`);
  const detailLines = formatCountList(topEntries(quoteDetailBands, 10), (key, value) => `${key}: ${value}`);

  const output = [
    '# Email Patterns',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Dataset Summary',
    `- Source scrape generated: ${runMetadata.generatedAt}`,
    `- Threads analyzed: ${threads.length}`,
    `- Drafting-relevant threads analyzed: ${draftingThreadCount}`,
    `- Messages analyzed: ${messages.length}`,
    `- Sent messages analyzed: ${sentMessageCount}`,
    `- Quote-family threads (send/revision/follow-up): ${quoteThreadCount}`,
    '',
    '## Scenario Mix',
    scenarioLines,
    '',
    '## Subject Patterns',
    '- The dominant pattern is concise subject-first labeling rather than persuasive copy.',
    '- Quote subjects usually lead with `Painting Quote`, `Soumission`, or `Estimate`, then the address/project, then sometimes a season or update marker.',
    subjectLines,
    '',
    '## Signers And Sign-Offs',
    signerSections || '- No signer patterns inferred.',
    '',
    '### Overall Sign-Off Frequency',
    signOffLines,
    '',
    '## CTA Patterns',
    '- Most sent emails stay operational: attached quote notice, questions, availability, photos, or next-step approval.',
    ctaLines,
    '',
    '## Quote Email Shape',
    `- Threads mentioning phases: ${quoteThreadsWithPhaseLanguage}/${quoteThreadCount} (${quotePhasePct}%)`,
    `- Threads mentioning updates / cost breakdown: ${quoteThreadsWithUpdateLanguage}/${quoteThreadCount} (${quoteUpdatePct}%)`,
    '- Quote emails are not uniformly detailed. The dataset supports a direct/minimal default with a longer explanation mode when updates, phases, or project context matter.',
    detailLines,
    '',
    '## Drafting Takeaways',
    '- Default tone should be direct, calm, and operational. Most emails do not over-explain.',
    '- Subject lines should stay utilitarian: quote/update first, then address/project, then season/update marker if useful.',
    '- Sign-off and signature should be chosen explicitly by signer rather than hard-coded to one person.',
    '- Use the longer explanatory mode mainly for revised quotes, phased work, project updates, or declines that need brief reasoning.',
    '- For lead-response logic, the recurring asks are photos, more project details, availability, and estimate-visit coordination.',
    '',
    '## Caveats',
    '- Current counts reflect the exported dataset and may shift after scraper filter tuning or deduping changes.',
    '- Signer inference is best-effort and based on names found in the extracted signature block or body.',
  ].join('\n');

  fs.writeFileSync(OUTPUT_PATH, `${output}\n`);
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main();
