import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import {
  linkedinUrlJsonCoalesceUnsupported,
  postgresMissingColumn,
  sqlPersonLinkedinUrlCoalesce,
} from "@/lib/linkedin-person-identity";

export type ContactInsightEventKind = "artifact" | "note" | "workflow_item";

export type ContactInsightEvent = {
  kind: ContactInsightEventKind;
  at: string;
  title: string;
  detail?: string;
  workflowName?: string | null;
  workflowItemId?: string | null;
  stage?: string | null;
};

function truncateText(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

type PersonInsightRow = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  email: string | null;
  linkedinUrl: string | null;
  linkedinProviderId: string | null;
  companyName: string | null;
  city: string | null;
};

async function loadPerson(personId: string): Promise<PersonInsightRow | null> {
  /** Flat LinkedIn URL only; `linkedinProviderId` omitted (column may not exist on older CRM schemas). */
  const withCompanyFlat = () =>
    query<PersonInsightRow>(
      `SELECT p.id,
              p."nameFirstName" AS "firstName",
              p."nameLastName" AS "lastName",
              p."jobTitle" AS "jobTitle",
              p."emailsPrimaryEmail" AS email,
              NULLIF(TRIM(p."linkedinLinkPrimaryLinkUrl"), '') AS "linkedinUrl",
              NULL::text AS "linkedinProviderId",
              c.name AS "companyName",
              p.city
       FROM person p
       LEFT JOIN company c ON c.id = p."companyId" AND c."deletedAt" IS NULL
       WHERE p.id = $1 AND p."deletedAt" IS NULL
       LIMIT 1`,
      [personId]
    );

  const noCompanyFlat = () =>
    query<PersonInsightRow>(
      `SELECT p.id,
              p."nameFirstName" AS "firstName",
              p."nameLastName" AS "lastName",
              p."jobTitle" AS "jobTitle",
              p."emailsPrimaryEmail" AS email,
              NULLIF(TRIM(p."linkedinLinkPrimaryLinkUrl"), '') AS "linkedinUrl",
              NULL::text AS "linkedinProviderId",
              NULL::text AS "companyName",
              p.city
       FROM person p
       WHERE p.id = $1 AND p."deletedAt" IS NULL
       LIMIT 1`,
      [personId]
    );

  try {
    const rows = await query<PersonInsightRow>(
      `SELECT p.id,
              p."nameFirstName" AS "firstName",
              p."nameLastName" AS "lastName",
              p."jobTitle" AS "jobTitle",
              p."emailsPrimaryEmail" AS email,
              ${sqlPersonLinkedinUrlCoalesce("p")} AS "linkedinUrl",
              p."linkedinProviderId" AS "linkedinProviderId",
              c.name AS "companyName",
              p.city
       FROM person p
       LEFT JOIN company c ON c.id = p."companyId" AND c."deletedAt" IS NULL
       WHERE p.id = $1 AND p."deletedAt" IS NULL
       LIMIT 1`,
      [personId]
    );
    return rows[0] ?? null;
  } catch (e) {
    if (linkedinUrlJsonCoalesceUnsupported(e) || postgresMissingColumn(e, "linkedinProviderId")) {
      try {
        const rows = await withCompanyFlat();
        return rows[0] ?? null;
      } catch (e2) {
        if (postgresMissingColumn(e2, "companyId")) {
          const rows = await noCompanyFlat();
          return rows[0] ?? null;
        }
        throw e2;
      }
    }
    if (postgresMissingColumn(e, "companyId")) {
      const rows = await noCompanyFlat();
      return rows[0] ?? null;
    }
    throw e;
  }
}

/**
 * GET /api/crm/person/contact-insight?personId=uuid
 *
 * CRM profile plus a reverse-chronological activity feed: workflow artifacts, notes, and workflow rows.
 */
export async function GET(req: NextRequest) {
  const personId = req.nextUrl.searchParams.get("personId")?.trim();
  if (!personId) {
    return NextResponse.json({ error: "personId is required" }, { status: 400 });
  }

  try {
    const person = await loadPerson(personId);
    if (!person) {
      return NextResponse.json({ error: "Person not found" }, { status: 404 });
    }

    const artifacts = await query<{
      id: string;
      workflowItemId: string;
      stage: string | null;
      name: string | null;
      type: string | null;
      createdAt: string;
      content: string | null;
      workflowName: string | null;
    }>(
      `SELECT a.id,
              a."workflowItemId" AS "workflowItemId",
              a.stage::text AS stage,
              a.name,
              a.type::text AS type,
              a."createdAt" AS "createdAt",
              a.content,
              w.name AS "workflowName"
       FROM "_artifact" a
       INNER JOIN "_workflow_item" wi ON wi.id = a."workflowItemId" AND wi."deletedAt" IS NULL
       INNER JOIN "_workflow" w ON w.id = wi."workflowId" AND w."deletedAt" IS NULL
       WHERE wi."sourceId" = $1::uuid
         AND wi."sourceType" = 'person'
         AND a."deletedAt" IS NULL
       ORDER BY a."createdAt" DESC
       LIMIT 200`,
      [personId]
    );

    const workflowItems = await query<{
      id: string;
      workflowId: string;
      stage: string | null;
      createdAt: string;
      updatedAt: string;
      removed: boolean;
      workflowName: string | null;
      packageName: string | null;
    }>(
      `SELECT wi.id,
              wi."workflowId" AS "workflowId",
              wi.stage::text AS stage,
              wi."createdAt" AS "createdAt",
              wi."updatedAt" AS "updatedAt",
              wi."deletedAt" IS NOT NULL AS removed,
              w.name AS "workflowName",
              pkg.name AS "packageName"
       FROM "_workflow_item" wi
       LEFT JOIN "_workflow" w ON w.id = wi."workflowId" AND w."deletedAt" IS NULL
       LEFT JOIN "_package" pkg ON pkg.id = w."packageId" AND pkg."deletedAt" IS NULL
       WHERE wi."sourceId" = $1::uuid
         AND wi."sourceType" = 'person'
       ORDER BY wi."updatedAt" DESC NULLS LAST, wi."createdAt" DESC
       LIMIT 100`,
      [personId]
    );

    let notes: { id: string; title: string | null; body: string | null; createdAt: string }[] = [];
    try {
      notes = await query(
        `SELECT n.id, n.title, n."bodyV2Markdown" AS body, n."createdAt" AS "createdAt"
         FROM note n
         JOIN "noteTarget" nt ON nt."noteId" = n.id AND nt."deletedAt" IS NULL
         WHERE nt."targetPersonId" = $1
           AND n."deletedAt" IS NULL
         ORDER BY n."createdAt" DESC
         LIMIT 100`,
        [personId]
      );
    } catch {
      notes = [];
    }

    const events: ContactInsightEvent[] = [];

    for (const a of artifacts) {
      const label = (a.name?.trim() || a.stage?.trim() || "Artifact").replace(/\s+/g, " ");
      const preview = a.content ? truncateText(a.content.replace(/[#*_`]/g, ""), 200) : undefined;
      events.push({
        kind: "artifact",
        at: a.createdAt,
        title: label,
        detail: preview,
        workflowName: a.workflowName,
        workflowItemId: a.workflowItemId,
        stage: a.stage,
      });
    }

    for (const n of notes) {
      events.push({
        kind: "note",
        at: n.createdAt,
        title: n.title?.trim() || "Note",
        detail: n.body ? truncateText(n.body.replace(/[#*_`]/g, ""), 200) : undefined,
      });
    }

    for (const wi of workflowItems) {
      const wf = (wi.workflowName || "Workflow").trim();
      const pkg = wi.packageName?.trim();
      const stageLabel = (wi.stage || "").replace(/_/g, " ").trim() || "—";
      const suffix = wi.removed ? " (removed)" : "";
      events.push({
        kind: "workflow_item",
        at: wi.updatedAt || wi.createdAt,
        title: `Workflow${suffix}`,
        detail: pkg ? `${pkg} · ${wf} — ${stageLabel}` : `${wf} — ${stageLabel}`,
        workflowName: wi.workflowName,
        workflowItemId: wi.id,
        stage: wi.stage,
      });
    }

    events.sort((a, b) => String(b.at).localeCompare(String(a.at)));

    return NextResponse.json({
      person: {
        id: person.id,
        firstName: person.firstName,
        lastName: person.lastName,
        jobTitle: person.jobTitle,
        email: person.email,
        linkedinUrl: person.linkedinUrl,
        linkedinProviderId: person.linkedinProviderId,
        companyName: person.companyName,
        city: person.city,
      },
      events,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to load contact insight";
    console.error("[contact-insight]", error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
