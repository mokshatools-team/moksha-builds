// lib/quote-renderer.js — Quote HTML rendering (extracted from server.js)

const path = require('path');
const fs = require('fs');

// ============================================================
// LOGO ASSET (loaded from template at startup)
// ============================================================

let LOGO_HOUSE_B64 = '';
let LOGO_WORD_B64 = '';
const TEMPLATE_PATH = path.join(__dirname, '..', 'public', 'quote_template.html');
if (fs.existsSync(TEMPLATE_PATH)) {
  const tmpl = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const m = tmpl.match(/class="logo-house" src="data:image\/png;base64,([^"]{20,})"/);
  if (m) LOGO_HOUSE_B64 = m[1];
}
const WORD_LOGO_PATH = path.join(__dirname, '..', 'public', 'logo-word-brown.jpg');
if (fs.existsSync(WORD_LOGO_PATH)) {
  LOGO_WORD_B64 = fs.readFileSync(WORD_LOGO_PATH).toString('base64');
}
let SIGNATURE_LORIC_B64 = '';
const SIG_PATH = path.join(__dirname, '..', 'public', 'signature-loric-sm.png');
if (fs.existsSync(SIG_PATH)) {
  SIGNATURE_LORIC_B64 = fs.readFileSync(SIG_PATH).toString('base64');
}

// ============================================================
// QUOTE HTML RENDERER
// ============================================================

// Format dollar amount — whole numbers by default, cents when needed
function fmt(n, { cents = false } = {}) {
  if (n == null) return '';
  const decimals = cents ? 2 : 0;
  return Number(n).toLocaleString('fr-CA', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + ' $';
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderQuoteHTML(data, options = {}) {
  const branded = options.branded !== false; // default true
  const sections = data.sections || [];
  const isExterior = (data.projectType || '').toLowerCase().includes('exterior');

  // Language detection — French if projectType contains French words or explicit lang field
  const pt = (data.projectType || '').toLowerCase();
  const isFr = data.lang === 'fr' || pt.includes('peinture') || pt.includes('teinture') || pt.includes('intérieur') || pt.includes('extérieur');

  const t = isFr ? {
    address: 'Adresse',
    project: 'Projet',
    date: 'Date',
    scope: 'Conditions et inclusions',
    costBreakdown: 'Ventilation des coûts',
    total: 'TOTAL',
    grandTotal: 'GRAND TOTAL',
    paintProducts: 'Peinture et produits',
    paintNote: 'Nos soumissions incluent de la peinture haut de gamme et tous les matériaux nécessaires à la bonne préparation des surfaces.',
    paintTotal: 'Total peinture (incl. dans la soumission)',
    details: 'Détails et modalités',
    startDate: 'Date de début proposée',
    duration: 'Durée des travaux',
    deposit: 'Montant du dépôt',
    paymentMethod: 'Mode de paiement',
    additionalWork: 'Tout travail supplémentaire sera facturé en conséquence.',
    validPeriod: 'Cette soumission est valide pour une période de 30 jours.',
    clientResponsibility: 'Le client est responsable de s\'assurer que les travaux sont conformes aux spécifications et aux permis requis par la Ville.',
    clientSignature: 'Signature du client',
    representative: 'Représentant OstéoPeinture',
    excludedLabel: '(exclu du total)',
    paintingWork: 'Travaux de peinture',
  } : {
    address: 'Address',
    project: 'Project',
    date: 'Date',
    scope: 'Scope & General Conditions',
    costBreakdown: 'Cost Breakdown',
    total: 'TOTAL',
    grandTotal: 'GRAND TOTAL',
    paintProducts: 'Paint & Products',
    paintNote: 'Our quotes include high-end paint and all materials required for proper preparation of surfaces.',
    paintTotal: 'Paint Total (incl. in quote)',
    details: 'Details & Modalities',
    startDate: 'Proposed Start Date',
    duration: 'Duration of Work',
    deposit: 'Deposit Amount',
    paymentMethod: 'Payment Method',
    additionalWork: 'All additional work will be charged accordingly.',
    validPeriod: 'This quote is valid for a period of 30 days.',
    clientResponsibility: 'The client is responsible for ensuring that the work conforms to the specifications and permits required by the City.',
    clientSignature: 'Client Signature',
    representative: 'OstéoPeinture Representative',
    excludedLabel: '(excluded from total)',
    paintingWork: 'Painting Work',
  };

  // Calculate subtotal — skip excluded and optional sections
  let rawSubtotal = 0;
  for (const sec of sections) {
    if (sec.excluded || sec.optional) continue;
    if (sec.total) {
      rawSubtotal += sec.total;
    } else if (sec.items) {
      for (const item of sec.items) {
        if (item.price) rawSubtotal += item.price;
      }
    }
  }
  // --- Totals: exact sums, no rounding ---
  const subtotal = rawSubtotal;
  const tps = Math.round(subtotal * 0.05 * 100) / 100;       // 5% TPS, rounded to cent
  const tvq = Math.round(subtotal * 0.09975 * 100) / 100;    // 9.975% TVQ, rounded to cent
  const grandTotal = subtotal + tps + tvq;

  // Build terms block
  const terms = data.terms || {};
  let termsHtml = '';
  if (terms.includes && terms.includes.length) {
    termsHtml += `<div class="terms-title">${isFr ? 'Notre prix inclut\u00a0:' : 'Our Price Includes:'}</div>`;
    for (const t of terms.includes) {
      termsHtml += `<div class="terms-item">${esc(t)}</div>`;
    }
  }
  if (terms.conditions && terms.conditions.length) {
    termsHtml += `<div class="terms-gap"></div><div class="terms-subtitle">${isFr ? 'Conditions générales' : 'General Conditions'}</div>`;
    for (const c of terms.conditions) {
      termsHtml += `<div class="terms-item">${esc(c)}</div>`;
    }
  }
  // Estimate disclaimer — plain italic, tight against last condition (exterior only)
  if (data.estimateDisclaimer) {
    termsHtml += `<div style="font-style:italic;font-size:7.5px;color:#555;text-align:center;padding:8px 14px;margin-top:8px;border-top:1px solid #ccc;border-bottom:1px solid #ccc;">${esc(data.estimateDisclaimer)}</div>`;
  }

  // Build sections — detect format
  // Format A: room-based (has `floor` or `name` fields)
  // Format B: category-based (has `range` and `title` fields — Bunding/renovation style)
  const isRoomBased = sections.length > 0 && (sections[0].name !== undefined || sections[0].floor !== undefined);

  let tableHtml = '';
  if (isRoomBased) {
    // Pre-compute totals per floor/title group so we can show them in the header row.
    // Sections without a floor inherit the current group (AI only sets floor on the first section of each group).
    const groupTotals = {};
    let activeGroup = null;
    for (const sec of sections) {
      if (sec.excluded || sec.optional) { activeGroup = null; continue; }
      if (sec.floor) activeGroup = sec.floor;
      else if (sec.title && !sec.name) activeGroup = sec.title; // standalone title starts new group
      const key = activeGroup || '';
      if (!key) continue;
      const secTotal = sec.total != null ? sec.total : (sec.items || []).reduce((s, i) => s + (i.price || 0), 0);
      groupTotals[key] = (groupTotals[key] || 0) + secTotal;
    }

    let currentFloor = null;
    let addedOptionalDivider = false;

    for (let si = 0; si < sections.length; si++) {
      const sec = sections[si];

      // Optional add-ons divider
      if (sec.optional && !addedOptionalDivider) {
        currentFloor = null;
        addedOptionalDivider = true;
        tableHtml += `<tr class="row-options-gap"><td colspan="2"></td></tr>`;
        tableHtml += `<tr class="row-options-header"><td colspan="2">${isFr ? 'OPTIONS ADDITIONNELLES' : 'OPTIONAL ADD-ONS'}</td></tr>`;
      }

      // Excluded section divider
      if (sec.excluded && !sec.optional) {
        currentFloor = null;
        tableHtml += `<tr class="row-spacer"><td colspan="2"></td></tr>`;
      }

      // Floor header with group total in the header bar
      if (!sec.optional && sec.floor && typeof sec.floor === 'string' && sec.floor !== currentFloor) {
        currentFloor = sec.floor;
        const gt = groupTotals[sec.floor];
        const gtDisplay = gt ? fmt(gt) : '';
        tableHtml += `<tr class="row-floor"><td>${esc(sec.floor)}</td><td class="col-price">${gtDisplay}</td></tr>`;
      }
      // Standalone sections with `title` (no floor) — header with group total
      if (sec.title && !sec.floor && !sec.optional) {
        currentFloor = sec.title;
        const gt = groupTotals[sec.title];
        const gtDisplay = gt ? fmt(gt) : '';
        tableHtml += `<tr class="row-floor"><td>${esc(sec.title)}</td><td class="col-price">${gtDisplay}</td></tr>`;
      }

      const secTotal = sec.total != null ? sec.total : (sec.items || []).reduce((s, i) => s + (i.price || 0), 0);
      const excludedLabel = sec.excluded ? ` <span style="font-size:7px;font-weight:400;color:#999;font-style:italic;">${t.excludedLabel}</span>` : '';
      const rangeLabel = sec.range ? ` <span style="font-size:8px;font-weight:500;color:#777;">[${esc(sec.range)}]</span>` : '';
      const priceDisplay = sec.excluded ? '' : (secTotal ? (sec.optional ? '[+' + fmt(secTotal) + ']' : fmt(secTotal)) : '');

      // Section name: `name` for interior, `title` for exterior (when floor is H1), or `title` for optional/excluded standalone sections
      const sectionName = sec.name || (sec.floor && sec.title ? sec.title : '') || ((sec.optional || sec.excluded) && sec.title ? sec.title : '') || '';
      if (sectionName) {
        // Bold any inline price ranges like [1 850 $ – 2 500 $]
        const nameHtml = esc(sectionName).replace(/(\[[\d\s,$–—-]+\$\s*[\s–—-]+\s*[\d\s,$]+\$\])/g, '<strong style="font-weight:700">$1</strong>');
        tableHtml += `<tr class="row-section"><td class="col-desc">${nameHtml}${rangeLabel}${excludedLabel}</td><td class="col-price">${priceDisplay}</td></tr>`;
      }
      for (const item of (sec.items || [])) {
        const itemPrice = (sec.excluded || !item.price) ? '' : (sec.optional ? '[+' + fmt(item.price) + ']' : fmt(item.price));
        tableHtml += `<tr class="row-item"><td class="col-desc"><span class="arrow">➛</span>${esc(item.description || '')}</td><td class="col-price">${itemPrice}</td></tr>`;
      }
      for (const excl of (sec.exclusions || [])) {
        tableHtml += `<tr class="row-note"><td colspan="2"><span class="arrow">➛</span>${esc(excl)}</td></tr>`;
      }
      const nextSec = sections[si + 1];
      const nextIsNewFloor = nextSec && nextSec.floor && nextSec.floor !== currentFloor;
      const hasItems = (sec.items || []).length > 0;
      if (si < sections.length - 1 && !nextIsNewFloor && !sec.optional && !(nextSec && nextSec.optional) && hasItems) {
        tableHtml += `<tr class="row-spacer"><td colspan="2"></td></tr>`;
      }
    }
  } else {
    // Category/zone-based (renovation or exterior style)
    let addedOptionalDivider = false;
    for (let si = 0; si < sections.length; si++) {
      const sec = sections[si];

      // Insert divider before first optional section
      if (sec.optional && !addedOptionalDivider) {
        addedOptionalDivider = true;
        tableHtml += `<tr class="row-options-gap"><td colspan="2"></td></tr>`;
        tableHtml += `<tr class="row-options-header"><td colspan="2">${isFr ? 'OPTIONS ADDITIONNELLES' : 'OPTIONAL ADD-ONS'}</td></tr>`;
      }

      // Insert divider before excluded section (repairs)
      if (sec.excluded && !sec.optional) {
        tableHtml += `<tr class="row-spacer"><td colspan="2"></td></tr>`;
      }

      const secTotal = sec.total != null ? sec.total : (sec.items || []).reduce((s, i) => s + (i.price || 0), 0);
      const rangeLabel = sec.range ? ` <span style="font-size:8px;font-weight:500;color:#777;">[${esc(sec.range)}]</span>` : '';
      const excludedLabel = sec.excluded ? ` <span style="font-size:7px;font-weight:400;color:#999;font-style:italic;">${t.excludedLabel}</span>` : '';
      const priceDisplay = sec.excluded ? '' : (secTotal ? (sec.optional ? '[+' + fmt(secTotal) + ']' : fmt(secTotal)) : '');
      const catNameHtml = esc(sec.title || sec.name || '').replace(/(\[[\d\s,$–—-]+\$\s*[\s–—-]+\s*[\d\s,$]+\$\])/g, '<strong style="font-weight:700">$1</strong>');
      tableHtml += `<tr class="row-section"><td class="col-desc">${catNameHtml}${rangeLabel}${excludedLabel}</td><td class="col-price">${priceDisplay}</td></tr>`;
      for (const item of (sec.items || [])) {
        const itemPrice = (sec.excluded || !item.price) ? '' : (sec.optional ? '[+' + fmt(item.price) + ']' : fmt(item.price));
        tableHtml += `<tr class="row-item"><td class="col-desc"><span class="arrow">➛</span>${esc(item.description || '')}</td><td class="col-price">${itemPrice}</td></tr>`;
      }
      if (si < sections.length - 1 && !sections[si + 1].optional && !sections[si + 1].excluded) {
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
  if (paintTotal > 0) {
    paintHtml += `<tr class="paint-total-row"><td class="col-product">${t.paintTotal}</td><td class="col-finish">~ ${fmt(paintTotal)}</td></tr>`;
  }

  // Modalities
  const mod = data.modalities || {};
  const depositStr = mod.deposit ? `$${Number(mod.deposit).toLocaleString('fr-CA')}` : '—';

  const logoImg = LOGO_HOUSE_B64
    ? `<img class="logo-house" src="data:image/png;base64,${LOGO_HOUSE_B64}" alt="logo">`
    : '';

  return `<!DOCTYPE html>
<html lang="${isFr ? 'fr' : 'en'}">
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
.client-header tr:first-child td { border-bottom:none; }
.client-header tr:first-child { border-bottom:1.5px solid #1a1a1a; }
.client-header tr:last-child td { padding-top:8px; }
.section-header { background:#1a1a1a; color:#fff; text-align:center; font-size:9.5px; font-weight:700; letter-spacing:2.5px; text-transform:uppercase; padding:11px 12px; margin-top:20px; }
.terms-block { padding:10px 14px 12px; border-bottom:1.5px solid #1a1a1a; }
.terms-title { font-size:8px; font-weight:700; margin-bottom:5px; }
.terms-item { font-size:7.5px; color:#222; padding:1.5px 0 1.5px 13px; position:relative; line-height:1.5; }
.terms-item::before { content:"➛"; position:absolute; left:0; font-size:7px; top:2px; }
.terms-item.bold { font-weight:700; }
.terms-gap { height:8px; }
.terms-subtitle { font-size:8px; font-weight:700; margin-bottom:4px; margin-top:2px; }
.quote-table { width:100%; border-collapse:collapse; }
.row-options-gap td { height:14px; border:none; background:#fff; }
.row-options-header td { background:#f2f2f2; font-size:7.5px; font-weight:700; letter-spacing:1.2px; text-transform:uppercase; padding:6px 10px; border-top:2px solid #1a1a1a; border-bottom:2px solid #1a1a1a; color:#555; font-style:italic; }
.row-floor td { background:#f2f2f2; font-size:7.8px; font-weight:700; letter-spacing:1px; text-transform:uppercase; padding:5px 10px; border-top:1.5px solid #1a1a1a; border-bottom:none; }
.row-floor .col-price { text-align:right; white-space:nowrap; font-size:8.5px; }
.row-section td { padding:5px 10px; font-size:8.2px; font-weight:700; border-top:1.5px solid #1a1a1a; border-bottom:1px solid #bbb; }
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
.paint-table tr.paint-total-row td { border-bottom:none; border-top:1px solid #aaa; font-weight:600; }
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
.sig-cell { padding:10px 14px; font-size:8px; font-weight:600; min-height:70px; display:flex; flex-direction:column; justify-content:flex-end; align-items:flex-start; }
.sig-cell img.sig-img { height:50px; width:auto; margin-bottom:4px; }
.footer { text-align:center; margin-top:36px; }
.footer-logo { text-align:center; margin-bottom:6px; }
.footer-logo img { height:20px; }
.footer-info { font-size:6.5px; color:#888; line-height:1.7; letter-spacing:0.02em; }
@media print {
  body { background:white; padding:0; }
  .page { box-shadow:none; width:100%; padding:32px 40px; }
  /* Keep blocks from splitting across pages */
  .section-header, .mod-grid, .legal-block, .sig-grid, .footer, .totals-block { break-inside: avoid; }
  /* Paint + modalities + legal + signature + footer all stay together */
  .paint-section { break-inside: avoid; }
  .sig-grid { break-before: auto; }
  .footer { break-before: avoid; }
  /* Prevent table rows from orphaning */
  tr.row-section, tr.row-floor { break-after: avoid; }
  tr.row-item { break-inside: avoid; }
}
</style>
</head>
<body>
<div class="page">
  ${branded ? `<div class="logo-block">${logoImg}</div>` : ''}
  <div class="project-title">${esc(data.projectType || t.paintingWork)}</div>
  <table class="client-header">
    <tr>
      <td class="lbl">Client</td>
      <td class="val">${esc(data.clientName || '')}</td>
      <td class="gap"></td>
      <td class="lbl-r">${t.address}</td>
      <td class="val-r">${esc(data.address || '')}</td>
    </tr>
    <tr>
      <td class="lbl">${t.project}</td>
      <td class="val">${esc(data.projectId || '')}</td>
      <td class="gap"></td>
      <td class="lbl-r">${t.date}</td>
      <td class="val-r">${esc(data.date || '')}</td>
    </tr>
  </table>
  <div class="section-header" style="margin-top:0;">${t.scope}</div>
  <div class="terms-block">${termsHtml}</div>
  <div class="section-header">${t.costBreakdown}</div>
  <table class="quote-table">${tableHtml}</table>
  <div class="totals-block">
  <div class="row-total total-line"><div class="lbl">${t.total}</div><div class="prc">${fmt(subtotal)}</div></div>
  ${branded ? `<div class="row-total tax"><div class="lbl">TPS #7784757551RT0001</div><div class="prc">${fmt(tps, { cents: true })}</div></div>
  <div class="row-total tax"><div class="lbl">TVQ #1231045518</div><div class="prc">${fmt(tvq, { cents: true })}</div></div>
  <div class="row-total grand"><div class="lbl">${t.grandTotal}</div><div class="prc">${fmt(grandTotal, { cents: true })}</div></div>` : `<div class="row-total grand"><div class="lbl">${t.grandTotal}</div><div class="prc">${fmt(subtotal)}</div></div>`}
  </div>
  <div class="paint-section">
  <div class="section-header">${t.paintProducts}</div>
  <div class="paint-note">${t.paintNote}</div>
  <table class="paint-table">${paintHtml}</table>
  </div>
  <div class="section-header">${t.details}</div>
  <div class="mod-grid">
    <div class="mod-cell"><div class="mod-label">${t.startDate}</div><div class="mod-value">${esc(mod.startDate || '—')}</div></div>
    <div class="mod-cell"><div class="mod-label">${t.duration}</div><div class="mod-value">${esc(mod.duration || '—')}</div></div>
    <div class="mod-cell"><div class="mod-label">${t.deposit}</div><div class="mod-value">${esc(depositStr)}</div></div>
    <div class="mod-cell"><div class="mod-label">${t.paymentMethod}</div><div class="mod-value small">${esc(mod.paymentMethod || '')}</div></div>
  </div>
  <div class="legal-block">
    ${t.validPeriod}<br>
    ${t.clientResponsibility}
  </div>
  ${branded ? `<div class="sig-grid">
    <div class="sig-cell">${t.clientSignature}</div>
    <div class="sig-cell">${SIGNATURE_LORIC_B64 ? `<img class="sig-img" src="data:image/png;base64,${SIGNATURE_LORIC_B64}" alt="Loric St-Onge">` : ''}${t.representative}</div>
  </div>
  <div class="footer">
    <div class="footer-logo">${LOGO_WORD_B64 ? `<img src="data:image/jpeg;base64,${LOGO_WORD_B64}" alt="Ostéopeinture">` : 'Ostéopeinture'}</div>
    <div class="footer-info">
      #201 - 80 rue Saint-Viateur E., Montréal, QC H2T 1A6<br>
      438-870-8087 | info@osteopeinture.com | www.osteopeinture.com<br>
      RBQ# 5790-0045-01
    </div>
  </div>` : ''}
</div>
</body>
</html>`;
}

module.exports = { renderQuoteHTML, esc };
