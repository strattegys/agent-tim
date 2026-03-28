import type { ToolModule } from "./types";

const tool: ToolModule = {
  metadata: {
    id: "workflow_manager",
    displayName: "Workflow Manager",
    category: "internal",
    description:
      "Create and manage agent workflows and pipelines. Tim's periodic heartbeat only nudges warm-outreach pace/backlog (Postgres) and Scout delegation results, not full CRM health scans.",
    operations: [
      "list-workflows",
      "get-workflow",
      "create-workflow",
      "update-workflow-stage",
      "assign-workflow",
      "list-boards",
      "list-templates",
    ],
    requiresApproval: false,
  },

  declaration: {
    name: "workflow_manager",
    description:
      "Manage workflows and workflow templates across all agents. Use this to oversee, create, and modify workflows. Commands: list-workflows (optional arg1=agentId to filter by owner), get-workflow (arg1=workflowId), create-workflow (arg1=name, arg2=boardId, arg3=ownerAgent, arg4=itemType), update-workflow-stage (arg1=workflowId, arg2=new stage: PLANNING|ACTIVE|PAUSED|COMPLETED), assign-workflow (arg1=workflowId, arg2=agentId), list-boards, list-templates.",
    parameters: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description:
            "Command: list-workflows, get-workflow, create-workflow, update-workflow-stage, assign-workflow, list-boards, list-templates",
        },
        arg1: {
          type: "string",
          description:
            "First arg: agentId (list-workflows filter), workflowId (get/update/assign), or name (create)",
        },
        arg2: {
          type: "string",
          description:
            "Second arg: boardId (create), new stage (update-workflow-stage), or agentId (assign-workflow)",
        },
        arg3: {
          type: "string",
          description: "Third arg: ownerAgent (create-workflow)",
        },
        arg4: {
          type: "string",
          description:
            "Fourth arg: itemType — 'person' or 'content' (create-workflow)",
        },
      },
      required: ["command"],
    },
  },

  async execute(args) {
    const { query: dbQuery } = await import("../db");
    const { WORKFLOW_TYPES } = await import("../workflow-types");
    const cmd = args.command;

    if (cmd === "list-workflows") {
      const filterAgent = args.arg1;
      const params: unknown[] = [];
      let where = 'WHERE w."deletedAt" IS NULL';
      if (filterAgent) {
        params.push(filterAgent);
        where += ` AND w."ownerAgent" = $${params.length}`;
      }
      const rows = await dbQuery(
        `SELECT w.id, w.name, w.stage, w."itemType", w."ownerAgent",
                b.name AS board_name
         FROM "_workflow" w
         LEFT JOIN "_board" b ON b.id = w."boardId" AND b."deletedAt" IS NULL
         ${where} ORDER BY w.name ASC LIMIT 50`,
        params
      );
      if (rows.length === 0)
        return filterAgent
          ? `No workflows owned by ${filterAgent}.`
          : "No workflows found.";
      return rows
        .map(
          (r: Record<string, unknown>) =>
            `- ${r.name} [${r.stage}] owner=${r.ownerAgent || "unassigned"} type=${r.itemType} board="${r.board_name || "none"}" id=${r.id}`
        )
        .join("\n");
    }

    if (cmd === "get-workflow") {
      if (!args.arg1) return "Error: arg1 (workflowId) is required";
      const rows = await dbQuery(
        `SELECT w.id, w.name, w.stage, w.spec, w."itemType", w."ownerAgent",
                b.name AS board_name, b.stages AS board_stages
         FROM "_workflow" w
         LEFT JOIN "_board" b ON b.id = w."boardId" AND b."deletedAt" IS NULL
         WHERE w.id = $1 AND w."deletedAt" IS NULL`,
        [args.arg1]
      );
      if (rows.length === 0) return "Workflow not found.";
      const w = rows[0] as Record<string, unknown>;
      const itemRows = await dbQuery(
        `SELECT stage, COUNT(*)::text AS count FROM "_workflow_item"
         WHERE "workflowId" = $1 AND "deletedAt" IS NULL GROUP BY stage`,
        [args.arg1]
      );
      const counts = itemRows
        .map((r: Record<string, unknown>) => `${r.stage}: ${r.count}`)
        .join(", ");
      return `Workflow: ${w.name}\nStage: ${w.stage}\nOwner: ${w.ownerAgent || "unassigned"}\nType: ${w.itemType}\nBoard: ${w.board_name || "none"}\nItems: ${counts || "none"}`;
    }

    if (cmd === "create-workflow") {
      if (!args.arg1) return "Error: arg1 (name) is required";
      if (!args.arg2) return "Error: arg2 (boardId) is required";
      const owner = args.arg3 || null;
      const itemType = args.arg4 || "person";
      const rows = await dbQuery(
        `INSERT INTO "_workflow" (name, spec, "itemType", "boardId", "ownerAgent", stage, "createdAt", "updatedAt")
         VALUES ($1, '', $2, $3, $4, 'PLANNING', NOW(), NOW()) RETURNING id`,
        [args.arg1, itemType, args.arg2, owner]
      );
      const id = (rows[0] as Record<string, unknown>).id;
      return `Workflow created: "${args.arg1}" (id: ${id}) owner=${owner || "unassigned"} stage=PLANNING`;
    }

    if (cmd === "update-workflow-stage") {
      if (!args.arg1) return "Error: arg1 (workflowId) is required";
      if (!args.arg2) return "Error: arg2 (stage) is required";
      const validStages = ["PLANNING", "ACTIVE", "PAUSED", "COMPLETED"];
      const newStage = args.arg2.toUpperCase();
      if (!validStages.includes(newStage))
        return `Error: stage must be one of: ${validStages.join(", ")}`;
      await dbQuery(
        `UPDATE "_workflow" SET stage = $1, "updatedAt" = NOW() WHERE id = $2 AND "deletedAt" IS NULL`,
        [newStage, args.arg1]
      );
      return `Workflow ${args.arg1} stage updated to ${newStage}.`;
    }

    if (cmd === "assign-workflow") {
      if (!args.arg1) return "Error: arg1 (workflowId) is required";
      if (!args.arg2) return "Error: arg2 (agentId) is required";
      await dbQuery(
        `UPDATE "_workflow" SET "ownerAgent" = $1, "updatedAt" = NOW() WHERE id = $2 AND "deletedAt" IS NULL`,
        [args.arg2, args.arg1]
      );
      return `Workflow ${args.arg1} assigned to ${args.arg2}.`;
    }

    if (cmd === "list-boards") {
      const rows = await dbQuery(
        `SELECT id, name, description FROM "_board" WHERE "deletedAt" IS NULL ORDER BY name ASC`
      );
      if (rows.length === 0) return "No boards found.";
      return rows
        .map(
          (r: Record<string, unknown>) =>
            `- ${r.name}${r.description ? ` — ${r.description}` : ""} (id: ${r.id})`
        )
        .join("\n");
    }

    if (cmd === "list-templates") {
      return Object.values(WORKFLOW_TYPES)
        .map((t) => `- ${t.label} [${t.itemType}]: ${t.description} (id: ${t.id})`)
        .join("\n");
    }

    return "Unknown workflow_manager command. Use: list-workflows, get-workflow, create-workflow, update-workflow-stage, assign-workflow, list-boards, list-templates";
  },
};

export default tool;
