// OP Hub — Shared Utility Functions
// Depends on state.js

// ── HTML ESCAPING ──────────────────────────────────────
function esc(str) {
  var div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ── CURRENCY FORMATTING ────────────────────────────────
function formatMoney(n) {
  return Math.round(n).toLocaleString('fr-CA');
}

// ── TEXTAREA AUTO-RESIZE (chat input) ──────────────────
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// ── SCROLL HELPERS ─────────────────────────────────────
function scrollToBottom() {
  var m = document.getElementById('messages');
  m.scrollTop = m.scrollHeight;
}

// ── SIDEBAR TOGGLE (mobile) ───────────────────────────
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('visible');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('visible');
}

// ── SIDEBAR COLLAPSE (desktop) ─────────────────────────
function toggleSidebarCollapsed() {
  var collapsed = document.body.classList.toggle('sidebar-collapsed');
  try { localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0'); } catch (e) {}
  updateSidebarToggleIcon();
}

function updateSidebarToggleIcon() {
  var btn = document.getElementById('sidebar-toggle');
  if (!btn) return;
  btn.textContent = document.body.classList.contains('sidebar-collapsed') ? '›' : '‹';
}

(function restoreSidebarCollapsed() {
  try {
    if (localStorage.getItem('sidebarCollapsed') === '1') {
      document.body.classList.add('sidebar-collapsed');
    }
  } catch (e) {}
  if (document.readyState !== 'loading') updateSidebarToggleIcon();
  else document.addEventListener('DOMContentLoaded', updateSidebarToggleIcon);
})();

// ── SIDEBAR ARCHIVE TOGGLE ─────────────────────────────
function toggleSidebarArchive() {
  var list = document.getElementById('sidebar-archive-list');
  var arrow = document.getElementById('sidebar-archive-arrow');
  if (!list) return;
  var show = list.style.display === 'none';
  list.style.display = show ? 'block' : 'none';
  if (arrow) arrow.style.transform = show ? 'rotate(90deg)' : 'rotate(0deg)';
}

// ── QUOTE UNDO TOAST ───────────────────────────────────
function showQuoteUndoToast() {
  var toast = document.getElementById('quote-undo-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'quote-undo-toast';
    toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#c94a4a;color:#fff;padding:10px 18px;border-radius:6px;font-size:13px;z-index:999;display:flex;gap:14px;align-items:center;box-shadow:0 2px 12px rgba(0,0,0,0.4)';
    document.body.appendChild(toast);
  }
  toast.innerHTML = 'Quote changed by AI <button onclick="undoQuoteChange()" style="background:#fff;color:#c94a4a;border:none;padding:5px 14px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:700">UNDO</button>';
  toast.style.display = 'flex';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(function() { toast.style.display = 'none'; }, 15000);
}

async function undoQuoteChange() {
  if (!currentSessionId) return;
  try {
    var res = await fetch('/api/sessions/' + currentSessionId + '/undo-quote', { method: 'POST' });
    var data = await res.json();
    if (!res.ok) { alert(data.error || 'Undo failed'); return; }
    draftQuoteJson = JSON.parse(JSON.stringify(data.quoteJson));
    showQuote(currentSessionId, 'quote_ready');
    var toast = document.getElementById('quote-undo-toast');
    if (toast) toast.style.display = 'none';
  } catch (e) { alert('Undo failed: ' + e.message); }
}

// ── JOB SECTION EXPAND / COLLAPSE ──────────────────────
function autoExpandSection(el) {
  el.style.height = 'auto';
  el.style.height = Math.max(40, el.scrollHeight) + 'px';
}

function toggleJobSection(key) {
  var wrapper = document.querySelector('[data-section-wrapper="' + key + '"]');
  if (!wrapper) return;
  var ta = wrapper.querySelector('textarea');
  var btn = wrapper.querySelector('[data-section-toggle]');
  if (!ta) return;
  var isCollapsed = ta.style.display === 'none';
  if (isCollapsed) {
    ta.style.display = '';
    if (btn) btn.textContent = '−';
    autoExpandSection(ta);
  } else {
    ta.style.display = 'none';
    if (btn) btn.textContent = '+';
  }
}

function autoExpandAllSections() {
  document.querySelectorAll('[data-section-key]').forEach(autoExpandSection);
}
