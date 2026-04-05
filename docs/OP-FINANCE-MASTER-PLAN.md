# OstéoPeinture Finance System — Master Build Plan
## All 10 priority items scoped

---

## Current State

- 2026 Google Sheet live with 155 transactions (98 bank imports + 31 cash entries + 26 mirrors)
- Monthly P&L, Per-Job P&L, Owner Balances, Dashboard — all working
- Import pipeline working: CSV → autocat → stage → write + mirrors
- Opening balances wrong (2024 instead of 2025) — blocked on Loric
- GST/QST ITC formula broken (minor)
- Quote-assistant live on Railway (Node.js, Playwright PDF, bilingual)

---

## Item 1: Fix Opening Balances

**What:** Replace the 5 opening balance rows (Transactions rows 2–6) with correct Dec 31, 2025 figures.

**Blocked on:** Loric finalizing the 2025 ledger in the old Tiller sheet.

**When unblocked:**
1. Read final row balances from "2025 - LEDGER" tab (Cash col K, Bank col N at last December entry)
2. Read BMO MC balance from BMO tab or Balance Sheet
3. Read AR from P&L by contract or Dividends tab
4. Delete rows 2–6 in Transactions
5. Write new opening balance rows dated 2025-12-31 with correct amounts
6. Verify Account Balances tab updates correctly

**Effort:** 15 minutes once unblocked.
**Dependencies:** None.
**Risk:** The 2025 ledger may never be "final" — Loric is still correcting it. May need to set a cutoff date and accept approximate values.

---

## Item 2: Enter Remaining Cash Transactions

**What:** Jan/Feb 2026 cash transactions not yet entered. Also DUFRESNE_01 revenue ($2,075 cash).

**Blocked on:** Loric providing Jan/Feb cash details (same format as the Mar/Apr dictation).

**When unblocked:**
1. Loric dictates or provides screenshots of Jan/Feb cash ledger
2. Parse entries (same as Mar session — revenue, owner advances, worker payments, gas)
3. Write to Transactions with correct categories
4. Generate mirror entries for all Transfers
5. Tag revenue to DUFRESNE_01/CHAUT_01/KENNERKNECHT_01 as applicable

**Effort:** 30–60 minutes depending on volume.
**Dependencies:** Item 1 ideally done first (so balances are correct), but not strictly required.

---

## Item 3: Fix GST/QST ITC Formula

**What:** The ITC rows in GST/QST Tracker show 0.00 for all months despite having eligible expenses in Transactions.

**Root cause (suspected):** Same type mismatch issue as the Month column — the COUNTIFS formula may be comparing text categories to formatted values, or the expense amounts include the wrong sign convention.

**Plan:**
1. Debug the formula by testing COUNTIFS components individually (same approach as the Month column fix)
2. Check if Categories!D column (ITC Eligible Y/N) is being read correctly
3. Check if the sign convention matters (expenses are negative, formula multiplies by -1)
4. Fix the formula in the live sheet
5. Update create-sheet.gs to match
6. Push via clasp

**Effort:** 30 minutes.
**Dependencies:** None.

---

## Item 4: Jibble Integration

**What:** Auto-pull worker hours from Jibble into the Wages tab. Workers already log hours per project per task in Jibble.

**Architecture:**
```
Jibble API → Python script (or Apps Script) → Wages tab in Google Sheet
```

**Jibble plan:** Free (no API access). API requires Ultimate ($4.99/user/month). Decision: use CSV export for now, upgrade to API later if manual export becomes a burden.

**Design: CSV export + import pipeline**

Same flow as bank CSVs:
1. Loric exports timesheet CSV from Jibble web UI (weekly, ~2 minutes)
2. Drops file in OP Bank Imports Drive folder
3. Import pipeline detects Jibble CSV (new parser alongside RBC/BMO/CIBC)
4. Maps project names → job codes via alias table
5. Maps worker → hourly rate via rate table
6. Writes to Wages tab with dedup (Jibble entry date + worker + project)
7. Flags entries with unknown project names or workers for review

**Data flow:**
```
Jibble time entry:
  Worker: Edler
  Project: Laval
  Task: Painting
  Hours: 8.5
  Date: 2026-03-14

→ Wages tab row:
  Date: 2026-03-14
  Worker: Edler
  Job: CHAUT_01  (mapped from "Laval")
  Hours: 8.5
  Rate: 20  (from rate table)
  Total: 170 (formula)
  Payment Method: (blank until paid)
  Paid: 0
  Balance Owed: 170 (formula)
  Notes: Jibble sync — task: Painting
```

**Job alias table (new file: `jibble-job-aliases.json`):**
```json
{
  "Laval": "CHAUT_01",
  "Murray Hill": "KENNERKNECHT_01",
  "Dufresne": "DUFRESNE_01",
  "Adams": "ADAMS_01",
  "Flyering": "FLYERING"
}
```

**Worker rate table (in Wages tab or separate config):**
```json
{
  "Edler": 20,
  "Yann": 25,
  "Fred": 20
}
```

**Effort:** 1 session (build CSV parser + test with real export).
**Dependencies:** Loric provides one sample Jibble CSV export so we can see the column format.
**Future upgrade path:** If manual export gets old, upgrade to Jibble Ultimate ($20/month for 4 users) and swap CSV parser for API integration. Wages tab schema stays the same — only the data source changes.

---

## Item 5: Invoice Generator (Quote-Assistant Build)

**What:** Add invoice generation to the existing quote-assistant app. A quote becomes an invoice with adjustments, tax, deposits, and balance to pay.

**Lives in:** `osteopeinture/quote-assistant/` (Node.js, Railway)

**Existing infrastructure to reuse:**
- `renderQuoteHTML()` — already renders quotes as HTML → PDF via Playwright
- `buildSystemPrompt()` — already handles interior/exterior quote conversations
- PDF generation pipeline — Playwright/Chromium in Docker
- Bilingual EN/FR detection
- Session/history in SQLite

**Invoice structure:**
```
PROJECT COST BREAKDOWN — INVOICE

A. Initial Budget (from original quote)
   [line items from quote]
   Subtotal: $X,XXX

B. Add-ons / Adjustments
   [overages, credits, extras entered post-quote]
   Subtotal: $X,XXX

Final Total: $X,XXX
GST (5%): $XXX
QST (9.975%): $XXX
Total with Tax: $X,XXX

Deposit Paid: ($X,XXX)
Previous Payments: ($X,XXX)
Balance to Pay: $X,XXX
```

**New code needed:**
1. `renderInvoiceHTML()` — new function in server.js, based on renderQuoteHTML() but with the invoice structure above
2. Invoice data model — extends quote JSON with: adjustments array, deposit amount, previous payments array, invoice date, invoice number
3. UI: "Convert to Invoice" button on existing quote → opens adjustment editor → generates invoice PDF
4. Invoice status: draft → sent → paid
5. "Mark as Paid" action → triggers finance connection (Item 6)

**New routes:**
- POST /api/sessions/:id/invoice/create — create invoice from quote
- PUT /api/sessions/:id/invoice/adjustments — add/edit adjustments
- POST /api/sessions/:id/invoice/pdf — generate invoice PDF
- POST /api/sessions/:id/invoice/send — email invoice
- PUT /api/sessions/:id/invoice/mark-paid — mark paid + trigger finance entry

**Effort:** 3–4 sessions.
**Dependencies:** None (builds on existing quote-assistant).
**Risk:** Playwright PDF rendering for invoices may need different CSS/layout than quotes. Test early.

---

## Item 6: Invoice → Finance Connection

**What:** When an invoice is marked paid in the quote-assistant, automatically create a Revenue entry in the finance Google Sheet.

**Architecture:**
```
Quote-assistant (Node.js) → mark-paid action
  → calls finance sheet via Google Sheets API (gspread or googleapis)
  → writes Contract Revenue row to Transactions tab
  → writes mirror entry if needed (Receivable: Client → Cash/RBC)
```

**Data written to Transactions:**
```
Date: payment date
Description: "Invoice paid — {client name} — {job code}"
Account: RBC or Cash (based on payment method)
Counterpart: Receivable: Client
Amount: payment amount (positive)
Category: Contract Revenue
Transfer Type: (blank — it's revenue, not transfer)
Month: derived from date
Job: job code from quote
Source: "Invoice"
```

**If partial payment:** Write only the amount received. Balance to Pay updates in the invoice.

**Implementation options:**

Option A — Direct Sheets API call from Node.js:
- Add `googleapis` npm package to quote-assistant
- Service account credential in Railway env var (same one finance chat will use)
- Quote-assistant writes directly to the Transactions tab
- Simple, one connection

Option B — Webhook to finance FastAPI app:
- Quote-assistant sends POST to finance app with payment details
- Finance app validates, writes to sheet, generates mirror
- More decoupled, but requires finance app to be running

**Recommended:** Option A for now (direct write). Option B when the finance FastAPI app exists.

**Effort:** 1 session (once invoice generator is built).
**Dependencies:** Item 5 (invoice generator) must be complete.
**Risk:** Service account needs editor access to the sheet. Already planned.

---

## Item 7: Rebuild GST/QST Tracker

**What:** Replace the current broken GST/QST Tracker tab with a comprehensive version that matches the old SALES TAX tab functionality — automated from Transactions data.

**Current tab keeps:** Revenue-based GST/QST collection (rows 4–6, working).
**Current tab fixes:** ITC formula (rows 8–9, broken).
**New sections to add:**

### Section 1: Tax Collected (exists, working)
- Taxable Revenue per month
- GST Collected (5%) per month
- QST Collected (9.975%) per month

### Section 2: Input Tax Credits (exists, broken → fix)
- ITC-eligible expenses per month (from Transactions, filtered by Categories ITC flag)
- GST paid on eligible expenses
- QST paid on eligible expenses

### Section 3: Net Owing (exists, partially working)
- GST Net = Collected - ITC
- QST Net = Collected - ITC
- Total yearly owing

### Section 4: Quarterly Instalments (NEW)
- Schedule: Q1 (Apr 30), Q2 (Jul 31), Q3 (Oct 31), Q4 (Jan 31 next year)
- Instalment amount: based on prior year net owing ÷ 4
- Columns: Due Date, GST Amount, QST Amount, Total, Paid (Y/N), Payment Date, Reference #

### Section 5: Balance After Instalments (NEW)
- Total owing - Total instalments paid = Balance
- Separate GST and QST balances
- Due date for final balance (March 31 following year-end)

### Section 6: Archive (NEW)
- 2023, 2024, 2025 summary rows pulled from old SALES TAX tab
- Read-only reference: collected, ITC, net owing, instalments paid, penalties

**Data sources:**
- Sections 1–3: auto-calculated from Transactions (SUMPRODUCT formulas)
- Section 4: manual entry for payment tracking (date, reference #), auto-calculated amounts
- Section 5: formulas from sections 3 + 4
- Section 6: one-time data pull from old sheet

**Effort:** 1–2 sessions.
**Dependencies:** Item 3 (ITC formula fix) should be done first.

---

## Item 8: Reconcile Supplies/Consumables Gap

**What:** Quantify the ~$22K gap between total supplies expense (P&L by month) and per-job consumable allocations (P&L by contract) in the 2025 data.

**Analysis plan:**
1. Pull P&L by month S18 (total supplies) from old sheet
2. Pull P&L by contract row 17+18 totals from old sheet (per-job consumables)
3. Calculate: Total Supplies - Sum of Per-Job Consumables = Gap
4. Break gap into three components:
   - GST/QST on supplies (14.975% of total, or calculate from ITC claims)
   - Inventory delta (Loric estimates $2K–$5K)
   - Unallocated consumption (remainder)

**Design change for 2026 system:**
- Record supply purchases at face value (tax-inclusive) — this is what the bank shows
- The GST/QST Tracker separately calculates the ITC refund
- Add an optional "Net of Tax" view to the P&L (expenses minus recoverable tax)
- Per-job consumable allocation stays manual (not derived from purchases)
- Document the expected gap so it's understood, not a mystery

**Implementation:**
- Add a "Net Expenses" row to Monthly P&L that subtracts estimated ITC from expenses
- Or add a note/section explaining the tax-inclusive vs. net-of-tax difference
- No new tab needed — it's a reporting adjustment

**Effort:** 1 session (analysis + formula adjustment).
**Dependencies:** Item 3 and Item 7 (ITC needs to be working first).

---

## Item 9: Conversational Interface

**What:** Mobile chat UI for entering transactions via natural language. Full spec in `docs/OP-FINANCE-CHAT-SPEC.md`.

**Architecture:** FastAPI + gspread + Claude API + single HTML file on Railway.

**6-session build plan already written:**
1. Scaffold + deploy empty shell (confirm loads on phone)
2. Google Sheets connection (service account, read/write working)
3. Claude extraction + rules engine (5 transaction types)
4. Full chat flow (type → preview → confirm → write + mirror)
5. Read queries + polish (balances, job P&L, PWA)
6. Real data testing + launch

**Key design decisions already made:**
- Sheets-direct for MVP (not Postgres)
- Claude extracts facts, deterministic rules do accounting
- 5 transaction types: supplies, owner draws, transfers, revenue, worker payments
- Auto-categorize via autocat-rules.json
- Auto-mirror via mirror-entries.py logic
- Every row gets entry_id + created_at for future Postgres migration
- iOS Safari confirmed safe (patterns from quote-assistant)

**Effort:** 6 sessions as planned.
**Dependencies:** Service account creation for Google Sheets access.

---

## Item 10: Cash Movement on Dashboard

**What:** A "where did the cash go this month" section on the Dashboard tab.

**Layout:**
```
CASH MOVEMENT — [Month YYYY]

  Starting Cash + Bank:    $X,XXX
  + Revenue received:      $X,XXX
  - Supplies:              ($X,XXX)
  - Worker payments:       ($X,XXX)
  - Owner advances:        ($X,XXX)
  - Vehicle costs:         ($X,XXX)
  - Ads & marketing:       ($X,XXX)
  - Other expenses:        ($X,XXX)
  = Ending Cash + Bank:    $X,XXX
```

**Implementation:**
- SUMPRODUCT formulas in the Dashboard tab
- Filters by current month (TEXT(TODAY(),"YYYY-MM"))
- Groups expenses by Super Group (from Categories tab)
- Starting balance = sum of all prior months' transactions for Cash + RBC accounts
- Ending balance = current Cash + RBC balance

**Effort:** 30 minutes (just formulas, no code).
**Dependencies:** None, but more useful after Items 1–2 are done (correct balances).

---

## Foundation: Shared Transaction Write Contract

**Added per Codex review.** Before building Items 4, 5, 6, or 9, define one standard for every system that writes to the Transactions tab.

Every row written by any system must include:

| Column | Purpose |
|--------|---------|
| entry_id | UUID — unique identifier for this entry |
| source_system | "bank_import", "manual", "jibble", "invoice", "chat" |
| source_id | ID from the originating system (Jibble time-entry ID, invoice number, etc.) |
| created_at | ISO timestamp when the row was written |

**Idempotency rule:** Before writing, check if `source_system + source_id` already exists in Transactions. If yes, skip. For multi-row writes (e.g. a transfer + its mirror), use `source_id` as the group identifier and add a `line_index` (1, 2) to make each row unique. Dedup key = `source_system + source_id + line_index`.

**Correction policy:** Never edit or delete historical rows. To fix an error, append a reversing entry (same amount, opposite sign, description prefixed with "[Reversal]") followed by the corrected entry. This preserves the full audit trail.

**Implementation:** Add columns K–N to Transactions tab (hidden by default). All writers must populate them. The dedup formula in Import tab already covers bank imports; this extends the same principle to Jibble, invoices, and chat.

---

## Invoice Posting Model: Cash-Basis

**Added per Codex review.** The invoice → finance connection uses **pure cash-basis accounting:**

- When invoice is **sent**: no entry in Transactions (no A/R created)
- When invoice is **paid**: write one Contract Revenue row (Account = RBC or Cash, no Receivable counterpart)
- Partial payments: each payment is a separate Revenue row

This is simpler, matches how the system already works (bank imports are cash-basis), and avoids A/R complexity for a 30-transaction/week business. If Loric later wants receivable tracking, it can be layered on top.

**Important caveat (per Codex):** This is the internal ops ledger basis, NOT the tax filing basis. For Canadian/Quebec business income, accrual is generally the default. For GST/QST under the regular method, tax can be due on amounts billed, not just collected. The GST/QST Tracker (Item 7) should calculate tax owing based on invoiced revenue, not just cash received. Keep "internal cash ledger" separate from "tax filing basis."

---

## Summary: Effort and Sequencing (revised per Codex review)

| Item | Effort | Blocked By | Can Parallel? |
|------|--------|-----------|--------------|
| 0. Write contract | 30 min | Nothing | Do first |
| 1. Opening balances | 15 min | Loric (2025 ledger) | — |
| 2. Cash transactions | 30–60 min | Loric (Jan/Feb data) | — |
| 3. ITC formula fix | 30 min | Nothing | Yes |
| 4. Jibble CSV import | 1 session | Loric (sample CSV) | Yes with 5 |
| 5. Invoice generator | 4–6 sessions | Nothing | Yes with 4 |
| 6. Invoice → finance | 1 session | Item 5 | No |
| 7. GST/QST rebuild | 2–3 sessions | Item 3 | Yes with 4/5 |
| 8a. Supplies gap analysis | 1 session | Items 3, 7 | No |
| 8b. Reporting policy change | 30 min | Item 8a | No |
| 9. Chat interface | 6 sessions | Item 0 | Yes (after 1–3) |
| 10. Cash movement | 30 min | Nothing | Yes |

**Total estimated: ~19–23 sessions (Jibble reduced from 2–3 to 1)**

**Optimal sequencing (revised per Codex — stabilize first, then build outward):**
- **Session A:** Items 0 + 3 + 10 (foundation + ITC fix + dashboard — not blocked)
- **Session A.5:** Items 1 + 2 (opening balances + cash transactions — when Loric unblocks)
- **Sessions B–C:** Item 7 (GST/QST rebuild — stabilize tax tracking before building integrations)
- **Sessions D–F:** Item 5 (Invoice generator — largest build)
- **Session G:** Item 6 (Invoice → finance connection)
- **Sessions H–J:** Item 4 (Jibble integration)
- **Session K:** Item 8a + 8b (Supplies gap analysis + reporting fix)
- **Sessions L–Q:** Item 9 (Chat interface — 6 sessions)

**Rationale for reorder:** Stabilize baseline data and tax logic first. Then build invoicing (the most complex integration). Then Jibble (operational automation). Chat interface last — it's a UX improvement, not a data gap.

---

## Additional Items Flagged by Codex (not yet prioritized)

These are real needs but not urgent for MVP:

1. **Monthly reconciliation workflow** — compare ledger balance per account vs actual bank statement. The Reconciliation tab exists but has no workflow around it.
2. **Period-close locking** — prevent edits to prior months once closed. Currently anyone can edit any row.
3. **Sheet backup/export** — periodic backup of the finance sheet. Railway cron job or Apps Script trigger.
4. **Error/audit log for imports** — track what was imported, when, by which system, any errors. Currently only Logger.log in Apps Script.
5. **Receipt/document linkage** — associate receipts (photos, PDFs) with transactions. Future phase.

---

*OstéoPeinture Finance System — Master Build Plan v2.1. Written 2026-04-05. Two Codex review passes — approved with minor fixes applied.*
