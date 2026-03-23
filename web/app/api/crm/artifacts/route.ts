import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

/**
 * Artifacts API — human-viewable outputs from workflow stages.
 *
 * An artifact is a document (markdown, text, JSON) produced by an agent
 * at a specific workflow stage. Examples: content briefs, article drafts,
 * enrichment reports, qualification summaries, LinkedIn post drafts.
 *
 * GET  ?workflowItemId= — List artifacts for a workflow item
 * GET  ?workflowId=     — List all artifacts for a workflow
 * POST {workflowItemId, stage, name, type, content} — Create artifact
 * PATCH {id, content?, name?} — Update artifact content
 */

export async function GET(req: NextRequest) {
  try {
    const workflowItemId = req.nextUrl.searchParams.get("workflowItemId");
    const workflowId = req.nextUrl.searchParams.get("workflowId");

    if (!workflowItemId && !workflowId) {
      return NextResponse.json(
        { error: "workflowItemId or workflowId is required" },
        { status: 400 }
      );
    }

    if (workflowItemId) {
      const rows = await query(
        `SELECT id, "workflowItemId", "workflowId", stage, name, type, content, "createdAt", "updatedAt"
         FROM "_artifact"
         WHERE "workflowItemId" = $1 AND "deletedAt" IS NULL
         ORDER BY "createdAt" ASC`,
        [workflowItemId]
      );
      return NextResponse.json({ artifacts: rows });
    }

    // By workflowId — get all artifacts for all items in a workflow
    const rows = await query(
      `SELECT a.id, a."workflowItemId", a."workflowId", a.stage, a.name, a.type, a.content, a."createdAt", a."updatedAt"
       FROM "_artifact" a
       WHERE a."workflowId" = $1 AND a."deletedAt" IS NULL
       ORDER BY a."createdAt" ASC`,
      [workflowId]
    );
    return NextResponse.json({ artifacts: rows });
  } catch (error) {
    console.error("[artifacts] GET error:", error);
    return NextResponse.json({ error: "Failed to list artifacts" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { workflowItemId, workflowId, stage, name, type, content } = await req.json();

    if (!workflowItemId || !stage || !name || !content) {
      return NextResponse.json(
        { error: "workflowItemId, stage, name, and content are required" },
        { status: 400 }
      );
    }

    const rows = await query<{ id: string }>(
      `INSERT INTO "_artifact" ("workflowItemId", "workflowId", stage, name, type, content, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       RETURNING id`,
      [workflowItemId, workflowId || null, stage, name, type || "markdown", content]
    );

    return NextResponse.json({ id: (rows[0] as Record<string, unknown>).id });
  } catch (error) {
    console.error("[artifacts] POST error:", error);
    return NextResponse.json({ error: "Failed to create artifact" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, content, name } = await req.json();
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const sets: string[] = ['"updatedAt" = NOW()'];
    const params: unknown[] = [];

    if (content !== undefined) {
      params.push(content);
      sets.push(`content = $${params.length}`);
    }
    if (name !== undefined) {
      params.push(name);
      sets.push(`name = $${params.length}`);
    }

    if (sets.length === 1) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    params.push(id);
    await query(
      `UPDATE "_artifact" SET ${sets.join(", ")} WHERE id = $${params.length} AND "deletedAt" IS NULL`,
      params
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[artifacts] PATCH error:", error);
    return NextResponse.json({ error: "Failed to update artifact" }, { status: 500 });
  }
}
