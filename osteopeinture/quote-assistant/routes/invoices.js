'use strict';
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

// Dependencies injected via init
let db, getJob, getJobPayments, renderQuoteHTML, esc, generateQuotePDF, syncPaymentToSheet;

function init(deps) {
  db = deps.db;
  getJob = deps.getJob;
  getJobPayments = deps.getJobPayments;
  renderQuoteHTML = deps.renderQuoteHTML;
  esc = deps.esc;
  generateQuotePDF = deps.generateQuotePDF;
  syncPaymentToSheet = deps.syncPaymentToSheet;
}

// ============================================================
// CLIENT COST UPDATE (unified document: quote + add-ons + payments + balance)
// Replaces separate change orders + invoices. Same branded template as quotes.
// Title toggles: "Mise à jour des coûts" / "Cost Update" vs "Facture" / "Invoice"
// ============================================================

router.post('/api/jobs/:id/cost-update', express.json(), async (req, res) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const { docType, language, customSections, customPaints } = req.body || {};
    const lang = language || job.language || 'french';
    const isFr = lang === 'french';
    const isInvoice = docType === 'invoice';
    const isCash = job.payment_type === 'cash';

    // 1. Original quote sections
    const quoteJson = job.accepted_quote_json
      ? (typeof job.accepted_quote_json === 'string' ? JSON.parse(job.accepted_quote_json) : job.accepted_quote_json)
      : null;
    const originalSections = (quoteJson && quoteJson.sections) || [];

    // If customSections provided (from invoice editor), use those directly
    const sections = [];
    let originalSubtotal = 0;
    let addonsSubtotal = 0;

    if (customSections && Array.isArray(customSections)) {
      // Editor-supplied sections — use as-is
      for (const sec of customSections) {
        const secTotal = sec.total || (sec.items || []).reduce((s, i) => s + (i.price || 0), 0);
        originalSubtotal += secTotal;
        sections.push({ ...sec });
      }
    } else {
      // Default: build from accepted quote + change orders + extras

      // 2. Approved change orders as extras
      const changeOrders = await db.all(
        "SELECT * FROM job_change_orders WHERE job_id = ? AND status = 'approved' ORDER BY created_at",
        [job.id]
      );

      // 3. Extras from job_sections (free-text → convert to a section)
      const jobSections = job.job_sections
        ? (typeof job.job_sections === 'string' ? JSON.parse(job.job_sections) : job.job_sections)
        : {};
      const extrasText = (jobSections.extras || '').trim();

      // Original quote sections (non-optional, non-excluded)
      for (const sec of originalSections) {
        if (sec.excluded || sec.optional) continue;
        const secTotal = sec.total || (sec.items || []).reduce((s, i) => s + (i.price || 0), 0);
        originalSubtotal += secTotal;
        sections.push({ ...sec });
      }

      // Add-ons from change orders
      if (changeOrders.length > 0 || extrasText) {
        for (const co of changeOrders) {
          const coTotal = co.amount_cents / 100;
          addonsSubtotal += coTotal;
          let items = [];
          try { items = JSON.parse(co.description); } catch(e) {}
          if (!Array.isArray(items)) items = [];
          sections.push({
            title: isFr ? (co.title_fr || co.title_en) : (co.title_en || co.title_fr),
            total: coTotal,
            items: items.map(i => ({ description: i.description || i.desc || '', price: (i.amountCents || 0) / 100 })),
          });
        }
        // Free-text extras as a section
        if (extrasText) {
          const extraLines = extrasText.split('\n').filter(l => l.trim());
          sections.push({
            title: isFr ? 'Extras' : 'Extras',
            items: extraLines.map(l => ({ description: l.trim(), price: 0 })),
            total: 0,
          });
        }
      }
    }

    // Payments
    const payments = await getJobPayments(job.id);
    const totalPaidCents = payments.reduce((s, p) => s + p.amount_cents, 0);

    // Totals
    const subtotal = originalSubtotal + addonsSubtotal;
    const tps = isCash ? 0 : subtotal * 0.05;
    const tvq = isCash ? 0 : subtotal * 0.09975;
    const grandTotal = subtotal + tps + tvq;
    const balanceDue = grandTotal - (totalPaidCents / 100);

    // Build the document HTML using the quote renderer's CSS
    // Title logic: cost update = PROJECT COST UPDATE, invoice = PROJECT COST BREAKDOWN (cash) or INVOICE (declared)
    const docTitle = isInvoice
      ? (isCash ? (isFr ? 'VENTILATION DES COÛTS DU PROJET' : 'PROJECT COST BREAKDOWN') : (isFr ? 'FACTURE' : 'INVOICE'))
      : (isFr ? 'MISE À JOUR DES COÛTS DU PROJET' : 'PROJECT COST UPDATE');
    const projectType = quoteJson ? quoteJson.projectType : (isFr ? 'Travaux de peinture' : 'Painting Work');

    // Construct a quote-like object and render it
    const costUpdateData = {
      clientName: job.client_name,
      projectId: job.job_number,
      address: job.address,
      date: new Date().toLocaleDateString(isFr ? 'fr-CA' : 'en-CA', { year: 'numeric', month: 'long', day: 'numeric' }),
      projectType: projectType,
      lang: isFr ? 'fr' : undefined,
      sections,
      // Invoice gets paint section; cost update does not. customPaints overrides if provided.
      paints: isInvoice ? (customPaints || (quoteJson && quoteJson.paints) || []) : [],
      terms: { includes: [], conditions: [] },
      modalities: {},
    };

    // Render the base quote HTML
    let html = renderQuoteHTML(costUpdateData, { branded: true });

    // Replace the title
    html = html.replace(
      /<div class="project-title">[^<]*<\/div>/,
      '<div class="project-title">' + docTitle + '</div>'
    );

    // Remove empty scope/conditions section (terms are empty for cost updates)
    html = html.replace(/<div class="section-header"[^>]*>[^<]*(?:Conditions et inclusions|Scope & General Conditions)[^<]*<\/div>\s*<div class="terms-block">\s*<\/div>/, '');

    // Remove modalities section (not needed for cost update or invoice)
    html = html.replace(/<div class="section-header">[^<]*(?:Détails et modalités|Details & Modalities)[^<]*<\/div>[\s\S]*?<\/div>\s*(?=<div class="(?:legal-block|sig-grid|footer|section-header)">)/, '');

    // Remove legal block ("additional work", "valid 30 days", "client responsible") for both
    html = html.replace(/<div class="legal-block">[\s\S]*?<\/div>/, '');

    // Cost update: remove signature + paint section
    if (!isInvoice) {
      html = html.replace(/<div class="sig-grid">[\s\S]*?<\/div>\s*<\/div>/, '');
      // Paint section contains nested divs + a table — match through </table> then closing </div>
      html = html.replace(/<div class="paint-section">[\s\S]*?<\/table>\s*<\/div>/, '');
    }

    // Build payments section
    let paymentsHtml = '';
    if (payments.length > 0) {
      paymentsHtml += '<div class="section-header">' + (isFr ? 'PAIEMENTS REÇUS' : 'PAYMENTS RECEIVED') + '</div>';
      paymentsHtml += '<table class="quote-table">';
      for (const p of payments) {
        const date = p.payment_date || p.created_at.slice(0, 10);
        const method = p.method || '';
        const amount = (p.amount_cents / 100).toLocaleString('fr-CA', { maximumFractionDigits: 0 }) + ' $';
        // Right-align date+method text so it reads near the amounts
        paymentsHtml += '<tr class="row-item"><td class="col-desc" style="text-align:right">' + esc(date) + ' — ' + esc(method) + '</td><td class="col-price">' + amount + '</td></tr>';
      }
      const paidStr = (totalPaidCents / 100).toLocaleString('fr-CA', { maximumFractionDigits: 0 }) + ' $';
      paymentsHtml += '<tr class="row-section"><td class="col-desc" style="text-align:right"><strong>' + (isFr ? 'Total payé' : 'Total Paid') + '</strong></td><td class="col-price"><strong>' + paidStr + '</strong></td></tr>';
      paymentsHtml += '</table>';

      // Balance due
      const balanceStr = balanceDue.toLocaleString('fr-CA', { maximumFractionDigits: 0 }) + ' $';
      paymentsHtml += '<div class="row-total grand" style="margin-top:8px"><div class="lbl">' + (isFr ? 'SOLDE À PAYER' : 'BALANCE TO BE PAID') + '</div><div class="prc">' + balanceStr + '</div></div>';
    }

    // Invoice closing statements (not on cost update)
    let closingHtml = '';
    if (isInvoice) {
      const closingText = isCash
        ? (isFr ? 'Le solde restant est à payer en argent comptant à la fin des travaux.' : 'The remaining balance is to be paid by cash upon completion of the work.')
        : (isFr ? 'Le solde restant est à payer par virement Interac à la fin des travaux.' : 'The remaining balance is to be paid by e-transfer upon completion of the work.');
      closingHtml = '<div style="text-align:center;font-size:8px;color:#555;padding:12px 0 6px">' + closingText + '</div>';
      closingHtml += '<div style="text-align:center;font-weight:700;font-style:italic;font-size:10px;padding:12px 0 20px">' + (isFr ? 'MERCI DE VOTRE CONFIANCE!' : 'THANK YOU FOR YOUR TRUST!') + '</div>';
    }

    // Inject payments + closing before footer
    const insertPoint = '<div class="footer">';
    if (paymentsHtml || closingHtml) {
      html = html.replace(insertPoint, paymentsHtml + closingHtml + insertPoint);
    }

    // If PDF requested, generate and return binary
    if (req.body.format === 'pdf') {
      const pdfBuffer = await generateQuotePDF(html);
      const docLabel = isInvoice ? 'Invoice' : 'Cost Update';
      const filename = (job.job_number || 'job') + ' - ' + docLabel + '.pdf';
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
      return res.send(pdfBuffer);
    }

    res.json({ html, docType: isInvoice ? 'invoice' : 'cost-update' });
  } catch (err) {
    console.error('Cost update error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Preview cost update as HTML page
router.get('/preview/cost-update/:jobId', async (req, res) => {
  try {
    const job = await getJob(req.params.jobId);
    if (!job) return res.status(404).send('Job not found');

    // Build the cost update HTML directly (same logic as POST handler but with defaults)
    const fakeReq = {
      params: { id: req.params.jobId },
      body: { docType: req.query.type || 'cost-update', language: req.query.lang || job.language },
    };
    const fakeRes = {
      json: (data) => {
        res.setHeader('Content-Type', 'text/html');
        res.send(data.html);
      },
      status: (code) => ({ json: (d) => res.status(code).json(d) }),
      setHeader: () => {},
      send: () => {},
    };
    // Find and call the POST handler on this router
    const postRoute = router.stack.find(
      r => r.route && r.route.path === '/api/jobs/:id/cost-update' && r.route.methods.post
    );
    if (!postRoute) return res.status(500).send('Handler not found');
    // The route has middleware (express.json) then the handler — call the last one
    const handlers = postRoute.route.stack;
    const handler = handlers[handlers.length - 1];
    await handler.handle(fakeReq, fakeRes, () => {});
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});

// ============================================================
// CHANGE ORDERS
// ============================================================

// Create a change order for a job
router.post('/api/jobs/:id/change-orders', express.json(), async (req, res) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const { titleEn, titleFr, description, items } = req.body;
    if (!titleEn) return res.status(400).json({ error: 'titleEn is required' });

    const now = new Date().toISOString();
    const id = uuidv4();
    const amountCents = (items || []).reduce((sum, i) => sum + (i.amountCents || 0), 0);

    await db.run(`
      INSERT INTO job_change_orders (id, job_id, title_en, title_fr, description, amount_cents, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)
    `, [id, job.id, titleEn, titleFr || titleEn, description || '', amountCents, now, now]);

    // Store items as JSON in description if provided
    if (items && items.length > 0) {
      const itemsJson = JSON.stringify(items);
      await db.run('UPDATE job_change_orders SET description = ? WHERE id = ?', [itemsJson, id]);
    }

    res.json({ id, amountCents, status: 'draft' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List change orders for a job
router.get('/api/jobs/:id/change-orders', async (req, res) => {
  try {
    const orders = await db.all('SELECT * FROM job_change_orders WHERE job_id = ? ORDER BY created_at', [req.params.id]);
    res.json(orders.map(o => {
      let items = [];
      try { items = JSON.parse(o.description); } catch(e) { items = o.description ? [{ description: o.description, amountCents: o.amount_cents }] : []; }
      return { ...o, items: Array.isArray(items) ? items : [items] };
    }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update change order status (approve/reject)
router.patch('/api/change-orders/:id', express.json(), async (req, res) => {
  try {
    const { status } = req.body;
    if (!['draft', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Status must be draft, approved, or rejected' });
    }
    const now = new Date().toISOString();
    const approvedAt = status === 'approved' ? now : null;
    await db.run('UPDATE job_change_orders SET status = ?, approved_at = ?, updated_at = ? WHERE id = ?', [status, approvedAt, now, req.params.id]);
    res.json({ ok: true, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Preview change order as HTML (mini-quote format)
router.get('/preview/change-order/:id', async (req, res) => {
  try {
    const co = await db.get('SELECT co.*, j.client_name, j.address, j.job_number, j.language FROM job_change_orders co JOIN jobs j ON j.id = co.job_id WHERE co.id = ?', [req.params.id]);
    if (!co) return res.status(404).send('Change order not found');

    const isFr = co.language === 'french';
    let items = [];
    try { items = JSON.parse(co.description); } catch(e) { items = []; }
    if (!Array.isArray(items)) items = [];

    const subtotal = co.amount_cents;
    const gst = Math.round(subtotal * 0.05);
    const qst = Math.round(subtotal * 0.09975);
    const total = subtotal + gst + qst;

    const html = `<!DOCTYPE html>
<html lang="${isFr ? 'fr' : 'en'}">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a2e; padding: 40px; max-width: 800px; margin: 0 auto; font-size: 13px; }
  .logo { text-align: center; margin-bottom: 24px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.2em; color: #666; }
  .title { text-align: center; font-size: 10px; text-transform: uppercase; letter-spacing: 0.15em; color: #666; margin-bottom: 20px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; border: 1px solid #1a1a2e; margin-bottom: 24px; }
  .info-cell { padding: 8px 12px; border-bottom: 1px solid #ddd; }
  .info-cell:nth-child(even) { border-left: 1px solid #ddd; }
  .info-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #666; }
  .info-value { font-weight: 600; }
  .section-title { font-weight: 700; padding: 8px 0; border-bottom: 1px solid #1a1a2e; margin-top: 12px; }
  .line-item { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f0f0f0; }
  .total-section { margin-top: 16px; border-top: 2px solid #1a1a2e; padding-top: 8px; }
  .total-row { display: flex; justify-content: flex-end; padding: 4px 0; }
  .total-row span:first-child { margin-right: 40px; }
  .total-row.grand { font-size: 15px; font-weight: 700; background: #1a1a2e; color: white; padding: 8px 12px; margin-top: 4px; }
  .approval { margin-top: 30px; border: 1px solid #ddd; padding: 16px; border-radius: 4px; }
  .approval h3 { font-size: 12px; text-transform: uppercase; margin-bottom: 10px; }
  .sig-line { border-bottom: 1px solid #999; height: 30px; margin-top: 20px; }
  .sig-label { font-size: 10px; color: #666; margin-top: 4px; }
  .footer { margin-top: 30px; text-align: center; font-size: 11px; color: #999; }
</style>
</head>
<body>
  <div class="logo">OSTÉOPEINTURE</div>
  <div class="title">${isFr ? 'AVENANT AU CONTRAT' : 'CHANGE ORDER'}</div>

  <div class="info-grid">
    <div class="info-cell"><span class="info-label">CLIENT</span><br><span class="info-value">${esc(co.client_name)}</span><br>${esc(co.address)}</div>
    <div class="info-cell"><span class="info-label">${isFr ? 'PROJET' : 'PROJECT'}</span><br><span class="info-value">${esc(co.job_number)}</span></div>
    <div class="info-cell"><span class="info-label">${isFr ? 'OBJET' : 'SUBJECT'}</span><br><span class="info-value">${esc(isFr ? co.title_fr : co.title_en)}</span></div>
    <div class="info-cell"><span class="info-label">DATE</span><br><span class="info-value">${co.created_at.slice(0, 10)}</span></div>
  </div>

  <div class="section-title">${isFr ? 'TRAVAUX ADDITIONNELS' : 'ADDITIONAL WORK'}</div>
  ${items.map(item => `
    <div class="line-item">
      <span>${esc(item.description || item.desc || '')}</span>
      <span style="font-weight:500">${((item.amountCents || 0) / 100).toLocaleString('fr-CA')} $</span>
    </div>
  `).join('')}

  <div class="total-section">
    <div class="total-row"><span>${isFr ? 'SOUS-TOTAL' : 'SUBTOTAL'}</span><span>${(subtotal / 100).toLocaleString('fr-CA')} $</span></div>
    <div class="total-row"><span>TPS (5%)</span><span>${(gst / 100).toLocaleString('fr-CA')} $</span></div>
    <div class="total-row"><span>TVQ (9.975%)</span><span>${(qst / 100).toLocaleString('fr-CA')} $</span></div>
    <div class="total-row grand"><span>TOTAL</span><span>${(total / 100).toLocaleString('fr-CA')} $</span></div>
  </div>

  <div class="approval">
    <h3>${isFr ? 'APPROBATION DU CLIENT' : 'CLIENT APPROVAL'}</h3>
    <p style="font-size:12px;color:#666">${isFr
      ? 'En signant ci-dessous, vous confirmez votre accord pour les travaux additionnels décrits ci-dessus et les coûts associés.'
      : 'By signing below, you confirm your agreement to the additional work described above and the associated costs.'}</p>
    <div class="sig-line"></div>
    <div class="sig-label">${isFr ? 'Signature du client' : 'Client Signature'} — Date: _______________</div>
  </div>

  <div class="footer">
    OstéoPeinture — 4201-80 rue Saint-Viateur E., Montréal, QC H2T 1A6<br>
    438-870-8087 | info@osteopeinture.com | www.osteopeinture.com
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});

// ============================================================
// INVOICE GENERATION
// ============================================================

// Generate invoice draft combining quote + time entries + change orders
// Returns an editable draft — user restructures sections before finalizing
router.post('/api/jobs/:id/invoices/generate', express.json(), async (req, res) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const { language, issueDate, notes, sections: customSections } = req.body || {};
    const lang = language || job.language || 'french';
    const isFr = lang === 'french';
    const now = new Date().toISOString();
    const invoiceId = uuidv4();

    const dateStr = (issueDate || now.slice(0, 10)).replace(/-/g, '');
    const existingCount = await db.get('SELECT COUNT(*) as c FROM invoices WHERE job_id = ?', [job.id]).c;
    const invoiceNumber = dateStr + '_' + String(existingCount + 1).padStart(2, '0');

    // === Build draft sections from all sources ===
    let draftSections = [];

    if (customSections) {
      // User provided pre-edited sections — use as-is
      draftSections = customSections;
    } else {
      // Auto-generate from quote + time entries

      // Source 1: Fixed-price items from accepted quote
      const quote = job.acceptedQuoteJson;
      if (quote && quote.sections) {
        for (const s of quote.sections) {
          draftSections.push({
            title: s.title,
            source: 'quote',
            items: (s.items || []).map(item => ({
              description: item.description,
              amount: item.price * 100,
              type: 'fixed',
            })),
            subtotalCents: (s.subtotal || 0) * 100,
          });
        }
      }

      // Source 2: Approved change orders
      const changeOrders = await db.all("SELECT * FROM job_change_orders WHERE job_id = ? AND status = 'approved' ORDER BY created_at", [job.id]);
      for (const co of changeOrders) {
        let coItems = [];
        try { coItems = JSON.parse(co.description); } catch(e) {}
        if (!Array.isArray(coItems)) coItems = [];
        const coTitle = isFr ? co.title_fr : co.title_en;
        draftSections.push({
          title: coTitle,
          source: 'change_order',
          changeOrderId: co.id,
          items: coItems.map(i => ({
            description: i.description || i.desc || coTitle,
            amount: i.amountCents || 0,
            type: 'change_order',
          })),
          subtotalCents: co.amount_cents,
        });
      }

      // Source 3: Hourly work from mapped time entries (not in quote)
      const timeEntries = await db.run(`
        SELECT mapped_label_en, mapped_label_fr, mapped_phase_code,
          SUM(billable_minutes) as total_minutes, employee_name
        FROM time_entries WHERE job_id = ? AND mapping_status = 'mapped' AND billable_minutes > 0
        GROUP BY mapped_label_en, mapped_label_fr, mapped_phase_code
        ORDER BY mapped_phase_code
      `, [job.id]);

      if (timeEntries.length > 0) {
        // Group time entries into one "Hourly Work" section
        // User can restructure this into multiple sections later
        const hourlyItems = [];
        for (const e of timeEntries) {
          const label = isFr ? (e.mapped_label_fr || e.mapped_label_en) : e.mapped_label_en;
          const hours = Math.round(e.total_minutes / 60 * 10) / 10;
          const rate = 55; // default billable rate — should come from job config
          const amount = Math.round(hours * rate * 100);
          hourlyItems.push({
            description: `${label} — ${hours}h @ $${rate}/h`,
            amount,
            type: 'hourly',
            hours,
            rate,
          });
        }
        if (hourlyItems.length > 0) {
          draftSections.push({
            title: isFr ? 'Travaux horaires' : 'Hourly Work',
            source: 'time_entries',
            items: hourlyItems,
            subtotalCents: hourlyItems.reduce((sum, i) => sum + i.amount, 0),
          });
        }
      }
    }

    // Calculate totals
    const subtotalCents = draftSections.reduce((sum, s) => sum + s.subtotalCents, 0);
    const gstCents = Math.round(subtotalCents * 0.05);
    const qstCents = Math.round(subtotalCents * 0.09975);
    const taxCents = gstCents + qstCents;
    const totalCents = subtotalCents + taxCents;

    // Get payments
    const payments = await getJobPayments(job.id);
    const totalPaidCents = payments.reduce((sum, p) => sum + p.amount_cents, 0);
    const balanceDueCents = totalCents - totalPaidCents;

    const invoiceJson = {
      invoiceNumber,
      jobNumber: job.job_number,
      clientName: job.client_name,
      address: job.address,
      language: lang,
      issueDate: issueDate || now.slice(0, 10),
      sections: draftSections,
      subtotalCents,
      gstCents,
      qstCents,
      taxCents,
      totalCents,
      payments: payments.map(p => ({
        date: p.payment_date,
        amount: p.amount_cents,
        method: p.method,
      })),
      totalPaidCents,
      balanceDueCents,
      notes: notes || '',
      isDraft: true,
    };

    await db.run(`
      INSERT INTO invoices (id, job_id, invoice_number, invoice_type, language, issue_date, status,
        subtotal_cents, tax_cents, total_cents, balance_due_cents, invoice_json, created_at, updated_at)
      VALUES (?, ?, ?, 'final', ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)
    `, [invoiceId, job.id, invoiceNumber, lang, invoiceJson.issueDate, subtotalCents, taxCents, totalCents, balanceDueCents, JSON.stringify(invoiceJson), now, now]);

    res.json({ invoiceId, invoiceNumber, invoiceJson });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update invoice sections (user edited the draft)
router.put('/api/invoices/:id', express.json(), async (req, res) => {
  try {
    const invoice = await db.get('SELECT * FROM invoices WHERE id = ?', [req.params.id]);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const existing = JSON.parse(invoice.invoice_json);
    const { sections, notes } = req.body;

    if (sections) {
      existing.sections = sections;
      existing.subtotalCents = sections.reduce((sum, s) => sum + (s.subtotalCents || 0), 0);
      existing.gstCents = Math.round(existing.subtotalCents * 0.05);
      existing.qstCents = Math.round(existing.subtotalCents * 0.09975);
      existing.taxCents = existing.gstCents + existing.qstCents;
      existing.totalCents = existing.subtotalCents + existing.taxCents;
      existing.balanceDueCents = existing.totalCents - existing.totalPaidCents;
    }
    if (notes !== undefined) existing.notes = notes;

    const now = new Date().toISOString();
    await db.run(`
      UPDATE invoices SET invoice_json = ?, subtotal_cents = ?, tax_cents = ?, total_cents = ?, balance_due_cents = ?, updated_at = ?
      WHERE id = ?
    `, [JSON.stringify(existing), existing.subtotalCents, existing.taxCents, existing.totalCents, existing.balanceDueCents, now, req.params.id]);

    res.json({ ok: true, invoiceJson: existing });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get invoices for a job
router.get('/api/jobs/:id/invoices', async (req, res) => {
  try {
    res.json(await db.all('SELECT * FROM invoices WHERE job_id = ? ORDER BY created_at DESC', [req.params.id]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Preview invoice as HTML
router.get('/preview/invoice/:id', async (req, res) => {
  try {
    const invoice = await db.get('SELECT * FROM invoices WHERE id = ?', [req.params.id]);
    if (!invoice) return res.status(404).send('Invoice not found');

    const inv = JSON.parse(invoice.invoice_json);
    const isFr = inv.language === 'french';

    // Use the editable sections (which may include quote + hourly + change orders)
    const sections = inv.sections || [];

    const html = `<!DOCTYPE html>
<html lang="${isFr ? 'fr' : 'en'}">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a2e; padding: 40px; max-width: 800px; margin: 0 auto; font-size: 13px; }
  .logo { text-align: center; margin-bottom: 30px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.2em; color: #666; }
  .title { text-align: center; font-size: 10px; text-transform: uppercase; letter-spacing: 0.15em; color: #666; margin-bottom: 20px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; border: 1px solid #1a1a2e; margin-bottom: 24px; }
  .info-cell { padding: 8px 12px; border-bottom: 1px solid #ddd; }
  .info-cell:nth-child(even) { border-left: 1px solid #ddd; }
  .info-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #666; }
  .info-value { font-weight: 600; }
  .section-title { font-weight: 700; padding: 8px 0 4px; border-bottom: 1px solid #1a1a2e; margin-top: 16px; }
  .line-item { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #f0f0f0; }
  .line-item-desc { flex: 1; padding-left: 12px; }
  .line-item-price { font-weight: 500; text-align: right; width: 80px; }
  .subtotal-row { display: flex; justify-content: flex-end; padding: 6px 0; font-weight: 600; }
  .subtotal-row span:first-child { margin-right: 40px; }
  .total-section { margin-top: 20px; border-top: 2px solid #1a1a2e; padding-top: 8px; }
  .total-row { display: flex; justify-content: flex-end; padding: 4px 0; }
  .total-row span:first-child { margin-right: 40px; }
  .total-row.grand { font-size: 16px; font-weight: 700; background: #1a1a2e; color: white; padding: 10px 12px; margin-top: 4px; }
  .payment-section { margin-top: 16px; }
  .payment-row { display: flex; justify-content: flex-end; padding: 3px 0; color: #666; }
  .payment-row span:first-child { margin-right: 40px; }
  .balance-row { display: flex; justify-content: flex-end; padding: 10px 0; font-size: 15px; font-weight: 700; border-top: 2px solid #1a1a2e; }
  .balance-row span:first-child { margin-right: 40px; }
  .footer { margin-top: 40px; text-align: center; font-size: 11px; color: #999; }
  .payment-terms { margin-top: 20px; text-align: center; font-size: 11px; color: #666; font-style: italic; }
</style>
</head>
<body>
  <div class="logo">OSTÉOPEINTURE</div>
  <div class="title">${isFr ? 'FACTURE' : 'INVOICE'}</div>

  <div class="info-grid">
    <div class="info-cell"><span class="info-label">${isFr ? 'FACTURÉ À' : 'BILLED TO'}</span><br><span class="info-value">${esc(inv.clientName)}</span><br>${esc(inv.address)}</div>
    <div class="info-cell"><span class="info-label">${isFr ? 'FACTURE #' : 'INVOICE #'}</span><br><span class="info-value">${esc(inv.invoiceNumber)}</span></div>
    <div class="info-cell"><span class="info-label">${isFr ? 'PROJET' : 'PROJECT'}</span><br><span class="info-value">${esc(inv.jobNumber)}</span></div>
    <div class="info-cell"><span class="info-label">DATE</span><br><span class="info-value">${esc(inv.issueDate)}</span></div>
  </div>

  ${sections.map(s => `
    <div class="section-title">${esc(s.title)}<span style="float:right">${((s.subtotalCents || 0) / 100).toLocaleString('fr-CA')} $</span></div>
    ${(s.items || []).map(item => `
      <div class="line-item">
        <span class="line-item-desc">${esc(item.description)}</span>
        <span class="line-item-price">${((item.amount || item.price * 100 || 0) / 100).toLocaleString('fr-CA')} $</span>
      </div>
    `).join('')}
  `).join('')}

  <div class="total-section">
    <div class="subtotal-row"><span>TOTAL</span><span>${(inv.subtotalCents / 100).toLocaleString('fr-CA')} $</span></div>
    <div class="total-row"><span>TPS #7784757551RT0001</span><span>${(inv.gstCents / 100).toLocaleString('fr-CA')} $</span></div>
    <div class="total-row"><span>TVQ #1231045518</span><span>${(inv.qstCents / 100).toLocaleString('fr-CA')} $</span></div>
    <div class="total-row grand"><span>GRAND TOTAL</span><span>${(inv.totalCents / 100).toLocaleString('fr-CA')} $</span></div>
  </div>

  ${inv.payments.length > 0 ? `
  <div class="payment-section">
    ${inv.payments.map(p => `
      <div class="payment-row"><span>${isFr ? 'Paiement' : 'Payment'} ${p.date} (${p.method})</span><span>-${(p.amount / 100).toLocaleString('fr-CA')} $</span></div>
    `).join('')}
    <div class="balance-row"><span>${isFr ? 'SOLDE À PAYER' : 'BALANCE TO PAY'}</span><span>${(inv.balanceDueCents / 100).toLocaleString('fr-CA')} $</span></div>
  </div>` : ''}

  <div class="payment-terms">${isFr ? 'Le solde restant est payable par chèque, dépôt direct, virement Interac ou comptant.' : 'The remaining balance is to be paid by cheque, direct deposit, e-transfer or cash.'}</div>

  <div class="footer">
    OstéoPeinture — 4201-80 rue Saint-Viateur E., Montréal, QC H2T 1A6<br>
    438-870-8087 | info@osteopeinture.com | www.osteopeinture.com<br>
    RBQ# 5790-0045-01
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});

// Generate invoice PDF
router.post('/api/invoices/:id/pdf', async (req, res) => {
  try {
    const invoice = await db.get('SELECT * FROM invoices WHERE id = ?', [req.params.id]);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const { chromium } = require('playwright');
    const browser = await chromium.launch({ args: ['--no-sandbox'] });
    const page = await browser.newPage();

    const protocol = req.protocol;
    const host = req.get('host');
    await page.goto(`${protocol}://${host}/preview/invoice/${req.params.id}`, { waitUntil: 'networkidle' });

    const pdfBuffer = await page.pdf({
      format: 'Letter',
      margin: { top: '0.4in', bottom: '0.4in', left: '0.5in', right: '0.5in' },
      printBackground: true,
    });

    await browser.close();

    const inv = JSON.parse(invoice.invoice_json);
    const filename = `${inv.jobNumber}_invoice_${inv.invoiceNumber}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// CLIENT UPDATE GENERATION
// ============================================================

// Generate a client update summary from mapped time entries
router.post('/api/jobs/:id/updates/generate', express.json(), async (req, res) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const { periodStart, periodEnd, language, notes } = req.body || {};
    const lang = language || job.language || 'french';

    // Get mapped time entries for this period
    let query = `SELECT * FROM time_entries WHERE job_id = ? AND mapping_status = 'mapped'`;
    const params = [job.id];
    if (periodStart) { query += ' AND work_date >= ?'; params.push(periodStart); }
    if (periodEnd) { query += ' AND work_date <= ?'; params.push(periodEnd); }
    query += ' ORDER BY mapped_phase_code, source_activity_name, employee_name';

    const entries = await db.all(query, params);

    if (entries.length === 0) {
      return res.status(400).json({ error: 'No mapped time entries found for this period' });
    }

    // Aggregate by activity label
    const activities = {};
    let totalMinutes = 0;
    let totalBillableMinutes = 0;

    for (const e of entries) {
      const label = lang === 'french' ? (e.mapped_label_fr || e.source_activity_name) : (e.mapped_label_en || e.source_activity_name);
      if (!activities[label]) {
        activities[label] = { label, phase: e.mapped_phase_code, totalMinutes: 0, billableMinutes: 0, workers: {} };
      }
      activities[label].totalMinutes += e.duration_minutes;
      activities[label].billableMinutes += e.billable_minutes;
      totalMinutes += e.duration_minutes;
      totalBillableMinutes += e.billable_minutes;

      // Track per worker
      if (!activities[label].workers[e.employee_name]) {
        activities[label].workers[e.employee_name] = 0;
      }
      activities[label].workers[e.employee_name] += e.duration_minutes;
    }

    // Build summary
    const sections = Object.values(activities).map(a => ({
      label: a.label,
      phase: a.phase,
      hours: Math.round(a.totalMinutes / 60 * 10) / 10,
      billableHours: Math.round(a.billableMinutes / 60 * 10) / 10,
      workers: Object.entries(a.workers).map(([name, mins]) => ({
        name, hours: Math.round(mins / 60 * 10) / 10
      })),
    }));

    // Get payments for context
    const payments = await getJobPayments(job.id);
    const totalPaidCents = payments.reduce((sum, p) => sum + p.amount_cents, 0);

    const now = new Date().toISOString();
    const sequenceNo = await db.get('SELECT COUNT(*) as count FROM client_updates WHERE job_id = ?', [job.id]).count + 1;
    const updateId = uuidv4();

    const summary = {
      jobNumber: job.job_number,
      clientName: job.client_name,
      address: job.address,
      language: lang,
      periodStart: periodStart || entries[0].work_date,
      periodEnd: periodEnd || entries[entries.length - 1].work_date,
      sequenceNo,
      sections,
      totalHours: Math.round(totalMinutes / 60 * 10) / 10,
      totalBillableHours: Math.round(totalBillableMinutes / 60 * 10) / 10,
      quoteTotalCents: job.quote_total_cents,
      totalPaidCents,
      balanceRemainingCents: job.quote_total_cents - totalPaidCents,
      notes: notes || '',
      generatedAt: now,
    };

    // Save the update record
    await db.run(`
      INSERT INTO client_updates (id, job_id, sequence_no, language, period_start, period_end, status, summary_json, html_snapshot, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, '', ?, ?)
    `, [updateId, job.id, sequenceNo, lang, summary.periodStart, summary.periodEnd, JSON.stringify(summary), now, now]);

    res.json({ updateId, summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all updates for a job
router.get('/api/jobs/:id/updates', async (req, res) => {
  try {
    const updates = await db.all('SELECT * FROM client_updates WHERE job_id = ? ORDER BY sequence_no DESC', [req.params.id]);
    res.json(updates.map(u => ({
      ...u,
      summaryJson: u.summary_json ? JSON.parse(u.summary_json) : null,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Preview a client update as HTML
router.get('/preview/update/:id', async (req, res) => {
  try {
    const update = await db.get('SELECT * FROM client_updates WHERE id = ?', [req.params.id]);
    if (!update) return res.status(404).send('Update not found');

    const summary = JSON.parse(update.summary_json);
    const isFr = summary.language === 'french';

    const html = `<!DOCTYPE html>
<html lang="${isFr ? 'fr' : 'en'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a2e; padding: 40px; max-width: 800px; margin: 0 auto; }
  .header { border-bottom: 2px solid #1a1a2e; padding-bottom: 16px; margin-bottom: 24px; }
  .header h1 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.15em; color: #666; margin-bottom: 4px; }
  .header h2 { font-size: 22px; margin-bottom: 8px; }
  .meta { display: flex; gap: 24px; font-size: 12px; color: #666; }
  .section { margin-bottom: 20px; }
  .section h3 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.1em; color: #666; border-bottom: 1px solid #ddd; padding-bottom: 6px; margin-bottom: 10px; }
  .activity-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f0f0f0; font-size: 14px; }
  .activity-label { flex: 1; }
  .activity-hours { font-weight: 600; text-align: right; width: 80px; }
  .total-row { display: flex; justify-content: space-between; padding: 10px 0; font-weight: 700; font-size: 15px; border-top: 2px solid #1a1a2e; margin-top: 8px; }
  .notes { margin-top: 20px; padding: 12px; background: #f8f8f8; border-radius: 4px; font-size: 13px; line-height: 1.5; white-space: pre-wrap; }
  .financial { margin-top: 20px; font-size: 13px; color: #666; }
  .financial-row { display: flex; justify-content: space-between; padding: 4px 0; }
  .footer { margin-top: 40px; text-align: center; font-size: 11px; color: #999; }
</style>
</head>
<body>
  <div class="header">
    <h1>OSTÉOPEINTURE</h1>
    <h2>${isFr ? 'MISE À JOUR — ' : 'PROJECT UPDATE — '}${esc(summary.clientName)}</h2>
    <div class="meta">
      <span>${isFr ? 'Projet' : 'Project'}: ${esc(summary.jobNumber)}</span>
      <span>${isFr ? 'Période' : 'Period'}: ${summary.periodStart} — ${summary.periodEnd}</span>
      <span>${isFr ? 'Mise à jour' : 'Update'} #${summary.sequenceNo}</span>
    </div>
  </div>

  <div class="section">
    <h3>${isFr ? 'TRAVAUX EFFECTUÉS' : 'WORK COMPLETED'}</h3>
    ${summary.sections.map(s => `
      <div class="activity-row">
        <span class="activity-label">${esc(s.label)}</span>
        <span class="activity-hours">${s.billableHours}h</span>
      </div>
    `).join('')}
    <div class="total-row">
      <span>${isFr ? 'TOTAL HEURES' : 'TOTAL HOURS'}</span>
      <span>${summary.totalBillableHours}h</span>
    </div>
  </div>

  ${summary.notes ? `<div class="notes"><strong>${isFr ? 'Notes :' : 'Notes:'}</strong>\n${esc(summary.notes)}</div>` : ''}

  <div class="financial">
    <div class="financial-row"><span>${isFr ? 'Total soumission' : 'Quote total'}</span><span>$${(summary.quoteTotalCents / 100).toLocaleString('fr-CA')}</span></div>
    <div class="financial-row"><span>${isFr ? 'Payé à ce jour' : 'Paid to date'}</span><span>$${(summary.totalPaidCents / 100).toLocaleString('fr-CA')}</span></div>
    <div class="financial-row" style="font-weight:600"><span>${isFr ? 'Solde restant' : 'Balance remaining'}</span><span>$${(summary.balanceRemainingCents / 100).toLocaleString('fr-CA')}</span></div>
  </div>

  <div class="footer">
    OstéoPeinture — 4201-80 rue Saint-Viateur E., Montréal, QC H2T 1A6<br>
    438-870-8087 | info@osteopeinture.com | www.osteopeinture.com
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});

// Generate PDF from client update
router.post('/api/updates/:id/pdf', async (req, res) => {
  try {
    const update = await db.get('SELECT * FROM client_updates WHERE id = ?', [req.params.id]);
    if (!update) return res.status(404).json({ error: 'Update not found' });

    const { chromium } = require('playwright');
    const browser = await chromium.launch({ args: ['--no-sandbox'] });
    const page = await browser.newPage();

    // Render the preview HTML
    const protocol = req.protocol;
    const host = req.get('host');
    await page.goto(`${protocol}://${host}/preview/update/${req.params.id}`, { waitUntil: 'networkidle' });

    const pdfBuffer = await page.pdf({
      format: 'Letter',
      margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' },
      printBackground: true,
    });

    await browser.close();

    const summary = JSON.parse(update.summary_json);
    const filename = `${summary.jobNumber}_update_${summary.sequenceNo}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, init };
