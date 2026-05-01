// lib/shared.js — Shared server utilities (extracted from server.js)

const { summarizeImageUpload } = require('./image-upload');

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

function buildCompactStoredUserContent(userText, normalizedImages) {
  const parts = [];
  if (userText) parts.push(userText);
  const imageSummary = summarizeImageUpload(normalizedImages);
  if (imageSummary) parts.push(imageSummary);
  return parts.join('\n\n');
}

module.exports = { extractJsonString, buildCompactStoredUserContent };
