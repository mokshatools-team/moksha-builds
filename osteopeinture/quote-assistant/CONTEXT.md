# CONTEXT.md — OstéoPeinture OP Hub (fka Quote Assistant)
# Last updated: April 19, 2026
# Session: H — Email templates, Resend, PDF formatting, token optimization

---

## STATE AS OF 2026-04-19 (Session H)

### Email Sending — Resend HTTP API
- Railway blocks all outbound SMTP (ports 587 and 465). Switched to **Resend HTTP API**.
- Domain `osteopeinture.com` verified in Resend (DNS records on GoDaddy).
- API key: `RESEND_API_KEY` env var on Railway. Sends from `OstéoPeinture <info@osteopeinture.com>`.
- SMTP fallback still in code for local dev (if no RESEND_API_KEY).

### Email Templates — Hardcoded for quote_send
- 8 templates: Informal/Formal × Declared/Cash × EN/FR. No Claude API call needed.
- Other scenarios (follow-up, decline, etc.) still use Claude.
- Tone dropdown: Informal / Formal (removed Familiar).
- Payment Type dropdown added (Declared/Cash). Auto-detects from job record for jobs; manual for sessions.
- Signature: Loric gets phone (514-266-2028), others don't. All sign "Pour OstéoPeinture".

### Token Cost Optimization
- **Conversation trimming**: only last 14 messages sent to Claude (full history in DB). Current quote JSON injected as context when trimming kicks in.
- **Interior prompt trim**: §23-34 (exterior/scaffold) stripped for interior sessions, saves ~5K tokens/request.
- **Hardcoded email templates**: zero API tokens for quote_send emails.
- API credits are on console.anthropic.com (separate from claude.ai Max plan subscription).

### PDF Formatting
- Smart format: renders Letter first, auto-switches to Legal if content barely spills to 2 pages.
- CSS page-break rules: totals block, paint section, signature+footer never split across pages.
- Small margins (20px top/bottom, 16px sides).

### Quote Renderer Fixes
- Room-based renderer now handles `optional: true` and `excluded: true` sections (was only in category-based).
- Optional prices display as `[+X $]` format.
- Sections with `title` (no `floor`) get grey header bar like rooms.
- Loric's signature auto-embedded in every branded quote (optimized PNG, 3.5KB).

### Quoting Logic Updates (v10)
- §5: gallon rounding — round UP unless .1-.2 (round down). Show calc + suggestion in breakdown.
- §4: door/window benchmarks are PER COAT (×2 for 2 coats). Baseboards are TOTAL (2 coats included).
- §5: STEINA Enduradeck updated: $96.95/gal, coverage rates, cost-per-sqft, no primer needed.
- Interior JSON: optional sections must use `"optional": true`, excluded from total.
- Conditions: never duplicate hardcoded footer lines, no filler conditions.

### Other UI
- Multi-tab support: URL param `?session=XXX` — each tab opens its own session independently.
- Email form state persists per-session (switching sessions preserves email drafts).
- Jobs interface hides bottom nav (separate "app" feel).
- Email tab is full-screen on mobile (email-only mode hides quote content).
- Job sections auto-expand + collapse/expand toggle.
- Sidebar updates name during conversation (not just on quote JSON output).
- Subject: French seasons (Printemps), no city name.

### Bug: dead addEventListener crashed the entire app
- Removing the LENGTH dropdown left `document.getElementById('email-detail-level').addEventListener(...)` pointing at null. Crashed the script → `loadSidebar()` never ran → "No quotes yet" for hours. Fixed in `96f0eda`.

**Live URL:** https://op-quote-assistant.up.railway.app
**Latest commit:** `96f0eda`

---

## STATE AS OF 2026-04-16 (Session G)

### Payment + Jobs UX (mobile-first refinements)
- Payment confirm dialog now shows project ID (LACHANCE_01) instead of client name
- Method input replaced with selectable buttons (e-transfer / cash / cheque) — no more typing on mobile
- New payment modal: amount + method buttons + date + optional reference, single form
- Jobs dashboard groups by **Active / Upcoming / Past** with counts (uses `start_date` + `completion_date` + status)
- Back-from-job lands on dashboard if opened from dashboard, else returns to previous surface (`jobOpenedFrom` flag)

### Deploy safeguard (incident 2026-04-16)
- Earlier this session, a bare `railway up` deployed OP Hub code to `text-overlay-assistant` (Fidelio project) because the Railway CLI had drifted. Build failed → no live damage.
- New `scripts/deploy.sh` (run via `npm run deploy`) hard-codes project + service IDs, verifies the link via `railway status --json`, aborts if mismatch, then runs `railway up`.
- Preflight checks for railway/node CLIs; streams stdin to handle multi-chunk JSON.
- **Always use `npm run deploy`, never bare `railway up`.**

**Live URL:** https://op-quote-assistant.up.railway.app
**Commits:** `9fd4f1f`

---

## STATE AS OF 2026-04-16 (Session F)

### Session F — Past-email tone reference for drafts (2026-04-16)

Email drafts were AI-generic; Loric flagged them as "translated-sounding."
Now `/api/email/standalone-draft` fetches 3 real past emails matching
**signer + scenario + language** and injects them as `<example>` blocks
in the Claude prompt — drafts now match Loric's actual phrasing.

**What shipped:**
- `past_emails` Supabase table populated with 193 sent emails (98 EN / 92 FR / 3 unknown)
- `scripts/import-past-emails.js` — idempotent UPSERT, tags signer/scenario/language at import
- `getPastEmailExamples(signer, scenario, language, limit)` helper in server.js with 3-tier fallback
- Prompt-injection mitigation: examples wrapped in `<example>` delimiters, REFERENCE ONLY label
- Live deploy verified: FR draft "Salut X, Voici la soumission. Hésite pas si tu as des ajustements…", EN draft "Hi X, Here's the quote attached. Let me know if anything needs adjusting…"
- Commit: `63f1b5e`

**Live URL:** https://op-quote-assistant.up.railway.app

---

## SEE ALSO — canonical planning docs

The full ecosystem overview and build plan is NO LONGER in this file. It lives at:
- **`osteopeinture/docs/OSTEOP-BUILD-ECOSYSTEM-OVERVIEW.md`** — macro module map, sequencing, editable-outputs principle
- **`osteopeinture/docs/SUPABASE-MIGRATION-SPEC.md`** — Phase 0 prerequisite migration spec

Read those first for context on how this build fits into the broader OP ecosystem.

---

## STATE AS OF 2026-04-14

### Supabase Migration — COMPLETE (2026-04-14)

**Database is now Supabase Postgres.** SQLite on Railway volume is no longer used.

- Connection: Session Pooler at `aws-1-ca-central-1.pooler.supabase.com:5432` (IPv4 compatible)
- Direct connection (`db.qvxdzoysfmgekdcvhhzu.supabase.co`) does NOT work — IPv6 only, fails on Railway and local networks
- Railway env var `DATABASE_URL` must use the pooler URL — confirmed working
- `db.js` wrapper handles connection pool, `?` → `$1,$2...` placeholder conversion, and transactions
- `server.sqlite.js` archived in the repo — swap back to `server.js` and redeploy if Supabase doesn't work out
- Data migrated: 2 sessions, 1 job (LACHANCE_01), 1 payment — verified on live app
- Backup: Supabase free tier has automated daily backups, 7-day retention
- The `/api/backup/download` endpoint will return 404 (no local SQLite file) — this is expected
- Commit: `825c20e`

**Phase 0 is DONE.** This was the single prerequisite blocking everything else in the ecosystem plan. Next: Phase 1 smoke test on a real job, then Phase 2 (app split).

---

## STATE AS OF 2026-04-10

### Session D — Scaffold Module (2026-04-10)

**What was built:**
- Scaffold access quoting module — full design, spec, plan, and implementation in one session
- `lib/scaffold-engine.js` — deterministic calculation engine with EMCO 2025 catalog
- `POST /api/scaffold/calculate` — API endpoint for scaffold calculations
- Claude tool `calculate_scaffold` — registered for exterior/scaffold sessions only
- QUOTING_LOGIC.md bumped to v3 with §30-34 (scaffold terminology, formulas, EMCO catalog, ladders, labor)
- 14 new unit tests (28 total pass)

**How it works:** User discusses scaffold in an exterior quote conversation. Claude proposes tower layouts, confirms inputs, calls `calculate_scaffold` tool, backend returns deterministic component breakdown + rental costs. Claude presents results conversationally.

**Key domain decisions (agreed with Loric):**
- Default frame width: 4ft (not 5ft)
- Platform formula: OVH × B × 2
- Cross brace formula: (2B − 1) × L
- Triangles attach to frames (not bays): OVH × (B+1)
- Towers labeled A, B, C, organized by facade
- Labor: manual hours input (no benchmarks yet)
- EMCO primary, GAMMA for lifts (TBD)
- 10% buffer on rental, $200 delivery (2 trips)

**Design spec:** `docs/superpowers/specs/2026-04-10-scaffold-module-design.md`
**Implementation plan:** `docs/superpowers/plans/2026-04-10-scaffold-module.md`

---

## STATE AS OF 2026-04-08

**Live URL:** https://op-quote-assistant.up.railway.app (in-app brand: "OP Hub")
**Supabase decision:** confirmed (free tier). Migration not yet started. See `SUPABASE-MIGRATION-SPEC.md`.
**Next action:** **Phase 1 smoke test on the upcoming real job** — quote → convert to job → payment → verify Contract Revenue row in finance sheet → generate invoice → verify invoice flows. Do NOT use LACHANCE for this.

**QUOTING_LOGIC.md v2 merged and live (2026-04-08):**
- Wall benchmark corrected: 0.25 min/sqft (was stale 1.64)
- Added §3A (baseboards per lft), §3B (crown moulding), §3C (production standards)
- §4 rewritten with full door/window tier tables + mantle + staircase TBC
- §16 TAXES (QC) restored (had been silently deleted when §15A CASH was added)
- §20 rewritten as "Confirmed Benchmarks"
- §22 French door range warning restored
- Preserved from repo: §15A CASH, §23A Exterior Assistant Guidance, §25 resolved exterior primer prices
- Force-reseed mechanism added in server.js: compares `# Version:` header on seed vs volume copy and overwrites volume on version bump. Overrides admin panel edits by design.
- Verified live: all 19 post-deploy checks passed, force-reseed log line confirmed
- Deleted orphan `data/QUOTING_LOGIC.md` (gitignored, untracked)

**Railway CLI note (important for future sessions):**
The `railway` CLI drifts between Railway projects between sessions AND between invocations in the same session. Confirmed by empirical observation across the April 8-9 sessions: after an auto-drift, `railway status` will show the correct names ("osteoPeinture" / "quote-assistant") but `railway up` will deploy to a different project ID entirely.

**Mandatory pre-deploy protocol for OP Hub:**
- Always chain `railway link` and `railway up` in the SAME bash invocation
- Use: `railway link -p 2049a8ed-33ea-47bf-aee6-08056b3a16ab -s 81f7e3b4-00b5-4b49-8f74-955313738a11 -e production && railway up --detach`
- After `railway up`, verify the build log URL contains `project/2049a8ed-...` — if it doesn't, the deploy went to the wrong project and the live app is unchanged
- Always check `railway deployment list` within 90s to confirm a new SUCCESS deployment appeared

**Correct OP Hub Railway target:**
- Project: `osteoPeinture` (id `2049a8ed-33ea-47bf-aee6-08056b3a16ab`)
- Service: `quote-assistant` (id `81f7e3b4-00b5-4b49-8f74-955313738a11`)
- Environment: production

## SESSION A+B (2026-04-09) — Polish, Fixes, Scratchpad, Smart Paste, Email Unlock

**Fix 1 — OP Quote UX:**
- 1a (resizable panel divider): already built in earlier session, no change needed. Verified `#panel-divider` + mousedown/mousemove/mouseup wiring in public/index.html is functional.
- 1b (mobile floating quote icon): transformed inline header button into a fixed-position circular icon top-right (44x44 touch target, safe-area-inset aware for iOS notch, keyboard-safe by design). New `toggleQuotePanel()` + `.active` state.
- 1c ($50 subtotal/grand total rounding): `renderQuoteHTML` now computes raw subtotal, derives taxes from raw, then rounds subtotal + grand total to nearest $50 for display. `convertSessionToJob` also rounds the stored job subtotal so job cards match the PDF. Line items and JSON values untouched.
- Commit: `5f0f82e` (first attempt deployed to wrong project, re-linked and redeployed as `c7051361`).

**Fix 2 — Payment sync confirm step:**
- Record-payment no longer auto-syncs. Server saves the payment and returns a full sync preview (date, amount, method, job name, category, destination).
- New `POST /api/payments/:id/sync` endpoint performs the write when the user confirms.
- Frontend `recordPayment()` now shows a confirm dialog with the preview before calling the sync endpoint. Cancel path leaves the payment with `finance_sync_status='pending'` for later retry.
- Closes the fire-and-forget gap flagged in the ecosystem overview.
- Commit: `eceb621` + `390735be` deploy.

**Fix 3 — Scratchpad field in job detail:**
- New `scratchpad` TEXT column on jobs (ALTER IF NOT EXISTS).
- PATCH `/api/jobs/:id` whitelist extended to accept `scratchpad`.
- Job detail renders a textarea (min-height 200px, mono font, vertical resize) below payments. Auto-saves on blur via PATCH. No save button.
- Commit: `a8903ed` + `42f5e1de` deploy.

**Build 1 — Apple Notes smart paste:**
- `POST /api/jobs/:id/smart-paste` calls Claude with a strict JSON schema prompt to extract clientName, address, phone, contractTotal, paintTotal, consumablesTotal, laborCost, payments[], remainder. Returns extracted object + conflict list (fields that would overwrite existing job data).
- `POST /api/jobs/:id/smart-paste/apply` writes fields to the job, appends/replaces scratchpad with remainder, inserts each payment as a pending (unsynced) row. Respects an `overwrite` flag — when false, conflicting fields are preserved.
- Payments from smart paste are NOT auto-synced to the finance sheet — user must confirm each via the existing payment sync flow.
- Frontend: "Paste from Apple Notes" button in job detail actions → modal with textarea → parse → preview with field/payment/remainder breakdown → conflict warnings + "Apply + Overwrite" button when conflicts exist.
- Commit: `7fbd2c1` + `75e97539` deploy.

**Build 2 — Standalone email drafting (all 8 scenarios unlocked):**
- `buildEmailDraft` no longer gates on `quoteJson`. Any session with clientName or address can produce a draft. Non-quote scenarios (decline, lead_more_info, project_update, etc) don't need quoteJson.
- New `POST /api/email/standalone-draft` accepts jobId + scenario + signer + language + detailLevel; synthesizes a pseudo-session from the job record and returns subject + body via the existing buildEmailDraft pipeline.
- New `POST /api/email/standalone-refine` applies an instruction to an arbitrary draft string via Claude. Same prompt as session-based refine, no session required.
- Session email panel: scenario dropdown expanded from 3 → 8 (all EMAIL_LOGIC scenarios).
- Session email panel: "Refine with instructions…" button wires the existing `/api/sessions/:id/email/refine` endpoint.
- Job detail: new "Draft Email" action button opens a modal with all 8 scenarios, signer, length, language. Auto-generates on open from job context. Refine + Copy to clipboard.
- Standalone modal does NOT send email — copy to clipboard only. Gmail send is Module 6 / horizon.
- Commit: `14d4384` + `0e40dea5` deploy.

## SESSION C (2026-04-09) — PWA icons + Build 2 spec correction

**Build 1 — PWA icons (shipped):**
- Generator script at `scripts/generate-icons.js` using `sharp` (already in deps). Trims whitespace from the 4000×4000 `OP HOUSE.png` source, composites over a 512 `#0F0D0B` canvas, overlays SVG text, downscales to 192/180. Reproducible on any machine with the repo and the source logo.
- Active set (OP Hub): `public/icon-192.png`, `public/icon-512.png`, `public/apple-touch-icon.png`. Brown house centered, white "HUB" text underneath.
- Parked set (OP Quote, for the future app split): `public/icons-op-quote/icon-192.png`, `icon-512.png`, `apple-touch-icon.png`. Same house, white "QUOTE" text. Not referenced by the current manifest.
- `manifest.json` rewritten: `name` + `short_name` both "OP Hub", description updated, icons point to the new files, `purpose: any` set on both sizes.
- `index.html`: `<title>` updated OP Hub, `apple-mobile-web-app-title` updated to OP Hub, new `<link rel="apple-touch-icon" href="/apple-touch-icon.png">` added.
- Commit `8e99825` → deploy `3fa5e7f5` SUCCESS on correct project. Verified live: `/manifest.json` serves OP Hub metadata, `/icon-512.png` returns HTTP 200 image/png.

**Build 2 — Job created → P&L row: RESOLVED AS A SPEC CHANGE, NOT CODE.**

Probed the finance sheet before writing any sync code. Findings:
- Real tab name is `Per-Job P&L`, not `PNL by Contract`.
- `Per-Job P&L` is a **derived view**, not a write target. Column A uses a spill formula `=IFERROR(UNIQUE(FILTER(Transactions!I$2:I$2000, <>"")))` that auto-pulls job codes from Transactions. Columns B–E are SUMPRODUCT/SUMIF formulas that auto-compute Revenue, Labor (Wages), Direct Expenses, and Net from Transactions + Wages.
- There is no Start Date, Contract Total, Status, or Materials column anywhere in the tab.
- Writing to the tab would clobber formulas. Writing a $0 placeholder to Transactions would pollute the cash-basis ledger.
- **Jobs already auto-appear in Per-Job P&L on first payment sync** (D-7 commit `ed9f1b2` already writes a Transactions row with the job code in column I).

**Loric confirmed Option A: do nothing.** The ecosystem doc's "Job created → PNL row" bullet was based on a mental model that didn't match the sheet architecture. The bullet was removed from `OSTEOP-BUILD-ECOSYSTEM-OVERVIEW.md` and the Phase 1 sequencing was updated. No code change to OP Hub.

If metadata-in-sheet is ever needed later, the right answer is a new `Active Jobs` tab (separate from Per-Job P&L) written to on job create with a confirm step. Flagged in the ecosystem doc for future reference.

**Still deferred to later sessions:**
- Supabase migration (Phase 0 prerequisite — see SUPABASE-MIGRATION-SPEC.md)
- Phase 1 smoke test on upcoming real job (quote → job → payment → invoice → verify finance sheet flow)
- Jibble smoke test on real CSV
- Remaining finance sheet hooks (job created → PNL, invoice sent → Receivable, invoice paid → close Receivable + Revenue)
- OP Quote and OP Hub app split into two URLs/services
- QUOTING_LOGIC v2 force-reseed is live; admin UI edits still clobbered by deploy version bumps (by design)
- Backup mechanism still relies on manual `/api/backup/download` until Supabase migration lands

## WHAT'S BUILT (D-1 to D-7 + today)
- OP Quote chat + PDF + email (quote_send, quote_revision only)
- Job management: convert quote → job, Jobs list + detail, delete job
- Jibble CSV import + activity mapping (never smoke-tested on real data)
- Change orders
- Client update generator (bilingual HTML + PDF)
- Editable invoice draft (combines quote + change orders + time entries)
- Payment recording → Contract Revenue sync to finance sheet (fire-and-forget gap)
- DB backup download endpoint (workaround for service-account Drive writes)
- Desktop collapsible sidebar + mobile send-button relocation (today)
- Recompute-on-convert fix for the $0 quote total bug (today)

---

## ORIGINAL CONTEXT (pre-D-series, kept for reference)

# OstéoPeinture Quote Assistant
# Session: OP exterior quoting logic

---

## PROJECT LOCATION
- Repo: osteopeinture/quote-assistant/
- Live: https://op-quote-assistant.up.railway.app
- Deploy: manual — railway up (not connected to GitHub auto-deploy)

---

## WHAT'S BUILT AND WORKING
- Chat-based quote generation (interior + exterior)
- PDF download via Playwright/Chromium in Docker
- Image upload (JPEG/PNG/WebP/HEIC, max 15, drag-and-drop)
- Email draft panel (scenario, signer, language, detail)
- Email send via SMTP (Gmail)
- Session list/history (SQLite)
- Quoting logic editor (admin — edits volume only, not back to repo)
- Bilingual EN/FR auto-detection

Key server.js functions:
buildSystemPrompt(), handleSessionMessage(), renderQuoteHTML(),
buildEmailDraft(), buildScenarioBody(), normalizeImages(), extractJsonString()

---

## IN PROGRESS / PARTIALLY BUILT
- Email scenarios: 8 defined in EMAIL_LOGIC.md but only quote_send and
  quote_revision exposed in UI. Rest coded in buildScenarioBody() but
  not selectable.
- Email refinement: POST /api/sessions/:id/email/refine exists in server.js
  but not wired to frontend.
- Test coverage: partial — no full end-to-end server flow tests.

---

## QUEUED UI CHANGES (from April 3 session)
1. Resizable panel divider between chat and quote panels (drag left/right)
2. Mobile floating quote icon (top right) — tap to expand full screen,
   tap again to collapse. Keyboard-safe.
3. Final totals rounding: floor subtotals and grand total round to nearest
   $50. Line items do not round.

---

## QUEUED LOGIC CHANGES (from April 3 session)
- Load updated QUOTING_LOGIC.md (v2) into server — wall benchmark corrected
  to 0.25 min/sqft, new sections 3A/3B/3C added (baseboards, crown moulding,
  production standards), door/window tiers updated, Section 20 rewritten.

---

## WHAT WAS DONE (2026-04-04) — Exterior Quoting Logic

### QUOTING_LOGIC.md
- Added §23A (Exterior Assistant Guidance) between §23 and §24
- Contents: conversation flow, standard task sequences (paint, stain, deck,
  metal), gap checklist, pre-generation review format, output rules,
  §27 sanity check instructions

### server.js — buildSystemPrompt()
- Added Phase 2C (exterior quote conversation flow) — zone-based gathering,
  estimator-provided hours, no calculated benchmarks
- Added exterior pre-generation review format (scope → hours → materials →
  access → totals with sanity check and disclaimer)
- Added full exterior JSON format with example (title-based sections,
  excluded repairs, optional add-ons, estimateDisclaimer field)
- Added exterior-specific rules to IMPORTANT section (no benchmark
  calculation, always include disclaimer and repairs, $50 rounding)

### server.js — renderQuoteHTML()
- Subtotal calculation now skips sections with excluded: true or optional: true
- Category-based path now renders:
  - "OPTIONAL ADD-ONS (not included in total)" divider before optional sections
  - "(excluded from total)" label on excluded sections (repairs)
  - Repairs show range but no price in the price column
  - Spacer logic adapted for excluded/optional boundaries
- Added estimateDisclaimer block (styled, appears before legal block)

### Tests
- All 14 existing tests pass
- Source-level verification: subtotal exclusion, disclaimer, optional
  divider, excluded label, exterior JSON format all confirmed present

---

## KNOWN ISSUES
1. Silent PDF failure — Playwright/Chromium fails with no clear frontend error
2. Silent SMTP failure — bad credentials fail silently in UI
3. Session persistence — SQLite on Railway volume; history lost if volume wiped
4. Admin logic editor — edits don't write back to repo QUOTING_LOGIC.md
5. Model hardcoded to claude-sonnet-4-6 in server.js
6. No auto-deploy — Railway not connected to GitHub

---

## TBCs / NOT YET BUILT
- ~~Exterior primer prices~~ — resolved April 4: Seal Grip $69, Kem Bond $95.45, ProCryl $95.45, Ext Oil-Based Wood $77.05 (all incl. 15% margin)
- Staircase benchmarks (spindles, risers, stringers) — TBC
- Standalone email drafting (currently requires a quote to exist)
- Lead intake automation (described in EMAIL_LOGIC.md, nothing built)
- Finance system (create-sheet.gs) — fully written, never run or tested

---

## NEXT STEPS
- [x] Deploy to Railway — live, 200 OK, QUOTING_LOGIC.md pushed to volume (April 4)
- [x] Fill TBC exterior primer prices (Seal Grip, Kem Bond, ProCryl, Ext Oil-Based Wood)
- [ ] Test PDF generation with an exterior quote (disclaimer, excluded repairs, optional add-ons render correctly)
- [ ] Load QUOTING_LOGIC.md v2 interior changes (still queued from April 3)

---

## FILE SIZES FOR REFERENCE
- server.js: ~1700 lines (updated April 4)
- index.html: 70 KB
- quote_template.html: 374 KB
- QUOTING_LOGIC.md: ~28 KB (§23A added April 4)
- EMAIL_LOGIC.md: 9.6 KB
- CONTEXT.md: this file
