import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  getWorkflowTypeRegistry,
  isBuiltinWorkflowTypeId,
} from "@/lib/workflow-registry";
import {
  validateCustomWorkflowTypePayload,
  parseDefaultBoard,
} from "@/lib/workflow-type-definition-validate";
import type { WorkflowTypeSpec } from "@/lib/workflow-types";

export type WorkflowTypeDefinitionRow = WorkflowTypeSpec & { source: "builtin" | "custom" };

/**
 * GET /api/crm/workflow-type-definitions — merged built-in + custom (for UI).
 * POST — create custom row (id must not collide with built-in).
 */
export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const reg = await getWorkflowTypeRegistry();
    const customSet = new Set(reg.customIds());
    const types: WorkflowTypeDefinitionRow[] = reg.listAll().map((w) => ({
      ...w,
      source: customSet.has(w.id) ? "custom" : "builtin",
    }));
    return NextResponse.json({ types });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[workflow-type-definitions] GET", msg);
    return NextResponse.json({ error: "Failed to list definitions" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json();
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const label = typeof body.label === "string" ? body.label : "";
    const itemType = typeof body.itemType === "string" ? body.itemType : "";
    const description = typeof body.description === "string" ? body.description : "";
    const defaultBoard = body.defaultBoard;
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
    if (isBuiltinWorkflowTypeId(id)) {
      return NextResponse.json(
        { error: `Custom workflow id cannot match a built-in type: ${id}` },
        { status: 409 }
      );
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
      `INSERT INTO "_workflow_type_custom"
        (id, label, "itemType", description, "defaultBoard", "throughputGoal", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, NOW(), NOW())
       RETURNING id, label, "itemType", description, "defaultBoard", "throughputGoal"`,
      [id, label.trim(), itemType, description, JSON.stringify(board), tg]
    );
    return NextResponse.json({ definition: rows[0] }, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/unique|duplicate/i.test(msg)) {
      return NextResponse.json({ error: "A custom workflow type with this id already exists." }, { status: 409 });
    }
    console.error("[workflow-type-definitions] POST", msg);
    return NextResponse.json({ error: "Failed to create definition" }, { status: 500 });
  }
}
