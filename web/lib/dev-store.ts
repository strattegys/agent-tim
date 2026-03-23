/**
 * Dev Store — JSON file-based data store for local development.
 *
 * When CRM_DB_PASSWORD is not set, db.ts delegates to this store.
 * Pattern-matches SQL queries used by the package system and routes
 * them to simple JSON file operations. Not a full SQL engine — only
 * handles the specific patterns the package/workflow system uses.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

const STORE_DIR = join(process.cwd(), ".dev-store");

interface Row {
  [key: string]: unknown;
}

// ─── Persistence ────────────────────────────────────────────────

function ensureDir() {
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
}

function loadTable(name: string): Row[] {
  ensureDir();
  const file = join(STORE_DIR, `${name}.json`);
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return [];
  }
}

function saveTable(name: string, rows: Row[]) {
  ensureDir();
  writeFileSync(join(STORE_DIR, `${name}.json`), JSON.stringify(rows, null, 2));
}

// ─── Helpers ────────────────────────────────────────────────────

function matchesConditions(row: Row, conditions: Array<{ col: string; val: unknown }>): boolean {
  return conditions.every(({ col, val }) => {
    if (val === null) return row[col] === null || row[col] === undefined;
    // Support IN clause: val is an array, match if row[col] is in the array
    if (Array.isArray(val)) return val.includes(row[col]);
    return row[col] === val;
  });
}

function now(): string {
  return new Date().toISOString();
}

// ─── Query Router ───────────────────────────────────────────────

export async function devQuery(sql: string, params?: unknown[]): Promise<Row[]> {
  const p = params || [];
  const s = sql.replace(/\s+/g, " ").trim();

  // INSERT INTO "_package" (...) VALUES (...) RETURNING id
  if (s.includes('INSERT INTO "_package"')) {
    return insertInto("packages", s, p);
  }

  // INSERT INTO "_board" (...) VALUES (...) RETURNING id
  if (s.includes('INSERT INTO "_board"')) {
    return insertInto("boards", s, p);
  }

  // INSERT INTO "_workflow" (...) VALUES (...) RETURNING id
  if (s.includes('INSERT INTO "_workflow"')) {
    return insertInto("workflows", s, p);
  }

  // INSERT INTO "_workflow_item"
  if (s.includes('INSERT INTO "_workflow_item"')) {
    return insertInto("workflow_items", s, p);
  }

  // INSERT INTO "_content_item"
  if (s.includes('INSERT INTO "_content_item"')) {
    return insertInto("content_items", s, p);
  }

  // INSERT INTO "_artifact"
  if (s.includes('INSERT INTO "_artifact"')) {
    return insertInto("artifacts", s, p);
  }

  // SELECT with subquery COUNT for packages listing
  if (s.includes('FROM "_package"') && s.includes("SELECT")) {
    return selectPackages(s, p);
  }

  // SELECT from _workflow
  if (s.includes('FROM "_workflow"') && s.includes("SELECT")) {
    return selectWorkflows(s, p);
  }

  // SELECT from _workflow_item
  if (s.includes('FROM "_workflow_item"') && s.includes("SELECT")) {
    return selectWorkflowItems(s, p);
  }

  // SELECT from _artifact
  if (s.includes('FROM "_artifact"') && s.includes("SELECT")) {
    return selectArtifacts(s, p);
  }

  // SELECT from _content_item
  if (s.includes('FROM "_content_item"') && s.includes("SELECT")) {
    return selectContentItems(s, p);
  }

  // UPDATE "_package"
  if (s.includes('UPDATE "_package"')) {
    return updateTable("packages", s, p);
  }

  // UPDATE "_workflow"
  if (s.includes('UPDATE "_workflow"')) {
    return updateTable("workflows", s, p);
  }

  // UPDATE "_workflow_item"
  if (s.includes('UPDATE "_workflow_item"')) {
    return updateTable("workflow_items", s, p);
  }

  // UPDATE "_artifact"
  if (s.includes('UPDATE "_artifact"')) {
    return updateTable("artifacts", s, p);
  }

  // UPDATE "_content_item"
  if (s.includes('UPDATE "_content_item"')) {
    return updateTable("content_items", s, p);
  }

  // DELETE FROM "_artifact"
  if (s.includes('DELETE FROM "_artifact"')) {
    return deleteFrom("artifacts", s, p);
  }

  // DELETE FROM "_workflow_item"
  if (s.includes('DELETE FROM "_workflow_item"')) {
    return deleteFrom("workflow_items", s, p);
  }

  // DELETE FROM "_workflow"
  if (s.includes('DELETE FROM "_workflow"')) {
    return deleteFrom("workflows", s, p);
  }

  // DELETE FROM "_board"
  if (s.includes('DELETE FROM "_board"')) {
    return deleteFrom("boards", s, p);
  }

  // DELETE FROM "_content_item"
  if (s.includes('DELETE FROM "_content_item"')) {
    return deleteFrom("content_items", s, p);
  }

  console.warn("[dev-store] Unhandled query:", s.slice(0, 120));
  return [];
}

export async function devTransaction<T>(
  fn: (run: (sql: string, params?: unknown[]) => Promise<{ rows: Row[] }>) => Promise<T>
): Promise<T> {
  // Simple sequential execution — no rollback support in dev mode
  return fn(async (sql, params) => {
    const rows = await devQuery(sql, params);
    return { rows };
  });
}

// ─── INSERT ─────────────────────────────────────────────────────

function insertInto(table: string, sql: string, params: unknown[]): Row[] {
  const rows = loadTable(table);
  const id = randomUUID();

  // Extract column names from SQL: INSERT INTO "table" (col1, col2, ...) VALUES
  const colMatch = sql.match(/\(([^)]+)\)\s*VALUES/i);
  if (!colMatch) {
    console.warn("[dev-store] Could not parse INSERT columns:", sql.slice(0, 100));
    return [{ id }];
  }

  const cols = colMatch[1].split(",").map((c) => c.trim().replace(/"/g, ""));
  const row: Row = { id };

  cols.forEach((col, i) => {
    if (col === "id") return; // We generate our own
    let val = params[i];
    // Handle JSONB: if param is a string that looks like JSON, parse it
    if (typeof val === "string" && (val.startsWith("{") || val.startsWith("["))) {
      try {
        val = JSON.parse(val);
      } catch {
        // keep as string
      }
    }
    row[col] = val;
  });

  // Add timestamps if not present
  if (!row.createdAt) row.createdAt = now();
  if (!row.updatedAt) row.updatedAt = now();

  rows.push(row);
  saveTable(table, rows);

  return [{ id }];
}

// ─── SELECT packages ────────────────────────────────────────────

function selectPackages(sql: string, params: unknown[]): Row[] {
  const rows = loadTable("packages").filter((r) => !r.deletedAt);
  const workflows = loadTable("workflows").filter((r) => !r.deletedAt);

  // Build conditions from WHERE clause params
  const conditions = extractConditions(sql, params);
  let filtered = rows.filter((r) => matchesConditions(r, conditions));

  // Add workflow count
  filtered = filtered.map((r) => ({
    ...r,
    workflowCount: workflows.filter((w) => w.packageId === r.id && !w.deletedAt).length,
    workflow_count: String(workflows.filter((w) => w.packageId === r.id && !w.deletedAt).length),
  }));

  // Sort by createdAt DESC
  filtered.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

  return filtered.slice(0, 100);
}

// ─── SELECT workflows ───────────────────────────────────────────

function selectWorkflows(sql: string, params: unknown[]): Row[] {
  const rows = loadTable("workflows").filter((r) => !r.deletedAt);
  const conditions = extractConditions(sql, params);
  let filtered = rows.filter((r) => matchesConditions(r, conditions));

  // If query includes COUNT from workflow_items
  if (sql.includes("_workflow_item")) {
    const items = loadTable("workflow_items").filter((r) => !r.deletedAt);
    filtered = filtered.map((r) => ({
      ...r,
      item_count: String(items.filter((i) => i.workflowId === r.id).length),
    }));
  }

  filtered.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  return filtered.slice(0, 50);
}

// ─── SELECT workflow items ──────────────────────────────────────

function selectWorkflowItems(sql: string, params: unknown[]): Row[] {
  const rows = loadTable("workflow_items").filter((r) => !r.deletedAt);
  const conditions = extractConditions(sql, params);
  return rows.filter((r) => matchesConditions(r, conditions));
}

// ─── SELECT artifacts ────────────────────────────────────────────

function selectArtifacts(sql: string, params: unknown[]): Row[] {
  const rows = loadTable("artifacts").filter((r) => !r.deletedAt);
  const conditions = extractConditions(sql, params);
  const filtered = rows.filter((r) => matchesConditions(r, conditions));
  filtered.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  return filtered;
}

// ─── SELECT content items ────────────────────────────────────────

function selectContentItems(sql: string, params: unknown[]): Row[] {
  const rows = loadTable("content_items").filter((r) => !r.deletedAt);
  const conditions = extractConditions(sql, params);
  return rows.filter((r) => matchesConditions(r, conditions));
}

// ─── UPDATE ─────────────────────────────────────────────────────

function updateTable(table: string, sql: string, params: unknown[]): Row[] {
  const rows = loadTable(table);

  // Find the WHERE id = $N param
  const whereIdMatch = sql.match(/WHERE\s+id\s*=\s*\$(\d+)/i)
    || sql.match(/WHERE\s+"?id"?\s*=\s*\$(\d+)/i);

  if (!whereIdMatch) {
    // Try matching with last param as id
    const idVal = params[params.length - 1];
    const idx = rows.findIndex((r) => r.id === idVal);
    if (idx === -1) return [];
    applyUpdates(rows[idx], sql, params);
    saveTable(table, rows);
    return [];
  }

  const idParamIdx = parseInt(whereIdMatch[1]) - 1;
  const idVal = params[idParamIdx];

  const idx = rows.findIndex((r) => r.id === idVal);
  if (idx === -1) return [];

  applyUpdates(rows[idx], sql, params);
  saveTable(table, rows);
  return [];
}

function applyUpdates(row: Row, sql: string, params: unknown[]) {
  // Parse SET clause: SET col1 = $1, col2 = $2, ...
  const setMatch = sql.match(/SET\s+(.+?)\s+WHERE/i);
  if (!setMatch) return;

  // Split SET clause by commas, but respect parentheses (e.g., COALESCE(...))
  const setRaw = setMatch[1];
  const setParts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of setRaw) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      setParts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) setParts.push(current.trim());
  for (const part of setParts) {
    // Detect JSONB merge: spec = COALESCE(spec, ...) || $N::jsonb
    const mergeMatch = part.match(/COALESCE\("?(\w+)"?.*\|\|\s*\$(\d+)/i);
    if (mergeMatch) {
      const col = mergeMatch[1];
      const paramIdx = parseInt(mergeMatch[2]) - 1;
      let val = params[paramIdx];
      if (typeof val === "string") {
        try { val = JSON.parse(val); } catch { /* keep string */ }
      }
      // Merge into existing object
      const existing = (row[col] && typeof row[col] === "object") ? row[col] as Record<string, unknown> : {};
      row[col] = { ...existing, ...(val as Record<string, unknown>) };
      continue;
    }

    const m = part.match(/"?(\w+)"?\s*=\s*\$(\d+)/);
    if (m) {
      const col = m[1];
      const paramIdx = parseInt(m[2]) - 1;
      let val = params[paramIdx];
      // Parse JSONB strings
      if (typeof val === "string" && (val.startsWith("{") || val.startsWith("["))) {
        try { val = JSON.parse(val); } catch { /* keep string */ }
      }
      row[col] = val;
    } else if (part.match(/"?(\w+)"?\s*=\s*'([^']+)'/)) {
      // Handle literal string values: col = 'value'
      const litMatch = part.match(/"?(\w+)"?\s*=\s*'([^']+)'/);
      if (litMatch) row[litMatch[1]] = litMatch[2];
    } else if (part.includes("NOW()")) {
      const colMatch = part.match(/"?(\w+)"?\s*=/);
      if (colMatch) row[colMatch[1]] = now();
    }
  }
  row.updatedAt = now();
}

// ─── DELETE ──────────────────────────────────────────────────────

function deleteFrom(table: string, sql: string, params: unknown[]): Row[] {
  const rows = loadTable(table);
  const conditions = extractConditions(sql, params);

  if (conditions.length === 0) {
    // Safety: don't delete everything if no conditions
    console.warn("[dev-store] DELETE with no conditions, skipping:", sql.slice(0, 100));
    return [];
  }

  const remaining = rows.filter((r) => !matchesConditions(r, conditions));
  const deleted = rows.length - remaining.length;
  saveTable(table, remaining);
  return [{ deleted }];
}

// ─── Condition Extraction ───────────────────────────────────────

function extractConditions(sql: string, params: unknown[]): Array<{ col: string; val: unknown }> {
  const conditions: Array<{ col: string; val: unknown }> = [];
  const whereSection = sql.split(/WHERE/i)[1] || "";

  // Match patterns like: column = $1, "column" = $2, p.column = $3, p."column" = $4
  const eqRegex = /(?:\w+\.)?"?(\w+)"?\s*=\s*\$(\d+)/g;
  let match: RegExpExecArray | null;

  while ((match = eqRegex.exec(whereSection)) !== null) {
    const col = match[1];
    const paramIdx = parseInt(match[2]) - 1;
    if (paramIdx >= 0 && paramIdx < params.length) {
      conditions.push({ col, val: params[paramIdx] });
    }
  }

  // Match IN clauses: column IN ($2, $3, $4) or column IN ('A', 'B', 'C')
  const inRegex = /(?:\w+\.)?"?(\w+)"?\s+IN\s*\(([^)]+)\)/gi;
  while ((match = inRegex.exec(whereSection)) !== null) {
    const col = match[1];
    const inner = match[2];
    const paramRefs = inner.match(/\$(\d+)/g);
    if (paramRefs) {
      // Parameterized IN: column IN ($2, $3, $4)
      const vals = paramRefs
        .map((ref) => {
          const idx = parseInt(ref.slice(1)) - 1;
          return idx >= 0 && idx < params.length ? params[idx] : undefined;
        })
        .filter((v) => v !== undefined);
      if (vals.length > 0) {
        conditions.push({ col, val: vals });
      }
    } else {
      // Literal string IN: column IN ('A', 'B', 'C')
      const litVals = inner.match(/'([^']+)'/g);
      if (litVals) {
        const vals = litVals.map(v => v.slice(1, -1));
        conditions.push({ col, val: vals });
      }
    }
  }

  return conditions;
}
