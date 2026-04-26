# JOURNAL — OstéoPeinture Finance System

Append-only session log. For current state and business rules, see CONTEXT.md.

---

## Status as of 2026-04-05

### What's in the Live Sheet
- **155 rows in Transactions** — 5 opening balances (WRONG — see CONTEXT.md) + 98 bank imports (RBC + BMO, auto-categorized) + 21 bank mirrors + 18 cash entries + 13 cash mirrors
- **14 rows in Wages** — Edler, Yann, Fred (Jan–Apr 2026, migrated from old sheet)
- **Per-Job P&L live:** CHAUT_01 ($29,290 rev / $24,605 net), KENNERKNECHT_01 ($15,000 rev / $13,380 net), ADAMS_01 ($1,000 deposit)
- **Monthly P&L working** — Jan–Mar broken down by category
- **Owner Balances:** Loric $7,489, Graeme $10,200, Lubo $10,200, Boss $2,750

### What's Built
- All 13 tabs live with correct formulas (ITC fixed — was SUMPRODUCT(…,0) bug)
- **Write contract columns** (K–N) on Transactions: entry_id, source_system, source_id, created_at — all 155 rows backfilled, columns hidden
- **Cash Movement section** on Dashboard: starting balance → revenue → expenses by category → ending balance (auto-updates monthly)
- **GST/QST archive** on Tracker tab: 2023-2025 history, 2026 quarterly instalment schedule ($3,008/quarter), unpaid 2025 balances flagged, payment log
- **Supplies gap analysis completed**: $35,819 gap = ~$8.4K tax (23%) + ~$3.5K inventory (10%) + ~$5-8K non-job purchases (15-22%) + ~$16-19K underestimation (45-53%). Policy: overestimate consumables per job going forward.
- `create-sheet.gs` — tab builder + `addBossOwner()` fixup (in repo + pushed to Apps Script)
- `import-csv.gs` — bank CSV importer with French header support, BOM stripping, YYYYMMDD dates, pre-2026 filter, dedup on date+amount+account
- `mirror-entries.py` — double-entry mirror generator for all Transfer-category rows
- `autocat-rules.json` — keyword-to-category lookup from Tiller AutoCat
- `cash-entry-sidebar.gs` + `sidebar.html` — pushed to Apps Script
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

### Priority Order for Next Session
1. Fix opening balances — when Loric confirms 2025 ledger is final
2. Enter remaining cash transactions — Jan/Feb cash + DUFRESNE_01 revenue
3. Fix GST/QST ITC formula — minor, expenses showing 0
4–6. Job Management build (8 sessions) — see `docs/OP-JOB-MANAGEMENT-SPEC.md`
7. Rebuild GST/QST Tracker
8. Reconcile supplies/consumables gap
9. Build conversational interface — Session 1: scaffold + deploy
10. Cash Movement on Dashboard
