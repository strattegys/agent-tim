import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

/**
 * GET /api/crm/packages/progress?packageId=xxx
 *
 * Returns stage counts for each workflow in a package.
 * Response: {
 *   workflows: {
 *     [workflowId]: {
 *       name: string,
 *       ownerAgent: string,
 *       workflowType: string,
 *       stageCounts: { [stageKey]: number }
 *     }
 *   }
 * }
 */
export async function GET(req: NextRequest) {
  const packageId = req.nextUrl.searchParams.get("packageId");
  if (!packageId) {
    return NextResponse.json({ error: "packageId required" }, { status: 400 });
  }

  // Get all workflows for this package
  const workflows = await query<{
    id: string;
    name: string;
    ownerAgent: string;
    spec: { workflowType?: string };
  }>(
    `SELECT id, name, "ownerAgent", spec FROM "_workflow" WHERE "packageId" = $1 AND "deletedAt" IS NULL`,
    [packageId]
  );

  const result: Record<string, {
    name: string;
    ownerAgent: string;
    workflowType: string;
    targetCount: number;
    totalItems: number;
    stageCounts: Record<string, number>;
    artifactStages: string[];
    pacing: { batchSize: number; interval: string; bufferPercent?: number } | null;
  }> = {};

  for (const wf of workflows) {
    const spec = typeof wf.spec === "string" ? JSON.parse(wf.spec) : wf.spec;

    // Get items and count by stage
    const items = await query<{ stage: string }>(
      `SELECT stage FROM "_workflow_item" WHERE "workflowId" = $1 AND "deletedAt" IS NULL`,
      [wf.id]
    );

    const stageCounts: Record<string, number> = {};
    for (const item of items) {
      stageCounts[item.stage] = (stageCounts[item.stage] || 0) + 1;
    }

    // Get stages that have artifacts
    const artifacts = await query<{ stage: string }>(
      `SELECT DISTINCT stage FROM "_artifact" WHERE "workflowId" = $1 AND "deletedAt" IS NULL`,
      [wf.id]
    );
    const artifactStages = artifacts.map(a => a.stage);

    result[wf.id] = {
      name: wf.name,
      ownerAgent: wf.ownerAgent,
      workflowType: spec?.workflowType || "",
      targetCount: spec?.targetCount || 0,
      totalItems: items.length,
      stageCounts,
      artifactStages,
      pacing: spec?.pacing || null,
    };
  }

  return NextResponse.json({ workflows: result });
}
