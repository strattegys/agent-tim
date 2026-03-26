import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { WORKFLOW_TYPES } from "@/lib/workflow-types";
import { resolveWorkflowRegistryForQueue } from "@/lib/workflow-spec";
import {
  boardHumanMetaForStage,
  humanTaskOpenFromBoardStages,
} from "@/lib/workflow-item-human-task";
import { WARM_OUTREACH_MESSAGE_FOLLOW_UP_DAYS } from "@/lib/warm-outreach-cadence";
import {
  getLatestAwaitingContactArtifactContent,
  tryHealWarmPersonFromAwaitingArtifact,
} from "@/lib/warm-contact-intake-apply";
import { ensureIntakeNameFromRawLines, parseWarmContactIntake } from "@/lib/warm-contact-intake-parse";
import { getWarmOutreachDailyProgressForTim } from "@/lib/warm-outreach-daily-progress";

/**
 * GET /api/crm/human-tasks?packageStage=ACTIVE&ownerAgent=tim&messagingOnly=true
 *
 * Rows are driven by _workflow_item.humanTaskOpen (synced from board stages[].requiresHuman).
 * Optional:
 * - packageStage — filter by _package.stage
 * - ownerAgent — filter workflows by owner (e.g. tim)
 * - messagingOnly — only messaging-related item stages
 */
const MESSAGING_ITEM_STAGES = new Set([
  "INITIATED",
  "AWAITING_CONTACT",
  "MESSAGE_DRAFT",
  "MESSAGED",
  "REPLY_DRAFT",
  "REPLY_SENT",
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

/** Postgres 42703 or English message */
function isMissingColumn(error: unknown, name: string): boolean {
  const msg = errMsg(error);
  const re = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  if (errCode(error) === "42703" && re.test(msg)) return true;
  return re.test(msg) && (/column/i.test(msg) || /field/i.test(msg)) && /does not exist/i.test(msg);
}

type QueueRow = {
  id: string;
  workflowId: string;
  stage: string;
  sourceType: string;
  sourceId: string;
  dueDate: string | null;
  createdAt: string;
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

async function fetchHumanTaskRows(
  joinPackage: string,
  conditions: string[],
  params: unknown[],
  useHumanTaskOpenCol: boolean,
  useWorkflowItemTypeCol: boolean,
  ownerAgentLower: string | null
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
      ) AND `;
    } else {
      humanOpenSql = 'wi."humanTaskOpen" = true AND ';
    }
  }
  const whereBody = conditions.join(" AND ");
  return query<QueueRow>(
    `SELECT wi.id, wi."workflowId", wi.stage, wi."sourceType", wi."sourceId", wi."dueDate", wi."createdAt",
            w.name AS "workflowName", w."ownerAgent", w."packageId", w.spec, ${itemTypeSql},
            b.stages AS board_stages
     FROM "_workflow_item" wi
     INNER JOIN "_workflow" w ON w.id = wi."workflowId"
     LEFT JOIN "_board" b ON b.id = w."boardId" AND b."deletedAt" IS NULL
     ${joinPackage}
     WHERE ${humanOpenSql}${whereBody}
     ORDER BY wi."dueDate" ASC NULLS FIRST, wi."createdAt" ASC`,
    params
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
  const messagingOnly =
    req.nextUrl.searchParams.get("messagingOnly") === "true" ||
    req.nextUrl.searchParams.get("messagingOnly") === "1";
  try {
    const conditions: string[] = ['wi."deletedAt" IS NULL', 'w."deletedAt" IS NULL'];
    const params: unknown[] = [];

    if (ownerAgentFilter) {
      params.push(ownerAgentFilter);
      conditions.push(`LOWER(TRIM(COALESCE(w."ownerAgent"::text, ''))) = $${params.length}`);
    }

    if (packageStageFilter) {
      params.push(packageStageFilter.toUpperCase());
      conditions.push(
        `(w."packageId" IS NULL OR UPPER(TRIM(COALESCE(p.stage::text, ''))) = $${params.length})`
      );
    }

    const joinPackage = packageStageFilter
      ? 'LEFT JOIN "_package" p ON p.id = w."packageId" AND p."deletedAt" IS NULL'
      : "";

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
          ownerAgentFilter
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
      /** Warm-outreach MESSAGED: in Tim’s list for context, not an actionable submit step */
      waitingFollowUp: boolean;
      /** Person row: display in Tim warm-outreach contact strip (null = empty slot) */
      contactSlotOpen?: boolean;
      contactName?: string | null;
      contactCompany?: string | null;
      contactTitle?: string | null;
      /** Linked person still Next/Contact — CRM intake not applied; use sync-warm-person. */
      contactDbSyncPending?: boolean;
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
      let contactCompany: string | null = null;
      let contactTitle: string | null = null;
      let contactDbSyncPending = false;

      if (item.sourceType === "person") {
        try {
          type PersonQueueRow = {
            firstName: string | null;
            lastName: string | null;
            jobTitle: string | null;
            companyName: string | null;
          };
          let persons: PersonQueueRow[];
          try {
            persons = await query<PersonQueueRow>(
              `SELECT p."nameFirstName" AS "firstName",
                      p."nameLastName" AS "lastName",
                      p."jobTitle" AS "jobTitle",
                      NULLIF(TRIM(COALESCE(c.name, '')), '') AS "companyName"
               FROM person p
               LEFT JOIN company c ON c.id = p."companyId" AND c."deletedAt" IS NULL
               WHERE p.id = $1 AND p."deletedAt" IS NULL`,
              [item.sourceId]
            );
          } catch (joinErr) {
            if (isMissingColumn(joinErr, "companyId") || isMissingColumn(joinErr, "company")) {
              persons = await query<PersonQueueRow>(
                `SELECT "nameFirstName" AS "firstName", "nameLastName" AS "lastName", "jobTitle",
                        NULL::text AS "companyName"
                 FROM person WHERE id = $1 AND "deletedAt" IS NULL`,
                [item.sourceId]
              );
            } else {
              throw joinErr;
            }
          }
          if (persons.length > 0) {
            let p = persons[0];
            let fn = (p.firstName || "").trim();
            let ln = (p.lastName || "").trim();

            if (
              itemLooksLikeWarmOutreach(workflowTypeId, item.spec, item.workflowName) &&
              fn === "Next" &&
              ln === "Contact" &&
              item.sourceId
            ) {
              const healLogs: string[] = [];
              const healed = await tryHealWarmPersonFromAwaitingArtifact(item.id, item.sourceId, healLogs);
              if (healed) {
                try {
                  persons = await query<PersonQueueRow>(
                    `SELECT p."nameFirstName" AS "firstName",
                            p."nameLastName" AS "lastName",
                            p."jobTitle" AS "jobTitle",
                            NULLIF(TRIM(COALESCE(c.name, '')), '') AS "companyName"
                     FROM person p
                     LEFT JOIN company c ON c.id = p."companyId" AND c."deletedAt" IS NULL
                     WHERE p.id = $1 AND p."deletedAt" IS NULL`,
                    [item.sourceId]
                  );
                } catch (reErr) {
                  if (isMissingColumn(reErr, "companyId") || isMissingColumn(reErr, "company")) {
                    persons = await query<PersonQueueRow>(
                      `SELECT "nameFirstName" AS "firstName", "nameLastName" AS "lastName", "jobTitle",
                              NULL::text AS "companyName"
                       FROM person WHERE id = $1 AND "deletedAt" IS NULL`,
                      [item.sourceId]
                    );
                  } else {
                    throw reErr;
                  }
                }
                if (persons.length > 0) p = persons[0];
              }
              if (healLogs.length) {
                console.info("[human-tasks] warm-outreach placeholder heal:", healLogs.join(" "));
              }
            }

            fn = (p.firstName || "").trim();
            ln = (p.lastName || "").trim();
            const fullName = [fn, ln].filter(Boolean).join(" ") || "";
            const job = (p.jobTitle || "").trim() || null;
            const co = p.companyName?.trim() || null;
            const isWarmDiscoveryPlaceholder =
              itemLooksLikeWarmOutreach(workflowTypeId, item.spec, item.workflowName) &&
              stageKey === "AWAITING_CONTACT" &&
              fn === "Next" &&
              ln === "Contact";

            const isStaleWarmPlaceholder =
              itemLooksLikeWarmOutreach(workflowTypeId, item.spec, item.workflowName) &&
              fn === "Next" &&
              ln === "Contact" &&
              stageKey !== "AWAITING_CONTACT";

            if (isWarmDiscoveryPlaceholder) {
              contactSlotOpen = true;
              title = "Next contact — add who to reach";
              subtitle = "Use Tim’s work queue: name, LinkedIn URL, notes";
              contactName = null;
              contactCompany = null;
              contactTitle = null;
            } else if (isStaleWarmPlaceholder) {
              contactSlotOpen = false;
              title = "Contact — not saved yet";
              subtitle = "Re-submit intake from the Contact details artifact, or use Name:/Company:/Title: lines.";
              contactName = null;
              contactCompany = null;
              contactTitle = null;
            } else {
              title = fullName || "Contact";
              subtitle = job || "";
              contactName = fullName || null;
              contactCompany = co;
              contactTitle = job;
            }

            /* CRM row still “Next / Contact” but intake artifact has text — show parsed name/company/title in Tim header even if DB update failed. */
            if (
              itemLooksLikeWarmOutreach(workflowTypeId, item.spec, item.workflowName) &&
              !contactSlotOpen &&
              fn === "Next" &&
              ln === "Contact"
            ) {
              const raw = await getLatestAwaitingContactArtifactContent(item.id);
              if (raw) {
                const parsed = ensureIntakeNameFromRawLines(raw, parseWarmContactIntake(raw));
                const displayName = [parsed.firstName, parsed.lastName].filter(Boolean).join(" ").trim();
                if (displayName) {
                  contactName = displayName;
                  title = displayName;
                }
                if (parsed.companyName?.trim()) contactCompany = parsed.companyName.trim();
                if (parsed.jobTitle?.trim()) {
                  contactTitle = parsed.jobTitle.trim();
                  subtitle = parsed.jobTitle.trim();
                }
              }
            }

            contactDbSyncPending =
              itemLooksLikeWarmOutreach(workflowTypeId, item.spec, item.workflowName) &&
              fn === "Next" &&
              ln === "Contact";
          }
        } catch (pe) {
          console.warn("[human-tasks] person lookup:", errCode(pe), errMsg(pe).slice(0, 120));
          title = "Contact";
        }
      } else if (item.sourceType === "content") {
        try {
          const contents = await query<{ title: string; contentType: string }>(
            `SELECT title, "contentType" FROM "_content_item" WHERE id = $1 AND "deletedAt" IS NULL`,
            [item.sourceId]
          );
          if (contents.length > 0) {
            title = contents[0].title || "Untitled";
            subtitle = contents[0].contentType || "content";
          }
        } catch (ce) {
          console.warn("[human-tasks] _content_item lookup:", errCode(ce), errMsg(ce).slice(0, 120));
          title = "Content item";
          subtitle = item.sourceId ? String(item.sourceId).slice(0, 8) : "";
        }
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
        waitingFollowUp,
        ...(item.sourceType === "person"
          ? {
              contactSlotOpen,
              contactName,
              contactCompany,
              contactTitle,
              contactDbSyncPending,
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
      return NextResponse.json({ tasks, count, warmOutreachDaily });
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
