import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { query } from "@/lib/db";
import { isBuiltinWorkflowTypeId } from "@/lib/workflow-registry";
import {
  validateCustomWorkflowTypePayload,
  parseDefaultBoard,
} from "@/lib/workflow-type-definition-validate";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/crm/workflow-type-definitions/:id — update custom row.
 * DELETE — soft-delete custom row.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: paramId } = await ctx.params;
  const id = decodeURIComponent(paramId || "").trim();
  if (!id || isBuiltinWorkflowTypeId(id)) {
    return NextResponse.json({ error: "Cannot update built-in workflow types" }, { status: 400 });
  }

  try {
    const body = await req.json();
    const existing = await query<{ id: string }>(
      `SELECT id FROM "_workflow_type_custom" WHERE id = $1 AND "deletedAt" IS NULL`,
      [id]
    );
    if (existing.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const label = typeof body.label === "string" ? body.label : "";
    const itemType = typeof body.itemType === "string" ? body.itemType : "";
    const description = typeof body.description === "string" ? body.description : "";
    const defaultBoard = body.defaultBoard ?? {};
    const throughputGoal = body.throughputGoal;

    const v = validateCustomWorkflowTypePayload({
      id,
      label,
      itemType,
      description,
      defaultBoard,
      throughputGoal,
    });
    if (!v.ok) {
      return NextResponse.json({ error: "Validation failed", details: v.errors }, { status: 400 });
    }

    const board = parseDefaultBoard(defaultBoard);
    if (!board) {
      return NextResponse.json({ error: "Invalid defaultBoard" }, { status: 400 });
    }

    const tg =
      throughputGoal != null && typeof throughputGoal === "object" && !Array.isArray(throughputGoal)
        ? JSON.stringify(throughputGoal)
        : null;

    const rows = await query(
      `UPDATE "_workflow_type_custom"
       SET label = $2, "itemType" = $3, description = $4,
           "defaultBoard" = $5::jsonb, "throughputGoal" = $6::jsonb, "updatedAt" = NOW()
       WHERE id = $1 AND "deletedAt" IS NULL
       RETURNING id, label, "itemType", description, "defaultBoard", "throughputGoal"`,
      [id, label.trim(), itemType, description, JSON.stringify(board), tg]
    );
    return NextResponse.json({ definition: rows[0] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[workflow-type-definitions] PATCH", msg);
    return NextResponse.json({ error: "Failed to update definition" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: paramId } = await ctx.params;
  const id = decodeURIComponent(paramId || "").trim();
  if (!id || isBuiltinWorkflowTypeId(id)) {
    return NextResponse.json({ error: "Cannot delete built-in workflow types" }, { status: 400 });
  }

  try {
    const rows = await query<{ id: string }>(
      `UPDATE "_workflow_type_custom"
       SET "deletedAt" = NOW(), "updatedAt" = NOW()
       WHERE id = $1 AND "deletedAt" IS NULL
       RETURNING id`,
      [id]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, id: rows[0].id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[workflow-type-definitions] DELETE", msg);
    return NextResponse.json({ error: "Failed to delete definition" }, { status: 500 });
  }
}
