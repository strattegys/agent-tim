import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

/**
 * GET ?id=<person uuid> — CRM person row for workflow context (Tim queue pane).
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    const rows = await query<{
      id: string;
      firstName: string | null;
      lastName: string | null;
      jobTitle: string | null;
      linkedinUrl: string | null;
      city: string | null;
      companyName: string | null;
    }>(
      `SELECT p.id,
              p."nameFirstName" AS "firstName",
              p."nameLastName" AS "lastName",
              p."jobTitle" AS "jobTitle",
              p."linkedinLinkPrimaryLinkUrl" AS "linkedinUrl",
              p.city,
              COALESCE(c.name, '') AS "companyName"
       FROM person p
       LEFT JOIN company c ON c.id = p."companyId" AND c."deletedAt" IS NULL
       WHERE p.id = $1 AND p."deletedAt" IS NULL
       LIMIT 1`,
      [id]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ person: rows[0] });
  } catch (e) {
    console.error("[person] GET error:", e);
    return NextResponse.json({ error: "Failed to load person" }, { status: 500 });
  }
}
