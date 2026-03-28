import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { syncHumanTaskOpenForItem } from "@/lib/workflow-item-human-task";
import { workflowTypeFromSpec } from "@/lib/workflow-spec";
import { notifyDashboardSyncChange } from "@/lib/dashboard-sync-hub";

/** Stages where user can reset to IDEA (not PUBLISHED — live content). */
const ROLLBACK_FROM_STAGES = new Set([
  "CAMPAIGN_SPEC",
  "DRAFTING",
  "REVIEW",
  "DRAFT_PUBLISHED",
]);

/** Post-IDEA pipeline artifacts to remove; IDEA rows stay so the original idea text remains. */
const ARTIFACT_STAGES_TO_CLEAR = [
  "CAMPAIGN_SPEC",
  "DRAFTING",
  "REVIEW",
  "DRAFT_PUBLISHED",
];

/**
 * POST { itemId } — content-pipeline only: soft-delete post-IDEA artifacts, move item to IDEA.
 * Preserves the IDEA artifact (what Govind submitted) so they can re-approve / regenerate spec & draft.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const itemId = typeof body.itemId === "string" ? body.itemId.trim() : "";
    if (!itemId) {
      return NextResponse.json({ error: "itemId is required" }, { status: 400 });
    }

    const items = await query<{ id: string; stage: string; workflowId: string }>(
      `SELECT id, stage, "workflowId" FROM "_workflow_item" WHERE id = $1::uuid AND "deletedAt" IS NULL`,
      [itemId]
    );
    if (items.length === 0) {
      return NextResponse.json({ error: "Workflow item not found" }, { status: 404 });
    }
    const item = items[0];
    const stage = (item.stage || "").trim().toUpperCase();
    if (!ROLLBACK_FROM_STAGES.has(stage)) {
      return NextResponse.json(
        {
          error: `Rollback to IDEA is only available from ${[...ROLLBACK_FROM_STAGES].join(", ")} (current: ${item.stage}).`,
        },
        { status: 400 }
      );
    }

    const wfRows = await query<{ spec: unknown }>(
      `SELECT spec FROM "_workflow" WHERE id = $1 AND "deletedAt" IS NULL`,
      [item.workflowId]
    );
    if (wfRows.length === 0) {
      return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
    }
    const wfType = workflowTypeFromSpec(wfRows[0].spec);
    if (wfType !== "content-pipeline") {
      return NextResponse.json(
        { error: "Only content-pipeline items support this rollback." },
        { status: 400 }
      );
    }

    await query(
      `UPDATE "_artifact" SET "deletedAt" = NOW(), "updatedAt" = NOW()
       WHERE "workflowItemId"::text = $1
         AND UPPER(TRIM(stage::text)) = ANY($2::text[])
         AND "deletedAt" IS NULL`,
      [itemId, ARTIFACT_STAGES_TO_CLEAR]
    );

    await query(
      `UPDATE "_workflow_item" SET stage = 'IDEA', "updatedAt" = NOW() WHERE id = $1::uuid AND "deletedAt" IS NULL`,
      [itemId]
    );

    await syncHumanTaskOpenForItem(itemId);

    notifyDashboardSyncChange();
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[rollback-to-idea]", e);
    return NextResponse.json({ error: "Rollback failed" }, { status: 500 });
  }
}
