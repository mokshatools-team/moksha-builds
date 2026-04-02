#!/usr/bin/env node
/**
 * classify.js — Classify PDFs as interior / exterior / both / not-a-quote
 * Moves files into pdfs/interior/, pdfs/exterior/, pdfs/both/, pdfs/not-quotes/
 *
 * Run: node past-quotes/classify.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs   = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const PDF_DIR = path.join(__dirname, 'pdfs');
const DIRS = {
  interior:   path.join(PDF_DIR, 'interior'),
  exterior:   path.join(PDF_DIR, 'exterior'),
  both:       path.join(PDF_DIR, 'both'),
  'not-quotes': path.join(PDF_DIR, 'not-quotes'),
};

for (const d of Object.values(DIRS)) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CLASSIFY_PROMPT = `You are classifying a document for Ostéopeinture, a Montréal painting company.

Respond with ONLY one of these four labels — nothing else:
- interior   (quote or estimate for interior painting work)
- exterior   (quote or estimate for exterior painting/staining/siding work)
- both       (quote covering interior AND exterior)
- not-quote  (bank statement, invoice from supplier, unrelated document, or anything that is not a painting quote/estimate for a client)

Label:`;

async function classifyPdf(pdfPath) {
  const pdfBytes = fs.readFileSync(pdfPath);
  const b64 = pdfBytes.toString('base64');

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 10,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
        { type: 'text', text: CLASSIFY_PROMPT },
      ],
    }],
  });

  const label = response.content[0].text.trim().toLowerCase();
  if (label === 'interior') return 'interior';
  if (label === 'exterior') return 'exterior';
  if (label === 'both')     return 'both';
  return 'not-quotes';
}

async function main() {
  const pdfs = fs.readdirSync(PDF_DIR)
    .filter(f => f.toLowerCase().endsWith('.pdf') && fs.statSync(path.join(PDF_DIR, f)).isFile())
    .map(f => path.join(PDF_DIR, f));

  if (!pdfs.length) {
    console.log('No PDFs found in', PDF_DIR);
    process.exit(0);
  }

  console.log(`\nClassifying ${pdfs.length} PDFs...\n`);

  const counts = { interior: 0, exterior: 0, both: 0, 'not-quotes': 0, error: 0 };

  for (let i = 0; i < pdfs.length; i++) {
    const pdfPath = pdfs[i];
    const filename = path.basename(pdfPath);
    process.stdout.write(`  [${i + 1}/${pdfs.length}] ${filename.slice(0, 55).padEnd(55)} `);

    try {
      const label = await classifyPdf(pdfPath);
      const dest = path.join(DIRS[label], filename);
      fs.renameSync(pdfPath, dest);
      process.stdout.write(`→ ${label}\n`);
      counts[label]++;
    } catch (e) {
      process.stdout.write(`→ ERROR: ${e.message}\n`);
      counts.error++;
    }

    // Small delay to stay under rate limits
    await new Promise(r => setTimeout(r, 300));
  }

  console.log('\n─── Results ───────────────────────────────');
  console.log(`  interior:   ${counts.interior}`);
  console.log(`  exterior:   ${counts.exterior}`);
  console.log(`  both:       ${counts.both}`);
  console.log(`  not-quotes: ${counts['not-quotes']}`);
  if (counts.error) console.log(`  errors:     ${counts.error}`);
  console.log('───────────────────────────────────────────\n');
  console.log('Review pdfs/not-quotes/ and delete anything truly irrelevant.');
  console.log('Then run: node past-quotes/extract.js\n');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
