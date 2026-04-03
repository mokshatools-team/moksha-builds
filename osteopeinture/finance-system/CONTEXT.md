# OstéoPeinture Finance System

## What This Is

A double-entry ledger in Google Sheets for OstéoPeinture, a Quebec painting partnership (Loric, Graeme, Lubo, BOSS). Replaces a legacy sheet that had a confirmed $316M formula bug in the 2025 sales tax data. Dec 31, 2024 opening balances are clean.

## Prior Work (from earlier Codex/Claude sessions)

- **12 tabs built:** Transactions, Wages, Categories, Accounts, Monthly P&L, Account Balances, Owner Balances, Per-Job P&L, GST/QST Tracker, Reconciliation, Dashboard, Import
- **Bank CSV importers:** RBC, BMO MC, CIBC detection and normalization
- **Mobile cash entry sidebar:** discussed and reportedly built (server-side + HTML form)
- **Key design decisions:** no inventory tracking (expenses immediately), negative owner balance = company owes that owner, SUMPRODUCT-based formulas (no pivots)
- **Opening balances (Dec 31, 2024):** Cash $961, RBC $185.20, AR $4,598.23, BMO MC liability $8,085.27, sales tax owed $4,271.60

## Key Files

| File | Description |
|------|-------------|
| `create-sheet.gs` | Apps Script that builds all 12 tabs. Built in a Codex session but **never tested or run** in this repo. |
| `DESIGN-SPEC.md` | Design spec / prompt document for the finance sheet build. |

## External Resources

- **Google Sheet (2026):** "OstéoPeinture -- Finance 2026.gsheet" — two versions exist on Google Drive, needs to be identified which is the correct one
- **Old Tiller exports:** Available in Google Drive for May--Dec 2024 (monthly CSVs + formatted compilations)
- **Apps Script project:** Previously linked via `.clasp.json` in `/Users/loric/MOKSHA/OstéoPeinture/finance-system-2026/`

## Current Status

- `create-sheet.gs` was built in a Codex session but never tested or run from this repo
- Cash entry sidebar was discussed but it is unknown whether it was fully built
- Conversational interface not built yet
- Prior session notes reference additional files (`import-csv.gs`, `cash-entry-sidebar.gs`, `sidebar.html`, `SETUP.md`) that live in the original folder but have not been copied here yet

## Next Step

1. Identify which of the two "OstéoPeinture -- Finance 2026" sheets on Google Drive is the correct one
2. Run `create-sheet.gs` against that sheet and audit the result
3. Determine which additional files from the original folder should be brought into this repo
