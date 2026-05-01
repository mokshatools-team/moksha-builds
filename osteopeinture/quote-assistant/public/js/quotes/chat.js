// OP Hub — Chat / Messaging Functions
// Depends on: state.js, api.js, shared.js, panel.js, quotes/sidebar.js

// ── SESSION LOADING ────────────────────────────────────

async function loadSession(id) {
  // Save current session's state before switching
  if (draftDirty) await draftSaveNow();
  saveEmailFormState(currentSessionId);
  saveTogglesForSession(currentSessionId);
  closeSidebar();
  const res = await fetch(`/api/sessions/${id}`);
  const session = await res.json();
  currentSessionId = id;
  // Update URL so this tab can be bookmarked / opened in another tab
  history.replaceState(null, '', '?session=' + id);
  clearAttachmentQueue();

  const messagesEl = document.getElementById('messages');
  messagesEl.innerHTML = '';
  for (const msg of session.messages) {
    const text = Array.isArray(msg.content)
      ? msg.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
      : msg.content;
    if (!text) continue;
    const trimmed = text.trim();
    if (msg.role === 'assistant') {
      // Strip JSON blocks from assistant messages (quote data belongs in the panel, not chat)
      let cleaned = trimmed;
      // Remove fenced JSON blocks: ```json ... ```
      cleaned = cleaned.replace(/```json\s*\n?\{[\s\S]*?\}\s*\n?```/g, '').trim();
      // If entire message is a JSON object, replace with short note
      if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
        try { JSON.parse(cleaned); cleaned = ''; } catch(e) {}
      }
      // Remove inline JSON objects that look like quote data
      cleaned = cleaned.replace(/\{[\s\S]{200,}\}/g, '').trim();
      appendMessage('assistant', cleaned || 'Quote updated — see the panel.');
    } else {
      appendMessage(msg.role, text);
    }
  }

  if (session.quoteJson) {
    draftQuoteJson = JSON.parse(JSON.stringify(session.quoteJson)); // deep copy
    showQuote(id, session.status);
    prefillEmail(session);
  } else {
    draftQuoteJson = null;
    clearQuote();
  }

  setStatus(session.status);
  restoreTogglesForSession(id);
  loadSessionAttachments(id);

  document.getElementById('session-badge').style.display = 'none';
  document.getElementById('chat-header-title').textContent = session.project_id || session.client_name || 'New Quote';
  updateConvertButton(session);
  setActiveSessionInSidebar(id);
}

// ── SESSION MANAGEMENT ──────────────────────────────

async function startNewSession() {
  const res = await fetch('/api/sessions', { method: 'POST' });
  const data = await res.json();
  currentSessionId = data.id;
  // Update URL so this tab has its own session — enables multi-tab
  history.replaceState(null, '', '?session=' + data.id);
  clearAttachmentQueue();

  document.getElementById('messages').innerHTML = '';
  const badge = document.getElementById('session-badge');
  const title = data.projectId || 'New Quote';
  badge.textContent = title;
  badge.style.display = '';
  document.getElementById('chat-header-title').textContent = title;
  clearQuote();
  setStatus('gathering');
  invalidateSessionCache();
  loadSidebar();

  appendMessage('assistant', 'Internal quote builder. Send the job details and files.');
  document.getElementById('message-input').focus();
}

// ── MESSAGING ───────────────────────────────────────

async function sendMessage() {
  if (isSending) return;
  if (!currentSessionId) {
    await startNewSession();
  }

  const input = document.getElementById('message-input');
  const text = input.value.trim();
  if (!text && !pendingFiles.length) return;

  const filesToSend = pendingFiles.slice();
  setSendingState(true);

  const formData = new FormData();
  // Append toggle context so Claude knows the user's settings
  const toggleCtx = getToggleContext();
  const fullMessage = text ? text + '\n\n' + toggleCtx : '';
  if (fullMessage) formData.append('message', fullMessage);
  for (const f of filesToSend) formData.append('images', f);

  // Show user message FIRST, then typing indicator below it
  const displayText = text + (filesToSend.length ? ` [${filesToSend.length} image(s)]` : '');
  if (displayText) appendMessage('user', displayText);
  input.value = '';
  autoResize(input);
  clearAttachmentQueue();

  const typingId = 'typing-' + Date.now();
  const typingEl = document.createElement('div');
  typingEl.id = typingId;
  typingEl.className = 'msg assistant';
  typingEl.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
  document.getElementById('messages').appendChild(typingEl);
  scrollToBottom();

  try {
    const res = await fetch(`/api/sessions/${currentSessionId}/messages`, {
      method: 'POST',
      body: formData,
    });

    // Check if server is streaming (SSE) or returning JSON (error/fallback)
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream')) {
      // Streaming SSE path — text appears word-by-word
      let fullText = '';
      let renderTimer = null;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop();

        for (const part of parts) {
          if (!part.startsWith('data: ')) continue;
          let payload;
          try { payload = JSON.parse(part.slice(6)); } catch(e) { continue; }

          if (payload.type === 'delta') {
            fullText += payload.text;
            // Debounce markdown rendering to avoid DOM thrashing
            if (!renderTimer) {
              renderTimer = setTimeout(() => {
                renderAssistantText(typingEl, fullText);
                scrollToBottom();
                renderTimer = null;
              }, 40);
            }
          } else if (payload.type === 'replace') {
            fullText = payload.text;
            renderAssistantText(typingEl, fullText);
            scrollToBottom();
          } else if (payload.type === 'done') {
            // Final render (un-debounced)
            if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
            if (payload.hasQuote) {
              typingEl.remove();
              appendMessage('assistant', 'Quote ready — see the panel on the right.');
              // Reload fresh quoteJson for the draft editor + show undo option
              fetch('/api/sessions/' + currentSessionId).then(r => r.json()).then(s => {
                if (s.quoteJson) draftQuoteJson = JSON.parse(JSON.stringify(s.quoteJson));
                showQuote(currentSessionId, payload.status);
                showQuoteUndoToast();
              }).catch(() => showQuote(currentSessionId, payload.status));
              loadSessionMeta();
            } else {
              renderAssistantText(typingEl, fullText);
            }
            // Refresh attachment thumbnails (new images may have been uploaded)
            loadSessionAttachments(currentSessionId);
            setStatus(payload.status);
            loadSidebar();
          } else if (payload.type === 'error') {
            typingEl.remove();
            appendMessage('system', 'Error: ' + payload.message);
          }
        }
      }
      // Final cleanup — ensure last render happened
      if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
      if (fullText && typingEl.parentNode) renderAssistantText(typingEl, fullText);
    } else {
      // JSON fallback (error responses before SSE headers were sent)
      const data = await res.json();
      typingEl.remove();
      if (data.error) {
        appendMessage('system', 'Error: ' + data.error);
      } else {
        if (data.hasQuote) {
          appendMessage('assistant', 'Quote ready — see the panel on the right.');
          showQuote(currentSessionId, data.status);
          loadSessionMeta();
        } else {
          appendMessage('assistant', data.reply);
        }
        setStatus(data.status);
        loadSidebar();
      }
    }
  } catch (err) {
    typingEl.remove();
    appendMessage('system', 'Connection error. Please try again.');
  } finally {
    setSendingState(false);
    input.focus();
  }
}

async function loadSessionMeta() {
  const res = await fetch(`/api/sessions/${currentSessionId}`);
  const session = await res.json();
  const badge = document.getElementById('session-badge');
  if (session.project_id) {
    document.getElementById('chat-header-title').textContent = session.project_id;
    badge.style.display = 'none'; // title already shows the name — badge is redundant
  }
  prefillEmail(session);
}

// ── MESSAGE DISPLAY ─────────────────────────────────

function appendMessage(role, text) {
  const el = document.createElement('div');
  el.className = 'msg ' + role;
  if (role === 'assistant') {
    renderAssistantText(el, text);
  } else {
    el.textContent = text;
  }
  document.getElementById('messages').appendChild(el);
  scrollToBottom();
  return el;
}

function renderAssistantText(el, text) {
  // Use marked.js to render full markdown (bold, tables, lists, code, etc.)
  if (typeof marked !== 'undefined') {
    el.innerHTML = DOMPurify.sanitize(marked.parse(String(text || '')));
  } else {
    el.textContent = text || '';
  }
}

// ── QUOTE PANEL ─────────────────────────────────────

function showQuote(sessionId, status) {
  const frame = document.getElementById('quote-frame');
  frame.src = `/preview/${sessionId}?t=${Date.now()}`;

  document.getElementById('btn-pdf').style.display = '';
  document.getElementById('btn-email-toggle').style.display = '';
  document.getElementById('btn-preview').style.display = '';
  document.getElementById('mobile-quote-btn').classList.add('visible');

  // Default to draft view if draftQuoteJson is loaded, otherwise PDF
  setPanelMode(draftQuoteJson ? 'draft' : 'pdf');
}

function clearQuote() {
  document.getElementById('quote-frame').src = '';
  document.getElementById('btn-pdf').style.display = 'none';
  document.getElementById('btn-email-toggle').style.display = 'none';
  document.getElementById('btn-preview').style.display = 'none';
  document.getElementById('email-form').classList.remove('open');
  document.getElementById('mobile-quote-btn').classList.remove('visible');
  draftQuoteJson = null;
  draftDirty = false;
  setPanelMode('placeholder');
  closeQuotePanel();
}

function refreshPreview() {
  if (!currentSessionId) return;
  const frame = document.getElementById('quote-frame');
  frame.src = `/preview/${currentSessionId}?t=${Date.now()}`;
}

// ── STATUS ───────────────────────────────────────────

function setStatus(status) {
  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  const states = {
    gathering:   ['#7A9E6A', 'Gathering information'],
    quote_ready: ['#6A9AAA', 'Quote ready'],
    email_ready: ['#9AAA6A', 'Ready to send'],
    sent:        ['#5A5048', 'Sent'],
  };
  const [color, label] = states[status] || ['#5A5048', status || 'Ready'];
  dot.style.background = color;
  text.textContent = label;
}

// ── QUOTE TOGGLES ────────────────────────────────────────────────────────
function cycleToggle(key, options) {
  const current = quoteToggles[key];
  const idx = options.indexOf(current);
  const next = options[(idx + 1) % options.length];
  quoteToggles[key] = next;
  const btn = document.getElementById('toggle-' + key);
  btn.textContent = next;
  btn.classList.add('active');
  // Save toggle state for this session
  if (currentSessionId) toggleStateBySession.set(currentSessionId, { ...quoteToggles });
}

function saveTogglesForSession(sessionId) {
  if (sessionId) toggleStateBySession.set(sessionId, { ...quoteToggles });
  // Persist to server so toggles survive page refresh
  if (sessionId) {
    fetch('/api/sessions/' + sessionId + '/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toggles: { ...quoteToggles } }),
    }).catch(() => {});
  }
}

function restoreTogglesForSession(sessionId) {
  const saved = sessionId ? toggleStateBySession.get(sessionId) : null;
  if (saved) {
    Object.assign(quoteToggles, saved);
  }
  // Also try to load from server (async — in-memory cache takes priority for speed)
  if (sessionId && !saved) {
    fetch('/api/sessions/' + sessionId).then(r => r.json()).then(s => {
      const serverToggles = s.emailMeta && s.emailMeta._toggles;
      if (serverToggles) {
        toggleStateBySession.set(sessionId, serverToggles);
        Object.assign(quoteToggles, serverToggles);
        for (const [key, val] of Object.entries(quoteToggles)) {
          const btn = document.getElementById('toggle-' + key);
          if (btn) btn.textContent = val;
        }
      }
    }).catch(() => {});
  }
  // Update the buttons to match
  for (const [key, val] of Object.entries(quoteToggles)) {
    const btn = document.getElementById('toggle-' + key);
    if (btn) btn.textContent = val;
  }
}

function getToggleContext() {
  // Returns a string injected into user messages so Claude knows the settings
  const parts = [];
  parts.push(`[Language: ${quoteToggles.lang === 'FR' ? 'French' : 'English'}]`);
  parts.push(`[Scope: ${quoteToggles.scope}]`);
  parts.push(`[Paint tier: ${quoteToggles.tier}]`);
  parts.push(`[Paint prices in quote: ${quoteToggles.prices === 'Paint prices' ? 'show' : 'hide'}]`);
  parts.push(`[Pricing mode: ${quoteToggles.pricing === 'Price ranges' ? 'ranges' : 'fixed'}]`);
  return parts.join(' ');
}

function handleKey(e) {
  // On mobile: Enter creates a new line. Only the Send button sends.
  // On desktop: Enter sends, Shift+Enter creates a new line.
  const isMobile = window.innerWidth <= 768;
  if (e.key === 'Enter' && !e.shiftKey && !isMobile) {
    e.preventDefault();
    if (isSending) return;
    sendMessage();
  }
}

// ── CONVERT TO JOB ──────────────────────────────────

async function convertViaStatusBadge(sessionId) {
  // Fetch session to get quote data for pre-fills
  let session;
  try {
    const res = await fetch('/api/sessions/' + sessionId);
    session = await res.json();
  } catch (e) { alert('Could not load session'); return; }

  // Step 1: Cash or Declared?
  const typeChoice = prompt('Payment type:\n  1. Declared (taxes apply)\n  2. Cash (no taxes)\n\nEnter 1 or 2:');
  if (!typeChoice) return;
  const isCash = typeChoice.trim() === '2';
  const paymentType = isCash ? 'cash' : 'declared';

  // Step 2: Agreed total — pre-fill based on type
  const quoteJson = session.quoteJson || (session.quote_json ? JSON.parse(session.quote_json) : null);
  let preFill = 0;
  if (quoteJson && quoteJson.sections) {
    let subtotal = 0;
    for (const sec of quoteJson.sections) {
      if (sec.excluded || sec.optional) continue;
      subtotal += sec.total || 0;
    }
    // Round to nearest $50
    subtotal = Math.round(subtotal / 50) * 50;
    if (isCash) {
      preFill = subtotal; // pre-tax for cash
    } else {
      preFill = Math.round(subtotal * 1.14975); // with taxes for declared
    }
  }

  const agreedStr = prompt(
    (isCash ? 'Cash' : 'Declared') + ' — Agreed total ($):\n\n' +
    '(Pre-filled with ' + (isCash ? 'pre-tax subtotal' : 'grand total incl. taxes') + '.\n' +
    'Edit if negotiated differently.)',
    String(preFill)
  );
  if (!agreedStr) return;
  const agreedTotal = parseFloat(agreedStr);
  if (!agreedTotal || agreedTotal <= 0) { alert('Invalid amount'); return; }

  // Step 3: Convert
  try {
    const res = await fetch('/api/sessions/' + sessionId + '/convert-to-job', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentType,
        agreedTotal,
        clientName: session.client_name || (quoteJson && quoteJson.clientName) || undefined,
        address: session.address || (quoteJson && quoteJson.address) || undefined,
        clientEmail: session.email_recipient || undefined,
        language: (quoteJson && quoteJson.modalities && quoteJson.modalities.language) || 'french',
      }),
    });
    const data = await res.json();
    if (res.ok) {
      invalidateSessionCache();
      loadSidebar();
      invalidateJobsCache();
      if (typeof loadJobs === 'function') loadJobs();
      alert('Job created: ' + (data.job_number || 'OK'));
    } else {
      alert(data.error || 'Conversion failed');
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

function openConvertFromCurrentSession() {
  if (!currentSessionId) return;
  // Fetch session data to prefill modal
  fetch('/api/sessions/' + currentSessionId)
    .then(r => r.json())
    .then(s => {
      openConvertModal(s.id, s.client_name, s.address, s.email_recipient);
    });
}

function updateConvertButton(session) {
  const btn = document.getElementById('convert-to-job-btn');
  if (!btn) return;
  // Show only if quote is ready and not already converted
  if (session && session.status === 'quote_ready' && !session.converted_job_id) {
    btn.style.display = '';
  } else {
    btn.style.display = 'none';
  }
}

async function confirmConvertToJob() {
  if (!convertingSessionId) return;
  const btn = document.querySelector('.btn-convert-confirm');
  btn.textContent = 'Creating...';
  btn.disabled = true;
  try {
    const res = await fetch('/api/sessions/' + convertingSessionId + '/convert-to-job', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobNumber: document.getElementById('convert-job-number').value || undefined,
        clientName: document.getElementById('convert-client-name').value || undefined,
        address: document.getElementById('convert-address').value || undefined,
        clientEmail: document.getElementById('convert-client-email').value || undefined,
        language: document.getElementById('convert-language').value,
        projectType: document.getElementById('convert-project-type').value,
        paymentType: document.getElementById('convert-payment-type').value,
        agreedTotal: document.getElementById('convert-agreed-total').value || undefined,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      invalidateSessionCache();
      invalidateJobsCache();
      closeConvertModal();
      mobileNavTo('jobs');
    } else {
      alert(data.error || 'Failed to create job');
    }
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    btn.textContent = 'Create Job';
    btn.disabled = false;
  }
}

// Convert to Job modal helpers
function openConvertModal(sessionId, clientName, address, email) {
  convertingSessionId = sessionId;
  document.getElementById('convert-client-name').value = clientName || '';
  document.getElementById('convert-address').value = address || '';
  document.getElementById('convert-client-email').value = email || '';
  document.getElementById('convert-job-number').value = '';
  document.getElementById('convert-payment-type').value = 'declared';
  document.getElementById('convert-agreed-total').value = '';
  document.getElementById('convert-agreed-total-row').style.display = 'none';
  document.getElementById('convert-modal').classList.add('visible');
}

function toggleAgreedTotal() {
  const isCash = document.getElementById('convert-payment-type').value === 'cash';
  document.getElementById('convert-agreed-total-row').style.display = isCash ? '' : 'none';
}

function closeConvertModal() {
  document.getElementById('convert-modal').classList.remove('visible');
  convertingSessionId = null;
}

// ── FILE HANDLING ────────────────────────────────────

function onFilesSelected(event) {
  addFilesToQueue(Array.from(event.target.files || []));
  event.target.value = '';
}

function addFilesToQueue(files) {
  if (isSending) return;
  const validFiles = [];
  let rejectedCount = 0;
  let overflowCount = 0;

  for (const file of files || []) {
    if (!isImageFile(file)) {
      rejectedCount += 1;
    } else if (pendingFiles.length + validFiles.length < MAX_CLIENT_IMAGE_COUNT) {
      validFiles.push(file);
    } else {
      overflowCount += 1;
    }
  }

  if (validFiles.length) {
    pendingFiles = pendingFiles.concat(validFiles);
    renderImagePreviews();
  }

  if (rejectedCount) {
    appendMessage('system', 'Images only.');
  }

  if (overflowCount) {
    appendMessage('system', `Limit ${MAX_CLIENT_IMAGE_COUNT} images. Extra files ignored.`);
  }
}

function isImageFile(file) {
  if (!file || typeof file !== 'object') return false;
  if (typeof file.type === 'string' && file.type.startsWith('image/')) return true;
  return /\.(avif|gif|heic|heif|jpeg|jpg|png|webp|bmp|tif|tiff)$/i.test(file.name || '');
}

function renderImagePreviews() {
  const bar = document.getElementById('image-preview-bar');
  revokePendingPreviewUrls();
  bar.innerHTML = '';
  pendingPreviewUrls = [];
  pendingFiles.forEach((file, i) => {
    const url = URL.createObjectURL(file);
    pendingPreviewUrls.push(url);
    const div = document.createElement('div');
    div.className = 'img-thumb';
    div.innerHTML = `<img src="${url}"><button class="remove-img" onclick="removeImage(${i})">×</button>`;
    bar.appendChild(div);
  });
}

function removeImage(index) {
  pendingFiles.splice(index, 1);
  renderImagePreviews();
}

function clearAttachmentQueue() {
  revokePendingPreviewUrls();
  pendingFiles = [];
  pendingPreviewUrls = [];
  dragDepth = 0;
  setDropActive(false);
  document.getElementById('image-preview-bar').innerHTML = '';
}

function isFileDrag(event) {
  const dt = event && event.dataTransfer;
  if (!dt) return false;
  if (dt.types && Array.from(dt.types).includes('Files')) return true;
  if (dt.items) {
    return Array.from(dt.items).some((item) => item.kind === 'file');
  }
  return false;
}

function setDropActive(active) {
  document.body.classList.toggle('drop-active', active);
}

function handleDocumentDragEnter(event) {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  dragDepth += 1;
  setDropActive(true);
}

function handleDocumentDragOver(event) {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  setDropActive(true);
}

function handleDocumentDragLeave(event) {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) setDropActive(false);
}

function handleDocumentDrop(event) {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  clearDropState();
  addFilesToQueue(Array.from(event.dataTransfer.files || []));
}

function clearDropState() {
  dragDepth = 0;
  setDropActive(false);
}

function setSendingState(active) {
  isSending = active;
  document.getElementById('send-btn').disabled = active;
  document.getElementById('message-input').disabled = active;
  document.getElementById('attach-btn').disabled = active;
  document.getElementById('file-input').disabled = active;
}

function revokePendingPreviewUrls() {
  for (const url of pendingPreviewUrls) {
    URL.revokeObjectURL(url);
  }
}
