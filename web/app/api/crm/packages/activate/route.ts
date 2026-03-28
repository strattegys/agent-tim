import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { WORKFLOW_TYPES } from "@/lib/workflow-types";
import { PACKAGE_TEMPLATES } from "@/lib/package-types";
import { insertPackageBriefArtifactIfPresent } from "@/lib/package-brief-artifact";
import { createTask } from "@/lib/tasks";
import { syncHumanTaskOpenForItem } from "@/lib/workflow-item-human-task";
import { WARM_OUTREACH_PLACEHOLDER_JOB_TITLE } from "@/lib/warm-outreach-researching-guard";
import { WARM_DISCOVERY_SOURCE_TYPE } from "@/lib/warm-discovery-item";
import {
  packageStageDisallowsFakeData,
  stripUseFakeDataFromPackageSpec,
} from "@/lib/package-use-fake-data";
import { notifyDashboardSyncChange } from "@/lib/dashboard-sync-hub";

/**
 * POST /api/crm/packages/activate
 *
 * Activates a package: creates workflows + boards + initial items
 * for each deliverable in the package spec.
 *
 * Body: { packageId: string, targetStage?, skipTasks?, useFakeData? }
 * useFakeData: only written to package spec when sent as a boolean (Start Test / Activate from Penny).
 * Omitting it preserves the existing spec flag so Activate does not force fake LLM artifacts.
 *
 * Steps:
 * 1. Load the package and its spec.deliverables
 * 2. For each deliverable, create a _board from the workflow type template
 * 3. Create a _workflow linked to the board and package
 * 4. Create initial workflow items at the first stage
 * 5. Update the package stage to ACTIVE
 * 6. Return the created workflow IDs
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const packageId = body.packageId as string | undefined;
    const targetStage = (body.targetStage as string | undefined) ?? "ACTIVE";
    const skipTasks = Boolean(body.skipTasks);
    const useFakeDataBody =
      typeof body.useFakeData === "boolean" ? body.useFakeData : undefined;
    if (!packageId) {
      return NextResponse.json({ error: "packageId is required" }, { status: 400 });
    }

    // 1. Load the package
    const pkgRows = await query<{
      id: string;
      name: string;
      templateId: string;
      stage: string;
      spec: { templateId?: string; deliverables: Array<{ workflowType: string; ownerAgent: string; targetCount: number; label: string; pacing?: { batchSize: number; interval: string; bufferPercent?: number } }> };
    }>(
      `SELECT id, name, "templateId", stage, spec FROM "_package" WHERE id = $1 AND "deletedAt" IS NULL`,
      [packageId]
    );

    if (pkgRows.length === 0) {
      return NextResponse.json({ error: "Package not found" }, { status: 404 });
    }

    const pkg = pkgRows[0];

    // skipTasks: just move stage, don't create workflows/tasks
    if (skipTasks) {
      await query(`UPDATE "_package" SET stage = $1, "updatedAt" = NOW() WHERE id = $2`, [targetStage, packageId]);
      if (packageStageDisallowsFakeData(targetStage)) {
        await stripUseFakeDataFromPackageSpec(packageId);
      }
      const activationLog = [
        `[${new Date().toISOString()}] Testing mode: stage → ${targetStage}, no workflows created (skipTasks)`,
      ];
      notifyDashboardSyncChange();
      return NextResponse.json({ ok: true, packageId, workflows: [], activationLog });
    }

    const spec =
      typeof pkg.spec === "string" ? JSON.parse(pkg.spec) : { ...pkg.spec };

    // Persist useFakeData only when Penny sends it — avoids Activate overwriting with "true" by default
    if (useFakeDataBody !== undefined) {
      spec.useFakeData = useFakeDataBody;
      await query(
        `UPDATE "_package" SET spec = $1, "updatedAt" = NOW() WHERE id = $2`,
        [JSON.stringify(spec), packageId]
      );
    }

    // If workflows already exist (re-activation from PENDING_APPROVAL → ACTIVE), just update stage
    const existingWfs = await query<{ id: string; name: string; ownerAgent: string }>(
      `SELECT id, name, "ownerAgent" FROM "_workflow" WHERE "packageId" = $1 AND "deletedAt" IS NULL`,
      [packageId]
    );
    if (existingWfs.length > 0) {
      await query(`UPDATE "_package" SET stage = $1, "updatedAt" = NOW() WHERE id = $2`, [targetStage, packageId]);
      if (packageStageDisallowsFakeData(targetStage)) {
        await stripUseFakeDataFromPackageSpec(packageId);
      }
      const activationLog = [
        `[${new Date().toISOString()}] Re-activate: ${existingWfs.length} existing workflow(s), stage → ${targetStage}`,
        ...existingWfs.map(
          (w) =>
            `[${new Date().toISOString()}]   → ${w.name} (${w.ownerAgent}) id ${w.id.slice(0, 8)}…`
        ),
      ];
      notifyDashboardSyncChange();
      return NextResponse.json({
        ok: true,
        packageId,
        workflows: existingWfs.map(w => ({ workflowId: w.id, boardId: "", label: w.name, ownerAgent: w.ownerAgent })),
        activationLog,
      });
    }

    // Use template deliverables as the authoritative source
    const template = PACKAGE_TEMPLATES[spec?.templateId || pkg.templateId || ""] || Object.values(PACKAGE_TEMPLATES)[0];
    const deliverables = template?.deliverables || spec?.deliverables || [];

    if (deliverables.length === 0) {
      return NextResponse.json({ error: "Package has no deliverables" }, { status: 400 });
    }

    const createdWorkflows: Array<{ workflowId: string; boardId: string; label: string; ownerAgent: string }> = [];
    const activationLog: string[] = [];
    const logAct = (line: string) => {
      activationLog.push(`[${new Date().toISOString()}] ${line}`);
    };
    logAct(
      `Activate: package "${pkg.name}" (${packageId.slice(0, 8)}…) → ${targetStage}, useFakeData=${spec.useFakeData === true}`
    );

    // 2-4. For each deliverable, create board + workflow + initial item
    for (const deliverable of deliverables) {
      const wfType = WORKFLOW_TYPES[deliverable.workflowType];
      if (!wfType) {
        console.warn(`[activate] Unknown workflow type: ${deliverable.workflowType}`);
        logAct(`SKIP deliverable "${deliverable.label}": unknown workflowType ${deliverable.workflowType}`);
        continue;
      }

      logAct(`Deliverable "${deliverable.label}" → type ${deliverable.workflowType}, owner ${deliverable.ownerAgent}, targetCount ${deliverable.targetCount}`);

      // 2. Create the board from the template
      const boardRows = await query<{ id: string }>(
        `INSERT INTO "_board" (name, description, stages, transitions, "createdAt", "updatedAt")
         VALUES ($1, $2, $3::jsonb, $4::jsonb, NOW(), NOW())
         RETURNING id`,
        [
          `${pkg.name} — ${deliverable.label}`,
          wfType.description,
          JSON.stringify(wfType.defaultBoard.stages),
          JSON.stringify(wfType.defaultBoard.transitions),
        ]
      );
      const boardId = (boardRows[0] as Record<string, unknown>).id as string;
      logAct(`Board created: ${boardId.slice(0, 8)}… (${deliverable.label})`);

      const firstStage = wfType.defaultBoard.stages[0];

      // 3. Create the workflow
      const wfRows = await query<{ id: string }>(
        `INSERT INTO "_workflow" (name, spec, "itemType", "boardId", "ownerAgent", "packageId", stage, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', NOW(), NOW())
         RETURNING id`,
        [
          deliverable.label,
          JSON.stringify({ targetCount: deliverable.targetCount, workflowType: deliverable.workflowType, pacing: deliverable.pacing || null }),
          wfType.itemType,
          boardId,
          deliverable.ownerAgent,
          packageId,
        ]
      );
      const workflowId = (wfRows[0] as Record<string, unknown>).id as string;
      logAct(`Workflow created: ${workflowId.slice(0, 8)}… firstStage=${firstStage.key}`);

      // 4. Create initial workflow item(s) at the first stage
      if (wfType.itemType === "content") {
        // Create a content item and link it
        const contentTitleBase =
          pkg.name && String(pkg.name).trim() ? String(pkg.name).trim() : deliverable.label;
        const ciRows = await query<{ id: string }>(
          `INSERT INTO "_content_item" (title, description, "contentType", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, NOW(), NOW())
           RETURNING id`,
          [
            `${contentTitleBase} — Draft`,
            `Auto-created from package: ${pkg.name}`,
            "article",
          ]
        );
        const contentId = (ciRows[0] as Record<string, unknown>).id as string;

        const wiRows = await query<{ id: string }>(
          `INSERT INTO "_workflow_item" ("workflowId", stage, "sourceType", "sourceId", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, NOW(), NOW())
           RETURNING id`,
          [workflowId, firstStage.key, "content", contentId]
        );
        const itemId = (wiRows[0] as Record<string, unknown>).id as string;
        await syncHumanTaskOpenForItem(itemId);

        // IDEA stage: no artifact — human pastes their idea via the task input,
        // then Ghost builds the content brief in CAMPAIGN_SPEC stage.
      } else if (wfType.itemType === "person" && firstStage.requiresHuman) {
        let itemId: string;
        if (deliverable.workflowType === "warm-outreach") {
          const slotId = randomUUID();
          const wiRows = await query<{ id: string }>(
            `INSERT INTO "_workflow_item" ("workflowId", stage, "sourceType", "sourceId", "createdAt", "updatedAt")
             VALUES ($1, $2, $3, $4, NOW(), NOW())
             RETURNING id`,
            [workflowId, firstStage.key, WARM_DISCOVERY_SOURCE_TYPE, slotId]
          );
          itemId = (wiRows[0] as Record<string, unknown>).id as string;
          await insertPackageBriefArtifactIfPresent(itemId, workflowId, packageId);
          logAct(
            `Warm-outreach: discovery slot ${itemId.slice(0, 8)}… at ${firstStage.key} (no CRM person until intake)`
          );
        } else {
          const pRows = await query<{ id: string }>(
            `INSERT INTO person ("nameFirstName", "nameLastName", "jobTitle", "createdAt", "updatedAt")
             VALUES ($1, $2, $3, NOW(), NOW())
             RETURNING id`,
            ["Next", "Contact", WARM_OUTREACH_PLACEHOLDER_JOB_TITLE]
          );
          const personId = (pRows[0] as Record<string, unknown>).id as string;
          const wiRows = await query<{ id: string }>(
            `INSERT INTO "_workflow_item" ("workflowId", stage, "sourceType", "sourceId", "createdAt", "updatedAt")
             VALUES ($1, $2, 'person', $3, NOW(), NOW())
             RETURNING id`,
            [workflowId, firstStage.key, personId]
          );
          itemId = (wiRows[0] as Record<string, unknown>).id as string;
        }
        await syncHumanTaskOpenForItem(itemId);
      }
      // Other person-type workflows: items added by agents (e.g. Scout → Tim cold outreach)

      createdWorkflows.push({
        workflowId,
        boardId,
        label: deliverable.label,
        ownerAgent: deliverable.ownerAgent,
      });
    }

    // 5. Update the package stage
    await query(
      `UPDATE "_package" SET stage = $1, "updatedAt" = NOW() WHERE id = $2`,
      [targetStage, packageId]
    );
    if (packageStageDisallowsFakeData(targetStage)) {
      await stripUseFakeDataFromPackageSpec(packageId);
    }

    // 6. Trigger the first task for each deliverable's owner agent
    if (targetStage === "PENDING_APPROVAL" || targetStage === "ACTIVE") {
      for (const wf of createdWorkflows) {
        const deliverable = deliverables.find((d: { label: string }) => d.label === wf.label);
        if (!deliverable) continue;
        const wfType = WORKFLOW_TYPES[deliverable.workflowType];
        if (!wfType) continue;
        const firstStage = wfType.defaultBoard.stages[0];

        // Load the campaign spec for context
        const specRows = await query<{ brief: string }>(
          `SELECT (spec->>'brief') as brief FROM "_package" WHERE id = $1`,
          [packageId]
        );
        const brief = specRows[0]?.brief || "";

        const taskDescription = [
          `Package "${pkg.name}" has entered testing. Your deliverable "${wf.label}" is ready to begin.`,
          `Workflow ID: ${wf.workflowId}`,
          `First stage: ${firstStage.label} — ${firstStage.instructions}`,
          brief ? `Campaign spec: ${brief}` : "",
          `Please start working on this deliverable. Use your workflow_items tool to manage items in this workflow.`,
        ].filter(Boolean).join("\n");

        createTask("penny", wf.ownerAgent, taskDescription, "async");
        logAct(`Agent task queued: ${wf.ownerAgent} for workflow ${wf.workflowId.slice(0, 8)}… (${wf.label})`);
      }
    }

    logAct(`Done: package stage=${targetStage}, ${createdWorkflows.length} workflow(s)`);

    notifyDashboardSyncChange();
    return NextResponse.json({
      ok: true,
      packageId,
      workflows: createdWorkflows,
      activationLog,
    });
  } catch (error) {
    console.error("[activate] error:", error);
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Failed to activate package", detail: msg, activationLog: [`[${new Date().toISOString()}] ERROR: ${msg}`] },
      { status: 500 }
    );
  }
}
