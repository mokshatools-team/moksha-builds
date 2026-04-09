# OstéoPeinture — Full Build Ecosystem
# Macro Overview & Module Map
# Last updated: April 8, 2026
# Canonical location: osteopeinture/docs/OSTEOP-BUILD-ECOSYSTEM-OVERVIEW.md

---

## THE BIG PICTURE

Everything below is one interconnected system. The quote is the entry point. It flows into a job. The job generates labor, materials, change orders, and invoices. All of it feeds the finance system. Email and lead intake sit upstream, feeding new quotes. The database is the shared backbone everything reads and writes from.

---

## INFRASTRUCTURE LAYER (prerequisite to everything)

**Database: SQLite → Supabase (free tier)**
- Current SQLite on Railway volume is fragile — already lost data once on deploy
- Decision confirmed: migrate to Supabase free tier (see `SUPABASE-MIGRATION-SPEC.md`)
- All modules below read/write from the same single Postgres database
- Supabase also solves the backup gap: hosted Postgres includes automated backups
- Status: decision confirmed, migration not yet started

**Two Apps, Two URLs, Two PWA Icons**
- OP Quote → quote generation tool
- OP Hub → operations and job management tool
- Both save to iPhone home screen with distinct icons
- Currently one app, one URL — split is a Phase 2 task, blocked on DB migration
- Both apps share the same Supabase database

---

## MODULE 1: OP QUOTE
*The quote generator. Entry point for all new work.*

**What it does:**
- Chat interface with Claude — you describe the job, it builds the quote
- Applies QUOTING_LOGIC.md (the painting wiki) as its brain
- Renders a live quote preview panel
- Generates branded PDF quote
- Drafts and sends email to client (quote_send + quote_revision scenarios)
- Stores past quotes, all retrievable from sidebar
- Admin panel to edit quoting rules directly

**Key output:** Signed quote → triggers "Convert to Job" → creates job record in OP Hub

**Status:** Live at `op-quote-assistant.up.railway.app`. Core flow working. Queued fixes: resizable panel divider, mobile floating quote icon, final total rounding to nearest $50, QUOTING_LOGIC.md v2 needs to be loaded into server.

**The Painting Wiki (QUOTING_LOGIC.md)**
- This IS the synthesized intelligence layer for quoting
- Contains: wall/ceiling/baseboard benchmarks, labor rates, coat standards, door/window tiers, dark paint multipliers, production standards
- Claude reads it every session as system context
- Maintained and updated by Claude Code as field data improves
- v2 written, not yet loaded into server

---

## MODULE 2: OP HUB
*The operations dashboard. Replaces Apple Notes for job management.*

**What it does:**
- Active jobs dashboard — all current jobs at a glance
- Per-job record:
  - Client info (name, address, phone)
  - Contract total + scope summary
  - Payment log (date, amount, method: cash / e-transfer / cheque)
  - Materials cost (paint + consumables totals)
  - Change orders
  - Invoices (generated PDFs)
  - Balance owing (auto-calculated)
  - **Scratchpad** — free text, no rules, replaces Apple Notes per job (door codes, to-do lists, room dimensions, brain dumps)
- Smart paste: paste Apple Note into job chat → Claude populates all structured fields, rest goes to scratchpad
- Context-aware chat: Claude knows which job you're in, never interprets messages as new quote requests

**Who uses it:** Loric, Graeme, Lubo — daily operations

**Status:** Jobs view exists inside current single app (lives alongside OP Quote today). Full OP Hub as standalone app not yet built. Scratchpad field not yet built. Smart paste not yet built. Built so far: convert-quote-to-job, Jobs list + detail, Jibble CSV import, activity mapping, change orders, client updates, invoice drafts, payment recording, delete job.

---

## MODULE 3: INVOICE GENERATOR
*Sits between OP Quote and OP Hub. Converts quotes into final invoices.*

**What it does:**
- Takes an approved quote (from OP Quote) as base
- Adds: change orders, adjustments, overages, items not done
- Lists all payments received to date with dates and methods
- Calculates remaining balance
- Generates branded invoice PDF (bilingual EN/FR per client)
- Matches existing invoice template format (KENNERKNECHT style already established)
- Marks invoice as sent → creates Receivable in finance sheet (NOT YET WIRED)
- Marks invoice as paid → closes Receivable, records Revenue (NOT YET WIRED)

**Key difference from quote:** No declared portion, no signature block. Adds payment history and balance.

**Status (CORRECTED — NOT "not yet built"):**
- ✅ Editable draft invoice generator shipped April 6 (commit `d2c1fce`, D-5)
- ✅ Change orders integration shipped same day (commit `2ac273c`, D-6)
- ✅ Combines quote + change orders + time entries into an editable draft
- ❌ What's missing: real-data testing, "invoice sent → Receivable" and "invoice paid → close Receivable + Revenue" finance sheet hooks
- **Correct status: partially built, never tested on a real job**

---

## MODULE 4: FINANCE SYSTEM INTEGRATION
*The Google Sheets backbone. Receives data from OP Quote and OP Hub automatically.*

**What flows in automatically:**

| Event | Finance Sheet action | Status |
|---|---|---|
| Job created in OP Hub | Add row to PNL by Contract | ❌ not wired |
| Materials total logged | Update materials cost in PNL by Contract | ❌ not wired |
| Invoice sent | Add row to Receivables | ❌ not wired |
| Invoice paid | Close Receivable + add Revenue row | ❌ not wired |
| Payment recorded | Write Contract Revenue row | ✅ **live** (commit `ed9f1b2`, D-7) |
| Jibble CSV imported | Populate Wages tab with labor hours per job | ❌ not wired |

**Payment sync — the gap to fix:**
- When a payment is recorded in OP Hub, the server auto-writes a Contract Revenue row to the finance sheet via service account
- Background, non-blocking, with status tracking (pending → synced/failed/skipped)
- **Gap: fire-and-forget. No confirm step before write.** This contradicts the "editable outputs" principle below and must be retrofitted in Phase 1.

**Duplicate payment handling:**
- E-transfers appear in both hub (manually logged) and bank CSV import
- Cash payments only exist in hub — no duplication risk
- Strategy: hub sends ALL payments to finance sheet, finance sheet flags potential duplicates when bank CSV matches an existing hub payment (same date + amount)
- Filter at sheet level, not hub level

**Conversational finance interface (OP Finance Chat):**
- Chat-based transaction entry — type "Paid Lubo $800 cash for Murray Hill"
- Claude parses, shows preview for confirmation, then writes to sheet
- Validation step before every write — non-negotiable
- Mobile Safari compatible
- Status: spec written (docs/OP-FINANCE-CHAT-SPEC.md), not yet built. Prerequisite: bank CSVs imported and real data verified in sheet first.

**Finance sheet current state:**
- Double-entry single-ledger architecture
- Tabs: Transactions, Import, Wages, Categories, Accounts + reporting
- CSV import pipeline with duplicate detection
- Opening balances entered but known wrong — backtrack pending
- RBC and BMO MC CSV imports queued
- 155 transactions, all reports working

**Correct status: payment sync live (with fire-and-forget gap to fix), all other hooks not wired**

---

## MODULE 5: JIBBLE INTEGRATION
*Time tracking → labor costs → wages*

**Current flow:**
- Team logs hours in Jibble by job and activity type
- Loric exports CSV manually
- Imports into OP Hub via "Import Jibble CSV" button
- Activity mapping: Jibble activity labels → client-facing labor categories
- Time entries feed labor cost calculations per job and feed invoice drafts

**Target flow (automated):**
- n8n polls Jibble API daily/weekly
- Pulls completed shifts for Edler, Yan, and others
- Matches to job they logged against
- Calculates gross pay
- Writes row to Wages tab in finance sheet automatically
- Loric reviews and approves — no manual typing

**Status:** Manual CSV import + activity mapping working in OP Hub (D-3 commit `00b9744`). Never smoke-tested on a real Jibble export against a real job. Automated n8n → Wages pipeline scoped but not built.

---

## MODULE 6: EMAIL AUTOMATION
*(Horizon build — not immediate priority)*

**What it does:**
- Gmail-connected LLM agent
- Reads incoming emails, understands context from EMAIL_LOGIC.md + past sent email patterns
- Drafts responses automatically:
  - Low-risk (follow-ups, info requests) → sends itself
  - Higher-risk (quotes, declines) → queues as Gmail draft for review
- 8 email scenarios defined in EMAIL_LOGIC.md: quote_send, quote_revision, quote_follow_up, quote_promise, decline, lead_more_info, lead_follow_up, project_update

**Memory layer needed:**
- EMAIL_LOGIC.md as behavior brain (exists)
- Scraped archive of past sent emails as tone/pattern layer (not yet built — April 1 spec exists but not executed)
- No database needed — pure markdown knowledge layer fed to LLM

**Current build state:**
- EMAIL_LOGIC.md written (April 1, 2026)
- All 8 scenarios have server-side code in server.js
- UI only exposes quote_send + quote_revision (Tool Boundary decision)
- No Gmail connection, no inbox webhook, no standalone email drafting
- Thread/body scrape not built

**Status:** Logic layer exists, no runtime surface beyond quote emails. Deferred.

---

## MODULE 7: LEAD INTAKE + CRM
*(Long-term build — separate build, not immediate priority)*

**What it does:**
- Captures incoming leads from any source (email forward, form, referral)
- Lead queue with filtering and rating (area served, job type, urgency, quality)
- Lead → Quote promotion path (qualified lead becomes a quote session in OP Quote)
- Eventually: full CRM with lead history, follow-up tracking

**Database requirement:**
- Needs a leads table in the shared Supabase Postgres database
- Confirms Supabase decision — same DB, one more table

**Status:** Design idea only. Zero code. Deferred until email automation and core hub are stable.

---

## CROSS-MODULE DESIGN PRINCIPLE: EDITABLE OUTPUTS

**Every automated output must be editable before it goes out.** This is a contract across all modules, not a module-by-module choice.

| Output | Auto-generated by | Edit point before send/save |
|---|---|---|
| Quote | M1 chat → JSON | Quote panel preview + JSON edits |
| Quote email | M1 draft | Email panel body + subject |
| Change order | M2 | Editable draft screen |
| Client update | M2 + Jibble | Editable HTML before PDF render |
| Invoice | M3 | Editable draft (✅ shipped) |
| Payment → finance row | M2 → M4 | Confirm step before write (currently fire-and-forget — gap) |
| Wages row | M5 → M4 | Approval queue (not built yet) |
| Email reply drafts | M6 | Gmail drafts folder (not sent) |

Two gaps today:
1. **Payment sync fires without a confirm step** (Module 4) — must be retrofitted.
2. **Wages sync doesn't exist yet** (Module 5) — must be built with a review queue, not direct writes.

When we wire the remaining finance hooks, they need a preview-then-write pattern, never direct writes.

---

## BUILD SEQUENCING

### Phase 0 — Unblock everything (prerequisite)
1. **Supabase migration** (SQLite → Postgres) — decided, not started. See `SUPABASE-MIGRATION-SPEC.md`.
2. **Fix OP Hub backup** — resolved by Supabase migration (Supabase free tier has automated daily backups).
3. **Load QUOTING_LOGIC.md v2** into M1 server.

### Phase 1 — Test what exists before building more
4. **End-to-end smoke test on the upcoming real job** (next contract, not LACHANCE): quote → convert to job → payment → verify Contract Revenue row in finance sheet → generate invoice → verify invoice flows.
5. **Jibble smoke test** with a real CSV on a real job.
6. **Fix finance hooks surfaced by smoke test:** wire job created → PNL row, invoice sent → Receivable, invoice paid → close Receivable + Revenue. Add confirm-before-write on all of them. Fix payment sync fire-and-forget gap.

### Phase 2 — UI separation + polish
7. **Split into OP Quote and OP Hub** — two URLs, two Railway services, two PWA icons, shared Supabase DB.
8. **OP Hub scratchpad field + Apple Notes smart-paste.**
9. **Queued OP Quote UX:** resizable divider, mobile floating icon, $50 rounding.

### Phase 3 — Automation
10. **Bank CSV imports** into finance sheet (RBC + BMO MC), validate opening balances.
11. **Jibble → Wages pipeline** (n8n or direct API).
12. **Finance chat interface** — only after sheet has real verified data.

### Phase 4 — Horizon
13. **Standalone email drafting** (unlock 6 of 8 scenarios without requiring a quote session).
14. **Gmail thread scrape + EMAIL_LOGIC.md refinement** from real data.
15. **Email automation** with Gmail drafts folder as output.
16. **Lead intake form + CRM** (separate build, own URL).

---

## HOW THE MODULES CONNECT

```
LEAD (email / form)
    ↓
OP QUOTE (chat → PDF quote → email to client)
    ↓ [Convert to Job]
OP HUB (job tracking → change orders → payments → scratchpad)
    ↓
INVOICE GENERATOR (quote + adjustments + payment history → PDF invoice)
    ↓
FINANCE SHEET (PNL by Contract / Receivables / Revenue / Wages)
    ↑
JIBBLE (time tracking → labor hours → wages)
```

---

## WHAT DOES NOT BELONG IN THIS SYSTEM

- Past job Apple Notes archive — stay in Apple Notes, migrate manually only if needed
- Quote records markdown archive (OP3) — scoped separately, not blocking anything above
- FIDELIO content pipeline — separate build entirely
- MOK1 internal hub — separate build entirely
