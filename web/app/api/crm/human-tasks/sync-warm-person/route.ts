import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { resolveWorkflowRegistryId, workflowTypeFromSpec } from "@/lib/workflow-spec";
import {
  syncWarmDiscoveryFromIntakeArtifacts,
  syncWarmPersonFromIntakeArtifacts,
} from "@/lib/warm-contact-intake-apply";
import { WARM_DISCOVERY_SOURCE_TYPE } from "@/lib/warm-discovery-item";
import { notifyDashboardSyncChange } from "@/lib/dashboard-sync-hub";

/**
 * POST { itemId } — apply intake artifacts to CRM: either link/create `person` for a `warm_discovery`
 * slot, or copy fields onto the legacy Next/Contact placeholder person. Use if resolve skipped CRM update.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const itemId = typeof body?.itemId === "string" ? body.itemId.trim() : "";
    if (!itemId) {
      return NextResponse.json({ error: "itemId is required" }, { status: 400 });
    }

    const items = await query<{
      id: string;
      workflowId: string;
      sourceType: string;
      sourceId: string;
    }>(
      `SELECT id, "workflowId", "sourceType", "sourceId"
       FROM "_workflow_item"
       WHERE id = $1 AND "deletedAt" IS NULL`,
      [itemId]
    );
    if (items.length === 0) {
      return NextResponse.json({ error: "Workflow item not found" }, { status: 404 });
    }
    const row = items[0];

    const workflows = await query<{ spec: unknown }>(
      `SELECT spec FROM "_workflow" WHERE id = $1 AND "deletedAt" IS NULL`,
      [row.workflowId]
    );
    if (workflows.length === 0) {
      return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
    }
    const wt = workflowTypeFromSpec(workflows[0].spec);
    const wfTypeRaw = typeof wt === "string" ? wt.trim() : "";
    const wfTypeId = resolveWorkflowRegistryId(wfTypeRaw || null) ?? "";
    const specText =
      typeof workflows[0].spec === "string"
        ? workflows[0].spec
        : JSON.stringify(workflows[0].spec ?? {});
    const looksWarm =
      wfTypeId === "warm-outreach" || /warm[-_\s]?outreach/i.test(specText);
    if (!looksWarm) {
      return NextResponse.json(
        { error: "Only warm-outreach workflow items can sync this way" },
        { status: 400 }
      );
    }

    const logs: string[] = [];

    if (row.sourceType === WARM_DISCOVERY_SOURCE_TYPE) {
      const synced = await syncWarmDiscoveryFromIntakeArtifacts(itemId, logs);
      notifyDashboardSyncChange();
      return NextResponse.json({ ok: true, synced, logs });
    }

    if (row.sourceType !== "person" || !row.sourceId) {
      return NextResponse.json({ error: "Item is not a person workflow row" }, { status: 400 });
    }

    const synced = await syncWarmPersonFromIntakeArtifacts(itemId, row.sourceId, logs);
    notifyDashboardSyncChange();
    return NextResponse.json({ ok: true, synced, logs });
  } catch (e) {
    console.error("[sync-warm-person]", e);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
