import "server-only";

import { query, resetCrmPoolForReconnect } from "./db";
import { hasGeminiApiKey, missingGeminiKeyUserMessage } from "./gemini-api-key";
import { embedText, toPgVector } from "./embeddings";
import { braveWebSearch } from "./brave-search";
import { mergeWebEnvLocalSync } from "./load-web-env-local";
import { randomUUID } from "crypto";

const KB_AGENT = "marni";
const SIM_THRESHOLD = 0.32;
const DEFAULT_TOP_K = 12;

export function isMarniKbDatabaseConfigured(): boolean {
  return Boolean(process.env.CRM_DB_PASSWORD?.trim());
}

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return s || "topic";
}

export type KbSourceMode = "web_only" | "linkedin_only" | "both";

export interface KbTopicRow {
  id: string;
  agentId: string;
  slug: string;
  name: string;
  description: string | null;
  queries: string[];
  postUrls: string[];
  sourceMode: KbSourceMode;
  cadenceMinutes: number | null;
  enabled: boolean;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KbRunRow {
  id: string;
  topicId: string;
  status: string;
  sourcesFound: number;
  chunksIngested: number;
  errorMessage: string | null;
  detail: Record<string, unknown>;
  startedAt: string;
  completedAt: string | null;
}

export interface KnowledgeChunkRow {
  id: string;
  agentId: string;
  topicId: string | null;
  content: string;
  metadata: Record<string, unknown>;
  similarity?: number;
  createdAt: string;
}

function rowToTopic(r: Record<string, unknown>): KbTopicRow {
  const queries = (r.queries as string[]) ?? [];
  const postUrls = (r.postUrls as string[]) ?? [];
  return {
    id: String(r.id),
    agentId: String(r.agentId),
    slug: String(r.slug),
    name: String(r.name),
    description: r.description != null ? String(r.description) : null,
    queries: Array.isArray(queries) ? queries.map(String) : [],
    postUrls: Array.isArray(postUrls) ? postUrls.map(String) : [],
    sourceMode: (r.sourceMode as KbSourceMode) || "web_only",
    cadenceMinutes:
      r.cadenceMinutes != null && r.cadenceMinutes !== ""
        ? Number(r.cadenceMinutes)
        : null,
    enabled: Boolean(r.enabled),
    lastRunAt: r.lastRunAt != null ? String(r.lastRunAt) : null,
    createdAt: String(r.createdAt),
    updatedAt: String(r.updatedAt),
  };
}

export async function listKbTopics(agentId = KB_AGENT): Promise<KbTopicRow[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT id, "agentId", slug, name, description, queries, "postUrls", "sourceMode", "cadenceMinutes", enabled, "lastRunAt", "createdAt", "updatedAt"
     FROM "_kb_topic" WHERE "agentId" = $1 ORDER BY name ASC`,
    [agentId]
  );
  return rows.map(rowToTopic);
}

export async function getKbTopic(id: string): Promise<KbTopicRow | null> {
  const rows = await query<Record<string, unknown>>(
    `SELECT id, "agentId", slug, name, description, queries, "postUrls", "sourceMode", "cadenceMinutes", enabled, "lastRunAt", "createdAt", "updatedAt"
     FROM "_kb_topic" WHERE id = $1`,
    [id]
  );
  return rows[0] ? rowToTopic(rows[0]) : null;
}

export async function createKbTopic(input: {
  name: string;
  description?: string | null;
  queries?: string[];
  postUrls?: string[];
  sourceMode?: KbSourceMode;
  cadenceMinutes?: number | null;
  enabled?: boolean;
  agentId?: string;
}): Promise<KbTopicRow> {
  const agentId = input.agentId ?? KB_AGENT;
  let base = slugify(input.name);
  let slug = base;
  for (let i = 0; i < 20; i++) {
    const exists = await query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM "_kb_topic" WHERE "agentId" = $1 AND slug = $2`,
      [agentId, slug]
    );
    if (Number(exists[0]?.c || 0) === 0) break;
    slug = `${base}-${randomUUID().slice(0, 8)}`;
  }
  const queries = JSON.stringify(input.queries ?? []);
  const postUrls = JSON.stringify(input.postUrls ?? []);
  const rows = await query<Record<string, unknown>>(
    `INSERT INTO "_kb_topic" ("agentId", slug, name, description, queries, "postUrls", "sourceMode", "cadenceMinutes", enabled)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9)
     RETURNING id, "agentId", slug, name, description, queries, "postUrls", "sourceMode", "cadenceMinutes", enabled, "lastRunAt", "createdAt", "updatedAt"`,
    [
      agentId,
      slug,
      input.name.trim(),
      input.description?.trim() ?? null,
      queries,
      postUrls,
      input.sourceMode ?? "web_only",
      input.cadenceMinutes ?? null,
      input.enabled !== false,
    ]
  );
  return rowToTopic(rows[0]);
}

export async function updateKbTopic(
  id: string,
  patch: Partial<{
    name: string;
    description: string | null;
    queries: string[];
    postUrls: string[];
    sourceMode: KbSourceMode;
    cadenceMinutes: number | null;
    enabled: boolean;
  }>
): Promise<KbTopicRow | null> {
  const cur = await getKbTopic(id);
  if (!cur) return null;
  const name = patch.name != null ? patch.name.trim() : cur.name;
  const description =
    patch.description !== undefined ? patch.description : cur.description;
  const queries = JSON.stringify(patch.queries ?? cur.queries);
  const postUrls = JSON.stringify(patch.postUrls ?? cur.postUrls);
  const sourceMode = patch.sourceMode ?? cur.sourceMode;
  const cadenceMinutes =
    patch.cadenceMinutes !== undefined ? patch.cadenceMinutes : cur.cadenceMinutes;
  const enabled = patch.enabled ?? cur.enabled;
  const rows = await query<Record<string, unknown>>(
    `UPDATE "_kb_topic" SET name = $2, description = $3, queries = $4::jsonb, "postUrls" = $5::jsonb,
     "sourceMode" = $6, "cadenceMinutes" = $7, enabled = $8, "updatedAt" = NOW()
     WHERE id = $1
     RETURNING id, "agentId", slug, name, description, queries, "postUrls", "sourceMode", "cadenceMinutes", enabled, "lastRunAt", "createdAt", "updatedAt"`,
    [id, name, description, queries, postUrls, sourceMode, cadenceMinutes, enabled]
  );
  return rows[0] ? rowToTopic(rows[0]) : null;
}

export async function deleteKbTopic(id: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `DELETE FROM "_kb_topic" WHERE id = $1 RETURNING id`,
    [id]
  );
  return rows.length > 0;
}

export async function listKbRuns(topicId: string, limit = 40): Promise<KbRunRow[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT id, "topicId", status, "sourcesFound", "chunksIngested", "errorMessage", detail, "startedAt", "completedAt"
     FROM "_kb_research_run" WHERE "topicId" = $1 ORDER BY "startedAt" DESC LIMIT $2`,
    [topicId, limit]
  );
  return rows.map((r) => ({
    id: String(r.id),
    topicId: String(r.topicId),
    status: String(r.status),
    sourcesFound: Number(r.sourcesFound ?? 0),
    chunksIngested: Number(r.chunksIngested ?? 0),
    errorMessage: r.errorMessage != null ? String(r.errorMessage) : null,
    detail: (r.detail as Record<string, unknown>) ?? {},
    startedAt: String(r.startedAt),
    completedAt: r.completedAt != null ? String(r.completedAt) : null,
  }));
}

export async function listKnowledgeChunks(
  agentId: string,
  opts?: { topicId?: string; limit?: number }
): Promise<KnowledgeChunkRow[]> {
  const limit = Math.min(200, Math.max(1, opts?.limit ?? 80));
  if (opts?.topicId) {
    const rows = await query<Record<string, unknown>>(
      `SELECT id, "agentId", "topicId", content, metadata, "createdAt"
       FROM "_agent_knowledge" WHERE "agentId" = $1 AND "topicId" = $2 AND "deletedAt" IS NULL
       ORDER BY "createdAt" DESC LIMIT $3`,
      [agentId, opts.topicId, limit]
    );
    return rows.map((r) => ({
      id: String(r.id),
      agentId: String(r.agentId),
      topicId: r.topicId != null ? String(r.topicId) : null,
      content: String(r.content),
      metadata: (r.metadata as Record<string, unknown>) ?? {},
      createdAt: String(r.createdAt),
    }));
  }
  const rows = await query<Record<string, unknown>>(
    `SELECT id, "agentId", "topicId", content, metadata, "createdAt"
     FROM "_agent_knowledge" WHERE "agentId" = $1 AND "deletedAt" IS NULL
     ORDER BY "createdAt" DESC LIMIT $2`,
    [agentId, limit]
  );
  return rows.map((r) => ({
    id: String(r.id),
    agentId: String(r.agentId),
    topicId: r.topicId != null ? String(r.topicId) : null,
    content: String(r.content),
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    createdAt: String(r.createdAt),
  }));
}

function splitIntoChunks(text: string, maxLen = 1100): string[] {
  const t = text.replace(/\r\n/g, "\n").trim();
  if (!t) return [];
  if (t.length <= maxLen) return [t];
  const parts: string[] = [];
  let i = 0;
  while (i < t.length) {
    let end = Math.min(i + maxLen, t.length);
    if (end < t.length) {
      const slice = t.slice(i, end);
      const br = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf(". "));
      if (br > 200) end = i + br + 1;
    }
    parts.push(t.slice(i, end).trim());
    i = end;
  }
  return parts.filter(Boolean);
}

async function insertChunk(
  agentId: string,
  topicId: string,
  content: string,
  metadata: Record<string, unknown>
): Promise<void> {
  const vec = await embedText(content.slice(0, 8000), {
    agentId,
    purpose: "marni_kb_ingest",
  });
  const pgVec = toPgVector(vec);
  await query(
    `INSERT INTO "_agent_knowledge" ("agentId", "topicId", content, embedding, metadata)
     VALUES ($1, $2, $3, $4::vector, $5::jsonb)`,
    [agentId, topicId, content, pgVec, JSON.stringify(metadata)]
  );
}

async function hasRunningRun(topicId: string): Promise<boolean> {
  const rows = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM "_kb_research_run" WHERE "topicId" = $1 AND status = 'running'`,
    [topicId]
  );
  return Number(rows[0]?.c ?? 0) > 0;
}

export async function runKbResearch(topicId: string): Promise<KbRunRow> {
  const topic = await getKbTopic(topicId);
  if (!topic) throw new Error("Topic not found");
  if (await hasRunningRun(topicId)) {
    throw new Error("A research run is already in progress for this topic");
  }

  // Drop pooled TCP clients before a long Brave + embedding loop so we do not reuse a dead
  // connection after idle (common with SSH tunnel / host.docker.internal to a tunnel).
  if (isMarniKbDatabaseConfigured()) {
    await resetCrmPoolForReconnect();
  }

  const runRows = await query<Record<string, unknown>>(
    `INSERT INTO "_kb_research_run" ("topicId", status) VALUES ($1, 'running') RETURNING id, "topicId", status, "sourcesFound", "chunksIngested", "errorMessage", detail, "startedAt", "completedAt"`,
    [topicId]
  );
  const run = runRows[0];
  const runId = String(run!.id);
  const warnings: string[] = [];
  let sourcesFound = 0;
  let chunksIngested = 0;

  const finish = async (
    status: "completed" | "error",
    err?: string,
    detailExtra?: Record<string, unknown>
  ) => {
    const detail = { warnings, ...detailExtra };
    await query(
      `UPDATE "_kb_research_run" SET status = $2, "sourcesFound" = $3, "chunksIngested" = $4,
       "errorMessage" = $5, detail = $6::jsonb, "completedAt" = NOW() WHERE id = $1`,
      [runId, status, sourcesFound, chunksIngested, err ?? null, JSON.stringify(detail)]
    );
    await query(`UPDATE "_kb_topic" SET "lastRunAt" = NOW(), "updatedAt" = NOW() WHERE id = $1`, [
      topicId,
    ]);
  };

  try {
    mergeWebEnvLocalSync();

    if (!hasGeminiApiKey()) {
      await finish("error", missingGeminiKeyUserMessage());
      const bad = await query<Record<string, unknown>>(
        `SELECT id, "topicId", status, "sourcesFound", "chunksIngested", "errorMessage", detail, "startedAt", "completedAt" FROM "_kb_research_run" WHERE id = $1`,
        [runId]
      );
      return mapRunRow(bad[0]);
    }

    if (topic.postUrls.length > 0) {
      warnings.push(
        "LinkedIn post URL ingestion via Unipile is not implemented yet; URLs are stored for a future release."
      );
    }

    const doWeb =
      topic.sourceMode === "web_only" ||
      topic.sourceMode === "both" ||
      (topic.sourceMode === "linkedin_only" && topic.queries.length > 0);

    const trimmedQueries = topic.queries.map((q) => q.trim()).filter(Boolean);
    let webQueries = trimmedQueries;
    if (doWeb && webQueries.length === 0) {
      const titleQ = topic.name.trim();
      if (titleQ.length >= 3) {
        webQueries = [titleQ.slice(0, 200)];
        warnings.push(
          "No web search queries were set; used the topic title as the Brave query. Add explicit lines under Web search queries in the topic form for more focused results."
        );
      } else {
        warnings.push(
          "No web search queries on this topic. Add one or more lines under “Web search queries” in the topic form, then run again."
        );
      }
    }

    if (doWeb && webQueries.length > 0) {
      if (!process.env["BRAVE_SEARCH_API_KEY"]?.trim()) {
        warnings.push(
          "BRAVE_SEARCH_API_KEY is not set — web search was skipped. Add it to web/.env.local (see .env.local.example) and restart the web server / Docker container."
        );
      } else {
        for (const q of webQueries) {
          const qq = q.trim();
          if (!qq) continue;
          let results: Awaited<ReturnType<typeof braveWebSearch>>;
          try {
            results = await braveWebSearch(qq, 4);
          } catch (e) {
            warnings.push(
              `Brave search failed for "${qq.slice(0, 60)}${qq.length > 60 ? "…" : ""}": ${e instanceof Error ? e.message : String(e)}`
            );
            continue;
          }
          if (results.length === 0) {
            warnings.push(
              `Brave returned no web results for "${qq.slice(0, 60)}${qq.length > 60 ? "…" : ""}". Try a broader query.`
            );
            continue;
          }
          for (const hit of results) {
            sourcesFound += 1;
            const raw = `${hit.title}\n\n${hit.snippet}`.trim();
            if (raw.length < 20) {
              warnings.push(
                `Skipped a hit (title + snippet under 20 chars): ${(hit.title || "untitled").slice(0, 48)}`
              );
              continue;
            }
            const chunks = splitIntoChunks(raw);
            let idx = 0;
            for (const c of chunks) {
              await insertChunk(topic.agentId, topicId, c, {
                title: hit.title,
                sourceUrl: hit.url,
                topicId,
                runId,
                chunkIndex: idx,
                sourceType: "web_search",
                ingestedAt: new Date().toISOString(),
              });
              idx += 1;
              chunksIngested += 1;
            }
          }
        }
      }
    } else if (topic.sourceMode === "linkedin_only" && topic.postUrls.length === 0) {
      warnings.push("linkedin_only topic has no post URLs and no web queries — nothing to ingest.");
    }

    if (sourcesFound === 0 && chunksIngested === 0 && warnings.length === 0) {
      warnings.push(
        "Nothing was ingested. Check topic mode, web queries, BRAVE_SEARCH_API_KEY, and the messages above on the next run."
      );
    }

    await finish("completed");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await finish("error", msg);
  }

  const out = await query<Record<string, unknown>>(
    `SELECT id, "topicId", status, "sourcesFound", "chunksIngested", "errorMessage", detail, "startedAt", "completedAt" FROM "_kb_research_run" WHERE id = $1`,
    [runId]
  );
  return mapRunRow(out[0]);
}

function mapRunRow(r: Record<string, unknown> | undefined): KbRunRow {
  if (!r) {
    return {
      id: "",
      topicId: "",
      status: "error",
      sourcesFound: 0,
      chunksIngested: 0,
      errorMessage: "missing run",
      detail: {},
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
  }
  return {
    id: String(r.id),
    topicId: String(r.topicId),
    status: String(r.status),
    sourcesFound: Number(r.sourcesFound ?? 0),
    chunksIngested: Number(r.chunksIngested ?? 0),
    errorMessage: r.errorMessage != null ? String(r.errorMessage) : null,
    detail: (r.detail as Record<string, unknown>) ?? {},
    startedAt: String(r.startedAt),
    completedAt: r.completedAt != null ? String(r.completedAt) : null,
  };
}


export async function searchAgentKnowledge(
  agentId: string,
  queryText: string,
  opts?: { topK?: number; topicId?: string | null }
): Promise<KnowledgeChunkRow[]> {
  const vec = await embedText(queryText.slice(0, 4000), {
    agentId,
    purpose: "marni_kb_search",
  });
  const pgVec = toPgVector(vec);
  const k = Math.min(24, Math.max(1, opts?.topK ?? DEFAULT_TOP_K));
  const topicId = opts?.topicId;
  let rows: Record<string, unknown>[];
  if (topicId) {
    rows = await query<Record<string, unknown>>(
      `SELECT id, "agentId", "topicId", content, metadata, "createdAt",
              1 - (embedding <=> $1::vector) AS similarity
       FROM "_agent_knowledge"
       WHERE "agentId" = $2 AND "deletedAt" IS NULL AND "topicId" = $3
         AND 1 - (embedding <=> $1::vector) > $4
       ORDER BY embedding <=> $1::vector ASC
       LIMIT $5`,
      [pgVec, agentId, topicId, SIM_THRESHOLD, k]
    );
  } else {
    rows = await query<Record<string, unknown>>(
      `SELECT id, "agentId", "topicId", content, metadata, "createdAt",
              1 - (embedding <=> $1::vector) AS similarity
       FROM "_agent_knowledge"
       WHERE "agentId" = $2 AND "deletedAt" IS NULL
         AND 1 - (embedding <=> $1::vector) > $3
       ORDER BY embedding <=> $1::vector ASC
       LIMIT $4`,
      [pgVec, agentId, SIM_THRESHOLD, k]
    );
  }
  return rows.map((r) => ({
    id: String(r.id),
    agentId: String(r.agentId),
    topicId: r.topicId != null ? String(r.topicId) : null,
    content: String(r.content),
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    similarity: r.similarity != null ? Number(r.similarity) : undefined,
    createdAt: String(r.createdAt),
  }));
}

export interface KbCitation {
  title?: string;
  sourceUrl?: string;
  excerpt: string;
  score: number;
}

export async function answerKbQuestion(
  question: string,
  agentId = KB_AGENT
): Promise<{ answer: string; citations: KbCitation[] }> {
  const chunks = await searchAgentKnowledge(agentId, question, { topK: 10 });
  const citations: KbCitation[] = chunks.map((c) => {
    const m = c.metadata || {};
    return {
      title: typeof m.title === "string" ? m.title : undefined,
      sourceUrl: typeof m.sourceUrl === "string" ? m.sourceUrl : undefined,
      excerpt: c.content.slice(0, 320),
      score: Math.round((c.similarity ?? 0) * 100),
    };
  });

  if (chunks.length === 0) {
    return {
      answer:
        "No matching knowledge chunks yet. Add research topics, run research (Brave + embeddings need GEMINI_API_KEY), then try again.",
      citations: [],
    };
  }

  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) {
    return {
      answer:
        "Retrieved context but GROQ_API_KEY is not set — cannot synthesize an answer. Citations are listed below.",
      citations,
    };
  }

  const context = chunks
    .map((c, i) => `--- Source ${i + 1} ---\n${c.content}`)
    .join("\n\n");

  const model =
    process.env.GROQ_CHAT_MODEL?.trim() || "llama-3.3-70b-versatile";
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: 1200,
      messages: [
        {
          role: "system",
          content:
            "You answer using ONLY the provided context. If something is not in the context, say you do not have that in the knowledge base. Be concise and practical.",
        },
        {
          role: "user",
          content: `Context:\n${context}\n\nQuestion: ${question}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const t = await res.text();
    return {
      answer: `Groq error ${res.status}: ${t.slice(0, 200)}`,
      citations,
    };
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const answer = data.choices?.[0]?.message?.content?.trim() || "(empty response)";
  return { answer, citations };
}

export async function processDueKbTopicsCron(agentId = KB_AGENT): Promise<number> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM "_kb_topic"
     WHERE enabled = TRUE AND "agentId" = $1
       AND "cadenceMinutes" IS NOT NULL AND "cadenceMinutes" > 0
       AND (
         "lastRunAt" IS NULL
         OR NOW() - "lastRunAt" >= ("cadenceMinutes"::text || ' minutes')::interval
       )`,
    [agentId]
  );
  let n = 0;
  for (const r of rows) {
    try {
      if (await hasRunningRun(r.id)) continue;
      await runKbResearch(r.id);
      n += 1;
    } catch (e) {
      console.error("[marni-kb cron] topic", r.id, e);
    }
  }
  return n;
}
