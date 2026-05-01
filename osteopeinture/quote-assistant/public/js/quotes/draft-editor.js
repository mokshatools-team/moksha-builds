// OP Hub — Draft Editor Functions
// Depends on: state.js, api.js, shared.js, panel.js

// ── DRAFT EDITOR ────────────────────────────────────
function loadDraftEditor(sessionId) {
  const draft = document.getElementById('quote-draft');
  if (!draftQuoteJson) {
    draft.innerHTML = '<p style="color:var(--text-3);font-size:12px;padding:20px">No quote data yet. Use the chat to generate a quote first.</p>';
    return;
  }
  renderDraftEditor(draftQuoteJson);
}

function renderDraftEditor(q) {
  const draft = document.getElementById('quote-draft');
  let html = '<div class="draft-status" id="draft-save-status"></div>';

  // Header fields
  html += '<div class="draft-header-grid">';
  html += fieldRow('Client', 'text', q.clientName || '', 'clientName');
  html += fieldRow('Email', 'email', q.clientEmail || '', 'clientEmail');
  html += fieldRow('Address', 'text', q.address || '', 'address');
  html += fieldRow('Project', 'text', q.projectId || '', 'projectId');
  html += fieldRow('Date', 'text', q.date || '', 'date');
  html += fieldRow('Type', 'text', q.projectType || '', 'projectType');
  html += '</div>';

  // Sections grouped by floor
  const sections = q.sections || [];
  let currentFloor = null;
  let optionalDividerAdded = false;

  for (let si = 0; si < sections.length; si++) {
    const sec = sections[si];
    const floor = sec.floor || null;

    // New floor group
    if (floor && floor !== currentFloor) {
      if (currentFloor) {
        html += '<button class="draft-add-btn" onclick="draftAddSectionInGroup(\'' + esc(currentFloor).replace(/'/g, "\\'") + '\')" style="margin:4px 0 8px">+ Section</button>';
        html += '</div>'; // close previous group
      }
      currentFloor = floor;
      const gt = computeGroupTotal(sections, floor);
      html += '<div class="draft-group" data-floor="' + esc(floor) + '" ondragover="draftDragOver(event)" ondrop="draftDrop(event,\'group\',' + si + ')" ondragleave="draftDragLeave(event)">';
      html += '<div class="draft-group-label">';
      html += '<span class="drag-handle" draggable="true" ondragstart="draftDragStart(event,\'group\',' + si + ')" ondragend="draftDragEnd(event)">&#x2630;</span>';
      html += '<input type="text" value="' + esc(floor) + '" data-field="floor" data-group="' + esc(floor) + '" oninput="draftUpdateFloor(this)" style="flex:1;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px">';
      html += '<span class="group-total">' + fmtDraft(gt) + '</span>';
      html += '</div>';
    } else if (!floor && currentFloor && !sec.optional && !sec.excluded) {
      // Continue in same group (floor inherited)
    } else if (!floor && !currentFloor && !sec.optional && !sec.excluded) {
      // Standalone section without floor — start ungrouped
    }

    // Optional/excluded header
    if (sec.optional && !optionalDividerAdded) {
      optionalDividerAdded = true;
      if (currentFloor) {
        html += '<button class="draft-add-btn" onclick="draftAddSectionInGroup(\'' + esc(currentFloor).replace(/'/g, "\\'") + '\')" style="margin:4px 0 8px">+ Section</button>';
        html += '</div>'; currentFloor = null;
      }
      html += '<div class="draft-group-label" style="margin-top:20px;border-top:2px solid var(--text);border-bottom:2px solid var(--text);font-style:italic;color:var(--text-2)">OPTIONS ADDITIONNELLES</div>';
    }
    if (sec.excluded && !sec.optional) {
      if (currentFloor) {
        html += '<button class="draft-add-btn" onclick="draftAddSectionInGroup(\'' + esc(currentFloor).replace(/'/g, "\\'") + '\')" style="margin:4px 0 8px">+ Section</button>';
        html += '</div>'; currentFloor = null;
      }
    }

    const itemSum = (sec.items || []).reduce((s, i) => s + (i.price || 0), 0);
    const isOverride = sec._totalOverride === true;
    const secTotal = isOverride ? (sec.total || 0) : itemSum;
    const secName = sec.name || sec.title || '';
    const prefix = sec.optional ? '[+' : '';
    const suffix = sec.optional ? ']' : '';

    const secClass = 'draft-section' + (sec.excluded ? ' sec-excluded' : '') + (sec.optional ? ' sec-optional' : '');
    html += '<div class="' + secClass + '" data-si="' + si + '">';
    html += '<div class="draft-section-hdr" ondragover="draftDragOver(event)" ondrop="draftDrop(event,\'section\',' + si + ')" ondragleave="draftDragLeave(event)">';
    html += '<span class="drag-handle" draggable="true" ondragstart="draftDragStart(event,\'section\',' + si + ')" ondragend="draftDragEnd(event)">&#x2630;</span>';
    // Status tag
    if (sec.optional) html += '<span class="sec-tag tag-opt" title="Optional — not in total">OPT</span>';
    if (sec.excluded) html += '<span class="sec-tag tag-excl" title="Excluded — not in total">EXCL</span>';
    html += '<input class="sec-name" type="text" value="' + esc(secName) + '" data-si="' + si + '" data-field="name" oninput="draftUpdateSection(this)">';
    // Editable total
    html += '<input class="sec-total-input" type="number" value="' + secTotal + '" data-si="' + si + '" oninput="draftUpdateSectionTotal(this)" onblur="draftSaveNow()" title="' + (isOverride ? 'Manual override' : 'Auto-sum from items') + '" style="' + (isOverride ? 'color:var(--accent);font-weight:700' : '') + '">';
    html += '<button class="sec-lock" onclick="draftToggleOverride(' + si + ')" title="' + (isOverride ? 'Unlock' : 'Lock') + '">' + (isOverride ? '&#x1f512;' : '&#x1f513;') + '</button>';
    // Section menu: toggle optional/excluded, delete
    html += '<div class="sec-menu">';
    html += '<button class="sec-menu-btn" onclick="draftToggleOptional(' + si + ')" title="Toggle optional">' + (sec.optional ? '&#9733;' : '&#9734;') + '</button>';
    html += '<button class="sec-menu-btn" onclick="draftToggleExcluded(' + si + ')" title="Toggle excluded">' + (sec.excluded ? '&#x2612;' : '&#x2610;') + '</button>';
    html += '<button class="item-del" onclick="draftDeleteSection(' + si + ')" title="Remove section">&times;</button>';
    html += '</div>';
    html += '</div>';

    // Items (H3)
    for (let ii = 0; ii < (sec.items || []).length; ii++) {
      const item = sec.items[ii];
      html += '<div class="draft-item" data-si="' + si + '" data-ii="' + ii + '" ondragover="draftDragOver(event)" ondrop="draftDrop(event,\'item\',' + si + ',' + ii + ')" ondragleave="draftDragLeave(event)">';
      html += '<span class="drag-handle" draggable="true" ondragstart="draftDragStart(event,\'item\',' + si + ',' + ii + ')" ondragend="draftDragEnd(event)">&#x2630;</span>';
      html += '<input class="item-desc" type="text" value="' + esc(item.description || '') + '" data-si="' + si + '" data-ii="' + ii + '" data-field="description" oninput="draftUpdateItem(this)">';
      html += '<input class="item-price" type="number" value="' + (item.price || 0) + '" data-si="' + si + '" data-ii="' + ii + '" data-field="price" oninput="draftUpdateItem(this)" onblur="draftSaveNow()"' + (isOverride ? ' style="color:var(--text-4)"' : '') + '>';
      html += '<button class="item-del" onclick="draftDeleteItem(' + si + ',' + ii + ')" title="Remove">&times;</button>';
      html += '</div>';
    }
    html += '<button class="draft-add-btn" onclick="draftAddItem(' + si + ')" style="margin-left:14px">+ Item</button>';
    html += '</div>';
  }
  if (currentFloor) {
    // Add section button inside the group
    html += '<button class="draft-add-btn" onclick="draftAddSectionInGroup(\'' + esc(currentFloor).replace(/'/g, "\\'") + '\')" style="margin:4px 0 8px">+ Section</button>';
    html += '</div>'; // close last group
  }

  // Add buttons at bottom
  html += '<div style="display:flex;gap:8px;margin:12px 0">';
  html += '<button class="draft-add-btn" onclick="draftAddGroup()">+ Group</button>';
  html += '<button class="draft-add-btn" onclick="draftAddSection()">+ Section</button>';
  html += '</div>';

  // Terms
  html += '<div class="draft-terms-section">';
  html += '<div class="terms-label">Includes</div>';
  const includes = (q.terms?.includes || []).join('\n');
  html += '<textarea data-field="terms.includes" oninput="draftUpdateField(this);autoGrow(this)" onblur="draftSaveNow()">' + esc(includes) + '</textarea>';
  html += '<div class="terms-label" style="margin-top:8px">Conditions</div>';
  const conditions = (q.terms?.conditions || []).join('\n');
  html += '<textarea data-field="terms.conditions" oninput="draftUpdateField(this);autoGrow(this)" onblur="draftSaveNow()">' + esc(conditions) + '</textarea>';
  html += '</div>';

  // Modalities
  const mod = q.modalities || {};
  html += '<div class="draft-modalities">';
  html += fieldRow('Start', 'text', mod.startDate || '', 'modalities.startDate');
  html += fieldRow('Duration', 'text', mod.duration || '', 'modalities.duration');
  html += fieldRow('Deposit', 'number', mod.deposit || 0, 'modalities.deposit');
  html += fieldRow('Payment', 'text', mod.paymentMethod || '', 'modalities.paymentMethod');
  html += '</div>';

  // Totals
  const totals = computeDraftTotals(q);
  html += '<div class="draft-totals" id="draft-totals">';
  html += totalRow('TOTAL', totals.subtotal, false);
  html += totalRow('TPS', totals.tps, false);
  html += totalRow('TVQ', totals.tvq, false);
  html += totalRow('GRAND TOTAL', totals.grand, true);
  html += '</div>';

  // Format button
  html += '<div class="draft-actions">';
  html += '<button onclick="draftFormatQuote()">Format Quote</button>';
  html += '</div>';

  draft.innerHTML = html;
  // Auto-grow all textareas
  draft.querySelectorAll('textarea').forEach(ta => autoGrow(ta));
}

// Helpers
function fieldRow(label, type, value, path) {
  return '<div class="draft-field-label">' + label + '</div>' +
    '<input type="' + type + '" value="' + esc(String(value)) + '" data-field="' + path + '" oninput="draftUpdateField(this)" onblur="draftSaveNow()">';
}

function totalRow(label, amount, grand) {
  const cls = grand ? 'total-row grand' : 'total-row';
  return '<div class="' + cls + '"><span class="total-label">' + label + '</span><span class="total-val">' + fmtDraft(amount, grand) + '</span></div>';
}

function fmtDraft(n, cents) {
  if (n == null) return '';
  const d = cents ? 2 : 0;
  return Number(n).toLocaleString('fr-CA', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' $';
}

function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function computeGroupTotal(sections, floor) {
  let total = 0;
  let active = false;
  for (const sec of sections) {
    if (sec.excluded || sec.optional) { active = false; continue; }
    if (sec.floor === floor) active = true;
    else if (sec.floor && sec.floor !== floor) active = false;
    if (active) total += sec.total != null ? sec.total : (sec.items || []).reduce((s, i) => s + (i.price || 0), 0);
  }
  return total;
}

function computeDraftTotals(q) {
  let subtotal = 0;
  for (const sec of (q.sections || [])) {
    if (sec.excluded || sec.optional) continue;
    subtotal += sec.total != null ? sec.total : (sec.items || []).reduce((s, i) => s + (i.price || 0), 0);
  }
  const tps = Math.round(subtotal * 0.05 * 100) / 100;
  const tvq = Math.round(subtotal * 0.09975 * 100) / 100;
  return { subtotal, tps, tvq, grand: subtotal + tps + tvq };
}

// ── DRAFT STATE UPDATES ─────────────────────────────

function draftUpdateField(el) {
  if (!draftQuoteJson) return;
  const path = el.dataset.field;
  const val = el.type === 'number' ? Number(el.value) || 0 : el.value;

  if (path === 'terms.includes') {
    if (!draftQuoteJson.terms) draftQuoteJson.terms = {};
    draftQuoteJson.terms.includes = el.value.split('\n').filter(l => l.trim());
  } else if (path === 'terms.conditions') {
    if (!draftQuoteJson.terms) draftQuoteJson.terms = {};
    draftQuoteJson.terms.conditions = el.value.split('\n').filter(l => l.trim());
  } else if (path.startsWith('modalities.')) {
    const key = path.split('.')[1];
    if (!draftQuoteJson.modalities) draftQuoteJson.modalities = {};
    draftQuoteJson.modalities[key] = val;
  } else {
    draftQuoteJson[path] = val;
  }
  draftMarkDirty();
}

function draftUpdateSection(el) {
  const si = parseInt(el.dataset.si);
  const sec = draftQuoteJson.sections[si];
  if (!sec) return;
  // Update name or title depending on which exists
  if (sec.name !== undefined) sec.name = el.value;
  else if (sec.title !== undefined) sec.title = el.value;
  else sec.name = el.value;
  draftMarkDirty();
}

function draftUpdateFloor(el) {
  const oldFloor = el.dataset.group;
  const newFloor = el.value;
  for (const sec of draftQuoteJson.sections) {
    if (sec.floor === oldFloor) sec.floor = newFloor;
  }
  el.dataset.group = newFloor;
  draftMarkDirty();
}

function draftUpdateItem(el) {
  const si = parseInt(el.dataset.si);
  const ii = parseInt(el.dataset.ii);
  const field = el.dataset.field;
  const sec = draftQuoteJson.sections[si];
  if (!sec || !sec.items || !sec.items[ii]) return;

  if (field === 'price') {
    sec.items[ii].price = Number(el.value) || 0;
    // Recompute section total from items (unless manually overridden)
    if (!sec._totalOverride) sec.total = sec.items.reduce((s, i) => s + (i.price || 0), 0);
    refreshDraftTotals();
  } else {
    sec.items[ii][field] = el.value;
  }
  draftMarkDirty();
}

function refreshDraftTotals() {
  const totals = computeDraftTotals(draftQuoteJson);
  const container = document.getElementById('draft-totals');
  if (!container) return;
  container.innerHTML =
    totalRow('TOTAL', totals.subtotal, false) +
    totalRow('TPS', totals.tps, false) +
    totalRow('TVQ', totals.tvq, false) +
    totalRow('GRAND TOTAL', totals.grand, true);
  // Also update section totals and group totals in the DOM
  document.querySelectorAll('#quote-draft .draft-section').forEach(el => {
    const si = parseInt(el.dataset.si);
    const sec = draftQuoteJson.sections[si];
    if (!sec) return;
    const t = sec.total != null ? sec.total : (sec.items || []).reduce((s, i) => s + (i.price || 0), 0);
    const span = el.querySelector('.sec-total');
    if (span) span.textContent = (sec.optional ? '[+' : '') + fmtDraft(t) + (sec.optional ? ']' : '');
  });
  document.querySelectorAll('#quote-draft .draft-group').forEach(el => {
    const floor = el.dataset.floor;
    if (!floor) return;
    const gt = computeGroupTotal(draftQuoteJson.sections, floor);
    const span = el.querySelector('.group-total');
    if (span) span.textContent = fmtDraft(gt);
  });
}

// ── DRAFT ADD / DELETE / UNDO ────────────────────────

// (showQuoteUndoToast, undoQuoteChange → shared.js)

function draftShowUndo(label) {
  let toast = document.getElementById('draft-undo-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'draft-undo-toast';
    toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:8px 16px;border-radius:6px;font-size:12px;z-index:999;display:flex;gap:12px;align-items:center;box-shadow:0 2px 8px rgba(0,0,0,0.3)';
    document.body.appendChild(toast);
  }
  toast.innerHTML = label + ' <button onclick="draftUndo()" style="background:var(--accent);color:#fff;border:none;padding:3px 10px;border-radius:3px;cursor:pointer;font-size:11px;font-weight:600">Undo</button>';
  toast.style.display = 'flex';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.display = 'none'; draftUndoStack = []; }, 5000);
}

function draftUndo() {
  if (!draftUndoStack.length) return;
  const action = draftUndoStack.pop();
  if (action.type === 'deleteItem') {
    const sec = draftQuoteJson.sections[action.si];
    if (sec) {
      if (!sec.items) sec.items = [];
      sec.items.splice(action.ii, 0, action.data);
      if (!sec._totalOverride) sec.total = sec.items.reduce((s, i) => s + (i.price || 0), 0);
    }
  } else if (action.type === 'deleteSection') {
    draftQuoteJson.sections.splice(action.si, 0, action.data);
  }
  renderDraftEditor(draftQuoteJson);
  draftMarkDirty();
  const toast = document.getElementById('draft-undo-toast');
  if (toast) toast.style.display = 'none';
}

// Listen for Cmd+Z / Ctrl+Z
document.addEventListener('keydown', function(e) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'z' && draftUndoStack.length && currentPanelMode === 'draft') {
    e.preventDefault();
    draftUndo();
  }
});

function draftAddItem(si) {
  const sec = draftQuoteJson.sections[si];
  if (!sec) return;
  if (!sec.items) sec.items = [];
  sec.items.push({ description: '', price: 0 });
  renderDraftEditor(draftQuoteJson);
  const items = document.querySelectorAll('#quote-draft .draft-section[data-si="' + si + '"] .item-desc');
  if (items.length) items[items.length - 1].focus();
  draftMarkDirty();
}

function draftDeleteItem(si, ii) {
  const sec = draftQuoteJson.sections[si];
  if (!sec || !sec.items) return;
  const removed = sec.items.splice(ii, 1)[0];
  if (!sec._totalOverride) sec.total = sec.items.reduce((s, i) => s + (i.price || 0), 0);
  draftUndoStack.push({ type: 'deleteItem', si, ii, data: removed });
  renderDraftEditor(draftQuoteJson);
  draftMarkDirty();
  draftShowUndo('Item removed');
}

function draftDeleteSection(si) {
  const removed = draftQuoteJson.sections.splice(si, 1)[0];
  draftUndoStack.push({ type: 'deleteSection', si, data: removed });
  renderDraftEditor(draftQuoteJson);
  draftMarkDirty();
  draftShowUndo('Section removed');
}

function draftAddSection() {
  if (!draftQuoteJson.sections) draftQuoteJson.sections = [];
  const newSec = { name: '', total: 0, items: [] };
  let insertAt = draftQuoteJson.sections.length;
  for (let i = 0; i < draftQuoteJson.sections.length; i++) {
    if (draftQuoteJson.sections[i].optional || draftQuoteJson.sections[i].excluded) { insertAt = i; break; }
  }
  draftQuoteJson.sections.splice(insertAt, 0, newSec);
  renderDraftEditor(draftQuoteJson);
  draftMarkDirty();
}

function draftAddSectionInGroup(floor) {
  if (!draftQuoteJson.sections) draftQuoteJson.sections = [];
  const newSec = { floor, name: '', total: 0, items: [] };
  // Insert after last section with this floor
  let insertAt = 0;
  for (let i = 0; i < draftQuoteJson.sections.length; i++) {
    if (draftQuoteJson.sections[i].floor === floor) insertAt = i + 1;
    // Also count inherited (no floor, following a floor match)
    else if (!draftQuoteJson.sections[i].floor && !draftQuoteJson.sections[i].optional && !draftQuoteJson.sections[i].excluded && i > 0 && insertAt === i) insertAt = i + 1;
  }
  draftQuoteJson.sections.splice(insertAt, 0, newSec);
  renderDraftEditor(draftQuoteJson);
  draftMarkDirty();
}

function draftAddGroup() {
  if (!draftQuoteJson.sections) draftQuoteJson.sections = [];
  const groupName = 'NEW GROUP';
  const newSec = { floor: groupName, name: '', total: 0, items: [] };
  let insertAt = draftQuoteJson.sections.length;
  for (let i = 0; i < draftQuoteJson.sections.length; i++) {
    if (draftQuoteJson.sections[i].optional || draftQuoteJson.sections[i].excluded) { insertAt = i; break; }
  }
  draftQuoteJson.sections.splice(insertAt, 0, newSec);
  renderDraftEditor(draftQuoteJson);
  draftMarkDirty();
}

// ── DRAFT TOTAL OVERRIDE ────────────────────────────

function draftUpdateSectionTotal(el) {
  const si = parseInt(el.dataset.si);
  const sec = draftQuoteJson.sections[si];
  if (!sec) return;
  sec.total = Number(el.value) || 0;
  sec._totalOverride = true;
  refreshDraftTotals();
  draftMarkDirty();
}

function draftToggleOptional(si) {
  const sec = draftQuoteJson.sections[si];
  if (!sec) return;
  sec.optional = !sec.optional;
  if (sec.optional) sec.excluded = false; // can't be both
  renderDraftEditor(draftQuoteJson);
  draftMarkDirty();
}

function draftToggleExcluded(si) {
  const sec = draftQuoteJson.sections[si];
  if (!sec) return;
  sec.excluded = !sec.excluded;
  if (sec.excluded) sec.optional = false; // can't be both
  renderDraftEditor(draftQuoteJson);
  draftMarkDirty();
}

// ── DRAFT DRAG-AND-DROP ─────────────────────────────

function draftDragStart(e, type, si, ii) {
  draftDragData = { type, si, ii };
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', ''); // required for Firefox
  var dragEl = e.target.closest('.draft-section, .draft-item, .draft-group');
  if (dragEl) setTimeout(function() { dragEl.classList.add('dragging'); }, 0);
}

function draftDragOver(e) {
  if (!draftDragData) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const target = e.target.closest('.draft-section, .draft-item, .draft-group');
  if (target) target.classList.add('drag-over');
}

function draftDragLeave(e) {
  const target = e.target.closest('.draft-section, .draft-item, .draft-group');
  if (target) target.classList.remove('drag-over');
}

function draftDragEnd(e) {
  draftDragData = null;
  document.querySelectorAll('#quote-draft .drag-over, #quote-draft .dragging').forEach(el => {
    el.classList.remove('drag-over', 'dragging');
  });
}

function draftDrop(e, targetType, targetSi, targetIi) {
  e.preventDefault();
  if (!draftDragData) return;
  const src = draftDragData;
  draftDragData = null;

  document.querySelectorAll('#quote-draft .drag-over').forEach(el => el.classList.remove('drag-over'));

  if (src.type === 'group' && (targetType === 'group' || targetType === 'section')) {
    // Move entire group (all sections with same floor) to target position
    var srcFloor = draftQuoteJson.sections[src.si] && (draftQuoteJson.sections[src.si].floor || draftQuoteJson.sections[src.si].title);
    if (srcFloor) {
      // Collect all sections in this group
      var groupSections = [];
      var remaining = [];
      for (var i = 0; i < draftQuoteJson.sections.length; i++) {
        var s = draftQuoteJson.sections[i];
        var sFloor = s.floor || s.title || '';
        if (sFloor === srcFloor) groupSections.push(s);
        else remaining.push(s);
      }
      // Find insert position in remaining array
      var insertAt = 0;
      for (var j = 0; j < remaining.length; j++) {
        if (j >= targetSi - groupSections.length + (src.si < targetSi ? 0 : groupSections.length)) break;
        insertAt = j + 1;
      }
      // Insert group at target position
      remaining.splice(insertAt, 0, ...groupSections);
      draftQuoteJson.sections = remaining;
      renderDraftEditor(draftQuoteJson);
      draftMarkDirty();
    }
  } else if (src.type === 'section' && targetType === 'section' && src.si !== targetSi) {
    // Move section
    const [moved] = draftQuoteJson.sections.splice(src.si, 1);
    const insertAt = src.si < targetSi ? targetSi - 1 : targetSi;
    draftQuoteJson.sections.splice(insertAt, 0, moved);
    renderDraftEditor(draftQuoteJson);
    draftMarkDirty();
  } else if (src.type === 'item' && targetType === 'item') {
    if (src.si === targetSi && src.ii !== targetIi) {
      // Reorder within same section
      const sec = draftQuoteJson.sections[src.si];
      const [moved] = sec.items.splice(src.ii, 1);
      const insertAt = src.ii < targetIi ? targetIi - 1 : targetIi;
      sec.items.splice(insertAt, 0, moved);
      renderDraftEditor(draftQuoteJson);
      draftMarkDirty();
    } else if (src.si !== targetSi) {
      // Move item between sections
      const srcSec = draftQuoteJson.sections[src.si];
      const dstSec = draftQuoteJson.sections[targetSi];
      const [moved] = srcSec.items.splice(src.ii, 1);
      if (!srcSec._totalOverride) srcSec.total = srcSec.items.reduce((s, i) => s + (i.price || 0), 0);
      if (!dstSec.items) dstSec.items = [];
      dstSec.items.splice(targetIi, 0, moved);
      if (!dstSec._totalOverride) dstSec.total = dstSec.items.reduce((s, i) => s + (i.price || 0), 0);
      renderDraftEditor(draftQuoteJson);
      draftMarkDirty();
    }
  }
}

function draftToggleOverride(si) {
  const sec = draftQuoteJson.sections[si];
  if (!sec) return;
  if (sec._totalOverride) {
    // Revert to auto-sum
    delete sec._totalOverride;
    sec.total = (sec.items || []).reduce((s, i) => s + (i.price || 0), 0);
  } else {
    // Set override
    sec._totalOverride = true;
  }
  renderDraftEditor(draftQuoteJson);
  draftMarkDirty();
}

// ── DRAFT SAVE ──────────────────────────────────────

function draftMarkDirty() {
  draftDirty = true;
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(draftSaveNow, 800);
}

async function draftSaveNow() {
  clearTimeout(draftSaveTimer);
  if (!draftQuoteJson || !currentSessionId || !draftDirty) return;
  draftDirty = false;
  const version = ++draftSaveVersion;
  const statusEl = document.getElementById('draft-save-status');
  if (statusEl) { statusEl.textContent = 'Saving...'; statusEl.classList.add('saving'); }
  try {
    const res = await fetch('/api/sessions/' + currentSessionId + '/adjust-quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Strip internal UI flags before saving
      body: JSON.stringify({ quoteJson: JSON.parse(JSON.stringify(draftQuoteJson, (k, v) => k === '_totalOverride' ? undefined : v)) }),
    });
    if (version < draftSaveVersion) return; // stale save
    if (res.ok && statusEl) {
      statusEl.textContent = 'Saved';
      statusEl.classList.remove('saving');
      setTimeout(() => { if (statusEl.textContent === 'Saved') statusEl.textContent = ''; }, 1500);
    }
  } catch (e) {
    if (statusEl) { statusEl.textContent = 'Save failed'; statusEl.classList.remove('saving'); }
  }
}

function draftFormatQuote() {
  draftSaveNow().then(() => {
    setPanelMode('pdf');
    refreshPreview();
  });
}
