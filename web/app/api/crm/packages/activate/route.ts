import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { WORKFLOW_TYPES } from "@/lib/workflow-types";
import { PACKAGE_TEMPLATES } from "@/lib/package-types";

/**
 * POST /api/crm/packages/activate
 *
 * Activates a package: creates workflows + boards + initial items
 * for each deliverable in the package spec.
 *
 * Body: { packageId: string }
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
    const { packageId, targetStage = "ACTIVE" } = await req.json();
    if (!packageId) {
      return NextResponse.json({ error: "packageId is required" }, { status: 400 });
    }

    // 1. Load the package
    const pkgRows = await query<{
      id: string;
      name: string;
      stage: string;
      spec: { deliverables: Array<{ workflowType: string; ownerAgent: string; targetCount: number; label: string; pacing?: { batchSize: number; interval: string; bufferPercent?: number } }> };
    }>(
      `SELECT id, name, stage, spec FROM "_package" WHERE id = $1 AND "deletedAt" IS NULL`,
      [packageId]
    );

    if (pkgRows.length === 0) {
      return NextResponse.json({ error: "Package not found" }, { status: 404 });
    }

    const pkg = pkgRows[0];

    // If workflows already exist (re-activation from PENDING_APPROVAL → ACTIVE), just update stage
    const existingWfs = await query<{ id: string; name: string; ownerAgent: string }>(
      `SELECT id, name, "ownerAgent" FROM "_workflow" WHERE "packageId" = $1 AND "deletedAt" IS NULL`,
      [packageId]
    );
    if (existingWfs.length > 0) {
      await query(`UPDATE "_package" SET stage = $1, "updatedAt" = NOW() WHERE id = $2`, [targetStage, packageId]);
      return NextResponse.json({
        ok: true,
        packageId,
        workflows: existingWfs.map(w => ({ workflowId: w.id, boardId: "", label: w.name, ownerAgent: w.ownerAgent })),
      });
    }

    // Use template deliverables as the authoritative source (order, pacing, blockedBy all reference template positions)
    const spec = typeof pkg.spec === "string" ? JSON.parse(pkg.spec) : pkg.spec;
    const template = PACKAGE_TEMPLATES[spec?.templateId || pkg.templateId || ""] || Object.values(PACKAGE_TEMPLATES)[0];
    const deliverables = template?.deliverables || spec?.deliverables || [];

    if (deliverables.length === 0) {
      return NextResponse.json({ error: "Package has no deliverables" }, { status: 400 });
    }

    const createdWorkflows: Array<{ workflowId: string; boardId: string; label: string; ownerAgent: string }> = [];

    // 2-4. For each deliverable, create board + workflow + initial item
    for (const deliverable of deliverables) {
      const wfType = WORKFLOW_TYPES[deliverable.workflowType];
      if (!wfType) {
        console.warn(`[activate] Unknown workflow type: ${deliverable.workflowType}`);
        continue;
      }

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

      // 4. Create initial workflow item(s) at the first stage
      const firstStage = wfType.defaultBoard.stages[0];

      if (wfType.itemType === "content") {
        // Create a content item and link it
        const ciRows = await query<{ id: string }>(
          `INSERT INTO "_content_item" (title, description, "contentType", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, NOW(), NOW())
           RETURNING id`,
          [
            `${deliverable.label} — Draft`,
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

        // Create initial artifact if the first stage produces one
        if (firstStage.key === "IDEA") {
          await query(
            `INSERT INTO "_artifact" ("workflowItemId", "workflowId", stage, name, type, content, "createdAt", "updatedAt")
             VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
            [
              itemId,
              workflowId,
              firstStage.key,
              "Content Brief",
              "markdown",
              `# Content Brief: ${deliverable.label}\n\n## Working Title\n"${pkg.name} — ${deliverable.label}"\n\n## Key Points to Cover\n- [Ghost will research and fill this based on the campaign spec]\n- Target audience analysis\n- Competitive angle\n- Key data points and statistics\n\n## Target Keywords\n- [To be determined based on campaign spec]\n\n## Target Audience\n[Derived from campaign specification]\n\n## Estimated Word Count\n1,800 - 2,200 words\n\n## Campaign Connection\nThis content supports the overall package goals as defined in the campaign specification.`,
            ]
          );
        }
      }
      // For person-type workflows, items will be added as agents find targets

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

    return NextResponse.json({
      ok: true,
      packageId,
      workflows: createdWorkflows,
    });
  } catch (error) {
    console.error("[activate] error:", error);
    return NextResponse.json({ error: "Failed to activate package" }, { status: 500 });
  }
}
