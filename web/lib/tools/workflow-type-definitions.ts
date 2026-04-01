import type { ToolModule } from "./types";
import { query } from "../db";
import {
  validateCustomWorkflowTypePayload,
  parseDefaultBoard,
} from "../workflow-type-definition-validate";
import { getWorkflowTypeRegistry, isBuiltinWorkflowTypeId } from "../workflow-registry";

const tool: ToolModule = {
  metadata: {
    id: "workflow_type_definitions",
    displayName: "Workflow type definitions",
    category: "internal",
    description:
      "List, inspect, validate, and manage CRM workflow type definitions (merged with seven library types from code).",
    operations: ["list", "get", "validate-json", "create", "update", "delete"],
    requiresApproval: false,
  },

  declaration: {
    name: "workflow_type_definitions",
    description:
      "Workflow type registry: seven library types in code plus rows in `_workflow_type_custom`. " +
      "Commands: list (all merged), get (arg1=id), validate-json (arg1=JSON string of full create payload), " +
      "create (arg1=that same JSON string — required to persist a new type; never claim success without this), " +
      "update (arg1=id, arg2=JSON string fields), delete (arg1=id — soft delete; library ids cannot be deleted). " +
      "Create payload keys: id (lowercase slug), label, itemType (person|content), description, defaultBoard { stages[], transitions{} }, optional throughputGoal.",
    parameters: {
      type: "object" as const,
      properties: {
        command: { type: "string", description: "list | get | validate-json | create | update | delete" },
        arg1: { type: "string", description: "id or JSON string depending on command" },
        arg2: { type: "string", description: "JSON string for update body" },
      },
      required: ["command"],
    },
  },

  async execute(args) {
    const cmd = args.command?.trim().toLowerCase();

    if (cmd === "list") {
      const reg = await getWorkflowTypeRegistry();
      const custom = new Set(reg.customIds());
      return reg
        .listAll()
        .map((t) => `- ${t.label} (${t.id}) [${t.itemType}] ${custom.has(t.id) ? "custom" : "builtin"}`)
        .join("\n");
    }

    if (cmd === "get") {
      if (!args.arg1) return "Error: arg1 (id) is required";
      const reg = await getWorkflowTypeRegistry();
      const t = reg.get(args.arg1.trim());
      if (!t) return `No workflow type "${args.arg1}".`;
      return JSON.stringify(t, null, 2);
    }

    if (cmd === "validate-json") {
      if (!args.arg1) return "Error: arg1 (JSON string) is required";
      let o: Record<string, unknown>;
      try {
        o = JSON.parse(args.arg1) as Record<string, unknown>;
      } catch {
        return "Error: arg1 must be valid JSON";
      }
      const v = validateCustomWorkflowTypePayload({
        id: String(o.id ?? ""),
        label: String(o.label ?? ""),
        itemType: String(o.itemType ?? ""),
        description: String(o.description ?? ""),
        defaultBoard: o.defaultBoard,
        throughputGoal: o.throughputGoal,
      });
      if (!v.ok) return `Invalid:\n${v.errors.join("\n")}`;
      return "OK: payload passes validation (custom id must still not collide with a built-in on create).";
    }

    if (cmd === "create") {
      if (!args.arg1) return "Error: arg1 (JSON string) is required";
      let o: Record<string, unknown>;
      try {
        o = JSON.parse(args.arg1) as Record<string, unknown>;
      } catch {
        return "Error: arg1 must be valid JSON";
      }
      const id = String(o.id ?? "").trim();
      const v = validateCustomWorkflowTypePayload({
        id,
        label: String(o.label ?? ""),
        itemType: String(o.itemType ?? ""),
        description: String(o.description ?? ""),
        defaultBoard: o.defaultBoard,
        throughputGoal: o.throughputGoal,
      });
      if (!v.ok) return `Invalid:\n${v.errors.join("\n")}`;
      if (isBuiltinWorkflowTypeId(id)) return `Error: id "${id}" is reserved (built-in).`;
      const board = parseDefaultBoard(o.defaultBoard);
      if (!board) return "Error: invalid defaultBoard";
      const tg =
        o.throughputGoal != null && typeof o.throughputGoal === "object" && !Array.isArray(o.throughputGoal)
          ? JSON.stringify(o.throughputGoal)
          : null;
      await query(
        `INSERT INTO "_workflow_type_custom"
          (id, label, "itemType", description, "defaultBoard", "throughputGoal", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, NOW(), NOW())`,
        [
          id,
          String(o.label).trim(),
          String(o.itemType),
          String(o.description ?? ""),
          JSON.stringify(board),
          tg,
        ]
      );
      return `Created custom workflow type "${id}".`;
    }

    if (cmd === "update") {
      if (!args.arg1) return "Error: arg1 (id) is required";
      if (!args.arg2) return "Error: arg2 (JSON body) is required";
      const id = args.arg1.trim();
      if (isBuiltinWorkflowTypeId(id)) return "Error: cannot update built-in types.";
      let o: Record<string, unknown>;
      try {
        o = JSON.parse(args.arg2) as Record<string, unknown>;
      } catch {
        return "Error: arg2 must be valid JSON";
      }
      const v = validateCustomWorkflowTypePayload({
        id,
        label: String(o.label ?? ""),
        itemType: String(o.itemType ?? ""),
        description: String(o.description ?? ""),
        defaultBoard: o.defaultBoard,
        throughputGoal: o.throughputGoal,
      });
      if (!v.ok) return `Invalid:\n${v.errors.join("\n")}`;
      const board = parseDefaultBoard(o.defaultBoard);
      if (!board) return "Error: invalid defaultBoard";
      const tg =
        o.throughputGoal != null && typeof o.throughputGoal === "object" && !Array.isArray(o.throughputGoal)
          ? JSON.stringify(o.throughputGoal)
          : null;
      const rows = await query(
        `UPDATE "_workflow_type_custom"
         SET label = $2, "itemType" = $3, description = $4,
             "defaultBoard" = $5::jsonb, "throughputGoal" = $6::jsonb, "updatedAt" = NOW()
         WHERE id = $1 AND "deletedAt" IS NULL
         RETURNING id`,
        [id, String(o.label).trim(), String(o.itemType), String(o.description ?? ""), JSON.stringify(board), tg]
      );
      if (rows.length === 0) return "Not found or already deleted.";
      return `Updated custom workflow type "${id}".`;
    }

    if (cmd === "delete") {
      if (!args.arg1) return "Error: arg1 (id) is required";
      const id = args.arg1.trim();
      if (isBuiltinWorkflowTypeId(id)) return "Error: cannot delete built-in types.";
      const rows = await query(
        `UPDATE "_workflow_type_custom" SET "deletedAt" = NOW(), "updatedAt" = NOW()
         WHERE id = $1 AND "deletedAt" IS NULL RETURNING id`,
        [id]
      );
      if (rows.length === 0) return "Not found or already deleted.";
      return `Soft-deleted custom workflow type "${id}".`;
    }

    return "Unknown command. Use list, get, validate-json, create, update, delete.";
  },
};

export default tool;
