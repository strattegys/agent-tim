import { NextResponse, type NextRequest } from "next/server";
import { query } from "@/lib/db";
import type { Board, WorkflowItemType } from "@/lib/board-types";
import { notifyDashboardSyncChange } from "@/lib/dashboard-sync-hub";
import { pushWorkflowObservabilityEvent } from "@/lib/workflow-observability-buffer";

interface WorkflowRow {
  [key: string]: unknown;
  id: string;
  name: string;
  stage: string;
  spec: string;
  itemType: WorkflowItemType;
  boardId: string | null;
  board_id: string | null;
  board_name: string | null;
  board_description: string | null;
  board_stages: unknown;
  board_transitions: unknown;
}

export async function GET(request: NextRequest) {
  try {
    const agentFilter = request.nextUrl.searchParams.get("agent");
    const limitRaw = request.nextUrl.searchParams.get("limit");
    let limit = 50;
    if (limitRaw != null) {
      const n = parseInt(limitRaw, 10);
      if (!Number.isNaN(n)) limit = Math.min(200, Math.max(1, n));
    }

    const params: unknown[] = [];
    let whereClause = 'WHERE w."deletedAt" IS NULL';
    if (agentFilter) {
      params.push(agentFilter);
      whereClause += ` AND w."ownerAgent" = $${params.length}`;
    }
    params.push(limit);

    const rows = await query<WorkflowRow>(
      `SELECT w.id, w.name, w.stage, w.spec, w."itemType", w."boardId", w."ownerAgent", w."packageId",
              p.name AS package_name, p."packageNumber" AS package_number,
              b.id AS board_id, b.name AS board_name, b.description AS board_description,
              b.stages AS board_stages, b.transitions AS board_transitions
       FROM "_workflow" w
       LEFT JOIN "_board" b ON b.id = w."boardId" AND b."deletedAt" IS NULL
       LEFT JOIN "_package" p ON p.id = w."packageId" AND p."deletedAt" IS NULL
       ${whereClause}
       ORDER BY p.name ASC NULLS LAST, w.name ASC NULLS LAST
       LIMIT $${params.length}`,
      params
    );
    const workflows = rows.map((r) => ({
      id: r.id,
      name: r.name,
      stage: r.stage,
      spec: r.spec,
      itemType: r.itemType || "person",
      boardId: r.boardId,
      ownerAgent: (r as Record<string, unknown>).ownerAgent as string | null,
      packageId: (r as Record<string, unknown>).packageId as string | null,
      packageName: ((r as Record<string, unknown>).package_name as string | null) ?? null,
      packageNumber:
        (r as Record<string, unknown>).package_number != null
          ? Number((r as Record<string, unknown>).package_number)
          : null,
      board: r.board_id
        ? ({
            id: r.board_id,
            name: r.board_name,
            description: r.board_description,
            stages: r.board_stages,
            transitions: r.board_transitions,
          } as Board)
        : null,
    }));
    return NextResponse.json({ workflows });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to fetch workflows";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { name, spec, itemType, boardId, ownerAgent } = await request.json();
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (!boardId) {
      return NextResponse.json({ error: "boardId is required" }, { status: 400 });
    }
    const validTypes: WorkflowItemType[] = ["person", "content"];
    const type = validTypes.includes(itemType) ? itemType : "person";

    const rows = await query<{ id: string }>(
      `INSERT INTO "_workflow" (name, spec, "itemType", "boardId", "ownerAgent", stage, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, 'PLANNING', NOW(), NOW())
       RETURNING id`,
      [name, spec || "", type, boardId, ownerAgent || null]
    );
    pushWorkflowObservabilityEvent("workflow_created", {
      workflowId: rows[0].id,
      name,
      itemType: type,
      boardId,
      ownerAgent: ownerAgent || null,
    });
    notifyDashboardSyncChange();
    return NextResponse.json({ id: rows[0].id });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to create workflow";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { id, stage, boardId, spec, itemType, ownerAgent } = await request.json();
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const sets: string[] = ['"updatedAt" = NOW()'];
    const params: unknown[] = [];
    let idx = 1;

    if (stage !== undefined) {
      const validStages = ["PLANNING", "ACTIVE", "PAUSED", "COMPLETED"];
      if (!validStages.includes(stage)) {
        return NextResponse.json(
          { error: `Invalid stage. Must be one of: ${validStages.join(", ")}` },
          { status: 400 }
        );
      }
      sets.push(`stage = $${idx++}`);
      params.push(stage);
    }

    if (boardId !== undefined) {
      sets.push(`"boardId" = $${idx++}`);
      params.push(boardId);
    }

    if (spec !== undefined) {
      sets.push(`spec = $${idx++}`);
      params.push(spec);
    }

    if (itemType !== undefined) {
      sets.push(`"itemType" = $${idx++}`);
      params.push(itemType);
    }

    if (ownerAgent !== undefined) {
      sets.push(`"ownerAgent" = $${idx++}`);
      params.push(ownerAgent);
    }

    if (sets.length === 1) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    params.push(id);
    await query(
      `UPDATE "_workflow" SET ${sets.join(", ")} WHERE id = $${idx} AND "deletedAt" IS NULL`,
      params
    );
    pushWorkflowObservabilityEvent("workflow_patch", {
      workflowId: String(id),
      stage: stage !== undefined ? String(stage) : undefined,
      boardId: boardId !== undefined ? boardId : undefined,
      ownerAgent: ownerAgent !== undefined ? ownerAgent : undefined,
    });
    notifyDashboardSyncChange();
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to update workflow";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
