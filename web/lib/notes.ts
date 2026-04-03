import { query } from "./db";
import { notePublicRef } from "./public-ref";

export interface Note {
  id: string;
  noteNumber: number;
  /** Human-facing id, e.g. NT5001 (matches DB `publicRef` when migrated). */
  publicRef: string;
  agentId: string;
  title: string;
  content: string | null;
  tag: string | null;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ListOpts {
  tag?: string;
  search?: string;
  pinnedFirst?: boolean;
}

export async function listNotes(
  agentId: string,
  opts: ListOpts = {}
): Promise<Note[]> {
  const conditions = [`"agentId" = $1`, `"deletedAt" IS NULL`];
  const params: unknown[] = [agentId];
  let idx = 2;

  if (opts.tag) {
    conditions.push(`tag = $${idx++}`);
    params.push(opts.tag);
  }
  if (opts.search) {
    conditions.push(`(title ILIKE $${idx} OR content ILIKE $${idx})`);
    params.push(`%${opts.search}%`);
    idx++;
  }

  const where = conditions.join(" AND ");
  const order = opts.pinnedFirst !== false
    ? `ORDER BY pinned DESC, "updatedAt" DESC`
    : `ORDER BY "updatedAt" DESC`;

  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM "_note" WHERE ${where} ${order} LIMIT 200`,
    params
  );
  return rows.map(rowToNote);
}

export async function addNote(
  agentId: string,
  data: { title: string; content?: string; tag?: string; pinned?: boolean }
): Promise<Note> {
  const rows = await query<Record<string, unknown>>(
    `INSERT INTO "_note" ("agentId", title, content, tag, pinned)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [agentId, data.title, data.content || null, data.tag || null, data.pinned ?? false]
  );
  return rowToNote(rows[0]);
}

export async function updateNote(
  id: string,
  data: Partial<{ title: string; content: string; tag: string; pinned: boolean }>
): Promise<void> {
  const sets: string[] = [`"updatedAt" = NOW()`];
  const params: unknown[] = [];
  let idx = 1;

  if (data.title !== undefined) {
    sets.push(`title = $${idx++}`);
    params.push(data.title);
  }
  if (data.content !== undefined) {
    sets.push(`content = $${idx++}`);
    params.push(data.content);
  }
  if (data.tag !== undefined) {
    sets.push(`tag = $${idx++}`);
    params.push(data.tag);
  }
  if (data.pinned !== undefined) {
    sets.push(`pinned = $${idx++}`);
    params.push(data.pinned);
  }

  params.push(id);
  await query(
    `UPDATE "_note" SET ${sets.join(", ")} WHERE id = $${idx} AND "deletedAt" IS NULL`,
    params
  );
}

export async function findByNoteNumber(noteNumber: number): Promise<Note | null> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM "_note" WHERE "noteNumber" = $1 AND "deletedAt" IS NULL LIMIT 1`,
    [noteNumber]
  );
  return rows.length > 0 ? rowToNote(rows[0]) : null;
}

export async function findByNoteNumberForAgent(
  agentId: string,
  noteNumber: number
): Promise<Note | null> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM "_note" WHERE "agentId" = $1 AND "noteNumber" = $2 AND "deletedAt" IS NULL LIMIT 1`,
    [agentId, noteNumber]
  );
  return rows.length > 0 ? rowToNote(rows[0]) : null;
}

export async function getNoteByIdForAgent(agentId: string, id: string): Promise<Note | null> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM "_note" WHERE id = $1 AND "agentId" = $2 AND "deletedAt" IS NULL LIMIT 1`,
    [id, agentId]
  );
  return rows.length > 0 ? rowToNote(rows[0]) : null;
}

export async function deleteNote(id: string): Promise<void> {
  await query(
    `UPDATE "_note" SET "deletedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1`,
    [id]
  );
}

export async function listTags(agentId: string): Promise<string[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT DISTINCT tag FROM "_note"
     WHERE "agentId" = $1 AND tag IS NOT NULL AND "deletedAt" IS NULL
     ORDER BY tag`,
    [agentId]
  );
  return rows.map((r) => r.tag as string);
}

function rowToNote(row: Record<string, unknown>): Note {
  const rawNn = row.noteNumber;
  const noteNumber =
    typeof rawNn === "number" && Number.isFinite(rawNn)
      ? rawNn
      : typeof rawNn === "string" && /^\d+$/.test(rawNn)
        ? parseInt(rawNn, 10)
        : 0;

  return {
    id: row.id as string,
    noteNumber,
    publicRef: notePublicRef({
      publicRef: row.publicRef as string | undefined,
      noteNumber,
    }),
    agentId: row.agentId as string,
    title: row.title as string,
    content: (row.content as string) || null,
    tag: (row.tag as string) || null,
    pinned: row.pinned as boolean,
    createdAt: (row.createdAt as Date)?.toISOString?.() || (row.createdAt as string),
    updatedAt: (row.updatedAt as Date)?.toISOString?.() || (row.updatedAt as string),
  };
}
