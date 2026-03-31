/**
 * Dedupe LinkedIn inbound events (Unipile webhooks + replays) per Postgres person.
 * Requires migrate-linkedin-inbound-receipt.sql + migrate-linkedin-inbound-receipt-outcome.sql on the CRM database.
 */
import { createHash } from "crypto";
import { query } from "@/lib/db";

function isMissingProcessedColumnError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return (
    (/processedAt/i.test(msg) || /processNote/i.test(msg)) &&
    (/does not exist/i.test(msg) || /column/i.test(msg))
  );
}

function isUndefinedTableError(e: unknown): boolean {
  const c = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "";
  return c === "42P01";
}

function isUniqueViolation(e: unknown): boolean {
  const c = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "";
  return c === "23505";
}

/** Stable key when Unipile omits message_id (should be rare). */
export function fallbackUnipileMessageDedupeId(
  chatId: string,
  timestampIso: string,
  messageText: string
): string {
  const h = createHash("sha256")
    .update(`${chatId}\0${timestampIso}\0${messageText}`)
    .digest("hex")
    .slice(0, 32);
  return `synth:${chatId || "nochat"}:${h}`;
}

export type LinkedInInboundReceiptEventKind = "message" | "connection_accepted";

/**
 * Inserts a receipt row. Returns `claimed: true` if this event is new, `false` if already processed.
 * If the table is missing, returns `claimed: true` (no dedupe until migration runs).
 */
export async function tryClaimLinkedInInboundReceipt(args: {
  personId: string;
  unipileMessageId: string;
  chatId: string;
  eventKind: LinkedInInboundReceiptEventKind;
  senderProviderId: string;
  senderDisplayName: string;
}): Promise<{ claimed: boolean }> {
  const mid = args.unipileMessageId.trim();
  if (!mid) return { claimed: true };

  try {
    const rows = await query<{ id: string }>(
      `INSERT INTO "_linkedin_inbound_receipt"
        ("personId", "unipileMessageId", "chatId", "eventKind", "senderProviderId", "senderDisplayName")
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT ("unipileMessageId") DO NOTHING
       RETURNING id`,
      [
        args.personId,
        mid,
        (args.chatId || "").trim(),
        args.eventKind,
        args.senderProviderId?.trim() || null,
        args.senderDisplayName?.trim() || null,
      ]
    );
    return { claimed: rows.length > 0 };
  } catch (e) {
    if (isUndefinedTableError(e)) {
      console.warn(
        "[linkedin-inbound-receipt] Table _linkedin_inbound_receipt missing — run scripts/migrate-linkedin-inbound-receipt.sql (dedupe disabled)."
      );
      return { claimed: true };
    }
    if (isUniqueViolation(e)) {
      return { claimed: false };
    }
    throw e;
  }
}

export type InboundReceiptFinalizeResult =
  | { ok: true }
  | { ok: false; note?: string };

/**
 * Mark a claimed inbound receipt as finished so scheduled replay can distinguish stuck claims
 * from successful webhook handling. Call from a `finally` block after tryClaim returns claimed.
 */
export async function finalizeInboundReceiptProcessing(
  unipileMessageId: string,
  result: InboundReceiptFinalizeResult
): Promise<void> {
  const mid = unipileMessageId.trim();
  if (!mid) return;
  const note =
    result.ok ? null : (result.note?.trim().slice(0, 900) || "processing_failed");
  try {
    await query(
      `UPDATE "_linkedin_inbound_receipt"
       SET "processedAt" = NOW(), "processNote" = $2
       WHERE "unipileMessageId" = $1`,
      [mid, result.ok ? null : note]
    );
  } catch (e) {
    if (isUndefinedTableError(e)) return;
    if (isMissingProcessedColumnError(e)) {
      console.warn(
        "[linkedin-inbound-receipt] processedAt column missing — run scripts/migrate-linkedin-inbound-receipt-outcome.sql"
      );
      return;
    }
    throw e;
  }
}

export type InboundReceiptOrphanRow = {
  id: string;
  unipileMessageId: string;
  eventKind: string;
  createdAt: Date;
  personId: string;
  chatId: string;
  senderDisplayName: string | null;
};

/** Receipt rows where we claimed dedupe but never finalized (crash / timeout / old code). */
export async function listInboundReceiptOrphans(input: {
  olderThanMinutes: number;
  limit?: number;
}): Promise<InboundReceiptOrphanRow[]> {
  const lim = Math.min(500, Math.max(1, input.limit ?? 100));
  const mins = Math.max(1, input.olderThanMinutes);
  try {
    return await query<InboundReceiptOrphanRow>(
      `SELECT id, "unipileMessageId", "eventKind", "createdAt", "personId", "chatId", "senderDisplayName"
       FROM "_linkedin_inbound_receipt"
       WHERE "processedAt" IS NULL
         AND "createdAt" < NOW() - ($1::int * INTERVAL '1 minute')
       ORDER BY "createdAt" ASC
       LIMIT $2`,
      [mins, lim]
    );
  } catch (e) {
    if (isMissingProcessedColumnError(e) || isUndefinedTableError(e)) return [];
    throw e;
  }
}

/**
 * Delete a stale unprocessed receipt so the same Unipile message can be replayed.
 * Only removes rows older than `minAgeMinutes` with processedAt IS NULL.
 */
export async function releaseStaleInboundReceiptForReplay(
  unipileMessageId: string,
  minAgeMinutes: number
): Promise<boolean> {
  const mid = unipileMessageId.trim();
  if (!mid) return false;
  const mins = Math.max(1, minAgeMinutes);
  try {
    const rows = await query<{ id: string }>(
      `DELETE FROM "_linkedin_inbound_receipt"
       WHERE "unipileMessageId" = $1
         AND "processedAt" IS NULL
         AND "createdAt" < NOW() - ($2::int * INTERVAL '1 minute')
       RETURNING id`,
      [mid, mins]
    );
    return rows.length > 0;
  } catch (e) {
    if (isMissingProcessedColumnError(e)) return false;
    throw e;
  }
}

/** Bulk release for cron: stuck claims that never finalized. */
export async function releaseAllStaleUnprocessedInboundReceipts(
  olderThanMinutes: number
): Promise<number> {
  const mins = Math.max(1, olderThanMinutes);
  try {
    const rows = await query<{ id: string }>(
      `DELETE FROM "_linkedin_inbound_receipt"
       WHERE "processedAt" IS NULL
         AND "createdAt" < NOW() - ($1::int * INTERVAL '1 minute')
       RETURNING id`,
      [mins]
    );
    return rows.length;
  } catch (e) {
    if (isMissingProcessedColumnError(e) || isUndefinedTableError(e)) return 0;
    throw e;
  }
}
