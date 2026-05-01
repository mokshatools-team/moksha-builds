# OP Hub Modularization, Safety & Performance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make OP Hub fast, safe, and maintainable — stop cascading bugs, protect data, improve responsiveness, prepare for Jobs dual-panel.

**Architecture:** Phase 0 fixes performance in the existing monolith. Phases 1-4 restructure the codebase incrementally: safety fixes first, then server modularization, frontend modularization, and auth. Each phase deploys independently and preserves existing behavior.

**Tech Stack:** Node.js/Express, Supabase Postgres, single-page HTML/JS frontend, Railway deployment, DOMPurify, cookie-based auth.

**Spec:** `docs/superpowers/specs/2026-05-01-modularization-design.md`

---

## Phase 0: Performance Fixes (no restructuring)

### Task 0.1: Remove 250ms Sidebar Click Delay

**Files:**
- Modify: `public/index.html` — `handleSidebarClick()` (~line 2634)

- [ ] **Step 1: Remove the setTimeout delay**

Replace:
```javascript
let sidebarClickTimer = null;
let isRenaming = false;

function handleSidebarClick(id) {
  if (isRenaming) return;
  if (sidebarClickTimer) clearTimeout(sidebarClickTimer);
  sidebarClickTimer = setTimeout(() => { loadSession(id); }, 250);
}
```

With:
```javascript
let isRenaming = false;

function handleSidebarClick(id) {
  if (isRenaming) return;
  // Immediate highlight before async load
  document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
  const clicked = event.currentTarget;
  if (clicked) clicked.classList.add('active');
  loadSession(id);
}
```

- [ ] **Step 2: Update startRenameSession to remove timer reference**

Remove the `if (sidebarClickTimer) clearTimeout(sidebarClickTimer);` line from `startRenameSession()` since the timer no longer exists.

- [ ] **Step 3: Test — tap sidebar item, should load immediately with no delay**

- [ ] **Step 4: Commit**
```bash
git add public/index.html
git commit -m "perf: remove 250ms sidebar click delay"
```

---

### Task 0.2: Stop Redundant Sidebar Refetch After Session Load

**Files:**
- Modify: `public/index.html` — `loadSession()` (~line 2716), add `setActiveSessionInSidebar()`

- [ ] **Step 1: Add setActiveSessionInSidebar function**

Add before `loadSession()`:
```javascript
function setActiveSessionInSidebar(id) {
  document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
  const items = document.querySelectorAll('.sidebar-item');
  items.forEach(el => {
    if (el.getAttribute('onclick')?.includes(id)) el.classList.add('active');
  });
}
```

- [ ] **Step 2: Replace loadSidebar() call in loadSession()**

In `loadSession()`, replace line `loadSidebar();` (around line 2770) with:
```javascript
setActiveSessionInSidebar(id);
```

- [ ] **Step 3: Test — switching between sidebar sessions should not cause sidebar flicker/rebuild**

- [ ] **Step 4: Commit**
```bash
git add public/index.html
git commit -m "perf: stop redundant sidebar refetch on session load"
```

---

### Task 0.3: Cache Session List

**Files:**
- Modify: `public/index.html` — `loadSidebar()` (~line 2577), add cache layer

- [ ] **Step 1: Add session list cache and fetchSessions()**

Add before `loadSidebar()`:
```javascript
let _sessionListCache = null;
let _sessionFetchInFlight = null;

async function fetchSessions(force = false) {
  if (!force && _sessionListCache) return _sessionListCache;
  if (_sessionFetchInFlight) return _sessionFetchInFlight;
  _sessionFetchInFlight = fetch('/api/sessions').then(r => r.json()).then(data => {
    _sessionListCache = data;
    _sessionFetchInFlight = null;
    return data;
  }).catch(err => {
    _sessionFetchInFlight = null;
    throw err;
  });
  return _sessionFetchInFlight;
}

function invalidateSessionCache() {
  _sessionListCache = null;
}
```

- [ ] **Step 2: Update loadSidebar() to use cache**

Replace the fetch line in `loadSidebar()`:
```javascript
// Old: const res = await fetch('/api/sessions');
//      const allSessions = await res.json();
// New:
const allSessions = await fetchSessions();
```

- [ ] **Step 3: Call invalidateSessionCache() before loadSidebar() where fresh data is needed**

Add `invalidateSessionCache()` before `loadSidebar()` calls in:
- `startNewSession()` — after creating
- `deleteSession()` — after deleting  
- `setSessionStatus()` — after status change
- `convertViaStatusBadge()` / convert-to-job flow — after conversion
- `finishRenameSession()` — after rename

Do NOT add it in `loadSession()` (that call was already removed in Task 0.2).

- [ ] **Step 4: Add visibilitychange listener for stale-while-revalidate**

Add near the INIT section:
```javascript
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    invalidateSessionCache();
    loadSidebar();
    if (currentSidebarMode === 'jobs') {
      invalidateJobsCache();
      loadJobs();
      loadJobsSidebar();
    }
  }
});
```

- [ ] **Step 5: Test — sidebar loads fast on second visit, refreshes when app returns to foreground**

- [ ] **Step 6: Commit**
```bash
git add public/index.html
git commit -m "perf: cache session list, refetch on foreground"
```

---

### Task 0.4: Cache Jobs List and Unify Fetches

**Files:**
- Modify: `public/index.html` — `loadJobs()` (~line 4412), `loadJobsSidebar()` (~line 5423)

- [ ] **Step 1: Add jobs cache**

Add before `loadJobs()`:
```javascript
let _jobsCache = null;
let _jobsFetchInFlight = null;

async function fetchJobs(force = false) {
  if (!force && _jobsCache) return _jobsCache;
  if (_jobsFetchInFlight) return _jobsFetchInFlight;
  _jobsFetchInFlight = fetch('/api/jobs').then(r => r.json()).then(data => {
    _jobsCache = data;
    _jobsFetchInFlight = null;
    return data;
  }).catch(err => {
    _jobsFetchInFlight = null;
    throw err;
  });
  return _jobsFetchInFlight;
}

function invalidateJobsCache() {
  _jobsCache = null;
}

function updateJobInCache(jobId, updates) {
  if (!_jobsCache) return;
  const idx = _jobsCache.findIndex(j => j.id === jobId);
  if (idx >= 0) Object.assign(_jobsCache[idx], updates);
}
```

- [ ] **Step 2: Update loadJobs() to use cache**

Replace the fetch in `loadJobs()`:
```javascript
// Old: const res = await fetch('/api/jobs');
//      const jobs = await res.json();
// New:
const jobs = await fetchJobs();
```

- [ ] **Step 3: Update loadJobsSidebar() to use same cache**

Replace the fetch in `loadJobsSidebar()`:
```javascript
// Old: const res = await fetch('/api/jobs');
//      const jobs = await res.json();
// New:
const jobs = await fetchJobs();
```

- [ ] **Step 4: Update saveJobField() to update cache locally**

After the PATCH call in `saveJobField()`, add:
```javascript
updateJobInCache(jobId, { [field]: value });
```

- [ ] **Step 5: Add invalidateJobsCache() before refetch calls**

Add `invalidateJobsCache()` in:
- `deleteJob()` — after deleting
- Convert-to-job flow — after job creation
- `recordPayment()` flow — after payment recorded

For status changes (`saveJobField` for status), the local cache update from Step 4 is enough — no invalidation needed.

- [ ] **Step 6: Remove duplicate loadJobs()+loadJobsSidebar() calls**

In places that call both (like `onchange="saveJobField(this);loadJobs();loadJobsSidebar()"`), change to:
```javascript
onchange="saveJobField(this);loadJobs();loadJobsSidebar()"
```
These now share the same cached data so there's only 1 fetch, but both renders still happen (they render to different DOM targets). This is fine — the cost is in the fetch, not the render.

- [ ] **Step 7: Test — changing job status should not cause visible flicker, no duplicate network requests**

- [ ] **Step 8: Commit**
```bash
git add public/index.html
git commit -m "perf: cache jobs list, unify fetches, local cache updates"
```

---

### Task 0.5: Add Loading Feedback

**Files:**
- Modify: `public/index.html` — CSS + `loadSession()`, `openJobDetail()`

- [ ] **Step 1: Add CSS for loading states**

Add to the `<style>` block:
```css
.sidebar-item.loading {
  opacity: 0.6;
  pointer-events: none;
}
.sidebar-item.loading::after {
  content: '';
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid var(--text-4);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
}
@keyframes spin { to { transform: translateY(-50%) rotate(360deg); } }
.job-card:active {
  transform: scale(0.98);
  opacity: 0.8;
}
```

- [ ] **Step 2: Add loading class in handleSidebarClick()**

Update `handleSidebarClick()` to add loading class:
```javascript
function handleSidebarClick(id) {
  if (isRenaming) return;
  document.querySelectorAll('.sidebar-item').forEach(el => {
    el.classList.remove('active');
    el.classList.remove('loading');
  });
  const clicked = event.currentTarget;
  if (clicked) {
    clicked.classList.add('active');
    clicked.classList.add('loading');
  }
  loadSession(id).finally(() => {
    if (clicked) clicked.classList.remove('loading');
  });
}
```

Note: `loadSession()` must return its promise for `.finally()` to work. Ensure `loadSession` is declared as `async function loadSession(id)` (it already is).

- [ ] **Step 3: Add loading state to openJobDetail()**

The job detail already shows "Loading..." text (line ~4917). No change needed — but add a pressed state to the job card click. The CSS from Step 1 (`.job-card:active`) handles this.

- [ ] **Step 4: Test — tap sidebar item, see spinner on the item while loading. Tap job card, see brief scale-down.**

- [ ] **Step 5: Commit**
```bash
git add public/index.html
git commit -m "perf: add loading feedback — sidebar spinner, job card press"
```

---

### Task 0.6: Fix Startup Double-Fetch

**Files:**
- Modify: `public/index.html` — INIT block (~line 6267)

- [ ] **Step 1: Fix startup to avoid fetching sessions twice**

Replace the init block:
```javascript
// Old:
loadSidebar();
(function checkUrlSession() {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session');
  if (sessionId) {
    loadSession(sessionId);
    return;
  }
  if (window.innerWidth <= 768) {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebar-overlay').classList.add('visible');
  }
})();
```

With:
```javascript
(async function init() {
  await loadSidebar();
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session');
  if (sessionId) {
    loadSession(sessionId); // loadSession no longer refetches sidebar
  } else if (window.innerWidth <= 768) {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebar-overlay').classList.add('visible');
  }
})();
```

- [ ] **Step 2: Test — page load with ?session=xyz should only fetch /api/sessions once**

- [ ] **Step 3: Commit**
```bash
git add public/index.html
git commit -m "perf: fix startup double-fetch of sessions"
```

---

### Task 0.7: Deploy and Verify Phase 0

- [ ] **Step 1: Run tests**
```bash
cd osteopeinture/quote-assistant && npm test
```
Expected: 26 pass, 2 fail (pre-existing)

- [ ] **Step 2: Deploy**
```bash
npm run deploy
```

- [ ] **Step 3: Verify on live URL**
- Tap sidebar items — instant response, no 250ms delay
- Switch between sessions — no sidebar flicker
- Change job status — no duplicate fetches
- Background app and return — data refreshes
- Page load — only one /api/sessions call

- [ ] **Step 4: Commit verification note to CONTEXT.md**

---

## Phase 1: Safety Fixes

### Task 1.1: XSS Sanitization

**Files:**
- Modify: `public/index.html` — add DOMPurify CDN, wrap `marked.parse()` calls

- [ ] **Step 1: Add DOMPurify CDN link**

Add before `<script>` in index.html:
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.0.8/purify.min.js"></script>
```

- [ ] **Step 2: Find all marked.parse() calls and wrap with DOMPurify.sanitize()**

Search for `marked.parse(` in index.html. For each occurrence, wrap:
```javascript
// Old: el.innerHTML = marked.parse(text);
// New: el.innerHTML = DOMPurify.sanitize(marked.parse(text));
```

- [ ] **Step 3: Test — send a message with `<script>alert(1)</script>` in chat, verify it renders as text not script**

- [ ] **Step 4: Commit**
```bash
git add public/index.html
git commit -m "security: sanitize markdown HTML output with DOMPurify"
```

---

### Task 1.2: Add Transaction Helper to db.js

**Files:**
- Modify: `db.js` — add `transaction()` method

- [ ] **Step 1: Add transaction helper**

Add to the db wrapper object:
```javascript
async transaction(fn) {
  await this.run('BEGIN');
  try {
    const result = await fn(this);
    await this.run('COMMIT');
    return result;
  } catch (err) {
    await this.run('ROLLBACK');
    throw err;
  }
}
```

- [ ] **Step 2: Commit**
```bash
git add db.js
git commit -m "feat: add transaction() helper to db wrapper"
```

---

### Task 1.3: Transactional Quote-to-Job Conversion

**Files:**
- Modify: `server.js` — wrap `convertSessionToJob()` in transaction

- [ ] **Step 1: Wrap the conversion in db.transaction()**

Find `convertSessionToJob()` (around line 247). Wrap the body:
```javascript
async function convertSessionToJob(sessionId, overrides) {
  return await db.transaction(async (tx) => {
    // All existing db.run/db.get calls inside use tx instead of db
    // ... (keep all existing logic, just wrap in transaction)
  });
}
```

Note: since `db.transaction()` uses the same connection, and the wrapper's `run`/`get`/`all` methods use the pool, the transaction needs to use the same client. This requires a small adjustment to the transaction helper — it should acquire a client and pass it to the callback.

- [ ] **Step 2: Update transaction helper for client-scoped queries**

Update `db.js` transaction to use a dedicated client:
```javascript
async transaction(fn) {
  const client = await this.pool.connect();
  try {
    await client.query('BEGIN');
    const scopedDb = {
      run: (sql, params) => client.query(sql, params),
      get: async (sql, params) => { const r = await client.query(sql, params); return r.rows[0] || null; },
      all: async (sql, params) => { const r = await client.query(sql, params); return r.rows; },
    };
    const result = await fn(scopedDb);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 3: Test — convert a quote to a job, verify it works. Force an error mid-conversion, verify nothing was partially created.**

- [ ] **Step 4: Commit**
```bash
git add db.js server.js
git commit -m "safety: transactional quote-to-job conversion"
```

---

### Task 1.4: Soft Delete for Sessions

**Files:**
- Modify: `server.js` — session delete endpoint, listSessions, getSession, auto-cleanup

- [ ] **Step 1: Add deleted_at column**

Add to the table creation / migration logic:
```sql
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
```

- [ ] **Step 2: Update delete endpoint to soft delete**

Replace the DELETE handler:
```javascript
// Old: await db.run('DELETE FROM sessions WHERE id = ?', [req.params.id]);
// New: await db.run('UPDATE sessions SET deleted_at = NOW() WHERE id = $1', [req.params.id]);
```

- [ ] **Step 3: Update listSessions to filter deleted**

Add `WHERE deleted_at IS NULL` to the SELECT in `listSessions()`.

- [ ] **Step 4: Update getSession to filter deleted**

Add `AND deleted_at IS NULL` to the SELECT in `getSession()`.

- [ ] **Step 5: Update auto-cleanup to use soft delete**

Change the cleanup DELETE to UPDATE SET deleted_at = NOW().

- [ ] **Step 6: Test — delete a session, verify it disappears from list but still exists in DB. Verify getSession returns null for deleted sessions.**

- [ ] **Step 7: Commit**
```bash
git add server.js
git commit -m "safety: soft delete for sessions (deleted_at column)"
```

---

### Task 1.5: Soft Delete for Jobs

**Files:**
- Modify: `server.js` — job delete endpoint, listJobs, getJob

- [ ] **Step 1: Add deleted_at column to jobs**
```sql
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
```

- [ ] **Step 2: Update job delete to soft delete**
- [ ] **Step 3: Update listJobs and getJob to filter deleted**
- [ ] **Step 4: Test**
- [ ] **Step 5: Commit**
```bash
git add server.js
git commit -m "safety: soft delete for jobs (deleted_at column)"
```

---

### Task 1.6: Postgres Backup

**Files:**
- Create: `lib/pg-backup.js`
- Modify: `server.js` — remove old SQLite backup references, add backup endpoint

- [ ] **Step 1: Create pg-backup.js**

```javascript
const { execSync } = require('child_process');
const path = require('path');

async function exportToJson(db) {
  const sessions = await db.all('SELECT * FROM sessions WHERE deleted_at IS NULL');
  const jobs = await db.all('SELECT * FROM jobs WHERE deleted_at IS NULL');
  const payments = await db.all('SELECT * FROM payments');
  const attachments = await db.all('SELECT * FROM attachments');
  const changeOrders = await db.all('SELECT * FROM job_change_orders');
  return JSON.stringify({ exportedAt: new Date().toISOString(), sessions, jobs, payments, attachments, changeOrders }, null, 2);
}

async function backupToDrive(db) {
  const json = await exportToJson(db);
  const date = new Date().toISOString().slice(0, 10);
  const filename = `op-hub-backup-${date}.json`;
  const tmpPath = path.join('/tmp', filename);
  require('fs').writeFileSync(tmpPath, json);
  try {
    execSync(`gws drive upload "${tmpPath}" --name "${filename}" --folder "OP Hub Backups"`, { timeout: 30000 });
    console.log('[backup] Saved to Drive:', filename);
    return { ok: true, filename };
  } catch (err) {
    console.error('[backup] Drive upload failed:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { exportToJson, backupToDrive };
```

- [ ] **Step 2: Add backup endpoint in server.js**

```javascript
app.post('/api/admin/backup', async (req, res) => {
  const { backupToDrive } = require('./lib/pg-backup');
  const result = await backupToDrive(db);
  res.json(result);
});
```

- [ ] **Step 3: Add backup on startup**

```javascript
// At end of server startup, after DB init:
setTimeout(async () => {
  try {
    const { backupToDrive } = require('./lib/pg-backup');
    await backupToDrive(db);
  } catch (e) { console.error('[backup] startup backup failed:', e.message); }
}, 10000); // 10s delay so app starts first
```

- [ ] **Step 4: Remove old SQLite backup code references**

Remove or comment out old `db-backup.js` require and related backup endpoints.

- [ ] **Step 5: Test — call POST /api/admin/backup, verify JSON file appears in Drive**

- [ ] **Step 6: Commit**
```bash
git add lib/pg-backup.js server.js
git commit -m "safety: Postgres JSON backup to Google Drive"
```

---

### Task 1.7: Deploy and Verify Phase 1

- [ ] **Step 1: Run tests** — 26 pass expected
- [ ] **Step 2: Deploy**
- [ ] **Step 3: Verify on live URL**
  - XSS: paste `<img onerror=alert(1) src=x>` in chat — should render as text
  - Soft delete: delete a test session, verify gone from UI but in DB
  - Backup: hit backup endpoint, check Drive
  - Convert quote to job — still works, no partial state on error
- [ ] **Step 4: Update CONTEXT.md**

---

## Phase 2: Server Modularization

> Detailed task breakdown for Phase 2 will be written at the start of the Phase 2 session, following the spec structure: extract pure helpers → extract services → move routes one at a time. Each extraction is one task with test/deploy/verify steps.

**Estimated tasks:** 12-15 (one per extracted module)
**Estimated sessions:** 2

---

## Phase 3: Frontend Modularization

> Detailed task breakdown for Phase 3 will be written at the start of the Phase 3 session, following the spec structure: extract state.js + api.js → extract UI modules one at a time.

**Estimated tasks:** 10-12
**Estimated sessions:** 2

---

## Phase 4: Auth

> Detailed task breakdown for Phase 4 will be written at the start of the Phase 4 session. Scope: login page, auth middleware, cookie signing, route exemptions.

**Estimated tasks:** 5-6
**Estimated sessions:** 0.5

---

## Success Criteria (all phases)

- All 26 existing tests pass after each phase
- Live URL works identically after each deploy
- No data loss, no functionality changes
- After Phase 2: `server.js` < 250 lines, no route file > 400 lines
- After Phase 3: `index.html` < 400 lines, no JS file > 600 lines
- After Phase 4: all API endpoints require auth, PWA login persists 30 days
