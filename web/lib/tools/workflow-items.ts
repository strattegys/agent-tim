import type { ToolModule } from "./types";

/** Workflow item / workflow row ids from the CRM. */
const ITEM_OR_WORKFLOW_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Board / artifact stage keys (MESSAGE_DRAFT, REPLIED, …) — not a second UUID. */
const ARTIFACT_OR_BOARD_STAGE_RE = /^[A-Z][A-Z0-9_]+$/;

/**
 * Groq sometimes emits workflow_items with arg1–arg3 but omits `command` (schema used to require it → 400).
 * Infer get vs update when arg2 is a stage key and arg2 is not a UUID (avoids add-person: two UUIDs).
 */
export function inferWorkflowItemsCommandFromArgs(
  args: Record<string, string | undefined>
): string {
  const explicit = (args.command ?? "").trim();
  if (explicit) return explicit;

  const a1 = (args.arg1 ?? "").trim();
  const a2 = (args.arg2 ?? "").trim();
  const a3 = (args.arg3 ?? "").trim();

  if (!ITEM_OR_WORKFLOW_UUID_RE.test(a1) || !a2) return "";
  if (ITEM_OR_WORKFLOW_UUID_RE.test(a2)) return "";
  if (!ARTIFACT_OR_BOARD_STAGE_RE.test(a2)) return "";
  if (a3.length > 0) return "update-workflow-artifact";
  return "get-workflow-artifact";
}

const tool: ToolModule = {
  metadata: {
    id: "workflow_items",
    displayName: "Workflow Items",
    category: "internal",
    description:
      "Add, move, and list workflow items; update CRM artifact markdown (drafts shown in the right panel). Cross-agent handoffs (e.g., Scout → Tim outreach).",
    operations: [
      "add-person-to-workflow",
      "add-content-to-workflow",
      "list-items",
      "move-item",
      "get-workflow-artifact",
      "update-workflow-artifact",
    ],
    requiresApproval: false,
  },

  declaration: {
    name: "workflow_items",
    description:
      "Manage workflow items and artifact bodies. " +
      "add-person-to-workflow: arg1=workflowId, arg2=personId, arg3=stage optional (else first board stage). " +
      "add-content-to-workflow: arg1=workflowId, arg2=title, arg3=description, arg4=contentType (article|post|email), arg5=stage optional. " +
      "list-items: arg1=workflowId, arg2=stage filter optional. " +
      "move-item: arg1=workflow item id, arg2=newStage (board key, typically UPPERCASE). " +
      "get-workflow-artifact: arg1=workflow item id, arg2=artifact stage (UPPERCASE) — returns current markdown so you can edit it before saving. " +
      "update-workflow-artifact: arg1=workflow item id, arg2=stage (UPPERCASE), arg3=full markdown (some models use key `artifact` for the body — same as arg3). **Tim warm MESSAGE_DRAFT / REPLY_DRAFT:** Always **get-workflow-artifact** first. If Govind wants only the LinkedIn body changed, arg3 may be **plain text** — the server merges it into the existing prefix (## Conversation / enrichment) and Tim footer (`---`) so the work panel layout stays intact. If arg3 is already full valid markdown with `---` before the Tim footer, it is stored as-is. " +
      "**Ghost / content pipeline (CAMPAIGN_SPEC, REVIEW, DRAFT_PUBLISHED, DRAFTING, IDEA artifacts):** arg3 must be the **full document after your edits** — first call **get-workflow-artifact**, merge Govind’s change requests into that text, and never replace the whole spec with only his short chat line unless he explicitly asks to scrap and rewrite everything.",
    parameters: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description:
            "Command: add-person-to-workflow, add-content-to-workflow, list-items, move-item, get-workflow-artifact, update-workflow-artifact. Prefer always setting this. If omitted: arg1=item UUID + arg2=UPPERCASE_STAGE + arg3=body → update-workflow-artifact; same with no arg3 → get-workflow-artifact (not for add-person — two UUIDs need an explicit command).",
        },
        arg1: {
          type: "string",
          description:
            "workflowId for add-person, add-content, list-items; workflow item id for move-item, get-workflow-artifact, and update-workflow-artifact",
        },
        arg2: {
          type: "string",
          description:
            "personId (add-person), title (add-content), stage filter (list-items), newStage (move-item), or artifact stage (get-workflow-artifact / update-workflow-artifact, UPPERCASE)",
        },
        arg3: {
          type: "string",
          description:
            "optional initial stage (add-person), description/body (add-content), or full markdown (update-workflow-artifact — required; not used for get-workflow-artifact)",
        },
        arg4: {
          type: "string",
          description: "Fourth arg: contentType for add-content (article|post|email)",
        },
        arg5: {
          type: "string",
          description: "Fifth arg: stage for add-content",
        },
      },
      required: [],
    },
  },

  async execute(args) {
    const { query: dbQuery } = await import("../db");
    const cmd = inferWorkflowItemsCommandFromArgs(args);
    if (!cmd)
      return "Error: workflow_items needs a command (e.g. update-workflow-artifact) or arg1=item id + arg2=STAGE (+ arg3 for updates).";

    // ─── add-person-to-workflow ──────────────────────────────────
    if (cmd === "add-person-to-workflow") {
      if (!args.arg1) return "Error: arg1 (workflowId) is required";
      if (!args.arg2) return "Error: arg2 (personId) is required";

      // Look up the workflow to get its board stages
      const wfRows = await dbQuery(
        `SELECT w."itemType", b.stages
         FROM "_workflow" w
         LEFT JOIN "_board" b ON b.id = w."boardId" AND b."deletedAt" IS NULL
         WHERE w.id = $1 AND w."deletedAt" IS NULL`,
        [args.arg1]
      );
      if (wfRows.length === 0) return "Error: workflow not found";
      const wf = wfRows[0] as Record<string, unknown>;
      if (wf.itemType !== "person")
        return "Error: this workflow tracks content, not people. Use add-content-to-workflow.";

      // Determine stage — use provided or first board stage
      let stage = args.arg3;
      if (!stage) {
        const stages = wf.stages as Array<{ key: string }> | null;
        stage = stages?.[0]?.key || "TARGET";
      }

      // Check for duplicate
      const existing = await dbQuery(
        `SELECT id FROM "_workflow_item"
         WHERE "workflowId" = $1 AND "sourceId" = $2 AND "deletedAt" IS NULL`,
        [args.arg1, args.arg2]
      );
      if (existing.length > 0)
        return `Person is already in this workflow (item id: ${(existing[0] as Record<string, unknown>).id})`;

      // Get next position
      const posRows = await dbQuery(
        `SELECT COALESCE(MAX(position), -1) + 1 AS next_pos
         FROM "_workflow_item"
         WHERE "workflowId" = $1 AND stage = $2 AND "deletedAt" IS NULL`,
        [args.arg1, stage]
      );
      const nextPos = (posRows[0] as Record<string, unknown>).next_pos ?? 0;

      const inserted = await dbQuery(
        `INSERT INTO "_workflow_item" ("workflowId", "sourceType", "sourceId", stage, position, "createdAt", "updatedAt")
         VALUES ($1, 'person', $2, $3, $4, NOW(), NOW()) RETURNING id`,
        [args.arg1, args.arg2, stage, nextPos]
      );
      const itemId = (inserted[0] as Record<string, unknown>).id;
      const { syncHumanTaskOpenForItem } = await import("@/lib/workflow-item-human-task");
      await syncHumanTaskOpenForItem(String(itemId));

      // Get person name for confirmation
      const personRows = await dbQuery(
        `SELECT "name" -> 'firstName' ->> 'value' AS first,
                "name" -> 'lastName' ->> 'value' AS last
         FROM person WHERE id = $1`,
        [args.arg2]
      );
      const name =
        personRows.length > 0
          ? `${(personRows[0] as Record<string, unknown>).first || ""} ${(personRows[0] as Record<string, unknown>).last || ""}`.trim()
          : args.arg2;

      return `Added ${name} to workflow at stage ${stage} (item id: ${itemId})`;
    }

    // ─── add-content-to-workflow ──────────────────────────────────
    if (cmd === "add-content-to-workflow") {
      if (!args.arg1) return "Error: arg1 (workflowId) is required";
      if (!args.arg2) return "Error: arg2 (title) is required";

      const wfRows = await dbQuery(
        `SELECT w."itemType", b.stages
         FROM "_workflow" w
         LEFT JOIN "_board" b ON b.id = w."boardId" AND b."deletedAt" IS NULL
         WHERE w.id = $1 AND w."deletedAt" IS NULL`,
        [args.arg1]
      );
      if (wfRows.length === 0) return "Error: workflow not found";
      const wf = wfRows[0] as Record<string, unknown>;
      if (wf.itemType !== "content")
        return "Error: this workflow tracks people, not content. Use add-person-to-workflow.";

      const title = args.arg2;
      const description = args.arg3 || "";
      const contentType = args.arg4 || "article";

      // Determine stage
      let stage = args.arg5;
      if (!stage) {
        const stages = wf.stages as Array<{ key: string }> | null;
        stage = stages?.[0]?.key || "IDEA";
      }

      // Create the content item
      const contentRows = await dbQuery(
        `INSERT INTO "_content_item" (title, description, "contentType", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, NOW(), NOW()) RETURNING id`,
        [title, description, contentType]
      );
      const contentId = (contentRows[0] as Record<string, unknown>).id;

      // Get next position
      const posRows = await dbQuery(
        `SELECT COALESCE(MAX(position), -1) + 1 AS next_pos
         FROM "_workflow_item"
         WHERE "workflowId" = $1 AND stage = $2 AND "deletedAt" IS NULL`,
        [args.arg1, stage]
      );
      const nextPos = (posRows[0] as Record<string, unknown>).next_pos ?? 0;

      // Add to workflow
      const inserted = await dbQuery(
        `INSERT INTO "_workflow_item" ("workflowId", "sourceType", "sourceId", stage, position, "createdAt", "updatedAt")
         VALUES ($1, 'content', $2, $3, $4, NOW(), NOW()) RETURNING id`,
        [args.arg1, contentId, stage, nextPos]
      );
      const itemId = (inserted[0] as Record<string, unknown>).id;
      const { syncHumanTaskOpenForItem } = await import("@/lib/workflow-item-human-task");
      await syncHumanTaskOpenForItem(String(itemId));

      return `Created content "${title}" and added to workflow at stage ${stage} (content id: ${contentId}, item id: ${itemId})`;
    }

    // ─── list-items ──────────────────────────────────────────────
    if (cmd === "list-items") {
      if (!args.arg1) return "Error: arg1 (workflowId) is required";

      // Get workflow info
      const wfRows = await dbQuery(
        `SELECT "itemType" FROM "_workflow" WHERE id = $1 AND "deletedAt" IS NULL`,
        [args.arg1]
      );
      if (wfRows.length === 0) return "Error: workflow not found";
      const itemType = (wfRows[0] as Record<string, unknown>).itemType;

      const params: unknown[] = [args.arg1];
      let stageFilter = "";
      if (args.arg2) {
        params.push(args.arg2);
        stageFilter = ` AND wi.stage = $${params.length}`;
      }

      if (itemType === "person") {
        const rows = await dbQuery(
          `SELECT wi.id, wi.stage, wi.position,
                  p."name" -> 'firstName' ->> 'value' AS first,
                  p."name" -> 'lastName' ->> 'value' AS last,
                  p."jobTitle" AS job_title,
                  p."linkedinUrl" ->> 'value' AS linkedin
           FROM "_workflow_item" wi
           LEFT JOIN person p ON p.id = wi."sourceId"
           WHERE wi."workflowId" = $1 AND wi."deletedAt" IS NULL${stageFilter}
           ORDER BY wi.stage, wi.position ASC
           LIMIT 100`,
          params
        );
        if (rows.length === 0) return "No items in this workflow" + (args.arg2 ? ` at stage ${args.arg2}` : "") + ".";
        return rows
          .map(
            (r: Record<string, unknown>) =>
              `- [${r.stage}] ${r.first || ""} ${r.last || ""} — ${r.job_title || "no title"}${r.linkedin ? ` (${r.linkedin})` : ""} (id: ${r.id}, personId: ${r.first ? (r as Record<string, unknown>).id : "?"})`
          )
          .join("\n");
      } else {
        const rows = await dbQuery(
          `SELECT wi.id, wi.stage, wi.position,
                  ci.title, ci."contentType", ci.url
           FROM "_workflow_item" wi
           LEFT JOIN "_content_item" ci ON ci.id = wi."sourceId"
           WHERE wi."workflowId" = $1 AND wi."deletedAt" IS NULL${stageFilter}
           ORDER BY wi.stage, wi.position ASC
           LIMIT 100`,
          params
        );
        if (rows.length === 0) return "No items in this workflow" + (args.arg2 ? ` at stage ${args.arg2}` : "") + ".";
        return rows
          .map(
            (r: Record<string, unknown>) =>
              `- [${r.stage}] "${r.title || "untitled"}" (${r.contentType || "unknown"})${r.url ? ` — ${r.url}` : ""} (id: ${r.id})`
          )
          .join("\n");
      }
    }

    // ─── move-item ───────────────────────────────────────────────
    if (cmd === "move-item") {
      if (!args.arg1) return "Error: arg1 (itemId) is required";
      if (!args.arg2) return "Error: arg2 (newStage) is required";

      const newStage = args.arg2.toUpperCase();

      // Get next position in the target stage
      const itemRows = await dbQuery(
        `SELECT "workflowId" FROM "_workflow_item" WHERE id = $1 AND "deletedAt" IS NULL`,
        [args.arg1]
      );
      if (itemRows.length === 0) return "Error: item not found";
      const workflowId = (itemRows[0] as Record<string, unknown>).workflowId;

      const posRows = await dbQuery(
        `SELECT COALESCE(MAX(position), -1) + 1 AS next_pos
         FROM "_workflow_item"
         WHERE "workflowId" = $1 AND stage = $2 AND "deletedAt" IS NULL`,
        [workflowId, newStage]
      );
      const nextPos = (posRows[0] as Record<string, unknown>).next_pos ?? 0;

      await dbQuery(
        `UPDATE "_workflow_item" SET stage = $1, position = $2, "updatedAt" = NOW()
         WHERE id = $3 AND "deletedAt" IS NULL`,
        [newStage, nextPos, args.arg1]
      );

      const { syncHumanTaskOpenForItem } = await import("@/lib/workflow-item-human-task");
      await syncHumanTaskOpenForItem(String(args.arg1));

      return `Item ${args.arg1} moved to stage ${newStage}`;
    }

    // ─── get-workflow-artifact ───────────────────────────────────
    if (cmd === "get-workflow-artifact") {
      const ax = args as Record<string, string>;
      const itemId = (args.arg1 ?? ax.item_id ?? ax.workflowItemId ?? ax.workflow_item_id)?.trim();
      const stageRaw = (args.arg2 ?? ax.stage)?.trim();
      if (!itemId) return "Error: arg1 (workflowItemId) is required";
      if (!stageRaw) return "Error: arg2 (stage, e.g. CAMPAIGN_SPEC) is required";

      const stageNorm = stageRaw.toUpperCase();
      const rows = await dbQuery(
        `SELECT content, stage, name, "createdAt"::text AS ca
         FROM "_artifact"
         WHERE "workflowItemId"::text = $1 AND UPPER(TRIM(stage)) = $2 AND "deletedAt" IS NULL
         ORDER BY "createdAt" DESC
         LIMIT 1`,
        [itemId, stageNorm]
      );
      if (rows.length === 0) {
        return `No artifact for workflow item ${itemId.slice(0, 8)}… at stage ${stageNorm}.`;
      }
      const r = rows[0] as Record<string, unknown>;
      const body = String(r.content ?? "");
      const header = `Stage ${r.stage} (${r.name}) — ${r.ca}\n\n---\n\n`;
      const max = 120_000;
      if (body.length > max) {
        return `${header}${body.slice(0, max)}\n\n… [truncated ${body.length - max} chars; ask to narrow or edit in sections]`;
      }
      return `${header}${body}`;
    }

    // ─── update-workflow-artifact ────────────────────────────────
    if (cmd === "update-workflow-artifact") {
      const ax = args as Record<string, string>;
      const itemId = (args.arg1 ?? ax.item_id ?? ax.workflowItemId ?? ax.workflow_item_id)?.trim();
      const stageRaw = (args.arg2 ?? ax.stage)?.trim();
      const newBody =
        args.arg3 ??
        ax.artifact ??
        ax.content ??
        ax.markdown ??
        ax.body ??
        ax.text ??
        ax.new_content;
      if (!itemId) return "Error: arg1 (workflowItemId) is required";
      if (!stageRaw) return "Error: arg2 (stage, e.g. MESSAGE_DRAFT) is required";
      if (newBody === undefined || newBody === "")
        return "Error: arg3 (new markdown content) is required";

      const stageNorm = stageRaw.toUpperCase();
      let contentToSave = String(newBody);
      if (stageNorm === "MESSAGE_DRAFT" || stageNorm === "REPLY_DRAFT") {
        const prevRows = await dbQuery(
          `SELECT content FROM "_artifact"
           WHERE "workflowItemId"::text = $1 AND UPPER(TRIM(stage)) = $2 AND "deletedAt" IS NULL
           ORDER BY "createdAt" DESC
           LIMIT 1`,
          [itemId, stageNorm]
        );
        const prev = String((prevRows[0] as Record<string, unknown> | undefined)?.content ?? "");
        if (prev) {
          const { coerceWarmLinkedInDraftUpdate } = await import("@/lib/warm-outreach-draft");
          const coerced = coerceWarmLinkedInDraftUpdate(prev, contentToSave);
          if (coerced !== null) contentToSave = coerced;
        }
      }

      const updated = await dbQuery(
        `UPDATE "_artifact" AS a SET content = $1, "updatedAt" = NOW()
         FROM (
           SELECT id FROM "_artifact"
           WHERE "workflowItemId"::text = $2 AND UPPER(TRIM(stage)) = $3 AND "deletedAt" IS NULL
           ORDER BY "createdAt" DESC
           LIMIT 1
         ) AS sub
         WHERE a.id = sub.id
         RETURNING a.id`,
        [contentToSave, itemId, stageNorm]
      );
      if (updated.length === 0) {
        return `No artifact found for workflow item ${itemId.slice(0, 8)}… at stage ${stageNorm} (create one first or check stage spelling).`;
      }
      const { maybeNotifyTimAfterLinkedInDraftEdit } = await import("../tim-linkedin-send-chat-gate");
      void maybeNotifyTimAfterLinkedInDraftEdit({
        workflowItemId: itemId,
        stage: stageNorm,
        markdownContent: contentToSave,
      }).catch(() => {});
      return `Updated artifact ${(updated[0] as Record<string, unknown>).id} (${stageNorm}) for workflow item ${args.arg1.slice(0, 8)}…`;
    }

    return "Unknown workflow_items command. Use: add-person-to-workflow, add-content-to-workflow, list-items, move-item, get-workflow-artifact, update-workflow-artifact";
  },
};

export default tool;
