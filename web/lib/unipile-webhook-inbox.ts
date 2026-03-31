/**
 * Durable Unipile webhook queue: INSERT payload before responding 200, then drain.
 * Survives process restarts; locks expire so stuck rows retry.
 */
import { query } from "@/lib/db";
import { handleUnipileWebhook } from "@/lib/linkedin-webhook";

function isUndefinedTableError(e: unknown): boolean {
  const c = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "";
  return c === "42P01";
}

/** When false, webhook route skips persistence (legacy direct handle only). */
export function isUnipileWebhookInboxEnabled(): boolean {
  const v = process.env.UNIPILE_WEBHOOK_DURABLE_INBOX?.trim().toLowerCase();
  if (v === "0" || v === "false") return false;
  return true;
}

const LOCK_STALE_MINUTES = 15;

export async function enqueueUnipileWebhookPayload(payload: unknown): Promise<string | null> {
  if (!isUnipileWebhookInboxEnabled()) return null;
  try {
    const rows = await query<{ id: string }>(
      `INSERT INTO "_unipile_webhook_inbox" (payload, "receivedAt")
       VALUES ($1::jsonb, NOW())
       RETURNING id`,
      [JSON.stringify(payload ?? {})]
    );
    return rows[0]?.id ?? null;
  } catch (e) {
    if (isUndefinedTableError(e)) {
      console.warn(
        "[unipile-webhook-inbox] Table missing — run scripts/migrate-unipile-webhook-inbox.sql"
      );
      return null;
    }
    throw e;
  }
}

async function markInboxProcessed(id: string): Promise<void> {
  await query(
    `UPDATE "_unipile_webhook_inbox"
     SET "processedAt" = NOW(), "lockedAt" = NULL, "processNote" = NULL
     WHERE id = $1`,
    [id]
  );
}

async function markInboxFailed(id: string, note: string): Promise<void> {
  await query(
    `UPDATE "_unipile_webhook_inbox"
     SET "lockedAt" = NULL, "processNote" = $2
     WHERE id = $1`,
    [id, note.slice(0, 900)]
  );
}

/** Claim and process one row by id (newest enqueue fast path). */
export async function processUnipileWebhookInboxRowById(id: string): Promise<boolean> {
  let payload: unknown = null;
  try {
    const claimed = await query<{ payload: unknown }>(
      `UPDATE "_unipile_webhook_inbox"
       SET "lockedAt" = NOW(), attempts = attempts + 1
       WHERE id = $1
         AND "processedAt" IS NULL
         AND (
           "lockedAt" IS NULL
           OR "lockedAt" < NOW() - ($2::int * INTERVAL '1 minute')
         )
       RETURNING payload`,
      [id, LOCK_STALE_MINUTES]
    );
    if (claimed.length === 0) return false;
    payload = claimed[0].payload;
    await handleUnipileWebhook(payload as Parameters<typeof handleUnipileWebhook>[0]);
    await markInboxProcessed(id);
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[unipile-webhook-inbox] process id=%s failed:", id.slice(0, 8), msg);
    try {
      await markInboxFailed(id, msg);
    } catch {
      /* ignore */
    }
    return false;
  }
}

export type DrainUnipileWebhookInboxResult = {
  processed: number;
  failed: number;
  claimed: number;
};

/**
 * Claim up to `maxRows` pending rows (SKIP LOCKED), run handleUnipileWebhook each, mark result.
 */
export async function drainUnipileWebhookInbox(maxRows: number): Promise<DrainUnipileWebhookInboxResult> {
  const cap = Math.min(200, Math.max(1, maxRows));
  let processed = 0;
  let failed = 0;

  let claimed: { id: string; payload: unknown }[] = [];
  try {
    claimed = await query<{ id: string; payload: unknown }>(
      `WITH c AS (
         SELECT id
         FROM "_unipile_webhook_inbox"
         WHERE "processedAt" IS NULL
           AND (
             "lockedAt" IS NULL
             OR "lockedAt" < NOW() - ($1::int * INTERVAL '1 minute')
           )
         ORDER BY "receivedAt" ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $2
       )
       UPDATE "_unipile_webhook_inbox" i
       SET "lockedAt" = NOW(), attempts = i.attempts + 1
       FROM c
       WHERE i.id = c.id
       RETURNING i.id, i.payload`,
      [LOCK_STALE_MINUTES, cap]
    );
  } catch (e) {
    if (isUndefinedTableError(e)) {
      return { processed: 0, failed: 0, claimed: 0 };
    }
    throw e;
  }

  for (const row of claimed) {
    try {
      await handleUnipileWebhook(row.payload as Parameters<typeof handleUnipileWebhook>[0]);
      await markInboxProcessed(row.id);
      processed++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[unipile-webhook-inbox] drain row failed:", row.id.slice(0, 8), msg);
      await markInboxFailed(row.id, msg);
      failed++;
    }
  }

  return { processed, failed, claimed: claimed.length };
}

/** After enqueue: process that row first, then drain backlog (same request “warmth”). */
export async function flushUnipileWebhookInboxAfterEnqueue(
  inboxId: string | null,
  extraDrain: number
): Promise<void> {
  if (inboxId) {
    await processUnipileWebhookInboxRowById(inboxId);
  }
  const n = Math.min(100, Math.max(0, extraDrain));
  if (n > 0) {
    await drainUnipileWebhookInbox(n);
  }
}

export async function countPendingUnipileWebhookInbox(): Promise<number> {
  try {
    const [{ c }] = await query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM "_unipile_webhook_inbox" WHERE "processedAt" IS NULL`
    );
    return parseInt(c, 10) || 0;
  } catch (e) {
    if (isUndefinedTableError(e)) return 0;
    throw e;
  }
}
