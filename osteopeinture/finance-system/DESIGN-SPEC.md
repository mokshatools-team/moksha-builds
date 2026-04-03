# Claude Code Prompt — Finance Sheet Review & Redesign
## OstéoPeinture / MOKSHA Collective — v2

---

## WHO I AM

I'm Loric, co-owner of OstéoPeinture, a painting general partnership in Quebec (Canada) with three partners: Loric, Graeme, and Lubo. This is the primary income source for our four-person creative collective (MOKSHA). I'm not a developer — I need plain-language explanations alongside any technical work.

---

## WHAT I NEED YOU TO DO

I have a Google Sheets finance system that is partially built. I need you to:

1. **Read the existing sheet first** — understand what's there before doing anything
2. **Audit it against the design spec below** — flag what's working, what's broken, what's missing
3. **Ask clarifying questions** before making any changes
4. **Propose a full redesign plan** with clear reasoning
5. **Build a brand new Google Spreadsheet** for 2026 — do not modify the old one
6. The old sheet's end-of-2025 balances will be used as opening balances in the new system

Do NOT make changes to the existing sheet. Build everything new and separate.

---

## EXISTING SHEET URL

[PASTE YOUR GOOGLE SHEET URL HERE]

Read this first. Pay particular attention to:
- The existing category/group/super-group structure in the Tiller categories tab
- Any existing pivot logic
- The wages sheet structure
- Opening balances or year-end figures

---

## BUSINESS CONTEXT

**OstéoPeinture** is a Quebec painting company. Revenue comes from residential and commercial painting contracts. Three working owners (Loric, Graeme, Lubo) plus occasional workers paid as cash subcontractors or by e-transfer.

### How money flows in
- Client payments: cash or e-transfer (rarely cheque)
- Revenue is per contract — tracked by job code (e.g. ARCO_01, SMITH_02)
- We invoice per job and track P&L per contract

### How we pay ourselves (owners)
- Biweekly advances: roughly $2,000–2,500 per owner on the 15th and last day of month
- These are **advances against earnings**, not confirmed dividends
- At end of month/quarter: calculate actual net income, compare to advances paid, reconcile who is owed what or who was overpaid
- Owner accounts track the running balance of advances vs. earned entitlement

### How we pay workers
- Workers log time in **Jibble** (time tracking app)
- Loric manually pulls Jibble timesheets and enters hours + wage into a wages sheet per job per worker
- Workers paid cash or e-transfer — treated as subcontractors
- Wages are deducted from job revenue to get net income before owner split

### Bank accounts
- **RBC**: primary business/personal (used for most transactions)
- **BMO MC**: business credit card (supplies, gas, etc.)
- **CIBC**: business account (currently feeds manual only — no reliable automated connection)

---

## THE SYSTEM DESIGN

### Core principle
> Every movement of value between two accounts = two rows in the Transactions sheet.

This is a **double-entry ledger**, not a simple expense tracker. One row per side of every transaction. Tiller (old system) auto-imported one side; we manually added the mirror. The new system will work the same way regardless of ingestion method.

### Account structure
```
CASH / BANKING
  RBC
  BMO MC
  CIBC

OWNERS
  Owner: Loric
  Owner: Graeme
  Owner: Lubo

LOANS
  Loan: Alex

RECEIVABLES
  Receivable: Client
  Receivable: OP

ASSETS
  Asset: Gear
```

### Owner balance logic
- **Negative balance** = company owes that owner
- **Positive balance** = owner owes the company
- Biweekly advances reduce owner balances (company pays out)
- End-of-period profit allocation increases owner entitlement
- This replaces all separate owner tracking sheets

---

## TRANSACTIONS SHEET (SINGLE SOURCE OF TRUTH)

One sheet called `Transactions`. Every financial event lives here.

### Columns
| Column | Description |
|--------|-------------|
| Date | Transaction date |
| Description | What happened |
| Account | Which account this row belongs to |
| Counterpart | The other side of this transaction |
| Amount | Signed — positive = inflow to this account, negative = outflow |
| Category | P&L category OR "Transfer" |
| Transfer Type | Label for internal movements (see below) |
| Month | Auto-derived: =TEXT(Date,"YYYY-MM") |
| Job | Optional — job code like ARCO_01 (manually entered when known) |
| Source | How this row was entered: "Bank Import", "Manual", "Wages" |

### Category system
Pull the full category/group/super-group hierarchy from the existing sheet. Preserve whatever structure is already there. Categories split into:

- **P&L categories**: appear in income statement (Revenue, COGS, Expenses)
- **Transfer**: used for ALL internal movements — excluded from P&L entirely

### Transfer Type labels
Used when Category = Transfer:
- Credit Card Payment
- Loan Received / Loan Repayment
- Owner Draw / Owner Payment / Owner Reimbursement / Owner Advance
- Asset Purchase
- Vendor Payment / Client Payment
- Third Party Transfer

---

## STANDARD TRANSACTION PATTERNS

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

## JOB / CONTRACT TAGGING

**Current system:** job codes like `ARCO_01`, `SMITH_02` — client last name in caps + underscore + sequence number.

**Important context on consumables:**
Supplies (paint, tape, brushes, etc.) are bought in bulk and used across multiple jobs over months. It is NOT practical to tag every supply purchase to a specific job at point of purchase. Therefore:

- Job tagging on supply transactions is **optional and secondary**
- Per-job P&L is calculated primarily from: **revenue per job minus labor wages per job**
- Consumables are tracked at the business level (total supplies expense), not per job
- If a receipt can be cleanly split at the store (two invoices), the job tag can be added — but this is aspirational, not required

**Per-job P&L therefore = Contract Revenue (tagged) − Labor Wages (tagged) − directly attributable expenses (when possible)**

Do not over-engineer the job tagging system. Keep it optional and manual.

---

## WAGES SHEET

A separate tab called `Wages` tracks worker time and pay per job.

### Wages columns
| Column | Description |
|--------|-------------|
| Date | Pay date |
| Worker | Name |
| Job | Job code |
| Hours | Hours worked |
| Rate | Hourly rate |
| Total | Hours × Rate (formula) |
| Payment Method | Cash / E-transfer |
| Notes | |

This sheet feeds into per-job P&L calculations. It does NOT auto-create rows in Transactions — wages are entered manually in both places, or we build a script that syncs them.

**Future:** Jibble API integration to auto-pull timesheet data. Do not build this now — just design the Wages sheet so it could accept Jibble data later without restructuring.

---

## REQUIRED OUTPUT TABS

### 1. Monthly P&L
- Exclude: Category = Transfer
- Rows: Super Group → Group → Category
- Columns: Month (Jan–Dec + YTD)
- Values: SUM Amount
- Use the same Super Group / Group / Category hierarchy from the existing sheet

### 2. Account Balances
- All accounts in one view
- Rows: Account
- Values: SUM Amount (running balance)
- Shows: bank balances, credit card balance, owner balances, loans, assets

### 3. Owner Balances
- Filter: Account starts with "Owner:"
- Shows: each owner's running balance (negative = owed to owner)
- Includes: advances paid YTD, profit allocated YTD, net position

### 4. Per-Job P&L
- Filter: Job is not blank
- Rows: Job → Category
- Values: SUM Amount
- Includes labor from Wages sheet
- Shows: revenue, labor cost, direct expenses, net per job

### 5. GST/QST Tracker
- Quebec rates: GST 5%, QST 9.975%
- Tracks: GST/QST collected on revenue, input tax credits on expenses
- Output: net remittance owing per period
- Flag: we file annually or quarterly (confirm which)

### 6. Reconciliation
- Compares ledger balance per account vs. actual bank balance (manually entered)
- Flags discrepancies per account

### 7. Dashboard (simple)
- One-page summary: current month P&L, owner balances, bank balances, top expenses
- No fancy charts needed — clean readable numbers

---

## OPENING BALANCES (2026)

This is a new sheet starting January 1, 2026. Opening balances come from the existing sheet's end-of-2025 figures.

- Pull year-end balances for all accounts from the old sheet
- Enter as opening balance rows in Transactions dated 2025-12-31 with Category = Transfer, Transfer Type = Opening Balance
- This ensures 2026 balances are correct from day one

---

## CASH / BANK IMPORT

**Ingestion method is not finalized.** The system needs to be able to accept transactions from any of these sources:

1. **CSV import** from bank (RBC, BMO, CIBC each have slightly different formats)
2. **PDF statement screenshot** — Claude layer reads and extracts transactions
3. **Xero API** — if we move to Xero for bank feeds (being evaluated)

For now: build an **Import tab** and an Apps Script that can:
- Accept a pasted or uploaded CSV
- Auto-detect which bank it's from based on column headers
- Map columns to the Transactions format
- Append rows with Account pre-filled, Category/Transfer Type blank for manual review
- Flag duplicates

Leave the Xero integration as a future enhancement. Design the import tab so it can be replaced by an API feed later without restructuring Transactions.

---

## CASH TRANSACTION ENTRY

Workers are paid cash. Sometimes revenue is received in cash. Need a frictionless way to add these without manually inserting rows and breaking formatting.

Options I'm open to:
- Google Form linked to Transactions
- Custom Apps Script sidebar with dropdowns for Account, Category, Job
- Simple script triggered by a button

Recommend what's cleanest and build it. Priority: it must be usable on mobile (phone).

---

## DESIGN PHILOSOPHY

- Clarity over cleverness
- Explicit balances — no abstraction, no virtual money
- Human-debuggable: any row should make sense to a non-accountant
- One source of truth: the Transactions tab
- Built to last — don't optimize for elegance, optimize for reliability

---

## QUEBEC-SPECIFIC NOTES

- Quebec general partnership (société en nom collectif)
- GST = 5%, QST = 9.975%
- Partners file T5013 / TP-600 information returns annually (due March 31)
- Fiscal year = calendar year (Jan 1 – Dec 31)
- Mix of employees and subcontractors — wages tracked separately
- Cash transactions are frequent — audit risk is real, so entries must be complete and traceable

---

## HOW I WANT YOU TO WORK

1. **Read the existing sheet first** — give me a plain-language audit before touching anything
2. **Propose the full plan** — what you'll build, tab by tab, with reasoning
3. **Wait for my go-ahead** before writing any code or creating any tabs
4. **Build incrementally** — one component at a time, confirm before moving on
5. **Explain everything in plain language** — I'm not a developer
6. **Ask when unsure** — never assume, always ask

---

*Built for Claude Code — OstéoPeinture 2026 Finance System. Last updated: March 2026.*
