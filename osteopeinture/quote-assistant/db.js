/**
 * db.js — Postgres connection pool wrapper for OP Hub.
 *
 * Exposes get/all/run/transaction helpers that accept SQLite-style `?`
 * placeholders (auto-converted to Postgres `$1, $2, ...`). This lets
 * the call sites in server.js keep their original SQL strings unchanged
 * from the SQLite era — only the function call pattern changes:
 *
 *   BEFORE: db.prepare('SELECT * FROM x WHERE id = ?').get(id)
 *   AFTER:  await db.get('SELECT * FROM x WHERE id = ?', [id])
 *
 * Connection: uses DATABASE_URL env var (Supabase Session Pooler).
 * SSL: required for Supabase, rejectUnauthorized: false for pooler.
 *
 * ROLLBACK: if Supabase doesn't work out, swap server.sqlite.js back
 * to server.js and redeploy. The SQLite archive is kept in the repo.
 */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

/** Replace SQLite `?` placeholders with Postgres `$1, $2, ...` */
function pgify(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/** SELECT ... → first row or null */
async function get(sql, params = []) {
  const { rows } = await pool.query(pgify(sql), params);
  return rows[0] || null;
}

/** SELECT ... → array of rows */
async function all(sql, params = []) {
  const { rows } = await pool.query(pgify(sql), params);
  return rows;
}

/** INSERT / UPDATE / DELETE → result object */
async function run(sql, params = []) {
  return pool.query(pgify(sql), params);
}

/**
 * Run multiple queries inside a single Postgres transaction.
 *
 *   await db.transaction(async (tx) => {
 *     await tx.run('DELETE FROM payments WHERE job_id = ?', [jobId]);
 *     await tx.run('DELETE FROM time_entries WHERE job_id = ?', [jobId]);
 *   });
 *
 * On error: auto-ROLLBACK + rethrow. On success: auto-COMMIT.
 */
async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tx = {
      get: async (sql, params = []) => {
        const { rows } = await client.query(pgify(sql), params);
        return rows[0] || null;
      },
      all: async (sql, params = []) => {
        const { rows } = await client.query(pgify(sql), params);
        return rows;
      },
      run: async (sql, params = []) => {
        return client.query(pgify(sql), params);
      },
    };
    await fn(tx);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Expose the raw pool for edge cases (e.g., test teardown) */
function getPool() {
  return pool;
}

module.exports = { get, all, run, transaction, getPool, pgify };
