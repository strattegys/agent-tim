import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { WORKFLOW_TYPES } from "@/lib/workflow-types";
import {
  inferWorkflowRegistryFromBoardStages,
  resolveWorkflowRegistryForQueue,
} from "@/lib/workflow-spec";
import {
  boardHumanMetaForStage,
  humanTaskOpenFromBoardStages,
} from "@/lib/workflow-item-human-task";
import { WARM_OUTREACH_MESSAGE_FOLLOW_UP_DAYS } from "@/lib/warm-outreach-cadence";
import {
  batchGetLatestAwaitingContactArtifactContentByItemIds,
  batchGetLatestLinkedInArtifactUrlByItemIds,
  tryHealWarmPersonFromAwaitingArtifact,
} from "@/lib/warm-contact-intake-apply";
import { WARM_DISCOVERY_SOURCE_TYPE } from "@/lib/warm-discovery-item";
import { ensureIntakeNameFromRawLines, parseWarmContactIntake } from "@/lib/warm-contact-intake-parse";
import { getWarmOutreachDailyProgressForTim } from "@/lib/warm-outreach-daily-progress";
import {
  parsePersonLinkedInFields,
  sqlPersonLinkedinUrlCoalesce,
} from "@/lib/linkedin-person-identity";

/**
 * GET /api/crm/human-tasks?packageStage=ACTIVE&ownerAgent=tim&messagingOnly=true
 *
 * Rows are driven by _workflow_item.humanTaskOpen (synced from board stages[].requiresHuman).
 * Optional:
 * - packageStage — filter by _package.stage
 * - ownerAgent — filter workflows by owner (e.g. tim)
 * - messagingOnly — only messaging-related item stages
 * - sourceType — filter workflow items by source (e.g. `content` for Ghost’s content queue)
 * - excludePackageStages — comma-separated package stages to omit (e.g. `DRAFT,PENDING_APPROVAL` so planner draft/testing rows don’t appear in agent queues)
 * - includeInactivePackages — with ownerAgent=tim: include workflows on non-ACTIVE packages (default excludes them so planner work stays in package planner).
 * - summary=1 — with ownerAgent=tim only: returns { count, pendingFollowUpCount, warmOutreachDaily } without per-row CRM/artifact work (fast polling).
 * - ownerAgent=tim (default): only packaged workflows whose _package.stage is ACTIVE (non-packaged workflows still show). Pass includeInactivePackages=1 to see planner/inactive packages.
 * - limit / offset — with ownerAgent=tim on full GET (not summary): paginate (default limit 80, max 150). Response includes hasMore and nextOffset when applicable.
 * - messagingOnly=1 + ownerAgent=tim: rows ordered by **updatedAt DESC** (newest activity first) so LinkedIn inbox / latest replies are not buried behind older due-dated items.
 */
const MESSAGING_ITEM_STAGES = new Set([
  "INITIATED",
  "AWAITING_CONTACT",
  "MESSAGE_DRAFT",
  "MESSAGED",
  "REPLY_DRAFT",
  "REPLY_SENT",
  "LINKEDIN_INBOUND",
  "CONNECTION_ACCEPTED",
]);

function isMissingPackageNumberColumn(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /packageNumber/i.test(msg) && (/does not exist/i.test(msg) || /column/i.test(msg));
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code: string }).code);
  }
  return undefined;
}

/** LinkedIn URL, Unipile member id, primary email — tolerates missing optional columns. */
async function fetchPersonIdentityExtras(personId: string): Promise<{
  linkedinLinkPrimaryLinkUrl: string | null;
  linkedinProviderId: string | null;
  emailsPrimaryEmail: string | null;
}> {
  const none = {
    linkedinLinkPrimaryLinkUrl: null as string | null,
    linkedinProviderId: null as string | null,
    emailsPrimaryEmail: null as string | null,
  };
  try {
    const rows = await query<{
      linkedinLinkPrimaryLinkUrl: string | null;
      linkedinProviderId: string | null;
      emailsPrimaryEmail: string | null;
    }>(
      `SELECT ${sqlPersonLinkedinUrlCoalesce("p")} AS "linkedinLinkPrimaryLinkUrl",
              p."linkedinProviderId", p."emailsPrimaryEmail"
       FROM person p WHERE p.id = $1 AND p."deletedAt" IS NULL`,
      [personId]
    );
    const r = rows[0];
    if (!r) return none;
    return {
      linkedinLinkPrimaryLinkUrl: r.linkedinLinkPrimaryLinkUrl?.trim() || null,
      linkedinProviderId: r.linkedinProviderId?.trim() || null,
      emailsPrimaryEmail: r.emailsPrimaryEmail?.trim() || null,
    };
  } catch (e) {
    if (linkedinUrlJsonExtractUnsupported(e)) {
      try {
        const rows = await query<{
          linkedinLinkPrimaryLinkUrl: string | null;
          linkedinProviderId: string | null;
          emailsPrimaryEmail: string | null;
        }>(
          `SELECT NULLIF(TRIM(p."linkedinLinkPrimaryLinkUrl"), '') AS "linkedinLinkPrimaryLinkUrl",
                  p."linkedinProviderId", p."emailsPrimaryEmail"
           FROM person p WHERE p.id = $1 AND p."deletedAt" IS NULL`,
          [personId]
        );
        const r = rows[0];
        if (!r) return none;
        return {
          linkedinLinkPrimaryLinkUrl: r.linkedinLinkPrimaryLinkUrl?.trim() || null,
          linkedinProviderId: r.linkedinProviderId?.trim() || null,
          emailsPrimaryEmail: r.emailsPrimaryEmail?.trim() || null,
        };
      } catch (eFlat) {
        if (!isMissingColumn(eFlat, "linkedinProviderId")) throw eFlat;
        return await fetchPersonIdentityExtrasNoProvider(personId);
      }
    }
    if (!isMissingColumn(e, "linkedinProviderId")) throw e;
    return await fetchPersonIdentityExtrasNoProvider(personId);
  }
}

async function fetchPersonIdentityExtrasNoProvider(personId: string): Promise<{
  linkedinLinkPrimaryLinkUrl: string | null;
  linkedinProviderId: string | null;
  emailsPrimaryEmail: string | null;
}> {
  const none = {
    linkedinLinkPrimaryLinkUrl: null as string | null,
    linkedinProviderId: null as string | null,
    emailsPrimaryEmail: null as string | null,
  };
  try {
    const rows = await query<{
      linkedinLinkPrimaryLinkUrl: string | null;
      emailsPrimaryEmail: string | null;
    }>(
      `SELECT ${sqlPersonLinkedinUrlCoalesce("p")} AS "linkedinLinkPrimaryLinkUrl",
              p."emailsPrimaryEmail"
       FROM person p WHERE p.id = $1 AND p."deletedAt" IS NULL`,
      [personId]
    );
    const r = rows[0];
    if (!r) return none;
    return {
      linkedinLinkPrimaryLinkUrl: r.linkedinLinkPrimaryLinkUrl?.trim() || null,
      linkedinProviderId: null,
      emailsPrimaryEmail: r.emailsPrimaryEmail?.trim() || null,
    };
  } catch (e2) {
    if (linkedinUrlJsonExtractUnsupported(e2)) {
      try {
        const rows = await query<{
          linkedinLinkPrimaryLinkUrl: string | null;
          emailsPrimaryEmail: string | null;
        }>(
          `SELECT NULLIF(TRIM(p."linkedinLinkPrimaryLinkUrl"), '') AS "linkedinLinkPrimaryLinkUrl",
                  p."emailsPrimaryEmail"
           FROM person p WHERE p.id = $1 AND p."deletedAt" IS NULL`,
          [personId]
        );
        const r = rows[0];
        if (!r) return none;
        return {
          linkedinLinkPrimaryLinkUrl: r.linkedinLinkPrimaryLinkUrl?.trim() || null,
          linkedinProviderId: null,
          emailsPrimaryEmail: r.emailsPrimaryEmail?.trim() || null,
        };
      } catch (e3) {
        if (!isMissingColumn(e3, "emailsPrimaryEmail")) throw e3;
        const rows = await query<{ linkedinLinkPrimaryLinkUrl: string | null }>(
          `SELECT NULLIF(TRIM(p."linkedinLinkPrimaryLinkUrl"), '') AS "linkedinLinkPrimaryLinkUrl"
           FROM person p WHERE p.id = $1 AND p."deletedAt" IS NULL`,
          [personId]
        );
        return {
          linkedinLinkPrimaryLinkUrl: rows[0]?.linkedinLinkPrimaryLinkUrl?.trim() || null,
          linkedinProviderId: null,
          emailsPrimaryEmail: null,
        };
      }
    }
    if (!isMissingColumn(e2, "emailsPrimaryEmail")) throw e2;
    try {
      const rows = await query<{ linkedinLinkPrimaryLinkUrl: string | null }>(
        `SELECT ${sqlPersonLinkedinUrlCoalesce("p")} AS "linkedinLinkPrimaryLinkUrl"
         FROM person p WHERE p.id = $1 AND p."deletedAt" IS NULL`,
        [personId]
      );
      return {
        linkedinLinkPrimaryLinkUrl: rows[0]?.linkedinLinkPrimaryLinkUrl?.trim() || null,
        linkedinProviderId: null,
        emailsPrimaryEmail: null,
      };
    } catch (e4) {
      if (!linkedinUrlJsonExtractUnsupported(e4)) throw e4;
      const rows = await query<{ linkedinLinkPrimaryLinkUrl: string | null }>(
        `SELECT NULLIF(TRIM(p."linkedinLinkPrimaryLinkUrl"), '') AS "linkedinLinkPrimaryLinkUrl"
         FROM person p WHERE p.id = $1 AND p."deletedAt" IS NULL`,
        [personId]
      );
      return {
        linkedinLinkPrimaryLinkUrl: rows[0]?.linkedinLinkPrimaryLinkUrl?.trim() || null,
        linkedinProviderId: null,
        emailsPrimaryEmail: null,
      };
    }
  }
}

/** Postgres 42703 or English message */
function isMissingColumn(error: unknown, name: string): boolean {
  const msg = errMsg(error);
  const re = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  if (errCode(error) === "42703" && re.test(msg)) return true;
  return re.test(msg) && (/column/i.test(msg) || /field/i.test(msg)) && /does not exist/i.test(msg);
}

/** `linkedinUrl` missing, or column is not jsonb (e.g. plain text) so `->>` extract fails. */
function linkedinUrlJsonExtractUnsupported(error: unknown): boolean {
  if (isMissingColumn(error, "linkedinUrl")) return true;
  const m = errMsg(error);
  return /operator does not exist/i.test(m) && (/->>|#>>/i.test(m) || /jsonb/i.test(m));
}

type PersonQueueBasic = {
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  companyName: string | null;
};

async function batchFetchPersonsWithCompany(personIds: string[]): Promise<Map<string, PersonQueueBasic>> {
  const map = new Map<string, PersonQueueBasic>();
  const uniq = [...new Set(personIds.filter(Boolean))];
  if (uniq.length === 0) return map;
  try {
    const rows = await query<
      PersonQueueBasic & {
        id: string;
      }
    >(
      `SELECT p.id,
              p."nameFirstName" AS "firstName",
              p."nameLastName" AS "lastName",
              p."jobTitle" AS "jobTitle",
              NULLIF(TRIM(COALESCE(c.name, '')), '') AS "companyName"
       FROM person p
       LEFT JOIN company c ON c.id = p."companyId" AND c."deletedAt" IS NULL
       WHERE p.id = ANY($1::uuid[]) AND p."deletedAt" IS NULL`,
      [uniq]
    );
    for (const r of rows) {
      map.set(r.id, {
        firstName: r.firstName,
        lastName: r.lastName,
        jobTitle: r.jobTitle,
        companyName: r.companyName,
      });
    }
  } catch (joinErr) {
    if (isMissingColumn(joinErr, "companyId") || isMissingColumn(joinErr, "company")) {
      const rows = await query<PersonQueueBasic & { id: string }>(
        `SELECT id,
                "nameFirstName" AS "firstName",
                "nameLastName" AS "lastName",
                "jobTitle",
                NULL::text AS "companyName"
         FROM person WHERE id = ANY($1::uuid[]) AND "deletedAt" IS NULL`,
        [uniq]
      );
      for (const r of rows) {
        map.set(r.id, {
          firstName: r.firstName,
          lastName: r.lastName,
          jobTitle: r.jobTitle,
          companyName: r.companyName,
        });
      }
    } else {
      throw joinErr;
    }
  }
  return map;
}

async function batchFetchPersonIdentityExtrasMap(
  personIds: string[]
): Promise<
  Map<
    string,
    {
      linkedinLinkPrimaryLinkUrl: string | null;
      linkedinProviderId: string | null;
      emailsPrimaryEmail: string | null;
    }
  >
> {
  const map = new Map<
    string,
    {
      linkedinLinkPrimaryLinkUrl: string | null;
      linkedinProviderId: string | null;
      emailsPrimaryEmail: string | null;
    }
  >();
  const uniq = [...new Set(personIds.filter(Boolean))];
  if (uniq.length === 0) return map;
  try {
    const rows = await query<{
      id: string;
      linkedinLinkPrimaryLinkUrl: string | null;
      linkedinProviderId: string | null;
      emailsPrimaryEmail: string | null;
    }>(
      `SELECT p.id,
              ${sqlPersonLinkedinUrlCoalesce("p")} AS "linkedinLinkPrimaryLinkUrl",
              p."linkedinProviderId", p."emailsPrimaryEmail"
       FROM person p WHERE p.id = ANY($1::uuid[]) AND p."deletedAt" IS NULL`,
      [uniq]
    );
    for (const r of rows) {
      map.set(r.id, {
        linkedinLinkPrimaryLinkUrl: r.linkedinLinkPrimaryLinkUrl?.trim() || null,
        linkedinProviderId: r.linkedinProviderId?.trim() || null,
        emailsPrimaryEmail: r.emailsPrimaryEmail?.trim() || null,
      });
    }
  } catch (e) {
    if (linkedinUrlJsonExtractUnsupported(e)) {
      try {
        const rows = await query<{
          id: string;
          linkedinLinkPrimaryLinkUrl: string | null;
          linkedinProviderId: string | null;
          emailsPrimaryEmail: string | null;
        }>(
          `SELECT p.id,
                  NULLIF(TRIM(p."linkedinLinkPrimaryLinkUrl"), '') AS "linkedinLinkPrimaryLinkUrl",
                  p."linkedinProviderId", p."emailsPrimaryEmail"
           FROM person p WHERE p.id = ANY($1::uuid[]) AND p."deletedAt" IS NULL`,
          [uniq]
        );
        for (const r of rows) {
          map.set(r.id, {
            linkedinLinkPrimaryLinkUrl: r.linkedinLinkPrimaryLinkUrl?.trim() || null,
            linkedinProviderId: r.linkedinProviderId?.trim() || null,
            emailsPrimaryEmail: r.emailsPrimaryEmail?.trim() || null,
          });
        }
      } catch (eFlat) {
        if (!isMissingColumn(eFlat, "linkedinProviderId")) throw eFlat;
        for (const id of uniq) {
          const one = await fetchPersonIdentityExtrasNoProvider(id);
          map.set(id, { ...one, linkedinProviderId: one.linkedinProviderId ?? null });
        }
      }
    } else if (isMissingColumn(e, "linkedinProviderId")) {
      for (const id of uniq) {
        const one = await fetchPersonIdentityExtrasNoProvider(id);
        map.set(id, one);
      }
    } else {
      for (const id of uniq) {
        map.set(id, await fetchPersonIdentityExtras(id));
      }
    }
  }
  return map;
}

async function batchFetchContentItems(
  contentIds: string[]
): Promise<Map<string, { title: string; contentType: string }>> {
  const map = new Map<string, { title: string; contentType: string }>();
  const uniq = [...new Set(contentIds.filter(Boolean))];
  if (uniq.length === 0) return map;
  const rows = await query<{ id: string; title: string; contentType: string }>(
    `SELECT id, title, "contentType" FROM "_content_item"
     WHERE id = ANY($1::uuid[]) AND "deletedAt" IS NULL`,
    [uniq]
  );
  for (const r of rows) {
    map.set(r.id, { title: r.title || "Untitled", contentType: r.contentType || "content" });
  }
  return map;
}

type QueueRow = {
  id: string;
  workflowId: string;
  stage: string;
  sourceType: string;
  sourceId: string;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  workflowName: string;
  ownerAgent: string;
  packageId: string | null;
  spec: unknown;
  itemType: string;
  board_stages: unknown;
};

/** Warm-outreach row even when spec uses a display label instead of `warm-outreach`. */
function itemLooksLikeWarmOutreach(
  workflowTypeId: string,
  spec: unknown,
  workflowName: string
): boolean {
  if (workflowTypeId === "warm-outreach") return true;
  const s = typeof spec === "string" ? spec : spec != null ? JSON.stringify(spec) : "";
  if (/warm[-_\s]?outreach/i.test(s)) return true;
  if (/\bwarm\s+outreach\b/i.test(workflowName || "")) return true;
  return false;
}

/** Same as resolve queue id, plus board-shape inference when spec/package omit workflowType. */
function effectiveWarmOutreachWorkflowTypeId(
  resolvedFromQueue: string,
  item: QueueRow
): string {
  return (
    resolvedFromQueue ||
    inferWorkflowRegistryFromBoardStages(item.board_stages) ||
    ""
  );
}

function itemLooksLikeWarmOutreachResolved(
  workflowTypeId: string,
  item: QueueRow
): boolean {
  const wid = effectiveWarmOutreachWorkflowTypeId(workflowTypeId, item);
  return itemLooksLikeWarmOutreach(wid, item.spec, item.workflowName);
}

/** Legacy warm slots used a CRM person row named Next / Contact instead of warm_discovery. */
async function isWarmOutreachPlaceholderPerson(personId: string): Promise<boolean> {
  try {
    const rows = await query<{ fn: string; ln: string }>(
      `SELECT TRIM(COALESCE(p."nameFirstName", '')) AS fn, TRIM(COALESCE(p."nameLastName", '')) AS ln
       FROM person p WHERE p.id = $1 AND p."deletedAt" IS NULL`,
      [personId]
    );
    const r = rows[0];
    if (!r) return false;
    return r.fn.toLowerCase() === "next" && r.ln.toLowerCase() === "contact";
  } catch {
    return false;
  }
}

/**
 * Warm-outreach discovery slots should use sourceType warm_discovery + opaque sourceId.
 * Rows with empty/unknown sourceType (or warm_discovery without sourceId) break titles and intake.
 * Legacy rows linked to placeholder person "Next Contact" are repointed here.
 */
async function repairWarmAwaitingDiscoveryRow(
  item: QueueRow,
  workflowTypeId: string
): Promise<QueueRow | null> {
  const stageKey = (item.stage || "").trim().toUpperCase();
  if (stageKey !== "AWAITING_CONTACT") return null;

  const warmLike = itemLooksLikeWarmOutreachResolved(workflowTypeId, item);
  const timOwner = String(item.ownerAgent || "").trim().toLowerCase() === "tim";

  const st = (item.sourceType || "").trim().toLowerCase();

  if (st === WARM_DISCOVERY_SOURCE_TYPE) {
    if (!warmLike) return null;
    if (item.sourceId && String(item.sourceId).trim()) return null;
    const nid = randomUUID();
    await query(
      `UPDATE "_workflow_item" SET "sourceId" = $1::uuid, "updatedAt" = NOW()
       WHERE id = $2 AND "deletedAt" IS NULL AND UPPER(TRIM(stage::text)) = 'AWAITING_CONTACT'`,
      [nid, item.id]
    );
    return { ...item, sourceType: WARM_DISCOVERY_SOURCE_TYPE, sourceId: nid };
  }

  if (st === "content") return null;

  if (st === "person" && item.sourceId) {
    const placeholder = await isWarmOutreachPlaceholderPerson(String(item.sourceId));
    if (!placeholder) return null;
    if (!warmLike && !timOwner) return null;
    const nid = randomUUID();
    await query(
      `UPDATE "_workflow_item" SET "sourceType" = $1, "sourceId" = $2::uuid, "updatedAt" = NOW()
       WHERE id = $3 AND "deletedAt" IS NULL AND UPPER(TRIM(stage::text)) = 'AWAITING_CONTACT'`,
      [WARM_DISCOVERY_SOURCE_TYPE, nid, item.id]
    );
    return { ...item, sourceType: WARM_DISCOVERY_SOURCE_TYPE, sourceId: nid };
  }

  if (st === "person") return null;

  if (!warmLike) return null;

  const nid = randomUUID();
  await query(
    `UPDATE "_workflow_item" SET "sourceType" = $1, "sourceId" = $2::uuid, "updatedAt" = NOW()
     WHERE id = $3 AND "deletedAt" IS NULL AND UPPER(TRIM(stage::text)) = 'AWAITING_CONTACT'`,
    [WARM_DISCOVERY_SOURCE_TYPE, nid, item.id]
  );
  return { ...item, sourceType: WARM_DISCOVERY_SOURCE_TYPE, sourceId: nid };
}

function warmMessagedWaitingHumanCopy(dueDate: string | null): string {
  const days = WARM_OUTREACH_MESSAGE_FOLLOW_UP_DAYS;
  if (!dueDate) {
    return `Nothing to submit. About ${days} days after send, the next message draft opens automatically (cron), or use **Start follow-up early** in the work pane. If they reply on LinkedIn, click **Replied**.`;
  }
  const d = new Date(dueDate);
  const now = new Date();
  const ms = d.getTime() - now.getTime();
  const dayRound = Math.max(1, Math.ceil(ms / 86_400_000));
  const dateStr = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  if (ms <= 0) {
    return `Follow-up is due (${dateStr}) — the next draft should open on the next automation run, or click **Start follow-up early**. If they replied, click **Replied**.`;
  }
  const inWords =
    dayRound === 1 ? "in about 1 day" : `in about ${dayRound} days`;
  return `Waiting — next **message draft** is scheduled for **${dateStr}** (${inWords}). Nothing to submit now. If they reply first, click **Replied**. You can start the follow-up early with **Start follow-up early**.`;
}

const DEFAULT_TIM_TASK_LIMIT = 80;
const MAX_TIM_TASK_LIMIT = 150;

function parseTimPagination(
  ownerAgentFilter: string | null,
  summaryOnly: boolean,
  searchParams: URLSearchParams
): { limit: number; offset: number } | null {
  if (ownerAgentFilter !== "tim" || summaryOnly) return null;
  const limitRaw = searchParams.get("limit");
  const offsetRaw = searchParams.get("offset");
  const limit = Math.min(
    MAX_TIM_TASK_LIMIT,
    Math.max(1, parseInt(limitRaw || String(DEFAULT_TIM_TASK_LIMIT), 10) || DEFAULT_TIM_TASK_LIMIT)
  );
  const offset = Math.max(0, parseInt(offsetRaw || "0", 10) || 0);
  return { limit, offset };
}

async function fetchHumanTaskRows(
  joinPackage: string,
  conditions: string[],
  params: unknown[],
  useHumanTaskOpenCol: boolean,
  useWorkflowItemTypeCol: boolean,
  ownerAgentLower: string | null,
  pagination: { limit: number; offset: number } | null,
  messagingOnly: boolean
): Promise<QueueRow[]> {
  const itemTypeSql = useWorkflowItemTypeCol
    ? 'w."itemType"'
    : `'person'::text AS "itemType"`;
  let humanOpenSql = "";
  if (useHumanTaskOpenCol) {
    if (ownerAgentLower === "tim") {
      /* Avoid w.spec::jsonb — empty or invalid JSON in spec aborts the whole query */
      humanOpenSql = `(
        wi."humanTaskOpen" = true
        OR (
          UPPER(TRIM(wi.stage::text)) = 'MESSAGED'
          AND COALESCE(w.spec::text, '') LIKE '%"workflowType"%'
          AND COALESCE(w.spec::text, '') LIKE '%warm-outreach%'
        )
        OR UPPER(TRIM(wi.stage::text)) IN (
          'REPLY_DRAFT',
          'REPLY_SENT',
          'LINKEDIN_INBOUND',
          'CONNECTION_ACCEPTED',
          'MESSAGE_DRAFT',
          'AWAITING_CONTACT',
          'INITIATED'
        )
      ) AND `;
    } else {
      humanOpenSql = 'wi."humanTaskOpen" = true AND ';
    }
  }
  const whereBody = conditions.join(" AND ");
  const queryParams = [...params];
  let limitSql = "";
  if (pagination) {
    queryParams.push(pagination.limit, pagination.offset);
    limitSql = ` LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`;
  }
  const orderSql =
    ownerAgentLower === "tim" && messagingOnly
      ? `ORDER BY COALESCE(wi."updatedAt", wi."createdAt") DESC, wi."createdAt" DESC`
      : `ORDER BY wi."dueDate" ASC NULLS FIRST, wi."createdAt" ASC`;
  return query<QueueRow>(
    `SELECT wi.id, wi."workflowId", wi.stage, wi."sourceType", wi."sourceId", wi."dueDate", wi."createdAt",
            wi."updatedAt",
            w.name AS "workflowName", w."ownerAgent", w."packageId", w.spec, ${itemTypeSql},
            b.stages AS board_stages
     FROM "_workflow_item" wi
     INNER JOIN "_workflow" w ON w.id = wi."workflowId"
     LEFT JOIN "_board" b ON b.id = w."boardId" AND b."deletedAt" IS NULL
     ${joinPackage}
     WHERE ${humanOpenSql}${whereBody}
     ${orderSql}${limitSql}`,
    queryParams
  );
}

function registryHumanMeta(
  workflowTypeId: string,
  stageKey: string
): { humanAction: string; stageLabel: string } | null {
  const spec = WORKFLOW_TYPES[workflowTypeId];
  if (!spec) return null;
  const st = spec.defaultBoard.stages.find((s) => s.key.toUpperCase() === stageKey);
  if (!st?.requiresHuman || !st.humanAction) return null;
  return { humanAction: st.humanAction, stageLabel: st.label };
}

export async function GET(req: NextRequest) {
  const packageStageFilter = req.nextUrl.searchParams.get("packageStage");
  const ownerAgentFilter = req.nextUrl.searchParams.get("ownerAgent")?.trim().toLowerCase() || null;
  const sourceTypeFilter = req.nextUrl.searchParams.get("sourceType")?.trim().toLowerCase() || null;
  const excludePackageStagesRaw = req.nextUrl.searchParams.get("excludePackageStages");
  const excludePackageStages = excludePackageStagesRaw
    ? excludePackageStagesRaw
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter((s) => s.length > 0)
    : [];
  const messagingOnly =
    req.nextUrl.searchParams.get("messagingOnly") === "true" ||
    req.nextUrl.searchParams.get("messagingOnly") === "1";
  const summaryOnly =
    req.nextUrl.searchParams.get("summary") === "1" ||
    req.nextUrl.searchParams.get("summary") === "true";
  const includeInactivePackages =
    req.nextUrl.searchParams.get("includeInactivePackages") === "1" ||
    req.nextUrl.searchParams.get("includeInactivePackages") === "true";
  const timOpsQueueOnly = ownerAgentFilter === "tim" && !includeInactivePackages;
  const timPagination = parseTimPagination(ownerAgentFilter, summaryOnly, req.nextUrl.searchParams);
  try {
    const conditions: string[] = ['wi."deletedAt" IS NULL', 'w."deletedAt" IS NULL'];
    const params: unknown[] = [];

    if (ownerAgentFilter) {
      params.push(ownerAgentFilter);
      conditions.push(`LOWER(TRIM(COALESCE(w."ownerAgent"::text, ''))) = $${params.length}`);
    }

    if (sourceTypeFilter) {
      params.push(sourceTypeFilter);
      conditions.push(`LOWER(TRIM(COALESCE(wi."sourceType"::text, ''))) = $${params.length}`);
    }

    if (packageStageFilter) {
      params.push(packageStageFilter.toUpperCase());
      conditions.push(
        `(w."packageId" IS NULL OR UPPER(TRIM(COALESCE(p.stage::text, ''))) = $${params.length})`
      );
    }

    if (excludePackageStages.length > 0) {
      const start = params.length;
      for (const st of excludePackageStages) {
        params.push(st);
      }
      const placeholders = excludePackageStages.map((_, i) => `$${start + i + 1}`).join(", ");
      conditions.push(
        `(w."packageId" IS NULL OR UPPER(TRIM(COALESCE(p.stage::text, ''))) NOT IN (${placeholders}))`
      );
    }

    const needsPackageJoin =
      Boolean(packageStageFilter) ||
      excludePackageStages.length > 0 ||
      timOpsQueueOnly;

    const joinPackage = needsPackageJoin
      ? 'LEFT JOIN "_package" p ON p.id = w."packageId" AND p."deletedAt" IS NULL'
      : "";

    if (timOpsQueueOnly && !packageStageFilter) {
      conditions.push(
        `(w."packageId" IS NULL OR UPPER(TRIM(COALESCE(p.stage::text, ''))) = 'ACTIVE')`
      );
    }

    let useHumanTaskOpenCol = true;
    let useWorkflowItemTypeCol = true;
    let rows: QueueRow[] = [];
    let tried = 0;
    while (tried < 5) {
      tried++;
      try {
        rows = await fetchHumanTaskRows(
          joinPackage,
          conditions,
          params,
          useHumanTaskOpenCol,
          useWorkflowItemTypeCol,
          ownerAgentFilter,
          timPagination,
          messagingOnly
        );
        break;
      } catch (e) {
        if (isMissingColumn(e, "humanTaskOpen")) {
          useHumanTaskOpenCol = false;
          continue;
        }
        if (isMissingColumn(e, "itemType")) {
          useWorkflowItemTypeCol = false;
          continue;
        }
        throw e;
      }
    }

    if (!useHumanTaskOpenCol) {
      rows = rows.filter((r) => humanTaskOpenFromBoardStages(r.board_stages, r.stage));
    }

    const packageNames: Record<string, string> = {};
    const packageStages: Record<string, string> = {};
    const packageNumbers: Record<string, number | null> = {};
    const packageSpecs: Record<string, unknown> = {};
    const pkgIds = [...new Set(rows.map((r) => r.packageId).filter(Boolean))] as string[];
    if (pkgIds.length > 0) {
      const pkgPlaceholders = pkgIds.map((_, i) => `$${i + 1}`).join(", ");
      type PkgRow = { id: string; name: string; stage: string; packageNumber?: number | null; spec: unknown };
      let pkgs: PkgRow[] = [];
      try {
        pkgs = (await query<PkgRow>(
          `SELECT id, name, stage, "packageNumber", spec FROM "_package" WHERE id IN (${pkgPlaceholders}) AND "deletedAt" IS NULL`,
          pkgIds
        )) as PkgRow[];
      } catch (e) {
        if (!isMissingPackageNumberColumn(e)) throw e;
        pkgs = (await query<PkgRow>(
          `SELECT id, name, stage, spec FROM "_package" WHERE id IN (${pkgPlaceholders}) AND "deletedAt" IS NULL`,
          pkgIds
        )) as PkgRow[];
      }
      for (const p of pkgs) {
        packageNames[p.id] = p.name;
        packageSpecs[p.id] = p.spec;
        packageStages[p.id] = (p.stage || "").toUpperCase();
        const pn = p.packageNumber;
        packageNumbers[p.id] =
          pn != null && typeof pn === "number"
            ? pn
            : pn != null
              ? parseInt(String(pn), 10)
              : null;
      }
    }

    if (summaryOnly && ownerAgentFilter === "tim") {
      let activeCount = 0;
      let pendingFollowUpCount = 0;
      for (const item of rows) {
        const stageKey = item.stage?.trim().toUpperCase() || "";
        if (messagingOnly && !MESSAGING_ITEM_STAGES.has(stageKey)) continue;
        const workflowTypeId =
          resolveWorkflowRegistryForQueue(item.spec, {
            packageSpec: item.packageId ? packageSpecs[item.packageId] : undefined,
            ownerAgent: item.ownerAgent,
            boardStages: item.board_stages,
          }) || "";
        const waitingFollowUp = workflowTypeId === "warm-outreach" && stageKey === "MESSAGED";
        if (waitingFollowUp) pendingFollowUpCount += 1;
        else activeCount += 1;
      }
      const warmOutreachDaily = await getWarmOutreachDailyProgressForTim();
      return NextResponse.json({
        summary: true,
        count: activeCount,
        pendingFollowUpCount,
        warmOutreachDaily,
      });
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const stageKeyR = row.stage?.trim().toUpperCase() || "";
      if (messagingOnly && !MESSAGING_ITEM_STAGES.has(stageKeyR)) continue;
      const workflowTypeIdR =
        resolveWorkflowRegistryForQueue(row.spec, {
          packageSpec: row.packageId ? packageSpecs[row.packageId] : undefined,
          ownerAgent: row.ownerAgent,
          boardStages: row.board_stages,
        }) || "";
      const patched = await repairWarmAwaitingDiscoveryRow(row, workflowTypeIdR);
      if (patched) rows[i] = patched;
    }

    const personSourceIds = [
      ...new Set(
        rows
          .filter((r) => r.sourceType === "person" && r.sourceId)
          .map((r) => r.sourceId as string)
      ),
    ];
    const itemIdsAll = rows.map((r) => r.id);
    const contentSourceIds = [
      ...new Set(
        rows
          .filter((r) => r.sourceType === "content" && r.sourceId)
          .map((r) => r.sourceId as string)
      ),
    ];

    const [personRowsMap, identityMap, awaitingByItem, linkedinArtByItem, contentById] =
      await Promise.all([
        batchFetchPersonsWithCompany(personSourceIds),
        batchFetchPersonIdentityExtrasMap(personSourceIds),
        batchGetLatestAwaitingContactArtifactContentByItemIds(itemIdsAll),
        batchGetLatestLinkedInArtifactUrlByItemIds(itemIdsAll),
        batchFetchContentItems(contentSourceIds),
      ]);

    const personIdsToRefetch = new Set<string>();
    for (const item of rows) {
      const stageKeyPre = item.stage?.trim().toUpperCase() || "";
      if (messagingOnly && !MESSAGING_ITEM_STAGES.has(stageKeyPre)) continue;
      if (item.sourceType !== "person" || !item.sourceId) continue;
      const workflowTypeIdPre =
        resolveWorkflowRegistryForQueue(item.spec, {
          packageSpec: item.packageId ? packageSpecs[item.packageId] : undefined,
          ownerAgent: item.ownerAgent,
          boardStages: item.board_stages,
        }) || "";
      const pPre = personRowsMap.get(item.sourceId);
      if (!pPre) continue;
      const fnPre = (pPre.firstName || "").trim();
      const lnPre = (pPre.lastName || "").trim();
      if (
        itemLooksLikeWarmOutreachResolved(workflowTypeIdPre, item) &&
        fnPre === "Next" &&
        lnPre === "Contact"
      ) {
        const healLogs: string[] = [];
        const healed = await tryHealWarmPersonFromAwaitingArtifact(item.id, item.sourceId, healLogs);
        if (healed) personIdsToRefetch.add(item.sourceId);
        if (healLogs.length) console.info("[human-tasks] warm heal:", healLogs.join(" "));
      }
    }
    if (personIdsToRefetch.size > 0) {
      const refPers = await batchFetchPersonsWithCompany([...personIdsToRefetch]);
      for (const [k, v] of refPers) personRowsMap.set(k, v);
      const refId = await batchFetchPersonIdentityExtrasMap([...personIdsToRefetch]);
      for (const [k, v] of refId) identityMap.set(k, v);
    }

    const tasks: Array<{
      itemId: string;
      itemTitle: string;
      itemSubtitle: string;
      sourceId: string | null;
      workflowId: string;
      workflowName: string;
      packageName: string;
      ownerAgent: string;
      packageId: string | null;
      packageNumber: number | null;
      packageStage: string | null;
      inActiveCampaign: boolean;
      workflowType: string;
      stage: string;
      stageLabel: string;
      humanAction: string;
      dueDate: string | null;
      itemType: string;
      createdAt: string;
      /** Last workflow-item touch (new messages bump this); used for messaging queue sort */
      updatedAt: string;
      /** Warm-outreach MESSAGED: in Tim’s list for context, not an actionable submit step */
      waitingFollowUp: boolean;
      /** Person row: display in Tim warm-outreach contact strip (null = empty slot) */
      contactSlotOpen?: boolean;
      contactName?: string | null;
      /** CRM / intake first name — Tim message UI copy (“when Mike answers”). */
      contactFirstName?: string | null;
      contactCompany?: string | null;
      contactTitle?: string | null;
      /** Linked person still Next/Contact — CRM intake not applied; use sync-warm-person. */
      contactDbSyncPending?: boolean;
      /** Person row: public LinkedIn profile URL (normalized) */
      contactLinkedinPublicUrl?: string | null;
      /** Person row: Unipile / LinkedIn API member id (ACoA…) when stored */
      contactLinkedinMemberId?: string | null;
      contactPrimaryEmail?: string | null;
    }> = [];

    for (const item of rows) {
      const stageKey = item.stage?.trim().toUpperCase() || "";
      if (messagingOnly && !MESSAGING_ITEM_STAGES.has(stageKey)) continue;

      const matchedType = resolveWorkflowRegistryForQueue(item.spec, {
        packageSpec: item.packageId ? packageSpecs[item.packageId] : undefined,
        ownerAgent: item.ownerAgent,
        boardStages: item.board_stages,
      });
      const workflowTypeId = matchedType || "";

      const fromBoard = boardHumanMetaForStage(item.board_stages, item.stage);
      const fromRegistry =
        workflowTypeId && !fromBoard ? registryHumanMeta(workflowTypeId, stageKey) : null;
      let stageInfo = fromBoard
        ? { stageLabel: fromBoard.label, humanAction: fromBoard.humanAction }
        : fromRegistry || {
            stageLabel: stageKey.replace(/_/g, " "),
            humanAction: "Complete this step.",
          };

      const waitingFollowUp = workflowTypeId === "warm-outreach" && stageKey === "MESSAGED";
      if (waitingFollowUp) {
        stageInfo = {
          stageLabel: "Messaged — waiting",
          humanAction: warmMessagedWaitingHumanCopy(item.dueDate),
        };
      }

      let title = "Unknown";
      let subtitle = "";
      let contactSlotOpen = false;
      let contactName: string | null = null;
      let contactFirstName: string | null = null;
      let contactCompany: string | null = null;
      let contactTitle: string | null = null;
      let contactDbSyncPending = false;
      let contactLinkedinPublicUrl: string | null = null;
      let contactLinkedinMemberId: string | null = null;
      let contactPrimaryEmail: string | null = null;

      if (item.sourceType === "person") {
        try {
          const p =
            item.sourceId != null ? personRowsMap.get(item.sourceId) ?? null : null;
          if (p) {
            const warmContactArtifactRaw: string | null = awaitingByItem.get(item.id) ?? null;
            const fn = (p.firstName || "").trim();
            const ln = (p.lastName || "").trim();
            const fullName = [fn, ln].filter(Boolean).join(" ") || "";
            const job = (p.jobTitle || "").trim() || null;
            const co = p.companyName?.trim() || null;
            const isWarmDiscoveryPlaceholder =
              itemLooksLikeWarmOutreachResolved(workflowTypeId, item) &&
              stageKey === "AWAITING_CONTACT" &&
              fn === "Next" &&
              ln === "Contact";

            const isStaleWarmPlaceholder =
              itemLooksLikeWarmOutreachResolved(workflowTypeId, item) &&
              fn === "Next" &&
              ln === "Contact" &&
              stageKey !== "AWAITING_CONTACT";

            if (isWarmDiscoveryPlaceholder) {
              contactSlotOpen = true;
              title = "Awaiting contact";
              subtitle = "Use Tim’s work queue: name, LinkedIn URL, notes";
              contactName = null;
              contactFirstName = null;
              contactCompany = null;
              contactTitle = null;
            } else if (isStaleWarmPlaceholder) {
              contactSlotOpen = false;
              title = "Contact — not saved yet";
              subtitle = "Re-submit intake from the Contact details artifact, or use Name:/Company:/Title: lines.";
              contactName = null;
              contactFirstName = null;
              contactCompany = null;
              contactTitle = null;
            } else {
              title = fullName || "Contact";
              subtitle = job || "";
              contactName = fullName || null;
              contactFirstName =
                fn && !(fn === "Next" && ln === "Contact") ? fn : contactFirstName;
              contactCompany = co;
              contactTitle = job;
            }

            if (
              itemLooksLikeWarmOutreachResolved(workflowTypeId, item) &&
              !contactSlotOpen &&
              fn === "Next" &&
              ln === "Contact"
            ) {
              const raw = warmContactArtifactRaw;
              if (raw) {
                const parsed = ensureIntakeNameFromRawLines(raw, parseWarmContactIntake(raw));
                const displayName = [parsed.firstName, parsed.lastName].filter(Boolean).join(" ").trim();
                if (displayName) {
                  contactName = displayName;
                  title = displayName;
                }
                if (parsed.firstName?.trim()) contactFirstName = parsed.firstName.trim();
                if (parsed.companyName?.trim()) contactCompany = parsed.companyName.trim();
                if (parsed.jobTitle?.trim()) {
                  contactTitle = parsed.jobTitle.trim();
                  subtitle = parsed.jobTitle.trim();
                }
              }
            }

            contactDbSyncPending =
              itemLooksLikeWarmOutreachResolved(workflowTypeId, item) &&
              fn === "Next" &&
              ln === "Contact";

            if (item.sourceId) {
              try {
                const idf = identityMap.get(item.sourceId);
                if (idf) {
                  const parsedLi = parsePersonLinkedInFields(
                    idf.linkedinLinkPrimaryLinkUrl,
                    idf.linkedinProviderId
                  );
                  contactLinkedinPublicUrl = parsedLi.publicProfileUrl;
                  contactLinkedinMemberId = parsedLi.providerMemberId;
                  contactPrimaryEmail = idf.emailsPrimaryEmail?.trim() || null;
                }
              } catch (idErr) {
                console.warn(
                  "[human-tasks] person identity extras:",
                  errCode(idErr),
                  errMsg(idErr).slice(0, 120)
                );
              }
            }

            const timLinkedInArtifactFallback =
              itemLooksLikeWarmOutreachResolved(workflowTypeId, item) ||
              workflowTypeId === "linkedin-outreach";

            if (
              timLinkedInArtifactFallback &&
              item.sourceId &&
              !contactLinkedinPublicUrl &&
              !contactLinkedinMemberId
            ) {
              const raw = warmContactArtifactRaw;
              if (raw) {
                const intakeParsed = parseWarmContactIntake(raw);
                const li = parsePersonLinkedInFields(intakeParsed.linkedinUrl, null);
                if (li.publicProfileUrl) contactLinkedinPublicUrl = li.publicProfileUrl;
                if (li.providerMemberId) contactLinkedinMemberId = li.providerMemberId;
              }
            }

            if (
              timLinkedInArtifactFallback &&
              item.sourceId &&
              !contactLinkedinPublicUrl &&
              !contactLinkedinMemberId
            ) {
              const urlFromArtifact = linkedinArtByItem.get(item.id) ?? null;
              if (urlFromArtifact) {
                const li = parsePersonLinkedInFields(urlFromArtifact, null);
                if (li.publicProfileUrl) contactLinkedinPublicUrl = li.publicProfileUrl;
                if (li.providerMemberId) contactLinkedinMemberId = li.providerMemberId;
              }
            }
          } else {
            title = "Contact";
          }
        } catch (pe) {
          console.warn("[human-tasks] person lookup:", errCode(pe), errMsg(pe).slice(0, 120));
          title = "Contact";
        }
      } else if (item.sourceType === WARM_DISCOVERY_SOURCE_TYPE) {
        const warmLike = itemLooksLikeWarmOutreachResolved(workflowTypeId, item);
        if (stageKey === "AWAITING_CONTACT") {
          contactSlotOpen = true;
          title = "Awaiting contact";
          subtitle = "Use Tim’s work queue: name, LinkedIn URL, notes";
          const raw = awaitingByItem.get(item.id) ?? null;
          if (raw) {
            const parsed = ensureIntakeNameFromRawLines(raw, parseWarmContactIntake(raw));
            const displayName = [parsed.firstName, parsed.lastName].filter(Boolean).join(" ").trim();
            if (displayName) {
              contactName = displayName;
            }
            if (parsed.firstName?.trim()) contactFirstName = parsed.firstName.trim();
            if (parsed.companyName?.trim()) contactCompany = parsed.companyName.trim();
            if (parsed.jobTitle?.trim()) {
              contactTitle = parsed.jobTitle.trim();
              subtitle = parsed.jobTitle.trim();
            }
            const li = parsePersonLinkedInFields(parsed.linkedinUrl, null);
            if (li.publicProfileUrl) contactLinkedinPublicUrl = li.publicProfileUrl;
            if (li.providerMemberId) contactLinkedinMemberId = li.providerMemberId;
          }
          if (!contactLinkedinPublicUrl && !contactLinkedinMemberId) {
            const urlFromArtifact = linkedinArtByItem.get(item.id) ?? null;
            if (urlFromArtifact) {
              const li = parsePersonLinkedInFields(urlFromArtifact, null);
              if (li.publicProfileUrl) contactLinkedinPublicUrl = li.publicProfileUrl;
              if (li.providerMemberId) contactLinkedinMemberId = li.providerMemberId;
            }
          }
        } else if (warmLike) {
          title = "Warm outreach slot";
          subtitle = stageKey ? stageKey.replace(/_/g, " ").toLowerCase() : "";
        } else {
          title = "Discovery slot";
          subtitle = item.sourceId ? String(item.sourceId).slice(0, 8) + "…" : "";
        }
      } else if (item.sourceType === "content") {
        try {
          const row = item.sourceId ? contentById.get(item.sourceId) : undefined;
          if (row) {
            title = row.title || "Untitled";
            subtitle = row.contentType || "content";
          }
        } catch (ce) {
          console.warn("[human-tasks] _content_item lookup:", errCode(ce), errMsg(ce).slice(0, 120));
          title = "Content item";
          subtitle = item.sourceId ? String(item.sourceId).slice(0, 8) : "";
        }
      }

      if (
        stageKey === "AWAITING_CONTACT" &&
        itemLooksLikeWarmOutreachResolved(workflowTypeId, item) &&
        (!title.trim() || title === "Unknown")
      ) {
        title = "Awaiting contact";
        if (!subtitle.trim()) subtitle = "Use Tim’s work queue: name, LinkedIn URL, notes";
        contactSlotOpen = true;
      }

      const pkgStage = item.packageId ? packageStages[item.packageId] || null : null;
      const inActiveCampaign = Boolean(item.packageId && pkgStage === "ACTIVE");
      const pkgNum =
        item.packageId && packageNumbers[item.packageId] != null && !Number.isNaN(packageNumbers[item.packageId] as number)
          ? packageNumbers[item.packageId]
          : null;

      tasks.push({
        itemId: item.id,
        itemTitle: title,
        itemSubtitle: subtitle,
        sourceId: item.sourceId || null,
        workflowId: item.workflowId,
        workflowName: item.workflowName,
        packageName: item.packageId ? (packageNames[item.packageId] || "") : "",
        ownerAgent: item.ownerAgent,
        packageId: item.packageId,
        packageNumber: pkgNum,
        packageStage: pkgStage,
        inActiveCampaign,
        workflowType: workflowTypeId,
        stage: stageKey,
        stageLabel: stageInfo.stageLabel,
        humanAction: stageInfo.humanAction,
        dueDate: item.dueDate || null,
        itemType: item.sourceType,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt || item.createdAt,
        waitingFollowUp,
        ...(item.sourceType === "person" || item.sourceType === WARM_DISCOVERY_SOURCE_TYPE
          ? {
              contactSlotOpen,
              contactName,
              contactFirstName,
              contactCompany,
              contactTitle,
              contactDbSyncPending,
              contactLinkedinPublicUrl,
              contactLinkedinMemberId,
              contactPrimaryEmail,
            }
          : {}),
      });
    }

    const count =
      ownerAgentFilter === "tim"
        ? tasks.filter((t) => !t.waitingFollowUp).length
        : tasks.length;

    if (ownerAgentFilter === "tim") {
      const warmOutreachDaily = await getWarmOutreachDailyProgressForTim();
      const sqlHasMore = timPagination != null && rows.length === timPagination.limit;
      const nextOffset = sqlHasMore ? timPagination.offset + timPagination.limit : null;
      return NextResponse.json({
        tasks,
        count,
        warmOutreachDaily,
        hasMore: sqlHasMore,
        nextOffset,
      });
    }

    return NextResponse.json({ tasks, count });
  } catch (error) {
    if (errCode(error) === "42P01" && errMsg(error).includes("_workflow_item")) {
      console.warn(
        "[human-tasks] _workflow_item missing — run web/scripts/migrate-workflows.sql on the CRM database"
      );
      return NextResponse.json({
        tasks: [],
        count: 0,
        schemaWarning: "CRM migrations pending (missing _workflow_item)",
      });
    }
    console.error("[human-tasks] GET error:", error);
    return NextResponse.json({ error: "Failed to fetch human tasks" }, { status: 500 });
  }
}
