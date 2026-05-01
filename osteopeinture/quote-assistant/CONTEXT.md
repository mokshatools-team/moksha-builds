# CONTEXT — OP Hub (OstéoPeinture Quote Assistant)

Chat-based quoting tool for OstéoPeinture. Generates interior and exterior painting quotes via Claude conversation, renders branded PDFs, manages jobs, payments, and email drafts.

## Status

**Live URL:** https://op-quote-assistant.up.railway.app
**Last deploy:** 2026-04-30 (Session K)
**Database:** Supabase Postgres (free tier — no automatic backups)

### What works
- Interior + exterior quote generation via Claude chat
- Draft editor (editable quote fields, drag-to-reorder, live totals)
- PDF rendering (Letter/Legal auto-switch, branded with signature)
- Scaffold access quoting (EMCO 2025 catalog, deterministic engine, half-levels, user quantity overrides)
- Image gallery (upload, Supabase storage, per-session + per-job)
- Job management (convert quote → job, payments, scratchpad, smart paste, status dropdown, photo upload)
- Invoice/cost update editor (editable sections, paints, save/undo, download PDF, email)
- Email drafting (8 scenarios, past-email tone matching via Supabase, Resend HTTP API)
- Streaming Claude responses (SSE)
- Dynamic system prompt (loads only relevant QUOTING_LOGIC sections)
- Quote merge: Claude tweaks apply field-level changes only, preserving manual draft edits
- Undo: red toast after Claude changes quote, one-tap revert (persisted to DB)
- Auto-cleanup: empty NEW_ sessions deleted on sidebar load
- Sidebar: status dropdown (color-coded), collapsible archive section, per-session toggle state
- Mobile: Jobs toggle, scrollable sidebar, hidden draft controls, bigger delete/rename buttons
- Cache-busting headers on HTML
- 26/28 tests passing (2 pre-existing failures in server-messages.test.js)

### Active blockers
- db-backup failure: Service Account storage quota — needs backup strategy (Supabase free tier)
- Silent PDF failure: Playwright/Chromium occasionally fails with no frontend error
- Job detail is single overlay panel — needs dual-panel redesign (spec started, paused)

### Next steps
- Design + implement backup strategy (Supabase free tier — no built-in backups)
- Resume job detail dual-panel redesign (brainstorming started, context explored)
- Fix quote sidebar status toggles not staying per-quote (partial fix deployed — needs testing)

## Architecture

| Component | Location |
|-----------|----------|
| Server | `server.js` (~2000 lines) — Express, Claude API, quote rendering, email, invoice editor |
| Frontend | `public/index.html` (~90 KB) — single-page app |
| Quote template | `public/quote_template.html` (374 KB) |
| Quoting logic | `data/QUOTING_LOGIC.md` (~28 KB, force-reseeded on deploy) |
| Email logic | `data/EMAIL_LOGIC.md` (9.6 KB) |
| Scaffold engine | `lib/scaffold-engine.js` |
| DB wrapper | `db.js` (Supabase Postgres via pooler) |
| Deploy script | `scripts/deploy.sh` (run via `npm run deploy`) |

## Critical conventions

### Deploy protocol (mandatory)
**Always use `npm run deploy`**, never bare `railway up`. The deploy script hard-codes project + service IDs and aborts on mismatch.

If you must deploy manually:
```
railway link -p 2049a8ed-33ea-47bf-aee6-08056b3a16ab -s 81f7e3b4-00b5-4b49-8f74-955313738a11 -e production && railway up --detach
```

Railway target:
- Project: `osteoPeinture` (id `2049a8ed-33ea-47bf-aee6-08056b3a16ab`)
- Service: `quote-assistant` (id `81f7e3b4-00b5-4b49-8f74-955313738a11`)

### Environment variables (Railway dashboard)
ANTHROPIC_API_KEY, OPENAI_API_KEY, RESEND_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, DATABASE_URL (pooler URL), FLASK_SECRET_KEY

## Session K (2026-04-28 to 2026-04-30)

Major session — many fixes and features across the board.

**Invoice/Cost Update system:**
- Built invoice editor (edit sections, items, prices, paints before generating)
- Save/undo, download PDF, email buttons
- Fixed: title replacement, empty CONDITIONS section, paint-section overflow, payments outside sheet
- Fixed: save using PATCH not PUT, PDF download on iOS (new tab) and desktop (event.target crash)
- PDF filenames now use project ID (e.g. SANFORD_01 - Invoice.pdf)

**Quote draft protection:**
- Server-side merge: Claude's JSON output merged field-by-field with draft (fuzzy section matching)
- Only total + range fields from Claude applied; items/descriptions never replaced
- Undo button with 15s red toast, persisted to DB
- Stronger system prompt: "MANDATORY — copy current JSON, change ONLY what was asked"
- JSON stripped from chat messages (was showing raw in conversation)
- Drag-to-reorder now only from ☰ handle, not entire row

**Scaffold engine:**
- Half-level support (3.5 = 3 full + 1 half-height with 6ft braces)
- User quantity overrides via component_overrides field
- Ladder rates from EMCO catalog (was hardcoded "confirm with EMCO")
- Updated exterior paint prices from Graeme (A100, Latitude, Duration, Emerald, BM Aura)

**Mobile fixes:**
- Jobs toggle restored (sidebar-collapsed was hiding it)
- Sidebar scrollable (sidebar-quotes-mode flex fix)
- Draft editor: lock/star/checkbox/delete hidden on mobile
- Delete/rename buttons bigger (28px touch target)
- Delete uses two-tap confirm (prompt() broken in iOS PWA)

**Jobs system:**
- Photo upload directly to jobs (POST /api/jobs/:id/attachments)
- Status dropdown (Active/Upcoming/Completed/Archived)
- Inline job rename (contentEditable, not prompt())
- Sidebar: color-coded ribbons, serif font, grouped by status
- Auto-cleanup: empty NEW_ sessions deleted on sidebar load (Postgres syntax)

**Sidebar (quotes):**
- Status dropdown (color-coded: green/blue/yellow/red/dim)
- Collapsible archive section with toggle arrow
- "Accepted" status triggers convert-to-job flow
- Per-session toggle state saved to server

**Data incident:** Accidentally deleted HIRSCHL_02 session during bulk cleanup. Restored from PDF in Downloads. Time entry data lost. Led to strict "only delete empty sessions" rule + auto-cleanup.

**Crash incident:** Used SQLite datetime() syntax on Postgres, crashed the app. Fixed with try/catch wrapper.

## Related docs
- Ecosystem overview: `osteopeinture/ECOSYSTEM-OVERVIEW.md`
- Supabase migration spec: `osteopeinture/quote-assistant/docs/SUPABASE-MIGRATION-SPEC.md`
- Session history: `osteopeinture/quote-assistant/JOURNAL.md`
- Scaffold module spec: `osteopeinture/quote-assistant/docs/superpowers/specs/2026-04-10-scaffold-module-design.md`
