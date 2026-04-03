import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import {
  impliedDailyFromPacing,
  impliedDailyFromTargetCount,
  parseScoutTargeting,
  resolveDeliverableForScoutWorkflow,
  type ScoutQueueCampaign,
  type ScoutQueueResponse,
} from "@/lib/scout-queue";
import { parseJsonObject, workflowTypeFromSpec } from "@/lib/workflow-spec";

/**
 * GET /api/crm/scout-queue
 *
 * Active packages with a Scout-owned research-pipeline workflow — progress, pacing, targeting.
 */
export async function GET() {
  try {
    const packages = await query<{
      id: string;
      name: string;
      stage: string;
      spec: unknown;
    }>(
      `SELECT id, name, stage, spec FROM "_package" p
       WHERE p."deletedAt" IS NULL
         AND UPPER(p.stage::text) = 'ACTIVE'`
    );

    const campaigns: ScoutQueueCampaign[] = [];

    for (const pkg of packages) {
      const workflows = await query<{
        id: string;
        name: string;
        spec: unknown;
      }>(
        `SELECT id, name, spec FROM "_workflow" w
         WHERE w."packageId" = $1 AND w."deletedAt" IS NULL
           AND LOWER(TRIM(COALESCE(w."ownerAgent"::text, ''))) = 'scout'
           AND w.stage = 'ACTIVE'`,
        [pkg.id]
      );

      for (const wf of workflows) {
        const wfSpec = parseJsonObject(wf.spec);
        const workflowType = workflowTypeFromSpec(wf.spec) || wfSpec?.workflowType;
        if (String(workflowType || "") !== "research-pipeline") continue;

        const items = await query<{ stage: string; createdAt: Date | string }>(
          `SELECT stage, "createdAt" FROM "_workflow_item"
           WHERE "workflowId" = $1 AND "deletedAt" IS NULL`,
          [wf.id]
        );

        const stageCounts: Record<string, number> = {};
        for (const it of items) {
          const k = String(it.stage || "").toUpperCase();
          stageCounts[k] = (stageCounts[k] || 0) + 1;
        }

        const handedOffCount = stageCounts.HANDED_OFF || 0;
        const rejectedCount = stageCounts.REJECTED || 0;
        const inPipelineCount = items.length - handedOffCount - rejectedCount;

        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const itemsCreatedLast24h = items.filter((it) => {
          const d = it.createdAt instanceof Date ? it.createdAt : new Date(it.createdAt);
          return !Number.isNaN(d.getTime()) && d >= since;
        }).length;

        const targetCount =
          typeof wfSpec?.targetCount === "number" && wfSpec.targetCount >= 0
            ? wfSpec.targetCount
            : 0;

        const deliverable = resolveDeliverableForScoutWorkflow(pkg.spec, "research-pipeline");
        const volumeLabel =
          typeof deliverable?.volumeLabel === "string" && deliverable.volumeLabel.trim()
            ? deliverable.volumeLabel.trim()
            : null;
        const deliverableLabel =
          typeof deliverable?.label === "string" && deliverable.label.trim()
            ? deliverable.label.trim()
            : null;

        const pacing =
          deliverable?.pacing &&
          typeof deliverable.pacing.batchSize === "number" &&
          deliverable.pacing.interval
            ? {
                batchSize: deliverable.pacing.batchSize,
                interval: deliverable.pacing.interval,
                bufferPercent: deliverable.pacing.bufferPercent,
              }
            : null;

        const impliedDailyGoal = impliedDailyFromPacing(deliverable);
        const scoutTargeting = parseScoutTargeting(pkg.spec);
        const configuredDailyGoal =
          scoutTargeting?.dailyNewTargetsGoal != null ? scoutTargeting.dailyNewTargetsGoal : null;

        const pacingDaily = impliedDailyGoal > 0 ? impliedDailyGoal : 0;
        const targetDaily =
          targetCount > 0 ? impliedDailyFromTargetCount(targetCount, handedOffCount) : 0;
        const effectiveDailyGoal = Math.max(
          configuredDailyGoal ?? 0,
          pacingDaily,
          targetDaily
        );

        const progressPercent =
          targetCount > 0 ? Math.min(100, Math.round((handedOffCount / targetCount) * 100)) : 0;

        campaigns.push({
          packageId: pkg.id,
          packageName: String(pkg.name || "Package"),
          packageStage: String(pkg.stage || "").toUpperCase(),
          workflowId: wf.id,
          workflowName: String(wf.name || "Research pipeline"),
          targetCount,
          volumeLabel,
          deliverableLabel,
          pacing,
          impliedDailyGoal: pacingDaily,
          configuredDailyGoal,
          effectiveDailyGoal,
          scoutTargeting,
          stageCounts,
          totalItems: items.length,
          handedOffCount,
          rejectedCount,
          inPipelineCount,
          itemsCreatedLast24h,
          progressPercent,
        });
      }
    }

    const summary = {
      campaignCount: campaigns.length,
      totalEffectiveDailyGoal: campaigns.reduce((s, c) => s + c.effectiveDailyGoal, 0),
      totalHandedOff: campaigns.reduce((s, c) => s + c.handedOffCount, 0),
      totalInPipeline: campaigns.reduce((s, c) => s + c.inPipelineCount, 0),
      totalItemsCreatedLast24h: campaigns.reduce((s, c) => s + c.itemsCreatedLast24h, 0),
    };

    const body: ScoutQueueResponse = { campaigns, summary };
    return NextResponse.json(body);
  } catch (e) {
    console.error("[scout-queue] GET error:", e);
    return NextResponse.json({ error: "Failed to load Scout queue" }, { status: 500 });
  }
}
