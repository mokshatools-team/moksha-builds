// ── COST UPDATE / INVOICE EDITOR ─────────────────────────────

async function openCostUpdate(jobId, docType) {
  try {
    const res = await fetch('/api/jobs/' + jobId);
    if (!res.ok) { alert('Failed to load job'); return; }
    const job = await res.json();
    const quoteJson = job.accepted_quote_json
      ? (typeof job.accepted_quote_json === 'string' ? JSON.parse(job.accepted_quote_json) : job.accepted_quote_json)
      : null;
    const jobSections = job.job_sections
      ? (typeof job.job_sections === 'string' ? JSON.parse(job.job_sections) : job.job_sections)
      : {};

    // Load saved overrides if they exist, otherwise use accepted quote
    const saved = jobSections.invoiceOverrides;
    let sections, paints;
    if (saved) {
      sections = JSON.parse(JSON.stringify(saved.sections || []));
      paints = JSON.parse(JSON.stringify(saved.paints || []));
    } else {
      sections = [];
      if (quoteJson && quoteJson.sections) {
        for (const sec of quoteJson.sections) {
          if (sec.excluded || sec.optional) continue;
          sections.push(JSON.parse(JSON.stringify(sec)));
        }
      }
      paints = quoteJson && quoteJson.paints ? JSON.parse(JSON.stringify(quoteJson.paints)) : [];
    }

    invoiceEditorState = { jobId, jobNumber: job.job_number || jobId.slice(0,8), docType: docType || 'cost-update', sections, paints, jobSectionsRaw: jobSections };
    const dt = docType || 'cost-update';
    document.getElementById('invoice-editor-title').textContent =
      dt === 'invoice' ? 'Invoice Editor' : 'Cost Update Editor';
    renderInvoiceEditor();
    document.getElementById('invoice-editor-modal').style.display = 'flex';
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

function closeInvoiceEditor() {
  document.getElementById('invoice-editor-modal').style.display = 'none';
}

function renderInvoiceEditor() {
  const body = document.getElementById('invoice-editor-body');
  const secs = invoiceEditorState.sections;
  const paints = invoiceEditorState.paints;
  let subtotal = 0;
  let html = '';

  // ── Sections ──
  html += '<div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-3);margin-bottom:6px;">Sections</div>';
  for (let si = 0; si < secs.length; si++) {
    const sec = secs[si];
    const secTitle = sec.name || sec.title || sec.floor || 'Section ' + (si + 1);
    const secTotal = sec.total || 0;
    subtotal += secTotal;
    html += '<div style="margin-bottom:12px;border:1px solid var(--border);border-radius:6px;padding:10px 12px;background:var(--surface-1);">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">';
    html += '<input value="' + esc(secTitle) + '" onchange="invoiceEditorUpdateSection(' + si + ',\'title\',this.value)" style="flex:1;background:transparent;border:none;font-size:13px;font-weight:700;color:var(--text);font-family:var(--font-sans);padding:2px 0;" />';
    html += '<div style="display:flex;align-items:center;gap:6px;">';
    html += '<span style="font-size:12px;font-weight:700;color:var(--text);white-space:nowrap;">' + secTotal.toLocaleString('fr-CA') + ' $</span>';
    html += '<button onclick="invoiceEditorRemoveSection(' + si + ')" style="background:transparent;border:none;color:#c94a4a;cursor:pointer;font-size:13px;padding:2px 4px;" title="Remove">✕</button>';
    html += '</div></div>';
    const items = sec.items || [];
    for (let ii = 0; ii < items.length; ii++) {
      const item = items[ii];
      html += '<div style="display:flex;gap:6px;align-items:center;margin-bottom:3px;padding-left:6px;">';
      html += '<input value="' + esc(item.description || '') + '" onchange="invoiceEditorUpdateItem(' + si + ',' + ii + ',\'description\',this.value)" style="flex:1;background:var(--surface-0);border:1px solid var(--border-soft);border-radius:4px;padding:4px 8px;font-size:12px;color:var(--text);font-family:var(--font-sans);" />';
      html += '<input type="number" value="' + (item.price || 0) + '" onchange="invoiceEditorUpdateItem(' + si + ',' + ii + ',\'price\',Number(this.value))" style="width:75px;background:var(--surface-0);border:1px solid var(--border-soft);border-radius:4px;padding:4px 6px;font-size:12px;color:var(--text);text-align:right;font-family:var(--font-mono);" />';
      html += '<button onclick="invoiceEditorRemoveItem(' + si + ',' + ii + ')" style="background:transparent;border:none;color:#c94a4a;cursor:pointer;font-size:11px;padding:2px;">✕</button>';
      html += '</div>';
    }
    html += '<button onclick="invoiceEditorAddItem(' + si + ')" style="margin-top:3px;margin-left:6px;background:transparent;border:none;color:var(--text-3);cursor:pointer;font-size:11px;padding:2px 0;">+ item</button>';
    html += '<div style="display:flex;justify-content:flex-end;align-items:center;gap:6px;margin-top:4px;padding-top:4px;border-top:1px solid var(--border-soft);">';
    html += '<span style="font-size:11px;color:var(--text-3);">Total:</span>';
    html += '<input type="number" value="' + secTotal + '" onchange="invoiceEditorUpdateSection(' + si + ',\'total\',Number(this.value))" style="width:85px;background:var(--surface-0);border:1px solid var(--border-soft);border-radius:4px;padding:4px 6px;font-size:12px;color:var(--text);text-align:right;font-family:var(--font-mono);" />';
    html += '</div></div>';
  }
  html += '<div style="text-align:right;font-size:14px;font-weight:700;color:var(--text);padding:4px 0;margin-bottom:16px;">Subtotal: ' + subtotal.toLocaleString('fr-CA') + ' $</div>';

  // ── Paints ──
  if (paints.length > 0 || invoiceEditorState.docType === 'invoice') {
    html += '<div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-3);margin-bottom:6px;">Paint &amp; Products</div>';
    for (let pi = 0; pi < paints.length; pi++) {
      const p = paints[pi];
      html += '<div style="display:flex;gap:6px;align-items:center;margin-bottom:4px;border:1px solid var(--border-soft);border-radius:4px;padding:6px 8px;background:var(--surface-1);">';
      html += '<input value="' + esc(p.type || '') + '" onchange="invoiceEditorUpdatePaint(' + pi + ',\'type\',this.value)" placeholder="Zone" style="width:25%;background:var(--surface-0);border:1px solid var(--border-soft);border-radius:4px;padding:3px 6px;font-size:11px;color:var(--text);" />';
      html += '<input value="' + esc(p.product || '') + '" onchange="invoiceEditorUpdatePaint(' + pi + ',\'product\',this.value)" placeholder="Product" style="width:25%;background:var(--surface-0);border:1px solid var(--border-soft);border-radius:4px;padding:3px 6px;font-size:11px;color:var(--text);" />';
      html += '<input value="' + esc(p.color || '') + '" onchange="invoiceEditorUpdatePaint(' + pi + ',\'color\',this.value)" placeholder="Color" style="flex:1;background:var(--surface-0);border:1px solid var(--border-soft);border-radius:4px;padding:3px 6px;font-size:11px;color:var(--text);" />';
      html += '<input value="' + esc(p.finish || '') + '" onchange="invoiceEditorUpdatePaint(' + pi + ',\'finish\',this.value)" placeholder="Finish" style="width:60px;background:var(--surface-0);border:1px solid var(--border-soft);border-radius:4px;padding:3px 6px;font-size:11px;color:var(--text);" />';
      html += '<button onclick="invoiceEditorRemovePaint(' + pi + ')" style="background:transparent;border:none;color:#c94a4a;cursor:pointer;font-size:11px;padding:2px;">✕</button>';
      html += '</div>';
    }
    html += '<button onclick="invoiceEditorAddPaint()" style="margin-top:3px;background:transparent;border:none;color:var(--text-3);cursor:pointer;font-size:11px;padding:2px 0;">+ product</button>';
  }

  body.innerHTML = html;
}

function invoiceEditorUpdateSection(si, field, value) {
  const sec = invoiceEditorState.sections[si];
  if (field === 'title') {
    if (sec.name) sec.name = value;
    else if (sec.title) sec.title = value;
    else sec.title = value;
  } else if (field === 'total') {
    sec.total = value;
  }
  renderInvoiceEditor();
}

function invoiceEditorUpdateItem(si, ii, field, value) {
  invoiceEditorState.sections[si].items[ii][field] = value;
  const sec = invoiceEditorState.sections[si];
  const itemSum = (sec.items || []).reduce((s, i) => s + (i.price || 0), 0);
  if (itemSum > 0) sec.total = itemSum;
  renderInvoiceEditor();
}

function invoiceEditorRemoveSection(si) {
  invoiceEditorState.sections.splice(si, 1);
  renderInvoiceEditor();
}

function invoiceEditorRemoveItem(si, ii) {
  const sec = invoiceEditorState.sections[si];
  sec.items.splice(ii, 1);
  const itemSum = (sec.items || []).reduce((s, i) => s + (i.price || 0), 0);
  if (itemSum > 0) sec.total = itemSum;
  renderInvoiceEditor();
}

function invoiceEditorAddItem(si) {
  if (!invoiceEditorState.sections[si].items) invoiceEditorState.sections[si].items = [];
  invoiceEditorState.sections[si].items.push({ description: '', price: 0 });
  renderInvoiceEditor();
}

function invoiceEditorAddSection() {
  invoiceEditorState.sections.push({ title: 'New Section', total: 0, items: [{ description: '', price: 0 }] });
  renderInvoiceEditor();
}

function invoiceEditorUpdatePaint(pi, field, value) {
  invoiceEditorState.paints[pi][field] = value;
}

function invoiceEditorRemovePaint(pi) {
  invoiceEditorState.paints.splice(pi, 1);
  renderInvoiceEditor();
}

function invoiceEditorAddPaint() {
  invoiceEditorState.paints.push({ type: '', product: '', color: '', finish: '', approxQty: '', approxCost: 0 });
  renderInvoiceEditor();
}

async function invoiceEditorReset() {
  if (!confirm('Reset all changes to original quote values?')) return;
  const jobId = invoiceEditorState.jobId;
  const res = await fetch('/api/jobs/' + jobId);
  if (!res.ok) return;
  const job = await res.json();
  const quoteJson = job.accepted_quote_json
    ? (typeof job.accepted_quote_json === 'string' ? JSON.parse(job.accepted_quote_json) : job.accepted_quote_json)
    : null;
  const sections = [];
  if (quoteJson && quoteJson.sections) {
    for (const sec of quoteJson.sections) {
      if (sec.excluded || sec.optional) continue;
      sections.push(JSON.parse(JSON.stringify(sec)));
    }
  }
  const paints = quoteJson && quoteJson.paints ? JSON.parse(JSON.stringify(quoteJson.paints)) : [];
  invoiceEditorState.sections = sections;
  invoiceEditorState.paints = paints;
  // Clear saved overrides
  const jobSections = { ...invoiceEditorState.jobSectionsRaw };
  delete jobSections.invoiceOverrides;
  invoiceEditorState.jobSectionsRaw = jobSections;
  await fetch('/api/jobs/' + jobId, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobSections: JSON.stringify(jobSections) }),
  });
  renderInvoiceEditor();
}

async function saveInvoiceOverrides() {
  const { jobId, sections, paints, jobSectionsRaw } = invoiceEditorState;
  const updated = { ...jobSectionsRaw, invoiceOverrides: { sections, paints } };
  const payload = { jobSections: JSON.stringify(updated) };
  console.log('[invoice-editor] saving overrides for job', jobId, 'keys:', Object.keys(updated));
  const resp = await fetch('/api/jobs/' + jobId, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    console.error('[invoice-editor] save failed:', resp.status, errText);
    alert('Save failed: ' + resp.status);
  } else {
    console.log('[invoice-editor] save OK');
  }
}

async function downloadInvoicePDF(btn) {
  try {
    const { jobId, docType, sections, paints } = invoiceEditorState;
    await saveInvoiceOverrides();
    if (btn) { btn.textContent = 'Generating...'; btn.disabled = true; }
    const res = await fetch('/api/jobs/' + jobId + '/cost-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docType, customSections: sections, customPaints: paints, format: 'pdf' }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => 'Unknown error');
      alert('PDF generation failed: ' + errText);
      if (btn) { btn.textContent = 'Download PDF'; btn.disabled = false; }
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    // iOS Safari doesn't support <a download> — open in new tab instead
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIOS) {
      window.open(url, '_blank');
    } else {
      const a = document.createElement('a');
      a.href = url;
      const jn = invoiceEditorState.jobNumber;
      a.download = jn + ' - ' + (docType === 'invoice' ? 'Invoice' : 'Cost Update') + '.pdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
    // Don't revoke immediately on iOS — the new tab needs time to load
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    if (btn) { btn.textContent = 'Download PDF'; btn.disabled = false; }
  } catch (err) {
    alert('PDF error: ' + err.message);
    if (btn) { btn.textContent = 'Download PDF'; btn.disabled = false; }
  }
}

async function emailInvoice() {
  const { jobId } = invoiceEditorState;
  closeInvoiceEditor();
  openStandaloneEmail(jobId);
}

async function generateFromEditor() {
  try {
    const { jobId, docType, sections, paints } = invoiceEditorState;
    // Save edits to the job first
    await saveInvoiceOverrides();
    // Generate the document
    const res = await fetch('/api/jobs/' + jobId + '/cost-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docType, customSections: sections, customPaints: paints }),
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Failed'); return; }
    const w = window.open('', '_blank');
    if (w) { w.document.write(data.html); w.document.close(); }
    else { alert('Popup blocked — allow popups for this site.'); }
    closeInvoiceEditor();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}
