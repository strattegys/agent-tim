import type { PackageDeliverable } from "../package-types";
import { hasUserApproval } from "./shared";
import type { ToolModule } from "./types";

const tool: ToolModule = {
  metadata: {
    id: "package_manager",
    displayName: "Package Manager",
    category: "internal",
    description:
      "Create and manage service packages. Packages bundle multiple workflows " +
      "across agents and auto-create them on approval.",
    operations: [
      "list-templates",
      "create-package",
      "customize-package",
      "submit-for-approval",
      "approve-package",
      "list-packages",
      "get-package",
      "rename-package",
    ],
    requiresApproval: true,
  },

  declaration: {
    name: "package_manager",
    description:
      "Manage service packages that bundle workflows across agents. " +
      "Commands: " +
      "list-templates (show available package templates), " +
      "create-package (arg1=templateId, arg2=optional package name — defaults to template label, arg3=customerId, arg4=customerType [person|company]), " +
      "customize-package (arg1=packageId, arg2=JSON spec with deliverables array), " +
      "submit-for-approval (arg1=packageId — sets stage to PENDING_APPROVAL), " +
      "approve-package (arg1=packageId — REQUIRES user approval phrase — creates all workflows), " +
      "list-packages (optional arg1=stage filter, arg2=customerId filter), " +
      "get-package (arg1=packageId — shows package with linked workflows), " +
      "rename-package (arg1=packageId, arg2=new display name — fixes typos; any stage).",
    parameters: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description:
            "Command: list-templates, create-package, customize-package, submit-for-approval, approve-package, list-packages, get-package, rename-package",
        },
        arg1: {
          type: "string",
          description:
            "First arg: templateId (create), packageId (customize/submit/approve/get), or stage filter (list)",
        },
        arg2: {
          type: "string",
          description:
            "Second arg: package name (create — omit to use template label), JSON spec (customize), customerId filter (list), or new name (rename-package)",
        },
        arg3: {
          type: "string",
          description: "Third arg: customerId (create-package)",
        },
        arg4: {
          type: "string",
          description: "Fourth arg: customerType — 'person' or 'company' (create-package)",
        },
      },
      required: ["command"],
    },
  },

  async execute(args, context) {
    const { query: dbQuery } = await import("../db");
    const { PACKAGE_TEMPLATES, PLANNER_PACKAGE_TEMPLATES } = await import(
      "../package-types"
    );
    const cmd = args.command;

    // ─── list-templates ──────────────────────────────────────────
    if (cmd === "list-templates") {
      const templates = PLANNER_PACKAGE_TEMPLATES;
      if (templates.length === 0) return "No package templates defined.";
      return templates
        .map((t) => {
          const deliverables = t.deliverables
            .map((d) => `  - ${d.label}: ${d.targetCount} items (${d.ownerAgent} via ${d.workflowType})`)
            .join("\n");
          return `${t.label} (id: ${t.id})\n${t.description}\nDeliverables:\n${deliverables}`;
        })
        .join("\n\n");
    }

    // ─── create-package ──────────────────────────────────────────
    if (cmd === "create-package") {
      if (!args.arg1) return "Error: arg1 (templateId) is required";

      const template = PACKAGE_TEMPLATES[args.arg1];
      if (!template) return `Error: unknown template "${args.arg1}". Use list-templates to see available templates.`;
      if (template.hideFromPlanner) {
        return `Error: template "${template.id}" is system infrastructure (created automatically). Do not create it with create-package.`;
      }

      const packageName = (args.arg2 && String(args.arg2).trim()) || template.label;
      const customerId = args.arg3 || null;
      const customerType = args.arg4 || "person";
      const spec = JSON.stringify({ deliverables: template.deliverables });

      const rows = await dbQuery(
        `INSERT INTO "_package" ("templateId", name, "customerId", "customerType", spec, stage, "createdBy", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5::jsonb, 'DRAFT', $6, NOW(), NOW()) RETURNING id`,
        [args.arg1, packageName, customerId, customerType, spec, context.agentId || "penny"]
      );
      const id = (rows[0] as Record<string, unknown>).id;

      return `Package created: "${packageName}" (id: ${id}) from template "${template.label}" — stage=DRAFT\nDeliverables: ${template.deliverables.map((d) => d.label).join(", ")}`;
    }

    // ─── customize-package ───────────────────────────────────────
    if (cmd === "customize-package") {
      if (!args.arg1) return "Error: arg1 (packageId) is required";
      if (!args.arg2) return "Error: arg2 (JSON spec) is required";

      // Validate JSON
      try {
        JSON.parse(args.arg2);
      } catch {
        return "Error: arg2 must be valid JSON with a deliverables array";
      }

      const existing = await dbQuery(
        `SELECT stage FROM "_package" WHERE id = $1 AND "deletedAt" IS NULL`,
        [args.arg1]
      );
      if (existing.length === 0) return "Error: package not found";
      if ((existing[0] as Record<string, unknown>).stage !== "DRAFT")
        return "Error: can only customize packages in DRAFT stage";

      const parsed = JSON.parse(args.arg2) as { deliverables?: PackageDeliverable[] };
      const dels = parsed?.deliverables;
      if (!Array.isArray(dels) || dels.length === 0) {
        return "Error: spec must include a non-empty deliverables array";
      }
      const { getWorkflowTypeRegistry } = await import("../workflow-registry");
      const reg = await getWorkflowTypeRegistry();
      for (const d of dels) {
        if (!d?.workflowType || !reg.get(d.workflowType)) {
          return `Error: unknown workflow type "${d?.workflowType ?? ""}" in deliverable "${d?.label ?? ""}". Use workflow_type_definitions list or Friday → Workflow templates.`;
        }
      }

      await dbQuery(
        `UPDATE "_package" SET spec = $1::jsonb, "updatedAt" = NOW() WHERE id = $2`,
        [args.arg2, args.arg1]
      );
      return `Package ${args.arg1} spec updated.`;
    }

    // ─── submit-for-approval ─────────────────────────────────────
    if (cmd === "submit-for-approval") {
      if (!args.arg1) return "Error: arg1 (packageId) is required";

      const existing = await dbQuery(
        `SELECT stage, name FROM "_package" WHERE id = $1 AND "deletedAt" IS NULL`,
        [args.arg1]
      );
      if (existing.length === 0) return "Error: package not found";
      if ((existing[0] as Record<string, unknown>).stage !== "DRAFT")
        return "Error: can only submit packages in DRAFT stage";

      await dbQuery(
        `UPDATE "_package" SET stage = 'PENDING_APPROVAL', "updatedAt" = NOW() WHERE id = $1`,
        [args.arg1]
      );
      return `Package "${(existing[0] as Record<string, unknown>).name}" submitted for approval — stage=PENDING_APPROVAL`;
    }

    // ─── approve-package ─────────────────────────────────────────
    if (cmd === "approve-package") {
      if (!args.arg1) return "Error: arg1 (packageId) is required";

      if (!hasUserApproval(context.lastUserMessage || "")) {
        return (
          'BLOCKED: Package approval requires explicit user confirmation. ' +
          'Ask the user to say "approve package" or "approve it now" to proceed.'
        );
      }

      const { transaction } = await import("../db");
      const { getWorkflowTypeRegistry } = await import("../workflow-registry");

      const pkgRows = await dbQuery(
        `SELECT id, name, spec, stage FROM "_package" WHERE id = $1 AND "deletedAt" IS NULL`,
        [args.arg1]
      );
      if (pkgRows.length === 0) return "Error: package not found";
      const pkg = pkgRows[0] as Record<string, unknown>;

      if (pkg.stage !== "PENDING_APPROVAL")
        return `Error: package is in ${pkg.stage} stage — must be PENDING_APPROVAL to approve`;

      const spec = pkg.spec as { deliverables?: PackageDeliverable[] };
      if (!spec.deliverables || spec.deliverables.length === 0)
        return "Error: package has no deliverables";

      const reg = await getWorkflowTypeRegistry();
      for (const d of spec.deliverables) {
        if (!reg.get(d.workflowType)) {
          return `Error: unknown workflow type "${d.workflowType}" in deliverable "${d.label}"`;
        }
      }

      const createdWorkflows = await transaction(async (run) => {
        const workflows: Array<{ workflowId: string; boardId: string; label: string; agent: string }> = [];

        for (const d of spec.deliverables!) {
          const wfType = reg.get(d.workflowType);
          if (!wfType) {
            throw new Error(`Missing workflow type ${d.workflowType}`);
          }

          // Create board from template
          const boardResult = await run(
            `INSERT INTO "_board" (name, description, stages, transitions, "createdAt", "updatedAt")
             VALUES ($1, $2, $3::jsonb, $4::jsonb, NOW(), NOW()) RETURNING id`,
            [
              `${pkg.name} — ${d.label}`,
              `Board for ${d.label} in package "${pkg.name}"`,
              JSON.stringify(wfType.defaultBoard.stages),
              JSON.stringify(wfType.defaultBoard.transitions),
            ]
          );
          const boardId = boardResult.rows[0].id as string;

          // Create workflow linked to package
          const wfResult = await run(
            `INSERT INTO "_workflow" (name, spec, "itemType", "boardId", "ownerAgent", "packageId", stage, "createdAt", "updatedAt")
             VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', NOW(), NOW()) RETURNING id`,
            [
              `${pkg.name} — ${d.label}`,
              JSON.stringify({
                targetCount: d.targetCount,
                workflowType: d.workflowType,
                pacing: d.pacing ?? null,
              }),
              wfType.itemType,
              boardId,
              d.ownerAgent,
              args.arg1,
            ]
          );
          const workflowId = wfResult.rows[0].id as string;

          workflows.push({ workflowId, boardId, label: d.label, agent: d.ownerAgent });
        }

        // Update package stage to ACTIVE
        await run(
          `UPDATE "_package" SET stage = 'ACTIVE', "updatedAt" = NOW() WHERE id = $1`,
          [args.arg1]
        );

        return workflows;
      });

      const summary = createdWorkflows
        .map((w) => `  - ${w.label} → ${w.agent} (workflow: ${w.workflowId})`)
        .join("\n");

      return `Package "${pkg.name}" APPROVED and ACTIVE!\n\nCreated ${createdWorkflows.length} workflow(s):\n${summary}`;
    }

    // ─── list-packages ───────────────────────────────────────────
    if (cmd === "list-packages") {
      const params: unknown[] = [];
      const conditions: string[] = ['"deletedAt" IS NULL'];

      if (args.arg1) {
        params.push(args.arg1.toUpperCase());
        conditions.push(`stage = $${params.length}`);
      }
      if (args.arg2) {
        params.push(args.arg2);
        conditions.push(`"customerId" = $${params.length}`);
      }

      const rows = await dbQuery(
        `SELECT p.id, p.name, p."templateId", p.stage, p."packageNumber", p."customerId", p."customerType", p."createdAt",
                (SELECT COUNT(*)::text FROM "_workflow" w WHERE w."packageId" = p.id AND w."deletedAt" IS NULL) AS workflow_count
         FROM "_package" p
         WHERE ${conditions.join(" AND ")}
         ORDER BY p."createdAt" DESC LIMIT 50`,
        params
      );

      if (rows.length === 0) return "No packages found" + (args.arg1 ? ` in ${args.arg1} stage` : "") + ".";

      return rows
        .map((r: Record<string, unknown>) => {
          const num = r.packageNumber != null ? `#${r.packageNumber} ` : "";
          return `- ${num}${r.name} [${r.stage}] template=${r.templateId} workflows=${r.workflow_count} customer=${r.customerId || "none"} (id: ${r.id})`;
        })
        .join("\n");
    }

    // ─── get-package ─────────────────────────────────────────────
    if (cmd === "get-package") {
      if (!args.arg1) return "Error: arg1 (packageId) is required";

      const pkgRows = await dbQuery(
        `SELECT id, name, "templateId", stage, spec, "packageNumber", "customerId", "customerType", "createdBy", "createdAt"
         FROM "_package" WHERE id = $1 AND "deletedAt" IS NULL`,
        [args.arg1]
      );
      if (pkgRows.length === 0) return "Error: package not found";
      const pkg = pkgRows[0] as Record<string, unknown>;

      const wfRows = await dbQuery(
        `SELECT w.id, w.name, w.stage, w."ownerAgent", w."itemType",
                (SELECT COUNT(*)::text FROM "_workflow_item" wi WHERE wi."workflowId" = w.id AND wi."deletedAt" IS NULL) AS item_count
         FROM "_workflow" w
         WHERE w."packageId" = $1 AND w."deletedAt" IS NULL
         ORDER BY w.name ASC`,
        [args.arg1]
      );

      const spec = pkg.spec as { deliverables?: Array<{ label: string; targetCount: number }> };
      const deliverables = spec.deliverables
        ?.map((d) => `  - ${d.label}: ${d.targetCount} items`)
        .join("\n") || "  (none)";

      const workflows = wfRows.length > 0
        ? wfRows
            .map((w: Record<string, unknown>) =>
              `  - ${w.name} [${w.stage}] agent=${w.ownerAgent} items=${w.item_count}`
            )
            .join("\n")
        : "  (no workflows created yet)";

      const numLine =
        pkg.packageNumber != null ? `Package #: ${pkg.packageNumber}\n` : "";
      return `Package: ${pkg.name}\n${numLine}Template: ${pkg.templateId}\nStage: ${pkg.stage}\nCustomer: ${pkg.customerId || "none"} (${pkg.customerType})\nCreated by: ${pkg.createdBy}\n\nDeliverables:\n${deliverables}\n\nWorkflows:\n${workflows}`;
    }

    // ─── rename-package ──────────────────────────────────────────
    if (cmd === "rename-package") {
      if (!args.arg1) return "Error: arg1 (packageId) is required";
      const newName = args.arg2 && String(args.arg2).trim();
      if (!newName) return "Error: arg2 (new name) is required";

      const existing = await dbQuery(
        `SELECT id, name FROM "_package" WHERE id = $1 AND "deletedAt" IS NULL`,
        [args.arg1]
      );
      if (existing.length === 0) return "Error: package not found";

      await dbQuery(
        `UPDATE "_package" SET name = $1, "updatedAt" = NOW() WHERE id = $2 AND "deletedAt" IS NULL`,
        [newName, args.arg1]
      );
      const prev = (existing[0] as Record<string, unknown>).name;
      return `Package renamed: "${prev}" → "${newName}" (id: ${args.arg1})`;
    }

    return "Unknown package_manager command. Use: list-templates, create-package, customize-package, submit-for-approval, approve-package, list-packages, get-package, rename-package";
  },
};

export default tool;
