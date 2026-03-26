import {
  listPunchListItems,
  addPunchListItem,
  updatePunchListItem,
  archivePunchListItem,
  archiveDoneItems,
  addNote,
} from "../punch-list";
import {
  parsePunchListRank,
  punchListColumnLabel,
  punchListColumnsSummary,
} from "../punch-list-columns";
import type { ToolModule } from "./types";

const RANK_HELP = `Column (rank 1–6): ${punchListColumnsSummary()}. You may pass a number or a name like "now", "later", "next", "sometime", "backlog", "idea" (also "some time").`;

const tool: ToolModule = {
  metadata: {
    id: "punch_list",
    displayName: "Punch List",
    category: "internal",
    description:
      "Track application fixes and improvements for the agent team environment.",
    operations: ["list", "add", "update", "done", "reopen", "archive", "archive_done", "note"],
    requiresApproval: false,
  },

  declaration: {
    name: "punch_list",
    description: `Manage the punch list (Kanban columns, not a single priority number). Commands: 'list', 'add' (requires column + category — see Suzi's instructions), 'update', 'done', 'reopen', 'archive', 'archive_done', 'note'. ${RANK_HELP} Category is a short tag; match existing tags when possible.`,
    parameters: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description: "list, add, update, done, reopen, archive, archive_done, or note",
        },
        title: {
          type: "string",
          description: "Item title (for add/update)",
        },
        description: {
          type: "string",
          description: "Optional details (for add/update)",
        },
        rank: {
          type: "string",
          description: `Kanban column: 1–6 or name (Now, Later, Next, Sometime, Backlog, Idea). ${RANK_HELP}`,
        },
        category: {
          type: "string",
          description:
            "Required for add. Short tag (e.g. ui, bug, feature). Prefer matching an existing category from the punch list UI when the user's words map clearly; otherwise ask.",
        },
        item_number: {
          type: "string",
          description: "Persistent item number (e.g. '1001', '1023') as shown in the list. Use this instead of id when the user refers to items by number.",
        },
        id: {
          type: "string",
          description: "Item UUID (for update/done/reopen/archive/note — use item_number instead when possible)",
        },
        content: {
          type: "string",
          description: "Note content (for note command)",
        },
      },
      required: ["command"],
    },
  },

  async execute(args, { agentId }) {
    const cmd = args.command;

    if (cmd === "list") {
      const items = await listPunchListItems(agentId, {
        status: args.status as "open" | "done" | undefined,
      });
      if (items.length === 0) return "No punch list items found.";
      return items
        .map(
          (item) => {
            const latestNote = item.notes?.[0];
            const col = punchListColumnLabel(item.rank);
            let line = `#${item.itemNumber} [${col}]${item.category ? ` [${item.category}]` : ""} ${item.status === "done" ? "DONE " : ""}${item.title}`;
            if (item.description) line += ` — ${item.description}`;
            if (latestNote) line += `\n   Latest note: "${latestNote.content}"`;
            line += ` (id: ${item.id})`;
            return line;
          }
        )
        .join("\n");
    }

    if (cmd === "add") {
      if (!args.title) return "Error: title is required";
      if (!args.rank) {
        return `Error: Ask which column this belongs in (${punchListColumnsSummary()}).`;
      }
      if (!args.category) {
        return "Error: Every punch list item needs a category tag. Infer from context or ask.";
      }
      const rank = parsePunchListRank(String(args.rank));
      if (rank === null) {
        return `Error: Invalid column "${args.rank}". Use ${RANK_HELP}`;
      }
      const item = await addPunchListItem(agentId, {
        title: args.title,
        description: args.description,
        rank,
        category: args.category,
      });
      return `Punch list item created: #${item.itemNumber} "${item.title}" [${punchListColumnLabel(item.rank)}] [${item.category}] (id: ${item.id})`;
    }

    // Resolve item number to ID
    let resolvedId = args.id;
    if (args.item_number && !resolvedId) {
      const items = await listPunchListItems(agentId);
      const itemNum = parseInt(args.item_number);
      const match = items.find((i) => i.itemNumber === itemNum);
      if (match) {
        resolvedId = match.id;
      } else {
        return `Error: Item #${args.item_number} not found.`;
      }
    }

    if (cmd === "update") {
      if (!resolvedId) return "Error: id or item_number is required for update";
      const updates: Record<string, unknown> = {};
      if (args.title) updates.title = args.title;
      if (args.description) updates.description = args.description;
      if (args.category) updates.category = args.category;
      if (args.rank) {
        const r = parsePunchListRank(String(args.rank));
        if (r === null) return `Error: Invalid column "${args.rank}". ${RANK_HELP}`;
        updates.rank = r;
      }
      await updatePunchListItem(resolvedId, updates);
      return `Punch list item updated.`;
    }

    if (cmd === "done") {
      if (!resolvedId) return "Error: id or item_number is required";
      await updatePunchListItem(resolvedId, { status: "done" });
      return `Punch list item marked done.`;
    }

    if (cmd === "reopen") {
      if (!resolvedId) return "Error: id or item_number is required";
      await updatePunchListItem(resolvedId, { status: "open" });
      return `Punch list item reopened.`;
    }

    if (cmd === "archive") {
      if (!resolvedId) return "Error: id or item_number is required";
      await archivePunchListItem(resolvedId);
      return `Punch list item archived.`;
    }

    if (cmd === "archive_done") {
      const count = await archiveDoneItems(agentId);
      return `Archived ${count} completed items.`;
    }

    if (cmd === "note") {
      if (!resolvedId) return "Error: id or item_number is required";
      if (!args.content) return "Error: content is required for adding a note";
      const note = await addNote(resolvedId, args.content);
      return `Note added to punch list item (note id: ${note.id})`;
    }

    return "Unknown punch_list command. Use: list, add, update, done, reopen, archive, archive_done, note";
  },
};

export default tool;
