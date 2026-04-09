---
name: Cash Ledger tab — dynamic filtered view pattern
description: Tab #13 in OP finance sheet. Live QUERY + SCAN running balance. Reusable pattern for per-account ledger views.
type: reference
---

**Location:** OP Finance 2026 sheet, tab "Cash Ledger" (built by `buildCashLedger()` in `osteopeinture/finance-system/create-sheet.gs`).

**Pattern (reusable for any per-account ledger):**
- `QUERY(Transactions!A2:I2000, "select A,B,D,F,E where C='<Account>' order by A", 0)` in A4 — live filtered view
- `ARRAYFORMULA(IF(A4:A="","",SCAN(0,E4:E,LAMBDA(acc,x,IF(ISNUMBER(x),acc+x,acc)))))` in F4 — running balance
- Row 2: `="Current Balance: "&TEXT(SUMIF(Transactions!C:C,"<Account>",Transactions!E:E),"$#,##0.00")`

**Why QUERY + SCAN and not pivot table:** Pivot tables in Google Sheets cannot produce a row-level running balance column. QUERY + SCAN is fully dynamic (edits to Transactions flow through automatically) AND supports cumulative sum natively.

**How to apply:** If Loric asks for a similar per-account view (e.g. RBC Ledger, Owner: Loric Ledger), copy `buildCashLedger()` and swap the account name. Same QUERY/SCAN structure works.
