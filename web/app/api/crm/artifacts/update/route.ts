import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const { artifactId, content } = await req.json();
    if (!artifactId || content === undefined) {
      return NextResponse.json({ error: "artifactId and content required" }, { status: 400 });
    }

    await query(
      `UPDATE "_artifact" SET content = $1, "updatedAt" = NOW() WHERE id = $2 AND "deletedAt" IS NULL`,
      [content, artifactId]
    );

    const metaRows = await query<{ workflowItemId: string; stage: string }>(
      `SELECT a."workflowItemId" AS "workflowItemId", a.stage
       FROM "_artifact" a
       WHERE a.id = $1 AND a."deletedAt" IS NULL`,
      [artifactId]
    );
    const meta = metaRows[0];
    if (meta) {
      const { maybeNotifyTimAfterLinkedInDraftEdit } = await import("@/lib/tim-linkedin-send-chat-gate");
      void maybeNotifyTimAfterLinkedInDraftEdit({
        workflowItemId: meta.workflowItemId,
        stage: meta.stage,
        markdownContent: typeof content === "string" ? content : String(content),
      }).catch((e) => console.error("[artifacts/update linkedin notify]", e));
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[artifacts/update]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Update failed" },
      { status: 500 }
    );
  }
}
