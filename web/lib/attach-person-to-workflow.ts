/**
 * Shared path for attaching an existing person to a workflow item row (package pipelines, etc.)
 * and optionally closing a Tim LinkedIn intake queue row.
 */
import { query } from "@/lib/db";
import { notifyDashboardSyncChange } from "@/lib/dashboard-sync-hub";
import { assertPersonMayAttachToPackagedWorkflow } from "@/lib/person-packaged-workflow-exclusivity";
import { syncHumanTaskOpenForItem } from "@/lib/workflow-item-human-task";

export async function validateCloseIntakeRow(
  closeIntakeItemId: string,
  personId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const rows = await query<{ id: string }>(
    `SELECT wi.id
     FROM "_workflow_item" wi
     INNER JOIN "_workflow" w ON w.id = wi."workflowId" AND w."deletedAt" IS NULL
     WHERE wi.id = $1::uuid
       AND wi."deletedAt" IS NULL
       AND wi."sourceType" = 'person'
       AND wi."sourceId"::text = $2
       AND LOWER(TRIM(COALESCE(w."ownerAgent"::text, ''))) = 'tim'
       AND (
         COALESCE(w.spec::text, '') LIKE '%linkedin-connection-intake%'
         OR (
           COALESCE(w.spec::text, '') LIKE '%linkedin-general-inbox%'
           AND UPPER(TRIM(wi.stage::text)) = 'LINKEDIN_INBOUND'
         )
       )`,
    [closeIntakeItemId, personId]
  );
  if (rows.length === 0) {
    return {
      ok: false,
      error:
        "closeIntakeItemId must reference a Tim LinkedIn intake row (connection intake or message inbox) for the same person",
    };
  }
  return { ok: true };
}

export type AttachPersonToWorkflowResult =
  | { ok: true; id: string; closedIntakeItemId?: string }
  | { ok: false; error: string };

export async function attachPersonToWorkflow(params: {
  workflowId: string;
  stage: string;
  sourceType: string;
  sourceId: string;
  closeIntakeItemId?: string | null;
}): Promise<AttachPersonToWorkflowResult> {
  const { workflowId, stage, sourceType, sourceId, closeIntakeItemId } = params;
  if (!workflowId?.trim() || !stage?.trim() || !sourceType?.trim() || !sourceId?.trim()) {
    return { ok: false, error: "workflowId, stage, sourceType, and sourceId are required" };
  }
  if (sourceType !== "person") {
    return { ok: false, error: "Only sourceType person is supported for attach-person-to-workflow" };
  }
  if (closeIntakeItemId?.trim()) {
    const v = await validateCloseIntakeRow(closeIntakeItemId.trim(), sourceId.trim());
    if (!v.ok) return v;
  }

  const wf = await query<{ itemType: string }>(
    `SELECT "itemType" FROM "_workflow" WHERE id = $1::uuid AND "deletedAt" IS NULL`,
    [workflowId.trim()]
  );
  if (wf.length === 0) return { ok: false, error: "Workflow not found" };
  if (wf[0].itemType !== "person") {
    return { ok: false, error: "Target workflow must have itemType person" };
  }

  const exclusivity = await assertPersonMayAttachToPackagedWorkflow({
    personId: sourceId.trim(),
    targetWorkflowId: workflowId.trim(),
    closeIntakeItemId,
  });
  if (!exclusivity.ok) {
    return { ok: false, error: exclusivity.error };
  }

  try {
    const rows = await query<{ id: string }>(
      `INSERT INTO "_workflow_item" ("workflowId", stage, "sourceType", "sourceId", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       RETURNING id`,
      [workflowId.trim(), stage.trim(), sourceType.trim(), sourceId.trim()]
    );
    const newId = rows[0].id;
    await syncHumanTaskOpenForItem(newId);

    const closeId = closeIntakeItemId?.trim() || null;
    if (closeId) {
      await query(
        `UPDATE "_artifact" SET "deletedAt" = NOW(), "updatedAt" = NOW()
         WHERE "workflowItemId" = $1::uuid AND "deletedAt" IS NULL`,
        [closeId]
      );
      await query(
        `UPDATE "_workflow_item" SET "deletedAt" = NOW(), "humanTaskOpen" = false, "updatedAt" = NOW()
         WHERE id = $1::uuid AND "deletedAt" IS NULL`,
        [closeId]
      );
    }

    notifyDashboardSyncChange();
    return { ok: true, id: newId, closedIntakeItemId: closeId || undefined };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "";
    if (code === "23505" || /unique|duplicate/i.test(msg)) {
      return {
        ok: false,
        error:
          "This person already has a row on that workflow. Remove the duplicate or pick a different workflow before attaching again.",
      };
    }
    return { ok: false, error: msg };
  }
}
