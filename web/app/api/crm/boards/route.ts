import { NextResponse, type NextRequest } from "next/server";
import { query } from "@/lib/db";
import type { StageConfig } from "@/lib/board-types";
import { notifyDashboardSyncChange } from "@/lib/dashboard-sync-hub";

export async function GET() {
  try {
    const boards = await query(
      `SELECT id, name, description, stages, transitions
       FROM "_board"
       WHERE "deletedAt" IS NULL
       ORDER BY name ASC`
    );
    return NextResponse.json({ boards });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to fetch boards";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { name, description, stages, transitions } = await request.json();
    if (!name || !stages || !transitions) {
      return NextResponse.json(
        { error: "name, stages, and transitions are required" },
        { status: 400 }
      );
    }
    const err = validateBoard(stages, transitions);
    if (err) return NextResponse.json({ error: err }, { status: 400 });

    const rows = await query(
      `INSERT INTO "_board" (name, description, stages, transitions)
       VALUES ($1, $2, $3::jsonb, $4::jsonb)
       RETURNING id, name, description, stages, transitions`,
      [name, description || null, JSON.stringify(stages), JSON.stringify(transitions)]
    );
    notifyDashboardSyncChange();
    return NextResponse.json({ board: rows[0] }, { status: 201 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to create board";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { id, name, description, stages, transitions } = await request.json();
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    if (stages || transitions) {
      const err = validateBoard(stages, transitions);
      if (err) return NextResponse.json({ error: err }, { status: 400 });
    }

    const sets: string[] = ['"updatedAt" = NOW()'];
    const params: unknown[] = [];
    let idx = 1;

    if (name !== undefined) { sets.push(`name = $${idx++}`); params.push(name); }
    if (description !== undefined) { sets.push(`description = $${idx++}`); params.push(description); }
    if (stages !== undefined) { sets.push(`stages = $${idx++}::jsonb`); params.push(JSON.stringify(stages)); }
    if (transitions !== undefined) { sets.push(`transitions = $${idx++}::jsonb`); params.push(JSON.stringify(transitions)); }

    params.push(id);
    await query(
      `UPDATE "_board" SET ${sets.join(", ")} WHERE id = $${idx} AND "deletedAt" IS NULL`,
      params
    );
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to update board";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const refs = await query(
      `SELECT id FROM "_workflow" WHERE "boardId" = $1 AND "deletedAt" IS NULL LIMIT 1`,
      [id]
    );
    if (refs.length > 0) {
      return NextResponse.json(
        { error: "Cannot delete board: workflows still reference it" },
        { status: 409 }
      );
    }

    await query(
      `UPDATE "_board" SET "deletedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1 AND "deletedAt" IS NULL`,
      [id]
    );
    notifyDashboardSyncChange();
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to delete board";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function validateBoard(
  stages: StageConfig[] | undefined,
  transitions: Record<string, string[]> | undefined
): string | null {
  if (stages) {
    if (!Array.isArray(stages) || stages.length === 0) return "stages must be a non-empty array";
    const keys = new Set<string>();
    for (const s of stages) {
      if (!s.key || !s.label || !s.color) return "Each stage must have key, label, and color";
      if (keys.has(s.key)) return `Duplicate stage key: ${s.key}`;
      keys.add(s.key);
    }
    if (transitions) {
      for (const [from, targets] of Object.entries(transitions)) {
        if (!keys.has(from)) return `Transition key '${from}' is not a valid stage`;
        for (const to of targets) {
          if (!keys.has(to)) return `Transition target '${to}' is not a valid stage`;
        }
      }
    }
  }
  return null;
}
