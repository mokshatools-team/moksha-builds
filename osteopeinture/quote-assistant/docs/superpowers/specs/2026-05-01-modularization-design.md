# OP Hub Modularization & Safety — Design Spec

**Date:** 2026-05-01
**Status:** Draft
**Build:** OP Hub Quote Assistant (osteopeinture/quote-assistant)
**Reviewed by:** Codex (approved with modifications)

---

## Overview

Restructure the OP Hub codebase from two monolithic files (server.js 4,459 lines, index.html 6,287 lines) into isolated modules. Fix critical safety issues. Prepare the architecture for Jobs dual-panel + chat.

### Goals
1. Stop cascading bugs — changes in one area can't break others
2. Fix data safety: soft delete, real Postgres backup, XSS sanitization, transactional operations
3. Simple auth for 3 internal users (shared password, persistent cookie)
4. Structure accommodates future Jobs dual-panel with its own chat
5. No functionality changes — same app, same behavior, cleaner code

### Non-goals
- No new features (Jobs dual-panel is a separate spec)
- No UI redesign
- No database schema migration beyond soft delete columns
- No user management system

---

## Phase 1: Safety Fixes (before any modularization)

### 1A. XSS Sanitization
- Add DOMPurify to the frontend
- Wrap all `marked.parse()` output with `DOMPurify.sanitize()` before `innerHTML` assignment
- Applies to: chat messages, any AI-generated content rendered as HTML

### 1B. Transactional Quote-to-Job Conversion
- Wrap `convertSessionToJob()` in a Postgres transaction (BEGIN/COMMIT/ROLLBACK)
- Steps: create job → write products → transfer attachments → mark session converted
- If any step fails, entire operation rolls back
- Requires: `db.js` must expose a `transaction()` helper that takes a callback

### 1C. Soft Delete
- Add `deleted_at TIMESTAMPTZ DEFAULT NULL` column to `sessions` and `jobs` tables
- All list/get queries add `WHERE deleted_at IS NULL`
- DELETE endpoints set `deleted_at = NOW()` instead of removing rows
- Add admin endpoint `POST /api/admin/purge` for permanent deletion (future use)
- Existing auto-cleanup (empty NEW_ sessions) uses soft delete too

### 1D. Postgres Backup
- Remove old SQLite backup code (`lib/db-backup.js`, related endpoints)
- New `lib/pg-backup.js`: exports all sessions + jobs + payments + attachments as JSON
- Store backup to Google Drive via `gws` CLI (already authenticated)
- Run on app startup + expose `POST /api/admin/backup` endpoint
- Keep 7 daily backups (overwrite oldest)
- Backup file format: `op-hub-backup-YYYY-MM-DD.json`

---

## Phase 2: Server Modularization

### Target Structure

```
server.js                    (~200 lines — bootstrap, middleware, mount routers)
routes/
  quotes.js                  — session CRUD, messages, Claude chat SSE
  jobs.js                    — job CRUD, payments, time entries, change orders, status
  invoices.js                — cost update, invoice editor, PDF generation
  email.js                   — email drafting, sending (standalone + session)
  attachments.js             — upload, list, delete (sessions + jobs)
  scaffold.js                — calculate_scaffold tool handler
  admin.js                   — backup, restore, quoting rules
services/
  session-service.js         — getSession, saveSession, listSessions, soft delete
  job-service.js             — getJob, createJob, convertSessionToJob (transactional)
  invoice-service.js         — buildCostUpdate, generateInvoicePDF
  attachment-service.js      — upload to Supabase, list, soft delete
  pdf-service.js             — generateQuotePDF (Playwright wrapper)
  chat-service.js            — handleSessionMessage, Claude API, streaming SSE
lib/
  quote-renderer.js          — renderQuoteHTML (extracted, pure function)
  quote-merge.js             — field-level merge + undo logic
  auth.js                    — shared password middleware + cookie
  pg-backup.js               — Postgres JSON export
  scaffold-engine.js         — unchanged
  db.js                      — add transaction() helper, otherwise unchanged
```

### Extraction Order (safest sequence)

1. **Extract pure helpers** — `renderQuoteHTML`, `quote-merge`, `esc()`, `formatMoney` server-side
2. **Extract services** — session-service, job-service, attachment-service, pdf-service, chat-service, invoice-service
3. **Move routes** — one at a time: admin → scaffold → attachments → email → invoices → jobs → quotes
4. **Quotes last** because it has the most coupling (chat, merge, SSE, Claude API)

### Rules During Migration
- Freeze API response shapes — frontend must not notice the change
- After each route extraction: run tests, deploy, verify on live URL
- No two route files extract in the same commit
- `server.js` shrinks with each extraction (never grows)

---

## Phase 3: Frontend Modularization

### Target Structure

```
public/
  index.html                 (~300 lines — HTML structure, CSS, script imports)
  js/
    app.js                   — startup, routing, global event listeners
    state.js                 — single source of truth for app state
                               (currentSessionId, currentJobId, mobileCurrentView,
                                draftQuoteJson, invoiceEditorState, etc.)
    api.js                   — all fetch() calls wrapped with error handling
    shared.js                — esc(), formatMoney(), toast, DOM utilities
    quotes/
      sidebar.js             — quote list, status dropdown, archive toggle
      chat.js                — message rendering, send, SSE streaming
      draft-editor.js        — draft section editing, drag-to-reorder
      gallery.js             — image gallery, upload
    jobs/
      sidebar.js             — job list, color ribbons, status groups
      detail.js              — job detail panel rendering
      invoice-editor.js      — invoice/cost update editor
    email.js                 — email form, generate, refine, send
    panel.js                 — panel mode switching, divider resize
```

### State Management (`state.js`)
- All mutable globals move here
- Exports getter/setter functions (not raw variables)
- Other modules import what they need
- Prevents the "four coupled files" problem Codex flagged

### Migration Approach
- Extract `state.js` and `api.js` first
- Then extract one UI module at a time
- Keep `index.html` as the shell with `<script type="module">` imports
- CSS stays in `index.html` for now (separate concern, separate spec)

---

## Phase 4: Auth

### Design
- Login page: single password field, "Enter" to submit
- Server checks against `APP_PASSWORD` environment variable (Railway dashboard)
- On success: set signed `httpOnly` cookie, `secure: true`, `sameSite: 'Lax'`, 30-day expiry
- Auth middleware on all `/api/*` routes
- Exempt routes: `GET /` (serves login if no cookie, app if valid cookie), static assets
- Preview routes (`/preview/*`) require auth too

### Implementation
- `lib/auth.js` exports middleware function
- Uses `cookie-signature` or simple HMAC with `APP_SECRET` env var
- Login endpoint: `POST /api/auth/login`
- No user accounts, no registration, no password reset
- To change password: update `APP_PASSWORD` in Railway dashboard

### PWA Considerations
- 30-day cookie means no re-login for a month
- If cookie expires, PWA shows login page on next open
- No localStorage tokens — httpOnly cookie only

---

## Future-Proofing: Jobs as First-Class Domain

Per Codex's recommendation, the service/route structure treats jobs independently:
- `job-service.js` owns job logic, not just "converted session" logic
- Job chat will be a separate conversation model (separate messages table or `job_messages` column)
- Job routes don't assume a job started as a quote
- This means the future Jobs dual-panel spec can add chat without restructuring

---

## Execution Phases

| Phase | Scope | Sessions | Risk |
|-------|-------|----------|------|
| 1A-1D | Safety fixes | ~1 session | Low — additive changes, no restructuring |
| 2 | Server modularization | ~2 sessions | Medium — must preserve exact API behavior |
| 3 | Frontend modularization | ~2 sessions | Medium — must preserve exact UI behavior |
| 4 | Auth | ~0.5 session | Low — new middleware, login page |

**Total estimated work:** 5-6 sessions

### Success Criteria
- All 26 existing tests still pass after each phase
- Live URL works identically after each deploy
- No data loss, no functionality changes
- `server.js` < 250 lines
- No single JS file > 600 lines
- Editing one module doesn't require reading another
