/**
 * Warm-outreach LinkedIn sends require: (1) Tim posts exact plain-text draft to Govind's Tim chat,
 * (2) Govind replies "Send It Now", (3) Govind clicks Submit.
 * If gate columns exist on `_workflow_item`, sends are blocked until `linkedinSendChatNotifiedAt` is set
 * (draft saved → notify). Deployments without those columns still skip the gate (query fails softly).
 */
import { createHash } from "crypto";
import { getAgentConfig } from "@/lib/agent-config";
import { addMessage } from "@/lib/session-store";
import { query } from "@/lib/db";
import { extractPlainDmFromDraftMarkdown } from "@/lib/warm-outreach-draft";
import { resolveWorkflowRegistryForQueue } from "@/lib/workflow-spec";

function gateDisabledEnv(): boolean {
  return process.env.LINKEDIN_SEND_CHAT_GATE?.trim() === "0";
}

export function normalizePlainForSendGate(plain: string): string {
  return plain.replace(/\s+/g, " ").trim();
}

export function hashPlainForSendGate(plain: string): string {
  return createHash("sha256").update(normalizePlainForSendGate(plain), "utf8").digest("hex");
}

function isMissingGateColumn(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return (
    m.includes("linkedinSendChat") && (m.includes("does not exist") || m.includes("column"))
  );
}

type GateRow = {
  linkedinSendChatPlainHash: string | null;
  linkedinSendChatNotifiedAt: Date | string | null;
  linkedinSendChatApprovedAt: Date | string | null;
};

async function fetchGateRow(itemId: string): Promise<GateRow | null> {
  try {
    const rows = await query<GateRow>(
      `SELECT "linkedinSendChatPlainHash", "linkedinSendChatNotifiedAt", "linkedinSendChatApprovedAt"
       FROM "_workflow_item" WHERE id = $1 AND "deletedAt" IS NULL`,
      [itemId]
    );
    return rows[0] ?? null;
  } catch (e) {
    if (isMissingGateColumn(e)) return null;
    throw e;
  }
}

async function updateGate(
  itemId: string,
  fields: {
    hash: string | null;
    notifiedAt: Date | null;
    approvedAt: Date | null;
  }
): Promise<boolean> {
  try {
    await query(
      `UPDATE "_workflow_item" SET
         "linkedinSendChatPlainHash" = $1,
         "linkedinSendChatNotifiedAt" = $2,
         "linkedinSendChatApprovedAt" = $3,
         "updatedAt" = NOW()
       WHERE id = $4 AND "deletedAt" IS NULL`,
      [fields.hash, fields.notifiedAt, fields.approvedAt, itemId]
    );
    return true;
  } catch (e) {
    if (isMissingGateColumn(e)) return false;
    throw e;
  }
}

/** After a new/edited MESSAGE_DRAFT or REPLY_DRAFT markdown — posts to Tim chat and resets approval. */
export async function notifyTimLinkedInDraftPendingSend(args: {
  itemId: string;
  workflowName: string;
  stage: "MESSAGE_DRAFT" | "REPLY_DRAFT";
  markdownContent: string;
}): Promise<void> {
  if (gateDisabledEnv()) return;

  const plain = extractPlainDmFromDraftMarkdown(args.markdownContent);
  if (!normalizePlainForSendGate(plain)) {
    console.warn("[tim-linkedin-send-chat-gate] skip notify — empty plain body", args.itemId.slice(0, 8));
    return;
  }

  const hash = hashPlainForSendGate(plain);
  const ok = await updateGate(args.itemId, {
    hash,
    notifiedAt: new Date(),
    approvedAt: null,
  });
  if (!ok) return;

  const stageLabel = args.stage === "MESSAGE_DRAFT" ? "Message draft" : "Reply draft";
  const text = [
    `**LinkedIn — draft ready (needs your go-ahead)**`,
    ``,
    `Workflow: **${args.workflowName}**`,
    `Step: **${stageLabel}** (\`${args.stage}\`)`,
    `Workflow item id: \`${args.itemId}\``,
    ``,
    `**Exact message to send** (plain text):`,
    ``,
    "```",
    plain,
    "```",
    ``,
    `Reply in this chat with **Send It Now** when this matches the draft tab. Then click **Submit** in the work panel to send via LinkedIn.`,
    ``,
    `_If you edit the draft in the panel, I will post an updated copy here when you save._`,
  ].join("\n");

  try {
    const { sessionFile } = getAgentConfig("tim");
    addMessage(sessionFile, { role: "model", text, timestamp: Date.now() });
  } catch (e) {
    console.error("[tim-linkedin-send-chat-gate] addMessage failed:", e);
  }
}

export async function assertLinkedInSendChatGateAllowsSend(
  itemId: string,
  currentDraftPlain: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (gateDisabledEnv()) return { ok: true };

  const row = await fetchGateRow(itemId);
  if (!row) return { ok: true };

  const notified = row.linkedinSendChatNotifiedAt;
  if (notified == null) {
    return {
      ok: false,
      error:
        "Save the LinkedIn draft in the work panel once so Tim can post the exact text in chat, then reply **Send It Now** in Tim chat and click Submit.",
    };
  }

  const approved = row.linkedinSendChatApprovedAt;
  if (approved == null) {
    return {
      ok: false,
      error:
        'Reply **Send It Now** in Tim chat first (after the draft I posted there), then click Submit again.',
    };
  }

  const notifiedMs = new Date(notified as string).getTime();
  const approvedMs = new Date(approved as string).getTime();
  if (approvedMs < notifiedMs) {
    return {
      ok: false,
      error:
        "Your **Send It Now** was before the latest draft notice — reply **Send It Now** again after the newest draft message in chat.",
    };
  }

  const expectedHash = (row.linkedinSendChatPlainHash || "").trim();
  const actualHash = hashPlainForSendGate(currentDraftPlain);
  if (expectedHash && actualHash !== expectedHash) {
    return {
      ok: false,
      error:
        "The draft in the panel no longer matches the version in chat. Save the draft tab so I can post the update, then reply **Send It Now** again.",
    };
  }

  return { ok: true };
}

export async function markLinkedInSendChatApproved(itemId: string): Promise<{ ok: boolean; error?: string }> {
  if (gateDisabledEnv()) return { ok: true };

  try {
    const rows = await query<{ id: string }>(
      `UPDATE "_workflow_item" SET "linkedinSendChatApprovedAt" = NOW(), "updatedAt" = NOW()
       WHERE id = $1 AND "deletedAt" IS NULL AND "linkedinSendChatNotifiedAt" IS NOT NULL
       RETURNING id`,
      [itemId]
    );
    if (rows.length === 0) {
      const row = await fetchGateRow(itemId);
      if (!row) return { ok: true };
      if (row.linkedinSendChatNotifiedAt == null) {
        return {
          ok: false,
          error:
            "No pending LinkedIn draft for this item in chat — select the task in Tim’s work queue so context includes the workflow item id, or open the message draft and save once.",
        };
      }
      return { ok: false, error: "Could not record approval — try again." };
    }
    return { ok: true };
  } catch (e) {
    if (isMissingGateColumn(e)) return { ok: true };
    throw e;
  }
}

export async function clearLinkedInSendChatGate(itemId: string): Promise<void> {
  await updateGate(itemId, { hash: null, notifiedAt: null, approvedAt: null });
}

/** Parse `Workflow item id: <uuid>` from Tim work-queue context. */
export function extractWorkflowItemIdFromTimContext(workQueueContext: string): string | null {
  const m = workQueueContext.match(/Workflow item id:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m ? m[1] : null;
}

export function userMessageIsSendItNow(message: string): boolean {
  return /^\s*send\s+it\s+now\s*\.?\s*$/i.test(message.trim());
}

/** After UI or tool updates MESSAGE_DRAFT / REPLY_DRAFT markdown — re-post exact body to Tim chat if warm-outreach. */
export async function maybeNotifyTimAfterLinkedInDraftEdit(args: {
  workflowItemId: string;
  stage: string;
  markdownContent: string;
}): Promise<void> {
  const st = args.stage.trim().toUpperCase();
  if (st !== "MESSAGE_DRAFT" && st !== "REPLY_DRAFT") return;

  const rows = await query<{
    spec: unknown;
    name: string;
    ownerAgent: string | null;
    board_stages: unknown;
    package_spec: unknown;
  }>(
    `SELECT w.spec, w.name AS "workflowName", w."ownerAgent",
            b.stages AS board_stages, p.spec AS package_spec
     FROM "_workflow_item" wi
     INNER JOIN "_workflow" w ON w.id = wi."workflowId" AND w."deletedAt" IS NULL
     LEFT JOIN "_board" b ON b.id = w."boardId" AND b."deletedAt" IS NULL
     LEFT JOIN "_package" p ON p.id = w."packageId" AND p."deletedAt" IS NULL
     WHERE wi.id = $1 AND wi."deletedAt" IS NULL`,
    [args.workflowItemId]
  );
  const r = rows[0];
  if (!r) return;

  const wfTypeId =
    resolveWorkflowRegistryForQueue(r.spec, {
      packageSpec: r.package_spec,
      ownerAgent: r.ownerAgent,
      boardStages: r.board_stages,
    }) ?? "";
  if (wfTypeId !== "warm-outreach") return;

  await notifyTimLinkedInDraftPendingSend({
    itemId: args.workflowItemId,
    workflowName: r.name || "Workflow",
    stage: st as "MESSAGE_DRAFT" | "REPLY_DRAFT",
    markdownContent: args.markdownContent,
  });
}
