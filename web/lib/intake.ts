import { query } from "./db";
import { intakeDigitsFromToken, intakePublicRef } from "./public-ref";

export type IntakeSource = "ui" | "agent" | "share" | "email";

export interface IntakeItem {
  id: string;
  /** Stable display / tool id (sequence); never changes for this row. */
  itemNumber: number;
  /** Human-facing id, e.g. IN2001 (matches DB `publicRef` when migrated). */
  publicRef: string;
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
  /** Default 200 when omitted (tools / full list). */
  limit?: number;
  /** Default 0 when omitted. */
  offset?: number;
}

export async function countIntake(
  agentId: string,
  opts: { search?: string } = {}
): Promise<number> {
  const conditions = [`"agentId" = $1`, `"deletedAt" IS NULL`];
  const params: unknown[] = [agentId];
  let idx = 2;

  if (opts.search) {
    conditions.push(`(title ILIKE $${idx} OR body ILIKE $${idx} OR url ILIKE $${idx})`);
    params.push(`%${opts.search}%`);
    idx++;
  }

  const where = conditions.join(" AND ");
  const rows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM "_intake" WHERE ${where}`,
    params
  );
  const n = parseInt(rows[0]?.count ?? "0", 10);
  return Number.isFinite(n) ? n : 0;
}

export async function listIntake(
  agentId: string,
  opts: ListOpts = {}
): Promise<IntakeItem[]> {
  const limit =
    opts.limit !== undefined
      ? Math.min(500, Math.max(1, opts.limit))
      : 200;
  const offset = opts.offset !== undefined ? Math.max(0, opts.offset) : 0;

  const conditions = [`"agentId" = $1`, `"deletedAt" IS NULL`];
  const params: unknown[] = [agentId];
  let idx = 2;

  if (opts.search) {
    conditions.push(`(title ILIKE $${idx} OR body ILIKE $${idx} OR url ILIKE $${idx})`);
    params.push(`%${opts.search}%`);
    idx++;
  }

  params.push(limit, offset);
  const limPh = `$${idx}`;
  const offPh = `$${idx + 1}`;

  const where = conditions.join(" AND ");
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM "_intake" WHERE ${where} ORDER BY "createdAt" DESC LIMIT ${limPh} OFFSET ${offPh}`,
    params
  );
  return rows.map(rowToIntake);
}

/** Resolve by stable itemNumber (same as # on Intake cards). */
export async function getIntakeByItemNumber(
  agentId: string,
  itemNumber: number
): Promise<IntakeItem | null> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM "_intake" WHERE "agentId" = $1 AND "itemNumber" = $2 AND "deletedAt" IS NULL LIMIT 1`,
    [agentId, itemNumber]
  );
  if (rows.length === 0) return null;
  return rowToIntake(rows[0]);
}

/** Resolve by public ref (e.g. IN2001) or legacy plain item number string. */
export async function getIntakeByPublicRef(
  agentId: string,
  ref: string
): Promise<IntakeItem | null> {
  const n = intakeDigitsFromToken(ref);
  if (n == null) return null;
  return getIntakeByItemNumber(agentId, n);
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
      normalizeIntakeBody(data.body),
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
    params.push(normalizeIntakeBody(data.body));
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

  const rawNum = row.itemNumber;
  const itemNumber =
    typeof rawNum === "number" && Number.isFinite(rawNum)
      ? rawNum
      : typeof rawNum === "string" && /^\d+$/.test(rawNum)
        ? parseInt(rawNum, 10)
        : 0;

  return {
    id: row.id as string,
    itemNumber,
    publicRef: intakePublicRef({
      publicRef: row.publicRef as string | undefined,
      itemNumber,
    }),
    agentId: row.agentId as string,
    title: row.title as string,
    url: (row.url as string) || null,
    body: normalizeIntakeBody(row.body as string | null),
    source: row.source as IntakeSource,
    meta,
    createdAt: (row.createdAt as Date)?.toISOString?.() || (row.createdAt as string),
    updatedAt: (row.updatedAt as Date)?.toISOString?.() || (row.updatedAt as string),
  };
}

/** Strip leading `>` quote markers (nested replies / forwards). */
function stripLeadingGtDepth(s: string): string {
  let t = s;
  while (/^\s*>/.test(t)) t = t.replace(/^\s*>\s?/, "");
  return t.trimStart();
}

/** True when this line is only decoration around “Forwarded message” (Gmail, etc.). */
function isForwardedMessageBanner(trimmed: string): boolean {
  if (!/\bforwarded message\b/i.test(trimmed)) return false;
  const withoutPhrase = trimmed.replace(/\bforwarded message\b/gi, "").replace(/\s/g, "");
  return withoutPhrase.length > 0 && /^[-–—_*=#.]+$/i.test(withoutPhrase);
}

function isOriginalMessageBanner(trimmed: string): boolean {
  if (!/\boriginal message\b/i.test(trimmed)) return false;
  const w = trimmed.replace(/\boriginal message\b/gi, "").replace(/\s/g, "");
  return w.length === 0 || /^[-–—_*=#.]+$/i.test(w);
}

function isBeginForwardedBanner(trimmed: string): boolean {
  return /^begin forwarded message:?\s*$/i.test(trimmed);
}

function isOutlookSeparator(trimmed: string): boolean {
  return /^_{8,}$/.test(trimmed) || /^[-–—]{8,}$/.test(trimmed);
}

/** Known mail headers in forward preambles (avoid matching “Note: …” in body). */
function looksLikeForwardHeaderLine(trimmed: string): boolean {
  return (
    /^(?:From|To|Subject|Date|Sent|Cc|Bcc|Reply-To|Reply\s+To|Message-ID|Content-Type|MIME-Version)\s*:\s*.+/i.test(
      trimmed
    ) || /^X-[A-Za-z0-9-]+\s*:\s*.+/i.test(trimmed)
  );
}

/**
 * Remove one leading forward block from plain text (line-based; handles quoted `>` lines and
 * clients that omit a blank line before the body).
 */
function stripOneForwardBlockFromStart(text: string): string {
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i >= lines.length) return text;

  const rawFirst = lines[i]!;
  const firstDequoted = stripLeadingGtDepth(rawFirst).trim();

  let afterBanner = i + 1;

  if (isOutlookSeparator(firstDequoted)) {
    let j = i + 1;
    while (j < lines.length && lines[j]!.trim() === "") j++;
    if (j >= lines.length) return text;
    const candidate = stripLeadingGtDepth(lines[j]!).trim();
    if (!/^From:\s*/i.test(candidate)) return text;
    afterBanner = j;
  } else if (
    isForwardedMessageBanner(firstDequoted) ||
    isOriginalMessageBanner(firstDequoted) ||
    isBeginForwardedBanner(firstDequoted)
  ) {
    afterBanner = i + 1;
  } else {
    return text;
  }

  i = afterBanner;
  while (i < lines.length && lines[i]!.trim() === "") i++;

  let headerCount = 0;
  while (i < lines.length) {
    const raw = lines[i]!;
    const t = stripLeadingGtDepth(raw).trim();
    if (t === "") {
      if (headerCount > 0) {
        i++;
        while (i < lines.length && lines[i]!.trim() === "") i++;
        break;
      }
      i++;
      continue;
    }
    if (looksLikeForwardHeaderLine(t)) {
      headerCount++;
      i++;
      while (i < lines.length && /^[ \t]+\S/.test(lines[i]!) && !looksLikeForwardHeaderLine(stripLeadingGtDepth(lines[i]!).trim())) {
        i++;
      }
      continue;
    }
    if (headerCount > 0) break;
    break;
  }

  return lines.slice(i).join("\n");
}

/**
 * HTML→text often glues "Forwarded message … From: … Subject: …" onto one line. Split on
 * header boundaries so the line-based stripper can run.
 */
function demergeForwardedHeadersOnFirstLine(text: string): string {
  const lines = text.split("\n");
  if (lines.length === 0) return text;
  const first = lines[0]!;
  if (!/\bforwarded message\b/i.test(first) || !/\b(?:From|Subject|Date|Sent|To)\s*:/i.test(first)) {
    return text;
  }
  const chunks = first.split(/\s+(?=(?:From|To|Subject|Date|Sent|Cc|Bcc|Reply-To|Reply\s+To)\s*:)/i);
  if (chunks.length < 2) return text;
  return [...chunks, ...lines.slice(1)].join("\n");
}

/**
 * Remove leading "Forwarded message" / "Original Message" blocks (Gmail, Outlook, Apple Mail).
 * Idempotent; safe on non-email text. Keeps the actual user content after the header run.
 */
export function stripIntakeForwardedNoise(text: string): string {
  let t = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!t.trim()) return t.trim();

  for (let guard = 0; guard < 12; guard++) {
    t = t.trimStart();
    t = demergeForwardedHeadersOnFirstLine(t);
    const next = stripOneForwardBlockFromStart(t);
    if (next === t) break;
    t = next;
  }

  return t.trim();
}

function normalizeIntakeBody(raw: string | null | undefined): string | null {
  if (raw == null || typeof raw !== "string") return null;
  const cleaned = stripIntakeForwardedNoise(raw).trim();
  return cleaned.length > 0 ? cleaned : null;
}

function stripTrailingUrlPunct(url: string): string {
  return url.replace(/[),.;]+$/g, "");
}

function normalizeHttpHref(raw: string): string | null {
  let h = raw.trim();
  if (h.startsWith("//")) h = `https:${h}`;
  if (!/^https?:\/\//i.test(h)) return null;
  return stripTrailingUrlPunct(h);
}

/** Extract first http(s) URL from text (email bodies, share text). */
export function extractFirstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/i);
  if (m) return stripTrailingUrlPunct(m[0]);
  const m2 = text.match(/(?<![\w/:])\/\/[^\s<>"{}|\\^`[\]]+/i);
  if (m2) return stripTrailingUrlPunct(`https:${m2[0]}`);
  return null;
}

/**
 * Rough plain text from HTML for intake preview when providers send empty TextBody
 * (common for forwards / rich clients — links often live only in HtmlBody).
 */
export function htmlToPlainText(html: string, maxLen = 20000): string {
  if (!html.trim()) return "";
  let t = html;
  // Expand anchors first so empty <a href="…"></a> and protocol-relative hrefs still yield visible text.
  t = t.replace(
    /<a\b[^>]*\bhref\s*=\s*["']((?:https?:)?\/\/[^"'\s>]+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_match, rawHref: string, inner: string) => {
      const href = normalizeHttpHref(rawHref);
      const innerT = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (href && innerT) return `${innerT}\n${href}\n`;
      if (href) return `${href}\n`;
      if (innerT) return `${innerT}\n`;
      return "";
    }
  );
  t = t
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
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  t = t.replace(/\s+\n/g, "\n").replace(/\n\s+/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
  return t.slice(0, maxLen);
}

/** First http(s) URL from HTML: prefer href=, else scan stripped text. */
export function extractFirstUrlFromHtml(html: string): string | null {
  if (!html.trim()) return null;
  const href = html.match(/href\s*=\s*["']((?:https?:)?\/\/[^"'>\s]+)/i);
  if (href) {
    const n = normalizeHttpHref(href[1]);
    if (n) return n;
  }
  const plain = htmlToPlainText(html, 50000);
  return extractFirstUrl(plain);
}
