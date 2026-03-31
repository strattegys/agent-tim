#!/usr/bin/env node
/**
 * Run SQL against the CRM Postgres (same connection as lib/db.ts).
 * Loads web/.env.local via scripts/crm-db-pool.mjs (same defaults as check-crm-db: port 5433 on loopback, Tailscale fallback).
 *
 * Usage (from web/):
 *   npm run db:exec -- scripts/seed-vibe-coding-warm-outreach-package.sql
 *   npm run db:exec -- -e "SELECT id, name FROM \"_package\" WHERE \"deletedAt\" IS NULL LIMIT 5"
 *   type file.sql | npm run db:exec -- -
 *
 * Env (in .env.local or shell):
 *   CRM_DB_PASSWORD required (unless DATABASE_URL / CRM_DATABASE_URL is set)
 *   CRM_DB_HOST (default 127.0.0.1), CRM_DB_PORT (default 5433 when host is loopback), CRM_DB_NAME, CRM_DB_USER
 *   CRM_DB_TAILSCALE_HOST optional — when loopback fails, tries this host on port 5432 (same as check-crm-db)
 *   CRM_DB_SEARCH_PATH optional (default workspace_9rc10n79wgdr0r3z6mzti24f6)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createCrmPool } from "./crm-db-pool.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.join(__dirname, "..");

const DEFAULT_SEARCH_PATH = "workspace_9rc10n79wgdr0r3z6mzti24f6";

/**
 * Opening delimiter for PostgreSQL dollar-quoted string at sql[i], or null.
 * Supports $$ and $tag$ (tag = [A-Za-z0-9_]*).
 */
function dollarQuoteOpen(sql, i) {
  if (sql[i] !== "$") return null;
  let j = i + 1;
  while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j])) j++;
  if (j >= sql.length || sql[j] !== "$") return null;
  const delim = sql.slice(i, j + 1);
  return { delim, next: j + 1 };
}

/** Split SQL on semicolons outside '...' and $tag$...$tag$ (so DO $$ ... $$ blocks stay one statement). */
function splitStatements(sql) {
  const statements = [];
  let buf = "";
  let i = 0;
  let inSingle = false;
  let dollarClose = "";

  while (i < sql.length) {
    const ch = sql[i];

    if (dollarClose) {
      if (sql.startsWith(dollarClose, i)) {
        buf += dollarClose;
        i += dollarClose.length;
        dollarClose = "";
        continue;
      }
      buf += ch;
      i++;
      continue;
    }

    if (inSingle) {
      if (ch === "'" && sql[i + 1] === "'") {
        buf += "''";
        i += 2;
        continue;
      }
      if (ch === "'") {
        inSingle = false;
        buf += ch;
        i++;
        continue;
      }
      buf += ch;
      i++;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      buf += ch;
      i++;
      continue;
    }

    const dq = dollarQuoteOpen(sql, i);
    if (dq) {
      dollarClose = dq.delim;
      buf += dq.delim;
      i = dq.next;
      continue;
    }

    if (ch === ";") {
      const t = stripSqlCommentsAndBlankLines(buf);
      if (t) statements.push(t);
      buf = "";
      i++;
      continue;
    }

    buf += ch;
    i++;
  }

  const last = stripSqlCommentsAndBlankLines(buf);
  if (last) statements.push(last);
  return statements;
}

/** Remove full-line -- comments and blank lines so trailing SELECT after INSERT is not dropped. */
function stripSqlCommentsAndBlankLines(raw) {
  const lines = raw.split(/\r?\n/);
  const kept = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("--")) continue;
    const dash = line.indexOf("--");
    if (dash >= 0) kept.push(line.slice(0, dash).trimEnd());
    else kept.push(line);
  }
  return kept.join("\n").trim();
}

function usage() {
  console.error(`Usage: node scripts/db-exec.mjs <file.sql>
       node scripts/db-exec.mjs -e "SQL"
       node scripts/db-exec.mjs -   (stdin)

Requires CRM_DB_* in web/.env.local or DATABASE_URL / CRM_DATABASE_URL.`);
  process.exit(1);
}

async function main() {
  let pool;
  try {
    pool = await createCrmPool(WEB_ROOT);
  } catch (e) {
    console.error("[db-exec]", e.message || e);
    process.exit(1);
  }

  const searchPath =
    process.env.CRM_DB_SEARCH_PATH || DEFAULT_SEARCH_PATH;

  const args = process.argv.slice(2).filter((a) => a !== "--");
  let sqlText = "";

  if (args.length === 0) usage();

  if (args[0] === "-e" && args[1]) {
    sqlText = args[1];
  } else if (args[0] === "-") {
    sqlText = fs.readFileSync(0, "utf8");
  } else {
    const filePath = path.isAbsolute(args[0])
      ? args[0]
      : path.join(WEB_ROOT, args[0]);
    if (!fs.existsSync(filePath)) {
      console.error("[db-exec] File not found:", filePath);
      process.exit(1);
    }
    sqlText = fs.readFileSync(filePath, "utf8");
  }

  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO "${searchPath}", public`);

    const stmts = splitStatements(sqlText);
    if (stmts.length === 0) {
      console.error("[db-exec] No SQL statements found.");
      process.exit(1);
    }

    for (let i = 0; i < stmts.length; i++) {
      const s = stmts[i];
      const res = await client.query(s);
      if (res.rows?.length > 0) {
        console.log(JSON.stringify(res.rows, null, 2));
      } else if (res.rowCount != null && res.rowCount !== undefined) {
        console.error(`[db-exec] ${res.command || "OK"} rowCount=${res.rowCount}`);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error("[db-exec]", e.message || e);
  process.exit(1);
});
