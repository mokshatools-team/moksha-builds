// OP Hub — Quote Sidebar Functions
// Depends on: state.js, api.js, shared.js

// ── SIDEBAR ──────────────────────────────────────────

async function loadSidebar() {
  const allSessions = await fetchSessions();
  // Hide quotes that have been converted to jobs — they live in the Jobs sidebar now.
  const activeSessions = allSessions.filter(s => !s.converted_job_id && s.status !== 'archived');
  const archivedSessions = allSessions.filter(s => !s.converted_job_id && s.status === 'archived');
  const list = document.getElementById('sidebar-list');

  if (!activeSessions.length && !archivedSessions.length) {
    list.innerHTML = '<div class="sidebar-empty">No quotes yet.<br>Start a new one above.</div>';
    return;
  }

  function renderSessionItem(s, dimmed) {
    const date = new Date(s.updated_at).toLocaleDateString('fr-CA', { month: 'short', day: 'numeric' });
    const client = s.project_id || s.client_name || 'New Quote';
    // Sub-label: show street address if available (already have LASTNAME in the title), otherwise date
    const shortAddress = s.address ? s.address.split(',')[0].trim() : null;
    const subLabel = shortAddress || date;
    const total = s.total_amount ? formatMoney(s.total_amount) + ' $' : '—';
    const active = s.id === currentSessionId ? 'active' : '';
    const effectiveStatus = s.converted_job_id ? 'converted' : (s.status || 'gathering');
    const statusLabel = { gathering: 'In progress', quote_ready: 'Ready', sent: 'Sent', converted: 'Active', declined: 'Declined', archived: 'Archived' }[effectiveStatus] || effectiveStatus;
    const statusClass = effectiveStatus;
    return `<div class="sidebar-item ${active}" onclick="handleSidebarClick('${s.id}')" style="${dimmed ? 'opacity:0.5' : ''}">
      <button class="sidebar-item-rename" onclick="event.stopPropagation();startRenameSession('${s.id}',this.parentElement.querySelector('.sidebar-item-client'))" title="Rename">✎</button>
      <button class="sidebar-item-delete" onclick="event.stopPropagation();deleteSession('${s.id}',this)" title="Delete">×</button>
      <div class="sidebar-item-client" onclick="event.stopPropagation()" ondblclick="startRenameSession('${s.id}',this)">${esc(client)}</div>
      <div class="sidebar-item-meta">
        <span class="sidebar-item-id">${esc(subLabel)}</span>
        <span class="sidebar-item-total">${total}</span>
      </div>
      <select class="sidebar-status-select ${statusClass}" onclick="event.stopPropagation()" onchange="setSessionStatus('${s.id}',this.value,this)">
        <option value="gathering" ${effectiveStatus==='gathering'?'selected':''}>In Progress</option>
        <option value="quote_ready" ${effectiveStatus==='quote_ready'?'selected':''}>Ready</option>
        <option value="sent" ${effectiveStatus==='sent'?'selected':''}>Sent</option>
        <option value="converted" ${effectiveStatus==='converted'?'selected':''}>Accepted</option>
        <option value="declined" ${effectiveStatus==='declined'?'selected':''}>Declined</option>
        <option value="archived" ${effectiveStatus==='archived'?'selected':''}>Archived</option>
      </select>
    </div>`;
  }

  let html = activeSessions.map(s => renderSessionItem(s, false)).join('');
  if (archivedSessions.length) {
    const isOpen = document.getElementById('sidebar-archive-list')?.style.display !== 'none';
    html += '<div onclick="toggleSidebarArchive()" style="padding:14px 16px 6px;font-size:9px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:var(--text-4);font-family:var(--font-sans);cursor:pointer;display:flex;align-items:center;gap:6px;user-select:none"><span id="sidebar-archive-arrow" style="font-size:11px;transition:transform .15s;transform:rotate(' + (isOpen ? '90' : '0') + 'deg)">&#x25B6;</span>Archived (' + archivedSessions.length + ')</div>';
    html += '<div id="sidebar-archive-list" style="display:' + (isOpen ? 'block' : 'none') + '">';
    html += archivedSessions.map(s => renderSessionItem(s, true)).join('');
    html += '</div>';
  }
  list.innerHTML = html;
}

function handleSidebarClick(id) {
  if (isRenaming) return;
  document.querySelectorAll('.sidebar-item').forEach(function(el) {
    el.classList.remove('active');
    el.classList.remove('loading');
  });
  var clicked = event && event.currentTarget;
  if (clicked) {
    clicked.classList.add('active');
    clicked.classList.add('loading');
  }
  loadSession(id).then(function() {
    if (clicked) clicked.classList.remove('loading');
  }).catch(function() {
    if (clicked) clicked.classList.remove('loading');
  });
}

function startRenameSession(id, el) {
  isRenaming = true;
  const currentName = el.textContent.trim();
  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentName;
  input.className = 'form-input';
  input.style.cssText = 'font-size:12px;padding:3px 6px;width:100%;';
  el.textContent = '';
  el.appendChild(input);
  input.focus();
  input.select();

  let finished = false;
  async function finishRename() {
    if (finished) return;
    finished = true;
    const newName = input.value.trim();
    if (newName && newName !== currentName) {
      try {
        await fetch(`/api/sessions/${id}/name`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName }),
        });
        if (currentSessionId === id) {
          document.getElementById('chat-header-title').textContent = newName;
          const badge = document.getElementById('session-badge');
          badge.textContent = newName;
          badge.style.display = '';
        }
      } catch (e) { /* revert on error */ }
    }
    isRenaming = false;
    invalidateSessionCache();
    loadSidebar();
  }

  input.addEventListener('blur', finishRename);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { finished = true; isRenaming = false; el.textContent = currentName; }
  });
}

async function deleteSession(id, btn) {
  // Two-tap confirm: first tap turns red + "Delete?", second tap deletes
  if (_deleteConfirmId !== id) {
    _deleteConfirmId = id;
    if (btn) { btn.textContent = '?'; btn.style.color = '#fff'; btn.style.background = '#c94a4a'; }
    clearTimeout(_deleteConfirmTimer);
    _deleteConfirmTimer = setTimeout(() => {
      _deleteConfirmId = null;
      if (btn) { btn.textContent = '\u00d7'; btn.style.color = ''; btn.style.background = ''; }
    }, 3000);
    return;
  }
  _deleteConfirmId = null;
  clearTimeout(_deleteConfirmTimer);
  try {
    await fetch('/api/sessions/' + id, { method: 'DELETE' });
    if (currentSessionId === id) {
      currentSessionId = null;
      document.getElementById('messages').innerHTML = '<div class="msg system">Select a past quote or start a new one.</div>';
      clearQuote();
      document.getElementById('chat-header-title').textContent = 'New Quote';
      document.getElementById('session-badge').style.display = 'none';
    }
    invalidateSessionCache();
    loadSidebar();
  } catch (e) {
    alert('Failed to delete: ' + e.message);
  }
}

function setActiveSessionInSidebar(id) {
  document.querySelectorAll('.sidebar-item').forEach(function(el) {
    el.classList.remove('active');
    if (el.getAttribute('onclick') && el.getAttribute('onclick').includes(id)) {
      el.classList.add('active');
    }
  });
}

async function setSessionStatus(sessionId, newStatus, selectEl) {
  // "Accepted" triggers the convert-to-job flow
  if (newStatus === 'converted') {
    await convertViaStatusBadge(sessionId);
    return;
  }
  try {
    await fetch('/api/sessions/' + sessionId + '/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    // Update select color immediately
    if (selectEl) {
      selectEl.className = 'sidebar-status-select ' + newStatus;
    }
    invalidateSessionCache();
    loadSidebar();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}
