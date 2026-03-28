/**
 * Persisted queue flag on _workflow_item: true when the item’s stage requires a human
 * (from the workflow board’s stages[].requiresHuman). Tim’s work queue selects
 * humanTaskOpen = true + ownerAgent instead of re-deriving type from spec alone.
 *
 * When the DB board row is missing, empty, or omits requiresHuman for a stage, we also
 * consult WORKFLOW_TYPES so Reply Draft / LinkedIn inbox rows don’t stay humanTaskOpen=false.
 */

import { query } from "@/lib/db";
import { resolveWorkflowRegistryForQueue } from "@/lib/workflow-spec";
import { WORKFLOW_TYPES } from "@/lib/workflow-types";

export function humanTaskOpenFromBoardStages(boardStages: unknown, itemStage: string): boolean {
  const sk = (itemStage || "").trim().toUpperCase();
  if (!sk) return false;
  let arr: unknown = boardStages;
  if (typeof boardStages === "string") {
    try {
      arr = JSON.parse(boardStages) as unknown;
    } catch {
      return false;
    }
  }
  if (!Array.isArray(arr)) return false;
  for (const s of arr) {
    if (!s || typeof s !== "object" || Array.isArray(s)) continue;
    const key = String((s as { key?: string }).key || "").trim().toUpperCase();
    if (key !== sk) continue;
    return Boolean((s as { requiresHuman?: boolean }).requiresHuman);
  }
  return false;
}

/** Label + human-facing instruction from the board JSON for a stage key. */
export function boardHumanMetaForStage(
  boardStages: unknown,
  itemStage: string
): { label: string; humanAction: string } | null {
  const sk = (itemStage || "").trim().toUpperCase();
  if (!sk) return null;
  let arr: unknown = boardStages;
  if (typeof boardStages === "string") {
    try {
      arr = JSON.parse(boardStages) as unknown;
    } catch {
      return null;
    }
  }
  if (!Array.isArray(arr)) return null;
  for (const s of arr) {
    if (!s || typeof s !== "object" || Array.isArray(s)) continue;
    const key = String((s as { key?: string }).key || "").trim().toUpperCase();
    if (key !== sk) continue;
    const requiresHuman = Boolean((s as { requiresHuman?: boolean }).requiresHuman);
    if (!requiresHuman) return null;
    const label = String((s as { label?: string }).label || sk);
    const humanAction = String(
      (s as { humanAction?: string }).humanAction || "Complete this step in the work queue."
    );
    return { label, humanAction };
  }
  return null;
}

export async function syncHumanTaskOpenForItem(itemId: string): Promise<void> {
  const wi = await query<{ stage: string; workflowId: string }>(
    `SELECT stage, "workflowId" FROM "_workflow_item" WHERE id = $1 AND "deletedAt" IS NULL`,
    [itemId]
  );
  if (wi.length === 0) return;

  const wf = await query<{
    boardId: string | null;
    spec: unknown;
    packageId: string | null;
    ownerAgent: string | null;
  }>(
    `SELECT "boardId", spec, "packageId", "ownerAgent" FROM "_workflow" WHERE id = $1 AND "deletedAt" IS NULL`,
    [wi[0].workflowId]
  );
  const boardId = wf[0]?.boardId ?? null;
  let stages: unknown = null;
  if (boardId) {
    const b = await query<{ stages: unknown }>(
      `SELECT stages FROM "_board" WHERE id = $1 AND "deletedAt" IS NULL`,
      [boardId]
    );
    stages = b[0]?.stages ?? null;
  }

  let packageSpec: unknown;
  if (wf[0]?.packageId) {
    const pr = await query<{ spec: unknown }>(
      `SELECT spec FROM "_package" WHERE id = $1 AND "deletedAt" IS NULL`,
      [wf[0].packageId]
    );
    packageSpec = pr[0]?.spec;
  }

  const typeId =
    resolveWorkflowRegistryForQueue(wf[0]?.spec, {
      packageSpec,
      ownerAgent: wf[0]?.ownerAgent,
      boardStages: stages,
    }) ?? "";

  const fromDb = humanTaskOpenFromBoardStages(stages, wi[0].stage);
  const tmplStages =
    typeId && WORKFLOW_TYPES[typeId] ? WORKFLOW_TYPES[typeId].defaultBoard.stages : null;
  const fromTemplate = tmplStages
    ? humanTaskOpenFromBoardStages(tmplStages, wi[0].stage)
    : false;

  let open = fromDb || fromTemplate;
  const stageU = (wi[0].stage || "").trim().toUpperCase();
  if (typeId === "warm-outreach" && stageU === "MESSAGED") {
    open = false;
  }

  await query(
    `UPDATE "_workflow_item" SET "humanTaskOpen" = $1, "updatedAt" = NOW() WHERE id = $2 AND "deletedAt" IS NULL`,
    [open, itemId]
  );
}
