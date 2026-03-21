import {
  listPunchListItems,
  addPunchListItem,
  updatePunchListItem,
  archivePunchListItem,
  archiveDoneItems,
  addNote,
} from "../punch-list";
import type { ToolModule } from "./types";

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
    description:
      "Manage the punch list of app fixes and improvements. Commands: 'list' (all open items with their persistent ID numbers), 'add' (new item — ALWAYS ask user for rank 1-8 and category), 'update' (modify by item number or id), 'done' (mark complete), 'reopen' (mark open again), 'archive' (archive a single item), 'archive_done' (archive all completed items), 'note' (add a note to an item). Each item has a persistent numeric ID (e.g. 1001, 1002) that never changes. Rank 1-8 where 1 = highest priority. Category is a short tag like 'ui', 'bug', 'feature', 'agent', etc.",
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
          description: "Priority 1-8, 1 = highest (for add/update). ALWAYS ask the user for this.",
        },
        category: {
          type: "string",
          description: "Short tag/category like 'ui', 'bug', 'feature', 'agent', 'content', 'infra' (for add/update). ALWAYS ask the user for this.",
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
            let line = `#${item.itemNumber} [R${item.rank}]${item.category ? ` [${item.category}]` : ""} ${item.status === "done" ? "DONE " : ""}${item.title}`;
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
      if (!args.rank) return "Error: Please ask the user what rank (1-8) this item should have.";
      if (!args.category) return "Error: Please ask the user what category tag this item should have (e.g. ui, bug, feature, agent, content, infra).";
      const rank = parseInt(args.rank);
      if (rank < 1 || rank > 8) return "Error: rank must be 1-8";
      const item = await addPunchListItem(agentId, {
        title: args.title,
        description: args.description,
        rank,
        category: args.category,
      });
      return `Punch list item created: #${item.itemNumber} "${item.title}" [rank ${item.rank}] [${item.category}] (id: ${item.id})`;
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
        const r = parseInt(args.rank);
        if (r < 1 || r > 8) return "Error: rank must be 1-8";
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
