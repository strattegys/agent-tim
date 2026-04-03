import { NextResponse, type NextRequest } from "next/server";
import { query } from "@/lib/db";
import type {
  PennyAccountDto,
  PennyAccountsResponse,
  PennyDerivedStage,
} from "@/lib/penny-accounts-types";

type CompanyAggRow = {
  id: string;
  name: string;
  websiteUrl: string | null;
  linkedinUrl: string | null;
  contactCount: number;
  activePackages: number;
  draftPackages: number;
  pendingPackages: number;
  completedPackages: number;
  totalPackages: number;
};

function deriveStage(r: Omit<PennyAccountDto, "derivedStage">): PennyDerivedStage {
  if (r.activePackages > 0) return "customer";
  if (r.pendingPackages > 0) return "review";
  if (r.draftPackages > 0) return "proposal";
  if (r.totalPackages > 0 && r.completedPackages >= r.totalPackages) return "delivered";
  return "lead";
}

/**
 * GET /api/penny/accounts
 *
 * Companies with at least one company-linked package or at least one contact.
 * Package counts are for `_package.customerType = 'company'` and `customerId = company.id` only.
 */
export async function GET(_req: NextRequest) {
  try {
    const rows = await query<CompanyAggRow>(
      `SELECT c.id,
              c.name,
              c."domainNamePrimaryLinkUrl" AS "websiteUrl",
              c."linkedinLinkPrimaryLinkUrl" AS "linkedinUrl",
              (SELECT COUNT(*)::int FROM person p
               WHERE p."companyId" = c.id AND p."deletedAt" IS NULL) AS "contactCount",
              (SELECT COUNT(*)::int FROM "_package" pkg
               WHERE pkg."customerId" = c.id
                 AND pkg."deletedAt" IS NULL
                 AND LOWER(TRIM(COALESCE(pkg."customerType", ''))) = 'company'
                 AND UPPER(TRIM(COALESCE(pkg.stage::text, ''))) = 'ACTIVE') AS "activePackages",
              (SELECT COUNT(*)::int FROM "_package" pkg
               WHERE pkg."customerId" = c.id
                 AND pkg."deletedAt" IS NULL
                 AND LOWER(TRIM(COALESCE(pkg."customerType", ''))) = 'company'
                 AND UPPER(TRIM(COALESCE(pkg.stage::text, ''))) = 'DRAFT') AS "draftPackages",
              (SELECT COUNT(*)::int FROM "_package" pkg
               WHERE pkg."customerId" = c.id
                 AND pkg."deletedAt" IS NULL
                 AND LOWER(TRIM(COALESCE(pkg."customerType", ''))) = 'company'
                 AND UPPER(TRIM(COALESCE(pkg.stage::text, ''))) = 'PENDING_APPROVAL') AS "pendingPackages",
              (SELECT COUNT(*)::int FROM "_package" pkg
               WHERE pkg."customerId" = c.id
                 AND pkg."deletedAt" IS NULL
                 AND LOWER(TRIM(COALESCE(pkg."customerType", ''))) = 'company'
                 AND UPPER(TRIM(COALESCE(pkg.stage::text, ''))) = 'COMPLETED') AS "completedPackages",
              (SELECT COUNT(*)::int FROM "_package" pkg
               WHERE pkg."customerId" = c.id
                 AND pkg."deletedAt" IS NULL
                 AND LOWER(TRIM(COALESCE(pkg."customerType", ''))) = 'company') AS "totalPackages"
       FROM company c
       WHERE c."deletedAt" IS NULL
         AND (
           EXISTS (
             SELECT 1 FROM "_package" pkg
             WHERE pkg."customerId" = c.id
               AND pkg."deletedAt" IS NULL
               AND LOWER(TRIM(COALESCE(pkg."customerType", ''))) = 'company'
           )
           OR EXISTS (
             SELECT 1 FROM person p
             WHERE p."companyId" = c.id AND p."deletedAt" IS NULL
           )
         )
       ORDER BY
         (SELECT COUNT(*)::int FROM "_package" pkg
          WHERE pkg."customerId" = c.id
            AND pkg."deletedAt" IS NULL
            AND LOWER(TRIM(COALESCE(pkg."customerType", ''))) = 'company'
            AND UPPER(TRIM(COALESCE(pkg.stage::text, ''))) = 'ACTIVE') DESC,
         c.name ASC NULLS LAST,
         c.id ASC
       LIMIT 400`
    );

    const accounts: PennyAccountDto[] = rows.map((r) => {
      const base = {
        id: r.id,
        name: r.name,
        websiteUrl: r.websiteUrl,
        linkedinUrl: r.linkedinUrl,
        contactCount: r.contactCount,
        activePackages: r.activePackages,
        draftPackages: r.draftPackages,
        pendingPackages: r.pendingPackages,
        completedPackages: r.completedPackages,
        totalPackages: r.totalPackages,
      };
      return { ...base, derivedStage: deriveStage(base) };
    });

    const payload: PennyAccountsResponse = {
      accounts,
      note:
        "Stages are derived from company-linked packages only (`customerType: company`). Person-linked packages are not rolled up here yet.",
    };

    return NextResponse.json(payload);
  } catch (e) {
    console.error("[penny/accounts] GET error:", e);
    return NextResponse.json({ error: "Failed to load accounts" }, { status: 500 });
  }
}
