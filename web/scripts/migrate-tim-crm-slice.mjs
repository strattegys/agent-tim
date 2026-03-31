#!/usr/bin/env node
/**
 * Copy Tim-owned CRM slice from a source Postgres to a target Postgres (same workspace schema).
 * Deletes existing rows on the target where _workflow.ownerAgent = 'tim', then inserts the slice
 * from the source (boards, packages, person rows for pipeline contacts, content items, workflows,
 * workflow items, artifacts). Does not touch other agents' workflows or unrelated people.
 *
 * From COMMAND-CENTRAL/web (PowerShell example):
 *
 *   # Source = bundled LOCALDEV CRM on the host; target = production over Tailscale
 *   $env:CRM_MIGRATE_SOURCE_HOST = "127.0.0.1"
 *   $env:CRM_MIGRATE_SOURCE_PORT = "25432"
 *   $env:CRM_MIGRATE_TARGET_HOST = "100.74.54.12"
 *   $env:CRM_MIGRATE_TARGET_PORT = "5432"
 *   # Password: same DB user password for both if identical
 *   $env:CRM_MIGRATE_SOURCE_PASSWORD = "..."
 *   $env:CRM_MIGRATE_TARGET_PASSWORD = "..."
 *   # Or set only CRM_DB_PASSWORD and omit *_PASSWORD for both
 *   npm run migrate:tim-crm-slice -- --dry-run
 *   npm run migrate:tim-crm-slice
 *
 * Flags: --dry-run (no writes on target), --owner tim (default)
 */

import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const { Pool } = require("pg");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.join(__dirname, "..");
const SCHEMA = process.env.CRM_DB_SEARCH_PATH || "workspace_9rc10n79wgdr0r3z6mzti24f6";

const OWNER = "tim";

function loadEnvLocal() {
  const fs = require("fs");
  const envPath = path.join(WEB_ROOT, ".env.local");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = val;
    }
  }
}

function poolConfig(role) {
  const prefix = role === "source" ? "CRM_MIGRATE_SOURCE_" : "CRM_MIGRATE_TARGET_";
  const host =
    process.env[`${prefix}HOST`] ||
    (role === "source" ? "127.0.0.1" : process.env.CRM_DB_TAILSCALE_HOST || "100.74.54.12");
  const port = parseInt(
    process.env[`${prefix}PORT`] ||
      (role === "source" ? process.env.CRM_DB_LOCAL_PORT || "25432" : "5432"),
    10
  );
  const password =
    process.env[`${prefix}PASSWORD`] || process.env.CRM_DB_PASSWORD || process.env.PGPASSWORD;
  const user = process.env[`${prefix}USER`] || process.env.CRM_DB_USER || "postgres";
  const database = process.env[`${prefix}NAME`] || process.env.CRM_DB_NAME || "default";
  if (!password) {
    throw new Error(
      `Set ${prefix}PASSWORD or CRM_DB_PASSWORD for ${role} database (and host/port if not default).`
    );
  }
  return { host, port, user, password, database, max: 2, connectionTimeoutMillis: 60000 };
}

async function withSchema(pool, fn) {
  const c = await pool.connect();
  try {
    await c.query(`SET search_path TO "${SCHEMA}", public`);
    return await fn(c);
  } finally {
    c.release();
  }
}

/** Writable columns only (omit stored generated columns like person.searchVector). */
async function insertableColumnMeta(client, table) {
  const { rows } = await client.query(
    `SELECT a.attname AS column_name, format_type(a.atttypid, a.atttypmod) AS pg_type
     FROM pg_attribute a
     JOIN pg_class c ON a.attrelid = c.oid
     JOIN pg_namespace n ON c.relnamespace = n.oid
     WHERE n.nspname = $1 AND c.relname = $2
       AND a.attnum > 0 AND NOT a.attisdropped
       AND (a.attgenerated IS NULL OR a.attgenerated = '')
     ORDER BY a.attnum`,
    [SCHEMA, table]
  );
  return rows;
}

/**
 * For json/jsonb columns, node-pg must receive a JS object/array or null — never a string,
 * or the driver may double-encode and Postgres rejects the parameter.
 */
function coerceForPg(val, pgType) {
  const t = (pgType || "").toLowerCase();
  if (val == null) return val;
  if (!t.includes("json")) return val;
  let v = Buffer.isBuffer(val) ? val.toString("utf8") : val;
  for (let i = 0; i < 10; i++) {
    if (typeof v !== "string") break;
    const s = v.trim();
    if (!s) return null;
    try {
      v = JSON.parse(s);
    } catch {
      throw new Error(
        `migrate: invalid JSON for json/jsonb column (first chars): ${s.slice(0, 120)}`
      );
    }
  }
  if (v == null) return null;
  if (typeof v === "object") return v;
  if (typeof v === "boolean" || typeof v === "number") return v;
  return v;
}

/** node-pg often lowercases keys; information_schema preserves "workflowId" casing. */
function valueForCol(row, col) {
  if (Object.prototype.hasOwnProperty.call(row, col)) return row[col];
  const k = Object.keys(row).find((x) => x.toLowerCase() === col.toLowerCase());
  return k !== undefined ? row[k] : undefined;
}

function pickRowCols(row, cols) {
  const o = {};
  for (const c of cols) {
    const v = valueForCol(row, c);
    o[c] = v === undefined ? null : v;
  }
  return o;
}

async function upsertRows(client, table, rows, keyCol = "id") {
  if (rows.length === 0) return 0;
  const meta = await insertableColumnMeta(client, table);
  const cols = meta.map((m) => m.column_name);
  const typeByCol = Object.fromEntries(meta.map((m) => [m.column_name, m.pg_type]));
  const dataCols = cols.filter((c) => c !== keyCol);
  const allCols = [keyCol, ...dataCols];
  let n = 0;
  for (const row of rows) {
    const pr = pickRowCols(row, cols);
    const values = allCols.map((c) => {
      const t = (typeByCol[c] || "").toLowerCase();
      if (t.includes("json")) {
        const j = coerceForPg(pr[c], typeByCol[c]);
        if (j == null) return null;
        return JSON.stringify(j);
      }
      return pr[c];
    });
    const placeholders = allCols
      .map((c, i) => {
        const t = (typeByCol[c] || "").toLowerCase();
        return t.includes("json") ? `$${i + 1}::jsonb` : `$${i + 1}`;
      })
      .join(", ");
    let sql;
    if (dataCols.length === 0) {
      sql = `INSERT INTO "${table}" ("${keyCol}") VALUES ($1) ON CONFLICT ("${keyCol}") DO NOTHING`;
    } else {
      const updates = dataCols.map((c) => `"${c}" = EXCLUDED."${c}"`).join(", ");
      sql = `INSERT INTO "${table}" (${allCols.map((c) => `"${c}"`).join(", ")})
        VALUES (${placeholders})
        ON CONFLICT ("${keyCol}") DO UPDATE SET ${updates}`;
    }
    await client.query(sql, values);
    n++;
  }
  return n;
}

async function fetchTimWorkflows(client, ownerLower) {
  const { rows } = await client.query(
    `SELECT * FROM "_workflow"
     WHERE LOWER(TRIM(COALESCE("ownerAgent", ''))) = $1`,
    [ownerLower]
  );
  return rows;
}

async function fetchSlice(client, workflows) {
  const wfIds = workflows.map((w) => w.id);
  if (wfIds.length === 0) return null;

  const { rows: items } = await client.query(
    `SELECT * FROM "_workflow_item" WHERE "workflowId" = ANY($1::uuid[])`,
    [wfIds]
  );
  const itemIds = items.map((i) => i.id);

  const { rows: artifacts } =
    itemIds.length > 0
      ? await client.query(`SELECT * FROM "_artifact" WHERE "workflowItemId" = ANY($1::uuid[])`, [
          itemIds,
        ])
      : { rows: [] };

  const boardIds = [...new Set(workflows.map((w) => w.boardId).filter(Boolean))];
  const packageIds = [...new Set(workflows.map((w) => w.packageId).filter(Boolean))];

  const personIds = [
    ...new Set(items.filter((i) => i.sourceType === "person").map((i) => i.sourceId)),
  ];
  const contentIds = [
    ...new Set(items.filter((i) => i.sourceType === "content").map((i) => i.sourceId)),
  ];

  const { rows: boards } =
    boardIds.length > 0
      ? await client.query(`SELECT * FROM "_board" WHERE id = ANY($1::uuid[])`, [boardIds])
      : { rows: [] };

  const { rows: packages } =
    packageIds.length > 0
      ? await client.query(`SELECT * FROM "_package" WHERE id = ANY($1::uuid[])`, [packageIds])
      : { rows: [] };

  const { rows: persons } =
    personIds.length > 0
      ? await client.query(`SELECT * FROM person WHERE id = ANY($1::uuid[])`, [personIds])
      : { rows: [] };

  const { rows: contents } =
    contentIds.length > 0
      ? await client.query(`SELECT * FROM "_content_item" WHERE id = ANY($1::uuid[])`, [contentIds])
      : { rows: [] };

  const companyIds = [
    ...new Set(
      persons
        .map((p) => valueForCol(p, "companyId") ?? p.companyId)
        .filter(Boolean)
    ),
  ];
  let companies = [];
  if (companyIds.length > 0) {
    const hasCompany = await client.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_name = 'company' AND table_type = 'BASE TABLE'
         AND table_schema NOT IN ('pg_catalog', 'information_schema') LIMIT 1`
    );
    if (hasCompany.rows.length > 0) {
      try {
        const { rows } = await client.query(`SELECT * FROM company WHERE id = ANY($1::uuid[])`, [
          companyIds,
        ]);
        companies = rows;
      } catch {
        companies = [];
      }
    }
  }

  return {
    workflows,
    items,
    artifacts,
    boards,
    packages,
    persons,
    contents,
    companies,
  };
}

async function deleteTimSlice(client, ownerLower) {
  const wfs = await fetchTimWorkflows(client, ownerLower);
  const wfIds = wfs.map((w) => w.id);
  if (wfIds.length === 0) {
    return { deletedWorkflows: 0, packageIds: [], boardIds: [] };
  }

  const packageIds = [...new Set(wfs.map((w) => w.packageId).filter(Boolean))];
  const boardIds = [...new Set(wfs.map((w) => w.boardId).filter(Boolean))];

  const { rows: itemRows } = await client.query(
    `SELECT id FROM "_workflow_item" WHERE "workflowId" = ANY($1::uuid[])`,
    [wfIds]
  );
  const itemIds = itemRows.map((r) => r.id);

  if (itemIds.length > 0) {
    await client.query(`DELETE FROM "_artifact" WHERE "workflowItemId" = ANY($1::uuid[])`, [
      itemIds,
    ]);
  }
  await client.query(`DELETE FROM "_workflow_item" WHERE "workflowId" = ANY($1::uuid[])`, [wfIds]);
  await client.query(`DELETE FROM "_workflow" WHERE id = ANY($1::uuid[])`, [wfIds]);

  for (const pid of packageIds) {
    await client.query(
      `DELETE FROM "_package" p WHERE p.id = $1
       AND NOT EXISTS (
         SELECT 1 FROM "_workflow" w WHERE w."packageId" = p.id
       )`,
      [pid]
    );
  }

  for (const bid of boardIds) {
    await client.query(
      `DELETE FROM "_board" b WHERE b.id = $1
       AND NOT EXISTS (
         SELECT 1 FROM "_workflow" w WHERE w."boardId" = b.id
       )`,
      [bid]
    );
  }

  return { deletedWorkflows: wfIds.length, packageIds, boardIds };
}

async function main() {
  loadEnvLocal();
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const ownerArg = argv.find((a) => a.startsWith("--owner="));
  const ownerLower = (ownerArg ? ownerArg.split("=")[1] : OWNER).trim().toLowerCase();

  const sourcePool = new Pool(poolConfig("source"));
  const targetPool = new Pool(poolConfig("target"));

  try {
    const slice = await withSchema(sourcePool, async (c) => {
      const wfs = await fetchTimWorkflows(c, ownerLower);
      console.log(`[source] workflows with ownerAgent=${ownerLower}: ${wfs.length}`);
      if (wfs.length === 0) {
        console.log("Nothing to migrate. Create Tim workflows on the source DB first.");
        return null;
      }
      return fetchSlice(c, wfs);
    });

    if (!slice) return;

    console.log(
      `[source] boards=${slice.boards.length} packages=${slice.packages.length} persons=${slice.persons.length} contentItems=${slice.contents.length} items=${slice.items.length} artifacts=${slice.artifacts.length} companies=${slice.companies.length}`
    );

    if (dryRun) {
      console.log("[dry-run] No changes on target.");
      return;
    }

    await withSchema(targetPool, async (tc) => {
      await tc.query("BEGIN");
      try {
        const cleared = await deleteTimSlice(tc, ownerLower);
        console.log(
          `[target] removed prior ${ownerLower} slice: workflows=${cleared.deletedWorkflows}`
        );

        if (slice.companies.length > 0) {
          const n = await upsertRows(tc, "company", slice.companies);
          console.log(`[target] upserted company rows: ${n}`);
        }
        if (slice.boards.length > 0) {
          const n = await upsertRows(tc, "_board", slice.boards);
          console.log(`[target] upserted _board rows: ${n}`);
        }
        if (slice.packages.length > 0) {
          const n = await upsertRows(tc, "_package", slice.packages);
          console.log(`[target] upserted _package rows: ${n}`);
        }
        if (slice.persons.length > 0) {
          const n = await upsertRows(tc, "person", slice.persons);
          console.log(`[target] upserted person rows: ${n}`);
        }
        if (slice.contents.length > 0) {
          const n = await upsertRows(tc, "_content_item", slice.contents);
          console.log(`[target] upserted _content_item rows: ${n}`);
        }
        if (slice.workflows.length > 0) {
          const n = await upsertRows(tc, "_workflow", slice.workflows);
          console.log(`[target] upserted _workflow rows: ${n}`);
        }
        if (slice.items.length > 0) {
          const n = await upsertRows(tc, "_workflow_item", slice.items);
          console.log(`[target] upserted _workflow_item rows: ${n}`);
        }
        if (slice.artifacts.length > 0) {
          const n = await upsertRows(tc, "_artifact", slice.artifacts);
          console.log(`[target] upserted _artifact rows: ${n}`);
        }

        await tc.query("COMMIT");
        console.log("[target] commit OK");
      } catch (e) {
        await tc.query("ROLLBACK");
        throw e;
      }
    });
  } finally {
    await sourcePool.end();
    await targetPool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
