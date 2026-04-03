import {
  listIntake,
  addIntake,
  updateIntake,
  deleteIntake,
  getIntakeByItemNumber,
} from "../intake";
import { intakeDigitsFromToken } from "../public-ref";
import type { ToolModule } from "./types";

function parseItemNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isInteger(v) && v >= 1) return v;
  if (typeof v === "string") return intakeDigitsFromToken(v);
  return null;
}

/** Resolve update/delete target: UUID, or stable DB itemNumber (same # as on Intake cards). */
async function resolveIntakeTarget(
  agentId: string,
  args: { id?: unknown; itemNumber?: unknown }
): Promise<{ id: string } | { error: string }> {
  const rawId = typeof args.id === "string" ? args.id.trim() : "";
  if (rawId) return { id: rawId };

  const n = parseItemNumber(args.itemNumber);
  if (n == null) {
    return {
      error:
        "Provide either id (UUID from list) or itemNumber (stable id: IN2001 or plain 2001, same as list output).",
    };
  }
  const row = await getIntakeByItemNumber(agentId, n);
  if (!row) {
    return {
      error: `No intake itemNumber ${n} for this agent (archived, wrong number, or not found). Use intake list.`,
    };
  }
  return { id: row.id };
}

const tool: ToolModule = {
  metadata: {
    id: "intake",
    displayName: "Intake",
    category: "internal",
    description:
      "Suzi Intake tab — capture inbox for links, snippets, and things to triage (UI, Share, email, or chat). Not notes, not punch list, not reminders.",
    operations: ["list", "add", "update", "delete", "archive", "search"],
    requiresApproval: false,
  },

  declaration: {
    name: "intake",
    description:
      "The **only** tool for Suzi's **Intake** tab — capture inbox (URLs, snippets, triage). Each card shows a **stable itemNumber** (DB id, e.g. #2001) — it does **not** change when sort or page changes. **Numbers like #500 or #1049** may be **punch list** card ids — use **punch_list** (**done**, **update**), **not** intake. **update**/**delete**/**archive**: **id** (UUID from focused context) or **itemNumber** (the # on the card). **delete**/**archive** remove from active queue (soft-archived). **Promote to punch list:** when context has **Focused Intake** and user says add to punch list / make this a task — call **punch_list add** first (short summarized **title**, put original intake **title**+**body**+**url** in **description**, **rank** now, infer **category**), then **intake archive** with this item’s **id**. Commands: list, add, update, delete, archive, search.",
    parameters: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description: "list, add, update, delete, archive, or search",
        },
        title: {
          type: "string",
          description: "Title for add/update",
        },
        url: {
          type: "string",
          description: "Optional URL for add/update",
        },
        body: {
          type: "string",
          description: "Optional text body / snippet for add/update",
        },
        id: {
          type: "string",
          description: "Intake item UUID for update/delete/archive (alternative to itemNumber)",
        },
        itemNumber: {
          type: "string",
          description:
            "Stable intake ref: **IN2001** or plain **2001** (same as the badge on the card and list output). Use for update/delete/archive when the user cites that id.",
        },
        filterQuery: {
          type: "string",
          description:
            "Deprecated for resolve-by-number — itemNumber is global per row. Optional echo for logging only.",
        },
        query: {
          type: "string",
          description: "Search text for search command",
        },
      },
      required: ["command"],
    },
  },

  async execute(args, { agentId }) {
    const cmd = args.command;

    if (cmd === "list") {
      const items = await listIntake(agentId);
      if (items.length === 0) return "No intake items.";
      return items
        .map(
          (it) =>
            `${it.publicRef} ${it.title}${it.url ? ` — ${it.url}` : ""}${it.body ? `\n  ${it.body.slice(0, 120)}${it.body.length > 120 ? "…" : ""}` : ""}\n  id: ${it.id}  source: ${it.source}`
        )
        .join("\n\n");
    }

    if (cmd === "add") {
      if (!args.title?.trim()) return "Error: title is required for add";
      const item = await addIntake(agentId, {
        title: args.title.trim(),
        url: args.url?.trim() || undefined,
        body: args.body?.trim() || undefined,
        source: "agent",
      });
      return `Intake item added: ${item.publicRef} "${item.title}" (id: ${item.id})`;
    }

    if (cmd === "update") {
      const resolved = await resolveIntakeTarget(agentId, args);
      if ("error" in resolved) return `Error: ${resolved.error}`;
      await updateIntake(resolved.id, {
        title: args.title !== undefined ? String(args.title).trim() : undefined,
        url: args.url !== undefined ? (String(args.url).trim() || null) : undefined,
        body: args.body !== undefined ? (args.body != null ? String(args.body).trim() : null) : undefined,
      });
      return "Intake item updated.";
    }

    if (cmd === "delete" || cmd === "archive") {
      const resolved = await resolveIntakeTarget(agentId, args);
      if ("error" in resolved) return `Error: ${resolved.error}`;
      await deleteIntake(resolved.id);
      return "Intake item archived (removed from queue).";
    }

    if (cmd === "search") {
      const q = args.query?.trim() || args.title?.trim() || "";
      if (!q) return "Error: query is required for search";
      const items = await listIntake(agentId, { search: q });
      if (items.length === 0) return "No intake items match that query.";
      return items
        .map(
          (it) =>
            `${it.publicRef} ${it.title}${it.url ? ` — ${it.url}` : ""}\n  id: ${it.id}`
        )
        .join("\n\n");
    }

    return "Unknown intake command. Use: list, add, update, delete, archive, search";
  },
};

export default tool;
