/**
 * Non-packaged LinkedIn connection acceptances → Tim queue (separate from message general inbox).
 */
import { query } from "@/lib/db";
import { WORKFLOW_TYPES } from "@/lib/workflow-types";
import { resolvePrimaryPostgresPersonForLinkedInInbound } from "@/lib/linkedin-general-inbox";
import { syncHumanTaskOpenForItem } from "@/lib/workflow-item-human-task";

const INTAKE_TYPE = "linkedin-connection-intake" as const;
const INTAKE_STAGE = "CONNECTION_ACCEPTED";

let ensureWorkflowPromise: Promise<string> | null = null;

async function createConnectionIntakeWorkflow(): Promise<string> {
  const tmpl = WORKFLOW_TYPES[INTAKE_TYPE];
  const boardResult = await query<{ id: string }>(
    `INSERT INTO "_board" (name, description, stages, transitions, "createdAt", "updatedAt")
     VALUES ($1, $2, $3::jsonb, $4::jsonb, NOW(), NOW()) RETURNING id`,
    [
      "LinkedIn — Connection intake",
      "Connection acceptances not tied to an active package outreach step",
      JSON.stringify(tmpl.defaultBoard.stages),
      JSON.stringify(tmpl.defaultBoard.transitions),
    ]
  );
  const boardId = boardResult[0].id;
  const spec = JSON.stringify({ workflowType: INTAKE_TYPE });
  const wfResult = await query<{ id: string }>(
    `INSERT INTO "_workflow" (name, spec, "itemType", "boardId", "ownerAgent", "packageId", stage, "createdAt", "updatedAt")
     VALUES ($1, $2::jsonb, $3, $4, $5, NULL, 'ACTIVE', NOW(), NOW()) RETURNING id`,
    ["LinkedIn — Connection intake", spec, tmpl.itemType, boardId, "tim"]
  );
  return wfResult[0].id;
}

export async function ensureLinkedInConnectionIntakeWorkflowId(): Promise<string> {
  if (!ensureWorkflowPromise) {
    ensureWorkflowPromise = (async () => {
      const existing = await query<{ id: string }>(
        `SELECT w.id
         FROM "_workflow" w
         WHERE w."deletedAt" IS NULL
           AND w."packageId" IS NULL
           AND LOWER(TRIM(COALESCE(w."ownerAgent"::text, ''))) = 'tim'
           AND (
             COALESCE(w.spec::text, '') LIKE '%"workflowType":"linkedin-connection-intake"%'
             OR COALESCE(w.spec::text, '') LIKE '%"workflowType": "linkedin-connection-intake"%'
           )
         ORDER BY w."createdAt" ASC
         LIMIT 1`
      );
      if (existing.length > 0) return existing[0].id;
      return createConnectionIntakeWorkflow();
    })();
  }
  return ensureWorkflowPromise;
}

async function findOpenIntakeItem(workflowId: string, personId: string): Promise<string | null> {
  const rows = await query<{ id: string }>(
    `SELECT wi.id
     FROM "_workflow_item" wi
     WHERE wi."workflowId" = $1
       AND wi."sourceType" = 'person'
       AND wi."sourceId" = $2
       AND UPPER(TRIM(wi.stage::text)) = $3
       AND wi."deletedAt" IS NULL`,
    [workflowId, personId, INTAKE_STAGE]
  );
  return rows[0]?.id ?? null;
}

async function findAnyIntakeItemForPerson(workflowId: string, personId: string): Promise<string | null> {
  const rows = await query<{ id: string; deletedAt: Date | null }>(
    `SELECT wi.id, wi."deletedAt"
     FROM "_workflow_item" wi
     WHERE wi."workflowId" = $1
       AND wi."sourceType" = 'person'
       AND wi."sourceId" = $2
     ORDER BY (wi."deletedAt" IS NULL) DESC, wi."updatedAt" DESC NULLS LAST
     LIMIT 1`,
    [workflowId, personId]
  );
  const r = rows[0];
  if (!r) return null;
  if (r.deletedAt != null) {
    await query(
      `UPDATE "_workflow_item" SET "deletedAt" = NULL, "updatedAt" = NOW() WHERE id = $1`,
      [r.id]
    );
  }
  return r.id;
}

/**
 * Queue a Tim task when a connection is accepted and no packaged linkedin-outreach INITIATED row matched.
 */
export async function recordLinkedInConnectionAccepted(args: {
  crmContactId: string;
  senderProviderId: string;
  senderDisplayName: string;
  timestampIso?: string;
  chatId?: string;
}): Promise<{ ok: boolean; reason?: string; workflowItemId?: string }> {
  const primaryPersonId = await resolvePrimaryPostgresPersonForLinkedInInbound({
    crmContactId: args.crmContactId,
    senderProviderId: args.senderProviderId,
    senderDisplayName: args.senderDisplayName,
  });
  if (!primaryPersonId) {
    return {
      ok: false,
      reason:
        "No Postgres person and could not create one — need Unipile sender id (attendee_provider_id) on the webhook payload.",
    };
  }

  const workflowId = await ensureLinkedInConnectionIntakeWorkflowId();
  const ts = args.timestampIso || new Date().toISOString();
  const body = [
    "## LinkedIn — connection accepted (intake)",
    "",
    `**Contact:** ${args.senderDisplayName}`,
    args.senderProviderId ? `**Provider id:** ${args.senderProviderId}` : "",
    args.chatId ? `**Chat ID:** ${args.chatId}` : "",
    `**Recorded:** ${ts}`,
    "",
    "_They accepted your invitation — no active package outreach step was waiting on this connection._",
    "",
    "### Next step",
    "- **Tim:** Recommend what to do: add them to an active **package** workflow (e.g. warm-outreach or linkedin-outreach at the right stage), keep them in CRM only, or treat as low priority.",
    "- **You:** **Submit** when you’ve decided (or after acting). **Dismiss** if no follow-up.",
    "- **Move to a package workflow:** `POST /api/crm/workflow-items` with `workflowId`, `sourceType: \"person\"`, `sourceId` (this person’s id), `stage` (target stage on that workflow), and optional **`closeIntakeItemId`** set to this queue item’s id to soft-delete this intake row after the new row is created.",
  ].join("\n");

  let itemId =
    (await findOpenIntakeItem(workflowId, primaryPersonId)) ??
    (await findAnyIntakeItemForPerson(workflowId, primaryPersonId));

  if (!itemId) {
    const ins = await query<{ id: string }>(
      `INSERT INTO "_workflow_item" ("workflowId", stage, "sourceType", "sourceId", "position", "createdAt", "updatedAt", "humanTaskOpen")
       VALUES ($1, $2, 'person', $3, 0, NOW(), NOW(), true)
       RETURNING id`,
      [workflowId, INTAKE_STAGE, primaryPersonId]
    );
    itemId = ins[0].id;
  }

  await query(
    `INSERT INTO "_artifact" ("workflowItemId", "workflowId", stage, name, type, content, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
    [
      itemId,
      workflowId,
      INTAKE_STAGE,
      "LinkedIn: connection accepted",
      "markdown",
      body,
    ]
  );

  await syncHumanTaskOpenForItem(itemId);
  return { ok: true, workflowItemId: itemId };
}
