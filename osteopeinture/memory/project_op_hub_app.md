---
name: OP Hub — Job Management App (in quote-assistant)
description: Quote-assistant rebranded as OP Hub. Now handles full job lifecycle: quotes, jobs, time tracking, change orders, invoices, payments
type: project
---

**Live:** https://op-quote-assistant.up.railway.app
**Repo:** osteopeinture/quote-assistant/
**Stack:** Node.js + Express + better-sqlite3 + Playwright + Anthropic SDK
**Hosted:** Railway with persistent volume at /data

**Built (D-1 to D-7, 2026-04-05/06):**
- Quote chat (existing) → Convert to Job button
- Jobs tab (mobile + desktop sidebar button)
- Job detail: stats, payments, time entries, action buttons
- Jibble CSV import → activity mapping per job → retro-applies
- Client update generator (bilingual HTML + PDF)
- Change orders (mini-quotes with approval, feed into invoice)
- Invoice generator (editable draft combining quote + change orders + time entries)
- Payment recording → syncs Contract Revenue to finance Google Sheet

**Session A+B additions (2026-04-09):**
- Mobile floating quote icon (top-right, 44px, safe-area-aware, keyboard-safe toggle)
- $50 rounding on rendered subtotal + grand total (taxes from raw, JSON untouched, convertSessionToJob stored totals also rounded)
- **Payment sync confirm step — closes the fire-and-forget gap.** Record-payment no longer auto-writes to the sheet; client sees a preview and must POST to `/api/payments/:id/sync` to trigger the write. Cancel leaves `finance_sync_status='pending'` for retry.
- Scratchpad field on jobs (new SQLite column, 200px textarea in job detail, auto-saves on blur via PATCH)
- Apple Notes smart paste (`POST /api/jobs/:id/smart-paste` → preview, `POST /api/jobs/:id/smart-paste/apply` → write). Two-step UX with conflict detection. Extracts client info, phone, address, contract total, paint/consumables/labor totals, payments[], and drops everything else into the scratchpad as remainder. Payments from smart paste are inserted as pending — NOT auto-synced to the finance sheet.
- Standalone email drafting unlocked: all 8 EMAIL_LOGIC scenarios reachable from both the session email panel (dropdown expanded 3→8) and from a new "Draft Email" button in job detail (opens a modal with scenario/signer/length/language, auto-generates from job context, refine + copy to clipboard). New routes: `POST /api/email/standalone-draft`, `POST /api/email/standalone-refine`. `buildEmailDraft` no longer requires quoteJson.
- Delete job endpoint (transactional — removes all dependent rows and unlinks the session)
- Recompute-on-convert root fix (convertSessionToJob now recomputes subtotal from quoteJson.sections instead of trusting cached totalAmount)
- Desktop collapsible sidebar (chevron toggle, persisted in localStorage)
- QUOTING_LOGIC.md v2 merged + force-reseed on version bump (see `feedback_quoting_logic_version_bump.md`)

**Spec files:**
- `docs/OP-FINANCE-MASTER-PLAN.md` (v3) — overall roadmap
- `docs/OP-JOB-MANAGEMENT-SPEC.md` — Job Management 8-session plan
- `docs/OP-FINANCE-CHAT-SPEC.md` — chat interface spec (deferred)
- `docs/SESSION-PROMPT-DATA-LAYER.md` — data layer discussion prompt

**Key design decisions:**
- Sheets-direct (no Postgres yet) — Codex recommended Postgres but deferred
- Cash-basis accounting for sheet sync
- Activity mapping is per-job, not standardized
- Materials bundled into invoice line items, not separate
- Owners bill at $55/hr to client, no internal wages
- Subcontractors (Edler/Yann/Fred) have internal rates ($20-25)
- Workers don't change Jibble workflow — Loric does post-import adjustments
- "Suggestion you can edit" UX — drafts always editable before sending

**Apple Notes integration:** Loric exports as Markdown when needed, copy/pastes into the app. Apple Notes stays the on-site scratchpad, app handles structured data.

**PWA:** Already configured (apple-mobile-web-app-capable). Toggle "Open as a web app" when adding to home screen.

**Brand:** "OP Hub" (was "Quote Assistant"). The full URL pattern `op-quote-assistant.up.railway.app` is locked but the in-app brand is updated.

**Next session:** Smoke-test the new builds on real data before any new feature work. In order:
1. Smart paste with a real Apple Note on a test job (extraction accuracy, conflict handling, scratchpad append)
2. All 8 standalone email scenarios from the Draft Email modal (verify each body + subject, test refine)
3. Mobile Safari smoke test (floating quote icon, scratchpad textarea, smart paste modal, draft email modal)
4. Payment sync confirm flow end-to-end (record → preview → confirm → verify finance sheet row)
Then pick one of: Supabase migration (Phase 0) OR end-to-end flow on the upcoming real job (Phase 1 — quote → job → payment → invoice → verify sheet).
