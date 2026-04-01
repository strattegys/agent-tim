/**
 * One person should not hold multiple active packaged pipeline rows at once (e.g. Agent Army +
 * Tim LinkedIn connection intake). "Blocking" package stages: planned work, not completed ops.
 */
import { query } from "@/lib/db";
import { LINKEDIN_SYSTEM_PACKAGE_TEMPLATE_IDS } from "@/lib/ensure-tim-linkedin-system-package-workflow";

/** Package stages where the org still treats the package as holding live / planned pipeline work. */
export const BLOCKING_PACKAGE_STAGES = ["ACTIVE", "PAUSED", "DRAFT", "PENDING_APPROVAL"] as const;

export type BlockingPackagedWorkflowItem = {
  itemId: string;
  workflowId: string;
  workflowName: string;
  packageId: string;
  packageStage: string;
  templateId: string;
  packageName: string;
  itemUpdatedAt: string;
};

export function isTimLinkedInSystemPackageTemplateId(templateId: string | null | undefined): boolean {
  const t = (templateId || "").trim();
  return Boolean(t && LINKEDIN_SYSTEM_PACKAGE_TEMPLATE_IDS.has(t));
}

function blockingStagesSqlList(): string {
  return BLOCKING_PACKAGE_STAGES.map((s) => `'${s}'`).join(", ");
}

/**
 * Non-deleted person workflow items on workflows that belong to a package in a blocking stage.
 */
export async function findPersonBlockingPackagedWorkflowItems(
  personId: string
): Promise<BlockingPackagedWorkflowItem[]> {
  const stages = blockingStagesSqlList();
  return query<BlockingPackagedWorkflowItem>(
    `SELECT wi.id::text AS "itemId",
            wi."workflowId"::text AS "workflowId",
            COALESCE(w.name, '') AS "workflowName",
            p.id::text AS "packageId",
            UPPER(TRIM(COALESCE(p.stage::text, ''))) AS "packageStage",
            COALESCE(p."templateId", '') AS "templateId",
            COALESCE(p.name, '') AS "packageName",
            wi."updatedAt"::text AS "itemUpdatedAt"
     FROM "_workflow_item" wi
     INNER JOIN "_workflow" w ON w.id = wi."workflowId" AND w."deletedAt" IS NULL
     INNER JOIN "_package" p ON p.id = w."packageId" AND p."deletedAt" IS NULL
     WHERE wi."sourceType" = 'person'
       AND wi."sourceId" = $1::uuid
       AND wi."deletedAt" IS NULL
       AND w."packageId" IS NOT NULL
       AND UPPER(TRIM(COALESCE(p.stage::text, ''))) IN (${stages})
     ORDER BY wi."updatedAt" DESC NULLS LAST`,
    [personId]
  );
}

type TargetWorkflowPackaging = {
  workflowId: string;
  packageId: string | null;
  packageStage: string | null;
  templateId: string | null;
};

async function loadTargetWorkflowPackaging(workflowId: string): Promise<TargetWorkflowPackaging | null> {
  const rows = await query<{
    workflowId: string;
    packageId: string | null;
    packageStage: string | null;
    templateId: string | null;
  }>(
    `SELECT w.id::text AS "workflowId",
            w."packageId"::text AS "packageId",
            CASE WHEN p.id IS NULL THEN NULL ELSE UPPER(TRIM(COALESCE(p.stage::text, ''))) END AS "packageStage",
            CASE WHEN p.id IS NULL THEN NULL ELSE COALESCE(p."templateId", '') END AS "templateId"
     FROM "_workflow" w
     LEFT JOIN "_package" p ON p.id = w."packageId" AND p."deletedAt" IS NULL
     WHERE w.id = $1::uuid AND w."deletedAt" IS NULL`,
    [workflowId]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    workflowId: r.workflowId,
    packageId: r.packageId,
    packageStage: r.packageStage,
    templateId: r.templateId,
  };
}

function isBlockingPackageStage(stage: string | null | undefined): boolean {
  if (!stage) return false;
  return (BLOCKING_PACKAGE_STAGES as readonly string[]).includes(stage.toUpperCase());
}

/**
 * True if the person already has at least one blocking packaged row on a **customer** pipeline
 * (not Tim LinkedIn system intake). Used to skip creating new connection-intake / general-inbox rows.
 */
export async function personHasNonSystemBlockingPackagedWorkflow(personId: string): Promise<boolean> {
  const rows = await findPersonBlockingPackagedWorkflowItems(personId);
  return rows.some((r) => !isTimLinkedInSystemPackageTemplateId(r.templateId));
}

export type AttachPackagedWorkflowCheck =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Enforces: attaching a person to a **blocking** packaged workflow is allowed only if they are not
 * already on another blocking packaged workflow, except:
 * - They only have Tim LinkedIn system intake/inbox rows and `closeIntakeItemId` identifies one of those rows (closed after attach).
 */
export async function assertPersonMayAttachToPackagedWorkflow(args: {
  personId: string;
  targetWorkflowId: string;
  closeIntakeItemId?: string | null;
}): Promise<AttachPackagedWorkflowCheck> {
  const target = await loadTargetWorkflowPackaging(args.targetWorkflowId.trim());
  if (!target) {
    return { ok: false, error: "Target workflow not found" };
  }
  if (!target.packageId || !isBlockingPackageStage(target.packageStage)) {
    return { ok: true };
  }

  const existing = await findPersonBlockingPackagedWorkflowItems(args.personId.trim());
  const conflicts = existing.filter((e) => e.workflowId !== target.workflowId);
  if (conflicts.length === 0) {
    return { ok: true };
  }

  const nonSystem = conflicts.filter((c) => !isTimLinkedInSystemPackageTemplateId(c.templateId));
  if (nonSystem.length > 0) {
    const lines = nonSystem
      .map(
        (c) =>
          `• ${c.packageName || c.packageId} (${c.packageStage}) — ${c.workflowName || c.workflowId} [item ${c.itemId.slice(0, 8)}…]`
      )
      .join("\n");
    return {
      ok: false,
      error:
        `This person is already on another active or planned package pipeline. Remove or complete that row before adding them here.\n${lines}`,
    };
  }

  const closeId = (args.closeIntakeItemId || "").trim();
  if (closeId && conflicts.some((c) => c.itemId === closeId)) {
    return { ok: true };
  }

  const intakeLines = conflicts
    .map(
      (c) =>
        `• Tim LinkedIn queue: ${c.workflowName || c.workflowId} [item ${c.itemId.slice(0, 8)}…]`
    )
    .join("\n");
  return {
    ok: false,
    error:
      `This person still has a Tim LinkedIn intake/inbox queue row. Use **Move to workflow** with **closeIntakeItemId** set to that row’s id, or dismiss the intake row first.\n${intakeLines}`,
  };
}
