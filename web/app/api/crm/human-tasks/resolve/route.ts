import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { WORKFLOW_TYPES } from "@/lib/workflow-types";

/**
 * POST /api/crm/human-tasks/resolve
 *
 * Resolves a human task: advances the workflow item to the next stage
 * and optionally stores an artifact with the human's input.
 *
 * Body: {
 *   itemId: string,        — workflow item ID
 *   action: "approve" | "reject" | "input",
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
    const { itemId, action, notes, data, nextStage } = await req.json();

    if (!itemId || !action) {
      return NextResponse.json(
        { error: "itemId and action are required" },
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
    const wfTypeId = wfSpec?.workflowType;
    const wfType = wfTypeId ? WORKFLOW_TYPES[wfTypeId] : null;

    // 2. Determine next stage
    let targetStage = nextStage;

    if (!targetStage && wfType) {
      const transitions = wfType.defaultBoard.transitions[item.stage] || [];
      if (action === "reject") {
        // For rejection, go back or to REJECTED if available
        targetStage = transitions.find((s) => s === "REJECTED") ||
          transitions.find((s) => s === "DRAFTING") || // content pipeline: back to drafting
          transitions[transitions.length - 1]; // last option
      } else {
        // approve or input → advance to first valid transition
        targetStage = transitions[0];

        // MESSAGE_DRAFT cycle handling: count how many times this item
        // has been at MESSAGE_DRAFT (by counting MESSAGE_DRAFT artifacts)
        if (item.stage === "MESSAGE_DRAFT") {
          const msgArtifacts = await query<{ id: string }>(
            `SELECT id FROM "_artifact" WHERE "workflowItemId" = $1 AND stage = 'MESSAGE_DRAFT' AND "deletedAt" IS NULL`,
            [itemId]
          );
          const messageCount = msgArtifacts.length + 1; // +1 for current
          if (messageCount >= 3) {
            // After 3 messages, move to ENDED instead of MESSAGED
            targetStage = "ENDED";
          }
        }
      }
    }

    if (!targetStage) {
      // Terminal human stage — soft-delete the item to mark as resolved
      await query(
        `UPDATE "_workflow_item" SET "deletedAt" = NOW() WHERE id = $1`,
        [itemId]
      );

      // Still check for handoffs based on current stage
      const handoffs = await checkHandoffs(item, wf, item.stage);

      return NextResponse.json({
        ok: true,
        itemId,
        previousStage: item.stage,
        newStage: item.stage,
        action,
        terminal: true,
        handoffs,
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

    // 4. Advance the item
    await query(
      `UPDATE "_workflow_item" SET stage = $1, "updatedAt" = NOW() WHERE id = $2 AND "deletedAt" IS NULL`,
      [targetStage, itemId]
    );

    // 5. Auto-generate artifacts for agent-owned stages (simulation)
    await generateStageArtifact(itemId, item.workflowId, targetStage, wfType, wf.name);

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

        // Generate artifact for the current agent stage
        await generateStageArtifact(itemId, item.workflowId, currentStage, wfType, wf.name);

        // Advance
        await query(
          `UPDATE "_workflow_item" SET stage = $1, "updatedAt" = NOW() WHERE id = $2 AND "deletedAt" IS NULL`,
          [nextStageKey, itemId]
        );

        // Generate artifact for the new stage too
        await generateStageArtifact(itemId, item.workflowId, nextStageKey, wfType, wf.name);

        currentStage = nextStageKey;
        finalStage = nextStageKey;
      }
    }

    // 7. Handle message cycling for Tim's outreach (MESSAGE_DRAFT → MESSAGED → MESSAGE_DRAFT, up to 3)
    if (finalStage === "MESSAGED" && wfTypeId === "linkedin-outreach") {
      // Count how many times this item has reached MESSAGED by counting MESSAGE_DRAFT artifacts
      // Subtract 1 because the first artifact is created during auto-advance (before any human approval)
      const draftArtifacts = await query<{ id: string }>(
        `SELECT id FROM "_artifact" WHERE "workflowItemId" = $1 AND stage = 'MESSAGE_DRAFT' AND "deletedAt" IS NULL`,
        [itemId]
      );
      const messageCount = Math.max(0, draftArtifacts.length - 1); // -1 for the initial auto-created artifact

      if (messageCount >= 3) {
        // 3 messages sent — move to ENDED
        await query(
          `UPDATE "_workflow_item" SET stage = $1, "updatedAt" = NOW() WHERE id = $2 AND "deletedAt" IS NULL`,
          ["ENDED", itemId]
        );
        finalStage = "ENDED";
        autoAdvances.push("MESSAGED → ENDED (3 messages sent)");
      } else {
        // Cycle back to MESSAGE_DRAFT for next follow-up
        await query(
          `UPDATE "_workflow_item" SET stage = $1, "updatedAt" = NOW() WHERE id = $2 AND "deletedAt" IS NULL`,
          ["MESSAGE_DRAFT", itemId]
        );
        await generateStageArtifact(itemId, item.workflowId, "MESSAGE_DRAFT", wfType, wf.name);
        finalStage = "MESSAGE_DRAFT";
        autoAdvances.push(`MESSAGED → MESSAGE_DRAFT (message ${messageCount + 1}/3)`);
      }
    }

    // 8. Check for cross-workflow handoffs (use final stage after auto-advances)
    const handoffs = await checkHandoffs(item, wf, finalStage);

    // 9. When a Tim item reaches ENDED, check if all active items are done
    // Note: INITIATED items stay at CR Sent permanently — they represent
    // connection requests that were never accepted. No auto-expiry.

    return NextResponse.json({
      ok: true,
      itemId,
      previousStage: item.stage,
      newStage: finalStage,
      action,
      autoAdvances: autoAdvances.length > 0 ? autoAdvances : undefined,
      handoffs,
    });
  } catch (error) {
    console.error("[resolve] error:", error);
    return NextResponse.json({ error: "Failed to resolve task" }, { status: 500 });
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
  wf: { id: string; packageId: string | null; ownerAgent: string },
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
          await generateStageArtifact(postItemId, sibling.id, "POST_DRAFTED", distType, sibling.name);
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
          await generateStageArtifact(newItemId, sibling.id, "INITIATED", outreachType, sibling.name);
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
  workflowName: string
): Promise<string> {
  await generateStageArtifact(itemId, workflowId, startStage, wfType, workflowName);

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

    await generateStageArtifact(itemId, workflowId, currentStage, wfType, workflowName);
    await query(
      `UPDATE "_workflow_item" SET stage = $1, "updatedAt" = NOW() WHERE id = $2 AND "deletedAt" IS NULL`,
      [nextStageKey, itemId]
    );
    await generateStageArtifact(itemId, workflowId, nextStageKey, wfType, workflowName);
    currentStage = nextStageKey;
  }

  return currentStage;
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
  workflowName: string
) {
  if (!wfType) return;

  // Map of stage keys to artifact generators
  const ARTIFACT_MAP: Record<string, { name: string; content: string } | null> = {
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
  const ALLOW_MULTIPLE_STAGES = new Set(["MESSAGE_DRAFT"]);
  if (!ALLOW_MULTIPLE_STAGES.has(stage)) {
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
