---
name: OstéoPeinture Finance System 2026 + OP Hub
description: Finance system live, OP Hub job management built (D-1 to D-7), backup mechanism unresolved
type: project
---

**Live URL:** https://op-quote-assistant.up.railway.app
**Live sheet:** `https://docs.google.com/spreadsheets/d/1de_L-9HyVC4tWBGwYTXh8HuldMUjgkW96x5xvLmpmn4/edit`
**Tiller Master:** `12FT0agrTeIdrC929n-vjEWLG9Uxbf136VxpESs-Kcsc`
**Drive backup folder:** `1UW9uxJSUhG64rXIRn1g_yToWss1ko0Sl` (OP Hub Backups)

**OP Hub built (sessions D-1 through D-7):**
- 6 SQLite tables: jobs, job_change_orders, client_updates, time_import_batches, time_entries, invoices, payments
- Convert quote → job, mobile + desktop layouts
- Jibble CSV import + activity mapping per job (auto-applies on subsequent imports)
- Client update generator (bilingual HTML + PDF via Playwright)
- Change orders (mini-quote addendums with approval workflow)
- Invoice generator (editable draft from quote + change orders + time entries)
- Payment recording with finance Google Sheet sync (writes Contract Revenue rows)
- DB backup download endpoint at /api/backup/download

**Service account:** op-hub-bot@osteopeinture-finance.iam.gserviceaccount.com — has writer access to backup folder and finance sheet.

**Railway env vars set:** GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_SHEET_ID, DB_BACKUP_FOLDER_ID, ANTHROPIC_API_KEY

**KNOWN ISSUE — Backup mechanism unresolved:**
Service accounts cannot write to personal Google Drive (consumer accounts). Auto-backup to Drive via the service account fails with "no storage quota." Workaround: manual backup via GET /api/backup/download. Long-term fix: Postgres or different storage approach. See `docs/SESSION-PROMPT-DATA-LAYER.md` for the data layer discussion.

**Backtracked opening balances (Apr 6, 2026 10:30pm):**
- RBC: implied Jan 1 opening = $5,083.52 (sheet has $185.20 — off by $4,898 = 2025 activity)
- BMO MC: implied Jan 1 opening = -$4,602.87 (sheet has -$8,085.27 — off by $3,482)
- Cash: pending — Loric to provide tomorrow
- These assume all 2026 transactions are correctly captured in the sheet

**Current state of finance sheet:**
- 155 transactions, all reports working
- Write contract columns (K-N) added + backfilled
- ITC formula fixed
- Cash Movement on Dashboard
- GST/QST archive + quarterly instalment tracker (with paid? dropdowns, total outstanding)
- Net Income (after ITC recovery) row in Monthly P&L
- Opening balances still wrong (2024 not 2025) — backtrack done above

**What's left on master plan:**
- Fix opening balances (use backtracked values OR validate vs corrected 2025 ledger)
- Enter Jan/Feb cash transactions (Loric dictation)
- D-8 hardening (after using app with real data)
- Chat interface (6 sessions, last priority)

**Next session:**
1. Get cash balance from Loric → backtrack final opening balance
2. Decide: use backtracked values or wait for 2025 ledger correction
3. Update opening balances in finance sheet
4. Test OP Hub end-to-end with LACHANCE_01 (convert → invoice → payment)
