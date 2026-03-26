import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { WORKFLOW_TYPES } from "@/lib/workflow-types";
import Anthropic from "@anthropic-ai/sdk";
import { groqCompletion } from "@/lib/groq-completion";
import {
  isUnipileConfigured,
  extractLinkedInProfileIdentifier,
  fetchUnipileLinkedInProfile,
  formatUnipileProfileMarkdown,
} from "@/lib/unipile-profile";
import { sendWarmOutreachLinkedInDm } from "@/lib/unipile-send";
import { extractPlainDmFromDraftMarkdown } from "@/lib/warm-outreach-draft";
import { insertPackageBriefArtifactIfPresent, PACKAGE_BRIEF_STAGE } from "@/lib/package-brief-artifact";
import {
  scheduleNextWarmDiscoveryAfterIntake,
  spawnAfterWarmOutreachEnded,
} from "@/lib/warm-outreach-discovery";
import { syncHumanTaskOpenForItem } from "@/lib/workflow-item-human-task";
import { WARM_OUTREACH_MESSAGE_FOLLOW_UP_DAYS } from "@/lib/warm-outreach-cadence";
import { applyWarmContactIntakeToPerson } from "@/lib/warm-contact-intake-apply";
import { resolveWorkflowRegistryId } from "@/lib/workflow-spec";

function logTs(message: string): string {
  return `[${new Date().toISOString()}] ${message}`;
}

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

/**
 * POST /api/crm/human-tasks/resolve
 *
 * Resolves a human task: advances the workflow item to the next stage
 * and optionally stores an artifact with the human's input.
 *
 * Body: {
 *   itemId: string,        — workflow item ID
 *   action: "approve" | "reject" | "input" | "replied" | "ended" | "undo_replied",
 *   notes?: string,        — human's notes/feedback
 *   data?: Record<string, string>,  — structured data (e.g., { url: "..." })
 *   nextStage?: string,    — explicit next stage (if not provided, uses first valid transition)
 * }
 *
 * The endpoint:
 * 1. Looks up the workflow item and its current stage
 * 2. Determines the next stage based on action + transitions
 * 3. If action produces output, creates an artifact
 * 4. Advances the item to the next stage
 * 5. Checks for cross-workflow handoff triggers
 */
export async function POST(req: NextRequest) {
  try {
    const { itemId, action, notes, data, nextStage, confirmUndo } = await req.json();

    if (!itemId || !action) {
      return NextResponse.json(
        { error: "itemId and action are required" },
        { status: 400 }
      );
    }

    const allowedActions = ["approve", "reject", "input", "replied", "ended", "undo_replied"];
    if (!allowedActions.includes(action)) {
      return NextResponse.json(
        { error: `Invalid action. Use one of: ${allowedActions.join(", ")}` },
        { status: 400 }
      );
    }

    // 1. Look up the workflow item
    const items = await query<{
      id: string;
      workflowId: string;
      stage: string;
      sourceType: string;
      sourceId: string;
    }>(
      `SELECT id, "workflowId", stage, "sourceType", "sourceId"
       FROM "_workflow_item"
       WHERE id = $1 AND "deletedAt" IS NULL`,
      [itemId]
    );

    if (items.length === 0) {
      return NextResponse.json({ error: "Workflow item not found" }, { status: 404 });
    }

    const item = items[0];

    // Look up the workflow to find its type
    const workflows = await query<{
      id: string;
      name: string;
      ownerAgent: string;
      packageId: string | null;
      spec: { workflowType?: string };
    }>(
      `SELECT id, name, "ownerAgent", "packageId", spec
       FROM "_workflow"
       WHERE id = $1 AND "deletedAt" IS NULL`,
      [item.workflowId]
    );

    if (workflows.length === 0) {
      return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
    }

    const wf = workflows[0];
    const wfSpec = typeof wf.spec === "string" ? JSON.parse(wf.spec) : wf.spec;
    const wfTypeRaw =
      typeof wfSpec?.workflowType === "string" ? wfSpec.workflowType.trim() : "";
    const wfTypeId = resolveWorkflowRegistryId(wfTypeRaw || null) ?? "";
    const wfType = wfTypeId ? WORKFLOW_TYPES[wfTypeId] : null;

    // Check useFakeData flag from the package
    let useFakeData = true;
    if (wf.packageId) {
      const pkgRows = await query<{ spec: { useFakeData?: boolean } }>(
        `SELECT spec FROM "_package" WHERE id = $1 AND "deletedAt" IS NULL`,
        [wf.packageId]
      );
      if (pkgRows.length > 0) {
        const pkgSpec = typeof pkgRows[0].spec === "string" ? JSON.parse(pkgRows[0].spec) : pkgRows[0].spec;
        useFakeData = pkgSpec?.useFakeData !== false; // default true
        console.log(`[resolve] Package ${wf.packageId} useFakeData raw=${pkgSpec?.useFakeData} resolved=${useFakeData}`);
      }
    }

    /** Warm-outreach only: undo accidental Replied (back to MESSAGED + follow-up hold). */
    if (action === "undo_replied") {
      if (!confirmUndo) {
        return NextResponse.json(
          { error: "confirmUndo: true is required to undo mistaken Replied" },
          { status: 400 }
        );
      }
      if (wfTypeId !== "warm-outreach") {
        return NextResponse.json(
          { error: "undo_replied is only for warm-outreach workflows" },
          { status: 400 }
        );
      }
      const st = (item.stage || "").trim().toUpperCase();
      if (st !== "REPLY_DRAFT" && st !== "REPLIED") {
        return NextResponse.json(
          {
            error:
              "Undo is only available in Reply Draft or Replied (use after an accidental Replied click)",
          },
          { status: 400 }
        );
      }
      await query(
        `UPDATE "_artifact" SET "deletedAt" = NOW(), "updatedAt" = NOW()
         WHERE "workflowItemId" = $1 AND stage IN ('REPLIED', 'REPLY_DRAFT') AND "deletedAt" IS NULL`,
        [itemId]
      );
      const followUp = new Date();
      followUp.setDate(followUp.getDate() + WARM_OUTREACH_MESSAGE_FOLLOW_UP_DAYS);
      await query(
        `UPDATE "_workflow_item" SET stage = 'MESSAGED', "dueDate" = $1::timestamptz, "updatedAt" = NOW() WHERE id = $2 AND "deletedAt" IS NULL`,
        [followUp.toISOString(), itemId]
      );
      await syncHumanTaskOpenForItem(itemId);
      return NextResponse.json({
        ok: true,
        itemId,
        packageId: wf.packageId,
        previousStage: item.stage,
        newStage: "MESSAGED",
        action: "undo_replied",
        logs: [
          logTs(
            "Warm-outreach: undo mistaken Replied — removed REPLIED/REPLY_DRAFT artifacts, restored MESSAGED + follow-up due"
          ),
        ],
      });
    }

    // 2. Determine next stage
    let targetStage = nextStage;

    if (!targetStage && wfType) {
      const transitions = wfType.defaultBoard.transitions[item.stage] || [];

      if (action === "replied") {
        if (item.stage !== "MESSAGED" || wfTypeId !== "warm-outreach") {
          return NextResponse.json(
            { error: "Replied is only valid for warm-outreach items in Messaged stage" },
            { status: 400 }
          );
        }
        targetStage = transitions.includes("REPLIED") ? "REPLIED" : undefined;
        if (!targetStage) {
          return NextResponse.json({ error: "Invalid transition from Messaged" }, { status: 400 });
        }
      } else if (action === "ended") {
        if (item.stage !== "REPLY_DRAFT" || wfTypeId !== "warm-outreach") {
          return NextResponse.json(
            { error: "End Sequence is only valid for warm-outreach items in Reply Draft stage" },
            { status: 400 }
          );
        }
        targetStage = transitions.includes("ENDED") ? "ENDED" : undefined;
        if (!targetStage) {
          return NextResponse.json({ error: "Invalid transition from Reply Draft" }, { status: 400 });
        }
      } else if (action === "reject") {
        // For rejection, go back or to REJECTED if available
        targetStage = transitions.find((s) => s === "REJECTED") ||
          transitions.find((s) => s === "DRAFTING") || // content pipeline: back to drafting
          transitions[transitions.length - 1]; // last option
      } else if (action === "approve" || action === "input") {
        // approve or input → advance to first valid transition
        targetStage = transitions[0];

        // MESSAGE_DRAFT cap (Tim outreach only): 3rd approved draft → ENDED
        if (
          item.stage === "MESSAGE_DRAFT" &&
          (wfTypeId === "linkedin-outreach" || wfTypeId === "warm-outreach")
        ) {
          const msgArtifacts = await query<{ id: string }>(
            `SELECT id FROM "_artifact" WHERE "workflowItemId" = $1 AND stage = 'MESSAGE_DRAFT' AND "deletedAt" IS NULL`,
            [itemId]
          );
          const messageCount = msgArtifacts.length + 1; // +1 for current approval
          if (messageCount >= 3) {
            targetStage = "ENDED";
          }
        }
      }
    }

    if (!targetStage) {
      // Terminal human stage — soft-delete the item to mark as resolved
      await query(
        `UPDATE "_workflow_item" SET "deletedAt" = NOW(), "humanTaskOpen" = false WHERE id = $1`,
        [itemId]
      );

      // Still check for handoffs based on current stage
      const handoffs = await checkHandoffs(item, wf, item.stage);

      return NextResponse.json({
        ok: true,
        itemId,
        packageId: wf.packageId,
        previousStage: item.stage,
        newStage: item.stage,
        action,
        terminal: true,
        handoffs,
        logs: [logTs(`Terminal resolve (item removed): ${item.stage} action=${action}`)],
      });
    }

    // 3. Create artifact if there's human input
    if (notes || data) {
      let artifactContent = "";
      if (notes) artifactContent += notes;
      if (data) {
        if (artifactContent) artifactContent += "\n\n---\n\n";
        for (const [key, val] of Object.entries(data)) {
          artifactContent += `**${key}:** ${val}\n`;
        }
      }

      await query(
        `INSERT INTO "_artifact" ("workflowItemId", "workflowId", stage, name, type, content, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
        [
          itemId,
          item.workflowId,
          item.stage,
          `Human ${action}: ${item.stage}`,
          "markdown",
          artifactContent,
        ]
      );
    }

    // Activity log for the UI (Package Planner + task panel)
    const logs: string[] = [];

    const stageAtResolve = (item.stage || "").trim().toUpperCase();
    let applyWarmIntakeFromRequest =
      wfTypeId === "warm-outreach" &&
      action === "input" &&
      item.sourceType === "person" &&
      item.sourceId &&
      typeof notes === "string" &&
      notes.trim();

    if (applyWarmIntakeFromRequest && stageAtResolve !== "AWAITING_CONTACT") {
      const pr = await query<{ tf: string; tl: string }>(
        `SELECT TRIM(COALESCE("nameFirstName",'')) AS tf, TRIM(COALESCE("nameLastName",'')) AS tl
         FROM person WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1`,
        [item.sourceId]
      );
      const stillPlaceholder = pr[0]?.tf === "Next" && pr[0]?.tl === "Contact";
      if (!stillPlaceholder) applyWarmIntakeFromRequest = false;
    }

    if (applyWarmIntakeFromRequest) {
      await applyWarmContactIntakeToPerson(item.sourceId, notes.trim(), logs);
    }

    logs.push(
      logTs(
        `Resolve start: workflow="${wf.name}" type=${wfTypeId || "?"} item=${itemId.slice(0, 8)}… ${item.stage} → ${targetStage} action=${action}`
      )
    );

    const artifactOverrides: Partial<Record<string, { name: string; content: string }>> = {};
    if (wfTypeId === "warm-outreach" && action === "approve") {
      if (item.stage === "MESSAGE_DRAFT" && targetStage === "MESSAGED") {
        logs.push(logTs("LinkedIn: MESSAGE_DRAFT approved — attempting Unipile send before MESSAGED artifact"));
        artifactOverrides.MESSAGED = await tryWarmOutreachSendOnApprove(itemId, "MESSAGE_DRAFT", logs);
      } else if (item.stage === "REPLY_DRAFT" && targetStage === "REPLY_SENT") {
        logs.push(logTs("LinkedIn: REPLY_DRAFT approved — attempting Unipile send before REPLY_SENT artifact"));
        artifactOverrides.REPLY_SENT = await tryWarmOutreachSendOnApprove(itemId, "REPLY_DRAFT", logs);
      }
    }

    // 4. Advance the item (clear follow-up due date when continuing warm sequence)
    if (
      wfTypeId === "warm-outreach" &&
      item.stage === "MESSAGED" &&
      targetStage === "MESSAGE_DRAFT"
    ) {
      await query(
        `UPDATE "_workflow_item" SET stage = $1, "dueDate" = NULL, "updatedAt" = NOW() WHERE id = $2 AND "deletedAt" IS NULL`,
        [targetStage, itemId]
      );
    } else {
      await query(
        `UPDATE "_workflow_item" SET stage = $1, "updatedAt" = NOW() WHERE id = $2 AND "deletedAt" IS NULL`,
        [targetStage, itemId]
      );
    }

    // 5. Auto-generate artifacts for agent-owned stages
    logs.push(
      logTs(`Artifact: generating ${targetStage}${useFakeData ? " (template/fake)" : " (LLM where configured)"}…`)
    );
    await generateStageArtifact(
      itemId,
      item.workflowId,
      targetStage,
      wfType,
      wf.name,
      useFakeData,
      artifactOverrides
    );
    logs.push(logTs(`Artifact: done for ${targetStage}`));

    // 5b. Auto-publish to Beehiiv when entering DRAFT_PUBLISHED (content-pipeline)
    if (targetStage === "DRAFT_PUBLISHED" && wfTypeId === "content-pipeline") {
      await publishToBeehiiv(itemId, item.workflowId);
    }

    // 6. Auto-advance through non-human stages (simulation mode)
    // If the new stage is NOT human-required, auto-advance to the next stage
    let finalStage = targetStage;
    const autoAdvances: string[] = [];
    if (wfType) {
      let currentStage = targetStage;
      const stageMap = new Map(wfType.defaultBoard.stages.map((s: { key: string; requiresHuman?: boolean }) => [s.key, s]));
      const visited = new Set<string>([targetStage]);
      const stageOrder = wfType.defaultBoard.stages.map((s: { key: string }) => s.key);

      while (true) {
        const stageSpec = stageMap.get(currentStage) as { requiresHuman?: boolean } | undefined;
        if (!stageSpec || stageSpec.requiresHuman) break; // Stop at human stages

        const nextTransitions = wfType.defaultBoard.transitions[currentStage] || [];
        if (nextTransitions.length === 0) break; // No more transitions

        // If any transition goes backward (cycle), this is a "wait" stage — don't auto-advance
        const cIdx = stageOrder.indexOf(currentStage);
        const hasBackwardTransition = nextTransitions.some((t: string) => stageOrder.indexOf(t) < cIdx);
        if (hasBackwardTransition) break;

        const nextStageKey = nextTransitions[0];

        // Prevent infinite loops: stop if we've already visited this stage
        if (visited.has(nextStageKey)) break;
        visited.add(nextStageKey);
        autoAdvances.push(`${currentStage} → ${nextStageKey}`);
        logs.push(logTs(`Auto-advance: ${currentStage} → ${nextStageKey}`));

        // Generate artifact for the current agent stage
        logs.push(logTs(`Artifact: generating ${currentStage} (pre-step)…`));
        await generateStageArtifact(itemId, item.workflowId, currentStage, wfType, wf.name, useFakeData, {});
        logs.push(logTs(`Artifact: done ${currentStage} (pre-step)`));

        // Advance
        await query(
          `UPDATE "_workflow_item" SET stage = $1, "updatedAt" = NOW() WHERE id = $2 AND "deletedAt" IS NULL`,
          [nextStageKey, itemId]
        );

        // Generate artifact for the new stage too
        logs.push(logTs(`Artifact: generating ${nextStageKey} (post-step)…`));
        await generateStageArtifact(itemId, item.workflowId, nextStageKey, wfType, wf.name, useFakeData, {});
        logs.push(logTs(`Artifact: done ${nextStageKey} (post-step)`));

        currentStage = nextStageKey;
        finalStage = nextStageKey;
      }
    }

    // 7. LinkedIn cold outreach: immediate MESSAGED → MESSAGE_DRAFT cycle (up to 3)
    if (finalStage === "MESSAGED" && wfTypeId === "linkedin-outreach") {
      const draftArtifacts = await query<{ id: string }>(
        `SELECT id FROM "_artifact" WHERE "workflowItemId" = $1 AND stage = 'MESSAGE_DRAFT' AND "deletedAt" IS NULL`,
        [itemId]
      );
      const messageCount = Math.max(0, draftArtifacts.length - 1);

      if (messageCount >= 3) {
        await query(
          `UPDATE "_workflow_item" SET stage = $1, "updatedAt" = NOW() WHERE id = $2 AND "deletedAt" IS NULL`,
          ["ENDED", itemId]
        );
        finalStage = "ENDED";
        autoAdvances.push("MESSAGED → ENDED (3 messages sent)");
      } else {
        await query(
          `UPDATE "_workflow_item" SET stage = $1, "updatedAt" = NOW() WHERE id = $2 AND "deletedAt" IS NULL`,
          ["MESSAGE_DRAFT", itemId]
        );
        await generateStageArtifact(itemId, item.workflowId, "MESSAGE_DRAFT", wfType, wf.name, useFakeData, {});
        finalStage = "MESSAGE_DRAFT";
        autoAdvances.push(`MESSAGED → MESSAGE_DRAFT (message ${messageCount + 1}/3)`);
      }
    }

    // 7b. Warm outreach: hold at MESSAGED with follow-up due date
    if (finalStage === "MESSAGED" && wfTypeId === "warm-outreach") {
      const followUp = new Date();
      followUp.setDate(followUp.getDate() + WARM_OUTREACH_MESSAGE_FOLLOW_UP_DAYS);
      await query(
        `UPDATE "_workflow_item" SET "dueDate" = $1::timestamptz, "updatedAt" = NOW() WHERE id = $2 AND "deletedAt" IS NULL`,
        [followUp.toISOString(), itemId]
      );
      autoAdvances.push(
        `MESSAGED: dueDate +${WARM_OUTREACH_MESSAGE_FOLLOW_UP_DAYS}d (${followUp.toISOString()})`
      );
    }

    // 7c. Warm outreach: REPLY_SENT → REPLY_DRAFT (unlimited reply loop)
    if (finalStage === "REPLY_SENT" && wfTypeId === "warm-outreach") {
      await query(
        `UPDATE "_workflow_item" SET stage = $1, "updatedAt" = NOW() WHERE id = $2 AND "deletedAt" IS NULL`,
        ["REPLY_DRAFT", itemId]
      );
      await generateStageArtifact(itemId, item.workflowId, "REPLY_DRAFT", wfType, wf.name, useFakeData, {});
      finalStage = "REPLY_DRAFT";
      autoAdvances.push("REPLY_SENT → REPLY_DRAFT");
    }

    // 7d. Paced warm-outreach: after contact intake submit, gate the next discovery spawn (cron + timestamp)
    if (
      wfTypeId === "warm-outreach" &&
      action === "input" &&
      stageAtResolve === "AWAITING_CONTACT" &&
      finalStage !== "AWAITING_CONTACT"
    ) {
      await scheduleNextWarmDiscoveryAfterIntake(item.workflowId);
    }

    // 8. Check for cross-workflow handoffs (use final stage after auto-advances)
    const handoffs = await checkHandoffs(item, wf, finalStage);

    // 8b. Warm outreach: when one contact ends, open next AWAITING_CONTACT slot (up to targetCount)
    if (finalStage === "ENDED" && wfTypeId === "warm-outreach") {
      const spec = typeof wf.spec === "string" ? JSON.parse(wf.spec) : wf.spec;
      const targetCount = typeof spec?.targetCount === "number" ? spec.targetCount : 10;
      const spawned = await spawnAfterWarmOutreachEnded(wf.id, targetCount);
      if (spawned) {
        logs.push(`Spawned next warm-outreach slot: item ${spawned}`);
      }
    }

    // 9. When a Tim item reaches ENDED, check if all active items are done
    // Note: INITIATED items stay at CR Sent permanently — they represent
    // connection requests that were never accepted. No auto-expiry.

    await syncHumanTaskOpenForItem(itemId);

    return NextResponse.json({
      ok: true,
      itemId,
      packageId: wf.packageId,
      previousStage: item.stage,
      newStage: finalStage,
      action,
      autoAdvances: autoAdvances.length > 0 ? autoAdvances : undefined,
      handoffs,
      logs,
    });
  } catch (error) {
    console.error("[resolve] error:", error);
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        error: "Failed to resolve task",
        detail: msg,
        packageId: null,
        logs: [logTs(`ERROR: ${msg}`)],
      },
      { status: 500 }
    );
  }
}

/**
 * Check if advancing an item triggers a cross-workflow handoff.
 * For example:
 *   - Content Pipeline → PUBLISHED triggers Content Distribution → RECEIVED
 *   - Research Pipeline → HANDED_OFF triggers LinkedIn Outreach → TARGET
 */
async function checkHandoffs(
  item: { id: string; workflowId: string; sourceType: string; sourceId: string },
  wf: { id: string; name: string; packageId: string | null; ownerAgent: string; spec?: { workflowType?: string } | string },
  newStage: string
): Promise<Array<{ targetWorkflow: string; stage: string }>> {
  if (!wf.packageId) return [];

  const handoffs: Array<{ targetWorkflow: string; stage: string }> = [];

  // Get all sibling workflows in the same package
  const siblings = await query<{
    id: string;
    name: string;
    ownerAgent: string;
    spec: { workflowType?: string };
    itemType: string;
  }>(
    `SELECT id, name, "ownerAgent", spec, "itemType"
     FROM "_workflow"
     WHERE "packageId" = $1 AND id != $2 AND "deletedAt" IS NULL`,
    [wf.packageId, wf.id]
  );

  for (const sibling of siblings) {
    const sibSpec = typeof sibling.spec === "string" ? JSON.parse(sibling.spec) : sibling.spec;
    const sibType = sibSpec?.workflowType;

    // Content PUBLISHED → Content Distribution: create connection message + LinkedIn posts
    if (newStage === "PUBLISHED" && sibType === "content-distribution") {
      const distType = WORKFLOW_TYPES["content-distribution"];

      const sibWfSpec = typeof sibling.spec === "string" ? JSON.parse(sibling.spec) : sibling.spec;
      const targetCount = sibWfSpec?.targetCount || 3;
      const pacing = sibWfSpec?.pacing;

      // 1. Create the connection message item (goes RECEIVED → CONN_MSG_DRAFTED)
      const connCiRows = await query<{ id: string }>(
        `INSERT INTO "_content_item" (title, description, "contentType", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, NOW(), NOW()) RETURNING id`,
        ["Connection Request Message", "Template for LinkedIn connection requests", "connection-message"]
      );
      const connContentId = (connCiRows[0] as Record<string, unknown>)?.id as string;

      const connInserted = await query<{ id: string }>(
        `INSERT INTO "_workflow_item" ("workflowId", stage, "sourceType", "sourceId", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING id`,
        [sibling.id, "RECEIVED", "content", connContentId]
      );
      const connItemId = connInserted[0]?.id;

      if (connItemId && distType) {
        await autoAdvanceItem(connItemId, sibling.id, "RECEIVED", distType, sibling.name);
      }

      // 2. Create LinkedIn post items (start at POST_DRAFTED directly with due dates)
      const POST_ANGLES = [
        { title: "LinkedIn Post #1 — Data Hook", angle: "78% of B2B buyers trust peer recommendations" },
        { title: "LinkedIn Post #2 — Case Study", angle: "CloudScale's 3.2x demo increase through influencer partnerships" },
        { title: "LinkedIn Post #3 — Hot Take", angle: "B2B influencer marketing isn't optional in 2026" },
      ];

      const intervalDays = pacing?.interval === "daily" ? 1 : pacing?.interval === "weekly" ? 7 : pacing?.interval === "biweekly" ? 14 : 0;

      for (let i = 0; i < targetCount; i++) {
        const postInfo = POST_ANGLES[i] || { title: `LinkedIn Post #${i + 1}`, angle: "Campaign content" };

        // Due date: first post after connection message is approved, subsequent posts spaced by interval
        const dueDate = new Date();
        if (intervalDays > 0) dueDate.setDate(dueDate.getDate() + (i * intervalDays));

        const ciRows = await query<{ id: string }>(
          `INSERT INTO "_content_item" (title, description, "contentType", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, NOW(), NOW()) RETURNING id`,
          [postInfo.title, postInfo.angle, "linkedin-post"]
        );
        const contentId = (ciRows[0] as Record<string, unknown>)?.id as string;

        const inserted = await query<{ id: string }>(
          `INSERT INTO "_workflow_item" ("workflowId", stage, "sourceType", "sourceId", "dueDate", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) RETURNING id`,
          [sibling.id, "POST_DRAFTED", "content", contentId, dueDate.toISOString()]
        );
        const postItemId = inserted[0]?.id;

        // Generate the post draft artifact
        if (postItemId) {
          await generateStageArtifact(postItemId, sibling.id, "POST_DRAFTED", distType, sibling.name, true);
          await syncHumanTaskOpenForItem(postItemId);
        }
      }
      handoffs.push({ targetWorkflow: sibling.name, stage: `CONN_MSG_DRAFTED + ${targetCount} posts` });
    }

    // Content PUBLISHED → Target Research: create first batch of targets
    if (newStage === "PUBLISHED" && sibType === "research-pipeline") {
      const { WORKFLOW_TYPES } = await import("@/lib/workflow-types");
      const resType = WORKFLOW_TYPES["research-pipeline"];

      const sibWfSpec = typeof sibling.spec === "string" ? JSON.parse(sibling.spec) : sibling.spec;
      const targetCount = sibWfSpec?.targetCount || 20;
      const pacing = sibWfSpec?.pacing;
      const batchSize = pacing?.batchSize || 5;
      const bufferPercent = pacing?.bufferPercent || 25;
      const totalToSource = Math.ceil(targetCount * (1 + bufferPercent / 100));
      const firstBatch = Math.min(batchSize, totalToSource);

      const SIMULATED_TARGETS = [
        { first: "Sarah", last: "Chen", title: "VP Marketing", company: "CloudScale" },
        { first: "Marcus", last: "Johnson", title: "Dir. Content", company: "DataFlow" },
        { first: "Elena", last: "Rodriguez", title: "Growth Lead", company: "SecureNet" },
        { first: "James", last: "Park", title: "CMO", company: "TechVenture" },
        { first: "Priya", last: "Sharma", title: "VP Demand Gen", company: "SaaSMetrics" },
      ];

      for (let i = 0; i < firstBatch; i++) {
        const person = SIMULATED_TARGETS[i] || { first: `Target`, last: `${i + 1}`, title: "Executive", company: "TechCo" };

        // Create simulated person record
        const pRows = await query<{ id: string }>(
          `INSERT INTO person ("nameFirstName", "nameLastName", "jobTitle", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, NOW(), NOW()) RETURNING id`,
          [person.first, person.last, `${person.title} at ${person.company}`]
        );
        const personId = (pRows[0] as Record<string, unknown>)?.id as string;

        const inserted = await query<{ id: string }>(
          `INSERT INTO "_workflow_item" ("workflowId", stage, "sourceType", "sourceId", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING id`,
          [sibling.id, "FINDING", "person", personId]
        );
        const newItemId = inserted[0]?.id;

        if (newItemId && resType) {
          await autoAdvanceItem(newItemId, sibling.id, "FINDING", resType, sibling.name);
        }
      }
      handoffs.push({ targetWorkflow: sibling.name, stage: `QUALIFICATION (${firstBatch} targets)` });
    }

    // Research HANDED_OFF → LinkedIn Outreach (1:1, each target creates an outreach item)
    // Simulates 20% connection acceptance rate
    if (newStage === "HANDED_OFF" && sibType === "linkedin-outreach") {
      const outreachType = WORKFLOW_TYPES["linkedin-outreach"];

      // Count existing items to determine acceptance (every 5th = 20%)
      const existingItems = await query<{ id: string }>(
        `SELECT id FROM "_workflow_item" WHERE "workflowId" = $1 AND "deletedAt" IS NULL`,
        [sibling.id]
      );
      const itemIndex = existingItems.length + 1; // next item number
      const accepted = (itemIndex % 5) === 0; // Every 5th target gets accepted

      // Create directly at the right stage
      const startStage = accepted ? "TARGET" : "INITIATED";
      const inserted = await query<{ id: string }>(
        `INSERT INTO "_workflow_item" ("workflowId", stage, "sourceType", "sourceId", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING id`,
        [sibling.id, startStage, item.sourceType, item.sourceId]
      );
      const newItemId = inserted[0]?.id;

      if (newItemId && outreachType) {
        if (accepted) {
          // Advance through TARGET → INITIATED → ACCEPTED → MESSAGE_DRAFT
          const finalStage = await autoAdvanceItem(newItemId, sibling.id, "TARGET", outreachType, sibling.name);
          handoffs.push({ targetWorkflow: sibling.name, stage: `${finalStage} (CR accepted)` });
        } else {
          // CR sent but not accepted — stays at INITIATED (CR Sent)
          await query(
            `UPDATE "_workflow_item" SET stage = $1, "updatedAt" = NOW() WHERE id = $2 AND "deletedAt" IS NULL`,
            ["INITIATED", newItemId]
          );
          await syncHumanTaskOpenForItem(newItemId);
          await generateStageArtifact(newItemId, sibling.id, "INITIATED", outreachType, sibling.name, true);
          handoffs.push({ targetWorkflow: sibling.name, stage: "INITIATED (CR pending)" });
        }
      }
    }
  }

  // After HANDED_OFF: check if Scout needs to create next batch of targets
  // This triggers when the last qualification in a batch is resolved
  const callerSpec = typeof wf.spec === "string" ? JSON.parse(wf.spec) : wf.spec;
  if (newStage === "HANDED_OFF" && callerSpec?.workflowType === "research-pipeline") {
    // Count how many items are still pending in FINDING/ENRICHING/QUALIFICATION
    const pendingItems = await query<{ id: string }>(
      `SELECT id FROM "_workflow_item"
       WHERE "workflowId" = $1 AND stage IN ('FINDING', 'ENRICHING', 'QUALIFICATION') AND "deletedAt" IS NULL`,
      [wf.id]
    );

    // If no more pending items, create next batch (unless Tim has hit 20 MESSAGED)
    if (pendingItems.length === 0) {
      // Check Tim's MESSAGED count
      const timWorkflow = siblings.find(s => {
        const spec = typeof s.spec === "string" ? JSON.parse(s.spec) : s.spec;
        return spec?.workflowType === "linkedin-outreach";
      });

      let timEndedCount = 0;
      if (timWorkflow) {
        const ended = await query<{ id: string }>(
          `SELECT id FROM "_workflow_item"
           WHERE "workflowId" = $1 AND "deletedAt" IS NULL`,
          [timWorkflow.id]
        );
        // Count items at ENDED stage manually (dev store doesn't support COUNT + literal IN)
        const allTimItems = await query<{ id: string; stage: string }>(
          `SELECT id, stage FROM "_workflow_item" WHERE "workflowId" = $1 AND "deletedAt" IS NULL`,
          [timWorkflow.id]
        );
        timEndedCount = allTimItems.filter(i => i.stage === "ENDED").length;
      }

      if (timEndedCount < 20) {
        // Create next batch of 5 targets
        const resType = WORKFLOW_TYPES["research-pipeline"];
        const EXTENDED_TARGETS = [
          { first: "David", last: "Kim", title: "VP Growth", company: "ScaleUp.io" },
          { first: "Lisa", last: "Wang", title: "Head of Content", company: "MarketPulse" },
          { first: "Alex", last: "Thompson", title: "CMO", company: "DataBridge" },
          { first: "Rachel", last: "Patel", title: "Dir. Marketing", company: "CloudFirst" },
          { first: "Michael", last: "Brown", title: "VP Partnerships", company: "SyncWave" },
          { first: "Jennifer", last: "Lee", title: "Growth Lead", company: "PipelineIQ" },
          { first: "Robert", last: "Garcia", title: "Head of Demand Gen", company: "RevStream" },
          { first: "Amanda", last: "Wilson", title: "VP Marketing", company: "InsightCo" },
          { first: "Daniel", last: "Martinez", title: "Dir. Strategy", company: "GrowthLab" },
          { first: "Jessica", last: "Taylor", title: "CMO", company: "B2BForge" },
          { first: "Chris", last: "Anderson", title: "VP Content", company: "MediaShift" },
          { first: "Nicole", last: "Thomas", title: "Growth Director", company: "LeadLogic" },
          { first: "Kevin", last: "Jackson", title: "Head of Marketing", company: "FunnelMax" },
          { first: "Michelle", last: "White", title: "VP Demand Gen", company: "ConvertIQ" },
          { first: "Andrew", last: "Harris", title: "Dir. Growth", company: "ReachOut" },
          { first: "Lauren", last: "Clark", title: "CMO", company: "EngagePro" },
          { first: "Brian", last: "Lewis", title: "VP Partnerships", company: "NetBridge" },
          { first: "Emily", last: "Robinson", title: "Head of Strategy", company: "AmplifySaaS" },
          { first: "Steven", last: "Walker", title: "Dir. Marketing", company: "TractionHQ" },
          { first: "Catherine", last: "Young", title: "VP Growth", company: "Springboard.ai" },
        ];

        // Count existing person records to offset into the names list
        const existingPersons = await query<{ id: string }>(
          `SELECT id FROM "_workflow_item" WHERE "workflowId" = $1 AND "deletedAt" IS NULL`,
          [wf.id]
        );
        const offset = existingPersons.length;

        for (let i = 0; i < 5; i++) {
          const person = EXTENDED_TARGETS[(offset + i) % EXTENDED_TARGETS.length] ||
            { first: `Target`, last: `${offset + i + 1}`, title: "Executive", company: "TechCo" };

          const pRows = await query<{ id: string }>(
            `INSERT INTO person ("nameFirstName", "nameLastName", "jobTitle", "createdAt", "updatedAt")
             VALUES ($1, $2, $3, NOW(), NOW()) RETURNING id`,
            [person.first, person.last, `${person.title} at ${person.company}`]
          );
          const personId = (pRows[0] as Record<string, unknown>)?.id as string;

          const inserted = await query<{ id: string }>(
            `INSERT INTO "_workflow_item" ("workflowId", stage, "sourceType", "sourceId", "createdAt", "updatedAt")
             VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING id`,
            [wf.id, "FINDING", "person", personId]
          );
          const newItemId = inserted[0]?.id;

          if (newItemId && resType) {
            await autoAdvanceItem(newItemId, wf.id, "FINDING", resType, wf.name);
          }
        }
        handoffs.push({ targetWorkflow: wf.name, stage: "Next batch: 5 new targets created" });
      } else {
        handoffs.push({ targetWorkflow: wf.name, stage: "Scout stopped — Tim has 20+ ended sequences" });
      }
    }
  }

  return handoffs;
}

/**
 * Auto-advance an item through non-human stages, generating artifacts along the way.
 * Stops at the first human-required stage or when there are no more transitions.
 */
async function autoAdvanceItem(
  itemId: string,
  workflowId: string,
  startStage: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wfType: any,
  workflowName: string,
  useFakeData = true
): Promise<string> {
  await generateStageArtifact(itemId, workflowId, startStage, wfType, workflowName, useFakeData);

  let currentStage = startStage;
  const stageMap = new Map(
    wfType.defaultBoard.stages.map((s: { key: string; requiresHuman?: boolean }) => [s.key, s])
  );
  const visited = new Set<string>([startStage]);
  const stageOrder = wfType.defaultBoard.stages.map((s: { key: string }) => s.key);

  while (true) {
    const stageSpec = stageMap.get(currentStage) as { requiresHuman?: boolean } | undefined;
    if (!stageSpec || stageSpec.requiresHuman) break;

    const nextTransitions = wfType.defaultBoard.transitions[currentStage] || [];
    if (nextTransitions.length === 0) break;

    // Pick forward transition, skip cycles
    const nextStageKey = nextTransitions.find((t: string) => {
      const tIdx = stageOrder.indexOf(t);
      const cIdx = stageOrder.indexOf(currentStage);
      return tIdx > cIdx && !visited.has(t);
    }) || nextTransitions[0];

    if (visited.has(nextStageKey)) break;
    visited.add(nextStageKey);

    await generateStageArtifact(itemId, workflowId, currentStage, wfType, workflowName, useFakeData);
    await query(
      `UPDATE "_workflow_item" SET stage = $1, "updatedAt" = NOW() WHERE id = $2 AND "deletedAt" IS NULL`,
      [nextStageKey, itemId]
    );
    await generateStageArtifact(itemId, workflowId, nextStageKey, wfType, workflowName, useFakeData);
    currentStage = nextStageKey;
  }

  await syncHumanTaskOpenForItem(itemId);
  return currentStage;
}

async function getWarmContactNotes(itemId: string): Promise<string> {
  const rows = await query<{ content: string }>(
    `SELECT content FROM "_artifact" WHERE "workflowItemId" = $1 AND stage = 'AWAITING_CONTACT' AND "deletedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1`,
    [itemId]
  );
  return rows[0]?.content?.trim() || "";
}

/** PACKAGE_BRIEF artifact first, else live `spec.brief` from the package row. */
async function getWarmPackageBriefForItem(itemId: string): Promise<string> {
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
  const raw = (pkgRows[0]?.brief || "").trim();
  return raw;
}

/** LinkedIn slug / provider id from CRM person row linked to this workflow item. */
async function getWarmLinkedInIdentifierFromPerson(itemId: string): Promise<string | null> {
  const rows = await query<{ linkedinUrl: string | null }>(
    `SELECT p."linkedinLinkPrimaryLinkUrl" AS "linkedinUrl"
     FROM "_workflow_item" wi
     INNER JOIN person p ON p.id = wi."sourceId" AND p."deletedAt" IS NULL
     WHERE wi.id = $1 AND wi."sourceType" = 'person' AND wi."deletedAt" IS NULL`,
    [itemId]
  );
  const url = rows[0]?.linkedinUrl?.trim();
  if (!url) return null;
  return extractLinkedInProfileIdentifier(url);
}

/** Suppress accidental double-submit (double-click, duplicate POST) within a short window. */
const warmSendDedup = new Map<string, number>();
const WARM_SEND_DEDUP_MS = 20_000;

function warmSendDedupKey(itemId: string, plain: string): string {
  const norm = plain.replace(/\s+/g, " ").trim().slice(0, 800);
  return `${itemId}|${norm}`;
}

async function tryWarmOutreachSendOnApprove(
  itemId: string,
  fromStage: "MESSAGE_DRAFT" | "REPLY_DRAFT",
  logs: string[]
): Promise<{ name: string; content: string }> {
  const draftRows = await query<{ content: string }>(
    `SELECT content FROM "_artifact" WHERE "workflowItemId" = $1 AND stage = $2 AND "deletedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1`,
    [itemId, fromStage]
  );
  const draftMd = draftRows[0]?.content || "";
  const plain = extractPlainDmFromDraftMarkdown(draftMd);

  const dedupKey = warmSendDedupKey(itemId, plain);
  const now = Date.now();
  const last = warmSendDedup.get(dedupKey);
  if (last != null && now - last < WARM_SEND_DEDUP_MS) {
    logs.push(
      logTs(
        "LinkedIn: skipped duplicate send (same item + body within 20s — double-click or retry)"
      )
    );
    return {
      name: fromStage === "MESSAGE_DRAFT" ? "LinkedIn DM — duplicate suppressed" : "LinkedIn reply — duplicate suppressed",
      content: `# Send not repeated\n\nA matching send was already attempted for this item within the last 20 seconds (duplicate request protection).\n\n**Draft:**\n\n\`\`\`\n${plain}\n\`\`\`\n\n---\n*If you need to resend, wait 20s or change the message text slightly.*`,
    };
  }

  warmSendDedup.set(dedupKey, Date.now());

  logs.push(
    logTs(
      `LinkedIn: extracted ${plain.length} characters of plain text from latest ${fromStage} artifact`
    )
  );

  const notes = await getWarmContactNotes(itemId);
  const recipient =
    (await getWarmLinkedInIdentifierFromPerson(itemId)) ||
    extractLinkedInProfileIdentifier(notes);

  if (!recipient) {
    warmSendDedup.delete(dedupKey);
    logs.push(
      logTs(
        "LinkedIn: not sent — no recipient (person linkedinLinkPrimaryLinkUrl or LinkedIn URL / ACoA… in contact notes)"
      )
    );
    return {
      name: fromStage === "MESSAGE_DRAFT" ? "LinkedIn DM — not sent" : "LinkedIn reply — not sent",
      content: `# Not sent\n\n**Reason:** No LinkedIn recipient could be resolved.\n\nAdd **linkedinLinkPrimaryLinkUrl** on the person in Twenty, or paste a \`linkedin.com/in/…\` URL or **ACoA…** provider id in Govind's contact notes.\n\n**Draft (copy/paste in LinkedIn):**\n\n\`\`\`\n${plain || "(empty)"}\n\`\`\`\n\n---\n*Unipile was not called.*`,
    };
  }

  if (!isUnipileConfigured()) {
    warmSendDedup.delete(dedupKey);
    logs.push(logTs("LinkedIn: not sent — Unipile env vars missing (UNIPILE_API_KEY, UNIPILE_DSN, UNIPILE_ACCOUNT_ID)"));
    return {
      name: "LinkedIn — not sent",
      content: `# Not sent (Unipile not configured)\n\nConfigure \`UNIPILE_API_KEY\`, \`UNIPILE_DSN\`, and \`UNIPILE_ACCOUNT_ID\` on the server (same as \`linkedin_unipile.sh\`).\n\n**Recipient resolved:** \`${recipient}\`\n\n**Draft:**\n\n\`\`\`\n${plain}\n\`\`\`\n\n---\n*Send manually from LinkedIn until Unipile is configured.*`,
    };
  }

  logs.push(logTs(`LinkedIn: calling Unipile send for recipient "${recipient.slice(0, 56)}${recipient.length > 56 ? "…" : ""}"`));
  const result = await sendWarmOutreachLinkedInDm(recipient, plain);
  if (!result.ok) {
    warmSendDedup.delete(dedupKey);
  }
  if (result.ok) {
    logs.push(logTs(`LinkedIn: Unipile accepted request (HTTP ${result.httpStatus})`));
    const bodyStr =
      typeof result.body === "object"
        ? JSON.stringify(result.body, null, 2).slice(0, 1800)
        : String(result.body).slice(0, 1800);
    return {
      name: fromStage === "MESSAGE_DRAFT" ? "LinkedIn DM sent" : "LinkedIn reply sent",
      content: `# Sent via Unipile\n\n**Channel:** LinkedIn DM\n**Recipient identifier:** \`${recipient}\`\n**HTTP:** ${result.httpStatus}\n\n**API response (excerpt):**\n\`\`\`json\n${bodyStr}\n\`\`\`\n\n---\n*Confirm delivery in LinkedIn if needed.*`,
    };
  }

  logs.push(logTs(`LinkedIn: send FAILED — ${result.error}`));
  return {
    name: "LinkedIn — send failed",
    content: `# Send failed\n\n**Error:** ${result.error}\n${result.httpStatus != null ? `**HTTP:** ${result.httpStatus}\n` : ""}\n**Recipient:** \`${recipient}\`\n\n**Draft (send manually):**\n\n\`\`\`\n${plain}\n\`\`\`\n\n---\n*Unipile rejected the request — check account session, provider id, and API credentials.*`,
  };
}

function buildWarmResearchTail(
  notes: string,
  hasUnipileProfile: boolean,
  packageBrief: string
): string {
  const profileLine = hasUnipileProfile
    ? "- **Name / role / company:** Use the Unipile section above; confirm in LinkedIn UI before sending."
    : "- **Name / role / company:** Pull from LinkedIn + notes above once a profile URL is available";
  const briefLine = packageBrief.trim()
    ? "- **Package brief:** Honor the outreach brief at the top of this item (or in the PACKAGE_BRIEF artifact) for tone, boundaries, and messaging."
    : "- **Package brief:** None on file — use Govind's notes and Unipile only.";
  return `### Profile (confirm when live)
${profileLine}
- **Recent activity:** Post themes, talks, company news (LinkedIn UI)
- **Mutual connections:** …

${briefLine}

## Conversation starters
- Ground every opener in specifics from Govind's notes, the package brief, and any Unipile headline/experience — not generic SaaS / influencer angles

## Recommended angle
Friend-to-friend, casual, direct — reference shared history where it fits; soft mention of vibe coding / AI agent work only if natural; **no** buzzword soup, **no** pricing, **no** strattegys.com links in the DM.

---
*Unipile: live profile when configured; Groq: synthesis when fake data is off*`;
}

async function generateWarmEnrichmentLLM(
  notes: string,
  workflowName: string,
  linkedInUnipileContext: string,
  packageBrief: string
): Promise<string | null> {
  const system = `You are Tim preparing warm LinkedIn outreach for Govind Davis. Govind personally knows the contact and submitted notes.

The user message includes PACKAGE BRIEF (outreach/campaign mandates from the package card) and LINKEDIN (UNIPILE). Obey the package brief for tone, taboos, and positioning when it is present. Use Unipile data for facts (headline, roles, skills). If sections say none, rely on Govind's notes only.

Write Markdown only (no duplicate raw dumps of the LinkedIn section). Start with exactly:

## Tim — synthesis

Then subsections:
### Summary of Govind's notes
### Conversation starters (specific to relationship + LinkedIn facts + package brief when present)
### DM angle
Friend-to-friend, no corporate pitch, no pricing, no strattegys.com link in the DM unless the package brief explicitly allows it.`;
  const user = `Campaign / workflow: ${workflowName}

PACKAGE BRIEF (outreach mandates — follow closely):
${packageBrief || "(none)"}

LINKEDIN (UNIPILE):
${linkedInUnipileContext || "(none — not fetched, misconfigured, or no URL/slug)"}

Contact notes from Govind:
${notes || "(none)"}`;
  return groqCompletion(system, user, { max_tokens: 2500, temperature: 0.35 });
}

async function generateWarmMessageDraftLLM(
  notes: string,
  enrichment: string,
  seq: number,
  workflowName: string,
  packageBrief: string
): Promise<string | null> {
  const role =
    seq === 1
      ? "Opener (1/3): reconnect warmly, brief update on vibe coding/AI agent work if it fits, ask for intro or catch-up — no links, no pitch deck tone."
      : seq === 2
        ? "Bump (2/3): 2–4 sentences, reference something from enrichment or notes, no pressure."
        : "Final nudge (3/3): 2–3 sentences, close the loop gracefully.";
  const system = `You draft LinkedIn DMs for Govind Davis, first person as Govind. ${role}
Honor the PACKAGE BRIEF in the user message for tone, boundaries, and what to emphasize.

Output Markdown:
# Warm DM — [label]

(body — sign off as Govind)

---
*Tim — message ${seq} of 3*`;
  const user = `Workflow: ${workflowName}

PACKAGE BRIEF:
${packageBrief || "(none)"}

Enrichment report:
${enrichment.slice(0, 8000)}

Govind's raw notes:
${notes || "(none)"}`;
  return groqCompletion(system, user, { max_tokens: 1200, temperature: 0.45 });
}

async function generateWarmReplyDraftLLM(
  notes: string,
  enrichment: string,
  threadSummary: string,
  workflowName: string,
  packageBrief: string
): Promise<string | null> {
  const system = `You draft LinkedIn DM replies for Govind Davis, first person as Govind. The contact has replied (warm thread). Match a natural, friendly tone — no corporate pitch, no pricing, no strattegys.com links unless they asked or the package brief allows.
Honor the PACKAGE BRIEF for tone and boundaries.

Output Markdown:
# Reply — Ready for Review

(body — sign off as Govind)

---
*Tim — approve to send via LinkedIn DM*`;
  const user = `Workflow: ${workflowName}

PACKAGE BRIEF:
${packageBrief || "(none)"}

Enrichment:
${enrichment.slice(0, 6000)}

Govind's original contact notes:
${notes || "(none)"}

Outbound thread so far (your prior messages / sends):
${threadSummary || "(none yet)"}

Draft the next reply Govind should send.`;
  return groqCompletion(system, user, { max_tokens: 1200, temperature: 0.45 });
}

/**
 * Generate simulated artifacts when an item enters a new agent-owned stage.
 * In production, the actual agent would create these. For simulation/testing,
 * we create placeholder content so the workflow can be tested end-to-end.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function generateStageArtifact(
  itemId: string,
  workflowId: string,
  stage: string,
  wfType: any,
  workflowName: string,
  useFakeData = true,
  artifactOverrides: Partial<Record<string, { name: string; content: string }>> = {}
) {
  if (!wfType) return;

  const customArtifact = artifactOverrides[stage];
  if (customArtifact) {
    const allowMultiple =
      ["MESSAGE_DRAFT", "REPLY_DRAFT", "REPLY_SENT"].includes(stage) ||
      (wfType?.id === "warm-outreach" && (stage === "MESSAGED" || stage === "REPLY_SENT"));
    if (!allowMultiple) {
      const existing = await query(
        `SELECT id FROM "_artifact" WHERE "workflowItemId" = $1 AND stage = $2 AND "deletedAt" IS NULL`,
        [itemId, stage]
      );
      if (existing.length > 0) return;
    }
    await query(
      `INSERT INTO "_artifact" ("workflowItemId", "workflowId", stage, name, type, content, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
      [itemId, workflowId, stage, customArtifact.name, "markdown", customArtifact.content]
    );
    return;
  }

  // Fetch the idea text if we're generating a campaign spec (to incorporate it)
  let ideaText = "";
  if (stage === "CAMPAIGN_SPEC" || stage === "DRAFTING") {
    const ideaArtifacts = await query<{ content: string }>(
      `SELECT content FROM "_artifact" WHERE "workflowItemId" = $1 AND stage = 'IDEA' AND "deletedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1`,
      [itemId]
    );
    ideaText = ideaArtifacts[0]?.content || "No idea submitted";
  }

  // ── REAL LLM CALLS (when useFakeData is false) ──
  console.log(`[generateStageArtifact] stage=${stage} useFakeData=${useFakeData} workflowName=${workflowName}`);
  if (!useFakeData) {
    if (stage === "CAMPAIGN_SPEC") {
      const spec = await generateRealCampaignSpec(ideaText, workflowName);
      if (spec) {
        await insertArtifact(itemId, workflowId, stage, "Campaign Spec", spec);
        return;
      }
    }
    if (stage === "DRAFTING") {
      // Get the campaign spec artifact
      const specArtifacts = await query<{ content: string }>(
        `SELECT content FROM "_artifact" WHERE "workflowItemId" = $1 AND stage = 'CAMPAIGN_SPEC' AND "deletedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1`,
        [itemId]
      );
      const campaignSpec = specArtifacts[0]?.content || ideaText;
      try {
        const draft = await generateRealArticleDraft(ideaText, campaignSpec, workflowName);
        if (draft) {
          await insertArtifact(itemId, workflowId, stage, "Article Draft", draft);
          return;
        }
        // If null, write the error as the artifact so we can see it
        await insertArtifact(itemId, workflowId, stage, "Article Draft", `# LLM RETURNED NULL (v2)\n\nideaText: ${ideaText.substring(0, 200)}\ncampaignSpec length: ${campaignSpec.length}\nANTHROPIC_API_KEY set: ${!!process.env.ANTHROPIC_API_KEY}\n\nFalling through to fake data.`);
        return;
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await insertArtifact(itemId, workflowId, stage, "Article Draft", `# LLM ERROR\n\n${errMsg}\n\nANTHROPIC_API_KEY set: ${!!process.env.ANTHROPIC_API_KEY}\nideaText: ${ideaText.substring(0, 200)}`);
        return;
      }
    }
    if (stage === "DRAFT_PUBLISHED") {
      // Publish existing article to strattegys.com as a draft — NO regeneration
      try {
        const result = await publishToStrattegys(itemId, workflowId, workflowName);
        if (result) {
          await insertArtifact(itemId, workflowId, stage, "Draft Published", result);
          return;
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await insertArtifact(itemId, workflowId, stage, "Publish Error", `# PUBLISH FAILED\n\n${errMsg}`);
        return;
      }
    }
    // For other stages, fall through to fake data templates
  }

  // Warm outreach: enrichment — Unipile LinkedIn profile + Govind notes + optional Groq synthesis
  if (wfType?.id === "warm-outreach" && stage === "RESEARCHING") {
    const existing = await query(
      `SELECT id FROM "_artifact" WHERE "workflowItemId" = $1 AND stage = 'RESEARCHING' AND "deletedAt" IS NULL`,
      [itemId]
    );
    if (existing.length > 0) return;

    const notes = await getWarmContactNotes(itemId);
    const packageBrief = await getWarmPackageBriefForItem(itemId);
    const fromPerson = await getWarmLinkedInIdentifierFromPerson(itemId);
    const fromNotes = extractLinkedInProfileIdentifier(notes);
    const linkedinIdentifier = fromPerson || fromNotes;

    let unipileMarkdown = "";
    let unipileStatus = "";

    if (isUnipileConfigured() && linkedinIdentifier) {
      console.log(
        `[warm-outreach] Unipile profile fetch for item=${itemId} identifier=${linkedinIdentifier.slice(0, 64)}`
      );
      const raw = await fetchUnipileLinkedInProfile(linkedinIdentifier);
      unipileMarkdown = formatUnipileProfileMarkdown(raw);
    } else if (!linkedinIdentifier) {
      unipileStatus =
        "No LinkedIn profile reference found. Add linkedinLinkPrimaryLinkUrl on the person in Twenty (column person.linkedinLinkPrimaryLinkUrl), or paste a https://www.linkedin.com/in/… URL or ACoA… provider id in Govind's contact notes.";
    } else {
      unipileStatus =
        "Unipile is not configured in this app. Set **UNIPILE_API_KEY**, **UNIPILE_DSN** (e.g. `api32.unipile.com:16299`), and **UNIPILE_ACCOUNT_ID** in the server environment — same as your `linkedin_unipile.sh` / production Unipile account.";
    }

    const notesBlock =
      notes.trim().length > 0
        ? notes.trim()
        : "_No contact notes were captured on this item; add context in AWAITING_CONTACT or resubmit._";

    const linkedinSection = unipileMarkdown.trim()
      ? `## LinkedIn profile (Unipile)\n\n${unipileMarkdown}\n`
      : `## LinkedIn (Unipile)\n\n_${unipileStatus || "Not fetched."}_\n`;

    const forLlm =
      unipileMarkdown.trim() ||
      (unipileStatus ? `(Status) ${unipileStatus}` : "(none)");

    let synthesis = "";
    if (!useFakeData) {
      synthesis =
        (await generateWarmEnrichmentLLM(notes, workflowName, forLlm, packageBrief)) ||
        `## Tim — synthesis (template)\n\n${buildWarmResearchTail(notes, Boolean(unipileMarkdown.trim()), packageBrief)}`;
    } else {
      synthesis = `## Tim — synthesis (fake data mode)\n\n${buildWarmResearchTail(notes, Boolean(unipileMarkdown.trim()), packageBrief)}`;
    }

    const content = `# Warm contact — enrichment report

${linkedinSection}
## What Govind provided

${notesBlock}

---

${synthesis}`;

    await insertArtifact(itemId, workflowId, stage, "Warm contact enrichment", content);
    return;
  }

  // Warm outreach: opener / bump / nudge — always use warm templates (not linkedin cold MESSAGE_DRAFT map).
  // When useFakeData is false, try Groq (GROQ_API_KEY); on missing key or failure, use templates with notes.
  if (wfType?.id === "warm-outreach" && stage === "MESSAGE_DRAFT") {
    const draftRows = await query<{ id: string }>(
      `SELECT id FROM "_artifact" WHERE "workflowItemId" = $1 AND stage = 'MESSAGE_DRAFT' AND "deletedAt" IS NULL`,
      [itemId]
    );
    const seq = Math.min(draftRows.length + 1, 3);
    const notes = await getWarmContactNotes(itemId);
    const packageBrief = await getWarmPackageBriefForItem(itemId);
    const enrichRows = await query<{ content: string }>(
      `SELECT content FROM "_artifact" WHERE "workflowItemId" = $1 AND stage = 'RESEARCHING' AND "deletedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1`,
      [itemId]
    );
    const enrichment = enrichRows[0]?.content || "";

    if (!useFakeData) {
      const llm = await generateWarmMessageDraftLLM(notes, enrichment, seq, workflowName, packageBrief);
      if (llm) {
        const names: Record<number, string> = {
          1: "Warm LinkedIn DM — Opener (1/3)",
          2: "Warm LinkedIn DM — Bump (2/3)",
          3: "Warm LinkedIn DM — Final nudge (3/3)",
        };
        await insertArtifact(itemId, workflowId, stage, names[seq], llm);
        return;
      }
    }

    const notesBlock =
      notes.trim().length > 0
        ? `\n\n## Context from Govind\n\n${notes.trim()}\n`
        : "\n\n_(No AWAITING_CONTACT notes on file — personalize manually.)_\n";
    const briefBlock =
      packageBrief.trim().length > 0
        ? `\n\n## Package outreach brief\n\n${packageBrief.trim().slice(0, 4000)}\n`
        : "";

    const warmDrafts: Record<number, { name: string; content: string }> = {
      1: {
        name: "Warm LinkedIn DM — Opener (1/3)",
        content: `# Warm DM — Opener${briefBlock}${notesBlock}\nHey [Name] — good to reconnect. Quick update: I've been building out vibe coding and AI agent work for teams (shipping fast, Intuit-style timelines). If you know anyone who needs that kind of build, I'd love a intro — or happy to catch up if it's on your radar.\n\n— Govind\n\n---\n*Tim — message 1 of 3. Friend-to-friend tone per campaign brief. Send via LinkedIn DM only.*`,
      },
      2: {
        name: "Warm LinkedIn DM — Bump (2/3)",
        content: `# Warm DM — Light follow-up${briefBlock}${notesBlock}\nBumping this — tying back to what we talked about above / something you posted recently. Still around if a quick chat ever makes sense. No pressure.\n\n— Govind\n\n---\n*Tim — message 2 of 3. 2–4 sentences max.*`,
      },
      3: {
        name: "Warm LinkedIn DM — Final nudge (3/3)",
        content: `# Warm DM — Close the loop${briefBlock}${notesBlock}\nI'll leave it here — know you're busy. Door's open if anything changes.\n\n— Govind\n\n---\n*Tim — message 3 of 3. Zero pressure, 2–3 sentences.*`,
      },
    };
    const t = warmDrafts[seq];
    await insertArtifact(itemId, workflowId, stage, t.name, t.content);
    return;
  }

  // Warm outreach: follow-up reply drafts after contact replies (Groq when not using fake data)
  if (wfType?.id === "warm-outreach" && stage === "REPLY_DRAFT" && !useFakeData) {
    const notes = await getWarmContactNotes(itemId);
    const packageBrief = await getWarmPackageBriefForItem(itemId);
    const enrichRows = await query<{ content: string }>(
      `SELECT content FROM "_artifact" WHERE "workflowItemId" = $1 AND stage = 'RESEARCHING' AND "deletedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1`,
      [itemId]
    );
    const enrichment = enrichRows[0]?.content || "";
    const threadRows = await query<{ stage: string; content: string }>(
      `SELECT stage, content FROM "_artifact" WHERE "workflowItemId" = $1 AND stage IN ('MESSAGE_DRAFT', 'REPLY_DRAFT', 'REPLY_SENT') AND "deletedAt" IS NULL ORDER BY "createdAt" ASC`,
      [itemId]
    );
    const threadSummary = threadRows
      .map((r) => `### ${r.stage}\n${r.content.slice(0, 2000)}`)
      .join("\n\n");
    const llm = await generateWarmReplyDraftLLM(notes, enrichment, threadSummary, workflowName, packageBrief);
    if (llm) {
      await insertArtifact(itemId, workflowId, stage, "Reply draft", llm);
      return;
    }
  }

  // Map of stage keys to artifact generators
  const ARTIFACT_MAP: Record<string, { name: string; content: string } | null> = {
    CAMPAIGN_SPEC: {
      name: "Campaign Spec",
      content: `# Campaign Spec: ${workflowName}\n\n## Article Idea\n${ideaText}\n\n## Target Audience\n- *To be defined by Ghost*\n\n## Key Messages\n- *To be defined by Ghost*\n\n## Content Angle\n- *To be defined by Ghost*\n\n## SEO Keywords\n- *To be defined by Ghost*\n\n## Distribution Plan\n- Publish on strattegys.com\n- LinkedIn post by Marni\n- Outreach messaging by Tim\n\n---\n*Campaign spec template — Ghost will refine this based on your idea. Chat with Ghost to make changes before submitting.*`,
    },
    DRAFTING: {
      name: "Article Draft",
      content: `# Article Draft: ${workflowName}\n\n## Introduction\nIn the rapidly evolving landscape of B2B marketing, influencer partnerships have emerged as a key differentiator for brands looking to build credibility and drive pipeline.\n\n## The Shift to B2B Influencer Strategy\nRecent data suggests that 78% of B2B buyers trust peer recommendations over traditional vendor content. This shift is fundamentally changing how companies approach their go-to-market strategies.\n\n## Case Studies\n\n### CloudScale (SaaS, Series C)\nBy partnering with 5 industry thought leaders, CloudScale saw a 3.2x increase in qualified demo requests over 6 months.\n\n### DataFlow Analytics\nTheir influencer content program generated 45% of all inbound pipeline in Q4 2025.\n\n### SecureNet\nThought leadership partnerships drove a 28% reduction in sales cycle length.\n\n## Building Your B2B Influencer Playbook\n1. Identify thought leaders your buyers already trust\n2. Co-create content that serves the audience first\n3. Measure beyond vanity metrics — track pipeline influence\n4. Build long-term relationships, not one-off campaigns\n\n## Conclusion\nThe companies winning in B2B marketing are those treating influencer partnerships as a strategic channel, not a tactical afterthought.\n\n---\n*Draft generated by Ghost — ready for human review*`,
    },
    FINDING: {
      name: "Target Discovery Report",
      content: `# Target Discovery Report\n\n## Search Criteria\n- Industry: B2B SaaS, Marketing Technology\n- Role: VP Marketing, Director of Content, Growth Lead\n- Activity: Active LinkedIn posters, conference speakers\n- Context: Related to B2B influencer marketing article\n\n## Targets Found: 5\n\n| Name | Company | Title | LinkedIn Activity | Relevance |\n|------|---------|-------|-------------------|----------|\n| Sarah Chen | CloudScale | VP Marketing | 3 posts/week | High |\n| Marcus Johnson | DataFlow | Dir. Content | 2 posts/week | High |\n| Elena Rodriguez | SecureNet | Growth Lead | 5 posts/week | Medium |\n| James Park | TechVenture | CMO | 1 post/week | High |\n| Priya Sharma | SaaSMetrics | VP Demand Gen | 4 posts/week | Medium |\n\n---\n*Report generated by Scout*`,
    },
    ENRICHING: {
      name: "Enriched Target Profile",
      content: `# Enriched Target Profile\n\n## Sarah Chen — VP Marketing, CloudScale\n\n### Contact\n- LinkedIn: linkedin.com/in/sarahchen-cloudscale\n- Company: CloudScale (Series C, 200 employees)\n- Industry: B2B SaaS / Cloud Infrastructure\n\n### Recent Activity\n- Posted about "scaling demand gen without scaling headcount" (2 days ago, 340 reactions)\n- Shared article on B2B content strategy (1 week ago)\n- Spoke at SaaStr Annual 2026 on "Marketing-Led Growth"\n\n### Mutual Connections\n- 3 shared connections in SaaS marketing\n\n### Campaign Fit\n- **Role match:** VP Marketing — exactly the target persona\n- **Interest match:** Active in B2B marketing strategy conversations\n- **Company fit:** Series C SaaS — ideal ICP\n- **Conversation starter:** Her recent post about demand gen efficiency aligns with our influencer ROI angle\n\n### Recommended Messaging Angle\nReference her SaaStr talk and the 78% stat from our article. Position as peer-to-peer insight sharing, not a pitch.\n\n---\n*Profile enriched by Scout*`,
    },
    QUALIFICATION: {
      name: "Qualification Summary",
      content: `# Qualification Summary\n\n## Target: Sarah Chen, VP Marketing @ CloudScale\n\n### Quality Score: 4/5\n\n### Why This Target Is a Fit\n- VP-level decision maker at a Series C SaaS company\n- Actively posting about B2B marketing strategy (3x/week)\n- Recent content aligns with our campaign themes\n- Strong mutual connections for warm intro possibility\n\n### Recommended Action\n**Approve for handoff to Tim** — high-quality target with clear conversation entry points.\n\n### Suggested Messaging Approach\n1. Connect with personalized note referencing her SaaStr talk\n2. Share our B2B influencer article as a value-add\n3. Propose a conversation about marketing-led growth strategies\n\n### Risks\n- May already be working with a competing agency (no evidence, but possible)\n- High-profile target — needs a thoughtful, non-salesy approach\n\n---\n*Qualification prepared by Scout — awaiting human review*`,
    },
    POST_DRAFTED: {
      name: "LinkedIn Post Draft",
      content: `# LinkedIn Post — Ready for Review\n\n🔍 New data: 78% of B2B buyers trust peer recommendations over vendor content.\n\nThis isn't just a trend — it's a fundamental shift in how B2B buying decisions are made.\n\nWe dove deep into the numbers and found that companies leveraging influencer partnerships are seeing:\n→ 3.2x more qualified demos\n→ 45% of inbound pipeline from co-created content\n→ 28% shorter sales cycles\n\nThe playbook is changing. Is your team adapting?\n\n🔗 Read the full analysis: https://blog.strattegys.com/b2b-influencer-marketing-2026\n\n#B2BMarketing #InfluencerMarketing #SaaS\n\n---\n*Post drafted by Marni — approve to publish on LinkedIn*`,
    },
    POSTED: {
      name: "LinkedIn Post Published",
      content: `# LinkedIn Post — Published\n\n## Post URL\nhttps://linkedin.com/feed/update/urn:li:activity:7654321\n\n## Status: LIVE\n\n## Engagement (to be tracked)\n- Impressions: --\n- Reactions: --\n- Comments: --\n- Shares: --\n- Click-throughs: --\n\n---\n*Post published — Marni will now draft the connection request message*`,
    },
    MESSAGE_DRAFT: {
      name: "Outreach Message Draft",
      content: `# Outreach Message — Ready for Review\n\nHi Sarah,\n\nI noticed your recent post about scaling demand gen without scaling headcount — really resonated with some challenges we've been exploring too.\n\nWe just published some research on how B2B companies are using influencer partnerships to drive pipeline more efficiently. Given your experience at CloudScale, I think you'd find the data on peer-driven buying decisions particularly interesting.\n\nHere's the piece if you're curious: [link]\n\nWould love to hear your perspective on this.\n\nBest,\nGovind\n\n---\n*Message drafted by Tim — personalized using Scout's enrichment data*\n*Message 1 of 3 in sequence*`,
    },
    RESEARCHING: {
      name: "Warm contact enrichment",
      content: `# Warm contact — enrichment report\n\n## Profile\n- **Name:** [From Govind's notes + LinkedIn]\n- **Title / company:** …\n- **LinkedIn activity:** Recent posts, themes\n- **Mutual connections:** …\n\n## Conversation starters\n- …\n\n## Recommended angle\nFriend-to-friend, casual, direct — reference shared history; soft mention of vibe coding / agent buildout; no buzzwords, no pricing, no strattegys.com links in DM.\n\n---\n*Simulated research — Tim uses fetch-profile + web_search in production*`,
    },
    MESSAGED: {
      name: "LinkedIn DM sent",
      content: `# Message status\n\n**Channel:** LinkedIn DM\n**Status:** Not sent via API from this step\n\nWarm outreach normally sends through Unipile when you **Approve** a message draft (if Unipile is configured). This artifact was created without a send attempt — use **Continue** / **Replied** as appropriate.\n\n---\n*Tim*`,
    },
    REPLIED: {
      name: "Contact replied",
      content: `# Contact replied\n\nGovind marked **Replied** — the contact responded on LinkedIn. Entering conversation mode: Tim will draft replies until you **End Sequence**.\n\n---\n*Transition artifact*`,
    },
    REPLY_DRAFT: {
      name: "Reply draft",
      content: `# Reply — Ready for Review\n\nThanks for getting back — [draft body matching their energy, continuing naturally].\n\n— Govind\n\n---\n*Tim — approve to send via LinkedIn DM, reject to redraft, or End Sequence.*`,
    },
    REPLY_SENT: {
      name: "Reply sent",
      content: `# Reply status\n\n**Channel:** LinkedIn DM\n**Status:** Not sent via API from this step\n\nReplies send through Unipile when you **Approve** a reply draft. If you see this text, no Unipile call was recorded for this transition.\n\n---\n*Tim*`,
    },
    ENDED: {
      name: "Sequence summary",
      content: `# Warm outreach — ended\n\n**Outcome:** Sequence complete (3-message cadence finished without ongoing thread, or conversation wrapped up by Govind).\n\n---\n*Log for campaign analytics*`,
    },
    CONN_MSG_DRAFTED: {
      name: "Connection Request Message Template",
      content: `# Connection Request Message Template\n\n## Template (under 300 characters)\n\nHi {firstName}, I recently published research on B2B influencer partnerships that's getting a lot of traction. Given your work at {company}, I think you'd find some of the data really relevant. Would love to connect and share insights.\n\n---\n\n## Character Count: 271/300\n\n## Personalization Variables\n- **{firstName}** — Target's first name\n- **{company}** — Target's company name\n\n## Tone\nPeer-to-peer, value-first. References the article without pitching. Positions connection as mutual benefit.\n\n## Usage Notes\nTim will personalize this template for each target using Scout's enrichment data. The connection request is the first touchpoint — keep it light and genuine.\n\n---\n*Template drafted by Marni — awaiting human approval before Tim can start sending*`,
    },
    DRAFT_PUBLISHED: {
      name: "Publication Details",
      content: `# Publication Details\n\n## Article\n"Why B2B Brands Are Betting Big on Influencer Partnerships in 2026"\n\n## Publication URL\nhttps://blog.strattegys.com/b2b-influencer-marketing-2026\n\n## Platform\nStrattegys Blog (WordPress)\n\n## Publication Date\n${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}\n\n## Summary\nPublished a 2,100-word article covering the shift from B2C to B2B influencer strategies, backed by data (78% buyer trust stat) and three case studies (CloudScale, DataFlow, SecureNet). Optimized for SEO with target keywords. Includes actionable playbook section for marketing leaders.\n\n## Distribution Ready\nThis URL is now available for:\n- Marni's LinkedIn post creation\n- Tim's outreach messaging\n- Scout's target research context\n\n---\n*Publication confirmed — downstream workflows unblocked*`,
    },
    PUBLISHED: {
      name: "Published Article Record",
      content: `# Published Article — Final Record\n\n## Title\nWhy B2B Brands Are Betting Big on Influencer Partnerships in 2026\n\n## URL\nhttps://blog.strattegys.com/b2b-influencer-marketing-2026\n\n## Status: LIVE\n\n## Downstream Workflows Triggered\n- Content Distribution (Marni) — creating LinkedIn posts and outreach messaging\n- Target Research (Scout) — using article as context for prospect discovery\n\n## Metrics (to be tracked)\n- Page views: --\n- Time on page: --\n- Social shares: --\n- Inbound leads attributed: --\n\n---\n*This is the final output of the Article Creation workflow*`,
    },
  };

  const artifact = ARTIFACT_MAP[stage];
  if (!artifact) return;

  // Check if artifact already exists for this item+stage (allow multiples for cycling stages like MESSAGE_DRAFT)
  const ALLOW_MULTIPLE_STAGES = new Set(["MESSAGE_DRAFT", "REPLY_DRAFT", "REPLY_SENT"]);
  const allowMultipleArtifact =
    ALLOW_MULTIPLE_STAGES.has(stage) ||
    (wfType?.id === "warm-outreach" && (stage === "MESSAGED" || stage === "REPLY_SENT"));
  if (!allowMultipleArtifact) {
    const existing = await query(
      `SELECT id FROM "_artifact" WHERE "workflowItemId" = $1 AND stage = $2 AND "deletedAt" IS NULL`,
      [itemId, stage]
    );
    if (existing.length > 0) return;
  }

  await query(
    `INSERT INTO "_artifact" ("workflowItemId", "workflowId", stage, name, type, content, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
    [itemId, workflowId, stage, artifact.name, "markdown", artifact.content]
  );
}

/**
 * Auto-publish an article draft to Beehiiv when entering DRAFT_PUBLISHED.
 * Fetches the Article Draft artifact, converts markdown to HTML, sends to Beehiiv,
 * and creates a DRAFT_PUBLISHED artifact with the Beehiiv link.
 */
async function publishToBeehiiv(itemId: string, workflowId: string) {
  const BEEHIIV_API_KEY = process.env.BEEHIIV_API_KEY;
  const BEEHIIV_PUB_ID = process.env.BEEHIIV_PUB_ID || "pub_f185705c-e383-43a3-bf39-40448f7087a3";

  if (!BEEHIIV_API_KEY) {
    console.warn("[beehiiv] API key not configured — creating simulated artifact instead");
    // Fall back to simulated artifact (already created by generateStageArtifact)
    return;
  }

  try {
    // Get the article draft artifact
    const draftArtifacts = await query<{ content: string; name: string }>(
      `SELECT content, name FROM "_artifact" WHERE "workflowItemId" = $1 AND stage = $2 AND "deletedAt" IS NULL`,
      [itemId, "DRAFTING"]
    );

    const draft = draftArtifacts[0];
    if (!draft) {
      console.warn("[beehiiv] No draft artifact found for item", itemId);
      return;
    }

    // Simple markdown → HTML conversion (paragraphs, headers, bold, italic, lists)
    const htmlContent = markdownToHtml(draft.content);

    // Extract title from the markdown (first # heading)
    const titleMatch = draft.content.match(/^#\s+(.+)/m);
    const title = titleMatch?.[1] || "Untitled Article";

    // Publish to Beehiiv as draft
    const res = await fetch(
      `https://api.beehiiv.com/v2/publications/${BEEHIIV_PUB_ID}/posts`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${BEEHIIV_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title,
          body_content: htmlContent,
          status: "draft",
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error("[beehiiv] publish error:", res.status, errText);
      // Create error artifact so user knows what happened
      await query(
        `INSERT INTO "_artifact" ("workflowItemId", "workflowId", stage, name, type, content, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
        [itemId, workflowId, "DRAFT_PUBLISHED", "Beehiiv Error",  "markdown",
          `# Beehiiv Publish Failed\n\n**Error:** ${res.status}\n\n${errText}\n\nThe article was not published to Beehiiv. Check the API key and try again.`]
      );
      return;
    }

    const data = await res.json();
    const postId = data?.data?.id || "unknown";
    const webUrl = data?.data?.web_url || "";

    // Remove the simulated DRAFT_PUBLISHED artifact and replace with real one
    await query(
      `DELETE FROM "_artifact" WHERE "workflowItemId" = $1 AND stage = $2`,
      [itemId, "DRAFT_PUBLISHED"]
    );

    await query(
      `INSERT INTO "_artifact" ("workflowItemId", "workflowId", stage, name, type, content, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
      [itemId, workflowId, "DRAFT_PUBLISHED", "Beehiiv Draft", "markdown",
        `# Article Published to Beehiiv (Draft)\n\n## Review Link\n${webUrl}\n\n## Beehiiv Post ID\n${postId}\n\n## Title\n${title}\n\n## Status\nDraft — review on Beehiiv, make any final edits, then approve here to mark as Published.\n\n---\n*Auto-published by Ghost via Beehiiv API*`]
    );

    console.log(`[beehiiv] Draft published: ${postId} — ${webUrl}`);
  } catch (error) {
    console.error("[beehiiv] publish error:", error);
  }
}

/** Simple markdown to HTML converter for Beehiiv body_content */
function markdownToHtml(md: string): string {
  return md
    .split("\n\n")
    .map(block => {
      block = block.trim();
      if (!block) return "";
      // Headers
      if (block.startsWith("### ")) return `<h3>${block.slice(4)}</h3>`;
      if (block.startsWith("## ")) return `<h2>${block.slice(3)}</h2>`;
      if (block.startsWith("# ")) return `<h1>${block.slice(2)}</h1>`;
      // Lists
      if (block.match(/^[-*] /m)) {
        const items = block.split(/\n/).map(l => `<li>${l.replace(/^[-*] /, "")}</li>`).join("");
        return `<ul>${items}</ul>`;
      }
      if (block.match(/^\d+\. /m)) {
        const items = block.split(/\n/).map(l => `<li>${l.replace(/^\d+\. /, "")}</li>`).join("");
        return `<ol>${items}</ol>`;
      }
      // Horizontal rule
      if (block === "---") return "<hr>";
      // Paragraph with inline formatting
      let html = block
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(/`(.+?)`/g, "<code>$1</code>")
        .replace(/\n/g, "<br>");
      return `<p>${html}</p>`;
    })
    .filter(Boolean)
    .join("\n");
}

// ── Helper: insert artifact ──
async function insertArtifact(
  itemId: string,
  workflowId: string,
  stage: string,
  name: string,
  content: string
) {
  await query(
    `INSERT INTO "_artifact" ("workflowItemId", "workflowId", stage, name, type, content, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
    [itemId, workflowId, stage, name, "markdown", content]
  );
}

// ── Real LLM: Campaign Spec from Idea ──
async function generateRealCampaignSpec(ideaText: string, workflowName: string): Promise<string | null> {
  if (!ANTHROPIC_KEY) {
    console.error("[generateRealCampaignSpec] ANTHROPIC_API_KEY is not set");
    return null;
  }
  try {
    const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

    console.log(`[generateRealCampaignSpec] Generating spec for: "${workflowName}"`);

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      system: `You are Ghost, a content strategist for Strattegys — a B2B growth strategy publication by Govind Davis.

Your job is to take a raw article idea and expand it into a complete campaign specification document.

Write the spec in Markdown. Include these sections:
# Campaign Spec: [Title]

## Article Idea
(Restate the idea clearly)

## Target Audience
(Who is this for? Be specific — roles, company stages, pain points)

## Key Messages & Angles
(3-5 core arguments or insights the article will deliver)

## Detailed Outline
(Section-by-section with headers and 1-2 sentence descriptions of each section's content)

## Tone & Voice
(How should this sound? Reference Govind's style — direct, conversational, technical but accessible)

## SEO Keywords
(5-8 target keywords/phrases)

## Estimated Word Count
(Target length)

## Distribution Notes
(How this connects to LinkedIn posts, outreach, etc.)

Be thorough and specific. This spec will guide the actual article writing.`,
      messages: [{ role: "user", content: `Here's the article idea:\n\n${ideaText}\n\nCreate a complete campaign specification for this article.` }],
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("");

    console.log(`[generateRealCampaignSpec] Generated ${text.split(/\s+/).length} words`);
    return text || null;
  } catch (err) {
    console.error("[generateRealCampaignSpec] Error:", err);
    return null;
  }
}

// ── Real LLM: Article Draft from Campaign Spec ──
async function generateRealArticleDraft(ideaText: string, campaignSpec: string, workflowName: string): Promise<string | null> {
  const key = ANTHROPIC_KEY;
  console.log(`[generateRealArticleDraft-v2] ANTHROPIC_API_KEY present: ${!!key}`);
  if (!key) {
    console.error("[generateRealArticleDraft-v2] ANTHROPIC_API_KEY is not set");
    return null;
  }

  try {
    const client = new Anthropic({ apiKey: key });

    console.log(`[generateRealArticleDraft-v2] Writing article for: "${workflowName}"`);

    let text = "";
    const stream = await client.messages.stream({
      model: "claude-opus-4-20250514",
      max_tokens: 12000,
      system: `You are an expert long-form content writer for Strattegys, a B2B growth strategy publication by Govind Davis.

Write in Govind's voice: direct, conversational, technically sharp but accessible. He uses punchy short sentences mixed with longer analytical ones. He's not afraid to have personality — references, humor, real talk.

IMPORTANT: Start the article with a YAML frontmatter block containing metadata, then the full article body in Markdown.

Format:
---
title: [Compelling article title]
slug: [url-friendly-slug-from-title]
excerpt: [1-2 sentence hook under 300 characters that makes people want to read]
featuredImageDescription: [Detailed visual description for AI image generation — describe the scene, style, mood, colors. Think editorial illustration, not stock photo.]
featuredImage:
author: Govind Davis
tags: [relevant tags as YAML list]
---

[Article body starts here with a strong opening paragraph — no heading, just jump right in]

## [First Section Heading]
...

Use ## for main sections and ### for subsections. Lead with a strong hook. Back claims with data or examples. Make every section actionable. Target the word count in the spec.`,
      messages: [
        {
          role: "user",
          content: `Write the full article based on this campaign spec:\n\n${campaignSpec}\n\nOriginal idea: ${ideaText}\n\nWrite the complete article with YAML frontmatter (title, slug, excerpt, author, tags) followed by the article body in Markdown.`,
        },
      ],
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        text += event.delta.text;
      }
    }

    const wordCount = text.split(/\s+/).length;
    console.log(`[generateRealArticleDraft-v2] Generated ~${wordCount} words`);
    return text || null;
  } catch (err) {
    const errMsg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error("[generateRealArticleDraft-v2] CAUGHT ERROR:", errMsg);
    return `# LLM CALL FAILED\n\nError: ${errMsg}\n\nProvider: Anthropic API (article draft path)\nANTHROPIC_API_KEY configured: ${!!process.env.ANTHROPIC_API_KEY}`;
  }
}

// ── Publish to strattegys.com ──
async function publishToStrattegys(itemId: string, workflowId: string, workflowName: string): Promise<string | null> {
  const SITE_API_URL = process.env.SITE_API_URL || "https://strattegys.com/api/articles";
  const SITE_PUBLISH_SECRET = process.env.SITE_PUBLISH_SECRET || "strattegys-publish-2026";

  // 1. Get the article draft
  const draftRows = await query<{ content: string }>(
    `SELECT content FROM "_artifact" WHERE "workflowItemId" = $1 AND stage = 'DRAFTING' AND "deletedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1`,
    [itemId]
  );
  if (!draftRows[0]?.content) return "# ERROR\n\nNo article draft found.";
  const rawContent = draftRows[0].content;

  // 2. Parse YAML frontmatter if present
  let title = workflowName;
  let slug = "";
  let excerpt = "";
  let author = "Govind Davis";
  let tags: string[] = ["AI", "Strategy"];
  let featuredImage = "";
  let articleContent = rawContent;

  const fmMatch = rawContent.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (fmMatch) {
    const fm = fmMatch[1];
    articleContent = fmMatch[2].trim();

    const getField = (key: string) => {
      const m = fm.match(new RegExp(`^${key}:\\s*(.+)`, "m"));
      return m ? m[1].trim() : "";
    };

    title = getField("title") || title;
    slug = getField("slug");
    excerpt = getField("excerpt");
    author = getField("author") || author;
    featuredImage = getField("featuredImage");

    // Parse tags: [tag1, tag2] or - tag1
    const tagsMatch = fm.match(/^tags:\s*\[([^\]]+)\]/m);
    if (tagsMatch) {
      tags = tagsMatch[1].split(",").map((t: string) => t.trim());
    }
  } else {
    // No frontmatter — extract from content
    const articleTitleMatch = rawContent.match(/^#\s+(.+)/m);
    if (articleTitleMatch) title = articleTitleMatch[1].trim();

    const paragraphs = rawContent.split(/\n\n+/).filter((p: string) => p.trim() && !p.startsWith("#") && !p.startsWith("!"));
    excerpt = (paragraphs[0] || "")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .slice(0, 300);
  }

  // Generate slug if not in frontmatter
  if (!slug) {
    slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80);
  }

  // Skip pending featured image placeholder
  if (featuredImage.includes("pending")) featuredImage = "";

  // 6. Publish to strattegys.com as draft
  console.log(`[publishToStrattegys] Publishing "${title}" (slug: ${slug}) to ${SITE_API_URL}`);

  const res = await fetch(SITE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-publish-secret": SITE_PUBLISH_SECRET,
    },
    body: JSON.stringify({
      command: "create",
      title,
      slug,
      content: articleContent,
      excerpt,
      author,
      tags,
      ...(featuredImage ? { featureImage: featuredImage } : {}),
    }),
  });

  const data = await res.json();
  console.log(`[publishToStrattegys] Response:`, data);

  if (data.ok || data.slug) {
    const articleUrl = `https://strattegys.com/blog/${data.slug || slug}`;
    return `# Draft Published to Strattegys\n\n**Title:** ${title}\n\n**URL:** [${articleUrl}](${articleUrl})\n\n**Slug:** ${data.slug || slug}\n\n**Excerpt:** ${excerpt}\n\n---\n\nReview the article on the site, then Submit to publish it live.`;
  }

  return `# PUBLISH FAILED\n\nAPI response: ${JSON.stringify(data)}`;
}
