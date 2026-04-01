/**
 * Tim’s LinkedIn general inbox + connection intake are normal packages (one workflow each, same name as the package).
 * Ensures `_package` + `_workflow` exist and are linked; backfills `packageId` on legacy unpackaged rows.
 */
import { query } from "@/lib/db";
import { notifyDashboardSyncChange } from "@/lib/dashboard-sync-hub";
import { PACKAGE_TEMPLATES } from "@/lib/package-types";
import { getWorkflowTypeRegistry } from "@/lib/workflow-registry";

export const LINKEDIN_SYSTEM_PACKAGE_TEMPLATE_IDS = new Set([
  "linkedin-general-inbox-package",
  "linkedin-connection-intake-package",
]);

export type TimLinkedInSystemKind = "general-inbox" | "connection-intake";

const KIND = {
  "general-inbox": {
    templateId: "linkedin-general-inbox-package",
    packageName: "LinkedIn — General Inbox",
    workflowType: "linkedin-general-inbox" as const,
    boardName: "LinkedIn — General Inbox",
    boardDescription:
      "Inbound LinkedIn activity not matched to an active package workflow step",
    specWhere: `(
      COALESCE(w.spec::text, '') LIKE '%"workflowType":"linkedin-general-inbox"%'
      OR COALESCE(w.spec::text, '') LIKE '%"workflowType": "linkedin-general-inbox"%'
    )`,
  },
  "connection-intake": {
    templateId: "linkedin-connection-intake-package",
    packageName: "LinkedIn — Connection intake",
    workflowType: "linkedin-connection-intake" as const,
    boardName: "LinkedIn — Connection intake",
    boardDescription:
      "Connection acceptances not tied to an active package outreach step",
    specWhere: `(
      COALESCE(w.spec::text, '') LIKE '%"workflowType":"linkedin-connection-intake"%'
      OR COALESCE(w.spec::text, '') LIKE '%"workflowType": "linkedin-connection-intake"%'
    )`,
  },
} as const;

function packageSpecJson(templateId: string): string {
  const tmpl = PACKAGE_TEMPLATES[templateId];
  if (!tmpl) throw new Error(`[linkedin-system-package] Missing template ${templateId}`);
  return JSON.stringify({
    templateId: tmpl.id,
    deliverables: tmpl.deliverables,
  });
}

async function getOrCreateSystemPackageId(cfg: (typeof KIND)[TimLinkedInSystemKind]): Promise<string> {
  const found = await query<{ id: string }>(
    `SELECT id FROM "_package"
     WHERE "deletedAt" IS NULL AND "templateId" = $1 AND name = $2
     ORDER BY "createdAt" ASC
     LIMIT 1`,
    [cfg.templateId, cfg.packageName]
  );
  if (found.length > 0) return String(found[0].id);

  const rows = await query<{ id: string }>(
    `INSERT INTO "_package" ("templateId", name, "customerId", "customerType", spec, stage, "createdBy", "createdAt", "updatedAt")
     VALUES ($1, $2, NULL, 'person', $3::jsonb, 'ACTIVE', 'friday', NOW(), NOW())
     RETURNING id`,
    [cfg.templateId, cfg.packageName, packageSpecJson(cfg.templateId)]
  );
  return String(rows[0].id);
}

async function findWorkflowForKind(
  cfg: (typeof KIND)[TimLinkedInSystemKind]
): Promise<{ id: string; packageId: string | null } | null> {
  const rows = await query<{ id: string; packageId: string | null }>(
    `SELECT w.id, w."packageId"::text AS "packageId"
     FROM "_workflow" w
     WHERE w."deletedAt" IS NULL
       AND LOWER(TRIM(COALESCE(w."ownerAgent"::text, ''))) = 'tim'
       AND ${cfg.specWhere}
     ORDER BY w."createdAt" ASC
     LIMIT 1`
  );
  const r = rows[0];
  if (!r) return null;
  return { id: String(r.id), packageId: r.packageId ? String(r.packageId) : null };
}

async function findWorkflowOnPackage(
  packageId: string,
  cfg: (typeof KIND)[TimLinkedInSystemKind]
): Promise<string | null> {
  const rows = await query<{ id: string }>(
    `SELECT w.id
     FROM "_workflow" w
     WHERE w."deletedAt" IS NULL
       AND w."packageId" = $1::uuid
       AND ${cfg.specWhere}
     ORDER BY w."createdAt" ASC
     LIMIT 1`,
    [packageId]
  );
  return rows[0]?.id ? String(rows[0].id) : null;
}

async function createBoardAndWorkflow(
  packageId: string,
  cfg: (typeof KIND)[TimLinkedInSystemKind]
): Promise<string> {
  const reg = await getWorkflowTypeRegistry();
  const tmpl = reg.get(cfg.workflowType);
  if (!tmpl) throw new Error(`Missing workflow type ${cfg.workflowType}`);
  const boardRows = await query<{ id: string }>(
    `INSERT INTO "_board" (name, description, stages, transitions, "createdAt", "updatedAt")
     VALUES ($1, $2, $3::jsonb, $4::jsonb, NOW(), NOW()) RETURNING id`,
    [
      cfg.boardName,
      cfg.boardDescription,
      JSON.stringify(tmpl.defaultBoard.stages),
      JSON.stringify(tmpl.defaultBoard.transitions),
    ]
  );
  const boardId = String(boardRows[0].id);
  const spec = JSON.stringify({
    targetCount: 0,
    workflowType: cfg.workflowType,
    pacing: null,
  });
  const wfRows = await query<{ id: string }>(
    `INSERT INTO "_workflow" (name, spec, "itemType", "boardId", "ownerAgent", "packageId", stage, "createdAt", "updatedAt")
     VALUES ($1, $2::jsonb, $3, $4, 'tim', $5::uuid, 'ACTIVE', NOW(), NOW()) RETURNING id`,
    [cfg.packageName, spec, tmpl.itemType, boardId, packageId]
  );
  return String(wfRows[0].id);
}

/**
 * Returns the workflow id for this system inbox/intake pipeline, creating or linking package + workflow as needed.
 */
let warmOperationalLinkedInPackagesPromise: Promise<void> | null = null;

/**
 * Idempotent: ensures both Tim LinkedIn system packages exist (for Friday operational queue / CRM consistency).
 * Cached per process — safe to call from operational package list GET.
 */
export function warmOperationalTimLinkedInSystemPackages(): Promise<void> {
  if (!warmOperationalLinkedInPackagesPromise) {
    warmOperationalLinkedInPackagesPromise = (async () => {
      await ensureTimLinkedInSystemPackageWorkflow("general-inbox");
      await ensureTimLinkedInSystemPackageWorkflow("connection-intake");
    })();
  }
  return warmOperationalLinkedInPackagesPromise;
}

export async function ensureTimLinkedInSystemPackageWorkflow(
  kind: TimLinkedInSystemKind
): Promise<string> {
  const cfg = KIND[kind];

  const existing = await findWorkflowForKind(cfg);
  if (existing) {
    if (!existing.packageId) {
      const packageId = await getOrCreateSystemPackageId(cfg);
      await query(
        `UPDATE "_workflow" SET "packageId" = $1::uuid, "updatedAt" = NOW() WHERE id = $2::uuid AND "deletedAt" IS NULL`,
        [packageId, existing.id]
      );
      await query(
        `UPDATE "_package" SET stage = 'ACTIVE', "updatedAt" = NOW() WHERE id = $1::uuid AND "deletedAt" IS NULL`,
        [packageId]
      );
      notifyDashboardSyncChange();
    }
    return existing.id;
  }

  const packageId = await getOrCreateSystemPackageId(cfg);
  const onPkg = await findWorkflowOnPackage(packageId, cfg);
  if (onPkg) {
    notifyDashboardSyncChange();
    return onPkg;
  }

  const workflowId = await createBoardAndWorkflow(packageId, cfg);
  notifyDashboardSyncChange();
  return workflowId;
}
