// OP Hub — Panel Management
// Depends on state.js, shared.js

// ── QUOTE PANEL OPEN / CLOSE (mobile) ──────────────────
function openQuotePanel() {
  document.getElementById('quote-panel').classList.add('mobile-open');
  var btn = document.getElementById('mobile-quote-btn');
  if (btn) btn.classList.add('active');
}

function closeQuotePanel() {
  document.getElementById('quote-panel').classList.remove('mobile-open');
  var btn = document.getElementById('mobile-quote-btn');
  if (btn) btn.classList.remove('active');
}

function toggleQuotePanel() {
  var panel = document.getElementById('quote-panel');
  if (panel.classList.contains('mobile-open')) closeQuotePanel();
  else openQuotePanel();
}

// ── QUOTE SCALE (mobile) ──────────────────────────────
function updateQuoteScale() {
  if (window.innerWidth > 768) return;
  var container = document.getElementById('quote-frame-container');
  if (!container) return;
  var scale = container.clientWidth / 920;
  container.style.setProperty('--quote-scale', Math.min(scale, 1).toFixed(3));
}

// ── PANEL MODE ─────────────────────────────────────────
// Single source of truth for which view is shown in the right panel.
function setPanelMode(mode) {
  currentPanelMode = mode;
  var placeholder = document.getElementById('quote-placeholder');
  var frame = document.getElementById('quote-frame');
  var gallery = document.getElementById('quote-gallery');
  var draft = document.getElementById('quote-draft');

  placeholder.style.display = mode === 'placeholder' ? 'flex' : 'none';
  frame.style.display = mode === 'pdf' ? 'block' : 'none';
  gallery.style.display = mode === 'gallery' ? 'flex' : 'none';
  draft.style.display = mode === 'draft' ? 'block' : 'none';

  galleryState.visible = mode === 'gallery';
  updatePanelButtons();
  if (mode === 'pdf') updateQuoteScale();
  if (mode === 'draft' && currentSessionId) loadDraftEditor(currentSessionId);
}

function updatePanelButtons() {
  var hasImages = galleryState.images.length > 0;
  var frame = document.getElementById('quote-frame');
  var hasQuote = frame && (frame.src || frame.srcdoc);
  var hasDraft = !!draftQuoteJson;
  var mode = currentPanelMode;

  var btnDraft = document.getElementById('btn-show-draft');
  var btnQuote = document.getElementById('btn-show-quote');
  var btnGallery = document.getElementById('btn-show-gallery');

  // Show buttons when relevant content exists
  btnDraft.style.display = hasDraft ? '' : 'none';
  btnQuote.style.display = hasQuote ? '' : 'none';
  btnGallery.style.display = hasImages ? '' : 'none';

  // Highlight active button
  for (var _i = 0, _arr = [[btnDraft,'draft'],[btnQuote,'pdf'],[btnGallery,'gallery']]; _i < _arr.length; _i++) {
    var btn = _arr[_i][0], m = _arr[_i][1];
    btn.style.background = mode === m ? 'var(--accent)' : 'transparent';
    btn.style.color = mode === m ? '#fff' : 'var(--text-2)';
  }
}

// ── PANEL DIVIDER RESIZE ───────────────────────────────
(function initPanelDivider() {
  var divider = document.getElementById('panel-divider');
  var chatPanel = document.getElementById('chat-panel');
  var quotePanel = document.getElementById('quote-panel');
  var main = document.getElementById('main');
  if (!divider) return;

  var startX = 0;
  var startChatW = 0;

  divider.addEventListener('mousedown', function(e) {
    e.preventDefault();
    startX = e.clientX;
    startChatW = chatPanel.getBoundingClientRect().width;
    divider.classList.add('dragging');
    document.body.classList.add('panel-resizing');
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  function onMouseMove(e) {
    var mainW = main.getBoundingClientRect().width;
    var dividerW = divider.getBoundingClientRect().width;
    var available = mainW - dividerW;
    var newChatW = startChatW + (e.clientX - startX);
    newChatW = Math.max(280, Math.min(newChatW, available - 300));
    chatPanel.style.width = newChatW + 'px';
    chatPanel.style.flex = 'none';
    quotePanel.style.flex = '1';
  }

  function onMouseUp() {
    divider.classList.remove('dragging');
    document.body.classList.remove('panel-resizing');
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    // Reload the iframe so it renders at the new container width
    var frame = document.getElementById('quote-frame');
    if (frame && frame.style.display !== 'none' && frame.src) {
      var src = frame.src;
      frame.src = '';
      setTimeout(function() { frame.src = src; }, 50);
    }
  }

  // Safety: if mouseup fires outside the window or is missed, clean up
  window.addEventListener('mouseup', function() {
    if (document.body.classList.contains('panel-resizing')) {
      divider.classList.remove('dragging');
      document.body.classList.remove('panel-resizing');
      document.removeEventListener('mousemove', onMouseMove);
    }
  });
  // Also clean up on blur (user switches tab/window mid-drag)
  window.addEventListener('blur', function() {
    if (document.body.classList.contains('panel-resizing')) {
      divider.classList.remove('dragging');
      document.body.classList.remove('panel-resizing');
      document.removeEventListener('mousemove', onMouseMove);
    }
  });
})();

// ── MOBILE NAV ─────────────────────────────────────────
function mobileNavTo(view) {
  var isMobile = window.innerWidth <= 768;
  if (!isMobile && view === 'jobs') { toggleJobsView(); return; }
  if (!isMobile) return;

  mobileCurrentView = view;
  var quotePanel = document.getElementById('quote-panel');
  var emailForm = document.getElementById('email-form');

  // Update tab highlights
  document.querySelectorAll('.mobile-nav-tab').forEach(function(t) { t.classList.remove('active'); });
  var tab = document.getElementById('nav-' + view);
  if (tab) tab.classList.add('active');

  var jobsPanel = document.getElementById('jobs-panel');
  var jobDetail = document.getElementById('job-detail');

  if (view === 'chat') {
    quotePanel.classList.remove('mobile-open');
    quotePanel.classList.remove('email-only');
    emailForm.classList.remove('open');
    emailForm.classList.remove('minimized');
    jobsPanel.classList.remove('visible');
    jobDetail.classList.remove('visible');
  } else if (view === 'pics') {
    // Open quote panel in gallery mode
    quotePanel.classList.add('mobile-open');
    quotePanel.classList.remove('email-only');
    emailForm.classList.remove('open');
    emailForm.classList.remove('minimized');
    jobsPanel.classList.remove('visible');
    jobDetail.classList.remove('visible');
    showGallery();
  } else if (view === 'quote') {
    quotePanel.classList.add('mobile-open');
    quotePanel.classList.remove('email-only');
    emailForm.classList.remove('open');
    emailForm.classList.remove('minimized');
    jobsPanel.classList.remove('visible');
    jobDetail.classList.remove('visible');
    // Show draft if available, otherwise PDF
    if (draftQuoteJson) setPanelMode('draft');
    else { setPanelMode('pdf'); setTimeout(updateQuoteScale, 50); }
  } else if (view === 'jobs') {
    quotePanel.classList.remove('mobile-open');
    quotePanel.classList.remove('email-only');
    emailForm.classList.remove('open');
    emailForm.classList.remove('minimized');
    jobsPanel.classList.add('visible');
    jobDetail.classList.remove('visible');
    loadJobs();
  } else if (view === 'email') {
    // Email form lives inside quote-panel in the DOM. On mobile, the
    // quote panel uses transform which breaks position:fixed on children.
    // So we must bring the quote panel on-screen, but hide its quote
    // content (header, frame) so only the email form fills the screen.
    quotePanel.classList.add('mobile-open');
    quotePanel.classList.add('email-only');
    emailForm.classList.add('open');
    emailForm.classList.remove('minimized');
    jobsPanel.classList.remove('visible');
    jobDetail.classList.remove('visible');
  }
}
