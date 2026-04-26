# JOURNAL — OP Hub (OstéoPeinture Quote Assistant)

Append-only session log. For current state, see CONTEXT.md.

---

## Session J — 2026-04-26: Draft editor, quote renderer fixes, email persistence

### Draft Editor (new feature)
- Editable document view in right panel — Apple Notes feel, replaces quote preview as default tab
- Panel mode system: `setPanelMode()` enum replaces scattered show/hide toggles (`placeholder | draft | pdf | gallery`)
- All quote fields editable: client info, sections, items, prices, terms, modalities
- In-memory `draftQuoteJson` state — inputs update it directly, never scrape DOM
- Debounced auto-save (800ms) to `/api/sessions/:id/adjust-quote` + immediate on blur
- Save queue with version counter to prevent stale overwrites
- Live totals recalculation (subtotal, TPS, TVQ, grand total) on every price change
- H2 total override: editable section totals with lock/unlock toggle. When locked, items become informational
- Sections without items allowed (just name + total)
- Contextual add buttons: + Group (H1), + Section (H2) per group, + Item (H3) per section
- Undo system: toast + Cmd+Z for deleted items/sections (single-level undo buffer)
- Toggle excluded/optional per section (☆/☐ buttons, visual tags + dimming)
- Drag-to-reorder: native HTML drag-and-drop for sections and items, cross-section item moves
- "Format Quote" button saves draft → switches to PDF view → refreshes preview
- Chat ↔ Draft sync: system prompt injects current quoteJson so Claude sees manual edits
- Mobile polish: 14px fonts (no iOS zoom), always-visible menus/handles, single-column modalities

### Quote Renderer Fixes
- Exact totals: removed $50 rounding on subtotal and grand total
- TPS/TVQ rounded to cent, grand total shows cents (e.g. 8 019,51 $)
- H1 group totals in header bar (not separate subtotal row)
- Pre-compute handles inherited floor (AI only sets floor on first section of each group)
- Sections with both `floor` + `title` now render correctly (was only checking `name`)
- Range labels `[X $ – Y $]` bolded inline in section names
- Optional sections with just `title` now show name + price (was missing)
- Spacer rows suppressed for sections without items
- Options header: "OPTIONS ADDITIONNELLES" (removed parenthetical), thick borders top+bottom, taller gap
- System prompt: sum tree rule (H3→H2→H1→TOTAL), floor on every section in group, no ranges in H1 names

### Email Persistence
- Client email extracted from chat (regex fallback) + quoteJson.clientEmail → session.emailRecipient → prefills email-to
- Generated email drafts saved immediately to in-memory Map + sessionStorage (survives tab switch + page reload)
- Refine also saves immediately

### Server Fixes
- `/api/sessions/:id/adjust-quote`: now skips excluded/optional sections in total, updates emailRecipient from clientEmail, returns totalAmount

---

## Session I — 2026-04-21: Streaming, markdown, attachments, cost updates

### Streaming Responses
- Claude responses now stream word-by-word via SSE over POST
- Tool use (scaffold, past quotes) falls back to non-streaming, then streams final answer
- Frontend uses fetch + ReadableStream with debounced markdown rendering (40ms)

### Markdown Rendering
- Switched from custom line parser to `marked.js` for assistant messages
- Bold, tables, code, lists, headings, hr all render properly
- Added CSS for tables, headings in assistant bubbles

### File Attachments (Supabase Storage)
- Images uploaded in chat saved to `op-hub-attachments` bucket on Supabase
- `attachments` DB table tracks metadata (session_id, job_id, public_url, etc.)
- Thumbnail strip below chat header for sessions with files
- Attachments section in job detail between Extras and Finances
- Files transfer to job on quote conversion (job_id updated)
- Supabase SDK: `@supabase/supabase-js` installed, env vars `SUPABASE_URL` + `SUPABASE_ANON_KEY` on Railway

### Client Cost Update (unified document)
- Replaces separate change orders + invoices — one document, three title variants
- POST `/api/jobs/:id/cost-update` with `docType` param: `cost-update` or `invoice`
- **Cost Update** = "PROJECT COST UPDATE": sections + totals + payments + balance. NO paint, NO modalities, NO signature, NO closing.
- **Invoice (cash)** = "PROJECT COST BREAKDOWN": adds paint section, closing, "thank you for your trust"
- **Invoice (declared)** = "INVOICE": same as cash invoice but with taxes
- Payment lines right-aligned near amounts (Kennerknecht format)

### Dynamic System Prompt
- System prompt now assembles only relevant QUOTING_LOGIC sections per message
- Keyword scanning: benchmarks, paint, coverage, materials, scaffold, JSON format
- Saves 50-85% tokens without losing context
- Full conversation history preserved (trimming reverted — destroyed context)

### Image Gallery in Quote Panel
- Gallery is a sibling overlay inside quote-frame-container (position:absolute)
- Full-size preview + horizontal thumbnail carousel (100px thumbs) pinned at bottom
- Two tab buttons in header: "Quote" / "Photos" — active one highlighted
- Auto-shows gallery when images exist but no quote yet
- Desktop: click thumbnails, arrow keys, click prev/next arrows, Escape to close
- Mobile: swipe left/right on preview, tap thumbnails
- Counter shows "3 / 13" position

### Other Fixes (Session I)
- Multi-tab independence: `startNewSession()` now updates URL with `?session=ID`
- Job ID rename: click title in job detail → prompt to rename
- Job number uses last name only (SANFORD_01 not ANTHONYSAN_01)
- Close buttons (✕) + backdrop click on all modals
- H1/H2/H3 layout shorthand in system prompt + help button (?)
- View Original Quote button in job detail
- QUOTING_LOGIC v10: STEINA Enduradeck $96.95/gal with coverage/cost details
- Message ordering fix, markdown spacing, attachment upload fix, per-session toggles, clipboard paste, 50/50 panel split, sidebar name extraction

**Latest commit:** `61e7ad1`

---

## Session H — 2026-04-19: Email sending (Resend), templates, token optimization, PDF

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
- **Conversation trimming**: only last 14 messages sent to Claude (full history in DB).
- **Interior prompt trim**: §23-34 (exterior/scaffold) stripped for interior sessions, saves ~5K tokens/request.
- **Hardcoded email templates**: zero API tokens for quote_send emails.
- API credits are on console.anthropic.com (separate from claude.ai Max plan subscription).

### PDF Formatting
- Smart format: renders Letter first, auto-switches to Legal if content barely spills to 2 pages.
- CSS page-break rules: totals block, paint section, signature+footer never split across pages.
- Small margins (20px top/bottom, 16px sides).

### Quote Renderer Fixes
- Room-based renderer now handles `optional: true` and `excluded: true` sections.
- Optional prices display as `[+X $]` format.
- Sections with `title` (no `floor`) get grey header bar like rooms.
- Loric's signature auto-embedded in every branded quote (optimized PNG, 3.5KB).

### Quoting Logic Updates (v10)
- §5: gallon rounding — round UP unless .1-.2 (round down).
- §4: door/window benchmarks are PER COAT (×2 for 2 coats). Baseboards are TOTAL (2 coats included).
- §5: STEINA Enduradeck updated: $96.95/gal, coverage rates, cost-per-sqft, no primer needed.
- Interior JSON: optional sections must use `"optional": true`, excluded from total.
- Conditions: never duplicate hardcoded footer lines, no filler conditions.

### Bug: dead addEventListener crashed the entire app
- Removing the LENGTH dropdown left `document.getElementById('email-detail-level').addEventListener(...)` pointing at null. Crashed the script → `loadSidebar()` never ran → "No quotes yet" for hours. Fixed in `96f0eda`.

**Latest commit:** `96f0eda`

---

## Session G — 2026-04-16: Payment UX, deploy safeguard

### Payment + Jobs UX (mobile-first refinements)
- Payment confirm dialog now shows project ID (LACHANCE_01) instead of client name
- Method input replaced with selectable buttons (e-transfer / cash / cheque)
- New payment modal: amount + method buttons + date + optional reference, single form
- Jobs dashboard groups by Active / Upcoming / Past with counts
- Back-from-job lands on dashboard if opened from dashboard

### Deploy safeguard (incident 2026-04-16)
- A bare `railway up` deployed OP Hub code to `text-overlay-assistant` (Fidelio project) because the Railway CLI had drifted. Build failed → no live damage.
- New `scripts/deploy.sh` (run via `npm run deploy`) hard-codes project + service IDs, verifies the link via `railway status --json`, aborts if mismatch, then runs `railway up`.
- **Always use `npm run deploy`, never bare `railway up`.**

**Commits:** `9fd4f1f`

---

## Session F — 2026-04-16: Past-email tone reference for drafts

Email drafts were AI-generic; Loric flagged them as "translated-sounding."
Now `/api/email/standalone-draft` fetches 3 real past emails matching **signer + scenario + language** and injects them as `<example>` blocks in the Claude prompt — drafts now match Loric's actual phrasing.

- `past_emails` Supabase table populated with 193 sent emails (98 EN / 92 FR / 3 unknown)
- `scripts/import-past-emails.js` — idempotent UPSERT, tags signer/scenario/language at import
- `getPastEmailExamples(signer, scenario, language, limit)` helper in server.js with 3-tier fallback
- Prompt-injection mitigation: examples wrapped in `<example>` delimiters, REFERENCE ONLY label

**Commit:** `63f1b5e`

---

## Session E — 2026-04-14: Supabase migration

**Database is now Supabase Postgres.** SQLite on Railway volume is no longer used.

- Connection: Session Pooler at `aws-1-ca-central-1.pooler.supabase.com:5432` (IPv4 compatible)
- Direct connection (`db.qvxdzoysfmgekdcvhhzu.supabase.co`) does NOT work — IPv6 only
- `db.js` wrapper handles connection pool, `?` → `$1,$2...` placeholder conversion, and transactions
- `server.sqlite.js` archived in the repo — swap back if Supabase doesn't work out
- Data migrated: 2 sessions, 1 job (LACHANCE_01), 1 payment
- Supabase free tier: automated daily backups, 7-day retention
- `/api/backup/download` returns 404 (no local SQLite file) — expected

**Commit:** `825c20e`

---

## Session D — 2026-04-10: Scaffold module

- Scaffold access quoting module — full design, spec, plan, and implementation
- `lib/scaffold-engine.js` — deterministic calculation engine with EMCO 2025 catalog
- `POST /api/scaffold/calculate` — API endpoint
- Claude tool `calculate_scaffold` — registered for exterior/scaffold sessions only
- QUOTING_LOGIC.md bumped to v3 with §30-34
- 14 new unit tests (28 total pass)

Key domain decisions: 4ft default frame width, platform formula OVH×B×2, cross brace (2B−1)×L, triangles OVH×(B+1), towers labeled A/B/C per facade, 10% rental buffer, $200 delivery.

---

## Session C — 2026-04-09: PWA icons, P&L spec correction

- PWA icons generated: `public/icon-192.png`, `icon-512.png`, `apple-touch-icon.png`. Brown house + "HUB" text.
- Parked OP Quote icons in `public/icons-op-quote/`.
- `manifest.json` and `index.html` updated for "OP Hub" branding.
- **Job → P&L row resolved as spec change, not code.** Per-Job P&L is a derived view (UNIQUE + SUMPRODUCT formulas). Jobs auto-appear on first payment sync. No code change needed.

**Commit:** `8e99825`

---

## Sessions A+B — 2026-04-09: Polish, fixes, scratchpad, smart paste, email unlock

- Resizable panel divider (already built, verified)
- Mobile floating quote icon (44x44, iOS notch safe)
- $50 subtotal/grand total rounding in `renderQuoteHTML` + `convertSessionToJob`
- Payment sync confirm step (no more fire-and-forget)
- Scratchpad field in job detail (auto-save on blur)
- Apple Notes smart paste (Claude extracts structured data, conflict detection)
- Standalone email drafting (all 8 scenarios, job-based or session-based)

---

## Session — 2026-04-08: QUOTING_LOGIC v2, Railway CLI protocol

- Wall benchmark corrected: 0.25 min/sqft
- Added §3A/3B/3C (baseboards, crown moulding, production standards)
- §4 rewritten (door/window tiers), §16 TAXES restored, §20 rewritten, §22 French door warning
- Force-reseed mechanism in server.js

**Railway CLI drift discovered:** `railway status` shows correct names but `railway up` deploys to wrong project ID. Mandatory pre-deploy protocol established (see CONTEXT.md).

---

## Session — 2026-04-04: Exterior quoting logic

- Added §23A (Exterior Assistant Guidance)
- Exterior conversation flow, pre-generation review format, JSON format with examples
- `renderQuoteHTML()`: optional/excluded section handling, estimate disclaimer block
- All 14 tests pass

---

## Pre-D-series (original build)

### What was built
- Chat-based quote generation (interior + exterior)
- PDF download via Playwright/Chromium in Docker
- Image upload (JPEG/PNG/WebP/HEIC, max 15, drag-and-drop)
- Email draft panel (scenario, signer, language, detail)
- Email send via SMTP (Gmail)
- Session list/history
- Quoting logic editor (admin)
- Bilingual EN/FR auto-detection

### Known issues at that time
1. Silent PDF failure — Playwright/Chromium fails with no clear frontend error
2. Silent SMTP failure — bad credentials fail silently in UI
3. Session persistence — SQLite on Railway volume (since migrated to Supabase)
4. Admin logic editor — edits don't write back to repo QUOTING_LOGIC.md
5. Model hardcoded to claude-sonnet-4-6 in server.js
6. No auto-deploy — Railway not connected to GitHub
