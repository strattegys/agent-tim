import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { WORKFLOW_TYPES } from "@/lib/workflow-types";
import { syncHumanTaskOpenForItem } from "@/lib/workflow-item-human-task";

/**
 * POST /api/crm/packages/simulate
 *
 * Full E2E simulation: advances ALL items through their entire lifecycle,
 * auto-accepting human stages, triggering cross-workflow handoffs,
 * and respecting connection rates and Scout stop conditions.
 *
 * Connection rate: 80% stay at CR Sent (INITIATED), 20% accepted
 * Scout stops: when Tim has 20 ENDED sequences
 *
 * Body: { packageId: string }
 */

export async function POST(req: NextRequest) {
  try {
    const { packageId } = await req.json();
    if (!packageId) {
      return NextResponse.json({ error: "packageId is required" }, { status: 400 });
    }

    const log: string[] = [];
    const MAX_ITERATIONS = 200; // safety valve
    let iteration = 0;

    // Run iterations until nothing advances
    while (iteration < MAX_ITERATIONS) {
      iteration++;
      let advanced = 0;

      // Re-fetch workflows each iteration (new ones may have been created by handoffs)
      const workflows = await query<{
        id: string;
        name: string;
        ownerAgent: string;
        spec: string | { workflowType?: string; targetCount?: number; pacing?: { batchSize?: number; interval?: string; bufferPercent?: number } };
        itemType: string;
        packageId: string | null;
      }>(
        `SELECT id, name, "ownerAgent", spec, "itemType", "packageId"
         FROM "_workflow"
         WHERE "packageId" = $1 AND "deletedAt" IS NULL`,
        [packageId]
      );

      for (const wf of workflows) {
        const wfSpec = typeof wf.spec === "string" ? JSON.parse(wf.spec) : wf.spec;
        const wfTypeId = wfSpec?.workflowType;
        const wfType = wfTypeId ? WORKFLOW_TYPES[wfTypeId] : null;
        if (!wfType) continue;

        // Get all live items
        const items = await query<{
          id: string;
          stage: string;
          sourceType: string;
          sourceId: string;
        }>(
          `SELECT id, stage, "sourceType", "sourceId"
           FROM "_workflow_item"
           WHERE "workflowId" = $1 AND "deletedAt" IS NULL`,
          [wf.id]
        );

        for (const item of items) {
          const stageSpec = wfType.defaultBoard.stages.find(
            (s: { key: string }) => s.key === item.stage
          );
          if (!stageSpec) continue;

          // Terminal stages — skip
          const transitions = wfType.defaultBoard.transitions[item.stage] || [];
          if (transitions.length === 0) continue;

          // INITIATED items in linkedin-outreach = CR Sent, they stay there (80% rejection)
          if (item.stage === "INITIATED" && wfTypeId === "linkedin-outreach") continue;

          // Generate artifact for current stage
          await generateStageArtifact(item.id, wf.id, item.stage, wfType, wf.name);

          // Determine next stage
          let nextStage: string;

          if (stageSpec.requiresHuman) {
            // Auto-accept: take first forward transition
            nextStage = transitions[0];

            // MESSAGE_DRAFT cycling: count existing MESSAGE_DRAFT artifacts
            if (item.stage === "MESSAGE_DRAFT" && wfTypeId === "linkedin-outreach") {
              const msgArtifacts = await query<{ id: string }>(
                `SELECT id FROM "_artifact" WHERE "workflowItemId" = $1 AND stage = 'MESSAGE_DRAFT' AND "deletedAt" IS NULL`,
                [item.id]
              );
              if (msgArtifacts.length >= 3) {
                // After 3 messages, move to ENDED
                nextStage = "ENDED";
              }
            }
          } else {
            // Agent stage — advance to first forward transition
            nextStage = transitions[0];
          }

          if (!nextStage || nextStage === item.stage) continue;

          // Advance the item
          await query(
            `UPDATE "_workflow_item" SET stage = $1, "updatedAt" = NOW() WHERE id = $2 AND "deletedAt" IS NULL`,
            [nextStage, item.id]
          );
          await syncHumanTaskOpenForItem(item.id);
          await generateStageArtifact(item.id, wf.id, nextStage, wfType, wf.name);
          log.push(`${wf.name}: ${item.stage} → ${nextStage}`);
          advanced++;

          // Handle MESSAGED cycling → MESSAGE_DRAFT (up to 3)
          if (nextStage === "MESSAGED" && wfTypeId === "linkedin-outreach") {
            const draftArtifacts = await query<{ id: string }>(
              `SELECT id FROM "_artifact" WHERE "workflowItemId" = $1 AND stage = 'MESSAGE_DRAFT' AND "deletedAt" IS NULL`,
              [item.id]
            );
            const messageCount = Math.max(0, draftArtifacts.length - 1);
            if (messageCount >= 3) {
              await query(
                `UPDATE "_workflow_item" SET stage = 'ENDED', "updatedAt" = NOW() WHERE id = $1 AND "deletedAt" IS NULL`,
                [item.id]
              );
              await syncHumanTaskOpenForItem(item.id);
              log.push(`${wf.name}: MESSAGED → ENDED (3 messages sent)`);
            } else {
              await query(
                `UPDATE "_workflow_item" SET stage = 'MESSAGE_DRAFT', "updatedAt" = NOW() WHERE id = $1 AND "deletedAt" IS NULL`,
                [item.id]
              );
              await syncHumanTaskOpenForItem(item.id);
              await generateStageArtifact(item.id, wf.id, "MESSAGE_DRAFT", wfType, wf.name);
              log.push(`${wf.name}: MESSAGED → MESSAGE_DRAFT (msg ${messageCount + 1}/3)`);
            }
          }

          // Check for cross-workflow handoffs
          const handoffs = await checkHandoffs(
            { id: item.id, workflowId: wf.id, sourceType: item.sourceType, sourceId: item.sourceId },
            wf,
            nextStage,
            workflows
          );
          for (const h of handoffs) {
            log.push(`  ↳ Handoff: ${h.targetWorkflow} → ${h.stage}`);
            advanced++;
          }
        }
      }

      // Nothing advanced → we're done
      if (advanced === 0) break;
    }

    // Build final summary
    const finalWorkflows = await query<{
      id: string;
      name: string;
      spec: string | { workflowType?: string };
    }>(
      `SELECT id, name, spec FROM "_workflow" WHERE "packageId" = $1 AND "deletedAt" IS NULL`,
      [packageId]
    );

    const summary: Record<string, Record<string, number>> = {};
    for (const wf of finalWorkflows) {
      const items = await query<{ stage: string }>(
        `SELECT stage FROM "_workflow_item" WHERE "workflowId" = $1 AND "deletedAt" IS NULL`,
        [wf.id]
      );
      const counts: Record<string, number> = {};
      for (const item of items) {
        counts[item.stage] = (counts[item.stage] || 0) + 1;
      }
      summary[wf.name] = counts;
    }

    return NextResponse.json({
      ok: true,
      iterations: iteration,
      log,
      summary,
    });
  } catch (error) {
    console.error("[simulate] error:", error);
    return NextResponse.json({ error: "Failed to simulate" }, { status: 500 });
  }
}

// ─── Handoff Logic ─────────────────────────────────────────────────

interface WorkflowRow {
  id: string;
  name: string;
  ownerAgent: string;
  spec: string | { workflowType?: string; targetCount?: number; pacing?: { batchSize?: number; interval?: string; bufferPercent?: number } };
  itemType: string;
  packageId: string | null;
}

async function checkHandoffs(
  item: { id: string; workflowId: string; sourceType: string; sourceId: string },
  wf: WorkflowRow,
  newStage: string,
  allWorkflows: WorkflowRow[]
): Promise<Array<{ targetWorkflow: string; stage: string }>> {
  if (!wf.packageId) return [];
  const handoffs: Array<{ targetWorkflow: string; stage: string }> = [];

  const siblings = allWorkflows.filter(w => w.id !== wf.id);
  const wfSpec = typeof wf.spec === "string" ? JSON.parse(wf.spec) : wf.spec;

  for (const sibling of siblings) {
    const sibSpec = typeof sibling.spec === "string" ? JSON.parse(sibling.spec) : sibling.spec;
    const sibType = sibSpec?.workflowType;

    // ── Content PUBLISHED → Content Distribution ──
    if (newStage === "PUBLISHED" && sibType === "content-distribution") {
      const distType = WORKFLOW_TYPES["content-distribution"];
      const targetCount = sibSpec?.targetCount || 3;

      // 1. Connection request message
      const connCi = await query<{ id: string }>(
        `INSERT INTO "_content_item" (title, description, "contentType", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, NOW(), NOW()) RETURNING id`,
        ["Connection Request Message", "Template for LinkedIn connection requests", "connection-message"]
      );
      const connContentId = (connCi[0] as Record<string, unknown>)?.id as string;

      const connItem = await query<{ id: string }>(
        `INSERT INTO "_workflow_item" ("workflowId", stage, "sourceType", "sourceId", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING id`,
        [sibling.id, "RECEIVED", "content", connContentId]
      );
      if (connItem[0]?.id && distType) {
        await autoAdvanceItem(connItem[0].id, sibling.id, "RECEIVED", distType, sibling.name);
      }

      // 2. LinkedIn posts
      const POST_ANGLES = [
        { title: "LinkedIn Post #1 — Data Hook", angle: "78% stat" },
        { title: "LinkedIn Post #2 — Case Study", angle: "CloudScale results" },
        { title: "LinkedIn Post #3 — Hot Take", angle: "B2B influencer imperative" },
      ];

      for (let i = 0; i < targetCount; i++) {
        const info = POST_ANGLES[i] || { title: `LinkedIn Post #${i + 1}`, angle: "Campaign content" };
        const ci = await query<{ id: string }>(
          `INSERT INTO "_content_item" (title, description, "contentType", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, NOW(), NOW()) RETURNING id`,
          [info.title, info.angle, "linkedin-post"]
        );
        const contentId = (ci[0] as Record<string, unknown>)?.id as string;
        const ins = await query<{ id: string }>(
          `INSERT INTO "_workflow_item" ("workflowId", stage, "sourceType", "sourceId", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING id`,
          [sibling.id, "POST_DRAFTED", "content", contentId]
        );
        if (ins[0]?.id) {
          await generateStageArtifact(ins[0].id, sibling.id, "POST_DRAFTED", WORKFLOW_TYPES["content-distribution"], sibling.name);
        }
      }
      handoffs.push({ targetWorkflow: sibling.name, stage: `CONN_MSG + ${targetCount} posts` });
    }

    // ── Content PUBLISHED → Target Research: first batch ──
    if (newStage === "PUBLISHED" && sibType === "research-pipeline") {
      const resType = WORKFLOW_TYPES["research-pipeline"];
      const targetCount = sibSpec?.targetCount || 20;
      const batchSize = sibSpec?.pacing?.batchSize || 5;
      const bufferPercent = sibSpec?.pacing?.bufferPercent || 25;
      const totalToSource = Math.ceil(targetCount * (1 + bufferPercent / 100));
      const firstBatch = Math.min(batchSize, totalToSource);

      for (let i = 0; i < firstBatch; i++) {
        const person = SIMULATED_PEOPLE[i % SIMULATED_PEOPLE.length];
        const pRows = await query<{ id: string }>(
          `INSERT INTO person ("nameFirstName", "nameLastName", "jobTitle", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, NOW(), NOW()) RETURNING id`,
          [person.first, person.last, `${person.title} at ${person.company}`]
        );
        const personId = (pRows[0] as Record<string, unknown>)?.id as string;
        const ins = await query<{ id: string }>(
          `INSERT INTO "_workflow_item" ("workflowId", stage, "sourceType", "sourceId", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING id`,
          [sibling.id, "FINDING", "person", personId]
        );
        if (ins[0]?.id && resType) {
          await autoAdvanceItem(ins[0].id, sibling.id, "FINDING", resType, sibling.name);
        }
      }
      handoffs.push({ targetWorkflow: sibling.name, stage: `${firstBatch} targets created` });
    }

    // ── Research HANDED_OFF → LinkedIn Outreach (20% acceptance) ──
    if (newStage === "HANDED_OFF" && sibType === "linkedin-outreach") {
      const outreachType = WORKFLOW_TYPES["linkedin-outreach"];

      // Count existing items to determine acceptance rate
      const existingItems = await query<{ id: string }>(
        `SELECT id FROM "_workflow_item" WHERE "workflowId" = $1 AND "deletedAt" IS NULL`,
        [sibling.id]
      );
      const itemIndex = existingItems.length + 1;
      const accepted = (itemIndex % 5) === 0; // Every 5th = 20% acceptance

      const startStage = accepted ? "TARGET" : "INITIATED";
      const ins = await query<{ id: string }>(
        `INSERT INTO "_workflow_item" ("workflowId", stage, "sourceType", "sourceId", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING id`,
        [sibling.id, startStage, item.sourceType, item.sourceId]
      );
      const newItemId = ins[0]?.id;

      if (newItemId && outreachType) {
        if (accepted) {
          // Advance TARGET → INITIATED → ACCEPTED → MESSAGE_DRAFT
          const finalStage = await autoAdvanceItem(newItemId, sibling.id, "TARGET", outreachType, sibling.name);
          handoffs.push({ targetWorkflow: sibling.name, stage: `${finalStage} (CR accepted)` });
        } else {
          // CR Sent — stays at INITIATED permanently
          await generateStageArtifact(newItemId, sibling.id, "INITIATED", outreachType, sibling.name);
          handoffs.push({ targetWorkflow: sibling.name, stage: "INITIATED (CR pending)" });
        }
      }
    }
  }

  // ── Scout next-batch trigger ──
  // After HANDED_OFF in research-pipeline: if no more pending items, create next batch
  if (newStage === "HANDED_OFF" && wfSpec?.workflowType === "research-pipeline") {
    const pendingItems = await query<{ id: string }>(
      `SELECT id FROM "_workflow_item"
       WHERE "workflowId" = $1 AND stage IN ('FINDING', 'ENRICHING', 'QUALIFICATION') AND "deletedAt" IS NULL`,
      [wf.id]
    );

    if (pendingItems.length === 0) {
      // Check Tim's ENDED count
      const timWorkflow = siblings.find(s => {
        const spec = typeof s.spec === "string" ? JSON.parse(s.spec) : s.spec;
        return spec?.workflowType === "linkedin-outreach";
      });

      let timEndedCount = 0;
      if (timWorkflow) {
        const allTimItems = await query<{ stage: string }>(
          `SELECT stage FROM "_workflow_item" WHERE "workflowId" = $1 AND "deletedAt" IS NULL`,
          [timWorkflow.id]
        );
        timEndedCount = allTimItems.filter(i => i.stage === "ENDED").length;
      }

      if (timEndedCount < 20) {
        // Create next batch of 5
        const resType = WORKFLOW_TYPES["research-pipeline"];
        const existingItems = await query<{ id: string }>(
          `SELECT id FROM "_workflow_item" WHERE "workflowId" = $1 AND "deletedAt" IS NULL`,
          [wf.id]
        );
        const offset = existingItems.length;

        for (let i = 0; i < 5; i++) {
          const person = SIMULATED_PEOPLE[(offset + i) % SIMULATED_PEOPLE.length];
          const pRows = await query<{ id: string }>(
            `INSERT INTO person ("nameFirstName", "nameLastName", "jobTitle", "createdAt", "updatedAt")
             VALUES ($1, $2, $3, NOW(), NOW()) RETURNING id`,
            [person.first, person.last, `${person.title} at ${person.company}`]
          );
          const personId = (pRows[0] as Record<string, unknown>)?.id as string;
          const ins = await query<{ id: string }>(
            `INSERT INTO "_workflow_item" ("workflowId", stage, "sourceType", "sourceId", "createdAt", "updatedAt")
             VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING id`,
            [wf.id, "FINDING", "person", personId]
          );
          if (ins[0]?.id && resType) {
            await autoAdvanceItem(ins[0].id, wf.id, "FINDING", resType, wf.name);
          }
        }
        handoffs.push({ targetWorkflow: wf.name, stage: "Next batch: 5 new targets" });
      } else {
        handoffs.push({ targetWorkflow: wf.name, stage: "Scout stopped — Tim has 20+ ended" });
      }
    }
  }

  return handoffs;
}

// ─── Helpers ─────────────────────────────────────────────────

const SIMULATED_PEOPLE = [
  { first: "Sarah", last: "Chen", title: "VP Marketing", company: "CloudScale" },
  { first: "Marcus", last: "Johnson", title: "Dir. Content", company: "DataFlow" },
  { first: "Elena", last: "Rodriguez", title: "Growth Lead", company: "SecureNet" },
  { first: "James", last: "Park", title: "CMO", company: "TechVenture" },
  { first: "Priya", last: "Sharma", title: "VP Demand Gen", company: "SaaSMetrics" },
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

/**
 * Auto-advance an item through non-human stages, generating artifacts.
 * Stops at first human-required stage or terminal stage.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    // Pick forward transition
    const nextStageKey =
      nextTransitions.find((t: string) => {
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
    await syncHumanTaskOpenForItem(itemId);
    await generateStageArtifact(itemId, workflowId, nextStageKey, wfType, workflowName);
    currentStage = nextStageKey;
  }

  return currentStage;
}

/**
 * Generate simulated artifact for a stage.
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

  const ARTIFACT_MAP: Record<string, { name: string; content: string } | null> = {
    DRAFTING: {
      name: "Article Draft",
      content: `# Article Draft: ${workflowName}\n\n## Introduction\nIn the rapidly evolving landscape of B2B marketing, influencer partnerships have emerged as a key differentiator.\n\n## Key Points\n- 78% of B2B buyers trust peer recommendations over vendor content\n- Companies using influencer partnerships see 3.2x more qualified demos\n- Long-term partnerships outperform transactional sponsorships\n\n---\n*Draft generated by Ghost — ready for human review*`,
    },
    FINDING: {
      name: "Target Discovery Report",
      content: `# Target Discovery Report\n\nFound 5 potential targets matching campaign criteria.\n\n---\n*Report generated by Scout*`,
    },
    ENRICHING: {
      name: "Enriched Target Profile",
      content: `# Enriched Target Profile\n\nProfile enriched with LinkedIn activity, mutual connections, and conversation starters.\n\n---\n*Profile enriched by Scout*`,
    },
    QUALIFICATION: {
      name: "Qualification Summary",
      content: `# Qualification Summary\n\nTarget scored 4/5 on ICP match. Recommended for handoff to Tim.\n\n---\n*Qualification prepared by Scout — awaiting human review*`,
    },
    POST_DRAFTED: {
      name: "LinkedIn Post Draft",
      content: `# LinkedIn Post Draft\n\n78% of B2B buyers trust peer recommendations over vendor content. The playbook is changing.\n\n---\n*Post drafted by Marni — approve to publish*`,
    },
    POSTED: {
      name: "LinkedIn Post Published",
      content: `# LinkedIn Post — Published\n\nStatus: LIVE\n\n---\n*Post published*`,
    },
    MESSAGE_DRAFT: {
      name: "Outreach Message Draft",
      content: `# Outreach Message — Ready for Review\n\nHi [Name],\n\nI noticed your recent work — really resonated with challenges we've been exploring.\n\nWe published research on B2B influencer partnerships I think you'd find interesting.\n\nBest,\nGovind\n\n---\n*Message drafted by Tim*`,
    },
    CONN_MSG_DRAFTED: {
      name: "Connection Request Template",
      content: `# Connection Request Message Template\n\nHi {firstName}, I recently published research on B2B influencer partnerships. Given your work at {company}, I think you'd find the data relevant. Would love to connect.\n\n---\n*Template drafted by Marni — awaiting approval*`,
    },
    DRAFT_PUBLISHED: {
      name: "Publication Details",
      content: `# Publication Details\n\nArticle published to blog.\n\n---\n*Publication confirmed — downstream workflows unblocked*`,
    },
    PUBLISHED: {
      name: "Published Article Record",
      content: `# Published Article — Final Record\n\nStatus: LIVE. Downstream workflows triggered.\n\n---\n*Final output of Article Creation workflow*`,
    },
  };

  const artifact = ARTIFACT_MAP[stage];
  if (!artifact) return;

  const ALLOW_MULTIPLE = new Set(["MESSAGE_DRAFT"]);
  if (!ALLOW_MULTIPLE.has(stage)) {
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
