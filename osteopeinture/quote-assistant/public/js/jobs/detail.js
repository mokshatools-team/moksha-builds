// ── JOB DETAIL ──────────────────────────────────────

function toggleJobsView() {
  const jobsPanel = document.getElementById('jobs-panel');
  const isVisible = jobsPanel.classList.contains('visible');
  if (isVisible) {
    jobsPanel.classList.remove('visible');
    document.getElementById('job-detail').classList.remove('visible');
  } else {
    jobsPanel.classList.add('visible');
    loadJobs();
  }
}

function renderJobCard(j) {
  const isCash = j.payment_type === 'cash';
  const effectiveTotal = isCash && j.agreed_total_cents ? j.agreed_total_cents : j.quote_total_cents;
  const total = (effectiveTotal / 100).toLocaleString('fr-CA', {maximumFractionDigits:0});
  const paid = ((j.total_paid_cents || 0) / 100).toLocaleString('fr-CA', {maximumFractionDigits:0});
  const balance = ((effectiveTotal - (j.total_paid_cents || 0)) / 100).toLocaleString('fr-CA', {maximumFractionDigits:0});
  const typeLabel = isCash ? ' · CASH' : '';
  // Lead with the project ID — it's the primary identifier Loric uses
  return `<div class="job-card" onclick="openJobDetail('${j.id}','dashboard')">
    <div class="job-card-header">
      <span class="job-card-client">${esc(j.job_number)}</span>
      <span class="job-card-status ${j.status}">${j.status}${typeLabel}</span>
    </div>
    <div class="job-card-address">${esc(j.client_name)} — ${esc(j.address)}</div>
    <div class="job-card-footer">
      <span>Paid: $${paid} / $${total}</span>
      <span class="job-card-amount">Balance: $${balance}</span>
    </div>
  </div>`;
}

function jobsSectionHeader(label, count) {
  return `<div style="padding:14px 4px 6px;font-size:10px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--text-4);font-family:var(--font-sans)">${label} <span style="color:var(--text-3);font-weight:500">(${count})</span></div>`;
}

async function loadJobs() {
  const list = document.getElementById('jobs-list');
  list.innerHTML = '<div style="text-align:center;color:var(--text-3);padding:20px">Loading jobs...</div>';
  try {
    const jobs = await fetchJobs();
    if (jobs.length === 0) {
      list.innerHTML = '<div style="text-align:center;color:var(--text-3);padding:40px 20px"><p>No jobs yet.</p><p style="font-size:12px;margin-top:8px">Convert a quote to a job to get started.</p></div>';
      return;
    }
    const buckets = { active: [], upcoming: [], past: [] };
    for (const j of jobs) buckets[classifyJob(j)].push(j);
    // Sort: active by updated_at desc; upcoming by start_date asc (soonest first); past by completion_date desc
    buckets.active.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    buckets.upcoming.sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''));
    buckets.past.sort((a, b) => (b.completion_date || b.updated_at || '').localeCompare(a.completion_date || a.updated_at || ''));

    let html = '';
    if (buckets.active.length) html += jobsSectionHeader('Active', buckets.active.length) + buckets.active.map(renderJobCard).join('');
    if (buckets.upcoming.length) html += jobsSectionHeader('Upcoming', buckets.upcoming.length) + buckets.upcoming.map(renderJobCard).join('');
    if (buckets.past.length) html += jobsSectionHeader('Past', buckets.past.length) + buckets.past.map(renderJobCard).join('');
    list.innerHTML = html;
  } catch (err) {
    list.innerHTML = '<div style="color:var(--accent);padding:20px">Error loading jobs: ' + esc(err.message) + '</div>';
  }
}

function renderJobAttachments(attachments) {
  if (!attachments || !attachments.length) return '';
  let html = '<div style="margin-bottom:20px;">';
  html += '<h3 style="font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-2);margin-bottom:8px;font-family:var(--font-sans)">Attachments</h3>';
  html += '<div style="display:flex;flex-wrap:wrap;gap:6px">';
  for (const f of attachments) {
    html += '<a href="' + esc(f.public_url) + '" target="_blank" style="display:block;border-radius:4px;overflow:hidden;border:1px solid var(--border)">';
    html += '<img src="' + esc(f.public_url) + '" style="height:64px;width:auto;display:block" alt="' + esc(f.original_name) + '">';
    html += '</a>';
  }
  html += '</div></div>';
  return html;
}

function viewJobQuote(sessionId, jobId) {
  const content = document.getElementById('job-detail-content');
  const title = document.getElementById('job-detail-title');
  const prevTitle = title.textContent;
  title.textContent = 'Quote Preview';
  content.innerHTML = '<div style="margin-bottom:12px"><button onclick="openJobDetail(\'' + jobId + '\')" style="background:transparent;border:1px solid var(--border);color:var(--text-2);border-radius:4px;padding:6px 12px;font-size:12px;cursor:pointer;font-family:var(--font-sans)">← Back to Job</button></div><iframe src="/preview/' + sessionId + '" style="width:100%;height:calc(100vh - 120px);border:none;border-radius:6px;background:#fff"></iframe>';
}

async function uploadJobPhotos(jobId, fileList) {
  if (!fileList || !fileList.length) return;
  const formData = new FormData();
  for (const f of fileList) formData.append('images', f);
  try {
    const res = await fetch('/api/jobs/' + jobId + '/attachments', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Upload failed'); return; }
    // Refresh attachments in the job detail
    const attRes = await fetch('/api/jobs/' + jobId + '/attachments');
    const files = await attRes.json();
    const el = document.getElementById('job-attachments-container');
    if (el) el.innerHTML = renderJobAttachments(files);
  } catch (e) { alert('Error: ' + e.message); }
}

function renderChangeOrders(orders) {
  if (!orders || !orders.length) return '';
  let html = '<div style="margin-bottom:20px;">';
  html += '<h3 style="font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-2);margin-bottom:8px;font-family:var(--font-sans)">Change Orders</h3>';
  for (const co of orders) {
    const amt = (co.amount_cents / 100).toLocaleString('fr-CA', {maximumFractionDigits:0});
    const statusColor = co.status === 'approved' ? 'var(--sage)' : (co.status === 'rejected' ? '#c94a4a' : 'var(--text-3)');
    const statusBg = co.status === 'approved' ? 'var(--sage-dim)' : (co.status === 'rejected' ? 'rgba(201,74,74,0.1)' : 'var(--surface-2)');
    html += '<div style="background:var(--surface-1);border:1px solid var(--border);border-radius:6px;padding:10px 12px;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;gap:8px">';
    html += '<div style="flex:1;min-width:0">';
    html += '<div style="font-size:13px;font-weight:600;color:var(--text);font-family:var(--font-sans)">' + esc(co.title_en || co.title_fr || 'Change order') + '</div>';
    html += '<div style="font-size:11px;color:var(--text-3);margin-top:2px">' + (co.created_at ? co.created_at.slice(0,10) : '') + '</div>';
    html += '</div>';
    html += '<div style="font-size:14px;font-weight:600;color:var(--text);white-space:nowrap">$' + amt + '</div>';
    html += '<span style="font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;padding:2px 6px;border-radius:3px;background:' + statusBg + ';color:' + statusColor + '">' + co.status + '</span>';
    html += '<a href="/preview/change-order/' + co.id + '" target="_blank" style="font-size:11px;color:var(--accent);text-decoration:none;white-space:nowrap">view</a>';
    html += '</div>';
  }
  html += '</div>';
  return html;
}

// Tracks how the job-detail was opened so closeJobDetail() can return to the
// right surface. Set by the entry-point onclicks ('dashboard' from job cards,
// 'sidebar' from sidebar items). Internal refresh calls (after save, sync,
// etc.) omit the param so the existing source is preserved.
async function openJobDetail(jobId, source) {
  if (source) jobOpenedFrom = source;
  currentJobId = jobId;
  const detail = document.getElementById('job-detail');
  const content = document.getElementById('job-detail-content');
  const title = document.getElementById('job-detail-title');
  detail.classList.add('visible');
  content.innerHTML = '<div style="text-align:center;color:var(--text-3);padding:20px">Loading...</div>';

  try {
    const res = await fetch('/api/jobs/' + jobId);
    const job = await res.json();
    title.textContent = job.job_number || job.client_name;
    title.style.cursor = 'pointer';
    title.title = 'Tap to rename';
    title.contentEditable = false;
    title.onclick = () => {
      title.contentEditable = true;
      title.focus();
      // Select all text
      const range = document.createRange();
      range.selectNodeContents(title);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    };
    title.onblur = async () => {
      title.contentEditable = false;
      const newName = title.textContent.trim();
      if (!newName || newName === job.job_number) {
        title.textContent = job.job_number || job.client_name;
        return;
      }
      try {
        await fetch('/api/jobs/' + jobId, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ job_number: newName }),
        });
        job.job_number = newName;
        invalidateJobsCache();
        loadJobsSidebar();
        loadJobs();
      } catch (e) { title.textContent = job.job_number; }
    };
    title.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } };

    const isCash = job.payment_type === 'cash';
    const effectiveTotal = (job.effectiveTotalCents || job.quote_total_cents || 0) / 100;
    const paid = (job.totalPaidCents / 100);
    const balance = (job.balanceRemainingCents / 100);

    // Parse sections — simple text strings per section, not arrays
    const sec = job.job_sections ? (typeof job.job_sections === 'string' ? JSON.parse(job.job_sections) : job.job_sections) : {};

    function sectionTextarea(key, label, placeholder) {
      const val = sec[key] || '';
      const hasContent = val.trim().length > 0;
      return `
        <div style="margin-bottom:16px;" data-section-wrapper="${key}">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;cursor:pointer" onclick="toggleJobSection('${key}')">
            <div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);font-family:var(--font-sans)">${label}</div>
            <button data-section-toggle="${key}" style="background:transparent;border:none;color:var(--text-3);font-size:16px;font-weight:600;cursor:pointer;padding:0 4px;font-family:var(--font-sans);line-height:1">−</button>
          </div>
          <textarea data-section-key="${key}" data-job-id="${job.id}" onblur="saveJobSection(this)"
            oninput="autoExpandSection(this)"
            placeholder="${placeholder || ''}"
            style="width:100%;min-height:40px;padding:10px;background:var(--surface-1);border:1px solid var(--border);border-radius:6px;color:var(--text);font-family:var(--font-sans);font-size:13px;line-height:1.5;resize:none;box-sizing:border-box;overflow:hidden">${esc(val)}</textarea>
        </div>`;
    }

    content.innerHTML = `
      <!-- HEADER: editable client info -->
      <div style="padding:0 0 14px;border-bottom:1px solid var(--border-soft);margin-bottom:14px;font-size:13px;color:var(--text-2);line-height:1.6">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">
          <input type="text" value="${esc(job.address || '')}" placeholder="Address" data-field="address" data-job-id="${job.id}" onblur="saveJobField(this)" style="flex:1;padding:4px 8px;background:transparent;border:1px solid transparent;border-radius:4px;color:var(--text);font-size:14px;font-family:var(--font-sans)">
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:2px">
          <input type="text" value="${esc(job.client_name || '')}" placeholder="Client name" data-field="client_name" data-job-id="${job.id}" onblur="saveJobField(this)" style="flex:1;padding:3px 8px;background:transparent;border:1px solid transparent;border-radius:4px;color:var(--text-2);font-size:13px;font-family:var(--font-sans)">
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:2px">
          <input type="tel" value="${esc(job.client_phone || '')}" placeholder="Phone" data-field="client_phone" data-job-id="${job.id}" onblur="saveJobField(this)" style="flex:1;padding:3px 8px;background:transparent;border:1px solid transparent;border-radius:4px;color:var(--accent);font-size:13px;font-family:var(--font-sans)">
          ${job.client_phone ? '<a href="tel:' + esc(job.client_phone) + '" style="font-size:12px;color:var(--text-3);text-decoration:none">call</a>' : ''}
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <input type="email" value="${esc(job.client_email || '')}" placeholder="Email" data-field="client_email" data-job-id="${job.id}" onblur="saveJobField(this)" style="flex:1;padding:3px 8px;background:transparent;border:1px solid transparent;border-radius:4px;color:var(--text-3);font-size:12px;font-family:var(--font-sans)">
        </div>
      </div>

      <!-- STATUS -->
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:14px;">
        <span style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-3);font-family:var(--font-sans)">Status</span>
        <select data-field="status" data-job-id="${job.id}" onchange="saveJobField(this);invalidateJobsCache();loadJobs();loadJobsSidebar()" style="flex:1;max-width:200px;padding:6px 10px;background:var(--surface-1);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:13px;font-family:var(--font-sans)">
          <option value="active" ${job.status==='active'?'selected':''}>Active</option>
          <option value="upcoming" ${job.status==='upcoming'?'selected':''}>Upcoming</option>
          <option value="completed" ${job.status==='completed'?'selected':''}>Completed</option>
          <option value="archived" ${job.status==='archived'?'selected':''}>Archived</option>
        </select>
      </div>

      <!-- SECTIONS: simple textareas, Apple Notes style — instant, no round-trips -->
      ${sectionTextarea('todo', 'To Do', 'Tasks, room status, next steps...')}
      ${sectionTextarea('toClarify', 'To Clarify', 'Questions for client, unknowns...')}
      ${sectionTextarea('toBring', 'To Bring', 'Tools, equipment, @person...')}
      ${sectionTextarea('products', 'Products', 'Paint orders, quantities, colors...')}
      ${sectionTextarea('extras', 'Extras', 'Additional work, change orders, notes...')}

      <!-- ATTACHMENTS (loaded async after render) -->
      <div style="margin-bottom:20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <h3 style="font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-2);margin:0;font-family:var(--font-sans)">Photos</h3>
          <label style="background:var(--surface-2);border:1px solid var(--border);border-radius:4px;padding:4px 10px;font-size:11px;cursor:pointer;color:var(--text-2);font-family:var(--font-sans);">
            + Add Photos
            <input type="file" accept="image/*" multiple onchange="uploadJobPhotos('${job.id}', this.files)" style="display:none" />
          </label>
        </div>
        <div id="job-attachments-container"></div>
      </div>

      <!-- FINANCES -->
      <div style="margin-bottom:20px;">
        <h3 style="font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-2);margin-bottom:8px;font-family:var(--font-sans)">Finances${isCash ? ' <span style="color:var(--accent);font-size:10px;font-weight:500">CASH</span>' : ''}</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
          <div style="background:var(--surface-1);border:1px solid var(--border);border-radius:6px;padding:10px 12px">
            <div style="font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:var(--text-4);margin-bottom:4px">${isCash ? 'Agreed Total' : 'Quote Total'}</div>
            <div style="font-size:18px;font-weight:600;color:var(--sage)">$${formatMoney(effectiveTotal)}</div>
          </div>
          <div style="background:var(--surface-1);border:1px solid var(--border);border-radius:6px;padding:10px 12px">
            <div style="font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:var(--text-4);margin-bottom:4px">Balance</div>
            <div style="font-size:18px;font-weight:600;color:${balance > 0 ? 'var(--accent)' : 'var(--sage)'}">$${formatMoney(balance)}</div>
          </div>
        </div>
        ${job.payments.map(p => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border-soft);font-size:13px;gap:8px">
            <span style="color:var(--text-2);flex:1">${p.payment_date} — ${p.method}</span>
            <span style="font-family:var(--font-mono);color:var(--sage)">$${(p.amount_cents/100).toLocaleString('fr-CA')}</span>
            <button onclick="editPayment('${p.id}','${p.payment_date}',${p.amount_cents},'${p.method}')" style="background:transparent;border:none;color:var(--text-4);cursor:pointer;font-size:11px;padding:2px 4px" title="Edit">✎</button>
          </div>
        `).join('')}
        <button onclick="recordPayment('${job.id}', '${esc(job.job_number || '')}')" style="margin-top:8px;padding:6px 12px;background:var(--surface-2);border:1px solid var(--border);border-radius:4px;color:var(--text-2);font-size:12px;cursor:pointer;font-family:var(--font-sans)">+ Record Payment</button>
      </div>

      <!-- NOTES (scratchpad) -->
      <div style="margin-bottom:20px;">
        <h3 style="font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-2);margin-bottom:8px;font-family:var(--font-sans)">Notes</h3>
        <textarea id="job-scratchpad" data-job-id="${job.id}" onblur="saveScratchpad(this)"
          style="width:100%;min-height:150px;padding:12px;background:var(--surface-1);border:1px solid var(--border);border-radius:6px;color:var(--text);font-family:var(--font-mono);font-size:13px;line-height:1.55;resize:vertical;box-sizing:border-box">${esc(job.scratchpad || '')}</textarea>
      </div>

      <!-- CHANGE ORDERS (only rendered if any exist) -->
      ${renderChangeOrders(job.changeOrders)}

      <!-- ACTIONS (compact grid) -->
      <div style="margin-bottom:20px;">
        <h3 style="font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-2);margin-bottom:8px;font-family:var(--font-sans)">Actions</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
          <button class="job-action-btn" onclick="importJibbleCSV('${job.id}')" style="font-size:11px;padding:8px 10px">Import Jibble</button>
          <button class="job-action-btn" onclick="promptUpdateTotal('${job.id}', ${effectiveTotal})" style="font-size:11px;padding:8px 10px">Update ${isCash ? 'Agreed' : 'Quote'} Total</button>
        </div>
      </div>

      <!-- DELETE -->
      <div style="padding-top:16px;border-top:1px solid var(--border-soft);">
        <button onclick="deleteJob('${job.id}', '${esc(job.client_name || '')}')" style="color:#c94a4a;background:none;border:1px solid rgba(201,74,74,0.3);border-radius:4px;padding:6px 12px;font-size:11px;cursor:pointer;font-family:var(--font-sans)">Delete Job</button>
      </div>
    `;
    // Auto-expand all section textareas to fit their content
    setTimeout(autoExpandAllSections, 0);
    initJobPanelDivider();
    showJobPanel();
    setJobTab('chat');
    // Load job attachments async
    fetch('/api/jobs/' + jobId + '/attachments').then(r => r.json()).then(files => {
      const el = document.getElementById('job-attachments-container');
      if (el) el.innerHTML = renderJobAttachments(files);
    }).catch(() => {});
  } catch (err) {
    content.innerHTML = '<div style="color:var(--accent);padding:20px">Error: ' + esc(err.message) + '</div>';
  }
}

function closeJobDetail() {
  hideJobPanel();
  document.getElementById('job-detail').classList.remove('visible');
  currentJobId = null;
  // Land back where the user came from. If they opened the job from the
  // Jobs dashboard, refresh and show it. If they opened it from the chat
  // sidebar (desktop or mobile), leave the dashboard alone — they'll
  // return to whatever was underneath (chat / quote / sidebar list).
  if (jobOpenedFrom === 'dashboard') {
    document.getElementById('jobs-panel').classList.add('visible');
    invalidateJobsCache();
    loadJobs();
  }
  jobOpenedFrom = null;
}

async function saveJobField(el) {
  const jobId = el.getAttribute('data-job-id');
  const field = el.getAttribute('data-field');
  if (!jobId || !field) return;
  try {
    await fetch('/api/jobs/' + jobId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: el.value }),
    });
  } catch (err) {
    console.error('Field save failed:', err.message);
  }
}

async function saveJobSection(el) {
  const jobId = el.getAttribute('data-job-id');
  const key = el.getAttribute('data-section-key');
  if (!jobId || !key) return;
  // Read current sections from the page, update just this one, save
  const allTextareas = document.querySelectorAll('[data-section-key][data-job-id="' + jobId + '"]');
  const sections = {};
  allTextareas.forEach(ta => { sections[ta.getAttribute('data-section-key')] = ta.value; });
  try {
    await fetch('/api/jobs/' + jobId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_sections: JSON.stringify(sections) }),
    });
  } catch (err) {
    console.error('Section save failed:', err.message);
  }
}

async function saveScratchpad(el) {
  const jobId = el.getAttribute('data-job-id');
  if (!jobId) return;
  const content = el.value;
  try {
    const res = await fetch('/api/jobs/' + jobId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scratchpad: content }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      console.error('Scratchpad save failed:', data.error || res.status);
    }
  } catch (err) {
    console.error('Scratchpad save error:', err.message);
  }
}

async function promptUpdateTotal(jobId, currentTotal) {
  const newVal = prompt('New total ($):\n\nCurrent: $' + currentTotal, String(currentTotal));
  if (!newVal) return;
  const amount = parseFloat(newVal);
  if (!amount || amount <= 0) { alert('Invalid amount'); return; }
  const cents = Math.round(amount * 100);
  try {
    // Fetch job to determine if it's cash or declared
    const res = await fetch('/api/jobs/' + jobId);
    const job = await res.json();
    const isCash = job.payment_type === 'cash';
    const body = isCash
      ? { agreed_total_cents: cents }
      : { quote_subtotal_cents: cents, quote_tax_cents: Math.round(cents * 0.14975), quote_total_cents: cents + Math.round(cents * 0.14975) };
    await fetch('/api/jobs/' + jobId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    openJobDetail(jobId);
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function editPayment(paymentId, currentDate, currentAmountCents, currentMethod) {
  const newDate = prompt('Payment date (YYYY-MM-DD):', currentDate);
  if (!newDate) return;
  const newAmount = prompt('Amount ($):', String(currentAmountCents / 100));
  if (!newAmount) return;
  const newMethod = prompt('Method (cash / e_transfer / cheque):', currentMethod);
  if (!newMethod) return;
  const cents = Math.round(parseFloat(newAmount) * 100);
  if (!cents || cents <= 0) { alert('Invalid amount'); return; }
  try {
    const res = await fetch('/api/payments/' + paymentId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payment_date: newDate, amount_cents: cents, method: newMethod }),
    });
    if (res.ok) {
      openJobDetail(currentJobId);
    } else {
      const data = await res.json();
      alert('Edit failed: ' + (data.error || 'unknown'));
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function updateAgreedTotal(jobId, value) {
  const cents = Math.round(Number(value) * 100);
  if (!cents || cents <= 0) return;
  try {
    await fetch('/api/jobs/' + jobId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agreed_total_cents: cents }),
    });
    openJobDetail(jobId); // refresh
  } catch (err) {
    console.error('Update agreed total failed:', err.message);
  }
}

async function deleteJob(jobId, clientName) {
  const label = clientName ? ` for ${clientName}` : '';
  if (!confirm(`Delete this job${label}?\n\nThis removes ALL payments, time entries, change orders, invoices, and client updates for this job. The source quote session will be unlinked so you can re-convert it.\n\nThis cannot be undone.`)) return;
  try {
    const res = await fetch('/api/jobs/' + jobId, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok) {
      closeJobDetail();
      invalidateJobsCache();
      if (typeof loadJobs === 'function') loadJobs();
      invalidateSessionCache();
      if (typeof loadSidebar === 'function') loadSidebar();
    } else {
      alert('Error: ' + (data.error || 'Delete failed'));
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// Thin shim so existing onclick="recordPayment('id', 'JOB_NUMBER')" call
// sites keep working. The job_number is passed in by the caller (it's
// already in scope wherever the button is rendered) — no extra fetch.
function recordPayment(jobId, jobNumber) {
  openPaymentModal(jobId, jobNumber || '');
}

// ── ACTIVITY MAPPING ────────────────────────────────

async function openMappingScreen(jobId) {
  mappingJobId = jobId;
  const screen = document.getElementById('mapping-screen');
  const content = document.getElementById('mapping-content');
  const subtitle = document.getElementById('mapping-subtitle');
  screen.classList.add('visible');
  content.innerHTML = '<div style="text-align:center;color:var(--text-3);padding:20px">Loading...</div>';

  try {
    const res = await fetch('/api/jobs/' + jobId + '/activity-mappings');
    const data = await res.json();
    const { mappings, unmappedActivities } = data;

    // Combine: show unmapped first, then existing mappings
    const allActivities = [
      ...unmappedActivities.map(name => ({ sourceActivityName: name, isNew: true })),
      ...mappings.map(m => ({ ...m, isNew: false }))
    ];

    if (allActivities.length === 0) {
      content.innerHTML = '<div style="text-align:center;color:var(--text-3);padding:40px 20px"><p>No activities to map yet.</p><p style="font-size:12px;margin-top:8px">Import a Jibble CSV first.</p></div>';
      subtitle.textContent = '';
      return;
    }

    subtitle.textContent = unmappedActivities.length > 0
      ? unmappedActivities.length + ' unmapped — set labels before generating updates'
      : mappings.length + ' mapped activities';

    const phases = ['prep', 'prime', 'paint', 'stain', 'repair', 'cleanup', 'travel', 'admin', 'other'];

    content.innerHTML = allActivities.map((a, i) => {
      const name = a.sourceActivityName || a.source_activity_name;
      const phase = a.phase_code || 'other';
      const labelEn = a.client_label_en || name;
      const labelFr = a.client_label_fr || name;
      const billable = a.billable !== undefined ? a.billable : 1;
      const showOnUpdate = a.show_on_update !== undefined ? a.show_on_update : 1;

      return '<div class="mapping-card' + (a.isNew ? '" style="border-color:var(--accent)"' : '"') + '>' +
        '<div class="mapping-card-activity">' + (a.isNew ? '⚠ NEW: ' : '') + esc(name) + '</div>' +
        '<div class="mapping-row">' +
          '<div class="mapping-field">' +
            '<label>Phase</label>' +
            '<select data-idx="' + i + '" data-field="phase">' +
              phases.map(p => '<option value="' + p + '"' + (p === phase ? ' selected' : '') + '>' + p + '</option>').join('') +
            '</select>' +
          '</div>' +
          '<div class="mapping-field">' +
            '<label>Billable</label>' +
            '<select data-idx="' + i + '" data-field="billable">' +
              '<option value="1"' + (billable ? ' selected' : '') + '>Yes</option>' +
              '<option value="0"' + (!billable ? ' selected' : '') + '>No</option>' +
            '</select>' +
          '</div>' +
        '</div>' +
        '<div class="mapping-row">' +
          '<div class="mapping-field">' +
            '<label>Client Label (EN)</label>' +
            '<input type="text" data-idx="' + i + '" data-field="labelEn" value="' + esc(labelEn) + '">' +
          '</div>' +
          '<div class="mapping-field">' +
            '<label>Client Label (FR)</label>' +
            '<input type="text" data-idx="' + i + '" data-field="labelFr" value="' + esc(labelFr) + '">' +
          '</div>' +
        '</div>' +
        '<div class="mapping-toggle">' +
          '<input type="checkbox" data-idx="' + i + '" data-field="showOnUpdate"' + (showOnUpdate ? ' checked' : '') + '>' +
          '<span>Show on client updates</span>' +
        '</div>' +
      '</div>';
    }).join('') +
    '<button class="mapping-save-btn" onclick="saveMappings()">Save All Mappings</button>';

    // Store activity names for save
    window._mappingActivities = allActivities.map(a => a.sourceActivityName || a.source_activity_name);

  } catch (err) {
    content.innerHTML = '<div style="color:var(--accent);padding:20px">Error: ' + esc(err.message) + '</div>';
  }
}

function closeMappingScreen() {
  document.getElementById('mapping-screen').classList.remove('visible');
  // Refresh job detail if we came from there
  if (mappingJobId && currentJobId === mappingJobId) {
    openJobDetail(mappingJobId);
  }
  mappingJobId = null;
}

async function saveMappings() {
  if (!mappingJobId || !window._mappingActivities) return;
  const btn = document.querySelector('.mapping-save-btn');
  btn.textContent = 'Saving...';
  btn.disabled = true;

  try {
    const mappings = window._mappingActivities.map((name, i) => {
      const getVal = (field) => {
        const el = document.querySelector('[data-idx="' + i + '"][data-field="' + field + '"]');
        if (!el) return null;
        if (el.type === 'checkbox') return el.checked;
        return el.value;
      };
      return {
        sourceActivityName: name,
        phaseCode: getVal('phase') || 'other',
        clientLabelEn: getVal('labelEn') || name,
        clientLabelFr: getVal('labelFr') || name,
        billable: getVal('billable') === '1',
        showOnUpdate: getVal('showOnUpdate'),
      };
    });

    const res = await fetch('/api/jobs/' + mappingJobId + '/activity-mappings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mappings }),
    });
    const data = await res.json();
    if (res.ok) {
      btn.textContent = 'Saved!';
      setTimeout(() => closeMappingScreen(), 800);
    } else {
      alert(data.error || 'Save failed');
      btn.textContent = 'Save All Mappings';
      btn.disabled = false;
    }
  } catch (err) {
    alert('Error: ' + err.message);
    btn.textContent = 'Save All Mappings';
    btn.disabled = false;
  }
}

// ── CLIENT UPDATE GENERATION ────────────────────────

async function generateClientUpdate(jobId) {
  const periodStart = prompt('Period start date (YYYY-MM-DD):', '');
  const periodEnd = prompt('Period end date (YYYY-MM-DD, blank for all):', '');
  const notes = prompt('Notes for client (optional):');

  try {
    const res = await fetch('/api/jobs/' + jobId + '/updates/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        periodStart: periodStart || undefined,
        periodEnd: periodEnd || undefined,
        notes: notes || '',
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to generate update');
      return;
    }

    // Open preview in new tab
    const previewUrl = '/preview/update/' + data.updateId;
    window.open(previewUrl, '_blank');

    // Offer PDF download
    const downloadPdf = confirm('Update generated and previewing.\n\nDownload as PDF?');
    if (downloadPdf) {
      const pdfRes = await fetch('/api/updates/' + data.updateId + '/pdf', { method: 'POST' });
      if (pdfRes.ok) {
        const blob = await pdfRes.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = data.summary.jobNumber + '_update_' + data.summary.sequenceNo + '.pdf';
        a.click();
        URL.revokeObjectURL(url);
      } else {
        alert('PDF generation failed');
      }
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// ── CHANGE ORDERS ───────────────────────────────────

async function createChangeOrder(jobId) {
  const titleEn = prompt('Change order title (EN):');
  if (!titleEn) return;
  const titleFr = prompt('Title in French (or blank for same):', titleEn);

  // Collect line items
  const items = [];
  let adding = true;
  while (adding) {
    const desc = prompt(`Item ${items.length + 1} description (blank to finish):`);
    if (!desc) { adding = false; break; }
    const amount = prompt(`Amount for "${desc}" ($):`);
    if (amount) {
      items.push({ description: desc, amountCents: Math.round(parseFloat(amount) * 100) });
    }
  }

  if (items.length === 0) {
    alert('No items added — change order cancelled');
    return;
  }

  try {
    const res = await fetch('/api/jobs/' + jobId + '/change-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titleEn, titleFr: titleFr || titleEn, items }),
    });
    const data = await res.json();
    if (res.ok) {
      // Preview it
      window.open('/preview/change-order/' + data.id, '_blank');
      const approve = confirm('Change order created and previewing.\n\nMark as approved? (if client already agreed verbally)');
      if (approve) {
        await fetch('/api/change-orders/' + data.id, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'approved' }),
        });
      }
      openJobDetail(jobId);
    } else {
      alert(data.error || 'Failed');
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// ── INVOICE GENERATION ──────────────────────────────

async function generateInvoice(jobId) {
  const issueDate = prompt('Invoice date (YYYY-MM-DD):', new Date().toISOString().slice(0,10));
  if (!issueDate) return;

  try {
    // Generate draft
    const res = await fetch('/api/jobs/' + jobId + '/invoices/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issueDate }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to generate invoice');
      return;
    }

    // Open preview
    const previewUrl = '/preview/invoice/' + data.invoiceId;
    window.open(previewUrl, '_blank');

    // Offer actions
    const action = prompt(
      'Invoice draft generated and previewing.\n\n' +
      'Type:\n' +
      '  pdf — download as PDF\n' +
      '  edit — go back and adjust sections\n' +
      '  (blank) — done for now'
    );

    if (action === 'pdf') {
      const pdfRes = await fetch('/api/invoices/' + data.invoiceId + '/pdf', { method: 'POST' });
      if (pdfRes.ok) {
        const blob = await pdfRes.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = data.invoiceJson.jobNumber + '_invoice_' + data.invoiceNumber + '.pdf';
        a.click();
        URL.revokeObjectURL(url);
      } else {
        alert('PDF generation failed');
      }
    }

    openJobDetail(jobId);
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// Jibble CSV import (simple file picker)
function importJibbleCSV(jobId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/jobs/' + jobId + '/imports/jibble', { method: 'POST', body: formData });
      const data = await res.json();
      if (res.ok) {
        if (data.unmapped > 0) {
          const mapNow = confirm(`Imported: ${data.inserted} rows\nDuplicates skipped: ${data.duplicates}\n\n${data.unmapped} activities need mapping.\n\nMap them now?`);
          if (mapNow) {
            openMappingScreen(jobId);
            return;
          }
        } else {
          alert(`Imported: ${data.inserted} rows\nDuplicates skipped: ${data.duplicates}\nAll activities mapped!`);
        }
        openJobDetail(jobId);
      } else {
        alert(data.error || 'Import failed');
      }
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };
  input.click();
}
