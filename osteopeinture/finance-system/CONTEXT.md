# OstéoPeinture Finance System — CONTEXT

> Single source of truth for all finance system sessions. Everything needed to run a session is in this file. Do not look elsewhere.

---

## What This Is

A double-entry ledger in Google Sheets for OstéoPeinture, a Quebec general partnership (société en nom collectif) with four partners: Loric, Graeme, Lubo, and BOSS. This is the primary income source for the MOKSHA collective.

Replaces a legacy Tiller-based sheet that had a confirmed **$316M formula bug** in the 2025 sales tax data. Dec 31, 2024 closing balances are confirmed clean and serve as the 2026 opening balances.

Loric is not a developer — plain language always.

---

## Google Sheet URLs

| Sheet | URL |
|-------|-----|
| **2026 Live Sheet** | `https://docs.google.com/spreadsheets/d/1de_L-9HyVC4tWBGwYTXh8HuldMUjgkW96x5xvLmpmn4/edit` |
| **Apps Script project** | `https://script.google.com/d/1oLbbv-tza-AaB3paR2dnNC1kZUgI4N5M0K1owvXQdHeGxaQ0CT5TKK7E/edit` |
| **2025 Tiller Sheet (read-only)** | `https://docs.google.com/spreadsheets/d/1O2t1MwUHwhafLRVrlpmOo46EIImfLoD-11aCaEyHijk/edit` |

**Warning:** Two versions of "OstéoPeinture — Finance 2026.gsheet" exist on Google Drive. The correct one needs to be identified by matching the spreadsheet ID above.

---

## Key Files in This Repo

| File | Description |
|------|-------------|
| `create-sheet.gs` | Apps Script that builds all 12 tabs with headers, dropdowns, formulas, and formatting. Also contains `addBossOwner()` fixup function. Built in a Codex session — **never tested or run from this repo.** |
| `CONTEXT.md` | This file. |

### Additional Files in Original Folder (not yet copied to repo)

Located at `/Users/loric/MOKSHA/OstéoPeinture/finance-system-2026/`:

| File | Description |
|------|-------------|
| `import-csv.gs` | Bank CSV importer + Drive folder watcher + Push to Transactions |
| `cash-entry-sidebar.gs` | Mobile cash entry sidebar server-side |
| `sidebar.html` | Mobile cash entry form |
| `SETUP.md` | Plain-language setup instructions |
| `.clasp.json` | Links to Apps Script project above |

Deploy with: `cd` to that folder, `clasp push`

---

## Business Context

OstéoPeinture is a Quebec residential/commercial painting company.

### How Money Flows In
- Client payments: cash or e-transfer (rarely cheque)
- Revenue is per contract — tracked by job code (e.g. ARCO_01, SMITH_02)
- Invoiced per job, P&L tracked per contract

### How Owners Are Paid
- Biweekly advances: ~$2,000–2,500 per owner on 15th and last day of month
- These are **advances against earnings**, not confirmed dividends
- End of month/quarter: calculate actual net income, compare to advances paid, reconcile
- Owner accounts track running balance of advances vs. earned entitlement

### How Workers Are Paid
- Workers log time in **Jibble** (time tracking app)
- Loric manually pulls Jibble timesheets, enters hours + wage into Wages sheet per job per worker
- Workers paid cash or e-transfer — treated as subcontractors
- Wages deducted from job revenue to get net income before owner split

### Bank Accounts
- **RBC** — primary business/personal (most transactions)
- **BMO MC** — business credit card (supplies, gas, etc.)
- **CIBC** — business account (manual feed only, no reliable automated connection)
- **Cash** — physical cash on hand

---

## Architecture

### Core Principle
> Every movement of value between two accounts = two rows in the Transactions sheet.

Double-entry ledger. One row per side of every transaction. Tiller (old system) auto-imported one side; the mirror was added manually. New system works the same way regardless of ingestion method.

### Transactions Sheet Columns

| Column | Description |
|--------|-------------|
| Date | Transaction date (yyyy-mm-dd) |
| Description | What happened |
| Account | Which account this row belongs to |
| Counterpart | The other side of this transaction |
| Amount | Signed — positive = inflow, negative = outflow |
| Category | P&L category OR "Transfer" |
| Transfer Type | Label for internal movements (only when Category = Transfer) |
| Month | Auto-derived: =TEXT(Date,"YYYY-MM") |
| Job | Optional job code (manually entered when known) |
| Source | How entered: "Bank Import", "Manual", "Wages" |

### Account List
```
Cash/Banking:   RBC, BMO MC, CIBC, Cash
Owners:         Owner: Loric, Owner: Graeme, Owner: Lubo, Owner: BOSS
Loans:          Loan: Alex
Receivables:    Receivable: Client, Receivable: OP
Assets:         Asset: Gear
```

### Owner Balance Logic
- **Negative balance** = company owes that owner
- **Positive balance** = owner owes the company
- Biweekly advances reduce owner balances (company pays out)
- End-of-period profit allocation increases owner entitlement

---

## Category System

Categories split into P&L categories (appear in income statement) and Transfer (excluded from P&L entirely).

### Full Category Hierarchy (Super Group > Group > Category)

**Revenue > Revenue**
- Contract Revenue
- Contract Deposits

**COGS > Direct Costs**
- Supplies (Paint & Consumables)
- Labor Wages
- Equipment Rentals

**Expenses > Vehicle**
- Van - Gas
- Van - Entretien
- Van - Nettoyage
- Van - General
- Van - Plate, insurances and licenses

**Expenses > Transportation**
- Gas & Transportation - Casual rental
- Gas & Transportation - Communauto

**Expenses > Equipment**
- Equipment Purchase
- Equipment Purchase (200$+)
- Depreciation

**Expenses > Sales & Marketing**
- S&M — Ads
- S&M — Website
- S&M — Clothing
- S&M — Promotional Material
- Sales & Marketing

**Expenses > Legal & Admin**
- Legal Fees
- Legal Fees - REQ
- Legal Fees - Insurances
- Legal Fees - Licences, Permits
- Accounting & Bank Charges
- Office Supplies
- Trainings
- Storage Rental

**Expenses > Other**
- Tax
- Losses & Other
- Interest charges on Loan
- Dividends

**Transfer > Transfer > Transfer** (excluded from P&L)

### Transfer Type Labels (used when Category = Transfer)
- Opening Balance
- Credit Card Payment
- Loan Received / Loan Repayment
- Owner Advance / Owner Draw / Owner Payment / Owner Reimbursement
- Asset Purchase
- Client Payment / Vendor Payment
- Third Party Transfer

### ITC-Eligible Categories (can claim GST/QST input tax credits)
Supplies (Paint & Consumables), Equipment Rentals, Equipment Purchase, Equipment Purchase (200$+), Gas & Transportation - Casual rental, Gas & Transportation - Communauto, Van - Gas, Van - Entretien, Van - General, Van - Nettoyage, Van - Plate insurances and licenses, S&M — Ads, S&M — Website, S&M — Clothing, S&M — Promotional Material, Sales & Marketing, Accounting & Bank Charges, Office Supplies, Storage Rental, Legal Fees, Legal Fees - Insurances, Legal Fees - Licences Permits, Legal Fees - REQ

---

## Standard Transaction Patterns

| Pattern | Account | Amount | Notes |
|---------|---------|--------|-------|
| Credit card payment | RBC | -500 | Mirror: BMO MC +500 |
| Client pays by e-transfer | RBC | +10,000 | Mirror: Receivable: Client -10,000 |
| Owner biweekly advance | RBC | -2,000 | Mirror: Owner: Loric -2,000 |
| Worker paid cash | RBC | -800 | Category: Labor Wages |
| Owner personal charge on biz CC | BMO MC | -100 | Mirror: Owner: Graeme +100 |
| Cash revenue received | Cash | +X | Category: Contract Revenue |
| End-of-period profit allocation | (manual journal entry) | | Splits net income to owner accounts |

---

## 12 Tabs Built by create-sheet.gs

1. **Transactions** — single source of truth. All financial events. Dropdowns on Account, Counterpart, Category, Transfer Type, Source. Amount formatted as `#,##0.00;(#,##0.00)`. Alternate row shading. 2000-row capacity.
2. **Wages** — worker time and pay per job. Columns: Date, Worker, Job, Hours, Rate, Total (formula: Hours x Rate), Payment Method (Cash/E-transfer), Paid, Balance Owed (formula: Total - Paid), Notes. 500-row capacity.
3. **Categories** — full hierarchy lookup table. Columns: Category, Group, Super Group, ITC Eligible (Y/N). Pre-populated from CATEGORY_HIERARCHY constant.
4. **Accounts** — all accounts with type and opening balance reference. Columns: Account, Type, Opening Balance, Notes.
5. **Monthly P&L** — SUMPRODUCT-based (no pivots). Rows: Super Group > Group > Category. Columns: Jan–Dec + YTD. Excludes transfers. Includes Gross Profit and Net Income summary rows.
6. **Account Balances** — SUMIF from Transactions. Shows balance + last transaction date for every account.
7. **Owner Balances** — per owner: Advances Paid YTD, Profit Allocated YTD, Net Balance. Uses SUMPRODUCT filtering on Transfer Type.
8. **Per-Job P&L** — dynamic job list via UNIQUE/FILTER from Transactions. Columns: Job, Revenue, Labor (from Wages tab), Direct Expenses, Net. 100-row capacity.
9. **GST/QST Tracker** — GST 5%, QST 9.975%. Monthly columns. Rows: Taxable Revenue, GST/QST Collected, ITC-Eligible Expenses, GST/QST Paid (ITC), Net Remittance. Annual filing.
10. **Reconciliation** — compares ledger balance vs. manually entered actual bank balance per account (RBC, BMO MC, CIBC, Cash). Flags discrepancies.
11. **Dashboard** — live summary. Bank balances, owner balances, YTD P&L, current month P&L. No charts — clean readable numbers.
12. **Import** — CSV staging area. Columns: Date, Description, Amount, Account (auto), Category, Transfer Type, Job, Duplicate?. Duplicate check formula against Transactions. Dropdowns for categorization. 200-row capacity.

---

## Job / Contract Tagging

**Format:** Client last name in caps + underscore + sequence number (e.g. ARCO_01, SMITH_02)

**2026 Active Jobs:**
- DUFRESNE_01
- CHAUT_01 (aka Laval)
- KENNERKNECHT_01 (aka Murray Hill)

All three have existing data in the 2025 Tiller sheet (2026 section in P&L by contract tab and Wages sheet). That data needs to be cleaned and migrated.

**Consumables rule:** Supplies are bought in bulk across multiple jobs. Job tagging on supply purchases is optional. Per-job P&L = Contract Revenue (tagged) - Labor Wages (tagged) - directly attributable expenses (when possible). Do not over-engineer job tagging.

---

## Wages Sheet Design

Feeds into per-job P&L. Does NOT auto-create rows in Transactions — wages entered manually in both places (or a sync script can be built later).

**Future:** Jibble API integration to auto-pull timesheet data. Not built now — Wages sheet is designed to accept Jibble data later without restructuring. Jibble integration pending — will write to Wages tab using same column structure, needs job-tagging confirmed in Jibble settings. Separate session item once core system is live.

---

## Opening Balances (Dec 31, 2024)

Enter as rows in Transactions dated 2025-12-31 with Category = Transfer, Transfer Type = Opening Balance.

| Account | Balance |
|---------|---------|
| Cash | $961.00 |
| RBC | $185.20 |
| Inventory | $2,800.00 (not tracking — expense immediately) |
| AR (Receivable: Client) | $4,598.23 |
| Vehicle | $2,020.00 |
| Equipment | $2,195.00 |
| BMO MC (liability) | -$8,085.27 |
| AP | -$104.00 |
| Sales tax owed (2024) | -$4,271.60 |

---

## Bank Import Rules

### CSV Format Differences
- **RBC** — standard CSV with headers
- **BMO MC** — amounts are positive for charges, **must be negated on import**
- **CIBC** — no header row; detected by masked card pattern in column 5

### Import Flow
1. Paste or upload CSV into Import tab
2. Auto-detect which bank based on column headers / patterns
3. Map columns to Transactions format
4. Account pre-filled, Category/Transfer Type left blank for manual review
5. Duplicate check formula flags matches against existing Transactions
6. "Push to Transactions" button (via Apps Script menu) moves reviewed rows

### Future Ingestion Methods (not built)
- PDF statement screenshot via Claude API
- Xero API (being evaluated)
- Gmail API for supplier invoices

---

## Cash Transaction Entry

Workers paid cash, revenue sometimes received in cash. Needs frictionless mobile-friendly entry.

**Built (in original folder, not yet tested):**
- `cash-entry-sidebar.gs` — server-side Apps Script
- `sidebar.html` — mobile cash entry form
- Custom OstéoPeinture menu in Google Sheets

**Status:** Reportedly built in prior session but unknown if functional.

---

## Conversational Interface (most critical unbuilt deliverable)

Claude reads and writes to Google Sheet via Sheets API. User types or speaks natural language.

### Entry Examples
- "Paid Lubo $800 cash for Murray Hill job"
- "Received $5,000 e-transfer from client for Kennerknecht job"
- "Home Depot cash purchase $340 for supplies, Murray Hill"

### Required Behavior
1. Parse the transaction
2. Show preview before writing: "I'm about to add: [details]. Confirm?"
3. User confirms or corrects
4. Write the row to Transactions
5. Confirm what was written

**Validation is non-negotiable.** No writes without confirmation.

### Also Supports
- CSV import and categorization
- P&L queries ("What did we make on Murray Hill?")
- Owner balance queries ("What does the company owe Graeme?")
- Flag uncategorized transactions

Must work on mobile.

### Architecture Decision (reviewed 2026-04-04)

**Codex independent review recommended against using Google Sheets as the primary ledger store.** Summary of findings:

**Recommended architecture (MVP):**
Railway + Python (FastAPI) + service-account gspread for Sheets access + Claude API for NLP structured extraction. Acceptable for a first version.

**Recommended architecture (durable finance tool):**
Railway or Cloud Run + Python backend + **Postgres as the ledger system of record** + Google Sheets as a synced reporting/operational surface + Claude for structured extraction only + deterministic accounting rules before any write.

**Why Postgres over Sheets-as-ledger:**
- Immutable journal entry IDs
- Explicit debit/credit lines with reversals instead of silent edits
- Approval state, idempotency keys, audit metadata
- Strong consistency around writes
- Google Sheets has request quotas and no atomic multi-row transactions

**Corrections to initial assessment:**
- Apps Script CAN call external APIs via `UrlFetchApp` — rejection reason was inaccurate. Real issue is UI/observability limits.
- MCP now supports remote HTTP servers — "only local" is outdated. Still not recommended as core architecture.
- Cloud Run is a strong alternative to Railway for Google-centric stack (managed deployment, autoscaling, closer Google auth alignment).

**Key risks to design around:**
- Ambiguity in natural language ("Paid Lubo $800 cash" needs strict account/alias mapping rules)
- LLM drift — model proposes structured intent, deterministic rules validate before write
- Duplicate submissions from mobile retries — need idempotency
- Sheets API quotas — retries/backoff required
- French/Quebec context — accents, bilingual labels, GST/QST conventions
- P&L and balance queries should run from normalized ledger data, not model summaries

**Decision pending:** MVP (Sheets-direct) vs. durable (Postgres + Sheets sync). Feasibility assessment needed before committing.

---

## Invoice Generator (connected build — separate session)

Lives in the quote-assistant build, not here. Takes an existing quote and converts to invoice format:
- A. Initial Budget (from quote)
- B. Add-ons/Adjustments (overages, credits, extras)
- Final Total
- GST/QST (5% + 9.975%)
- Deposit Paid / Previous Payments / Balance to Pay

When invoice is marked paid, it creates a Revenue entry in Google Sheets automatically.

**Reference template:** Exterior invoice PDF (PROJECT COST BREAKDOWN — FRONT EXTERIOR format). Same branding as quote. Bilingual EN/FR per client.

Do not build this until the finance system is fully live.

---

## Quebec-Specific Tax Rules

- Quebec general partnership (société en nom collectif)
- GST = 5%, QST = 9.975%
- Partners file T5013 / TP-600 information returns annually (due March 31)
- Fiscal year = calendar year (Jan 1 – Dec 31)
- Mix of employees and subcontractors — wages tracked separately
- Cash transactions are frequent — audit risk is real, entries must be complete and traceable
- ITC eligibility flagged per category in Categories tab (col D)

---

## Design Philosophy

- Clarity over cleverness
- Explicit balances — no abstraction, no virtual money
- Human-debuggable: any row should make sense to a non-accountant
- One source of truth: the Transactions tab
- Built to last — optimize for reliability, not elegance
- No inventory tracking — supply purchases expense immediately
- SUMPRODUCT-based formulas (no pivots)

---

## Data to Populate (2026 YTD: January–April)

### Bank CSVs Needed
- RBC — Jan–Mar 2026
- BMO MC — Jan–Mar 2026
- CIBC — Jan–Mar 2026 (if applicable)

### Existing Data to Migrate
- 2025 Tiller sheet has a 2026 section in P&L by contract tab and Wages sheet for DUFRESNE_01, CHAUT_01, KENNERKNECHT_01
- Data is there but messy — needs cleaning before migration

### Cash Transactions
Loric to dictate these to the conversational interface once built.

### Old Tiller Exports
Available on Google Drive for May–Dec 2024 (monthly CSVs + formatted compilations). Reference only.

---

## Current Status (as of 2026-04-05)

### What's in the Live Sheet
- **155 rows in Transactions** — 5 opening balances (WRONG — see below) + 98 bank imports (RBC + BMO, auto-categorized) + 21 bank mirrors + 18 cash entries + 13 cash mirrors
- **14 rows in Wages** — Edler, Yann, Fred (Jan–Apr 2026, migrated from old sheet)
- **Per-Job P&L live:** CHAUT_01 ($29,290 rev / $24,605 net), KENNERKNECHT_01 ($15,000 rev / $13,380 net), ADAMS_01 ($1,000 deposit)
- **Monthly P&L working** — Jan–Mar broken down by category
- **Owner Balances:** Loric $7,489, Graeme $10,200, Lubo $10,200, Boss $2,750

### KNOWN ISSUE — Opening Balances Are Wrong
The 5 opening balance rows (rows 2–6) use **Dec 31, 2024** figures, not Dec 31, 2025. A full year of 2025 activity is missing from the starting point. Loric is still correcting the 2025 ledger in the old Tiller sheet. **Do not fix until Loric confirms the 2025 ledger is final.** When ready: pull final Cash and Bank balance from the last December row in the 2025 ledger, replace the 5 opening balance rows.

This affects Account Balances (Cash, RBC, BMO MC, AR) but NOT the P&L, job profitability, or owner advance tracking.

### What's Built
- All 12 tabs live with correct formulas
- `create-sheet.gs` — tab builder + `addBossOwner()` fixup (in repo)
- `import-csv.gs` — bank CSV importer with French header support, BOM stripping, YYYYMMDD dates, pre-2026 filter, dedup on date+amount+account (in repo + pushed to Apps Script via clasp)
- `mirror-entries.py` — double-entry mirror generator for all Transfer-category rows (in repo)
- `autocat-rules.json` — keyword-to-category lookup from Tiller AutoCat (in repo)
- `cash-entry-sidebar.gs` + `sidebar.html` — in original folder, untested
- Custom OstéoPeinture menu in Apps Script
- Script properties set, hourly trigger installed
- Clasp authenticated (can push .gs files to Apps Script)
- OP Bank Imports folder on Drive: `1rx7sYNTGya2wxMPP0Bf12_f9Dnbt3pgu`

### Import Pipeline (working)
1. Drop CSV in OP Bank Imports Drive folder
2. Claude Code downloads via gws, parses with correct bank detection (FR/EN headers)
3. Auto-categorizes using `autocat-rules.json`
4. Stages in Import tab with dedup formulas
5. Writes to Transactions via Sheets API
6. Generates mirror entries via `mirror-entries.py` for all Transfers
7. Uncategorized rows flagged for manual review (15 out of 98 needed Loric input)

### What's NOT Done
- **Opening balances** — blocked on Loric finalizing 2025 ledger
- **GST/QST ITC formula** — shows 0 for eligible expenses (minor formula issue, revenue/collected side works)
- **KENNERKNECHT_01 missing revenue** — $2,000 Dec 2025 deposit not in Per-Job P&L (depends on opening balance fix)
- **DUFRESNE_01 revenue** — $2,075 was cash, not yet entered (need Jan/Feb cash transaction details from Loric)
- **Conversational interface** — build spec written (`docs/OP-FINANCE-CHAT-SPEC.md`), 6 sessions planned
- **Invoice generator** — separate session after finance system is live
- **Jibble integration** — to be scoped (Loric to check: does Jibble API exist? Are jobs tagged in Jibble?)
- **clasp run not working** — API executable deployed but OAuth client mismatch. clasp push works. Low priority.

---

## Priority Order for Next Session

1. **Fix opening balances** — when Loric confirms 2025 ledger is final
2. **Enter remaining cash transactions** — Jan/Feb cash that hasn't been entered yet, plus DUFRESNE_01 revenue
3. **Fix GST/QST ITC formula** — minor, expenses showing 0
4. **Scope + build Jibble integration** — API check, project-to-job mapping, auto-pull hours into Wages tab
5. **Invoice generator** (quote-assistant build — NOT YET SCOPED) — quote → invoice conversion with GST/QST, deposits, balance to pay. Must be built before finance connection.
6. **Invoice → finance connection** — when invoice marked paid, auto-create Revenue entry in finance sheet. Depends on #5.
7. **Rebuild GST/QST Tracker** — fix ITC formula, add quarterly instalment schedule, payment tracking, due dates, balance owing, prior year carryover. Pull archive data from old SALES TAX tab.
8. **Reconcile supplies/consumables gap** — quantify the ~$22K gap (tax, inventory, underestimation), design proper handling in 2026 system
9. **Build conversational interface** — Session 1: scaffold + deploy (see `docs/OP-FINANCE-CHAT-SPEC.md`)
10. **Cash Movement on Dashboard** — monthly cash in/out breakdown (starting balance → revenue → expenses → owner advances → ending balance)

---

## How to Work

1. Read this CONTEXT.md first — it has everything
2. Read both Google Sheets (2026 + 2025 Tiller) before touching anything
3. Audit: what's there, what works, what's broken, what's missing
4. Report in plain language before doing anything
5. Propose step-by-step plan
6. Get confirmation before each step
7. Small changes, verified before moving on
8. Update this CONTEXT.md at end of session and push

---

*OstéoPeinture 2026 Finance System — MOKSHA BUILDS. Last updated: 2026-04-05.*
