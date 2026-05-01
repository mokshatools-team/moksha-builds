// ── EVENT LISTENERS ─────────────────────────────────

// close rules modal on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeRulesModal();
});

// Drag-and-drop support
document.addEventListener('dragenter', handleDocumentDragEnter, true);
document.addEventListener('dragover', handleDocumentDragOver, true);
document.addEventListener('dragleave', handleDocumentDragLeave, true);
document.addEventListener('drop', handleDocumentDrop, true);
document.addEventListener('dragend', clearDropState, true);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearDropState();
});
window.addEventListener('blur', clearDropState);

// Clipboard paste support for images (screenshots, copied photos)
document.addEventListener('paste', (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  const imageFiles = [];
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) imageFiles.push(file);
    }
  }
  if (imageFiles.length) {
    e.preventDefault();
    addFilesToQueue(imageFiles);
  }
});

// Email draft dirty tracking
document.getElementById('email-subject').addEventListener('input', () => markEmailDraftDirty('subject'));
document.getElementById('email-body').addEventListener('input', () => markEmailDraftDirty('body'));
document.getElementById('email-to').addEventListener('input', () => markEmailDraftDirty('to'));
document.getElementById('email-scenario').addEventListener('change', () => refreshEmailDraftFromSettings('scenario'));
document.getElementById('email-signer').addEventListener('change', () => refreshEmailDraftFromSettings('signer'));
// email-detail-level removed (replaced by payment-type toggle for templates)

// ── INIT ─────────────────────────────────────────────
(async function init() {
  await loadSidebar();
  var params = new URLSearchParams(window.location.search);
  var sessionId = params.get('session');
  if (sessionId) {
    loadSession(sessionId);
  } else if (window.innerWidth <= 768) {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebar-overlay').classList.add('visible');
  }
})();
window.addEventListener('resize', updateQuoteScale);
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible') {
    invalidateSessionCache();
    loadSidebar();
    if (typeof currentSidebarMode !== 'undefined' && currentSidebarMode === 'jobs') {
      invalidateJobsCache();
      loadJobs();
      loadJobsSidebar();
    }
  }
});
