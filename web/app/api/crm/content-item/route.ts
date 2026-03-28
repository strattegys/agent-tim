import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { notifyDashboardSyncChange } from "@/lib/dashboard-sync-hub";

/**
 * PATCH { id, title } — update `_content_item.title` (e.g. working title shown in Ghost’s queue).
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    if (!title) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    const rows = await query<{ id: string }>(
      `UPDATE "_content_item" SET title = $1, "updatedAt" = NOW()
       WHERE id = $2::uuid AND "deletedAt" IS NULL
       RETURNING id`,
      [title, id]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "Content item not found" }, { status: 404 });
    }
    notifyDashboardSyncChange();
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[content-item] PATCH:", e);
    return NextResponse.json({ error: "Failed to update content item" }, { status: 500 });
  }
}
