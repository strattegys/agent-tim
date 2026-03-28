import { query } from "./db";

export type IntakeSource = "ui" | "agent" | "share" | "email";

export interface IntakeItem {
  id: string;
  agentId: string;
  title: string;
  url: string | null;
  body: string | null;
  source: IntakeSource;
  meta: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

interface ListOpts {
  search?: string;
}

export async function listIntake(
  agentId: string,
  opts: ListOpts = {}
): Promise<IntakeItem[]> {
  const conditions = [`"agentId" = $1`, `"deletedAt" IS NULL`];
  const params: unknown[] = [agentId];
  let idx = 2;

  if (opts.search) {
    conditions.push(`(title ILIKE $${idx} OR body ILIKE $${idx} OR url ILIKE $${idx})`);
    params.push(`%${opts.search}%`);
    idx++;
  }

  const where = conditions.join(" AND ");
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM "_intake" WHERE ${where} ORDER BY "updatedAt" DESC LIMIT 200`,
    params
  );
  return rows.map(rowToIntake);
}

export async function addIntake(
  agentId: string,
  data: {
    title: string;
    url?: string | null;
    body?: string | null;
    source: IntakeSource;
    meta?: Record<string, unknown> | null;
  }
): Promise<IntakeItem> {
  const metaJson = data.meta && Object.keys(data.meta).length > 0 ? JSON.stringify(data.meta) : null;
  const rows = await query<Record<string, unknown>>(
    `INSERT INTO "_intake" ("agentId", title, url, body, source, meta)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING *`,
    [
      agentId,
      data.title,
      data.url ?? null,
      data.body ?? null,
      data.source,
      metaJson,
    ]
  );
  return rowToIntake(rows[0]);
}

export async function updateIntake(
  id: string,
  data: Partial<{ title: string; url: string | null; body: string | null }>
): Promise<void> {
  const sets: string[] = [`"updatedAt" = NOW()`];
  const params: unknown[] = [];
  let i = 1;

  if (data.title !== undefined) {
    sets.push(`title = $${i++}`);
    params.push(data.title);
  }
  if (data.url !== undefined) {
    sets.push(`url = $${i++}`);
    params.push(data.url);
  }
  if (data.body !== undefined) {
    sets.push(`body = $${i++}`);
    params.push(data.body);
  }

  params.push(id);
  await query(
    `UPDATE "_intake" SET ${sets.join(", ")} WHERE id = $${i} AND "deletedAt" IS NULL`,
    params
  );
}

export async function deleteIntake(id: string): Promise<void> {
  await query(
    `UPDATE "_intake" SET "deletedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1`,
    [id]
  );
}

/** Inbound email idempotency when provider sends Message-ID. */
export async function intakeExistsWithMessageId(messageId: string): Promise<boolean> {
  const rows = await query<Record<string, unknown>>(
    `SELECT 1 AS x FROM "_intake" WHERE meta->>'messageId' = $1 AND "deletedAt" IS NULL LIMIT 1`,
    [messageId]
  );
  return rows.length > 0;
}

function rowToIntake(row: Record<string, unknown>): IntakeItem {
  let meta: Record<string, unknown> | null = null;
  const rawMeta = row.meta;
  if (rawMeta != null && typeof rawMeta === "object" && !Array.isArray(rawMeta)) {
    meta = rawMeta as Record<string, unknown>;
  } else if (typeof rawMeta === "string") {
    try {
      const p = JSON.parse(rawMeta) as unknown;
      if (p && typeof p === "object" && !Array.isArray(p)) meta = p as Record<string, unknown>;
    } catch {
      meta = null;
    }
  }

  return {
    id: row.id as string,
    agentId: row.agentId as string,
    title: row.title as string,
    url: (row.url as string) || null,
    body: (row.body as string) || null,
    source: row.source as IntakeSource,
    meta,
    createdAt: (row.createdAt as Date)?.toISOString?.() || (row.createdAt as string),
    updatedAt: (row.updatedAt as Date)?.toISOString?.() || (row.updatedAt as string),
  };
}

function stripTrailingUrlPunct(url: string): string {
  return url.replace(/[),.;]+$/g, "");
}

/** Extract first http(s) URL from text (email bodies, share text). */
export function extractFirstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/i);
  return m ? stripTrailingUrlPunct(m[0]) : null;
}

/**
 * Rough plain text from HTML for intake preview when providers send empty TextBody
 * (common for forwards / rich clients — links often live only in HtmlBody).
 */
export function htmlToPlainText(html: string, maxLen = 20000): string {
  if (!html.trim()) return "";
  let t = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
  t = t.replace(/<\/(p|div|tr|h[1-6])\s*>/gi, "\n");
  t = t.replace(/<br\s*\/?>/gi, "\n");
  t = t.replace(/<[^>]+>/g, " ");
  t = t
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  t = t.replace(/\s+\n/g, "\n").replace(/\n\s+/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
  return t.slice(0, maxLen);
}

/** First http(s) URL from HTML: prefer href=, else scan stripped text. */
export function extractFirstUrlFromHtml(html: string): string | null {
  if (!html.trim()) return null;
  const href = html.match(/href\s*=\s*["'](https?:\/\/[^"'>\s]+)/i);
  if (href) return stripTrailingUrlPunct(href[1]);
  const plain = htmlToPlainText(html, 50000);
  return extractFirstUrl(plain);
}
