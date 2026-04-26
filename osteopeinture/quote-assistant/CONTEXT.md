# CONTEXT — OP Hub (OstéoPeinture Quote Assistant)

Chat-based quoting tool for OstéoPeinture. Generates interior and exterior painting quotes via Claude conversation, renders branded PDFs, manages jobs, payments, and email drafts.

## Status

**Live URL:** https://op-quote-assistant.up.railway.app
**Last deploy:** 2026-04-26 (Session J)
**Database:** Supabase Postgres (migrated from SQLite, Session E)

### What works
- Interior + exterior quote generation via Claude chat
- Draft editor (editable quote fields, drag-to-reorder, live totals)
- PDF rendering (Letter/Legal auto-switch, branded with signature)
- Scaffold access quoting (EMCO 2025 catalog, deterministic engine)
- Image gallery (upload, Supabase storage, per-session)
- Job management (convert quote → job, payments, scratchpad, smart paste)
- Email drafting (8 scenarios, past-email tone matching via Supabase, Resend HTTP API)
- Streaming Claude responses (SSE)
- Dynamic system prompt (loads only relevant QUOTING_LOGIC sections)
- 28 unit tests passing

### Active blockers
- db-backup failure: Service Account storage quota — needs shared drive or OAuth delegation
- Silent PDF failure: Playwright/Chromium occasionally fails with no frontend error

### Next step
- Test Draft editor end-to-end on iPhone PWA

## Architecture

| Component | Location |
|-----------|----------|
| Server | `server.js` (~1700 lines) — Express, Claude API, quote rendering, email |
| Frontend | `public/index.html` (~70 KB) — single-page app |
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

## Related docs
- Ecosystem overview: `osteopeinture/docs/OSTEOP-BUILD-ECOSYSTEM-OVERVIEW.md`
- Supabase migration spec: `osteopeinture/docs/SUPABASE-MIGRATION-SPEC.md`
- Session history: `osteopeinture/quote-assistant/JOURNAL.md`
