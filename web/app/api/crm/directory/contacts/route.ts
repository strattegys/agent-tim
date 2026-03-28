import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { postgresMissingColumn } from "@/lib/linkedin-person-identity";

/** Default page size for infinite scroll (client may pass `limit`). */
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 150;
const MAX_OFFSET = 500_000;

export type CrmDirectoryContactRow = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string;
  /** Distinct `_package.name` values for workflows that include this person, comma-separated. */
  packageNames: string;
  /**
   * Distinct workflow stage labels only (title case, underscores → spaces), e.g. `Messaged · Message Draft`.
   */
  packageStatus: string;
  /** Coalesced from `linkedinLinkPrimaryLinkUrl` (public URL or member id string). */
  linkedinUrlRaw: string | null;
  /** Unipile / LinkedIn API member id when stored separately (ACoA…). */
  linkedinProviderId: string | null;
};

/** Person appears on a workflow item; workflow may belong to a package. */
const PACKAGE_NAMES_SUBSELECT = `COALESCE(
  (SELECT string_agg(s.name, ', ' ORDER BY s.name)
   FROM (
     SELECT DISTINCT pkg.name
     FROM "_workflow_item" wi
     INNER JOIN "_workflow" w ON w.id = wi."workflowId" AND w."deletedAt" IS NULL
     INNER JOIN "_package" pkg ON pkg.id = w."packageId" AND pkg."deletedAt" IS NULL
     WHERE wi."sourceId" = p.id
       AND wi."sourceType" = 'person'
       AND wi."deletedAt" IS NULL
       AND w."packageId" IS NOT NULL
   ) s),
  ''
)`;

/** Search matches package name or workflow item stage (raw key, e.g. MESSAGE_DRAFT). */
const PACKAGE_SEARCH_EXISTS = `EXISTS (
  SELECT 1
  FROM "_workflow_item" wi
  INNER JOIN "_workflow" w ON w.id = wi."workflowId" AND w."deletedAt" IS NULL
  INNER JOIN "_package" pkg ON pkg.id = w."packageId" AND pkg."deletedAt" IS NULL
  WHERE wi."sourceId" = p.id
    AND wi."sourceType" = 'person'
    AND wi."deletedAt" IS NULL
    AND w."packageId" IS NOT NULL
    AND (
      pkg.name ILIKE $1
      OR COALESCE(wi.stage, '') ILIKE $1
      OR REPLACE(COALESCE(wi.stage, ''), '_', ' ') ILIKE $1
    )
)`;

const PACKAGE_STATUS_SUBSELECT = `COALESCE(
  (SELECT string_agg(q.label, ' · ' ORDER BY q.label)
   FROM (
     SELECT DISTINCT
       INITCAP(LOWER(REPLACE(TRIM(wi.stage), '_', ' '))) AS label
     FROM "_workflow_item" wi
     INNER JOIN "_workflow" w ON w.id = wi."workflowId" AND w."deletedAt" IS NULL
     INNER JOIN "_package" pkg ON pkg.id = w."packageId" AND pkg."deletedAt" IS NULL
     WHERE wi."sourceId" = p.id
       AND wi."sourceType" = 'person'
       AND wi."deletedAt" IS NULL
       AND w."packageId" IS NOT NULL
       AND TRIM(COALESCE(wi.stage, '')) <> ''
   ) q
  ),
  ''
)`;

function contactListSql(includeProviderId: boolean): string {
  const provSel = includeProviderId
    ? `p."linkedinProviderId" AS "linkedinProviderId"`
    : `NULL::text AS "linkedinProviderId"`;
  const provSearch = includeProviderId ? `OR p."linkedinProviderId" ILIKE $1` : "";

  return `SELECT p.id,
              p."nameFirstName" AS "firstName",
              p."nameLastName" AS "lastName",
              COALESCE(c.name, '') AS "companyName",
              ${PACKAGE_NAMES_SUBSELECT} AS "packageNames",
              ${PACKAGE_STATUS_SUBSELECT} AS "packageStatus",
              NULLIF(TRIM(p."linkedinLinkPrimaryLinkUrl"), '') AS "linkedinUrlRaw",
              ${provSel}
       FROM person p
       LEFT JOIN company c ON c.id = p."companyId" AND c."deletedAt" IS NULL
       WHERE p."deletedAt" IS NULL
         AND (
           $1::text IS NULL
           OR p."nameFirstName" ILIKE $1
           OR p."nameLastName" ILIKE $1
           OR c.name ILIKE $1
           OR p."linkedinLinkPrimaryLinkUrl" ILIKE $1
           ${provSearch}
           OR p."emailsPrimaryEmail" ILIKE $1
           OR CONCAT(COALESCE(p."nameFirstName", ''), ' ', COALESCE(p."nameLastName", '')) ILIKE $1
           OR ${PACKAGE_SEARCH_EXISTS}
         )
       ORDER BY p."updatedAt" DESC NULLS LAST, p.id DESC
       LIMIT $2 OFFSET $3`;
}

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
 * GET — paginated CRM people for Tim’s directory (infinite scroll).
 * Query: q, limit (page size, default 50, max 150), offset (default 0).
 * Response: `hasMore` is true when another full page may exist (fetches limit+1 rows internally).
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
    const run = (includeProvider: boolean) =>
      query<CrmDirectoryContactRow>(contactListSql(includeProvider), [pattern, fetchLimit, offset]);

    try {
      const rows = await run(true);
      const hasMore = rows.length > pageSize;
      const contacts = hasMore ? rows.slice(0, pageSize) : rows;
      return NextResponse.json({
        contacts,
        hasMore,
        nextOffset: offset + contacts.length,
        pageSize,
      });
    } catch (e) {
      if (postgresMissingColumn(e, "linkedinProviderId")) {
        const rows = await run(false);
        const hasMore = rows.length > pageSize;
        const contacts = hasMore ? rows.slice(0, pageSize) : rows;
        return NextResponse.json({
          contacts,
          hasMore,
          nextOffset: offset + contacts.length,
          pageSize,
        });
      }
      throw e;
    }
  } catch (e) {
    console.error("[directory/contacts] GET error:", e);
    return NextResponse.json({ error: "Failed to load contacts" }, { status: 500 });
  }
}
