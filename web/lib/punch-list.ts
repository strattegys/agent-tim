import { query } from "./db";

export interface PunchListNote {
  id: string;
  itemId: string;
  content: string;
  createdAt: string;
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
     ORDER BY CASE WHEN p.status = 'open' THEN 0 ELSE 1 END, p.rank ASC, p."createdAt" ASC
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
  data: Partial<{ title: string; description: string; rank: number; status: string; category: string }>
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

  params.push(id);
  await query(
    `UPDATE "_punch_list" SET ${sets.join(", ")} WHERE id = $${idx} AND "deletedAt" IS NULL`,
    params
  );
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

function rowToItem(row: Record<string, unknown>): PunchListItem {
  let notes: PunchListNote[] = [];
  if (row.notes) {
    if (typeof row.notes === "string") {
      try { notes = JSON.parse(row.notes); } catch { /* ignore */ }
    } else if (Array.isArray(row.notes)) {
      notes = row.notes as PunchListNote[];
    }
  }

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
    createdAt: (row.createdAt as Date)?.toISOString?.() || (row.createdAt as string),
    updatedAt: (row.updatedAt as Date)?.toISOString?.() || (row.updatedAt as string),
  };
}
