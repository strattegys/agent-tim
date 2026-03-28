import { randomUUID } from "node:crypto";
import { query } from "./db";

export interface PunchListNote {
  id: string;
  itemId: string;
  content: string;
  createdAt: string;
}

/**
 * Checkbox subtask on a punch list card (Inspect + `punch_list` action_add / action_toggle).
 * Persisted as a JSON array on `_punch_list.actions` (not a separate table).
 */
export interface PunchListAction {
  id: string;
  itemId: string;
  content: string;
  done: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface PunchListItem {
  id: string;
  itemNumber: number;
  agentId: string;
  title: string;
  description: string | null;
  category: string | null;
  rank: number;
  status: "open" | "done";
  notes: PunchListNote[];
  actions: PunchListAction[];
  createdAt: string;
  updatedAt: string;
}

interface ListOpts {
  status?: "open" | "done";
  search?: string;
  category?: string;
  includeArchived?: boolean;
}

export async function listPunchListItems(
  agentId: string,
  opts: ListOpts = {}
): Promise<PunchListItem[]> {
  const conditions = [`p."agentId" = $1`];
  const params: unknown[] = [agentId];
  let idx = 2;

  // By default exclude both deleted and archived items
  if (!opts.includeArchived) {
    conditions.push(`p."deletedAt" IS NULL`);
    conditions.push(`p."archivedAt" IS NULL`);
  }

  if (opts.status) {
    conditions.push(`p.status = $${idx++}`);
    params.push(opts.status);
  }
  if (opts.category) {
    conditions.push(`p.category = $${idx++}`);
    params.push(opts.category);
  }
  if (opts.search) {
    conditions.push(`(p.title ILIKE $${idx} OR p.description ILIKE $${idx})`);
    params.push(`%${opts.search}%`);
    idx++;
  }

  const where = conditions.join(" AND ");
  const rows = await query<Record<string, unknown>>(
    `SELECT p.*,
       COALESCE(
         (SELECT json_agg(json_build_object(
           'id', n.id, 'itemId', n."itemId", 'content', n.content, 'createdAt', n."createdAt"
         ) ORDER BY n."createdAt" DESC)
         FROM "_punch_list_note" n WHERE n."itemId" = p.id), '[]'
       ) as notes
     FROM "_punch_list" p
     WHERE ${where}
     ORDER BY CASE WHEN p.status = 'open' THEN 0 ELSE 1 END, p.rank ASC, COALESCE(p."sortOrder", 0) ASC, p."createdAt" ASC
     LIMIT 200`,
    params
  );
  return rows.map(rowToItem);
}

export async function addPunchListItem(
  agentId: string,
  data: { title: string; description?: string; rank?: number; category?: string }
): Promise<PunchListItem> {
  const rows = await query<Record<string, unknown>>(
    `INSERT INTO "_punch_list" ("agentId", title, description, rank, category)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *, '[]'::json as notes`,
    [agentId, data.title, data.description || null, data.rank ?? 4, data.category || null]
  );
  return rowToItem(rows[0]);
}

export async function updatePunchListItem(
  id: string,
  data: Partial<{ title: string; description: string; rank: number; status: string; category: string; sortOrder: number }>
): Promise<void> {
  const sets: string[] = [`"updatedAt" = NOW()`];
  const params: unknown[] = [];
  let idx = 1;

  if (data.title !== undefined) {
    sets.push(`title = $${idx++}`);
    params.push(data.title);
  }
  if (data.description !== undefined) {
    sets.push(`description = $${idx++}`);
    params.push(data.description);
  }
  if (data.rank !== undefined) {
    sets.push(`rank = $${idx++}`);
    params.push(data.rank);
  }
  if (data.status !== undefined) {
    sets.push(`status = $${idx++}`);
    params.push(data.status);
  }
  if (data.category !== undefined) {
    sets.push(`category = $${idx++}`);
    params.push(data.category);
  }
  if (data.sortOrder !== undefined) {
    sets.push(`"sortOrder" = $${idx++}`);
    params.push(data.sortOrder);
  }

  params.push(id);
  await query(
    `UPDATE "_punch_list" SET ${sets.join(", ")} WHERE id = $${idx} AND "deletedAt" IS NULL`,
    params
  );
}

/** Bulk reorder items within a rank column */
export async function reorderPunchListItems(
  updates: { id: string; rank: number; sortOrder: number }[]
): Promise<void> {
  for (const u of updates) {
    await query(
      `UPDATE "_punch_list" SET rank = $1, "sortOrder" = $2, "updatedAt" = NOW() WHERE id = $3 AND "deletedAt" IS NULL`,
      [u.rank, u.sortOrder, u.id]
    );
  }
}

export async function archivePunchListItem(id: string): Promise<void> {
  await query(
    `UPDATE "_punch_list" SET "archivedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1`,
    [id]
  );
}

export async function archiveDoneItems(agentId: string): Promise<number> {
  const rows = await query<Record<string, unknown>>(
    `UPDATE "_punch_list" SET "archivedAt" = NOW(), "updatedAt" = NOW()
     WHERE "agentId" = $1 AND status = 'done' AND "archivedAt" IS NULL AND "deletedAt" IS NULL
     RETURNING id`,
    [agentId]
  );
  return rows.length;
}

export async function deletePunchListItem(id: string): Promise<void> {
  await query(
    `UPDATE "_punch_list" SET "deletedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1`,
    [id]
  );
}

// --- Notes ---

export async function addNote(itemId: string, content: string): Promise<PunchListNote> {
  const rows = await query<Record<string, unknown>>(
    `INSERT INTO "_punch_list_note" ("itemId", content) VALUES ($1, $2) RETURNING *`,
    [itemId, content]
  );
  // Also bump the parent item's updatedAt
  await query(`UPDATE "_punch_list" SET "updatedAt" = NOW() WHERE id = $1`, [itemId]);
  return noteToObj(rows[0]);
}

export async function listNotes(itemId: string): Promise<PunchListNote[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM "_punch_list_note" WHERE "itemId" = $1 ORDER BY "createdAt" DESC`,
    [itemId]
  );
  return rows.map(noteToObj);
}

export async function insertPunchListItemAction(
  agentId: string,
  itemId: string,
  content: string
): Promise<PunchListAction> {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("content is required");

  const rows = await query<Record<string, unknown>>(
    `SELECT id, actions FROM "_punch_list" WHERE id = $1 AND "agentId" = $2 AND "deletedAt" IS NULL AND "archivedAt" IS NULL`,
    [itemId, agentId]
  );
  if (!rows.length) throw new Error("Item not found");

  const existing = parseEmbeddedActions(rows[0].actions, itemId);
  const sortOrder = existing.reduce((m, a) => Math.max(m, a.sortOrder), -1) + 1;
  const now = new Date().toISOString();
  const id = randomUUID();
  const next = [
    ...existing,
    { id, content: trimmed, done: false, sortOrder, createdAt: now, updatedAt: now },
  ];

  await query(
    `UPDATE "_punch_list" SET actions = $1::jsonb, "updatedAt" = NOW() WHERE id = $2`,
    [JSON.stringify(next), itemId]
  );

  return {
    id,
    itemId,
    content: trimmed,
    done: false,
    sortOrder,
    createdAt: now,
    updatedAt: now,
  };
}

/** Toggle or edit a subtask; returns null if action not found for this agent. */
export async function patchPunchListItemAction(
  agentId: string,
  actionId: string,
  patch: { done?: boolean; content?: string }
): Promise<{ itemId: string; itemNumber: number } | null> {
  if (patch.done === undefined && patch.content === undefined) return null;

  const rows = await query<Record<string, unknown>>(
    `SELECT p.id, p."itemNumber", p.actions
     FROM "_punch_list" p
     WHERE p."agentId" = $1
       AND p."deletedAt" IS NULL
       AND EXISTS (
         SELECT 1
         FROM jsonb_array_elements(COALESCE(p.actions, '[]'::jsonb)) elem
         WHERE elem->>'id' = $2
       )
     LIMIT 1`,
    [agentId, actionId]
  );
  if (!rows.length) return null;

  const itemId = rows[0].id as string;
  const itemNumber = rows[0].itemNumber as number;
  const list = parseEmbeddedActions(rows[0].actions, itemId);
  const idx = list.findIndex((a) => a.id === actionId);
  if (idx < 0) return null;

  const now = new Date().toISOString();
  const prev = list[idx];
  const updated: PunchListAction = {
    ...prev,
    done: patch.done !== undefined ? patch.done : prev.done,
    content: patch.content !== undefined ? patch.content.trim() : prev.content,
    updatedAt: now,
  };
  const next = [...list.slice(0, idx), updated, ...list.slice(idx + 1)];

  await query(
    `UPDATE "_punch_list" SET actions = $1::jsonb, "updatedAt" = NOW() WHERE id = $2`,
    [JSON.stringify(
      next.map((a) => ({
        id: a.id,
        content: a.content,
        done: a.done,
        sortOrder: a.sortOrder,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      }))
    ), itemId]
  );

  return { itemId, itemNumber };
}

export async function listCategories(agentId: string): Promise<string[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT DISTINCT category FROM "_punch_list"
     WHERE "agentId" = $1 AND category IS NOT NULL AND "deletedAt" IS NULL AND "archivedAt" IS NULL
     ORDER BY category`,
    [agentId]
  );
  return rows.map((r) => r.category as string);
}

function noteToObj(row: Record<string, unknown>): PunchListNote {
  return {
    id: row.id as string,
    itemId: row.itemId as string,
    content: row.content as string,
    createdAt: (row.createdAt as Date).toISOString(),
  };
}

/** Read `actions` JSONB from a row; stable order for UI and tools. */
function parseEmbeddedActions(raw: unknown, itemId: string): PunchListAction[] {
  let arr: unknown[] = [];
  if (raw == null) return [];
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw) as unknown;
      arr = Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  } else if (Array.isArray(raw)) {
    arr = raw;
  } else {
    return [];
  }

  const out: PunchListAction[] = [];
  for (const el of arr) {
    if (!el || typeof el !== "object") continue;
    const o = el as Record<string, unknown>;
    const id = String(o.id || "");
    if (!id) continue;
    out.push(
      actionToObj({
        id,
        itemId,
        content: String(o.content ?? ""),
        done: Boolean(o.done),
        sortOrder: Number(o.sortOrder ?? 0),
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
      })
    );
  }
  out.sort(
    (a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt)
  );
  return out;
}

function isoField(v: unknown, fallback: string): string {
  if (typeof v === "string" && v) return v;
  if (v instanceof Date) return v.toISOString();
  return fallback;
}

function actionToObj(row: Record<string, unknown>): PunchListAction {
  const ca = row.createdAt as Date | string | undefined;
  const ua = row.updatedAt as Date | string | undefined;
  const now = new Date().toISOString();
  const createdAt = isoField(ca, now);
  return {
    id: row.id as string,
    itemId: row.itemId as string,
    content: row.content as string,
    done: Boolean(row.done),
    sortOrder: Number(row.sortOrder ?? 0),
    createdAt,
    updatedAt: isoField(ua, createdAt),
  };
}

function rowToItem(row: Record<string, unknown>): PunchListItem {
  let notes: PunchListNote[] = [];
  if (row.notes) {
    if (typeof row.notes === "string") {
      try {
        notes = JSON.parse(row.notes);
      } catch {
        /* ignore */
      }
    } else if (Array.isArray(row.notes)) {
      notes = (row.notes as Record<string, unknown>[]).map((n) => ({
        id: n.id as string,
        itemId: n.itemId as string,
        content: n.content as string,
        createdAt:
          typeof n.createdAt === "string"
            ? n.createdAt
            : (n.createdAt as Date).toISOString(),
      }));
    }
  }

  const actions = parseEmbeddedActions(row.actions, row.id as string);

  return {
    id: row.id as string,
    itemNumber: row.itemNumber as number,
    agentId: row.agentId as string,
    title: row.title as string,
    description: (row.description as string) || null,
    category: (row.category as string) || null,
    rank: row.rank as number,
    status: row.status as PunchListItem["status"],
    notes,
    actions,
    createdAt: (row.createdAt as Date)?.toISOString?.() || (row.createdAt as string),
    updatedAt: (row.updatedAt as Date)?.toISOString?.() || (row.updatedAt as string),
  };
}
