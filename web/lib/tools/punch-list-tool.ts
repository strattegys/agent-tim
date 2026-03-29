import {
  listPunchListItems,
  addPunchListItem,
  updatePunchListItem,
  archivePunchListItem,
  archiveDoneItems,
  addNote,
  insertPunchListItemAction,
  patchPunchListItemAction,
} from "../punch-list";
import {
  parsePunchListRank,
  punchListColumnLabel,
  punchListColumnsSummary,
} from "../punch-list-columns";
import type { ToolModule } from "./types";

const RANK_HELP = `Column (rank 1–6): ${punchListColumnsSummary()}. You may pass a number or a name like "now", "later", "next", "sometime", "backlog", "idea" (also "some time").`;

/** LLMs often emit action/item_id instead of command/item_number — map so tools still run. */
function normalizePunchListArgs(raw: Record<string, string>): Record<string, string> {
  const args: Record<string, string> = { ...raw };
  if (!args.command && args.action) {
    const a = args.action.toLowerCase().replace(/-/g, "_");
    const actionToCommand: Record<string, string> = {
      mark_done: "done",
      mark_as_done: "done",
      complete: "done",
      done: "done",
      reopen: "reopen",
      list: "list",
      add: "add",
      update: "update",
      move: "update",
      move_to: "update",
      move_to_column: "update",
      archive: "archive",
      archive_done: "archive_done",
      note: "note",
      subtask_add: "action_add",
      subtask_toggle: "action_toggle",
      add_subtask: "action_add",
      toggle_subtask: "action_toggle",
      action_add: "action_add",
      add_action: "action_add",
      add_action_item: "action_add",
    };
    if (actionToCommand[a]) args.command = actionToCommand[a];
  }
  const idish = args.item_id || args.itemId;
  if (idish && !args.item_number && !args.id) {
    const s = String(idish).replace(/^#/, "").trim();
    if (/^\d+$/.test(s)) args.item_number = s;
    else args.id = s;
  }
  const rawCmd = (args.command || "")
    .toLowerCase()
    .replace(/-/g, "_")
    .replace(/\s+/g, "_")
    .trim();
  if (rawCmd === "move" || rawCmd === "move_to" || rawCmd === "move_to_column") {
    args.command = "update";
  }
  // "Close out #1043" → models often emit command close_out / close / finish
  const doneAliases = new Set([
    "close_out",
    "closeout",
    "close",
    "finish",
    "resolve",
    "complete",
    "mark_done",
    "mark_as_done",
  ]);
  if (doneAliases.has(rawCmd)) {
    args.command = "done";
  }
  const actionAddAliases = new Set([
    "add_action",
    "add_action_item",
    "new_action",
    "create_action",
    "action_add_item",
  ]);
  if (actionAddAliases.has(rawCmd)) {
    args.command = "action_add";
  }
  return args;
}

/** Comma/space-separated #numbers from item_number and optional item_numbers. */
function itemNumberTokens(args: Record<string, string>): string[] {
  const combined = [args.item_number, args.item_numbers].filter(Boolean).join(",");
  if (!combined.trim()) return [];
  return combined
    .split(/[\s,]+/)
    .map((s) => s.replace(/^#/, "").trim())
    .filter(Boolean);
}

const tool: ToolModule = {
  metadata: {
    id: "punch_list",
    displayName: "Punch List",
    category: "internal",
    description:
      "Track application fixes and improvements for the agent team environment.",
    operations: [
      "list",
      "add",
      "update",
      "done",
      "reopen",
      "archive",
      "archive_done",
      "note",
      "action_add",
      "action_toggle",
    ],
    requiresApproval: false,
  },

  declaration: {
    name: "punch_list",
    description: `Manage the punch list (Kanban columns). Use parameter command (not "action"): list, add, update, done, reopen, archive, archive_done, note, action_add, action_toggle.
**Notes vs Actions (Inspect panel):** **note** appends a **journal entry** to the card's **Notes** section (timestamped log, commentary). **action_add** adds a **checkbox subtask** to the **Actions** section. When the user asks to **add an action**, **action item**, **subtask**, **checkbox**, **step**, or **to-do on this card / on #N**, use **action_add** with **content** — **not** **note**. Use **note** only when they want a **note**, **comment**, **log**, or freeform **journal** text, not a checklist item.
CRITICAL — Moving an existing card to another column (e.g. "move #1040 to Next"): use command **update** with item_number="1040" and rank="next" (or 1–6). Do **NOT** use **add** when the user names an existing item number — add always creates a NEW # and duplicates work.
**add** only when creating a brand-new item (needs title, rank, category). When **promoting from Intake** (focused capture + user wants it on the board): **title** = short actionable summary you write; **description** = original intake **title**, **body**, **URL** preserved; **rank** = **now** unless user said otherwise; **category** = best fit unless user specified. **update** to change column (rank), title, description, or category on an existing #. The tool result lists **only fields that changed** (e.g. title only → no column move). Do not tell the user you moved a card unless the result includes **moved to column**.
**done** (or **close_out**, **close**, **finish**, **close this out**, **it’s a duplicate**) marks an item complete. If context has **ACTIVE PUNCH LIST TARGET** / green-highlighted card and they say **this / highlighted / green / close it / duplicate** without another #, use **item_number (focused)**. If they name a # (e.g. "close out 1043"), use that. After marking done, do **not** dump the full **list** unless asked; confirm briefly. Do **not** ask which # when that section is present.
For item IDs use item_number with the # shown on cards. Batch mark done: command done and item_number "1032,1033". ${RANK_HELP} Category is a short tag for new items.
**Subtasks / Actions (Inspect panel):** **action_add** with item_number + **content** adds a checkbox line under **Actions**. **action_toggle** with **action_id** (UUID from focused context or action_add result) and **done** "true" or "false" marks it done or reopens it. Synonyms for **action_add**: add_action, add_action_item, new_action (normalized server-side).
When context includes **ACTIVE PUNCH LIST TARGET** / **green-highlighted card**, Govind has that row selected on screen (green border) — **Inspect may be closed**. **This / highlighted / green / close this / update title / duplicate** → use **item_number (focused)** from that section; do not substitute another # or **list** first. **One-two-five** (spoken digits) → **125**, not 1025.`,
    parameters: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description:
            "list | add | update | done | reopen | archive | archive_done | note (journal → Notes section) | action_add (checkbox → Actions section) | action_toggle. For “add an action / action item / subtask” use action_add, not note.",
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
          description: `Kanban column for add or update: 1–6 or name (Now, Later, Next, Sometime, Backlog, Idea). Required to move an item: update + item_number + rank. ${RANK_HELP}`,
        },
        category: {
          type: "string",
          description:
            "Required for add. Short tag (e.g. ui, bug, feature). Prefer matching an existing category from the punch list UI when the user's words map clearly; otherwise ask.",
        },
        item_number: {
          type: "string",
          description:
            "Card # from the board. If **ACTIVE PUNCH LIST TARGET** / green-highlighted card is in context, that is the row with the **green border** (Inspect optional). For **this / highlighted / green / close out / duplicate** without another #, use **item_number (focused)**. Do not guess from older messages or list first. Spoken 'one two five' = **125**, not 1025. Comma-separate for batch done (e.g. '1032,1033').",
        },
        item_numbers: {
          type: "string",
          description:
            "Optional extra numbers when batching (usually prefer comma-separated item_number). Same format as item_number.",
        },
        id: {
          type: "string",
          description: "Item UUID (for update/done/reopen/archive/note — use item_number instead when possible)",
        },
        content: {
          type: "string",
          description:
            "For **note**: journal text (Notes section). For **action_add**: checkbox label (Actions section) — use this when user wants an action item / subtask / step.",
        },
        action_id: {
          type: "string",
          description:
            "Subtask UUID for action_toggle — from focused punch list context or the action_add tool result (action_id=…)",
        },
        done: {
          type: "string",
          description: 'For action_toggle only: "true" to check off, "false" to mark open again',
        },
      },
      required: ["command"],
    },
  },

  async execute(args0, { agentId }) {
    const args = normalizePunchListArgs(args0);
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
            if (item.actions?.length) {
              const open = item.actions.filter((a) => !a.done).length;
              line += `\n   Subtasks: ${open} open / ${item.actions.length} total`;
            }
            return line;
          }
        )
        .join("\n");
    }

    if (cmd === "add") {
      const addTokens = itemNumberTokens(args);
      if (addTokens.length > 0 || (args.item_number && String(args.item_number).trim())) {
        return (
          "Error: You passed an item number with command **add**. **add** only creates NEW items. " +
          "To move or edit an existing card (e.g. #1040 to Next), use command **update** with item_number and rank (e.g. rank=next). " +
          "Do not create a duplicate item."
        );
      }
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
      return `Punch list item created: #${item.itemNumber} "${item.title}" [${punchListColumnLabel(item.rank)}] [${item.category}]`;
    }

    const tokens = itemNumberTokens(args);
    if (
      tokens.length > 1 &&
      (cmd === "done" || cmd === "reopen" || cmd === "archive")
    ) {
      const items = await listPunchListItems(agentId);
      const lines: string[] = [];
      for (const t of tokens) {
        const itemNum = parseInt(t, 10);
        if (Number.isNaN(itemNum)) {
          lines.push(`Error: Invalid item number "${t}".`);
          continue;
        }
        const match = items.find((i) => i.itemNumber === itemNum);
        if (!match) {
          lines.push(`Error: Item #${t} not found.`);
          continue;
        }
        if (cmd === "done") {
          await updatePunchListItem(match.id, { status: "done" });
          lines.push(`Punch list item #${itemNum} marked done.`);
        } else if (cmd === "reopen") {
          await updatePunchListItem(match.id, { status: "open" });
          lines.push(`Punch list item #${itemNum} reopened.`);
        } else {
          await archivePunchListItem(match.id);
          lines.push(`Punch list item #${itemNum} archived.`);
        }
      }
      return lines.join("\n");
    }

    if (
      tokens.length > 1 &&
      cmd &&
      !["done", "reopen", "archive", "action_toggle"].includes(cmd)
    ) {
      return `Error: One item per call for "${cmd}". To mark several done at once, use command "done" with item_number "1032,1033" (comma-separated).`;
    }

    // Resolve single item number to ID
    let resolvedId = args.id;
    if (tokens.length === 1 && !resolvedId) {
      const items = await listPunchListItems(agentId);
      const itemNum = parseInt(tokens[0], 10);
      const match = Number.isNaN(itemNum)
        ? undefined
        : items.find((i) => i.itemNumber === itemNum);
      if (match) {
        resolvedId = match.id;
      } else if (["update", "done", "reopen", "archive", "note", "action_add"].includes(cmd || "")) {
        return `Error: Item #${tokens[0]} not found.`;
      }
    }

    if (cmd === "update") {
      if (!resolvedId) return "Error: id or item_number is required for update";
      const before = (await listPunchListItems(agentId)).find((i) => i.id === resolvedId);
      if (!before) return "Error: Item not found for update.";

      const updates: Record<string, unknown> = {};
      if (args.title) updates.title = args.title;
      if (args.description) updates.description = args.description;
      if (args.category) updates.category = args.category;
      if (args.rank) {
        const r = parsePunchListRank(String(args.rank));
        if (r === null) return `Error: Invalid column "${args.rank}". ${RANK_HELP}`;
        updates.rank = r;
      }
      if (Object.keys(updates).length === 0) {
        return "Error: update needs at least one of: rank (column move), title, description, category";
      }
      await updatePunchListItem(resolvedId, updates);
      const after = (await listPunchListItems(agentId)).find((i) => i.id === resolvedId);
      if (!after) return "Punch list item updated.";

      /** Only name what actually changed so the model does not infer a column move from a title edit. */
      const parts: string[] = [];
      if (updates.title !== undefined) {
        parts.push(`title is now "${after.title}"`);
      }
      if (updates.description !== undefined) {
        parts.push("description was updated");
      }
      if (updates.category !== undefined) {
        parts.push(`category is now [${after.category}]`);
      }
      if (updates.rank !== undefined) {
        const col = punchListColumnLabel(after.rank);
        parts.push(`moved to column [${col}]`);
      }
      return `Updated punch list #${after.itemNumber}: ${parts.join("; ")}.`;
    }

    if (cmd === "done") {
      if (!resolvedId) return "Error: id or item_number is required";
      const before = (await listPunchListItems(agentId)).find((i) => i.id === resolvedId);
      await updatePunchListItem(resolvedId, { status: "done" });
      const num = before?.itemNumber ?? tokens[0] ?? "?";
      const title = before?.title ? ` "${before.title}"` : "";
      return `Punch list item #${num}${title} marked done.`;
    }

    if (cmd === "reopen") {
      if (!resolvedId) return "Error: id or item_number is required";
      const before = (await listPunchListItems(agentId)).find((i) => i.id === resolvedId);
      await updatePunchListItem(resolvedId, { status: "open" });
      const num = before?.itemNumber ?? tokens[0] ?? "?";
      return `Punch list item #${num} reopened.`;
    }

    if (cmd === "archive") {
      if (!resolvedId) return "Error: id or item_number is required";
      const before = (await listPunchListItems(agentId)).find((i) => i.id === resolvedId);
      await archivePunchListItem(resolvedId);
      const num = before?.itemNumber ?? tokens[0] ?? "?";
      return `Punch list item #${num} archived.`;
    }

    if (cmd === "archive_done") {
      const count = await archiveDoneItems(agentId);
      return `Archived ${count} completed items.`;
    }

    if (cmd === "note") {
      if (!resolvedId) return "Error: id or item_number is required";
      if (!args.content) return "Error: content is required for adding a note";
      const row = (await listPunchListItems(agentId)).find((i) => i.id === resolvedId);
      await addNote(resolvedId, args.content);
      const itemNum = row?.itemNumber ?? tokens[0] ?? "?";
      return `Note added to punch list item #${itemNum}.`;
    }

    if (cmd === "action_add") {
      if (!resolvedId) return "Error: id or item_number is required for action_add";
      if (!args.content?.trim()) return "Error: content is required for action_add (subtask text)";
      try {
        const inserted = await insertPunchListItemAction(agentId, resolvedId, args.content);
        const row = (await listPunchListItems(agentId)).find((i) => i.id === resolvedId);
        const itemNum = row?.itemNumber ?? tokens[0] ?? "?";
        return `Subtask added to punch list #${itemNum}. action_id=${inserted.id}`;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Failed to add subtask";
        return msg === "Item not found" ? "Error: Item not found." : `Error: ${msg}`;
      }
    }

    if (cmd === "action_toggle") {
      const actionId = String(args.action_id || args.actionId || "").trim();
      if (!actionId) {
        return "Error: action_id is required (UUID from focused context or action_add result).";
      }
      const doneStr = String(args.done || "")
        .toLowerCase()
        .trim();
      if (doneStr !== "true" && doneStr !== "false") {
        return 'Error: For action_toggle pass done as "true" or "false".';
      }
      const done = doneStr === "true";
      const result = await patchPunchListItemAction(agentId, actionId, { done });
      if (!result) return "Error: Subtask not found.";
      return `Subtask on punch list #${result.itemNumber} marked ${done ? "done" : "open"}.`;
    }

    return "Unknown punch_list command. Use: list, add, update, done, reopen, archive, archive_done, note, action_add, action_toggle";
  },
};

export default tool;
