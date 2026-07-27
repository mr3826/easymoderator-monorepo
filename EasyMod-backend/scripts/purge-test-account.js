#!/usr/bin/env node
/**
 * Purge a test/QA account and everything it exclusively owns.
 *
 * Written for the launch-readiness audit, which left `qa.audit.*@easymod-qa.test`
 * behind on production. Hand-listing the ~45 entity tables would rot the moment
 * someone adds one, so the scope is derived from the database's own foreign-key
 * graph at run time: roots are resolved first, dependent rows are collected to a
 * fixpoint, then rows are deleted children-first in topological order.
 *
 * Safety properties, in order of importance:
 *
 *  - `users`, `shops` and `tenants` are ROOT-ONLY. Their scope is fixed by the
 *    resolution step and never grown by FK expansion, so a shared tenant can
 *    never drag another merchant's user or shop into the delete set.
 *  - A shop with any member other than the target user is skipped entirely.
 *  - A tenant is only in scope when every one of its shops is in scope.
 *  - Audit/compliance tables are retained: their reference to the account is
 *    nulled (the columns are nullable by design) so the record survives without
 *    pointing at a deleted row.
 *  - Dry run is the default. `PURGE_MODE=APPLY` is required to write anything,
 *    and everything runs in one transaction that rolls back on any error.
 *  - Aborts if the delete set exceeds MAX_ROWS — a mis-resolved root shows up as
 *    an implausible row count rather than as data loss.
 *
 * Usage (inside the backend container):
 *   PURGE_EMAIL=someone@example.test PURGE_MODE=DRY_RUN node scripts/purge-test-account.js
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Resolved from cwd rather than __dirname so the script behaves the same whether
// it is run as a file or piped into `node` over stdin (which is how the workflow
// invokes it, to avoid needing a rebuilt image).
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');

const EMAIL = process.env.PURGE_EMAIL;
const MODE = process.env.PURGE_MODE === 'APPLY' ? 'APPLY' : 'DRY_RUN';
const MAX_ROWS = Number(process.env.PURGE_MAX_ROWS || 20000);

// Scope is fixed during resolution; FK expansion must never add to these.
const ROOT_ONLY = new Set(['users', 'shops', 'tenants']);

// Regulatory / audit trails: keep the row, drop the link. Every FK column these
// tables use to reference a user or shop is nullable by design (system jobs have
// no user or shop context), so nulling is always available here.
const RETAIN = new Set(['audit_logs', 'policy_decisions', 'meta_data_deletion_requests']);

function sslConfig() {
  const dbSsl = String(process.env.DB_SSL || '').toLowerCase();
  if (dbSsl !== 'true' && dbSsl !== '1') return false;
  return { rejectUnauthorized: String(process.env.ALLOW_SELF_SIGNED_TLS || '').toLowerCase() !== 'true' };
}

const ident = (name) => `"${String(name).replace(/"/g, '""')}"`;

/** Single-column foreign keys in the public schema, with the child's nullability. */
async function loadForeignKeys(db) {
  const { rows } = await db.query(`
    SELECT cl.relname  AS child_table,
           ca.attname  AS child_column,
           ca.attnotnull AS child_not_null,
           pl.relname  AS parent_table,
           pa.attname  AS parent_column
    FROM pg_constraint c
    JOIN pg_class cl      ON cl.oid = c.conrelid
    JOIN pg_namespace cn  ON cn.oid = cl.relnamespace AND cn.nspname = 'public'
    JOIN pg_class pl      ON pl.oid = c.confrelid
    JOIN pg_attribute ca  ON ca.attrelid = c.conrelid  AND ca.attnum = c.conkey[1]
    JOIN pg_attribute pa  ON pa.attrelid = c.confrelid AND pa.attnum = c.confkey[1]
    WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1
  `);
  return rows;
}

/** Single-column primary keys, by table. Tables without one are reported, not guessed at. */
async function loadPrimaryKeys(db) {
  const { rows } = await db.query(`
    SELECT cl.relname AS table_name,
           a.attname  AS pk_column,
           count(*) OVER (PARTITION BY cl.relname) AS pk_columns
    FROM pg_index i
    JOIN pg_class cl     ON cl.oid = i.indrelid
    JOIN pg_namespace n  ON n.oid = cl.relnamespace AND n.nspname = 'public'
    JOIN pg_attribute a  ON a.attrelid = cl.oid AND a.attnum = ANY(i.indkey)
    WHERE i.indisprimary
  `);
  const pk = new Map();
  for (const row of rows) {
    if (Number(row.pk_columns) === 1) pk.set(row.table_name, row.pk_column);
  }
  return pk;
}

/** Resolve the user, the shops they exclusively own, and any fully-owned tenants. */
async function resolveRoots(db) {
  const user = await db.query('SELECT id FROM users WHERE lower(email) = lower($1)', [EMAIL]);
  if (user.rows.length === 0) return null;
  if (user.rows.length > 1) throw new Error('Email matched more than one user — refusing to guess');
  const userId = user.rows[0].id;

  const platform = await db.query('SELECT platform_role FROM users WHERE id = $1', [userId]);
  const role = platform.rows[0]?.platform_role;
  if (role && role !== 'NONE') {
    throw new Error(`Refusing to purge an account holding platform_role=${role}`);
  }

  const memberOf = await db.query('SELECT DISTINCT shop_id FROM user_shops WHERE user_id = $1', [userId]);
  const candidateShopIds = memberOf.rows.map((r) => r.shop_id);

  const shopIds = [];
  const sharedShopIds = [];
  for (const shopId of candidateShopIds) {
    const others = await db.query(
      'SELECT count(*)::int AS n FROM user_shops WHERE shop_id = $1 AND user_id <> $2',
      [shopId, userId]
    );
    if (others.rows[0].n === 0) shopIds.push(shopId);
    else sharedShopIds.push(shopId);
  }

  // A tenant only goes in scope when every shop under it is in scope.
  const tenantIds = [];
  if (shopIds.length > 0) {
    const tenants = await db.query('SELECT DISTINCT tenant_id FROM shops WHERE id = ANY($1)', [shopIds]);
    for (const { tenant_id: tenantId } of tenants.rows) {
      const outside = await db.query(
        'SELECT count(*)::int AS n FROM shops WHERE tenant_id = $1 AND NOT (id = ANY($2))',
        [tenantId, shopIds]
      );
      if (outside.rows[0].n === 0) tenantIds.push(tenantId);
    }
  }

  return { userId, shopIds, sharedShopIds, tenantIds };
}

/**
 * FK edges the scope is allowed to travel along.
 *
 * Excluding ROOT_ONLY children is the safety property that matters: without it,
 * `shops.tenant_id -> tenants.id` run backwards would pull every shop under a
 * shared tenant into the delete set, and `users` would follow from there.
 */
function expandableForeignKeys(fks) {
  return fks.filter(
    (fk) => !ROOT_ONLY.has(fk.child_table) && !RETAIN.has(fk.child_table) && fk.child_table !== fk.parent_table
  );
}

/** Grow the delete set along FK edges until nothing new appears. */
async function collectScope(db, fks, pks, roots) {
  const scope = new Map([
    ['users', new Set([roots.userId])],
    ['shops', new Set(roots.shopIds)],
    ['tenants', new Set(roots.tenantIds)],
  ]);

  const expandable = expandableForeignKeys(fks);

  for (let pass = 0; pass < 20; pass += 1) {
    let grew = false;

    for (const fk of expandable) {
      const parentIds = scope.get(fk.parent_table);
      if (!parentIds || parentIds.size === 0) continue;

      const pk = pks.get(fk.child_table);
      if (!pk) {
        throw new Error(`${fk.child_table} has no single-column primary key — cannot scope it safely`);
      }

      const { rows } = await db.query(
        `SELECT ${ident(pk)} AS id FROM ${ident(fk.child_table)} WHERE ${ident(fk.child_column)} = ANY($1)`,
        [[...parentIds]]
      );

      const childIds = scope.get(fk.child_table) || new Set();
      const before = childIds.size;
      for (const row of rows) childIds.add(row.id);
      if (childIds.size > before) grew = true;
      scope.set(fk.child_table, childIds);
    }

    if (!grew) return scope;
  }

  throw new Error('Scope did not converge in 20 passes — aborting rather than deleting a guess');
}

/** Children before parents. Self-edges are ignored; a cycle aborts the run. */
function topologicalOrder(tables, fks) {
  const inScope = new Set(tables);
  const dependsOn = new Map([...inScope].map((t) => [t, new Set()]));

  for (const fk of fks) {
    if (fk.child_table === fk.parent_table) continue;
    if (!inScope.has(fk.child_table) || !inScope.has(fk.parent_table)) continue;
    dependsOn.get(fk.parent_table).add(fk.child_table);
  }

  const order = [];
  const done = new Set();
  while (order.length < inScope.size) {
    const ready = [...inScope].filter((t) => !done.has(t) && [...dependsOn.get(t)].every((c) => done.has(c)));
    if (ready.length === 0) {
      throw new Error(`Foreign-key cycle among: ${[...inScope].filter((t) => !done.has(t)).join(', ')}`);
    }
    for (const table of ready.sort()) {
      order.push(table);
      done.add(table);
    }
  }
  return order;
}

/**
 * Conversation attachments are stored per shop
 * (uploads/conversation-attachments/<shopId>/), so a shop directory is safe to
 * remove wholesale. Invoice PDFs live in one flat directory shared by every
 * merchant and are only reachable through the invoice rows just deleted, so they
 * are reported rather than pattern-matched — guessing at filenames there risks
 * deleting another shop's invoice.
 */
function purgeShopUploads(shopIds) {
  const removed = [];
  for (const shopId of shopIds) {
    const dir = path.join(UPLOADS_DIR, 'conversation-attachments', shopId);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).length;
    fs.rmSync(dir, { recursive: true, force: true });
    removed.push({ dir: `conversation-attachments/${shopId}`, files });
  }
  return { removed, note: 'uploads/invoices is shared and flat — not swept by shop id' };
}

async function main() {
  if (!EMAIL) throw new Error('PURGE_EMAIL is required');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: sslConfig() });
  await db.connect();

  try {
    const roots = await resolveRoots(db);
    if (!roots) {
      console.log(JSON.stringify({ mode: MODE, found: false, message: 'No user with that email — nothing to purge' }));
      return;
    }

    const fks = await loadForeignKeys(db);
    const pks = await loadPrimaryKeys(db);
    const scope = await collectScope(db, fks, pks, roots);

    // Retained tables: count what points at the roots so it can be nulled.
    const retainPlan = [];
    for (const fk of fks) {
      if (!RETAIN.has(fk.child_table)) continue;
      const parentIds = scope.get(fk.parent_table);
      if (!parentIds || parentIds.size === 0) continue;
      const { rows } = await db.query(
        `SELECT count(*)::int AS n FROM ${ident(fk.child_table)} WHERE ${ident(fk.child_column)} = ANY($1)`,
        [[...parentIds]]
      );
      if (rows[0].n > 0) {
        retainPlan.push({ ...fk, count: rows[0].n, nullable: !fk.child_not_null });
      }
    }

    const blocked = retainPlan.filter((r) => !r.nullable);
    if (blocked.length > 0) {
      throw new Error(
        `Retained tables reference the account through NOT NULL columns: ${blocked
          .map((b) => `${b.child_table}.${b.child_column}`)
          .join(', ')}`
      );
    }

    const populated = [...scope.entries()].filter(([, ids]) => ids.size > 0);
    const order = topologicalOrder(populated.map(([t]) => t), fks);
    const plan = order.map((table) => ({ table, rows: scope.get(table).size }));
    const totalRows = plan.reduce((sum, p) => sum + p.rows, 0);

    const report = {
      mode: MODE,
      found: true,
      shopsInScope: roots.shopIds.length,
      sharedShopsSkipped: roots.sharedShopIds.length,
      tenantsInScope: roots.tenantIds.length,
      totalRows,
      deletePlan: plan,
      retainAnonymise: retainPlan.map((r) => ({ table: r.child_table, column: r.child_column, rows: r.count })),
    };

    if (totalRows > MAX_ROWS) {
      throw new Error(`Delete set of ${totalRows} rows exceeds PURGE_MAX_ROWS=${MAX_ROWS} — refusing`);
    }
    if (roots.sharedShopIds.length > 0) {
      console.log('NOTE: shops with other members were left untouched.');
    }

    if (MODE === 'DRY_RUN') {
      console.log(JSON.stringify({ ...report, applied: false }, null, 2));
      return;
    }

    await db.query('BEGIN');
    try {
      for (const r of retainPlan) {
        await db.query(
          `UPDATE ${ident(r.child_table)} SET ${ident(r.child_column)} = NULL WHERE ${ident(r.child_column)} = ANY($1)`,
          [[...scope.get(r.parent_table)]]
        );
      }

      const deleted = [];
      for (const { table } of plan) {
        const res = await db.query(
          `DELETE FROM ${ident(table)} WHERE ${ident(pks.get(table))} = ANY($1)`,
          [[...scope.get(table)]]
        );
        deleted.push({ table, rows: res.rowCount });
      }

      const stillThere = await db.query('SELECT count(*)::int AS n FROM users WHERE lower(email) = lower($1)', [EMAIL]);
      if (stillThere.rows[0].n !== 0) throw new Error('User row survived the purge — rolling back');

      await db.query('COMMIT');

      // Files last: they are not transactional, so only touch them once the
      // rows they belong to are definitively gone.
      const uploads = purgeShopUploads(roots.shopIds);

      console.log(JSON.stringify({ ...report, applied: true, deleted, uploads }, null, 2));
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  } finally {
    await db.end();
  }
}

// Exported for scripts/__tests__/purge-test-account.test.js; the CLI path below
// only runs when this file is executed directly.
module.exports = { topologicalOrder, expandableForeignKeys, ROOT_ONLY, RETAIN };

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
