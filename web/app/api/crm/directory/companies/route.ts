import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 150;
const MAX_OFFSET = 500_000;

export type CrmDirectoryCompanyRow = {
  id: string;
  name: string;
  websiteUrl: string | null;
  linkedinUrl: string | null;
};

function parsePageParams(sp: URLSearchParams): { pageSize: number; offset: number } | { error: string } {
  const limitRaw = parseInt(sp.get("limit") || String(DEFAULT_PAGE_SIZE), 10);
  const pageSize = Number.isFinite(limitRaw)
    ? Math.min(Math.max(1, limitRaw), MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;

  const offsetRaw = parseInt(sp.get("offset") || "0", 10);
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.min(offsetRaw, MAX_OFFSET)) : 0;

  if (!Number.isFinite(offsetRaw) || offsetRaw < 0) {
    return { error: "Invalid offset" };
  }

  return { pageSize, offset };
}

/**
 * GET — paginated CRM companies for Tim’s directory (infinite scroll).
 * Query: q, limit (page size), offset. Stable order: name, id.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const parsed = parsePageParams(sp);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { pageSize, offset } = parsed;

  const qRaw = sp.get("q")?.trim() ?? "";
  const pattern = qRaw.length > 0 ? `%${qRaw}%` : null;

  const fetchLimit = pageSize + 1;

  try {
    const rows = await query<CrmDirectoryCompanyRow>(
      `SELECT c.id,
              c.name,
              c."domainNamePrimaryLinkUrl" AS "websiteUrl",
              c."linkedinLinkPrimaryLinkUrl" AS "linkedinUrl"
       FROM company c
       WHERE c."deletedAt" IS NULL
         AND (
           $1::text IS NULL
           OR c.name ILIKE $1
           OR c."domainNamePrimaryLinkUrl" ILIKE $1
           OR c."linkedinLinkPrimaryLinkUrl" ILIKE $1
         )
       ORDER BY c.name ASC NULLS LAST, c.id ASC
       LIMIT $2 OFFSET $3`,
      [pattern, fetchLimit, offset]
    );

    const hasMore = rows.length > pageSize;
    const companies = hasMore ? rows.slice(0, pageSize) : rows;

    return NextResponse.json({
      companies,
      hasMore,
      nextOffset: offset + companies.length,
      pageSize,
    });
  } catch (e) {
    console.error("[directory/companies] GET error:", e);
    return NextResponse.json({ error: "Failed to load companies" }, { status: 500 });
  }
}
