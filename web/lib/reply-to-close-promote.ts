/**
 * When a **reply-to-close** row lands on **REPLIED**, immediately move to **REPLY_DRAFT**
 * and seed a draft artifact + Tim chat notify (same send gate as warm outreach).
 */
import { query } from "@/lib/db";
import { notifyTimLinkedInDraftPendingSend } from "@/lib/tim-linkedin-send-chat-gate";
import { loadCustomWorkflowTypeMap, resolveWorkflowRegistryForQueueWithCustomMap } from "@/lib/workflow-registry";
import { syncHumanTaskOpenForItem } from "@/lib/workflow-item-human-task";

const REPLY_DRAFT_TEMPLATE = {
  name: "Reply draft",
  content: `## Conversation & relationship

- They replied during **LinkedIn Opener Sequence** (or another path). Read their latest LinkedIn message in-thread.
- Match how Govind knows this person (CRM notes, enrichment).

## Suggested reply angle

Acknowledge what they said; keep it brief and human; move toward a clear next step only if they opened the door.

# Reply — Ready for Review

Thanks for getting back — [draft body matching their energy, continuing naturally].

— Govind

---

*Tim — **Reply to Close** — approve to send via LinkedIn DM, reject to redraft, or advance to Converted / Keep in touch when the thread is done.*`,
};

export async function promoteReplyToCloseFromReplied(
  itemId: string,
  opts?: { skipNotify?: boolean }
): Promise<void> {
  const rows = await query<{
    stage: string;
    workflowId: string;
    spec: unknown;
    workflowName: string;
    ownerAgent: string | null;
    board_stages: unknown;
    package_spec: unknown;
  }>(
    `SELECT wi.stage, wi."workflowId" AS "workflowId", w.spec,
            w.name AS "workflowName", w."ownerAgent",
            b.stages AS board_stages, p.spec AS package_spec
     FROM "_workflow_item" wi
     INNER JOIN "_workflow" w ON w.id = wi."workflowId" AND w."deletedAt" IS NULL
     LEFT JOIN "_board" b ON b.id = w."boardId" AND b."deletedAt" IS NULL
     LEFT JOIN "_package" p ON p.id = w."packageId" AND p."deletedAt" IS NULL
     WHERE wi.id = $1 AND wi."deletedAt" IS NULL`,
    [itemId]
  );
  const r = rows[0];
  if (!r) return;

  const customMap = await loadCustomWorkflowTypeMap();
  const wfTypeId =
    resolveWorkflowRegistryForQueueWithCustomMap(
      r.spec,
      { packageSpec: r.package_spec, ownerAgent: r.ownerAgent, boardStages: r.board_stages },
      customMap
    ) ?? "";

  if (wfTypeId !== "reply-to-close") return;
  if ((r.stage || "").trim().toUpperCase() !== "REPLIED") return;

  await query(
    `UPDATE "_workflow_item" SET stage = 'REPLY_DRAFT', "updatedAt" = NOW() WHERE id = $1 AND "deletedAt" IS NULL`,
    [itemId]
  );

  await query(
    `INSERT INTO "_artifact" ("workflowItemId", "workflowId", stage, name, type, content, "createdAt", "updatedAt")
     VALUES ($1, $2, 'REPLY_DRAFT', $3, 'markdown', $4, NOW(), NOW())`,
    [itemId, r.workflowId, REPLY_DRAFT_TEMPLATE.name, REPLY_DRAFT_TEMPLATE.content]
  );

  if (!opts?.skipNotify) {
    void notifyTimLinkedInDraftPendingSend({
      itemId,
      workflowName: r.workflowName || "Reply to Close",
      stage: "REPLY_DRAFT",
      markdownContent: REPLY_DRAFT_TEMPLATE.content,
    }).catch((e) => console.error("[promoteReplyToCloseFromReplied] notify", e));
  }

  await syncHumanTaskOpenForItem(itemId);
}
