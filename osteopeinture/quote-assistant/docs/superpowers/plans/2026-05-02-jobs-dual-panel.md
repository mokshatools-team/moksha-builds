# Jobs Dual-Panel (Part 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dual-panel layout to the Jobs side — job detail on the left, context panel (Chat/Docs/Photos) on the right — with document versioning.

**Architecture:** Extend the existing job detail overlay into a two-panel layout that mirrors the quote assistant. Right panel content switches via 3 tabs (Chat, Docs, Photos). New `job_documents` table consolidates document storage with versioning. Reuse shared panel divider logic. Mobile gets 4 bottom tabs.

**Tech Stack:** Express/Node.js, Supabase Postgres, vanilla JS (no framework), existing modular structure.

**Rollback:** Tagged as `v1.0-pre-dual-panel`. To revert: `git revert --no-commit v1.0-pre-dual-panel..HEAD && git commit -m "revert: rollback dual-panel" && npm run deploy`

**Spec:** `docs/superpowers/specs/2026-05-02-jobs-dual-panel-design.md`

---

## File Map

### New files
| File | Responsibility |
|------|---------------|
| `public/js/jobs/panel.js` | Job right panel: tab switching, state, render targets |
| `public/js/jobs/chat.js` | Basic job chat: message list, send, store (no AI in Part 1) |
| `public/js/jobs/docs.js` | Docs tab: sub-nav, version list, inline editor, preview, PDF |
| `routes/job-documents.js` | Document CRUD API: list, save, get, PDF, mark sent |
| `services/job-document-service.js` | Version numbering, data validation, PDF generation |

### Modified files
| File | Changes |
|------|---------|
| `public/index.html` | Add job right panel HTML, job mobile nav, CSS for dual-panel |
| `public/js/state.js` | Add job panel state vars |
| `public/js/panel.js` | Extract shared divider init into reusable function |
| `public/js/jobs/detail.js` | Remove moved action buttons, add panel integration |
| `public/js/jobs/invoice-editor.js` | Render inline in Docs tab target instead of modal |
| `routes/jobs.js` | Add message endpoints, mount document routes |
| `server.js` | Mount job-documents route, add table migrations |

---

## Phase 1: Layout

### Task 1.1: Database migrations

**Files:**
- Modify: `server.js` — add migration block

- [ ] **Step 1: Add job_documents and job_messages table creation**

In `server.js`, find the `runMigrations` IIFE (around line 136). Add after the existing soft-delete migrations:

```javascript
await db.run(`CREATE TABLE IF NOT EXISTS job_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('invoice', 'cost_update')),
  version INTEGER NOT NULL DEFAULT 1,
  sections JSONB NOT NULL,
  paints JSONB,
  status TEXT NOT NULL DEFAULT 'saved' CHECK (status IN ('saved', 'sent')),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
)`);
await db.run('CREATE INDEX IF NOT EXISTS idx_job_documents_job ON job_documents(job_id)');

await db.run(`CREATE TABLE IF NOT EXISTS job_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`);
await db.run('CREATE INDEX IF NOT EXISTS idx_job_messages_job ON job_messages(job_id)');
```

- [ ] **Step 2: Run tests to verify migration doesn't break anything**

```bash
cd osteopeinture/quote-assistant && npm test
```
Expected: 26 pass, 2 fail (pre-existing)

- [ ] **Step 3: Commit**
```bash
git add server.js
git commit -m "feat: add job_documents and job_messages tables"
```

---

### Task 1.2: Add job panel state vars

**Files:**
- Modify: `public/js/state.js`

- [ ] **Step 1: Add job panel state variables**

Add to the end of `state.js`:

```javascript
// Job panel state
var activeJobTab = 'chat'; // 'chat' | 'docs' | 'photos'
var activeDocSubTab = 'invoice'; // 'invoice' | 'cost_update' | 'quote'
var jobPanelVisible = false;
```

- [ ] **Step 2: Commit**
```bash
git add public/js/state.js
git commit -m "feat: add job panel state vars"
```

---

### Task 1.3: Add job right panel HTML + CSS

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Replace job-detail HTML with dual-panel structure**

Find the `<!-- JOB DETAIL PANEL -->` section (around line 2324). Replace:

```html
<!-- JOB DETAIL PANEL -->
<div id="job-detail">
  <div id="job-detail-header">
    <button id="job-detail-back" onclick="closeJobDetail()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><polyline points="15 18 9 12 15 6"/></svg>
    </button>
    <h2 id="job-detail-title" style="font-family:var(--font-serif);font-size:18px;color:var(--text);margin:0"></h2>
  </div>
  <div id="job-detail-content"></div>
</div>
```

With:

```html
<!-- JOB DETAIL PANEL (dual-panel) -->
<div id="job-detail">
  <div id="job-detail-header">
    <button id="job-detail-back" onclick="closeJobDetail()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><polyline points="15 18 9 12 15 6"/></svg>
    </button>
    <h2 id="job-detail-title" style="font-family:var(--font-serif);font-size:18px;color:var(--text);margin:0"></h2>
  </div>
  <div id="job-detail-body" style="display:flex;flex:1;overflow:hidden;">
    <div id="job-detail-content" style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:16px;padding-bottom:80px;min-width:280px;"></div>
    <div id="job-panel-divider" style="width:5px;cursor:col-resize;background:var(--border);flex-shrink:0;"></div>
    <div id="job-right-panel" style="flex:1;display:flex;flex-direction:column;min-width:300px;overflow:hidden;">
      <div id="job-panel-tabs" style="display:flex;gap:4px;padding:10px 12px;border-bottom:1px solid var(--border);flex-shrink:0;">
        <button class="job-tab active" data-tab="chat" onclick="setJobTab('chat')">Chat</button>
        <button class="job-tab" data-tab="docs" onclick="setJobTab('docs')">Docs</button>
        <button class="job-tab" data-tab="photos" onclick="setJobTab('photos')">Photos</button>
      </div>
      <div id="job-panel-content" style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;">
        <div id="job-tab-chat" class="job-tab-pane"></div>
        <div id="job-tab-docs" class="job-tab-pane" style="display:none;"></div>
        <div id="job-tab-photos" class="job-tab-pane" style="display:none;"></div>
      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Add CSS for job dual-panel and tabs**

Add to the `<style>` block, after the existing `#job-detail` styles:

```css
/* Job dual-panel */
#job-detail-body { display: flex; flex: 1; overflow: hidden; }
#job-panel-divider:hover { background: var(--accent-dim); }

/* Job panel tabs */
.job-tab {
  padding: 5px 12px;
  background: var(--surface-1);
  border: none;
  border-radius: 4px;
  color: var(--text-3);
  font-family: var(--font-sans);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}
.job-tab.active { background: var(--accent); color: #fff; }
.job-tab-pane { padding: 12px; }

/* Mobile: hide right panel and divider, show via tabs */
@media (max-width: 768px) {
  #job-panel-divider { display: none; }
  #job-right-panel { display: none; }
  #job-detail.visible #job-detail-body { flex-direction: column; }
  #job-detail.showing-panel #job-detail-content { display: none; }
  #job-detail.showing-panel #job-right-panel { display: flex; flex: 1; }
  #job-detail.showing-panel #job-panel-tabs { display: none; }
}
```

- [ ] **Step 3: Add mobile job nav bar**

Find the `<!-- MOBILE BOTTOM NAV -->` section. Add a second nav bar for jobs mode (hidden by default):

```html
<div id="mobile-job-nav" style="display:none;">
  <button class="mobile-nav-tab active" id="jnav-detail" onclick="mobileJobNavTo('detail')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="18" height="18"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="7" y1="8" x2="17" y2="8"/><line x1="7" y1="12" x2="14" y2="12"/><line x1="7" y1="16" x2="11" y2="16"/></svg>
    Detail
  </button>
  <button class="mobile-nav-tab" id="jnav-chat" onclick="mobileJobNavTo('chat')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="18" height="18"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
    Chat
  </button>
  <button class="mobile-nav-tab" id="jnav-docs" onclick="mobileJobNavTo('docs')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="18" height="18"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
    Docs
  </button>
  <button class="mobile-nav-tab" id="jnav-photos" onclick="mobileJobNavTo('photos')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="18" height="18"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
    Photos
  </button>
</div>
```

- [ ] **Step 4: Add `<script>` tag for new job panel JS**

Add before `<script src="js/app.js">`:

```html
<script src="js/jobs/panel.js"></script>
<script src="js/jobs/chat.js"></script>
<script src="js/jobs/docs.js"></script>
```

- [ ] **Step 5: Commit**
```bash
git add public/index.html
git commit -m "feat: job dual-panel HTML structure + CSS + mobile nav"
```

---

### Task 1.4: Create job panel manager

**Files:**
- Create: `public/js/jobs/panel.js`

- [ ] **Step 1: Create the panel manager**

```javascript
// public/js/jobs/panel.js — Job right panel tab switching and divider

function setJobTab(tab) {
  activeJobTab = tab;
  // Update tab buttons
  document.querySelectorAll('.job-tab').forEach(function(btn) {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
  });
  // Show/hide panes
  document.querySelectorAll('.job-tab-pane').forEach(function(pane) {
    pane.style.display = 'none';
  });
  var activePane = document.getElementById('job-tab-' + tab);
  if (activePane) activePane.style.display = '';

  // Load content for the tab
  if (tab === 'chat' && currentJobId) loadJobChat(currentJobId);
  if (tab === 'docs' && currentJobId) loadJobDocs(currentJobId);
  if (tab === 'photos' && currentJobId) loadJobPhotos(currentJobId);
}

function mobileJobNavTo(view) {
  var detail = document.getElementById('job-detail');
  // Update mobile nav buttons
  document.querySelectorAll('#mobile-job-nav .mobile-nav-tab').forEach(function(t) {
    t.classList.remove('active');
  });
  var btn = document.getElementById('jnav-' + view);
  if (btn) btn.classList.add('active');

  if (view === 'detail') {
    detail.classList.remove('showing-panel');
    document.getElementById('job-right-panel').style.display = 'none';
    document.getElementById('job-detail-content').style.display = '';
  } else {
    detail.classList.add('showing-panel');
    document.getElementById('job-detail-content').style.display = 'none';
    document.getElementById('job-right-panel').style.display = 'flex';
    document.getElementById('job-panel-tabs').style.display = 'none';
    setJobTab(view);
  }
}

function showJobPanel() {
  var mobileNav = document.getElementById('mobile-nav');
  var jobNav = document.getElementById('mobile-job-nav');
  if (window.innerWidth <= 768) {
    if (mobileNav) mobileNav.style.display = 'none';
    if (jobNav) jobNav.style.display = 'flex';
  }
  jobPanelVisible = true;
}

function hideJobPanel() {
  var mobileNav = document.getElementById('mobile-nav');
  var jobNav = document.getElementById('mobile-job-nav');
  if (jobNav) jobNav.style.display = 'none';
  // Restore quote mobile nav if in quotes mode
  if (mobileNav && currentSidebarMode === 'quotes') mobileNav.style.display = 'flex';
  jobPanelVisible = false;
}

// Initialize job panel divider (reuses pattern from panel.js)
function initJobPanelDivider() {
  var divider = document.getElementById('job-panel-divider');
  var leftPanel = document.getElementById('job-detail-content');
  var rightPanel = document.getElementById('job-right-panel');
  var body = document.getElementById('job-detail-body');
  if (!divider || !leftPanel || !rightPanel) return;

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

  window.addEventListener('mouseup', function() {
    if (document.body.classList.contains('panel-resizing')) {
      divider.classList.remove('dragging');
      document.body.classList.remove('panel-resizing');
      document.removeEventListener('mousemove', onMove);
    }
  });
}
```

- [ ] **Step 2: Commit**
```bash
git add public/js/jobs/panel.js
git commit -m "feat: job panel manager — tab switching, mobile nav, divider"
```

---

### Task 1.5: Integrate panel with job detail

**Files:**
- Modify: `public/js/jobs/detail.js`

- [ ] **Step 1: Add panel init to openJobDetail()**

Find `openJobDetail()` in detail.js. At the end of the function (after content is rendered), add:

```javascript
// Initialize job right panel
initJobPanelDivider();
showJobPanel();
setJobTab('chat');
```

- [ ] **Step 2: Add panel cleanup to closeJobDetail()**

Find `closeJobDetail()`. Add before the existing code:

```javascript
hideJobPanel();
```

- [ ] **Step 3: Remove action buttons that moved to right panel**

In `openJobDetail()`, find the Actions grid that renders buttons. Remove these buttons from the grid:
- `Cost Update` button
- `Invoice` button
- `Draft Email` button
- `View Quote` button
- `Paste Apple Note` button

Keep: `Import Jibble`, `Update Total`

- [ ] **Step 4: Add photo thumbnail click handler**

In the photos section rendering, change photo thumbnails to switch to Photos tab on click:

```javascript
// Change onclick from opening URL to switching tab
onclick="setJobTab('photos')"
```

- [ ] **Step 5: Test on desktop — opening a job should show dual-panel**

- [ ] **Step 6: Commit**
```bash
git add public/js/jobs/detail.js
git commit -m "feat: integrate job panel — remove moved buttons, init divider"
```

---

### Task 1.6: Deploy and test Phase 1 layout

- [ ] **Step 1: Run tests**
```bash
npm test
```
Expected: 26 pass, 2 fail

- [ ] **Step 2: Deploy**
```bash
npm run deploy
```

- [ ] **Step 3: Verify on live URL**
- Open a job → dual-panel visible on desktop
- Tabs switch (Chat/Docs/Photos) — empty content is fine for now
- Divider drags correctly
- Mobile: 4 bottom tabs, Detail is default
- Existing features still work (payments, status, sections)
- Quote assistant side unaffected

- [ ] **Step 4: Commit**
```bash
git commit --allow-empty -m "checkpoint: Phase 1 layout verified on live"
```

---

## Phase 2: Docs Tab

### Task 2.1: Create document service

**Files:**
- Create: `services/job-document-service.js`

- [ ] **Step 1: Create the service**

```javascript
'use strict';

let db;
function init(database) { db = database; }

async function listDocuments(jobId, docType) {
  var query = 'SELECT * FROM job_documents WHERE job_id = $1 AND deleted_at IS NULL';
  var params = [jobId];
  if (docType) {
    query += ' AND doc_type = $2';
    params.push(docType);
  }
  query += ' ORDER BY version DESC';
  return await db.all(query, params);
}

async function getDocument(docId) {
  return await db.get('SELECT * FROM job_documents WHERE id = $1 AND deleted_at IS NULL', [docId]);
}

async function saveVersion(jobId, docType, sections, paints) {
  // Get next version number
  var latest = await db.get(
    'SELECT MAX(version) as max_v FROM job_documents WHERE job_id = $1 AND doc_type = $2 AND deleted_at IS NULL',
    [jobId, docType]
  );
  var nextVersion = (latest && latest.max_v ? latest.max_v : 0) + 1;

  var result = await db.get(
    `INSERT INTO job_documents (job_id, doc_type, version, sections, paints, status)
     VALUES ($1, $2, $3, $4, $5, 'saved')
     RETURNING *`,
    [jobId, docType, nextVersion, JSON.stringify(sections), paints ? JSON.stringify(paints) : null]
  );
  return result;
}

async function markSent(docId) {
  await db.run(
    "UPDATE job_documents SET status = 'sent', sent_at = NOW() WHERE id = $1",
    [docId]
  );
  return await getDocument(docId);
}

async function softDelete(docId) {
  await db.run('UPDATE job_documents SET deleted_at = NOW() WHERE id = $1', [docId]);
}

module.exports = { init, listDocuments, getDocument, saveVersion, markSent, softDelete };
```

- [ ] **Step 2: Commit**
```bash
git add services/job-document-service.js
git commit -m "feat: job document service — version CRUD"
```

---

### Task 2.2: Create document routes

**Files:**
- Create: `routes/job-documents.js`
- Modify: `server.js` — mount route, init service

- [ ] **Step 1: Create the route file**

```javascript
'use strict';
var express = require('express');
var router = express.Router();

var deps = {};
function init(d) { deps = d; }

// List documents for a job (optionally filtered by type)
router.get('/api/jobs/:id/documents', async function(req, res) {
  try {
    var docs = await deps.jobDocumentService.listDocuments(req.params.id, req.query.type);
    res.json(docs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save a new version
router.post('/api/jobs/:id/documents', express.json(), async function(req, res) {
  try {
    var { docType, sections, paints } = req.body;
    if (!docType || !sections) return res.status(400).json({ error: 'Missing docType or sections' });
    var doc = await deps.jobDocumentService.saveVersion(req.params.id, docType, sections, paints);
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get a specific version
router.get('/api/jobs/:id/documents/:docId', async function(req, res) {
  try {
    var doc = await deps.jobDocumentService.getDocument(req.params.docId);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Download version as PDF
router.get('/api/jobs/:id/documents/:docId/pdf', async function(req, res) {
  try {
    var doc = await deps.jobDocumentService.getDocument(req.params.docId);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    var job = await deps.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    var sections = typeof doc.sections === 'string' ? JSON.parse(doc.sections) : doc.sections;
    var paints = doc.paints ? (typeof doc.paints === 'string' ? JSON.parse(doc.paints) : doc.paints) : [];

    // Build cost-update style HTML using the existing renderer
    var costUpdateData = {
      clientName: job.client_name,
      projectId: job.job_number,
      address: job.address,
      date: new Date().toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' }),
      projectType: doc.doc_type === 'invoice' ? 'FACTURE' : 'MISE À JOUR DES COÛTS',
      lang: (job.language === 'french') ? 'fr' : undefined,
      sections: sections,
      paints: paints,
      terms: { includes: [], conditions: [] },
      modalities: {},
    };
    var html = deps.renderQuoteHTML(costUpdateData, { branded: true });
    var pdfBuffer = await deps.generateQuotePDF(html);
    var filename = (job.job_number || 'job') + ' - ' + (doc.doc_type === 'invoice' ? 'Invoice' : 'Cost Update') + ' v' + doc.version + '.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark as sent
router.patch('/api/jobs/:id/documents/:docId', express.json(), async function(req, res) {
  try {
    if (req.body.status === 'sent') {
      var doc = await deps.jobDocumentService.markSent(req.params.docId);
      res.json(doc);
    } else {
      res.status(400).json({ error: 'Only status=sent is supported' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, init };
```

- [ ] **Step 2: Mount in server.js**

Add require and init:

```javascript
var jobDocumentService = require('./services/job-document-service');
jobDocumentService.init(db);

var jobDocumentRoutes = require('./routes/job-documents');
jobDocumentRoutes.init({
  jobDocumentService: jobDocumentService,
  getJob: jobService.getJob,
  renderQuoteHTML: renderQuoteHTML,
  generateQuotePDF: generateQuotePDF,
});
app.use(jobDocumentRoutes.router);
```

- [ ] **Step 3: Commit**
```bash
git add routes/job-documents.js services/job-document-service.js server.js
git commit -m "feat: document version API — CRUD, PDF, mark sent"
```

---

### Task 2.3: Create Docs tab frontend

**Files:**
- Create: `public/js/jobs/docs.js`

- [ ] **Step 1: Create the Docs tab renderer**

```javascript
// public/js/jobs/docs.js — Docs tab: sub-nav, version list, inline editor

function loadJobDocs(jobId) {
  var pane = document.getElementById('job-tab-docs');
  if (!pane) return;

  pane.innerHTML = '<div style="margin-bottom:12px;">' +
    '<div style="display:flex;gap:4px;margin-bottom:12px;border-bottom:1px solid var(--border);padding-bottom:8px;">' +
    '<button class="doc-sub-tab' + (activeDocSubTab === 'invoice' ? ' active' : '') + '" onclick="setDocSubTab(\'invoice\')">Invoice</button>' +
    '<button class="doc-sub-tab' + (activeDocSubTab === 'cost_update' ? ' active' : '') + '" onclick="setDocSubTab(\'cost_update\')">Cost Update</button>' +
    '<button class="doc-sub-tab' + (activeDocSubTab === 'quote' ? ' active' : '') + '" onclick="setDocSubTab(\'quote\')">Quote</button>' +
    '</div>' +
    '<div id="doc-sub-content"></div>' +
    '</div>';

  loadDocSubContent(jobId, activeDocSubTab);
}

function setDocSubTab(tab) {
  activeDocSubTab = tab;
  document.querySelectorAll('.doc-sub-tab').forEach(function(b) {
    b.classList.toggle('active', b.textContent.toLowerCase().replace(' ', '_') === tab ||
      (tab === 'invoice' && b.textContent === 'Invoice') ||
      (tab === 'cost_update' && b.textContent === 'Cost Update') ||
      (tab === 'quote' && b.textContent === 'Quote'));
  });
  if (currentJobId) loadDocSubContent(currentJobId, tab);
}

async function loadDocSubContent(jobId, subTab) {
  var container = document.getElementById('doc-sub-content');
  if (!container) return;

  if (subTab === 'quote') {
    // Show original accepted quote as read-only preview
    container.innerHTML = '<iframe src="/preview/cost-update/' + jobId + '?type=cost-update" style="width:100%;height:calc(100vh - 200px);border:none;border-radius:4px;background:#fff;"></iframe>';
    return;
  }

  // Load editor + version list for invoice or cost_update
  container.innerHTML = '<div id="doc-editor-target"></div>' +
    '<div id="doc-versions-target" style="margin-top:16px;"></div>';

  // Render the inline editor (reuse existing invoice editor logic)
  renderInlineDocEditor(jobId, subTab);

  // Load saved versions
  loadDocVersions(jobId, subTab);
}

async function renderInlineDocEditor(jobId, docType) {
  var target = document.getElementById('doc-editor-target');
  if (!target) return;

  try {
    var res = await fetch('/api/jobs/' + jobId);
    if (!res.ok) return;
    var job = await res.json();
    var quoteJson = job.accepted_quote_json ?
      (typeof job.accepted_quote_json === 'string' ? JSON.parse(job.accepted_quote_json) : job.accepted_quote_json) : null;

    var sections = [];
    if (quoteJson && quoteJson.sections) {
      for (var i = 0; i < quoteJson.sections.length; i++) {
        var sec = quoteJson.sections[i];
        if (sec.excluded || sec.optional) continue;
        sections.push(JSON.parse(JSON.stringify(sec)));
      }
    }
    var paints = quoteJson && quoteJson.paints ? JSON.parse(JSON.stringify(quoteJson.paints)) : [];

    // Store editor state
    invoiceEditorState = { jobId: jobId, jobNumber: job.job_number || '', docType: docType, sections: sections, paints: paints, jobSectionsRaw: {} };

    // Render using existing renderInvoiceEditor
    var editorHtml = buildInlineEditorHtml();
    target.innerHTML = editorHtml;
  } catch (err) {
    target.innerHTML = '<div style="color:var(--accent);padding:12px;">Error: ' + esc(err.message) + '</div>';
  }
}

function buildInlineEditorHtml() {
  var secs = invoiceEditorState.sections;
  var subtotal = 0;
  var html = '<div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-3);margin-bottom:6px;">Sections</div>';

  for (var si = 0; si < secs.length; si++) {
    var sec = secs[si];
    var secTitle = sec.name || sec.title || sec.floor || 'Section ' + (si + 1);
    var secTotal = sec.total || 0;
    subtotal += secTotal;
    html += '<div style="margin-bottom:8px;border:1px solid var(--border);border-radius:6px;padding:8px 10px;background:var(--surface-1);">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;">';
    html += '<span style="font-size:12px;font-weight:700;color:var(--text);">' + esc(secTitle) + '</span>';
    html += '<span style="font-size:12px;font-weight:700;color:var(--text);">' + secTotal.toLocaleString('fr-CA') + ' $</span>';
    html += '</div></div>';
  }

  html += '<div style="text-align:right;font-size:14px;font-weight:700;color:var(--text);padding:4px 0;margin-bottom:12px;">Subtotal: ' + subtotal.toLocaleString('fr-CA') + ' $</div>';

  html += '<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">';
  html += '<button onclick="saveDocVersion()" style="background:var(--surface-2);border:1px solid var(--border);color:var(--text);padding:8px 12px;border-radius:4px;font-size:11px;cursor:pointer;">Save Version</button>';
  html += '<button onclick="previewDoc()" style="background:var(--surface-2);border:1px solid var(--border);color:var(--text);padding:8px 12px;border-radius:4px;font-size:11px;cursor:pointer;">Preview</button>';
  html += '<button onclick="downloadDocPdf()" style="background:var(--accent);border:none;color:#fff;padding:8px 14px;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;">Download PDF</button>';
  html += '</div>';
  return html;
}

async function saveDocVersion() {
  var s = invoiceEditorState;
  try {
    var res = await fetch('/api/jobs/' + s.jobId + '/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docType: s.docType, sections: s.sections, paints: s.paints }),
    });
    var doc = await res.json();
    if (!res.ok) { alert(doc.error || 'Save failed'); return; }
    alert('Saved as v' + doc.version);
    loadDocVersions(s.jobId, s.docType);
  } catch (err) { alert('Error: ' + err.message); }
}

async function previewDoc() {
  var s = invoiceEditorState;
  try {
    var res = await fetch('/api/jobs/' + s.jobId + '/cost-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docType: s.docType, customSections: s.sections, customPaints: s.paints }),
    });
    var data = await res.json();
    if (!res.ok) { alert(data.error || 'Preview failed'); return; }
    // Show preview in the doc area
    var target = document.getElementById('doc-editor-target');
    target.innerHTML = '<div style="margin-bottom:8px;"><button onclick="loadDocSubContent(currentJobId, activeDocSubTab)" style="background:transparent;border:1px solid var(--border);color:var(--text-2);border-radius:4px;padding:6px 12px;font-size:11px;cursor:pointer;">← Back to editor</button></div>' +
      '<iframe srcdoc="' + esc(data.html) + '" style="width:100%;height:calc(100vh - 250px);border:none;border-radius:4px;background:#fff;"></iframe>';
  } catch (err) { alert('Error: ' + err.message); }
}

async function downloadDocPdf() {
  // Use existing cost-update PDF endpoint
  var s = invoiceEditorState;
  try {
    var res = await fetch('/api/jobs/' + s.jobId + '/cost-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docType: s.docType, customSections: s.sections, customPaints: s.paints, format: 'pdf' }),
    });
    if (!res.ok) { alert('PDF failed'); return; }
    var blob = await res.blob();
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = (s.jobNumber || 'job') + ' - ' + (s.docType === 'invoice' ? 'Invoice' : 'Cost Update') + '.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function() { URL.revokeObjectURL(url); }, 10000);
  } catch (err) { alert('Error: ' + err.message); }
}

async function loadDocVersions(jobId, docType) {
  var target = document.getElementById('doc-versions-target');
  if (!target) return;

  try {
    var res = await fetch('/api/jobs/' + jobId + '/documents?type=' + docType);
    var docs = await res.json();

    if (!docs.length) {
      target.innerHTML = '<div style="color:var(--text-4);font-size:12px;padding:8px;">No saved versions yet.</div>';
      return;
    }

    var html = '<div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-3);margin-bottom:6px;">Saved Versions</div>';
    for (var i = 0; i < docs.length; i++) {
      var d = docs[i];
      var date = new Date(d.created_at).toLocaleDateString('fr-CA', { month: 'short', day: 'numeric' });
      var statusLabel = d.status === 'sent' ? '<span style="color:#7a9a6a;font-weight:600;">Sent</span>' : '<span style="color:var(--text-4);">Saved</span>';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:var(--surface-1);border:1px solid var(--border);border-radius:4px;margin-bottom:4px;">';
      html += '<div><strong style="font-size:12px;">v' + d.version + '</strong> <span style="font-size:11px;color:var(--text-3);">' + date + '</span> ' + statusLabel + '</div>';
      html += '<div style="display:flex;gap:4px;">';
      html += '<a href="/api/jobs/' + jobId + '/documents/' + d.id + '/pdf" target="_blank" style="font-size:10px;color:var(--accent);text-decoration:none;padding:3px 6px;border:1px solid var(--border);border-radius:3px;">PDF</a>';
      if (d.status !== 'sent') {
        html += '<button onclick="markDocSent(\'' + d.id + '\')" style="font-size:10px;color:var(--text-2);background:transparent;border:1px solid var(--border);border-radius:3px;padding:3px 6px;cursor:pointer;">Mark Sent</button>';
      }
      html += '</div></div>';
    }
    target.innerHTML = html;
  } catch (err) {
    target.innerHTML = '<div style="color:var(--accent);font-size:12px;">Error loading versions</div>';
  }
}

async function markDocSent(docId) {
  try {
    await fetch('/api/jobs/' + currentJobId + '/documents/' + docId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'sent' }),
    });
    loadDocVersions(currentJobId, activeDocSubTab);
  } catch (err) { alert('Error: ' + err.message); }
}
```

- [ ] **Step 2: Add CSS for doc sub-tabs**

In index.html `<style>`, add:

```css
.doc-sub-tab {
  padding: 4px 10px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-3);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  font-family: var(--font-sans);
}
.doc-sub-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
```

- [ ] **Step 3: Commit**
```bash
git add public/js/jobs/docs.js public/index.html
git commit -m "feat: Docs tab — inline editor, version list, save, preview, PDF"
```

---

## Phase 3: Photos + Chat

### Task 3.1: Create basic job chat

**Files:**
- Create: `public/js/jobs/chat.js`
- Modify: `routes/jobs.js` — add message endpoints

- [ ] **Step 1: Add message endpoints to routes/jobs.js**

```javascript
// Job messages (Part 1: simple storage, no AI)
router.get('/api/jobs/:id/messages', async function(req, res) {
  try {
    var messages = await deps.db.all(
      'SELECT * FROM job_messages WHERE job_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json(messages);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/jobs/:id/messages', express.json(), async function(req, res) {
  try {
    var { role, content } = req.body;
    if (!content) return res.status(400).json({ error: 'Missing content' });
    var msg = await deps.db.get(
      'INSERT INTO job_messages (job_id, role, content) VALUES ($1, $2, $3) RETURNING *',
      [req.params.id, role || 'user', content]
    );
    res.json(msg);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
```

- [ ] **Step 2: Create chat.js**

```javascript
// public/js/jobs/chat.js — Basic job chat (Part 1: storage only, no AI)

async function loadJobChat(jobId) {
  var pane = document.getElementById('job-tab-chat');
  if (!pane) return;

  pane.innerHTML = '<div id="job-chat-messages" style="flex:1;overflow-y:auto;padding:12px;"></div>' +
    '<div style="display:flex;gap:6px;padding:8px 12px;border-top:1px solid var(--border);">' +
    '<input id="job-chat-input" type="text" placeholder="Type a note..." onkeydown="if(event.key===\'Enter\')sendJobChat()" style="flex:1;padding:8px 10px;background:var(--surface-1);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:13px;font-family:var(--font-sans);" />' +
    '<button onclick="sendJobChat()" style="padding:8px 14px;background:var(--accent);color:#fff;border:none;border-radius:4px;font-size:12px;font-weight:600;cursor:pointer;">Send</button>' +
    '</div>';

  pane.style.display = 'flex';
  pane.style.flexDirection = 'column';
  pane.style.height = '100%';

  try {
    var res = await fetch('/api/jobs/' + jobId + '/messages');
    var messages = await res.json();
    var el = document.getElementById('job-chat-messages');
    if (!messages.length) {
      el.innerHTML = '<div style="color:var(--text-4);font-size:12px;text-align:center;padding:40px 20px;">No messages yet.<br>Use this as a job scratchpad — AI chat coming in Part 2.</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      var isUser = m.role === 'user';
      html += '<div style="margin-bottom:8px;text-align:' + (isUser ? 'right' : 'left') + ';">';
      html += '<div style="display:inline-block;max-width:80%;padding:8px 12px;border-radius:8px;font-size:13px;line-height:1.5;' +
        (isUser ? 'background:var(--accent);color:#fff;' : 'background:var(--surface-1);color:var(--text);') + '">';
      html += esc(m.content);
      html += '</div></div>';
    }
    el.innerHTML = html;
    el.scrollTop = el.scrollHeight;
  } catch (err) {
    document.getElementById('job-chat-messages').innerHTML = '<div style="color:var(--accent);padding:12px;">Error: ' + esc(err.message) + '</div>';
  }
}

async function sendJobChat() {
  var input = document.getElementById('job-chat-input');
  if (!input) return;
  var text = input.value.trim();
  if (!text || !currentJobId) return;
  input.value = '';

  // Optimistic render
  var el = document.getElementById('job-chat-messages');
  var placeholder = el.querySelector('div[style*="text-align:center"]');
  if (placeholder) placeholder.remove();
  el.innerHTML += '<div style="margin-bottom:8px;text-align:right;"><div style="display:inline-block;max-width:80%;padding:8px 12px;border-radius:8px;font-size:13px;line-height:1.5;background:var(--accent);color:#fff;">' + esc(text) + '</div></div>';
  el.scrollTop = el.scrollHeight;

  try {
    await fetch('/api/jobs/' + currentJobId + '/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user', content: text }),
    });
  } catch (err) { /* message rendered optimistically, failure is silent for now */ }
}
```

- [ ] **Step 3: Commit**
```bash
git add public/js/jobs/chat.js routes/jobs.js
git commit -m "feat: basic job chat — message storage and display (no AI)"
```

---

### Task 3.2: Move photos into right panel

**Files:**
- Modify: `public/js/jobs/detail.js` — photos section renders thumbnails only
- Add: photos loading function for right panel

- [ ] **Step 1: Add loadJobPhotos function**

Add to `public/js/jobs/panel.js` (or create a dedicated file — simplest is to add to panel.js):

```javascript
async function loadJobPhotos(jobId) {
  var pane = document.getElementById('job-tab-photos');
  if (!pane) return;

  try {
    var res = await fetch('/api/jobs/' + jobId + '/attachments');
    var files = await res.json();

    if (!files.length) {
      pane.innerHTML = '<div style="text-align:center;color:var(--text-4);padding:40px 20px;font-size:12px;">No photos yet.</div>' +
        '<div style="text-align:center;"><label style="background:var(--surface-2);border:1px solid var(--border);border-radius:4px;padding:8px 16px;font-size:12px;cursor:pointer;color:var(--text-2);">+ Add Photos<input type="file" accept="image/*" multiple onchange="uploadJobPhotos(\'' + jobId + '\', this.files).then(function(){loadJobPhotos(\'' + jobId + '\')})" style="display:none" /></label></div>';
      return;
    }

    var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
    html += '<span style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-3);">Photos (' + files.length + ')</span>';
    html += '<label style="background:var(--surface-2);border:1px solid var(--border);border-radius:4px;padding:4px 10px;font-size:11px;cursor:pointer;color:var(--text-2);">+ Add<input type="file" accept="image/*" multiple onchange="uploadJobPhotos(\'' + jobId + '\', this.files).then(function(){loadJobPhotos(\'' + jobId + '\')})" style="display:none" /></label>';
    html += '</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:6px;">';
    for (var i = 0; i < files.length; i++) {
      html += '<a href="' + esc(files[i].public_url) + '" target="_blank" style="display:block;border-radius:4px;overflow:hidden;border:1px solid var(--border);aspect-ratio:1;"><img src="' + esc(files[i].public_url) + '" style="width:100%;height:100%;object-fit:cover;" alt="' + esc(files[i].original_name || '') + '"></a>';
    }
    html += '</div>';
    pane.innerHTML = html;
  } catch (err) {
    pane.innerHTML = '<div style="color:var(--accent);padding:12px;">Error: ' + esc(err.message) + '</div>';
  }
}
```

- [ ] **Step 2: Commit**
```bash
git add public/js/jobs/panel.js
git commit -m "feat: photos tab in job right panel"
```

---

### Task 3.3: Deploy and test Phase 2 + 3

- [ ] **Step 1: Run tests**
```bash
npm test
```

- [ ] **Step 2: Deploy**
```bash
npm run deploy
```

- [ ] **Step 3: Verify on live URL**
- Docs tab: sub-tabs switch (Invoice/Cost Update/Quote)
- Save version: creates v1, appears in version list
- PDF download works
- Mark as sent works
- Quote sub-tab shows original quote preview
- Chat: can type messages, they persist
- Photos: shows job photos, upload works
- Mobile: all 4 tabs work

- [ ] **Step 4: Commit**
```bash
git commit --allow-empty -m "checkpoint: Phase 2+3 verified on live"
```

---

## Phase 4: Migration + Cleanup

### Task 4.1: Remove old invoice modal

**Files:**
- Modify: `public/index.html` — remove invoice editor modal HTML
- Modify: `public/js/jobs/invoice-editor.js` — remove or deprecate modal functions

- [ ] **Step 1: Remove invoice editor modal from index.html**

Find and remove the `<!-- INVOICE / COST UPDATE EDITOR -->` modal div.

- [ ] **Step 2: Update openCostUpdate() to use Docs tab instead of modal**

In `public/js/jobs/invoice-editor.js`, change `openCostUpdate(jobId, docType)` to switch to the Docs tab:

```javascript
function openCostUpdate(jobId, docType) {
  activeDocSubTab = docType === 'invoice' ? 'invoice' : 'cost_update';
  setJobTab('docs');
}
```

- [ ] **Step 3: Clean up any remaining references to the old modal**

Search for `invoice-editor-modal` in all JS files and remove/update references.

- [ ] **Step 4: Commit**
```bash
git add public/index.html public/js/jobs/invoice-editor.js
git commit -m "refactor: remove invoice editor modal — replaced by inline Docs tab"
```

---

### Task 4.2: Clean up empty sessions + final deploy

- [ ] **Step 1: Delete empty NEW_ sessions**
```bash
curl -s https://op-quote-assistant.up.railway.app/api/sessions | python3 -c "
import json, sys
for s in json.load(sys.stdin):
    if (s.get('project_id','') or '').startswith('NEW_') and not s.get('quoteJson') and not (s.get('total_amount') or 0):
        print(s['id'])
" | while read sid; do curl -s -o /dev/null -X DELETE "https://op-quote-assistant.up.railway.app/api/sessions/$sid"; done
```

- [ ] **Step 2: Run tests**
```bash
npm test
```

- [ ] **Step 3: Final deploy**
```bash
npm run deploy
```

- [ ] **Step 4: Full verification**
- Desktop: dual-panel layout, all tabs work
- Mobile: 4 bottom tabs, detail default
- Docs: version saving, PDF, mark sent
- Chat: message persistence
- Photos: gallery + upload
- Existing features: payments, status, rename, Jibble, delete
- Quote assistant side: no regressions

- [ ] **Step 5: Update CONTEXT.md**

- [ ] **Step 6: Tag stable state**
```bash
git tag v1.1-dual-panel -m "Jobs dual-panel Part 1 complete"
git push origin v1.1-dual-panel
```

---

## Rollback Procedure

If anything is broken after deployment:

```bash
cd osteopeinture/quote-assistant
git log --oneline v1.0-pre-dual-panel..HEAD  # see what was added
git revert --no-commit v1.0-pre-dual-panel..HEAD
git commit -m "revert: rollback dual-panel to v1.0-pre-dual-panel"
npm run deploy
```

The database tables (`job_documents`, `job_messages`) are additive — they don't affect existing functionality even if the code is reverted. They just sit unused.
