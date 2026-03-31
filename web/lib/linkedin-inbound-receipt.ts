/**
 * Dedupe LinkedIn inbound events (Unipile webhooks + replays) per Postgres person.
 * Requires migrate-linkedin-inbound-receipt.sql on the CRM database.
 */
import { createHash } from "crypto";
import { query } from "@/lib/db";

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
