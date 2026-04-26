# SUPABASE MIGRATION SPEC
# OP Hub: SQLite → Supabase (Postgres)
# Last updated: April 8, 2026
# Status: SPEC ONLY — migration not started

---

## DECISION

Confirmed: migrate from SQLite on Railway volume to **Supabase free tier (hosted Postgres)**.

Why:
- Railway volume deploys have already wiped the SQLite DB once
- Service accounts can't back up to personal Google Drive (known blocker)
- Supabase free tier includes automated daily backups — solves the backup gap entirely
- Postgres is the right default for every future MOKSHA hub tool (M2 OP Hub, M7 CRM, FDL builds, etc.) — one skill, reused
- Free tier is comfortably sized for OP Hub (see "Free tier limits" below)
- Migration is small because SQLite and Postgres share ~95% of syntax and the app uses a thin `better-sqlite3` wrapper

---

## 1. CURRENT STATE

### Where the DB lives today
- **File:** `/data/sessions.db` (Railway persistent volume)
- **Engine:** `better-sqlite3` ^9.6.0
- **Access pattern:** synchronous `db.prepare(...).run() / .get() / .all()` calls from `server.js`
- **Call sites:** ~53 `db.prepare()` invocations throughout `server.js`
- **Schema DDL:** inlined at the top of `server.js` (lines ~139–311) as `db.exec('CREATE TABLE IF NOT EXISTS ...')` blocks

### Tables (9 total)

| Table | Purpose | Notable columns |
|---|---|---|
| `sessions` | Quote chat sessions | id, client_name, project_id, total_amount, status, messages (JSON), quote_json (JSON), email_meta (JSON), converted_job_id |
| `jobs` | Jobs created from converted quotes | id, quote_session_id, job_number (UNIQUE), client info, quote_subtotal_cents, quote_tax_cents, quote_total_cents, accepted_quote_json |
| `job_activity_mappings` | Jibble activity → client-facing label map, per job | id, job_id, source_activity_name, phase_code, client_label_en/fr, billable, sort_order, UNIQUE(job_id, source_activity_name) |
| `time_import_batches` | Each Jibble CSV import | id, job_id, file_name, row counts |
| `time_entries` | Individual time rows from Jibble | id, batch_id, job_id, external_row_key (UNIQUE), employee_name, mapping_status, duration_minutes, raw_row_json |
| `job_change_orders` | Change orders on a job | id, job_id, title_en/fr, amount_cents, taxable, status |
| `client_updates` | Generated client progress updates (bilingual HTML + PDF) | id, job_id, sequence_no, language, period_start/end, summary_json, html_snapshot, UNIQUE(job_id, sequence_no) |
| `invoices` | Generated invoices | id, job_id, invoice_number (UNIQUE), invoice_type, language, subtotal/tax/total/balance_due cents, invoice_json |
| `payments` | Payment records + finance sync status | id, job_id, invoice_id, payment_date, amount_cents, method, finance_sync_status, finance_synced_at |

Plus one `ALTER TABLE sessions ADD COLUMN email_meta TEXT` migration wrapped in a try/catch.

### Row counts
Unknown until export time. OP Hub is in low-volume early use (handful of sessions, one LACHANCE_01 job). Volume is negligible — migration will not be constrained by data size.

### Schema characteristics that matter for Postgres
- All IDs are `TEXT PRIMARY KEY` (UUIDs, not AUTOINCREMENT integers) — **trivial to port**, Postgres `TEXT` works identically
- All timestamps stored as ISO strings in `TEXT` columns — **ports cleanly**, no `DATETIME`/`TIMESTAMP` casting needed
- Money stored as `INTEGER cents` — **ports cleanly**, Postgres `INTEGER` is identical
- JSON stored as `TEXT` and manually `JSON.parse()`'d in app code — **can keep as TEXT** for zero-risk migration, or upgrade to `JSONB` later
- No foreign key CASCADE — the app manages cleanup manually (see `DELETE /api/jobs/:id` transaction). Keep as-is.
- No stored procedures, triggers, or views. Pure tables + application logic.

---

## 2. SUPABASE SETUP STEPS

### 2a. Create Supabase project
1. Sign in at `https://supabase.com` (Loric's existing account or create one)
2. New project → name: `osteopeinture-op-hub` → region: closest to Railway (likely `ca-central-1` or `us-east-1`)
3. Set a strong DB password (store in 1Password or Loric's password manager)
4. Wait for project to provision (~2 minutes)

### 2b. Get connection string
From Supabase dashboard → Project Settings → Database → Connection String → **URI** tab:
```
postgres://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
```

**Important:** use the **pooler** connection string (port 6543), not the direct connection (port 5432). Railway containers are stateless and reconnect frequently — the pooler handles connection recycling.

### 2c. Add as Railway env var
On the `quote-assistant` Railway service:
```
DATABASE_URL=postgres://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
```

Keep the current `DATA_DIR=/data` env var during the migration for rollback purposes (see Rollback Plan below).

### 2d. Run schema creation
Apply the 9 `CREATE TABLE` statements from `server.js` (lines ~139–311) directly via Supabase SQL Editor, adjusted for Postgres:
- Change `INTEGER` → `INTEGER` (same)
- Change `TEXT` → `TEXT` (same)
- Change `REAL` → `DOUBLE PRECISION` (sessions.total_amount only)
- Remove `DEFAULT '[]'` from TEXT JSON columns if Postgres complains — use `DEFAULT '[]'::text`
- Keep `PRIMARY KEY`, `UNIQUE`, `NOT NULL` as-is (identical syntax)

---

## 3. CODE CHANGES REQUIRED

### 3a. Package swap
```diff
- "better-sqlite3": "^9.6.0"
+ "pg": "^8.11.0"
```
Also remove any `sharp`/`playwright` native build concerns related to SQLite bindings in the Dockerfile (there shouldn't be any left, but verify during migration).

### 3b. Database connection wrapper
Replace the synchronous `better-sqlite3` init with an async `pg.Pool`:

```js
// BEFORE
const Database = require('better-sqlite3');
const db = new Database(path.join(DATA_DIR, 'sessions.db'));
db.exec('CREATE TABLE IF NOT EXISTS ...');

// AFTER
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
```

### 3c. Query syntax swap
The hard part: **53 call sites** use the synchronous `better-sqlite3` pattern:
```js
// SQLite (sync)
const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
db.prepare('INSERT INTO payments (...) VALUES (?, ?, ?)').run(a, b, c);
const rows = db.prepare('SELECT * FROM payments WHERE job_id = ?').all(jobId);
```

Postgres `pg` is async and uses `$1, $2` placeholders:
```js
// Postgres (async)
const { rows } = await pool.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
const row = rows[0];
await pool.query('INSERT INTO payments (...) VALUES ($1, $2, $3)', [a, b, c]);
const { rows } = await pool.query('SELECT * FROM payments WHERE job_id = $1', [jobId]);
```

**Two viable approaches:**

**Approach A — thin compatibility shim (recommended)**
Write a `db.js` wrapper that exposes a synchronous-looking API backed by a connection pool + top-level await init. Problem: Node `better-sqlite3` is truly synchronous, Postgres cannot be. Every call site needs to become `async/await` or use `.then()`.

**Approach B — full async rewrite (cleaner, more work)**
Convert all 53 call sites to `await pool.query(...)`. Every route handler using `db` must become `async`. Transactions (there's one in `convertSessionToJob` and one in the new delete-job endpoint) need to wrap in `pool.connect()` + `BEGIN/COMMIT/ROLLBACK`.

**Recommendation: Approach B.** It's ~53 edits, each mechanical. Approach A creates a maintenance hazard (fake-sync wrapper that leaks promises on errors). Approach B is the right migration for a long-lived codebase.

### 3d. Transaction handling
Two places use `db.transaction()` (better-sqlite3's native transaction helper):
1. `convertSessionToJob` — already wrapped
2. `DELETE /api/jobs/:id` — added today, uses `db.transaction()`

Postgres equivalent:
```js
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('DELETE FROM payments WHERE job_id = $1', [jobId]);
  // ... more deletes
  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release();
}
```

### 3e. Estimated edit scope
- **Lines changed:** ~200–300 (53 call sites × ~4–5 lines each including making the parent function async)
- **Files touched:** `server.js` (primary), `package.json`, `Dockerfile` (remove SQLite native build if present)
- **New file:** `db.js` (connection pool module, ~30 lines)
- **Tests:** existing 14 tests in `tests/` — most will need `async` conversion or a test-DB setup. Plan ~1 session just for tests.

---

## 4. MIGRATION STEPS (day-of, in order)

### Step 1: Branch and schema
1. Create branch `supabase-migration`
2. Add `pg` dependency, remove `better-sqlite3`
3. Write `db.js` connection pool wrapper
4. Create tables in Supabase via SQL Editor (copy DDL from `server.js`, adjust as above)
5. Verify empty tables exist via Supabase dashboard

### Step 2: Convert code
6. Rewrite all 53 call sites to async `pool.query()` syntax
7. Make every route handler that touches the DB `async` (most already are due to Anthropic SDK calls)
8. Convert the 2 transactions to `BEGIN/COMMIT/ROLLBACK` pattern
9. Convert `ALTER TABLE sessions ADD COLUMN` safety wrapper to use Postgres `IF NOT EXISTS` (native support)
10. Update tests

### Step 3: Export SQLite → import Postgres
11. SSH into Railway or download the SQLite file locally via the existing `/api/backup/download` endpoint
12. Run a one-off Node script that reads each table from SQLite and inserts rows into Supabase via `pg`
13. Script handles: sessions, jobs, job_activity_mappings, time_import_batches, time_entries, job_change_orders, client_updates, invoices, payments (in that order, to respect implicit dependencies)
14. Verify row counts match on both sides

### Step 4: Local smoke test
15. Set `DATABASE_URL` in local `.env` pointing to Supabase
16. `npm start` locally, open browser, walk through: list sessions, open LACHANCE, convert to job, view job detail, record a test payment, check Supabase dashboard for the new row
17. `npm test` — all 14 tests pass

### Step 5: Deploy
18. Set `DATABASE_URL` as Railway env var on `quote-assistant` service
19. Keep `DATA_DIR=/data` for now (rollback safety)
20. `railway up`
21. Watch logs for connection errors, migration errors, 500s
22. Hit live URL, repeat the smoke-test flow

### Step 6: Verify + close out
23. Record one real payment in the live app, confirm it lands in Supabase AND in the finance Google Sheet
24. Monitor for 24–48 hours with real use
25. Once stable: delete `/data` volume contents, remove `DATA_DIR` env var, delete `better-sqlite3` / SQLite Dockerfile leftovers

---

## 5. ROLLBACK PLAN

If the deployment breaks and we need to revert fast:

### Fast path (code-level rollback)
1. `git revert` the migration commit(s) → `railway up`
2. Railway redeploys the old SQLite-backed build
3. The `/data` volume still has the pre-migration DB because we didn't wipe it
4. App is back in the pre-migration state within ~2 minutes

### Slow path (data recovery)
If the `/data` volume was wiped during the migration cycle:
1. Use the most recent backup from `GET /api/backup/download` (Loric must have run this before starting)
2. Re-upload the SQLite file to a fresh Railway volume OR import it into Supabase via the export script
3. Resume

### Golden rule before starting migration
**Run `GET /api/backup/download` immediately before the migration session and save the file locally.** That is the only guaranteed rollback point.

---

## 6. SUPABASE FREE TIER LIMITS — WHY THEY DON'T AFFECT US

Free tier specs (as of April 2026):
- **Database size:** 500 MB (OP Hub full dataset is well under 1 MB — we have room for 500,000x growth)
- **Bandwidth:** 5 GB/month egress
- **Rows:** Unlimited
- **Concurrent connections:** 60 (OP Hub has 1–3 users max)
- **Automated backups:** Daily, 7-day retention on free tier
- **Pause policy:** projects pause after **1 week of inactivity** — resume takes ~30 seconds on next request

### Why the pause policy doesn't matter for us
OP Hub is used **multiple times per week** by Loric (quoting, job tracking, payment recording). The "1 week of inactivity" threshold is never hit in practice. Worst case: after a vacation or a deploy-and-don't-test cycle, the first request after resuming takes ~30s longer than normal. That's the only user-visible effect.

If it ever becomes a problem, the paid tier is $25/mo and has no pause policy. We're nowhere near needing it.

---

## 7. ESTIMATED SESSION COUNT

| Session | Work | Time |
|---|---|---|
| 1 | Supabase project setup, schema creation in dashboard, `pg` dependency swap, `db.js` wrapper, connection pool | ~1 hour |
| 2 | Convert server.js call sites (batch 1: sessions, jobs, convertSessionToJob transaction) | ~1.5 hours |
| 3 | Convert server.js call sites (batch 2: payments, time entries, activity mappings, invoices, change orders, client updates, delete-job transaction) | ~1.5 hours |
| 4 | Update test suite to async pattern, run local smoke test | ~1 hour |
| 5 | Write + run SQLite → Postgres export script, verify row counts | ~1 hour |
| 6 | Deploy to Railway, live smoke test, monitor, cleanup | ~1 hour |

**Total: ~6 sessions / ~7 hours of focused work.**

Safe split: sessions 1 and 4–6 are short/low-risk, sessions 2–3 are the bulk of the mechanical edit work.

---

## 8. WHAT THIS UNLOCKS

After migration completes:
- ✅ No more data loss on deploy
- ✅ No more backup gap (Supabase handles it)
- ✅ Prerequisite cleared for **Phase 2: split into OP Quote + OP Hub as two apps** sharing the same DB
- ✅ Prerequisite cleared for **Module 7: Lead Intake + CRM** (needs leads table in shared DB)
- ✅ Supabase dashboard becomes a usable admin UI for direct data inspection without building admin screens
- ✅ Same pattern can be reused for every future MOKSHA build (template established)

---

## 9. WHAT THIS DOES NOT DO

- Does not fix the payment sync "fire-and-forget" gap in Module 4 — that's a Phase 1 code fix, independent of the DB layer
- Does not split the app into two URLs — that's Phase 2, after migration
- Does not add new features — this is a pure infrastructure upgrade
- Does not change how QUOTING_LOGIC.md is edited, the quote rendering pipeline, or any of the business logic
