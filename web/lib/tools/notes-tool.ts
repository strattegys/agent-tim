import {
  listNotes,
  addNote,
  updateNote,
  deleteNote,
  findByNoteNumberForAgent,
  getNoteByIdForAgent,
} from "../notes";
import { noteDigitsFromToken } from "../public-ref";
import type { ToolModule } from "./types";

const tool: ToolModule = {
  metadata: {
    id: "notes",
    displayName: "Notes",
    category: "internal",
    description:
      "Suzi Notes tab — user-visible reference notes (facts, preferences, snippets). Separate from reminders (scheduled) and punch_list (tasks).",
    operations: ["list", "add", "update", "delete", "search"],
    requiresApproval: false,
  },

  declaration: {
    name: "notes",
    description:
      "The **only** tool for durable reference notes shown in Suzi's **Notes** work tab (not the reminders tool). Govind browses and searches these in the UI — this is NOT vector/memory tool. Each note has a stable ref like **NT5001** (or legacy plain number). Commands: list (optional tag filter), add, update (note_number), delete (note_number), search. For birthdays, due dates, or recurring pings use **reminders**. For task cards use **punch_list**. Never claim you saved a note without calling this tool.",
    parameters: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description: "list, add, update, delete, or search",
        },
        title: {
          type: "string",
          description: "Note title (for add/update)",
        },
        content: {
          type: "string",
          description: "Note body/details (for add/update)",
        },
        tag: {
          type: "string",
          description:
            "Optional tag for categorization (e.g. 'personal', 'work', 'reference', 'people')",
        },
        note_number: {
          type: "string",
          description: "Stable note ref: NT5001 or plain 5001 (for update/delete)",
        },
        id: {
          type: "string",
          description: "Note UUID (for update/delete — use note_number instead when possible)",
        },
        query: {
          type: "string",
          description: "Search query (for search command)",
        },
        pinned: {
          type: "string",
          description: "Set to 'true' to pin a note to the top (for add/update)",
        },
      },
      required: ["command"],
    },
  },

  async execute(args, { agentId }) {
    const cmd = args.command;

    let resolvedId = args.id;
    let resolvedLabel = "";
    if (args.note_number && !resolvedId) {
      const num = noteDigitsFromToken(args.note_number);
      if (num != null) {
        const note = await findByNoteNumberForAgent(agentId, num);
        if (!note) return `Error: Note ${args.note_number} not found.`;
        resolvedId = note.id;
        resolvedLabel = note.publicRef;
      }
    }

    if (cmd === "list") {
      const notes = await listNotes(agentId, { tag: args.tag });
      if (notes.length === 0) return "No notes found.";
      return notes
        .map(
          (n) =>
            `${n.pinned ? "📌 " : ""}${n.publicRef} ${n.title}${n.tag ? ` tag:${n.tag}` : ""}${n.content ? `\n   ${n.content.slice(0, 100)}` : ""}`
        )
        .join("\n");
    }

    if (cmd === "add") {
      if (!args.title) return "Error: title is required for add";
      const note = await addNote(agentId, {
        title: args.title,
        content: args.content,
        tag: args.tag,
        pinned: args.pinned === "true",
      });
      return `Note added: ${note.publicRef} "${note.title}"${note.tag ? ` tag:${note.tag}` : ""}`;
    }

    if (cmd === "update") {
      if (!resolvedId) return "Error: note_number or id is required for update";
      await updateNote(resolvedId, {
        title: args.title,
        content: args.content,
        tag: args.tag,
        pinned: args.pinned === "true" ? true : args.pinned === "false" ? false : undefined,
      });
      const label =
        resolvedLabel ||
        (await getNoteByIdForAgent(agentId, resolvedId))?.publicRef ||
        resolvedId;
      return `Note ${label} updated.`;
    }

    if (cmd === "delete") {
      if (!resolvedId) return "Error: note_number or id is required for delete";
      const label =
        resolvedLabel ||
        (await getNoteByIdForAgent(agentId, resolvedId))?.publicRef ||
        resolvedId;
      await deleteNote(resolvedId);
      return `Note ${label} deleted.`;
    }

    if (cmd === "search") {
      const q = args.query || args.title || "";
      if (!q) return "Error: query is required for search";
      const notes = await listNotes(agentId, { search: q });
      if (notes.length === 0) return "No notes found matching that query.";
      return notes
        .map(
          (n) =>
            `${n.pinned ? "📌 " : ""}${n.publicRef} ${n.title}${n.tag ? ` tag:${n.tag}` : ""}${n.content ? `\n   ${n.content.slice(0, 100)}` : ""}`
        )
        .join("\n");
    }

    return "Unknown notes command. Use: list, add, update, delete, search";
  },
};

export default tool;
