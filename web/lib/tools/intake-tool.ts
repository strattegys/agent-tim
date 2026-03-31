import { listIntake, addIntake, updateIntake, deleteIntake } from "../intake";
import type { ToolModule } from "./types";

function parseItemNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isInteger(v) && v >= 1) return v;
  if (typeof v === "string") {
    const t = v.trim();
    if (/^\d+$/.test(t)) {
      const n = parseInt(t, 10);
      if (n >= 1) return n;
    }
  }
  return null;
}

/** Resolve update/delete target: UUID, or itemNumber against full list or optional filter (Intake search box). */
async function resolveIntakeTarget(
  agentId: string,
  args: { id?: unknown; itemNumber?: unknown; filterQuery?: unknown }
): Promise<{ id: string } | { error: string }> {
  const rawId = typeof args.id === "string" ? args.id.trim() : "";
  if (rawId) return { id: rawId };

  const n = parseItemNumber(args.itemNumber);
  if (n == null) {
    return {
      error:
        "Provide either id (UUID from list) or itemNumber (#1 = oldest in queue / FIFO, same as # on the card).",
    };
  }
  const fq = typeof args.filterQuery === "string" ? args.filterQuery.trim() : "";
  const items = await listIntake(agentId, fq ? { search: fq } : {});
  if (n > items.length) {
    const ctx = fq ? `with Intake search “${fq}”` : "in the full list";
    return {
      error: `No intake #${n} ${ctx} (only ${items.length} item(s)). Use intake list or match the user’s Intake search via filterQuery.`,
    };
  }
  return { id: items[n - 1]!.id };
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
      "The **only** tool for Suzi's **Intake** tab — capture inbox (URLs, snippets, triage). Cards **#1, #2…** FIFO (**#1** = oldest); the queue is usually short. **Numbers like #500 or #1049** are **punch list** card ids — use **punch_list** (**done**, **update**), **not** intake. **update**/**delete**/**archive**: **id** (from focused context) or **itemNumber** + optional **filterQuery** if search is active. **delete**/**archive** remove from active queue (soft-archived). **Promote to punch list:** when context has **Focused Intake** and user says add to punch list / make this a task — call **punch_list add** first (short summarized **title**, put original intake **title**+**body**+**url** in **description**, **rank** now, infer **category**), then **intake archive** with this item’s **id**. Commands: list, add, update, delete, archive, search.",
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
          type: "number",
          description:
            "1-based FIFO index as on Intake cards (#1 = oldest / next to work). Use for update/delete/archive when the user says “intake 2” or “item #3”.",
        },
        filterQuery: {
          type: "string",
          description:
            "Optional: same text as the Intake tab search box — scopes itemNumber to that filtered list.",
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
          (it, i) =>
            `#${i + 1} ${it.title}${it.url ? ` — ${it.url}` : ""}${it.body ? `\n  ${it.body.slice(0, 120)}${it.body.length > 120 ? "…" : ""}` : ""}\n  id: ${it.id}  source: ${it.source}`
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
      return `Intake item added: "${item.title}" (id: ${item.id})`;
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
          (it, i) =>
            `#${i + 1} ${it.title}${it.url ? ` — ${it.url}` : ""}\n  id: ${it.id}`
        )
        .join("\n\n");
    }

    return "Unknown intake command. Use: list, add, update, delete, archive, search";
  },
};

export default tool;
