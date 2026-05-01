# CONTEXT — OP Hub (OstéoPeinture Quote Assistant)

Chat-based quoting tool for OstéoPeinture. Generates interior and exterior painting quotes via Claude conversation, renders branded PDFs, manages jobs, payments, and email drafts.

## Status

**Live URL:** https://op-quote-assistant.up.railway.app
**Last deploy:** 2026-05-01 (Session L)
**Database:** Supabase Postgres (free tier — no automatic backups, custom JSON backup implemented)

### What works
- Interior + exterior quote generation via Claude chat
- Draft editor (editable quote fields, drag-to-reorder sections AND groups, live totals)
- PDF rendering (Letter/Legal auto-switch, branded with signature)
- Scaffold access quoting (EMCO 2025 catalog, half-levels, user quantity overrides)
- Image gallery (upload, Supabase storage, per-session + per-job)
- Job management (convert quote → job, payments, scratchpad, smart paste, status dropdown, photo upload)
- Invoice/cost update editor (editable sections, paints, save/undo, download PDF, email)
- Email drafting (8 scenarios, past-email tone matching via Supabase, Resend HTTP API)
- Streaming Claude responses (SSE)
- Dynamic system prompt (loads only relevant QUOTING_LOGIC sections)
- Quote merge: field-level merge preserving all manual edits (only total + range from Claude)
- Undo: red toast after Claude changes quote, one-tap revert (persisted to DB)
- Auto-cleanup: empty NEW_ sessions deleted on sidebar load
- Sidebar: status dropdown (color-coded), collapsible archive, per-session toggle persistence
- Soft delete: sessions and jobs use deleted_at instead of hard delete
- XSS sanitization: DOMPurify on all markdown output
- Transactional quote-to-job conversion (BEGIN/COMMIT/ROLLBACK)
- Postgres JSON backup on startup + admin endpoint
- Performance: cached session/job lists, no click delay, loading spinners, no redundant fetches
- Auth: login page + signed cookie ready (not yet activated)
- Haiku by default, Sonnet only for full quote JSON generation (~80% cost reduction)
- 26/28 tests passing (2 pre-existing failures in server-messages.test.js)

### Active blockers
- Auth not activated (APP_PASSWORD not set in Railway)
- API credits depleted — needs top-up at console.anthropic.com

### Next steps
- Activate auth: set APP_PASSWORD + APP_SECRET in Railway dashboard
- Top up Anthropic API credits
- Test full app after modularization (mobile + desktop)
- Design + build Jobs dual-panel with chat (separate spec)

## Architecture

**Modular structure (Session L rewrite):**

```
server.js                    (~585 lines — bootstrap, middleware, mount routers)
routes/
  quotes.js                  — session CRUD, messages, Claude chat SSE, quote merge
  jobs.js                    — job CRUD, payments, time entries, change orders
  invoices.js                — cost update, invoice editor, PDF generation
  email.js                   — email drafting, sending (standalone + session)
  attachments.js             — upload, list, delete (sessions + jobs)
  scaffold.js                — calculate_scaffold tool handler
  admin.js                   — backup, restore, quoting rules
services/
  session-service.js         — getSession, saveSession, listSessions
  job-service.js             — getJob, createJob, convertSessionToJob (transactional)
  pdf-service.js             — generateQuotePDF (Playwright)
  attachment-service.js      — upload/list/delete via Supabase storage
lib/
  quote-renderer.js          — renderQuoteHTML (pure function)
  quote-merge.js             — field-level merge + fuzzy section matching
  auth.js                    — shared password middleware + cookie
  pg-backup.js               — Postgres JSON export with rotation
  scaffold-engine.js         — deterministic scaffold calculations
  shared.js                  — extractJsonString, buildCompactStoredUserContent
  db.js                      — Supabase Postgres wrapper with transaction()
public/
  index.html                 (~2,557 lines — HTML + CSS only, zero inline JS)
  login.html                 — auth login page
  js/
    state.js                 — all global state
    api.js                   — fetch wrappers with caching
    shared.js                — esc(), formatMoney(), DOM utilities
    panel.js                 — panel mode switching, divider, mobile nav
    app.js                   — init, event listeners
    quotes/sidebar.js        — quote list, status, archive
    quotes/chat.js           — chat messages, SSE, send, convert-to-job
    quotes/draft-editor.js   — draft editing, drag-to-reorder, undo
    quotes/gallery.js        — image gallery
    jobs/sidebar.js          — job list, color ribbons
    jobs/detail.js           — job detail panel
    jobs/invoice-editor.js   — invoice/cost update editor
    email.js                 — email form, smart paste, payment modal
```

## Critical conventions

### Deploy protocol (mandatory)
**Always use `npm run deploy`**, never bare `railway up`.

### Environment variables (Railway dashboard)
ANTHROPIC_API_KEY, OPENAI_API_KEY, RESEND_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, DATABASE_URL, FLASK_SECRET_KEY, APP_PASSWORD (not yet set), APP_SECRET (not yet set)

## Session L (2026-05-01)

**Full codebase modularization + safety + performance overhaul.**

**Phase 0 — Performance:**
- Removed 250ms sidebar click delay
- Cached session + job lists (invalidate on mutation, refetch on foreground)
- Loading spinner on sidebar items
- Fixed startup double-fetch
- De-duplicated job fetches (dashboard + sidebar share one cache)

**Phase 1 — Safety:**
- XSS: DOMPurify on all marked.parse() output
- Transactional quote-to-job conversion (Postgres BEGIN/COMMIT/ROLLBACK)
- Soft delete for sessions and jobs (deleted_at column)
- Postgres JSON backup (startup + admin endpoint, 7-day rotation)

**Phase 2 — Server modularization:**
- server.js: 4,459 → 585 lines
- 7 route files, 4 service files, 3 lib modules extracted
- Each module owns its domain — changes can't cascade

**Phase 3 — Frontend modularization:**
- index.html: 6,287 → 2,557 lines (HTML + CSS only)
- 13 JS files organized by feature
- Global state centralized in state.js

**Phase 4 — Auth:**
- Login page, signed httpOnly cookie, 30-day expiry
- Auth middleware on all /api/ routes
- Dev mode bypass when APP_PASSWORD not set

**Other fixes:**
- Haiku by default, Sonnet only for full quote generation (~80% cost savings)
- Item description rules: no prep steps, no boilerplate repeats, client-facing language
- Group headers (H1) draggable in draft editor
- Codex full code review documented

## Related docs
- Modularization spec: `docs/superpowers/specs/2026-05-01-modularization-design.md`
- Implementation plan: `docs/superpowers/plans/2026-05-01-modularization-and-performance.md`
- Codex code review: captured in session history
- Scaffold module spec: `docs/superpowers/specs/2026-04-10-scaffold-module-design.md`
