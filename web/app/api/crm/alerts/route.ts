import { NextResponse, type NextRequest } from "next/server";
import { query } from "@/lib/db";

/**
 * Returns a map of sourceId → alert info for person-type workflow items
 * whose most recent note is an inbound LinkedIn message or connection acceptance.
 *
 * GET /api/crm/alerts?workflowId=xxx
 */
export async function GET(request: NextRequest) {
  const workflowId = request.nextUrl.searchParams.get("workflowId");
  if (!workflowId) {
    return NextResponse.json({ error: "workflowId is required" }, { status: 400 });
  }

  try {
    const rows = await query(
      `WITH workflow_persons AS (
        SELECT wi."sourceId" AS person_id
        FROM "_workflow_item" wi
        WHERE wi."workflowId" = $1
          AND wi."sourceType" = 'person'
          AND wi."deletedAt" IS NULL
      ),
      latest_notes AS (
        SELECT DISTINCT ON (nt."targetPersonId")
          nt."targetPersonId" AS person_id,
          n.title,
          n."createdAt"
        FROM "noteTarget" nt
        JOIN note n ON n.id = nt."noteId" AND n."deletedAt" IS NULL
        JOIN workflow_persons wp ON wp.person_id = nt."targetPersonId"
        WHERE nt."deletedAt" IS NULL
        ORDER BY nt."targetPersonId", n."createdAt" DESC
      )
      SELECT person_id, title, "createdAt"
      FROM latest_notes
      WHERE title LIKE 'LinkedIn Message from%'
         OR title LIKE 'LinkedIn Connection Accepted%'`,
      [workflowId]
    );

    const alerts: Record<string, { type: string; title: string; createdAt: string }> = {};
    for (const row of rows) {
      const title = row.title as string;
      alerts[row.person_id as string] = {
        type: title.startsWith("LinkedIn Message from") ? "linkedin_reply" : "linkedin_accepted",
        title,
        createdAt: row.createdAt as string,
      };
    }

    return NextResponse.json({ alerts });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to fetch alerts";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
