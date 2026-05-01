// ── PDF / EMAIL ─────────────────────────────────────

async function downloadPDF() {
  if (!currentSessionId) return;
  const btn = document.getElementById('btn-pdf');
  btn.textContent = '⏳ Generating…';
  btn.disabled = true;
  try {
    const res = await fetch(`/api/sessions/${currentSessionId}/pdf`, { method: 'POST' });
    if (!res.ok) { alert('PDF generation failed.'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quote-${currentSessionId.slice(0,8)}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('Error: ' + e.message);
  } finally {
    btn.textContent = '↓ PDF';
    btn.disabled = false;
  }
}

function toggleEmailForm() {
  const form = document.getElementById('email-form');
  const divider = document.getElementById('email-divider');
  form.classList.remove('minimized');
  form.classList.toggle('open');
  divider.classList.toggle('visible', form.classList.contains('open'));
  document.getElementById('email-restore-btn').classList.remove('visible');
}

function minimizeEmailForm() {
  document.getElementById('email-form').classList.add('minimized');
  document.getElementById('email-divider').classList.remove('visible');
  document.getElementById('email-restore-btn').classList.add('visible');
}

function restoreEmailForm() {
  document.getElementById('email-form').classList.remove('minimized');
  document.getElementById('email-divider').classList.add('visible');
  document.getElementById('email-restore-btn').classList.remove('visible');
}

function prefillEmail(session) {
  if (!session || !session.quoteJson) return;
  // If the user already had email form state for this session (generated
  // or edited a draft then switched away), restore it exactly as they left it.
  if (restoreEmailFormState(session.id)) return;
  // Otherwise, prefill from the server-side draft data
  const draft = session.emailDraft || {};
  const settings = draft.settings || {};
  document.getElementById('email-subject').value = draft.subject || '';
  document.getElementById('email-body').value = draft.body || '';
  document.getElementById('email-to').value = draft.recipient || session.email_recipient || '';
  document.getElementById('email-scenario').value = ['quote_send', 'quote_revision', 'quote_follow_up'].includes(settings.scenario) ? settings.scenario : 'quote_send';
  document.getElementById('email-signer').value = settings.signer || 'Loric';
  // email-detail-level removed — replaced by payment-type
  document.getElementById('email-language').value = settings.language || 'english';
}

async function refreshEmailDraftFromSettings(changedField = '') {
  if (!currentSessionId) return;

  const recipient = document.getElementById('email-to').value.trim();
  const payload = { recipient };

  if (changedField === 'scenario') payload.scenario = document.getElementById('email-scenario').value;
  if (changedField === 'signer') payload.signer = document.getElementById('email-signer').value;
  // detailLevel removed — templates don't use it
  if (changedField === 'language') payload.language = document.getElementById('email-language').value;

  const res = await fetch(`/api/sessions/${currentSessionId}/email-draft`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) {
    alert('Error: ' + (data.error || 'Unable to update email draft.'));
    return;
  }

  const draft = data.emailDraft || {};
  const state = getEmailDraftState(currentSessionId);
  if (!state.subjectDirty) document.getElementById('email-subject').value = draft.subject || '';
  if (!state.bodyDirty) document.getElementById('email-body').value = draft.body || '';
  if (!state.toDirty) document.getElementById('email-to').value = draft.recipient || recipient;
}

async function sendEmail() {
  const to = document.getElementById('email-to').value.trim();
  const subject = document.getElementById('email-subject').value.trim();
  const body = document.getElementById('email-body').value.trim();

  if (!to) { alert('Please enter a recipient email.'); return; }

  const btn = document.getElementById('email-send-btn');
  btn.textContent = 'Sending…';
  btn.disabled = true;

  try {
    const res = await fetch(`/api/sessions/${currentSessionId}/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, body }),
    });
    const data = await res.json();
    if (data.ok) {
      btn.textContent = '✓ Sent!';
      setStatus('sent');
      loadSidebar();
      setTimeout(() => {
        btn.textContent = 'Send Email with PDF';
        btn.disabled = false;
      }, 3000);
    } else {
      alert('Error: ' + data.error);
      btn.textContent = 'Send Email with PDF';
      btn.disabled = false;
    }
  } catch (e) {
    alert('Error: ' + e.message);
    btn.textContent = 'Send Email with PDF';
    btn.disabled = false;
  }
}

// ── EMAIL DIVIDER RESIZE ────────────────────────────
(function initEmailDivider() {
  const divider = document.getElementById('email-divider');
  const frameContainer = document.getElementById('quote-frame-container');
  const quotePanel = document.getElementById('quote-panel');
  if (!divider) return;

  let startY = 0;
  let startH = 0;

  divider.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startY = e.clientY;
    startH = frameContainer.getBoundingClientRect().height;
    divider.classList.add('dragging');
    document.body.classList.add('email-resizing');
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  function onMouseMove(e) {
    const panelH = quotePanel.getBoundingClientRect().height;
    let newH = startH + (e.clientY - startY);
    newH = Math.max(80, Math.min(newH, panelH - 200));
    frameContainer.style.height = newH + 'px';
    frameContainer.style.flex = 'none';
  }

  function onMouseUp() {
    divider.classList.remove('dragging');
    document.body.classList.remove('email-resizing');
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }
})();

function getEmailDraftState(sessionId) {
  if (!sessionId) return { subjectDirty: false, bodyDirty: false, toDirty: false };
  if (!emailDraftStateBySession.has(sessionId)) {
    emailDraftStateBySession.set(sessionId, { subjectDirty: false, bodyDirty: false, toDirty: false });
  }
  return emailDraftStateBySession.get(sessionId);
}

function markEmailDraftDirty(field) {
  if (!currentSessionId) return;
  const state = getEmailDraftState(currentSessionId);
  state[`${field}Dirty`] = true;
}

// Save current email form values to the per-session Map before switching away.
// This preserves generated/edited drafts so switching back restores them.
function saveEmailFormState(sessionId) {
  if (!sessionId) return;
  const state = getEmailDraftState(sessionId);
  state.savedSubject = document.getElementById('email-subject').value;
  state.savedBody = document.getElementById('email-body').value;
  state.savedTo = document.getElementById('email-to').value;
  state.savedScenario = document.getElementById('email-scenario').value;
  state.savedSigner = document.getElementById('email-signer').value;
  state.savedDetail = '';
  state.savedTone = document.getElementById('email-tone').value;
  state.savedLanguage = document.getElementById('email-language').value;
  // Persist to sessionStorage so drafts survive page reloads
  try { sessionStorage.setItem('emailDraft_' + sessionId, JSON.stringify(state)); } catch(e) {}
}

// Restore email form from saved state (returns true if restored, false if no saved state)
function restoreEmailFormState(sessionId) {
  let state = getEmailDraftState(sessionId);
  // Try sessionStorage if in-memory Map has nothing saved
  if (state.savedBody == null) {
    try {
      const stored = sessionStorage.getItem('emailDraft_' + sessionId);
      if (stored) {
        const parsed = JSON.parse(stored);
        Object.assign(state, parsed);
        emailDraftStateBySession.set(sessionId, state);
      }
    } catch(e) {}
  }
  if (state.savedBody == null) return false; // nothing saved yet
  document.getElementById('email-subject').value = state.savedSubject || '';
  document.getElementById('email-body').value = state.savedBody || '';
  document.getElementById('email-to').value = state.savedTo || '';
  document.getElementById('email-scenario').value = state.savedScenario || 'quote_send';
  document.getElementById('email-signer').value = state.savedSigner || 'Loric';
  // email-detail-level removed
  document.getElementById('email-tone').value = state.savedTone || 'informal';
  document.getElementById('email-language').value = state.savedLanguage || 'english';
  return true;
}

// ── QUOTING RULES MODAL ──────────────────────────────

async function openRulesModal() {
  const modal = document.getElementById('rules-modal');
  const textarea = document.getElementById('rules-textarea');
  const status = document.getElementById('rules-status');

  modal.classList.add('open');
  textarea.value = 'Loading…';
  status.textContent = '';

  try {
    const res = await fetch('/api/quoting-logic');
    const data = await res.json();
    textarea.value = data.content;
    status.textContent = 'Loaded from /data/QUOTING_LOGIC.md';
  } catch (e) {
    textarea.value = '';
    status.textContent = 'Failed to load file.';
  }
}

function closeRulesModal() {
  document.getElementById('rules-modal').classList.remove('open');
  document.getElementById('rules-status').textContent = '';
}

function handleModalBackdrop(e) {
  if (e.target === document.getElementById('rules-modal')) closeRulesModal();
}

async function saveRules() {
  const btn = document.getElementById('rules-save-btn');
  const status = document.getElementById('rules-status');
  const content = document.getElementById('rules-textarea').value;

  btn.textContent = 'Saving…';
  btn.disabled = true;

  try {
    const res = await fetch('/api/quoting-logic', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    const data = await res.json();
    if (data.ok) {
      status.textContent = '✓ Saved — new rules active on the next assistant message.';
      btn.textContent = '✓ Saved';
      setTimeout(() => {
        btn.textContent = 'Save';
        btn.disabled = false;
      }, 2000);
    } else {
      status.textContent = 'Error: ' + (data.error || 'unknown');
      btn.textContent = 'Save';
      btn.disabled = false;
    }
  } catch (e) {
    status.textContent = 'Network error.';
    btn.textContent = 'Save';
    btn.disabled = false;
  }
}

// Refine for the existing session-based email form (quote context).
async function generateSessionEmail() {
  if (!currentSessionId) { alert('No active session.'); return; }
  const payload = {
    sessionId: currentSessionId,
    scenario: document.getElementById('email-scenario').value,
    signer: document.getElementById('email-signer').value,
    language: document.getElementById('email-language').value,
    tone: (document.getElementById('email-tone') || {}).value || 'informal',
    paymentType: (document.getElementById('email-payment-type') || {}).value || 'declared',
    recipient: document.getElementById('email-to').value.trim() || undefined,
  };
  const btn = document.getElementById('generate-session-email-btn');
  const originalText = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
  try {
    const res = await fetch('/api/email/standalone-draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) { alert('Generate failed: ' + (data.error || 'unknown')); return; }
    document.getElementById('email-subject').value = data.subject || '';
    document.getElementById('email-body').value = data.body || '';
    // Mark fields as dirty so the template prefill doesn't overwrite our generated draft
    const state = getEmailDraftState(currentSessionId);
    state.subjectDirty = true;
    state.bodyDirty = true;
    // Persist immediately so switching tabs doesn't lose the draft
    saveEmailFormState(currentSessionId);
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
  }
}

async function refineSessionEmail() {
  if (!currentSessionId) { alert('No active session.'); return; }
  const currentDraft = document.getElementById('email-body').value.trim();
  if (!currentDraft) { alert('Nothing to refine yet — generate a draft first.'); return; }
  const instruction = prompt('How should this email be changed?\n\ne.g. "Make it shorter", "Add a line about next week", "Be more formal"');
  if (!instruction) return;
  try {
    const res = await fetch('/api/sessions/' + currentSessionId + '/email/refine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction, currentDraft }),
    });
    const data = await res.json();
    if (!res.ok) { alert('Refine failed: ' + (data.error || 'unknown')); return; }
    document.getElementById('email-body').value = data.refinedDraft || currentDraft;
    saveEmailFormState(currentSessionId);
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// ── STANDALONE EMAIL DRAFT (job-context, no quote session needed) ───────
async function openStandaloneEmail(jobId) {
  stdEmailJobId = jobId;
  // Pull job context for the header and for subject seeding
  let ctx = '';
  try {
    const res = await fetch('/api/jobs/' + jobId);
    if (res.ok) {
      const job = await res.json();
      ctx = (job.client_name || '') + (job.address ? ' — ' + job.address : '');
    }
  } catch (e) {}
  document.getElementById('stdemail-context').textContent = ctx ? 'Context: ' + ctx : 'No job context';
  document.getElementById('stdemail-subject').value = '';
  document.getElementById('stdemail-body').value = '';
  document.getElementById('stdemail-modal').style.display = 'flex';
  // No auto-generation — user clicks "Generate" when ready (each call hits Claude)
}
function closeStandaloneEmail() {
  document.getElementById('stdemail-modal').style.display = 'none';
  stdEmailJobId = null;
}

async function generateStandaloneEmail() {
  const payload = {
    jobId: stdEmailJobId,
    scenario: document.getElementById('stdemail-scenario').value,
    signer: document.getElementById('stdemail-signer').value,
    language: document.getElementById('stdemail-language').value,
    detailLevel: document.getElementById('stdemail-detail').value,
    tone: document.getElementById('stdemail-tone').value,
  };
  // Find the Generate button via the bound handler
  const btn = Array.from(document.querySelectorAll('#stdemail-modal button')).find(b => /Generate/.test(b.textContent));
  const originalText = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
  try {
    const res = await fetch('/api/email/standalone-draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) { alert('Draft failed: ' + (data.error || 'unknown')); return; }
    document.getElementById('stdemail-subject').value = data.subject || '';
    document.getElementById('stdemail-body').value = data.body || '';
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
  }
}

async function refineStandaloneEmail() {
  const currentDraft = document.getElementById('stdemail-body').value.trim();
  if (!currentDraft) { alert('Nothing to refine yet — generate a draft first.'); return; }
  const instruction = prompt('How should this email be changed?\n\ne.g. "Make it shorter", "Add a line about next week", "Be more formal"');
  if (!instruction) return;
  try {
    const res = await fetch('/api/email/standalone-refine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentDraft, instruction }),
    });
    const data = await res.json();
    if (!res.ok) { alert('Refine failed: ' + (data.error || 'unknown')); return; }
    document.getElementById('stdemail-body').value = data.refinedDraft || currentDraft;
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function copyStandaloneEmail() {
  const subject = document.getElementById('stdemail-subject').value;
  const body = document.getElementById('stdemail-body').value;
  const text = 'Subject: ' + subject + '\n\n' + body;
  try {
    await navigator.clipboard.writeText(text);
    alert('Copied subject + body to clipboard.');
  } catch (err) {
    alert('Could not copy automatically. Select and copy manually.');
  }
}

// ── SMART PASTE (Apple Notes → job fields) ──────────────────────────────
function openSmartPaste(jobId) {
  smartPasteJobId = jobId;
  smartPasteExtracted = null;
  document.getElementById('smartpaste-input').value = '';
  document.getElementById('smartpaste-step-input').style.display = '';
  document.getElementById('smartpaste-step-preview').style.display = 'none';
  document.getElementById('smartpaste-conflicts').style.display = 'none';
  document.getElementById('smartpaste-overwrite-btn').style.display = 'none';
  document.getElementById('smartpaste-modal').style.display = 'flex';
}
function closeSmartPaste() {
  document.getElementById('smartpaste-modal').style.display = 'none';
  smartPasteJobId = null;
  smartPasteExtracted = null;
}
function backToSmartPasteInput() {
  document.getElementById('smartpaste-step-input').style.display = '';
  document.getElementById('smartpaste-step-preview').style.display = 'none';
}

async function parseSmartPaste() {
  const text = document.getElementById('smartpaste-input').value.trim();
  if (!text) { alert('Paste a note first.'); return; }
  const btn = document.getElementById('smartpaste-parse-btn');
  btn.disabled = true;
  btn.textContent = 'Parsing…';
  try {
    const res = await fetch('/api/jobs/' + smartPasteJobId + '/smart-paste', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert('Parse failed: ' + (data.error || 'unknown'));
      return;
    }
    smartPasteExtracted = data.extracted;
    renderSmartPastePreview(data.extracted, data.conflicts || {});
    document.getElementById('smartpaste-step-input').style.display = 'none';
    document.getElementById('smartpaste-step-preview').style.display = '';
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Parse';
  }
}

function renderSmartPastePreview(e, conflicts) {
  function row(label, val) {
    return val != null && val !== ''
      ? `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-soft)"><span style="color:var(--text-3)">${label}</span><span style="color:var(--text);font-weight:500">${esc(String(val))}</span></div>`
      : '';
  }
  const payments = Array.isArray(e.payments) ? e.payments : [];
  const paymentsHtml = payments.length > 0
    ? '<div style="margin-top:10px"><div style="font-weight:700;margin-bottom:6px;font-size:12px;color:var(--text-2)">PAYMENTS (' + payments.length + ')</div>' +
      payments.map(p => `<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px"><span style="color:var(--text-3)">${esc(p.date || '—')} · ${esc(p.method || '—')}</span><span style="font-family:var(--font-mono);color:var(--sage)">$${Number(p.amount).toLocaleString('fr-CA')}</span></div>`).join('') +
      '</div>'
    : '';
  const remainderHtml = e.remainder && e.remainder.trim()
    ? '<div style="margin-top:12px"><div style="font-weight:700;margin-bottom:6px;font-size:12px;color:var(--text-2)">SCRATCHPAD (remainder)</div><pre style="white-space:pre-wrap;font-family:var(--font-mono);font-size:12px;color:var(--text-2);background:var(--surface-2);padding:8px;border-radius:4px;margin:0;max-height:160px;overflow-y:auto">' + esc(e.remainder) + '</pre></div>'
    : '';

  const fields = [
    row('Client', e.clientName),
    row('Address', e.address),
    row('Phone', e.phone),
    row('Contract total', e.contractTotal != null ? '$' + Number(e.contractTotal).toLocaleString('fr-CA') : null),
    row('Paint total', e.paintTotal != null ? '$' + Number(e.paintTotal).toLocaleString('fr-CA') : null),
    row('Consumables', e.consumablesTotal != null ? '$' + Number(e.consumablesTotal).toLocaleString('fr-CA') : null),
    row('Labor cost', e.laborCost != null ? '$' + Number(e.laborCost).toLocaleString('fr-CA') : null),
  ].filter(Boolean).join('');
  const structured = fields
    ? '<div style="font-weight:700;margin-bottom:6px;font-size:12px;color:var(--text-2)">FIELDS</div>' + fields
    : '<div style="color:var(--text-3);font-style:italic">No structured fields detected.</div>';

  document.getElementById('smartpaste-preview-body').innerHTML = structured + paymentsHtml + remainderHtml;

  const conflictKeys = Object.keys(conflicts || {});
  const conflictBox = document.getElementById('smartpaste-conflicts');
  const overwriteBtn = document.getElementById('smartpaste-overwrite-btn');
  if (conflictKeys.length > 0) {
    const lines = conflictKeys.map(k => {
      const c = conflicts[k];
      return `<div><strong>${esc(k)}</strong>: existing <code>${esc(String(c.existing))}</code> → incoming <code>${esc(String(c.incoming))}</code></div>`;
    }).join('');
    conflictBox.innerHTML = '<div style="font-weight:700;margin-bottom:6px">⚠ Conflicts with existing job data:</div>' + lines + '<div style="margin-top:6px">Use "Apply + Overwrite" to replace, or "Apply (keep existing)" to skip these fields.</div>';
    conflictBox.style.display = '';
    overwriteBtn.style.display = '';
  } else {
    conflictBox.style.display = 'none';
    overwriteBtn.style.display = 'none';
  }
}

async function applySmartPaste(overwrite) {
  if (!smartPasteJobId || !smartPasteExtracted) return;
  try {
    const res = await fetch('/api/jobs/' + smartPasteJobId + '/smart-paste/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ extracted: smartPasteExtracted, overwrite: !!overwrite }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert('Apply failed: ' + (data.error || 'unknown'));
      return;
    }
    const summary = 'Applied: ' + (data.applied && data.applied.length ? data.applied.join(', ') : 'nothing');
    alert(summary);
    closeSmartPaste();
    openJobDetail(smartPasteJobId);
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// ── PAYMENT MODAL ─────────────────────────────────────────────────────
function openPaymentModal(jobId, jobNumber) {
  paymentModalJobId = jobId;
  paymentModalJobNumber = jobNumber || '';
  paymentModalMethod = 'e_transfer';
  document.getElementById('payment-modal-subtitle').textContent = jobNumber ? `Job: ${jobNumber}` : '';
  document.getElementById('payment-amount').value = '';
  document.getElementById('payment-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('payment-reference').value = '';
  selectPaymentMethod('e_transfer');
  document.getElementById('payment-modal').style.display = 'flex';
  // Don't auto-focus on mobile (would pop the keyboard immediately)
  if (window.innerWidth > 768) setTimeout(() => document.getElementById('payment-amount').focus(), 50);
}

function closePaymentModal() {
  document.getElementById('payment-modal').style.display = 'none';
  paymentModalJobId = null;
}

function handlePaymentBackdrop(e) {
  if (e.target === document.getElementById('payment-modal')) closePaymentModal();
}

function selectPaymentMethod(method) {
  paymentModalMethod = method;
  document.querySelectorAll('.payment-method-btn').forEach((b) => {
    b.classList.toggle('selected', b.dataset.method === method);
  });
}

async function submitPaymentModal() {
  const jobId = paymentModalJobId;
  if (!jobId) return;
  const amount = parseFloat(document.getElementById('payment-amount').value);
  const date = document.getElementById('payment-date').value;
  const method = paymentModalMethod;
  const reference = document.getElementById('payment-reference').value.trim();
  if (!amount || amount <= 0) { alert('Enter a valid amount.'); return; }
  if (!date) { alert('Pick a date.'); return; }

  const saveBtn = document.getElementById('payment-save-btn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  try {
    const res = await fetch('/api/jobs/' + jobId + '/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, date, method, reference }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed');
      return;
    }
    closePaymentModal();

    // Confirm finance-sheet write (same preview-then-sync flow as before)
    const p = data.sync_preview || {};
    const previewText = [
      'Payment saved. Write to finance sheet?',
      '',
      'Date:     ' + (p.date || date),
      'Amount:   ' + (p.amount_formatted || ('$' + amount)),
      'Method:   ' + (p.method || method),
      'Job:      ' + (p.job_name || ''),
      'Category: ' + (p.category || 'Contract Revenue'),
      'Dest:     ' + (p.destination || 'Finance Google Sheet'),
      '',
      'OK to write, Cancel to leave as pending (you can sync later).',
    ].join('\n');

    if (confirm(previewText)) {
      try {
        const syncRes = await fetch('/api/payments/' + data.id + '/sync', { method: 'POST' });
        const syncData = await syncRes.json();
        if (syncRes.ok) {
          alert(syncData.status === 'already_synced' ? 'Already synced to finance sheet.' : 'Payment synced to finance sheet.');
        } else {
          alert('Sync failed: ' + (syncData.error || 'unknown error') + '\n\nPayment is still recorded. You can retry the sync later.');
        }
      } catch (err) {
        alert('Sync error: ' + err.message + '\n\nPayment is still recorded.');
      }
    } else {
      alert('Payment saved. Finance sheet write skipped — marked as pending.');
    }
    openJobDetail(jobId);
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
  }
}
