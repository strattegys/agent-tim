import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { notifyDashboardSyncChange } from "@/lib/dashboard-sync-hub";
import { PACKAGE_SIMULATION_JOB_TITLE } from "@/lib/package-simulation";

/**
 * POST /api/crm/packages/reset
 *
 * Resets a package back to DRAFT:
 * 1. Delete all artifacts for workflows in this package
 * 2. Delete all workflow items for workflows in this package
 * 3. Delete all workflows for this package
 * 4. Delete boards for this package
 * 5. Set package stage back to DRAFT
 */
export async function POST(req: NextRequest) {
  try {
    const { packageId, targetStage } = await req.json();
    if (!packageId) {
      return NextResponse.json({ error: "packageId required" }, { status: 400 });
    }

    // 1. Find all workflows for this package
    const wfRows = await query(
      `SELECT id, "boardId" FROM "_workflow" WHERE "packageId" = $1 AND "deletedAt" IS NULL`,
      [packageId]
    );

    const workflowIds = wfRows.map((w: any) => w.id);
    const boardIds = wfRows.map((w: any) => w.boardId).filter(Boolean);

    // Soft-delete CRM persons created only for package simulation (tagged job title)
    await query(
      `UPDATE person p
       SET "deletedAt" = NOW(), "updatedAt" = NOW()
       FROM "_workflow_item" wi
       INNER JOIN "_workflow" w ON w.id = wi."workflowId" AND w."deletedAt" IS NULL
       WHERE w."packageId" = $1
         AND wi."sourceType" = 'person'
         AND wi."sourceId" = p.id
         AND p."jobTitle" = $2
         AND p."deletedAt" IS NULL`,
      [packageId, PACKAGE_SIMULATION_JOB_TITLE]
    );

    // 2. Delete artifacts for these workflows
    for (const wfId of workflowIds) {
      await query(
        `DELETE FROM "_artifact" WHERE "workflowId" = $1`,
        [wfId]
      );
    }

    // 3. Delete content items linked to workflow items
    for (const wfId of workflowIds) {
      const items = await query(
        `SELECT "sourceId", "sourceType" FROM "_workflow_item" WHERE "workflowId" = $1`,
        [wfId]
      );
      for (const item of items) {
        if ((item as any).sourceType === "content") {
          await query(
            `DELETE FROM "_content_item" WHERE id = $1`,
            [(item as any).sourceId]
          );
        }
      }
    }

    // 5. Delete workflow items
    for (const wfId of workflowIds) {
      await query(
        `DELETE FROM "_workflow_item" WHERE "workflowId" = $1`,
        [wfId]
      );
    }

    // 6. Delete workflows
    for (const wfId of workflowIds) {
      await query(
        `DELETE FROM "_workflow" WHERE id = $1`,
        [wfId]
      );
    }

    // 5. Delete boards
    for (const bId of boardIds) {
      await query(
        `DELETE FROM "_board" WHERE id = $1`,
        [bId]
      );
    }

    // 6. Reset package stage (default: keep current stage, or move to targetStage if specified)
    if (targetStage) {
      await query(
        `UPDATE "_package" SET stage = $1, "updatedAt" = NOW() WHERE id = $2`,
        [targetStage, packageId]
      );
    }

    notifyDashboardSyncChange();
    return NextResponse.json({
      ok: true,
      cleared: {
        workflows: workflowIds.length,
        boards: boardIds.length,
      },
    });
  } catch (e: any) {
    console.error("Package reset error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
