/**
 * Unmatched LinkedIn webhook events → Tim’s active work queue (general inbox workflow).
 * Packaged warm-outreach / linkedin-outreach steps are handled elsewhere before this runs.
 */
import { query } from "@/lib/db";
import { WORKFLOW_TYPES } from "@/lib/workflow-types";
import {
  findLinkedinOutreachItemsAtInitiated,
  resolvePostgresPersonIdsForLinkedInSender,
} from "@/lib/warm-outreach-inbound-reply";
import { syncHumanTaskOpenForItem } from "@/lib/workflow-item-human-task";

const GENERAL_INBOX_TYPE = "linkedin-general-inbox" as const;
const GENERAL_STAGE = "LINKEDIN_INBOUND";

let ensureWorkflowPromise: Promise<string> | null = null;

async function createGeneralInboxWorkflow(): Promise<string> {
  const tmpl = WORKFLOW_TYPES[GENERAL_INBOX_TYPE];
  const boardResult = await query<{ id: string }>(
    `INSERT INTO "_board" (name, description, stages, transitions, "createdAt", "updatedAt")
     VALUES ($1, $2, $3::jsonb, $4::jsonb, NOW(), NOW()) RETURNING id`,
    [
      "LinkedIn — General Inbox",
      "Inbound LinkedIn activity not matched to an active package workflow step",
      JSON.stringify(tmpl.defaultBoard.stages),
      JSON.stringify(tmpl.defaultBoard.transitions),
    ]
  );
  const boardId = boardResult[0].id;
  const spec = JSON.stringify({ workflowType: GENERAL_INBOX_TYPE });
  const wfResult = await query<{ id: string }>(
    `INSERT INTO "_workflow" (name, spec, "itemType", "boardId", "ownerAgent", "packageId", stage, "createdAt", "updatedAt")
     VALUES ($1, $2::jsonb, $3, $4, $5, NULL, 'ACTIVE', NOW(), NOW()) RETURNING id`,
    [
      "LinkedIn — General Inbox",
      spec,
      tmpl.itemType,
      boardId,
      "tim",
    ]
  );
  return wfResult[0].id;
}

/** Lazy-create a single non-package workflow Tim uses for unmatched LinkedIn events. */
export async function ensureGeneralLinkedInInboxWorkflowId(): Promise<string> {
  if (!ensureWorkflowPromise) {
    ensureWorkflowPromise = (async () => {
      const existing = await query<{ id: string }>(
        `SELECT w.id
         FROM "_workflow" w
         WHERE w."deletedAt" IS NULL
           AND w."packageId" IS NULL
           AND LOWER(TRIM(COALESCE(w."ownerAgent"::text, ''))) = 'tim'
           AND (
             COALESCE(w.spec::text, '') LIKE '%"workflowType":"linkedin-general-inbox"%'
             OR COALESCE(w.spec::text, '') LIKE '%"workflowType": "linkedin-general-inbox"%'
           )
         ORDER BY w."createdAt" ASC
         LIMIT 1`
      );
      if (existing.length > 0) return existing[0].id;
      return createGeneralInboxWorkflow();
    })();
  }
  return ensureWorkflowPromise;
}

async function findOpenGeneralInboxItem(
  workflowId: string,
  personId: string
): Promise<string | null> {
  const rows = await query<{ id: string }>(
    `SELECT wi.id
     FROM "_workflow_item" wi
     WHERE wi."workflowId" = $1
       AND wi."sourceType" = 'person'
       AND wi."sourceId" = $2
       AND UPPER(TRIM(wi.stage::text)) = $3
       AND wi."deletedAt" IS NULL`,
    [workflowId, personId, GENERAL_STAGE]
  );
  return rows[0]?.id ?? null;
}

export type GeneralInboxEventKind = "message" | "connection_accepted";

/**
 * When no packaged workflow consumed the event, queue a Tim task with the payload in an artifact.
 */
export async function recordGeneralLinkedInInbound(args: {
  crmContactId: string;
  senderProviderId: string;
  senderDisplayName: string;
  eventKind: GeneralInboxEventKind;
  messageText?: string;
  chatId?: string;
  timestampIso?: string;
}): Promise<{ ok: boolean; reason?: string; workflowItemId?: string }> {
  const personIds = await resolvePostgresPersonIdsForLinkedInSender(
    args.crmContactId,
    args.senderProviderId,
    args.senderDisplayName
  );
  if (personIds.length === 0) {
    return {
      ok: false,
      reason: "No Postgres person row matched — CRM note still written; link LinkedIn on the person for queue routing.",
    };
  }

  const workflowId = await ensureGeneralLinkedInInboxWorkflowId();
  const ts = args.timestampIso || new Date().toISOString();
  const header =
    args.eventKind === "connection_accepted"
      ? "## LinkedIn — connection accepted (general inbox)"
      : "## LinkedIn — inbound message (general inbox)";
  const body = [
    header,
    "",
    `**From:** ${args.senderDisplayName}`,
    args.senderProviderId ? `**Provider id:** ${args.senderProviderId}` : "",
    args.chatId ? `**Chat ID:** ${args.chatId}` : "",
    `**Recorded:** ${ts}`,
    "",
    args.eventKind === "message"
      ? args.messageText?.trim() || "_(empty body)_"
      : "_No message body — new connection accepted._",
  ]
    .filter(Boolean)
    .join("\n");

  const primaryPersonId = personIds[0];
  let itemId = await findOpenGeneralInboxItem(workflowId, primaryPersonId);

  if (!itemId) {
    const ins = await query<{ id: string }>(
      `INSERT INTO "_workflow_item" ("workflowId", stage, "sourceType", "sourceId", "position", "createdAt", "updatedAt", "humanTaskOpen")
       VALUES ($1, $2, 'person', $3, 0, NOW(), NOW(), true)
       RETURNING id`,
      [workflowId, GENERAL_STAGE, primaryPersonId]
    );
    itemId = ins[0].id;
  }

  await query(
    `INSERT INTO "_artifact" ("workflowItemId", "workflowId", stage, name, type, content, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
    [
      itemId,
      workflowId,
      GENERAL_STAGE,
      args.eventKind === "connection_accepted"
        ? "LinkedIn: connection accepted"
        : "LinkedIn: inbound message",
      "markdown",
      body,
    ]
  );

  await syncHumanTaskOpenForItem(itemId);
  return { ok: true, workflowItemId: itemId };
}

/** True if this person has a packaged linkedin-outreach row waiting on connection acceptance. */
export async function hasPackagedLinkedinOutreachPendingAcceptance(personId: string): Promise<boolean> {
  const ids = await findLinkedinOutreachItemsAtInitiated(personId);
  return ids.length > 0;
}
