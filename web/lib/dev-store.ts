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

  // INSERT INTO "_intake" (Suzi Intake tab)
  if (s.includes('INSERT INTO "_intake"')) {
    insertInto("intake", s, p);
    const all = loadTable("intake");
    return all.length > 0 ? [all[all.length - 1]] : [];
  }

  // SELECT FROM "_intake" (message id dedupe)
  if (s.includes('FROM "_intake"') && s.includes("meta->>'messageId'")) {
    const mid = String(p[0] || "");
    const rows = loadTable("intake").filter((r) => !r.deletedAt);
    const hit = rows.some((r) => {
      const meta = r.meta as Record<string, unknown> | undefined;
      return meta && String(meta.messageId || "") === mid;
    });
    return hit ? [{ x: 1 }] : [];
  }

  // COUNT FROM "_intake"
  if (s.includes('FROM "_intake"') && s.includes("COUNT") && s.includes("SELECT")) {
    return countIntakeRows(p);
  }

  // SELECT FROM "_intake" (list; not COUNT aggregate)
  if (s.includes('FROM "_intake"') && s.includes("SELECT") && !s.includes("COUNT(")) {
    return selectIntake(p);
  }

  // UPDATE "_intake"
  if (s.includes('UPDATE "_intake"')) {
    return updateTable("intake", s, p);
  }

  // SELECT with subquery COUNT for packages listing
  if (s.includes('FROM "_package"') && s.includes("SELECT")) {
    return selectPackages(s, p);
  }

  // SELECT from _workflow
  if (s.includes('FROM "_workflow"') && s.includes("SELECT")) {
    return selectWorkflows(s, p);
  }

  // GET /api/crm/human-tasks — JOIN wi + w (+ optional package). Generic workflow_item SELECT
  // cannot apply w.ownerAgent / wi.humanTaskOpen filters (those columns live on joined rows).
  if (
    s.includes('FROM "_workflow_item"') &&
    s.includes('INNER JOIN "_workflow"') &&
    s.includes("humanTaskOpen") &&
    s.includes("SELECT")
  ) {
    return selectHumanTasksQueueJoin(s, p);
  }

  // SELECT from _workflow_item
  if (s.includes('FROM "_workflow_item"') && s.includes("SELECT")) {
    return selectWorkflowItems(s, p);
  }

  // SELECT stages FROM "_board" WHERE id = $1 (human-task flag sync)
  if (s.includes('FROM "_board"') && s.includes("SELECT") && s.includes("stages")) {
    const boards = loadTable("boards").filter((r) => !r.deletedAt);
    if (p.length >= 1) {
      const bid = String(p[0]);
      return boards.filter((r) => r.id === bid).map((r) => ({ stages: r.stages }));
    }
    return [];
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

  if (table === "packages" && (row.packageNumber == null || row.packageNumber === "")) {
    const max = rows.reduce((m, r) => Math.max(m, Number(r.packageNumber) || 0), 0);
    row.packageNumber = max + 1;
  }

  rows.push(row);
  saveTable(table, rows);

  return [{ id }];
}

// ─── SELECT packages ────────────────────────────────────────────

/** Outer WHERE on `_package` p — avoids mistaking subquery WHERE for the main filter. */
function extractOuterWhereForPackageSelect(sql: string): string {
  const s = sql.replace(/\s+/g, " ").trim();
  const m = s.match(
    /FROM\s+"_package"\s+p\s+WHERE\s+(.+?)(?:\s+ORDER\s+BY\b|\s+LIMIT\b|$)/i
  );
  return m ? m[1].trim() : "";
}

function selectPackages(sql: string, params: unknown[]): Row[] {
  const rows = loadTable("packages").filter((r) => !r.deletedAt);
  const workflows = loadTable("workflows").filter((r) => !r.deletedAt);
  const workflowItems = loadTable("workflow_items").filter((r) => !r.deletedAt);

  const outerWhere = extractOuterWhereForPackageSelect(sql);
  const operational =
    outerWhere.includes("'PAUSED'") &&
    outerWhere.includes("'COMPLETED'") &&
    outerWhere.includes("'ACTIVE'") &&
    /stage/i.test(outerWhere);

  // Strip UPPER(p.stage::text) IN (...) so extractConditions does not mis-parse `::text` as column "text" IN (...)
  let frag = outerWhere;
  if (operational) {
    frag = frag
      .replace(/\s+AND\s+UPPER\s*\(\s*p\.stage::text\s*\)\s+IN\s*\([^)]+\)/gi, "")
      .replace(/^\s*UPPER\s*\(\s*p\.stage::text\s*\)\s+IN\s*\([^)]+\)\s+AND\s+/i, "")
      .replace(/^\s*UPPER\s*\(\s*p\.stage::text\s*\)\s+IN\s*\([^)]+\)\s*$/i, "");
  }

  const conditions = extractConditions("WHERE " + frag, params);
  let filtered = rows.filter((r) => matchesConditions(r, conditions));

  if (operational) {
    filtered = filtered.filter((r) => {
      const st = String(r.stage || "").toUpperCase();
      return st === "ACTIVE" || st === "PAUSED" || st === "COMPLETED";
    });
  }

  const withCounts = filtered.map((r) => {
    const wfCount = workflows.filter((w) => w.packageId === r.id).length;
    const base: Row = {
      ...r,
      workflowCount: wfCount,
      workflow_count: String(wfCount),
    };
    if (sql.includes("_workflow_item")) {
      const itemCount = workflowItems.filter((i) => {
        const w = workflows.find((wf) => wf.id === i.workflowId);
        return w && w.packageId === r.id;
      }).length;
      base.itemCount = itemCount;
    }
    return base;
  });

  withCounts.sort((a, b) =>
    String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""))
  );

  return withCounts.slice(0, 100);
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

  if (sql.includes('"_package"') || sql.includes("package_name")) {
    const pkgs = loadTable("packages").filter((r) => !r.deletedAt);
    filtered = filtered.map((r) => {
      const p = pkgs.find((pkg) => pkg.id === r.packageId);
      return { ...r, package_name: p?.name ?? null };
    });
    filtered.sort((a, b) => {
      const an = String(a.package_name || "");
      const bn = String(b.package_name || "");
      if (an !== bn) return an.localeCompare(bn);
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
  } else {
    filtered.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  }

  const orphanList = /packageId/i.test(sql) && /IS\s+NULL/i.test(sql);
  return filtered.slice(0, orphanList ? 500 : 50);
}

// ─── SELECT human-tasks queue (JOIN simulation) ─────────────────

/** LIMIT/OFFSET are last two numeric params on human-tasks queries — must strip before reading package filters. */
function stripTrailingPaginationParams(params: unknown[]): {
  head: unknown[];
  limit: number | null;
  offset: number | null;
} {
  if (params.length < 2) return { head: [...params], limit: null, offset: null };
  const last = params[params.length - 1];
  const prev = params[params.length - 2];
  const nLast = typeof last === "number" ? last : Number(String(last));
  const nPrev = typeof prev === "number" ? prev : Number(String(prev));
  if (!Number.isFinite(nLast) || !Number.isFinite(nPrev)) {
    return { head: [...params], limit: null, offset: null };
  }
  return {
    head: params.slice(0, -2),
    limit: nPrev,
    offset: nLast,
  };
}

/** Stages Tim’s queue always surfaces even when humanTaskOpen is false (matches human-tasks/route fetchHumanTaskRows). */
const TIM_HUMAN_TASKS_OR_STAGES = new Set([
  "REPLY_DRAFT",
  "REPLY_SENT",
  "LINKEDIN_INBOUND",
  "MESSAGE_DRAFT",
  "AWAITING_CONTACT",
  "INITIATED",
]);

function specTextHintsWarmOutreach(spec: unknown): boolean {
  const t = typeof spec === "string" ? spec : JSON.stringify(spec ?? {});
  return t.includes('"workflowType"') && t.toLowerCase().includes("warm-outreach");
}

function selectHumanTasksQueueJoin(sql: string, params: unknown[]): Row[] {
  const s = sql.replace(/\s+/g, " ").trim();
  const hasOwner = s.includes('LOWER(TRIM(COALESCE(w."ownerAgent"');
  const hasPkg = s.includes('JOIN "_package"');

  const { head, limit, offset } = stripTrailingPaginationParams(params);
  let i = 0;
  const ownerWant = hasOwner && head[i] != null ? String(head[i++]).trim().toLowerCase() : null;
  // Second bind is package stage equality only when the query is not using NOT IN (…) for package stages (e.g. Ghost exclude list).
  const pkgStageWant =
    hasPkg &&
    !/\bNOT\s+IN\s*\(/i.test(s) &&
    head[i] != null &&
    typeof head[i] === "string"
      ? String(head[i++]).trim().toUpperCase()
      : null;

  const pkgs = loadTable("packages").filter((r) => !r.deletedAt);
  const workflows = loadTable("workflows").filter((r) => !r.deletedAt);
  const boards = loadTable("boards").filter((r) => !r.deletedAt);
  const items = loadTable("workflow_items").filter((r) => !r.deletedAt);

  const out: Row[] = [];
  for (const wi of items) {
    const w = workflows.find((wf) => wf.id === wi.workflowId);
    if (!w) continue;
    const stageUpper = String(wi.stage || "").trim().toUpperCase();

    const timMessagedWait =
      ownerWant === "tim" &&
      stageUpper === "MESSAGED" &&
      specTextHintsWarmOutreach(w.spec);

    const timStageOrBranch = ownerWant === "tim" && TIM_HUMAN_TASKS_OR_STAGES.has(stageUpper);

    if (wi.humanTaskOpen !== true && !timMessagedWait && !timStageOrBranch) continue;
    if (ownerWant != null && String(w.ownerAgent || "").trim().toLowerCase() !== ownerWant) continue;

    // Tim ops default: only ACTIVE packages or unpackaged workflows (literal ACTIVE in SQL, not a bind param).
    if (ownerWant === "tim" && hasPkg && pkgStageWant == null) {
      if (w.packageId) {
        const pkg = pkgs.find((p) => p.id === w.packageId);
        const pst = String(pkg?.stage || "").trim().toUpperCase();
        if (pst && pst !== "ACTIVE") continue;
      }
    }

    if (pkgStageWant != null) {
      if (w.packageId) {
        const pkg = pkgs.find((p) => p.id === w.packageId);
        const st = String(pkg?.stage || "").trim().toUpperCase();
        if (st !== pkgStageWant) continue;
      }
    }
    const b = boards.find((bd) => bd.id === w.boardId);
    out.push({
      id: wi.id,
      workflowId: wi.workflowId,
      stage: wi.stage,
      sourceType: wi.sourceType,
      sourceId: wi.sourceId,
      dueDate: wi.dueDate ?? null,
      createdAt: wi.createdAt,
      workflowName: w.name,
      ownerAgent: w.ownerAgent,
      packageId: w.packageId ?? null,
      spec: w.spec,
      itemType: w.itemType,
      board_stages: b?.stages ?? null,
    });
  }
  out.sort((a, b) => {
    const da = a.dueDate ? Date.parse(String(a.dueDate)) : 0;
    const db = b.dueDate ? Date.parse(String(b.dueDate)) : 0;
    if (da !== db) return da - db;
    return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
  });
  if (limit != null && offset != null && limit > 0) {
    return out.slice(offset, offset + limit);
  }
  return out;
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

// ─── SELECT intake (Suzi) — FIFO by createdAt, optional LIMIT/OFFSET ───────────

function filterIntakeBySearch(rows: Row[], searchPattern: string): Row[] {
  const inner = searchPattern.replace(/^%|%$/g, "").toLowerCase();
  if (!inner) return rows;
  return rows.filter(
    (r) =>
      String(r.title || "").toLowerCase().includes(inner) ||
      String(r.body || "").toLowerCase().includes(inner) ||
      String(r.url || "").toLowerCase().includes(inner)
  );
}

function countIntakeRows(params: unknown[]): Row[] {
  const agentId = String(params[0] || "");
  let rows = loadTable("intake").filter((r) => !r.deletedAt);
  rows = rows.filter((r) => r.agentId === agentId);
  if (params.length >= 2 && typeof params[1] === "string") {
    rows = filterIntakeBySearch(rows, String(params[1]));
  }
  return [{ count: String(rows.length) }];
}

function selectIntake(params: unknown[]): Row[] {
  const agentId = String(params[0] || "");
  let rows = loadTable("intake").filter((r) => !r.deletedAt);
  rows = rows.filter((r) => r.agentId === agentId);

  let limit = 200;
  let offset = 0;

  if (params.length >= 4 && typeof params[1] === "string") {
    rows = filterIntakeBySearch(rows, String(params[1]));
    limit = Math.min(500, Math.max(1, Number(params[2]) || 200));
    offset = Math.max(0, Number(params[3]) || 0);
  } else if (params.length >= 3) {
    limit = Math.min(500, Math.max(1, Number(params[1]) || 200));
    offset = Math.max(0, Number(params[2]) || 0);
  } else if (params.length === 2 && typeof params[1] === "string") {
    rows = filterIntakeBySearch(rows, String(params[1]));
  }

  rows.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  return rows.slice(offset, offset + limit);
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
        const vals = litVals.map((v) => v.slice(1, -1));
        conditions.push({ col, val: vals });
      }
    }
  }

  // Match: "packageId" IS NULL or deletedAt IS NULL (param-free predicates)
  const quotedNull = /"(\w+)"\s+IS\s+NULL/gi;
  while ((match = quotedNull.exec(whereSection)) !== null) {
    conditions.push({ col: match[1], val: null });
  }
  const bareNull = /(?:^|\s)(\w+)\s+IS\s+NULL/gi;
  while ((match = bareNull.exec(whereSection)) !== null) {
    const col = match[1];
    const up = col.toUpperCase();
    if (up !== "AND" && up !== "OR" && up !== "NOT" && up !== "WHERE" && up !== "IS") {
      conditions.push({ col, val: null });
    }
  }

  return conditions;
}
