import {
  listPunchListItems,
  addPunchListItem,
  updatePunchListItem,
  archivePunchListItem,
  archiveDoneItems,
  addNote,
  insertPunchListItemAction,
  patchPunchListItemAction,
  getPunchListItemByItemNumber,
  getPunchListItemById,
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
**Stable target = row \`id\` (UUID):** Prefer **id** from **ACTIVE PUNCH LIST TARGET**, from **list** (each row has \`id:\`), or after **add**. **#N** on cards is a display label — **id** is the primary key. Use **item_number** when the user cites **#N** without an id, or for batch **#** lists.
**Punch # vs Intake #:** Big Kanban **#** (e.g. **#1049**) are punch-list labels, not Intake. **Intake** is **#1, #2…** only; never use **intake** for "mark #1049 done".
**Notes vs Actions (Inspect panel):** **note** appends a **journal entry** to the card's **Notes** section (timestamped log, commentary). **action_add** adds a **checkbox subtask** to the **Actions** section. When the user asks to **add an action**, **action item**, **subtask**, **checkbox**, **step**, or **to-do on this card / on #N**, use **action_add** with **content** — **not** **note**. Use **note** only when they want a **note**, **comment**, **log**, or freeform **journal** text, not a checklist item.
CRITICAL — Moving a card (e.g. "move #1040 to Next"): **update** with **id** (preferred) or item_number="1040", plus rank="next" (or 1–6). Do **NOT** use **add** for an existing card — **add** creates a NEW #.
**add** only when creating a brand-new item (needs title, rank, category). When **promoting from Intake** (focused capture + user wants it on the board): **title** = short actionable summary you write; **description** = original intake **title**, **body**, **URL** preserved; **rank** = **now** unless user said otherwise; **category** = best fit unless user specified. **update** to change column (rank), title, description, or category on an existing #. The tool result lists **only fields that changed** (e.g. title only → no column move). Do not tell the user you moved a card unless the result includes **moved to column**.
**done** / **close_out** / **finish** / **duplicate**: pass **id** when you have it; if they name **#1043** only, use **item_number**="1043". If **id** and **item_number** disagree, **item_number** wins. After done, reply briefly; do **not** dump **list** unless asked.
Batch mark done: item_number "1032,1033" (or separate calls with **id**). ${RANK_HELP} Category is a short tag for new items.
**Subtasks / Actions:** **action_add** with **id** (preferred) or item_number + **content**. **action_toggle** uses **action_id** only. Synonyms for **action_add**: add_action, add_action_item, new_action (normalized server-side).
**ACTIVE PUNCH LIST TARGET:** For **this / highlighted / green / close this** without a cited **#**, pass **id** from context. **One-two-five** → item_number **125**, not 1025.`,
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
          description: `Kanban column for add or update: 1–6 or name (Now, Later, Next, Sometime, Backlog, Idea). Required to move an item: update + **id** (preferred) or item_number + rank. ${RANK_HELP}`,
        },
        category: {
          type: "string",
          description:
            "Required for add. Short tag (e.g. ui, bug, feature). Prefer matching an existing category from the punch list UI when the user's words map clearly; otherwise ask.",
        },
        id: {
          type: "string",
          description:
            "Preferred row key: UUID from ACTIVE PUNCH LIST TARGET, list output (`id:` line), or add result. Use for done/update/reopen/archive/note/action_add when available.",
        },
        item_number: {
          type: "string",
          description:
            "Fallback: display # on Kanban card. Use when the user cites **#N** and you have no id, or for batch done ('1032,1033'). For focused **this card** without a cited #, pass **id** from context instead. Spoken 'one two five' = **125**.",
        },
        item_numbers: {
          type: "string",
          description:
            "Optional extra numbers when batching (usually prefer comma-separated item_number). Same format as item_number.",
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
            line += `\n   id: ${item.id}`;
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
          "To move or edit an existing card (e.g. #1040 to Next), use command **update** with **id** (preferred) or item_number and rank (e.g. rank=next). " +
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
      return `Punch list item created: #${item.itemNumber} id=${item.id} "${item.title}" [${punchListColumnLabel(item.rank)}] [${item.category}]`;
    }

    const tokens = itemNumberTokens(args);
    if (
      tokens.length > 1 &&
      (cmd === "done" || cmd === "reopen" || cmd === "archive")
    ) {
      const lines: string[] = [];
      for (const t of tokens) {
        const itemNum = parseInt(t, 10);
        if (Number.isNaN(itemNum)) {
          lines.push(`Error: Invalid item number "${t}".`);
          continue;
        }
        const match = await getPunchListItemByItemNumber(agentId, itemNum);
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

    // Resolve to row id: prefer UUID **id** when it matches the agent's row; if both **id** and
    // **item_number** point to different rows, **item_number** wins (explicit # from user/model).
    const rawId = args.id?.trim() || "";
    let resolvedId: string | undefined;
    const firstToken = tokens.length === 1 ? tokens[0] : undefined;
    const singleNum =
      firstToken && /^\d+$/.test(firstToken) ? parseInt(firstToken, 10) : null;
    const rowById = rawId ? await getPunchListItemById(agentId, rawId) : null;
    const rowByNum =
      singleNum !== null ? await getPunchListItemByItemNumber(agentId, singleNum) : null;
    if (rowById && rowByNum && rowById.id !== rowByNum.id) {
      resolvedId = rowByNum.id;
    } else if (rowById) {
      resolvedId = rowById.id;
    } else if (rowByNum) {
      resolvedId = rowByNum.id;
    }
    if (
      !resolvedId &&
      ["update", "done", "reopen", "archive", "note", "action_add"].includes(cmd || "")
    ) {
      if (singleNum !== null) return `Error: Item #${firstToken} not found.`;
      if (rawId) return "Error: Item id not found.";
    }

    if (cmd === "update") {
      if (!resolvedId) return "Error: id or item_number is required for update";
      const before = await getPunchListItemById(agentId, resolvedId);
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
      const after = await getPunchListItemById(agentId, resolvedId);
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
      const before = await getPunchListItemById(agentId, resolvedId);
      if (!before) return "Error: Item not found.";
      await updatePunchListItem(resolvedId, { status: "done" });
      const num = before.itemNumber;
      const title = before.title ? ` "${before.title}"` : "";
      return `Punch list item #${num}${title} marked done.`;
    }

    if (cmd === "reopen") {
      if (!resolvedId) return "Error: id or item_number is required";
      const before = await getPunchListItemById(agentId, resolvedId);
      if (!before) return "Error: Item not found.";
      await updatePunchListItem(resolvedId, { status: "open" });
      return `Punch list item #${before.itemNumber} reopened.`;
    }

    if (cmd === "archive") {
      if (!resolvedId) return "Error: id or item_number is required";
      const before = await getPunchListItemById(agentId, resolvedId);
      if (!before) return "Error: Item not found.";
      await archivePunchListItem(resolvedId);
      return `Punch list item #${before.itemNumber} archived.`;
    }

    if (cmd === "archive_done") {
      const count = await archiveDoneItems(agentId);
      return `Archived ${count} completed items.`;
    }

    if (cmd === "note") {
      if (!resolvedId) return "Error: id or item_number is required";
      if (!args.content) return "Error: content is required for adding a note";
      const row = await getPunchListItemById(agentId, resolvedId);
      if (!row) return "Error: Item not found.";
      await addNote(resolvedId, args.content);
      return `Note added to punch list item #${row.itemNumber}.`;
    }

    if (cmd === "action_add") {
      if (!resolvedId) return "Error: id or item_number is required for action_add";
      if (!args.content?.trim()) return "Error: content is required for action_add (subtask text)";
      const rowBefore = await getPunchListItemById(agentId, resolvedId);
      if (!rowBefore) return "Error: Item not found.";
      try {
        const inserted = await insertPunchListItemAction(agentId, resolvedId, args.content);
        return `Subtask added to punch list #${rowBefore.itemNumber}. action_id=${inserted.id}`;
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
