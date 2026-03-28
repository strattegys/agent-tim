import { NextRequest, NextResponse } from "next/server";
import {
  allowOrphanPackageMigrationApi,
  listOrphanWorkflows,
  migrateOrphanWorkflowsToPackages,
  parsePackageMigrationExcludeIds,
} from "@/lib/migrate-orphan-workflows-to-packages";
import { notifyDashboardSyncChange } from "@/lib/dashboard-sync-hub";

const CLI_HINT =
  "From the web/ folder run: npm run migrate:orphan-workflows (or set ALLOW_ORPHAN_PACKAGE_MIGRATION=1 for this API).";

/**
 * GET — list workflows with no package (legacy Friday board rows).
 * POST — create one DRAFT package per orphan and link workflow.packageId (gated).
 */
export async function GET() {
  try {
    const orphans = await listOrphanWorkflows();
    return NextResponse.json({
      orphans,
      count: orphans.length,
      migrateAllowed: allowOrphanPackageMigrationApi(),
    });
  } catch (error) {
    console.error("[orphan-workflows] GET error:", error);
    return NextResponse.json(
      { error: "Failed to list orphan workflows", orphans: [], count: 0 },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!allowOrphanPackageMigrationApi()) {
      return NextResponse.json(
        {
          error: "Orphan migration via API is disabled in this environment.",
          hint: CLI_HINT,
        },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dryRun === true;
    const exclude = parsePackageMigrationExcludeIds();

    const result = await migrateOrphanWorkflowsToPackages(dryRun, exclude);
    if (!dryRun) notifyDashboardSyncChange();
    return NextResponse.json({
      ok: true,
      ...result,
      excludedByEnv: exclude.size,
    });
  } catch (error) {
    console.error("[orphan-workflows] POST error:", error);
    return NextResponse.json(
      { error: "Migration failed", hint: CLI_HINT },
      { status: 500 }
    );
  }
}
