/**
 * LinkedIn connection acceptances without a packaged outreach row → Tim queue (system package + workflow).
 */
import { query } from "@/lib/db";
import {
  ensurePersonLinkedInFromUnipileWebhook,
  resolvePrimaryPostgresPersonForLinkedInInbound,
} from "@/lib/linkedin-general-inbox";
import { personHasNonSystemBlockingPackagedWorkflow } from "@/lib/person-packaged-workflow-exclusivity";
import { syncHumanTaskOpenForItem } from "@/lib/workflow-item-human-task";
import { ensureTimLinkedInSystemPackageWorkflow } from "@/lib/ensure-tim-linkedin-system-package-workflow";

const INTAKE_STAGE = "CONNECTION_ACCEPTED";

let ensureWorkflowPromise: Promise<string> | null = null;

export async function ensureLinkedInConnectionIntakeWorkflowId(): Promise<string> {
  if (!ensureWorkflowPromise) {
    ensureWorkflowPromise = (async () =>
      ensureTimLinkedInSystemPackageWorkflow("connection-intake"))();
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
       AND wi."deletedAt" IS NULL
     ORDER BY wi."updatedAt" DESC NULLS LAST, wi."createdAt" DESC
     LIMIT 1`,
    [workflowId, personId, INTAKE_STAGE]
  );
  return rows[0]?.id ?? null;
}

/**
 * Multiple CONNECTION_ACCEPTED rows for the same person (race, retries before stable receipt dedupe)
 * duplicate Tim’s queue. Keep newest, repoint artifacts, soft-delete the rest.
 */
async function mergeDuplicateActiveConnectionIntakeRows(
  workflowId: string,
  personId: string
): Promise<void> {
  const rows = await query<{ id: string }>(
    `SELECT wi.id
     FROM "_workflow_item" wi
     WHERE wi."workflowId" = $1
       AND wi."sourceType" = 'person'
       AND wi."sourceId" = $2
       AND UPPER(TRIM(wi.stage::text)) = $3
       AND wi."deletedAt" IS NULL
     ORDER BY wi."updatedAt" DESC NULLS LAST, wi."createdAt" DESC`,
    [workflowId, personId, INTAKE_STAGE]
  );
  if (rows.length <= 1) return;
  const keeper = rows[0].id;
  for (let i = 1; i < rows.length; i++) {
    const loserId = rows[i].id;
    await query(
      `UPDATE "_artifact"
       SET "workflowItemId" = $1::uuid, "updatedAt" = NOW()
       WHERE "workflowItemId" = $2::uuid AND "deletedAt" IS NULL`,
      [keeper, loserId]
    );
    await query(
      `UPDATE "_workflow_item"
       SET "deletedAt" = NOW(), "humanTaskOpen" = false, "updatedAt" = NOW()
       WHERE id = $1::uuid`,
      [loserId]
    );
  }
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

  await ensurePersonLinkedInFromUnipileWebhook(primaryPersonId, args.senderProviderId);

  if (await personHasNonSystemBlockingPackagedWorkflow(primaryPersonId)) {
    return {
      ok: false,
      reason:
        "Person is already on an active or planned package pipeline (e.g. outreach) — skipping Tim LinkedIn connection-intake queue row.",
    };
  }

  const workflowId = await ensureLinkedInConnectionIntakeWorkflowId();
  await mergeDuplicateActiveConnectionIntakeRows(workflowId, primaryPersonId);
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
