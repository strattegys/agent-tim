import { query } from "./db";
import { embedText, toPgVector } from "./embeddings";

export interface MemoryRecord {
  [key: string]: unknown;
  id: string;
  agentId: string;
  content: string;
  category: string;
  source: string;
  similarity?: number;
  createdAt: Date;
}

const TOP_K = 15;
const SIMILARITY_THRESHOLD = 0.35;
const DEDUP_THRESHOLD = 0.92;

/** Search memories by semantic similarity to a query string. */
export async function searchMemories(
  agentId: string,
  queryText: string,
  opts?: { topK?: number; category?: string }
): Promise<MemoryRecord[]> {
  const vec = await embedText(queryText);
  const pgVec = toPgVector(vec);
  const k = opts?.topK ?? TOP_K;

  let sql = `
    SELECT id, "agentId", content, category, source, "createdAt",
           1 - (embedding <=> $1::vector) AS similarity
    FROM "_memory"
    WHERE "agentId" = $2
      AND "deletedAt" IS NULL
      AND "isActive" = TRUE
      AND 1 - (embedding <=> $1::vector) > $3
  `;
  const params: unknown[] = [pgVec, agentId, SIMILARITY_THRESHOLD];

  if (opts?.category) {
    sql += ` AND category = $4`;
    params.push(opts.category);
  }

  sql += ` ORDER BY embedding <=> $1::vector ASC LIMIT $${params.length + 1}`;
  params.push(k);

  return query<MemoryRecord>(sql, params);
}

/** Insert a new memory with its embedding. Deduplicates by similarity. */
export async function insertMemory(
  agentId: string,
  content: string,
  opts?: { category?: string; source?: string }
): Promise<MemoryRecord> {
  const vec = await embedText(content);
  const pgVec = toPgVector(vec);

  // Deduplicate: check if a very similar memory already exists
  const dupeCheck = await query<{ id: string }>(
    `SELECT id FROM "_memory"
     WHERE "agentId" = $1
       AND "deletedAt" IS NULL
       AND 1 - (embedding <=> $2::vector) > $3
     LIMIT 1`,
    [agentId, pgVec, DEDUP_THRESHOLD]
  );

  if (dupeCheck.length > 0) {
    // Update the existing memory's content and timestamp
    const rows = await query<MemoryRecord>(
      `UPDATE "_memory"
       SET content = $1, "updatedAt" = NOW()
       WHERE id = $2
       RETURNING id, "agentId", content, category, source, "createdAt"`,
      [content, dupeCheck[0].id]
    );
    return rows[0];
  }

  const category = opts?.category ?? "general";
  const source = opts?.source ?? "tool";

  const rows = await query<MemoryRecord>(
    `INSERT INTO "_memory" ("agentId", content, category, embedding, source, "sessionDate")
     VALUES ($1, $2, $3, $4::vector, $5, CURRENT_DATE)
     RETURNING id, "agentId", content, category, source, "createdAt"`,
    [agentId, content, category, pgVec, source]
  );
  return rows[0];
}

/** List all active memories for an agent (for "read" command). */
export async function listAllMemories(
  agentId: string
): Promise<MemoryRecord[]> {
  return query<MemoryRecord>(
    `SELECT id, "agentId", content, category, source, "createdAt"
     FROM "_memory"
     WHERE "agentId" = $1 AND "deletedAt" IS NULL AND "isActive" = TRUE
     ORDER BY "createdAt" DESC
     LIMIT 200`,
    [agentId]
  );
}

/** Soft-delete all memories for an agent (for "replace" operation). */
export async function clearMemories(agentId: string): Promise<void> {
  await query(
    `UPDATE "_memory" SET "deletedAt" = NOW()
     WHERE "agentId" = $1 AND "deletedAt" IS NULL`,
    [agentId]
  );
}
