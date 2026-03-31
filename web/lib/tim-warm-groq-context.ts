/**
 * Server-side warm / LinkedIn outreach context for Tim → Groq (interactive chat + autogen).
 * Mirrors data sources used in human-tasks resolve REPLY_DRAFT; keeps sub-budgets to limit tokens.
 */

import { query } from "@/lib/db";
import { PACKAGE_BRIEF_STAGE } from "@/lib/package-brief-artifact";
import { resolveWorkflowRegistryForQueue } from "@/lib/workflow-spec";
import {
  buildStructuredWarmThreadTranscriptForLlm,
  extractLastWarmInboundFromArtifactRows,
  type WarmThreadArtifactRow,
} from "@/lib/warm-outreach-draft";

/** Sub-budgets (chars) — total stays within appendEphemeralContext cap with client work context. */
export const TIM_WARM_AUG_MAX_PACKAGE = 3_200;
export const TIM_WARM_AUG_MAX_NOTES = 3_600;
export const TIM_WARM_AUG_MAX_ENRICHMENT = 4_800;
export const TIM_WARM_AUG_MAX_THREAD = 6_500;
const TIM_WARM_AUG_MAX_KB_JOINED = 4_200;

export async function getWarmContactNotes(itemId: string): Promise<string> {
  const rows = await query<{ content: string }>(
    `SELECT content FROM "_artifact" WHERE "workflowItemId" = $1 AND stage = 'AWAITING_CONTACT' AND "deletedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1`,
    [itemId]
  );
  return rows[0]?.content?.trim() || "";
}

/** PACKAGE_BRIEF artifact first, else live `spec.brief` from the package row. */
export async function getWarmPackageBriefForItem(itemId: string): Promise<string> {
  const art = await query<{ content: string }>(
    `SELECT content FROM "_artifact" WHERE "workflowItemId" = $1 AND stage = $2 AND "deletedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1`,
    [itemId, PACKAGE_BRIEF_STAGE]
  );
  const fromArtifact = art[0]?.content?.trim();
  if (fromArtifact) return fromArtifact;

  const pkgRows = await query<{ brief: string | null }>(
    `SELECT (pkg.spec->>'brief') AS brief
     FROM "_workflow_item" wi
     INNER JOIN "_workflow" w ON w.id = wi."workflowId" AND w."deletedAt" IS NULL
     LEFT JOIN "_package" pkg ON pkg.id = w."packageId" AND pkg."deletedAt" IS NULL
     WHERE wi.id = $1 AND wi."deletedAt" IS NULL`,
    [itemId]
  );
  return (pkgRows[0]?.brief || "").trim();
}

/** First name from Postgres person on this item — excludes warm-outreach placeholder row. */
export async function getWarmWorkflowPersonFirstName(itemId: string): Promise<string> {
  const rows = await query<{ tf: string | null; tl: string | null }>(
    `SELECT TRIM(COALESCE(p."nameFirstName",'')) AS tf, TRIM(COALESCE(p."nameLastName",'')) AS tl
     FROM "_workflow_item" wi
     INNER JOIN person p ON p.id = wi."sourceId" AND p."deletedAt" IS NULL
     WHERE wi.id = $1 AND wi."sourceType" = 'person' AND wi."deletedAt" IS NULL`,
    [itemId]
  );
  const tf = (rows[0]?.tf || "").trim();
  const tl = (rows[0]?.tl || "").trim();
  if (tf === "Next" && tl === "Contact") return "";
  return tf;
}

export async function getCrmPersonIdForWorkflowItem(itemId: string): Promise<string | null> {
  const rows = await query<{ sourceId: string; sourceType: string }>(
    `SELECT "sourceId", "sourceType" FROM "_workflow_item" WHERE id = $1 AND "deletedAt" IS NULL`,
    [itemId]
  );
  const st = (rows[0]?.sourceType || "").toLowerCase();
  const sid = (rows[0]?.sourceId || "").trim();
  if (st === "person" && sid) return sid;
  return null;
}

type WorkflowItemAugRow = {
  id: string;
  spec: unknown;
  workflowName: string;
  ownerAgent: string | null;
  packageId: string | null;
  package_spec: unknown;
  board_stages: unknown;
};

async function fetchWorkflowItemAugRow(itemId: string): Promise<WorkflowItemAugRow | null> {
  const rows = await query<WorkflowItemAugRow>(
    `SELECT wi.id, w.spec, w.name AS "workflowName", w."ownerAgent", w."packageId", pkg.spec AS package_spec, b.stages AS board_stages
     FROM "_workflow_item" wi
     INNER JOIN "_workflow" w ON w.id = wi."workflowId" AND w."deletedAt" IS NULL
     LEFT JOIN "_package" pkg ON pkg.id = w."packageId" AND pkg."deletedAt" IS NULL
     LEFT JOIN "_board" b ON b.id = w."boardId" AND b."deletedAt" IS NULL
     WHERE wi.id = $1 AND wi."deletedAt" IS NULL`,
    [itemId]
  );
  return rows[0] ?? null;
}

function looksLikeWarmMessagingWorkflow(
  typeId: string | null,
  workflowSpec: unknown,
  workflowName: string
): boolean {
  if (typeId === "warm-outreach" || typeId === "linkedin-outreach") return true;
  const s =
    typeof workflowSpec === "string"
      ? workflowSpec
      : workflowSpec != null
        ? JSON.stringify(workflowSpec)
        : "";
  const wn = (workflowName || "").trim();
  if (/warm[-_\s]?outreach/i.test(s)) return true;
  if (/\bwarm\s+outreach\b/i.test(wn)) return true;
  if (/linkedin[-_\s]?outreach/i.test(s)) return true;
  if (/\blinkedin\s+outreach\b/i.test(wn)) return true;
  return false;
}

export async function resolveTimWarmWorkflowTypeId(itemId: string): Promise<string | null> {
  const row = await fetchWorkflowItemAugRow(itemId);
  if (!row) return null;
  return resolveWorkflowRegistryForQueue(row.spec, {
    packageSpec: row.package_spec,
    ownerAgent: row.ownerAgent,
    boardStages: row.board_stages,
  });
}

/**
 * Vector memory + Knowledge Studio snippets (same strategy as REPLY_DRAFT autogen).
 */
export async function buildTimWarmKnowledgeContextText(opts: {
  crmPersonId: string | null;
  contactFirst: string;
  theirLatest: string;
  notes: string;
  packageBrief: string;
}): Promise<string> {
  const memoryQuery = [opts.contactFirst, opts.theirLatest, opts.notes, opts.packageBrief]
    .filter((s) => String(s).trim().length > 0)
    .join("\n")
    .slice(0, 2000);

  const kbParts: string[] = [];

  if (memoryQuery.trim().length >= 12) {
    try {
      const { searchMemories } = await import("@/lib/vector-memory");
      const mem = await searchMemories("tim", memoryQuery, { topK: 10 });
      if (mem.length > 0) {
        kbParts.push(
          "### Vector memory\n" + mem.map((m) => `- [${m.category}] ${m.content}`).join("\n")
        );
      }
    } catch (e) {
      console.warn("[tim-warm-groq-context] vector memory search skipped:", e);
    }

    try {
      const { searchAgentKnowledge, isMarniKbDatabaseConfigured } = await import("@/lib/marni-kb");
      if (isMarniKbDatabaseConfigured()) {
        let chunks = await searchAgentKnowledge("tim", memoryQuery, {
          topK: 8,
          personId: opts.crmPersonId,
        });
        if (chunks.length === 0 && opts.crmPersonId) {
          chunks = await searchAgentKnowledge("tim", memoryQuery, { topK: 6 });
        }
        if (chunks.length > 0) {
          kbParts.push(
            "### Knowledge Studio (CRM / LinkedIn sync)\n" +
              chunks.map((c) => c.content.trim().slice(0, 900)).join("\n\n---\n\n")
          );
        }
      }
    } catch (e) {
      console.warn("[tim-warm-groq-context] Knowledge Studio search skipped:", e);
    }
  }

  const joined = kbParts.join("\n\n");
  if (joined.length <= TIM_WARM_AUG_MAX_KB_JOINED) return joined;
  return `${joined.slice(0, TIM_WARM_AUG_MAX_KB_JOINED)}\n\n… [Tim knowledge truncated]`;
}

async function fetchWarmThreadRows(itemId: string): Promise<WarmThreadArtifactRow[]> {
  const rows = await query<{ stage: string; content: string; createdAt: string }>(
    `SELECT stage, content, "createdAt" FROM "_artifact"
     WHERE "workflowItemId" = $1 AND stage IN ('MESSAGE_DRAFT', 'REPLY_DRAFT', 'MESSAGED', 'REPLY_SENT', 'REPLIED') AND "deletedAt" IS NULL
     ORDER BY "createdAt" ASC`,
    [itemId]
  );
  return rows.map((r) => ({ stage: r.stage, content: r.content, createdAt: r.createdAt }));
}

/**
 * Confirms item exists (any workflow). Used before loading CRM context for chat.
 */
export async function workflowItemExists(itemId: string): Promise<boolean> {
  const rows = await query<{ c: string }>(
    `SELECT 1 AS c FROM "_workflow_item" WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1`,
    [itemId]
  );
  return rows.length > 0;
}

/**
 * Markdown block appended to Tim ephemeral context: package, notes, enrichment, server thread, KB.
 * Returns null if item missing or workflow does not look like warm / LinkedIn outreach messaging.
 */
export async function buildTimWarmGroqAugmentationText(itemId: string): Promise<string | null> {
  const augRow = await fetchWorkflowItemAugRow(itemId);
  if (!augRow) return null;
  const typeId = resolveWorkflowRegistryForQueue(augRow.spec, {
    packageSpec: augRow.package_spec,
    ownerAgent: augRow.ownerAgent,
    boardStages: augRow.board_stages,
  });
  if (!looksLikeWarmMessagingWorkflow(typeId, augRow.spec, augRow.workflowName)) return null;

  const [notes, packageBrief, contactFirst, crmPersonId, enrichmentQueryRows, threadRows] =
    await Promise.all([
      getWarmContactNotes(itemId),
      getWarmPackageBriefForItem(itemId),
      getWarmWorkflowPersonFirstName(itemId),
      getCrmPersonIdForWorkflowItem(itemId),
      query<{ content: string }>(
        `SELECT content FROM "_artifact" WHERE "workflowItemId" = $1 AND stage = 'RESEARCHING' AND "deletedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1`,
        [itemId]
      ),
      fetchWarmThreadRows(itemId),
    ]);

  const enrichment = enrichmentQueryRows[0]?.content?.trim() || "";
  const theirLatest = extractLastWarmInboundFromArtifactRows(threadRows);

  const timKnowledgeContext = await buildTimWarmKnowledgeContextText({
    crmPersonId,
    contactFirst,
    theirLatest,
    notes,
    packageBrief,
  });

  let threadBlock = buildStructuredWarmThreadTranscriptForLlm(threadRows).trim();
  if (threadBlock.length > TIM_WARM_AUG_MAX_THREAD) {
    threadBlock =
      threadBlock.slice(0, TIM_WARM_AUG_MAX_THREAD) + "\n\n[LinkedIn thread truncated for Groq context]";
  }

  const sections: string[] = [];

  sections.push(
    "## SERVER WARM CONTEXT (CRM — authoritative for this workflow item)\n\n" +
      "Use this block together with **UI FOCUS** / collaboration rules above. " +
      "If **LinkedIn thread** appears only here (not duplicated above), rely on this transcript."
  );

  const pkgClip = packageBrief.trim().slice(0, TIM_WARM_AUG_MAX_PACKAGE);
  sections.push(
    `### Package outreach brief\n\n${pkgClip || "(none)"}` +
      (packageBrief.length > TIM_WARM_AUG_MAX_PACKAGE ? "\n\n… [truncated]" : "")
  );

  const notesClip = notes.trim().slice(0, TIM_WARM_AUG_MAX_NOTES);
  sections.push(
    `### Govind intake notes (AWAITING_CONTACT)\n\n${notesClip || "(none)"}` +
      (notes.length > TIM_WARM_AUG_MAX_NOTES ? "\n\n… [truncated]" : "")
  );

  const enrichClip = enrichment.slice(0, TIM_WARM_AUG_MAX_ENRICHMENT);
  sections.push(
    `### Enrichment report (RESEARCHING artifact excerpt)\n\n${enrichClip || "(none)"}` +
      (enrichment.length > TIM_WARM_AUG_MAX_ENRICHMENT ? "\n\n… [truncated]" : "")
  );

  sections.push(`### LinkedIn thread (CRM artifacts; chronological)\n\n${threadBlock}`);

  sections.push(
    `### Tim knowledge (vector memory + Knowledge Studio — supporting voice/angles only)\n\n${timKnowledgeContext.trim() || "(none retrieved)"}`
  );

  return sections.join("\n\n---\n\n");
}
