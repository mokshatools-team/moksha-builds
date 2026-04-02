#!/usr/bin/env node
/**
 * extract.js — Past quote extraction pipeline
 * Reads PDFs from pdfs/interior/, pdfs/exterior/, pdfs/both/
 * Extracts structured data per quote, saves:
 *   extracted-interior.json + interior-patterns.md
 *   extracted-exterior.json + exterior-patterns.md
 *
 * Run: node past-quotes/extract.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs   = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const PDF_DIR = path.join(__dirname, 'pdfs');
const client  = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── EXTRACTION PROMPT ───────────────────────────────────────────────────────

const EXTRACT_PROMPT = `You are extracting structured data from a painting quote PDF for Ostéopeinture, a painting company in Montréal.

Extract the following fields and return ONLY valid JSON — no explanation, no markdown fences:

{
  "clientName": "Full Name or null",
  "projectId": "LASTNAME_01 or null",
  "address": "Full address or null",
  "date": "Date string as written or null",
  "year": 2024,
  "jobType": "exterior | interior | both | unknown",
  "projectType": "Short description of the work",
  "floors": ["Ground Floor", "2nd Floor"],
  "sections": [
    {
      "floor": "Floor name or null",
      "name": "Room or area name",
      "items": [
        { "description": "Line item description", "price": 1200 }
      ],
      "total": 1200
    }
  ],
  "paints": [
    { "type": "Surface type", "product": "Product name", "color": "Color or null", "finish": "Finish or null", "approxCost": 0 }
  ],
  "laborTotal": 0,
  "materialsTotal": 0,
  "subtotal": 0,
  "tps": 0,
  "tvq": 0,
  "grandTotal": 0,
  "deposit": 0,
  "depositPercent": 0,
  "duration": "e.g. 3 days or null",
  "startDate": "As written or null",
  "paymentMethod": "As written or null",
  "specialConditions": ["Any notable conditions or prep requirements"],
  "notes": "Any other relevant info"
}

Rules:
- All price values are numbers (not strings)
- If a field is not found, use null (not empty string)
- For jobType: exterior means the work is on the outside of the building (siding, trim, doors, windows, decks, etc.)
- Extract every line item you can find, preserving descriptions and prices exactly as written
- If the quote groups by floor, preserve that grouping in sections
`;

// ─── PATTERN PROMPTS ─────────────────────────────────────────────────────────

const INTERIOR_PATTERN_PROMPT = `You are analyzing a set of extracted interior painting quotes from Ostéopeinture, a Montréal painting company.

Write a structured markdown summary covering:
1. Common scope items and line item patterns (what tasks appear most, how they are described)
2. Typical price ranges by task type (walls, ceilings, trim, doors, windows)
3. How quotes are structured by room and floor
4. Paint product patterns (which products appear most for interior)
5. Duration and day-count patterns
6. Deposit patterns
7. Any formatting or grouping conventions you notice

This will be used to validate and refine the interior section of a quoting logic document.
Be specific and include actual numbers and ranges where available.`;

const EXTERIOR_PATTERN_PROMPT = `You are analyzing a set of extracted exterior painting quotes from Ostéopeinture, a Montréal painting company.

Write a structured markdown summary covering:
1. Common scope items and line item patterns (what tasks appear most, how they are described)
2. Typical price ranges by task type (siding, trim, doors, windows, decks, fascia, soffits, railings, etc.)
3. Paint product patterns (which products appear most for exterior — brand, product name, finish)
4. How quantities are measured and described (sqft, linear ft, count, lump sum)
5. Duration and day-count patterns
6. Deposit patterns
7. How exterior quotes differ structurally from interior quotes
8. Any formatting or grouping conventions (by surface type, by area, by floor, etc.)
9. Pricing per unit or sqft where inferable

This will be used to write the EXTERIOR section of a quoting logic document.
Be specific and include actual numbers and ranges where available.`;

// ─── EXTRACTION ───────────────────────────────────────────────────────────────

async function extractQuote(pdfPath) {
  const filename = path.basename(pdfPath);
  const pdfBytes = fs.readFileSync(pdfPath);
  const b64 = pdfBytes.toString('base64');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
        { type: 'text', text: EXTRACT_PROMPT },
      ],
    }],
  });

  const raw = response.content[0].text.trim();
  try {
    const parsed = JSON.parse(raw);
    parsed._sourceFile = filename;
    return { ok: true, data: parsed };
  } catch (e) {
    console.warn(`    ✗ JSON parse failed for ${filename}:`, e.message);
    return { ok: false, file: filename, error: e.message, raw };
  }
}

async function summarizePatterns(quotes, prompt) {
  if (!quotes.length) return null;
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: `${prompt}\n\nHere are the extracted quotes:\n${JSON.stringify(quotes, null, 2)}`,
    }],
  });
  return response.content[0].text;
}

// ─── PROCESS ONE FOLDER SET ───────────────────────────────────────────────────

async function processFolder(label, folders, outJson, outPatterns, patternPrompt) {
  // Collect PDFs from all source folders
  const pdfs = [];
  for (const folder of folders) {
    if (!fs.existsSync(folder)) continue;
    const files = fs.readdirSync(folder)
      .filter(f => f.toLowerCase().endsWith('.pdf') && /^(2024|2025)-/.test(f) && !/_FACTURE|_INVOICE|_FACTURE_|COST_BREAKDOWN|FINAL_INVOICE/.test(f))
      .map(f => path.join(folder, f));
    pdfs.push(...files);
  }

  if (!pdfs.length) {
    console.log(`\n[${label}] No PDFs found — skipping.`);
    return;
  }

  console.log(`\n${'═'.repeat(55)}`);
  console.log(`  ${label.toUpperCase()} — ${pdfs.length} PDF(s)`);
  console.log('═'.repeat(55));

  const results = [];
  const errors  = [];

  for (const pdfPath of pdfs) {
    const filename = path.basename(pdfPath);
    process.stdout.write(`  → ${filename.slice(0, 55).padEnd(55)} `);
    try {
      const result = await extractQuote(pdfPath);
      if (result.ok) {
        results.push(result.data);
        process.stdout.write(`✓ ${result.data.clientName || 'Unknown'} $${result.data.grandTotal || '?'}\n`);
      } else {
        process.stdout.write(`✗ parse error\n`);
        errors.push(result);
      }
    } catch (e) {
      process.stdout.write(`✗ ${e.message}\n`);
      errors.push({ file: filename, error: e.message });
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // Save extracted JSON
  const output = {
    extractedAt: new Date().toISOString(),
    label,
    total: results.length,
    errors: errors.length,
    quotes: results,
    ...(errors.length ? { parseErrors: errors } : {}),
  };
  fs.writeFileSync(outJson, JSON.stringify(output, null, 2));
  console.log(`\n  ✓ Saved ${results.length} quotes → ${outJson}`);
  if (errors.length) console.warn(`  ⚠ ${errors.length} error(s) in output`);

  // Quick stats
  const totals = results.map(q => q.grandTotal).filter(Boolean);
  if (totals.length) {
    const avg = Math.round(totals.reduce((a, b) => a + b, 0) / totals.length);
    console.log(`  Totals — min: $${Math.min(...totals)} / avg: $${avg} / max: $${Math.max(...totals)}`);
  }

  // Pattern summary
  if (results.length) {
    console.log(`  Generating ${label} patterns summary...`);
    const patterns = await summarizePatterns(results, patternPrompt);
    if (patterns) {
      fs.writeFileSync(outPatterns, patterns);
      console.log(`  ✓ Patterns → ${outPatterns}`);
    }
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  await processFolder(
    'interior',
    [path.join(PDF_DIR, 'interior')],
    path.join(__dirname, 'extracted-interior.json'),
    path.join(__dirname, 'interior-patterns.md'),
    INTERIOR_PATTERN_PROMPT,
  );

  await processFolder(
    'exterior',
    [path.join(PDF_DIR, 'exterior')],
    path.join(__dirname, 'extracted-exterior.json'),
    path.join(__dirname, 'exterior-patterns.md'),
    EXTERIOR_PATTERN_PROMPT,
  );

  // "both" goes into both datasets
  await processFolder(
    'both (counted in interior)',
    [path.join(PDF_DIR, 'both')],
    path.join(__dirname, 'extracted-both.json'),
    path.join(__dirname, 'both-patterns.md'),
    EXTERIOR_PATTERN_PROMPT,
  );

  console.log('\nDone. Next steps:');
  console.log('  1. Review interior-patterns.md  → validate/refine QUOTING_LOGIC.md');
  console.log('  2. Review exterior-patterns.md  → write exterior section of QUOTING_LOGIC.md');
  console.log('  3. Review both-patterns.md      → supplement both sections\n');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
