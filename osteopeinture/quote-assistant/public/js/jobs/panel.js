// public/js/jobs/panel.js — Job right panel: tab switching, mobile nav, divider

function setJobTab(tab) {
  activeJobTab = tab;
  document.querySelectorAll('.job-tab').forEach(function(btn) {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
  });
  document.querySelectorAll('.job-tab-pane').forEach(function(pane) {
    pane.style.display = 'none';
  });
  var activePane = document.getElementById('job-tab-' + tab);
  if (activePane) activePane.style.display = '';

  if (tab === 'chat' && currentJobId) loadJobChat(currentJobId);
  if (tab === 'docs' && currentJobId) loadJobDocs(currentJobId);
  if (tab === 'photos' && currentJobId) loadJobPhotos(currentJobId);
}

function mobileJobNavTo(view) {
  var detail = document.getElementById('job-detail');
  document.querySelectorAll('#mobile-job-nav .mobile-nav-tab').forEach(function(t) {
    t.classList.remove('active');
  });
  var btn = document.getElementById('jnav-' + (view === 'photos' ? 'photos' : view));
  if (btn) btn.classList.add('active');

  if (view === 'detail') {
    detail.classList.remove('showing-panel');
  } else {
    detail.classList.add('showing-panel');
    setJobTab(view);
  }
}

function showJobPanel() {
  var mobileNav = document.getElementById('mobile-nav');
  var jobNav = document.getElementById('mobile-job-nav');
  if (window.innerWidth <= 768) {
    if (mobileNav) mobileNav.style.display = 'none';
    if (jobNav) jobNav.classList.add('visible');
  }
  jobPanelVisible = true;
}

function hideJobPanel() {
  var jobNav = document.getElementById('mobile-job-nav');
  var mobileNav = document.getElementById('mobile-nav');
  if (jobNav) jobNav.classList.remove('visible');
  if (mobileNav && currentSidebarMode === 'quotes') {
    mobileNav.style.display = '';
  }
  jobPanelVisible = false;
  var detail = document.getElementById('job-detail');
  if (detail) detail.classList.remove('showing-panel');
}

function initJobPanelDivider() {
  var divider = document.getElementById('job-panel-divider');
  var leftPanel = document.getElementById('job-detail-content');
  var rightPanel = document.getElementById('job-right-panel');
  var body = document.getElementById('job-detail-body');
  if (!divider || !leftPanel || !rightPanel || !body) return;

  var startX, startLeftW;

  divider.addEventListener('mousedown', function(e) {
    e.preventDefault();
    startX = e.clientX;
    startLeftW = leftPanel.getBoundingClientRect().width;
    divider.classList.add('dragging');
    document.body.classList.add('panel-resizing');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  function onMove(e) {
    var bodyW = body.getBoundingClientRect().width;
    var divW = divider.getBoundingClientRect().width;
    var available = bodyW - divW;
    var newW = startLeftW + (e.clientX - startX);
    newW = Math.max(280, Math.min(newW, available - 300));
    leftPanel.style.width = newW + 'px';
    leftPanel.style.flex = 'none';
    rightPanel.style.flex = '1';
  }

  function onUp() {
    divider.classList.remove('dragging');
    document.body.classList.remove('panel-resizing');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }
}

// Placeholder loaders (real implementations in chat.js, docs.js)
if (typeof loadJobChat === 'undefined') {
  function loadJobChat(jobId) {
    var pane = document.getElementById('job-tab-chat');
    if (pane) pane.innerHTML = '<div style="color:var(--text-4);text-align:center;padding:40px;">Chat — coming soon</div>';
  }
}
if (typeof loadJobDocs === 'undefined') {
  function loadJobDocs(jobId) {
    var pane = document.getElementById('job-tab-docs');
    if (pane) pane.innerHTML = '<div style="color:var(--text-4);text-align:center;padding:40px;">Docs — coming soon</div>';
  }
}
if (typeof loadJobPhotos === 'undefined') {
  function loadJobPhotos(jobId) {
    var pane = document.getElementById('job-tab-photos');
    if (pane) pane.innerHTML = '<div style="color:var(--text-4);text-align:center;padding:40px;">Photos — coming soon</div>';
  }
}
