/**
 * Tim messaging: one row per LinkedIn inbound receipt (dedupe by Unipile message id),
 * with optional lateral match to a Tim-owned workflow_item for the same person.
 */
import { query } from "@/lib/db";

const MESSAGING_STAGES_SQL_IN = [
  "INITIATED",
  "AWAITING_CONTACT",
  "MESSAGE_DRAFT",
  "MESSAGED",
  "DRAFT_MESSAGE",
  "SENT_MESSAGE",
  "REPLIED",
  "REPLY_DRAFT",
  "REPLY_SENT",
  "AWAITING_THEIR_REPLY",
  "FOLLOW_UP_ONE_DRAFT",
  "FOLLOW_UP_ONE_SENT",
  "AWAITING_AFTER_FOLLOW_UP_ONE",
  "FOLLOW_UP_TWO_DRAFT",
  "FOLLOW_UP_TWO_SENT",
  "AWAITING_AFTER_FOLLOW_UP_TWO",
  "LINKEDIN_INBOUND",
  "CONNECTION_ACCEPTED",
]
  .map((s) => `'${s}'`)
  .join(", ");

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code: string }).code);
  }
  return undefined;
}

function isMissingColumn(error: unknown, name: string): boolean {
  const msg = errMsg(error);
  const re = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  if (errCode(error) === "42703" && re.test(msg)) return true;
  return re.test(msg) && (/column/i.test(msg) || /field/i.test(msg)) && /does not exist/i.test(msg);
}

function isUndefinedRelation(error: unknown, tableFragment: string): boolean {
  if (errCode(error) !== "42P01") return false;
  return errMsg(error).toLowerCase().includes(tableFragment.toLowerCase());
}

export type TimLinkedInInboundFeedRow = {
  receiptId: string;
  personId: string;
  chatId: string;
  senderDisplayName: string | null;
  messageSentAt: string | null;
  createdAt: string;
  unipileMessageId: string;
  personFirstName: string | null;
  personLastName: string | null;
  personCompanyName: string | null;
  linkedItemId: string | null;
  linkedWorkflowId: string | null;
  linkedStage: string | null;
  linkedWorkflowName: string | null;
  linkedWorkflowSpec: unknown;
  linkedBoardStages: unknown;
};

const BASE_FEED_SQL = `
SELECT
  r.id AS "receiptId",
  r."personId" AS "personId",
  r."chatId" AS "chatId",
  r."senderDisplayName" AS "senderDisplayName",
  r."messageSentAt" AS "messageSentAt",
  r."createdAt" AS "createdAt",
  r."unipileMessageId" AS "unipileMessageId",
  p."nameFirstName" AS "personFirstName",
  p."nameLastName" AS "personLastName",
  NULLIF(TRIM(COALESCE(c.name, '')), '') AS "personCompanyName",
  li."linkedItemId",
  li."linkedWorkflowId",
  li."linkedStage",
  li."linkedWorkflowName",
  li."linkedWorkflowSpec",
  li."linkedBoardStages"
FROM "_linkedin_inbound_receipt" r
INNER JOIN person p ON p.id = r."personId" AND p."deletedAt" IS NULL
LEFT JOIN company c ON c.id = p."companyId" AND c."deletedAt" IS NULL
LEFT JOIN LATERAL (
  SELECT
    wi.id AS "linkedItemId",
    wi."workflowId" AS "linkedWorkflowId",
    wi.stage AS "linkedStage",
    w.name AS "linkedWorkflowName",
    w.spec AS "linkedWorkflowSpec",
    b.stages AS "linkedBoardStages"
  FROM "_workflow_item" wi
  INNER JOIN "_workflow" w ON w.id = wi."workflowId" AND w."deletedAt" IS NULL
  LEFT JOIN "_board" b ON b.id = w."boardId" AND b."deletedAt" IS NULL
  WHERE wi."deletedAt" IS NULL
    AND LOWER(TRIM(COALESCE(wi."sourceType"::text, ''))) = 'person'
    AND wi."sourceId" = r."personId"
    AND LOWER(TRIM(COALESCE(w."ownerAgent"::text, ''))) = 'tim'
    AND UPPER(TRIM(wi.stage::text)) IN (${MESSAGING_STAGES_SQL_IN})
  ORDER BY
    CASE UPPER(TRIM(wi.stage::text))
      WHEN 'LINKEDIN_INBOUND' THEN 0
      WHEN 'CONNECTION_ACCEPTED' THEN 1
      WHEN 'MESSAGED' THEN 2
      WHEN 'REPLY_DRAFT' THEN 3
      WHEN 'MESSAGE_DRAFT' THEN 4
      ELSE 5
    END,
    wi."updatedAt" DESC NULLS LAST,
    wi."createdAt" DESC
  LIMIT 1
) li ON true
WHERE LOWER(TRIM(COALESCE(r."eventKind"::text, ''))) = 'message'
ORDER BY COALESCE(r."messageSentAt", r."createdAt") DESC NULLS LAST
LIMIT $1
`;

const FEED_SQL_NO_MSG_SENT = `
SELECT
  r.id AS "receiptId",
  r."personId" AS "personId",
  r."chatId" AS "chatId",
  r."senderDisplayName" AS "senderDisplayName",
  NULL::timestamptz AS "messageSentAt",
  r."createdAt" AS "createdAt",
  r."unipileMessageId" AS "unipileMessageId",
  p."nameFirstName" AS "personFirstName",
  p."nameLastName" AS "personLastName",
  NULLIF(TRIM(COALESCE(c.name, '')), '') AS "personCompanyName",
  li."linkedItemId",
  li."linkedWorkflowId",
  li."linkedStage",
  li."linkedWorkflowName",
  li."linkedWorkflowSpec",
  li."linkedBoardStages"
FROM "_linkedin_inbound_receipt" r
INNER JOIN person p ON p.id = r."personId" AND p."deletedAt" IS NULL
LEFT JOIN company c ON c.id = p."companyId" AND c."deletedAt" IS NULL
LEFT JOIN LATERAL (
  SELECT
    wi.id AS "linkedItemId",
    wi."workflowId" AS "linkedWorkflowId",
    wi.stage AS "linkedStage",
    w.name AS "linkedWorkflowName",
    w.spec AS "linkedWorkflowSpec",
    b.stages AS "linkedBoardStages"
  FROM "_workflow_item" wi
  INNER JOIN "_workflow" w ON w.id = wi."workflowId" AND w."deletedAt" IS NULL
  LEFT JOIN "_board" b ON b.id = w."boardId" AND b."deletedAt" IS NULL
  WHERE wi."deletedAt" IS NULL
    AND LOWER(TRIM(COALESCE(wi."sourceType"::text, ''))) = 'person'
    AND wi."sourceId" = r."personId"
    AND LOWER(TRIM(COALESCE(w."ownerAgent"::text, ''))) = 'tim'
    AND UPPER(TRIM(wi.stage::text)) IN (${MESSAGING_STAGES_SQL_IN})
  ORDER BY
    CASE UPPER(TRIM(wi.stage::text))
      WHEN 'LINKEDIN_INBOUND' THEN 0
      WHEN 'CONNECTION_ACCEPTED' THEN 1
      WHEN 'MESSAGED' THEN 2
      WHEN 'REPLY_DRAFT' THEN 3
      WHEN 'MESSAGE_DRAFT' THEN 4
      ELSE 5
    END,
    wi."updatedAt" DESC NULLS LAST,
    wi."createdAt" DESC
  LIMIT 1
) li ON true
WHERE LOWER(TRIM(COALESCE(r."eventKind"::text, ''))) = 'message'
ORDER BY r."createdAt" DESC NULLS LAST
LIMIT $1
`;

const FEED_SQL_NO_COMPANY = `
SELECT
  r.id AS "receiptId",
  r."personId" AS "personId",
  r."chatId" AS "chatId",
  r."senderDisplayName" AS "senderDisplayName",
  r."messageSentAt" AS "messageSentAt",
  r."createdAt" AS "createdAt",
  r."unipileMessageId" AS "unipileMessageId",
  p."nameFirstName" AS "personFirstName",
  p."nameLastName" AS "personLastName",
  NULL::text AS "personCompanyName",
  li."linkedItemId",
  li."linkedWorkflowId",
  li."linkedStage",
  li."linkedWorkflowName",
  li."linkedWorkflowSpec",
  li."linkedBoardStages"
FROM "_linkedin_inbound_receipt" r
INNER JOIN person p ON p.id = r."personId" AND p."deletedAt" IS NULL
LEFT JOIN LATERAL (
  SELECT
    wi.id AS "linkedItemId",
    wi."workflowId" AS "linkedWorkflowId",
    wi.stage AS "linkedStage",
    w.name AS "linkedWorkflowName",
    w.spec AS "linkedWorkflowSpec",
    b.stages AS "linkedBoardStages"
  FROM "_workflow_item" wi
  INNER JOIN "_workflow" w ON w.id = wi."workflowId" AND w."deletedAt" IS NULL
  LEFT JOIN "_board" b ON b.id = w."boardId" AND b."deletedAt" IS NULL
  WHERE wi."deletedAt" IS NULL
    AND LOWER(TRIM(COALESCE(wi."sourceType"::text, ''))) = 'person'
    AND wi."sourceId" = r."personId"
    AND LOWER(TRIM(COALESCE(w."ownerAgent"::text, ''))) = 'tim'
    AND UPPER(TRIM(wi.stage::text)) IN (${MESSAGING_STAGES_SQL_IN})
  ORDER BY
    CASE UPPER(TRIM(wi.stage::text))
      WHEN 'LINKEDIN_INBOUND' THEN 0
      WHEN 'CONNECTION_ACCEPTED' THEN 1
      WHEN 'MESSAGED' THEN 2
      WHEN 'REPLY_DRAFT' THEN 3
      WHEN 'MESSAGE_DRAFT' THEN 4
      ELSE 5
    END,
    wi."updatedAt" DESC NULLS LAST,
    wi."createdAt" DESC
  LIMIT 1
) li ON true
WHERE LOWER(TRIM(COALESCE(r."eventKind"::text, ''))) = 'message'
ORDER BY COALESCE(r."messageSentAt", r."createdAt") DESC NULLS LAST
LIMIT $1
`;

const FEED_SQL_NO_COMPANY_NO_MSG_SENT = `
SELECT
  r.id AS "receiptId",
  r."personId" AS "personId",
  r."chatId" AS "chatId",
  r."senderDisplayName" AS "senderDisplayName",
  NULL::timestamptz AS "messageSentAt",
  r."createdAt" AS "createdAt",
  r."unipileMessageId" AS "unipileMessageId",
  p."nameFirstName" AS "personFirstName",
  p."nameLastName" AS "personLastName",
  NULL::text AS "personCompanyName",
  li."linkedItemId",
  li."linkedWorkflowId",
  li."linkedStage",
  li."linkedWorkflowName",
  li."linkedWorkflowSpec",
  li."linkedBoardStages"
FROM "_linkedin_inbound_receipt" r
INNER JOIN person p ON p.id = r."personId" AND p."deletedAt" IS NULL
LEFT JOIN LATERAL (
  SELECT
    wi.id AS "linkedItemId",
    wi."workflowId" AS "linkedWorkflowId",
    wi.stage AS "linkedStage",
    w.name AS "linkedWorkflowName",
    w.spec AS "linkedWorkflowSpec",
    b.stages AS "linkedBoardStages"
  FROM "_workflow_item" wi
  INNER JOIN "_workflow" w ON w.id = wi."workflowId" AND w."deletedAt" IS NULL
  LEFT JOIN "_board" b ON b.id = w."boardId" AND b."deletedAt" IS NULL
  WHERE wi."deletedAt" IS NULL
    AND LOWER(TRIM(COALESCE(wi."sourceType"::text, ''))) = 'person'
    AND wi."sourceId" = r."personId"
    AND LOWER(TRIM(COALESCE(w."ownerAgent"::text, ''))) = 'tim'
    AND UPPER(TRIM(wi.stage::text)) IN (${MESSAGING_STAGES_SQL_IN})
  ORDER BY
    CASE UPPER(TRIM(wi.stage::text))
      WHEN 'LINKEDIN_INBOUND' THEN 0
      WHEN 'CONNECTION_ACCEPTED' THEN 1
      WHEN 'MESSAGED' THEN 2
      WHEN 'REPLY_DRAFT' THEN 3
      WHEN 'MESSAGE_DRAFT' THEN 4
      ELSE 5
    END,
    wi."updatedAt" DESC NULLS LAST,
    wi."createdAt" DESC
  LIMIT 1
) li ON true
WHERE LOWER(TRIM(COALESCE(r."eventKind"::text, ''))) = 'message'
ORDER BY r."createdAt" DESC NULLS LAST
LIMIT $1
`;

/** Recent inbound messages for Tim’s unified queue (default cap 200). */
export async function fetchTimLinkedInInboundFeedRows(limit: number): Promise<TimLinkedInInboundFeedRow[]> {
  const lim = Math.min(500, Math.max(1, limit));
  try {
    try {
      return await query<TimLinkedInInboundFeedRow>(BASE_FEED_SQL, [lim]);
    } catch (e) {
      if (isMissingColumn(e, "messageSentAt")) {
        return await query<TimLinkedInInboundFeedRow>(FEED_SQL_NO_MSG_SENT, [lim]);
      }
      if (isMissingColumn(e, "companyId") || isMissingColumn(e, "company")) {
        try {
          return await query<TimLinkedInInboundFeedRow>(FEED_SQL_NO_COMPANY, [lim]);
        } catch (e2) {
          if (isMissingColumn(e2, "messageSentAt")) {
            return await query<TimLinkedInInboundFeedRow>(FEED_SQL_NO_COMPANY_NO_MSG_SENT, [lim]);
          }
          throw e2;
        }
      }
      throw e;
    }
  } catch (e) {
    if (isUndefinedRelation(e, "_linkedin_inbound_receipt")) {
      return [];
    }
    throw e;
  }
}

export async function countTimLinkedInInboundMessageReceipts(): Promise<number> {
  try {
    const rows = await query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM "_linkedin_inbound_receipt"
       WHERE LOWER(TRIM(COALESCE("eventKind"::text, ''))) = 'message'`
    );
    const n = parseInt(rows[0]?.c || "0", 10);
    return Number.isFinite(n) ? n : 0;
  } catch (e) {
    if (isUndefinedRelation(e, "_linkedin_inbound_receipt")) return 0;
    throw e;
  }
}
