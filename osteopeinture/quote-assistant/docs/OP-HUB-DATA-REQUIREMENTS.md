# OP Hub — Data Layer Requirements Brief

*For deciding the right data storage approach (SQLite vs Postgres vs other). Feeds into the broader MOKSHA data layer discussion.*

---

## What OP Hub needs to store

### Tables (current SQLite schema)
- **sessions** — quote conversations + quote JSON (existing, ~5-20 rows expected)
- **jobs** — active painting jobs (3-5 active at a time, ~20-40/year)
- **job_change_orders** — approved extras per job (0-5 per job)
- **time_import_batches** — log of Jibble CSV imports (4-8 per active job)
- **time_entries** — individual time records from Jibble (~100-500 per active job)
- **job_activity_mappings** — Jibble activity → client label per job (~10-20 per job)
- **client_updates** — generated weekly updates (4-12 per active hourly job)
- **invoices** — final invoices (1-3 per job — quote, revised quote, final)
- **payments** — payment records (5-10 per job)

### Data volume projections
| Period | Total rows across all tables |
|--------|------------------------------|
| Year 1 | ~5,000–10,000 rows |
| Year 3 | ~20,000–40,000 rows |
| Year 5 | ~50,000–100,000 rows |

This is **small data** by any database standard. SQLite handles millions of rows fine. Volume is not the constraint — durability and ergonomics are.

---

## Critical requirements

### 1. Durability — DATA MUST NOT BE LOST
Already lost data once on a Railway deploy. The current SQLite-on-volume setup is fragile because:
- Railway can reset the volume if the service config changes
- No automated off-host backup (Drive backup doesn't work for service accounts on consumer Drive)
- Manual download is the only current safety net

**Required:** Data persists through deploys, infrastructure changes, and accidental deletes.

### 2. Concurrent writes — LOW
Single user (Loric). No real concurrency needs. SQLite handles this easily.

### 3. Read patterns
- Job dashboard: 1-2 queries per page load (jobs list + summary)
- Job detail: 5-10 queries (job + payments + time entries + mappings + change orders)
- Client update generation: 1 aggregation query (sum minutes by activity)
- Invoice generation: 3-4 queries (job + change orders + time entries + payments)
- Sheet sync on payment: 1 write per payment

Negligible load. Any database handles this.

### 4. Backup + restore
- **Required:** automated daily off-host backup
- **Required:** ability to restore from backup if data is lost
- **Nice-to-have:** point-in-time recovery
- **Nice-to-have:** version history (see how a row changed over time)

### 5. Migrations
- Schema changes happen as features evolve (already had to add change_orders + client_updates tables)
- **Required:** safe schema migrations that don't break existing data
- **Nice-to-have:** rollback if a migration goes wrong

### 6. Multi-environment
- Currently: only production (one Railway service)
- **Future:** may want a staging/dev environment to test changes without touching live data
- **Nice-to-have:** ability to copy production → dev for testing

### 7. Observability
- **Current:** Logger.log statements in Apps Script, console.log in Node
- **Nice-to-have:** queryable history of writes, who/what wrote what when
- **Nice-to-have:** the write contract (entry_id, source_system, source_id, created_at) already exists for the finance sheet — same pattern should apply to OP Hub

---

## Integration requirements

### Outbound writes
- **Finance Google Sheet** — payments sync as Contract Revenue rows. Already working via service account.
- **Future:** could sync invoices, client updates to Drive folders (PDFs)

### Inbound writes
- **Currently none** — OP Hub is the only writer to its own data
- **Future:** the finance chat interface might write to OP Hub if it manages job-related transactions

### Sync direction
The finance sheet is the **accounting source of truth**. OP Hub is the **operational source of truth** (jobs, time, invoices, payments). Payment is the bridge — it lives in both places.

---

## Constraints

### Budget
- Currently on Railway Hobby tier (~$5-10/mo for 4 services)
- Postgres on Railway adds ~$5/mo
- Total budget tolerance: ~$30/mo across all MOKSHA tools

### Builder
- Loric is non-developer
- Maintenance must be minimal — set it and forget it
- Migrations should be obvious or automated
- Backup/restore must be 1-click from a UI or CLI

### Existing investment
- ~2,200 lines of Node.js code already using `better-sqlite3`
- Migration to a different DB should be incremental, not a rewrite
- The SQL is mostly ANSI — would port to Postgres with minor changes

---

## Specific failure modes to avoid

1. **Lost data on deploy** — happened once. Cannot happen again.
2. **Schema drift** — features added without migrations cause "no such table" errors. Almost happened with `job_change_orders`.
3. **Untracked manual edits** — if Loric edits the DB directly, no audit trail
4. **Slow cold starts** — Railway services that have to reconnect to a remote DB on every startup add latency
5. **Vendor lock-in** — pick something portable, not a proprietary cloud DB

---

## The 3 realistic options

### Option A: SQLite with proper backup pipeline
- Keep `better-sqlite3`, no code changes
- Add automated backup to S3/Backblaze/Cloudflare R2 (NOT Drive — service accounts can't write to consumer Drive)
- Add restore-on-startup logic
- Cost: ~$0-2/mo for object storage
- **Pro:** zero migration, cheap, fast, file-based
- **Con:** still single-host, recovery requires manual restore

### Option B: Postgres on Railway
- Migrate `better-sqlite3` calls to `pg` npm package
- Connect via `DATABASE_URL` env var
- Railway handles backups (paid feature on Hobby/Pro)
- Cost: ~$5/mo extra
- **Pro:** truly persistent, separate from app deploys, real backups, real migrations, observability
- **Con:** code changes (~200 lines), additional service to manage

### Option C: Supabase (hosted Postgres + extras)
- Same as Postgres but with a UI dashboard, auth, storage, real-time
- Free tier covers our scale
- **Pro:** UI for browsing data, free tier, hosted backups
- **Con:** another service account to manage, vendor dependency

---

## What I'd recommend going in

For **OP Hub specifically** at this scale, with Loric as the only user:

**Option A (SQLite + proper backup) is sufficient if** we can solve the off-host backup reliably. The data volume is tiny, the user is single, the queries are simple. The only real risk is durability — fix that and SQLite is fine.

**Option B (Railway Postgres) is the right call if** we want a clean separation between code deploys and data, want native backups without writing custom code, and are OK paying $5/mo for peace of mind.

**Option C (Supabase) is overkill** unless we want the dashboard for browsing data without writing queries, OR if other MOKSHA builds will benefit from sharing one Postgres instance.

The decision depends on a question I can't answer alone:
**How much does $5/mo and ~3 hours of migration work cost vs the value of never thinking about data durability again?**

---

## Questions for the data layer session

1. **Budget tolerance:** Is $5/mo for Postgres acceptable? Or do we want to keep it free?
2. **Maintenance preference:** Do you want a dashboard to browse data (Supabase) or are CLI/code-only fine (raw Postgres)?
3. **Future MOKSHA builds:** If we standardize on one approach, will the others (FIDELIO TOA, finance chat, future client tools) use the same pattern? If yes, that argues for a more robust choice.
4. **Migration tolerance:** Are you OK with a 2-3 session migration to Postgres, or do you want zero changes to the working code?
5. **Backup frequency:** Daily? Hourly? On every write? (Each has different cost/complexity tradeoffs.)

---

*Written 2026-04-07 for the data layer decision session. See also: `docs/SESSION-PROMPT-DATA-LAYER.md` for the broader MOKSHA discussion.*
