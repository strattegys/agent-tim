import { NextResponse } from "next/server";
import { query } from "@/lib/db";

/**
 * GET /api/crm/workflow-stats
 *
 * Returns all workflows enriched with:
 * - item counts grouped by board stage
 * - alert counts (LinkedIn replies / connection accepted)
 * - board stages for rendering
 */

interface WorkflowStatsRow {
  [key: string]: unknown;
  id: string;
  name: string;
  stage: string;
  spec: string;
  itemType: string;
  boardId: string | null;
  updatedAt: string | null;
  board_stages: unknown;
  board_transitions: unknown;
  board_name: string | null;
}

interface ItemCountRow {
  [key: string]: unknown;
  workflowId: string;
  stage: string;
  count: string;
}

interface AlertCountRow {
  [key: string]: unknown;
  workflowId: string;
  alert_count: string;
}

export async function GET() {
  try {
    // 1. Fetch all workflows with board data
    const workflows = await query<WorkflowStatsRow>(
      `SELECT w.id, w.name, w.stage, w.spec, w."itemType", w."boardId",
              w."updatedAt", w."ownerAgent",
              b.stages AS board_stages, b.transitions AS board_transitions,
              b.name AS board_name
       FROM "_workflow" w
       LEFT JOIN "_board" b ON b.id = w."boardId" AND b."deletedAt" IS NULL
       WHERE w."deletedAt" IS NULL
       ORDER BY w.name ASC NULLS LAST
       LIMIT 100`
    );

    if (workflows.length === 0) {
      return NextResponse.json({ workflows: [] });
    }

    const wfIds = workflows.map((w) => w.id);

    // 2. Item counts per workflow per stage
    const itemCounts = await query<ItemCountRow>(
      `SELECT "workflowId", stage, COUNT(*)::text AS count
       FROM "_workflow_item"
       WHERE "workflowId" = ANY($1) AND "deletedAt" IS NULL
       GROUP BY "workflowId", stage`,
      [wfIds]
    );

    // 3. Alert counts per workflow (person workflows only)
    const personWfIds = workflows
      .filter((w) => (w.itemType || "person") === "person")
      .map((w) => w.id);

    let alertCounts: AlertCountRow[] = [];
    if (personWfIds.length > 0) {
      alertCounts = await query<AlertCountRow>(
        `SELECT wi."workflowId",
                COUNT(DISTINCT nt."targetPersonId")::text AS alert_count
         FROM "_workflow_item" wi
         JOIN "noteTarget" nt ON nt."targetPersonId" = wi."sourceId" AND nt."deletedAt" IS NULL
         JOIN note n ON n.id = nt."noteId" AND n."deletedAt" IS NULL
         WHERE wi."workflowId" = ANY($1)
           AND wi."sourceType" = 'person'
           AND wi."deletedAt" IS NULL
           AND (n.title LIKE 'LinkedIn Message from%' OR n.title LIKE 'LinkedIn Connection Accepted%')
           AND n."createdAt" = (
             SELECT MAX(n2."createdAt")
             FROM "noteTarget" nt2
             JOIN note n2 ON n2.id = nt2."noteId" AND n2."deletedAt" IS NULL
             WHERE nt2."targetPersonId" = wi."sourceId" AND nt2."deletedAt" IS NULL
           )
         GROUP BY wi."workflowId"`,
        [personWfIds]
      );
    }

    // Build lookup maps
    const itemsByWorkflow: Record<string, Record<string, number>> = {};
    for (const row of itemCounts) {
      if (!itemsByWorkflow[row.workflowId]) itemsByWorkflow[row.workflowId] = {};
      itemsByWorkflow[row.workflowId][row.stage] = parseInt(row.count, 10);
    }

    const alertsByWorkflow: Record<string, number> = {};
    for (const row of alertCounts) {
      alertsByWorkflow[row.workflowId] = parseInt(row.alert_count, 10);
    }

    // Assemble response
    const result = workflows.map((w) => {
      const stageCounts = itemsByWorkflow[w.id] || {};
      const totalItems = Object.values(stageCounts).reduce((a, b) => a + b, 0);
      return {
        id: w.id,
        name: w.name,
        stage: w.stage,
        spec: w.spec,
        itemType: w.itemType || "person",
        ownerAgent: (w as Record<string, unknown>).ownerAgent as string | null,
        updatedAt: w.updatedAt,
        boardName: w.board_name,
        boardStages: w.board_stages || [],
        totalItems,
        stageCounts,
        alertCount: alertsByWorkflow[w.id] || 0,
      };
    });

    return NextResponse.json({ workflows: result });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to fetch workflow stats";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
