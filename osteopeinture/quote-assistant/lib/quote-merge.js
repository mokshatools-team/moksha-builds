// lib/quote-merge.js — Quote merge logic (extracted from server.js)

// Fuzzy match: normalize section identifiers for comparison
function secKey(s) {
  return (s.name || s.title || s.floor || '')
    .toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
}

/**
 * Field-level merge of Claude's output with the current draft.
 * For each matching section, only apply fields Claude actually changed.
 * This preserves manual edits to descriptions, items, etc.
 */
function mergeQuoteJson(existingQuote, newQuote) {
  if (!existingQuote || !existingQuote.sections || !newQuote.sections) {
    return newQuote;
  }

  const mergedSections = [];
  const matchedOldIndices = new Set();
  for (const newSec of newQuote.sections) {
    const nk = secKey(newSec);
    // Find best match in existing draft (fuzzy)
    let bestIdx = -1;
    for (let i = 0; i < existingQuote.sections.length; i++) {
      if (matchedOldIndices.has(i)) continue;
      if (secKey(existingQuote.sections[i]) === nk) { bestIdx = i; break; }
    }
    if (bestIdx >= 0) {
      matchedOldIndices.add(bestIdx);
      const oldSec = existingQuote.sections[bestIdx];
      // Field-level merge: start from draft, apply only fields Claude changed
      const merged = JSON.parse(JSON.stringify(oldSec));
      if (newSec.total !== oldSec.total) merged.total = newSec.total;
      if ((newSec.range || '') !== (oldSec.range || '')) merged.range = newSec.range;
      if (newSec.excluded !== oldSec.excluded) merged.excluded = newSec.excluded;
      if (newSec.optional !== oldSec.optional) merged.optional = newSec.optional;
      mergedSections.push(merged);
    } else {
      mergedSections.push(newSec);
    }
  }
  // Keep draft sections Claude omitted entirely
  for (let i = 0; i < existingQuote.sections.length; i++) {
    if (!matchedOldIndices.has(i)) mergedSections.push(existingQuote.sections[i]);
  }
  newQuote.sections = mergedSections;
  // Preserve draft paints/modalities/terms unless Claude changed them
  if (existingQuote.paints) newQuote.paints = existingQuote.paints;
  if (existingQuote.modalities) newQuote.modalities = existingQuote.modalities;
  if (existingQuote.terms) newQuote.terms = existingQuote.terms;
  // Always preserve these from draft if they exist
  if (existingQuote.estimateDisclaimer) newQuote.estimateDisclaimer = existingQuote.estimateDisclaimer;

  return newQuote;
}

module.exports = { mergeQuoteJson };
