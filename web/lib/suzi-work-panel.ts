/**
 * Suzi work panel — single source of truth for sub-tab ↔ tool mapping and ephemeral LLM context.
 * When tabs change, update this module and the panel UI together.
 *
 * **Human header hints** for each sub-tab: `SUZI_WORK_TAB_HEADER_HINT` — rendered by
 * `web/components/suzi/SuziWorkSubTabHeader.tsx` (keep wording agent-first; see PROJECT-MEMORY.md).
 */

export type SuziWorkSubTab = "punchlist" | "reminders" | "notes" | "intake";

/** Intake card the user highlighted (green border) — injected into chat context for Suzi. */
export type SuziFocusedIntake = {
  id: string;
  title: string;
  url: string | null;
  body: string | null;
  source: string;
  /** FIFO # shown on the card when selected (itemNumber when list/filter matches). */
  displayNumber?: number;
  /** Same string as the Intake tab search box when applied — pass as intake tool `filterQuery` with `itemNumber` if needed. */
  filterQuery?: string;
};

const FOCUSED_INTAKE_BODY_MAX = 12_000;

function formatFocusedIntakeSection(f: SuziFocusedIntake): string {
  const bodyRaw = f.body?.trim() || "";
  const bodyShown =
    bodyRaw.length > FOCUSED_INTAKE_BODY_MAX
      ? `${bodyRaw.slice(0, FOCUSED_INTAKE_BODY_MAX)}\n… (truncated for context)`
      : bodyRaw;

  const lines = [
    "",
    "### Focused Intake item (green border — Govind’s selected capture)",
    "Treat questions like “what is this?”, “summarize this”, “what’s this about?”, or “what’s that link?” as referring to **this** item unless the user clearly means something else.",
    `- **id:** \`${f.id}\``,
  ];
  if (f.displayNumber != null) {
    lines.push(
      `- **FIFO # on cards:** #${f.displayNumber} (same as intake tool \`itemNumber\` when the list matches the screen${f.filterQuery ? `; Intake search is active — use \`filterQuery\` exactly: \`${f.filterQuery.replace(/`/g, "'")}\`` : ""}).`
    );
  }
  lines.push(`- **title:** ${f.title}`);
  lines.push(f.url ? `- **url:** ${f.url}` : "- **url:** (none)");
  lines.push(
    bodyShown
      ? `- **body:**\n\`\`\`\n${bodyShown}\n\`\`\``
      : "- **body:** (empty)"
  );
  lines.push(`- **source:** ${f.source}`);
  lines.push(
    "",
    "**Promote to punch list (natural phrases:** “add this to the punch list,” “let’s put this on the board,” “turn this into a task,” “make this a Kanban item,” “move this to punch list”**):**",
    "1. Call **punch_list** **add** first (so the task exists even if the next step fails):",
    "   - **title:** A **short, actionable** task title **you write** from the capture (summarize; do **not** paste the full long intake title as the punch title unless it is already concise).",
    "   - **description:** Preserve context — include a line **Intake title:** with the original title, then the **body** (and a **URL:** line if present). Nothing important should be lost.",
    "   - **rank:** **now** (or `1`) unless Govind names another column (Later, Next, …).",
    "   - **category:** Pick the best short tag from the content (`content`, `research`, `infra`, `ui`, `personal`, `agent`, …) unless Govind specified one.",
    "2. Then call **intake** **archive** with **id** from above (preferred), or **itemNumber** + **filterQuery** if you use the FIFO # and search is active.",
    "Do **both** tool calls in order; do not say “done” without executing them. Do not leave the capture in Intake after a successful promote.",
    "",
    "**How to help:** Summarize and explain from title/body. If the user wants detail from the link, use **web_search** when helpful. Use **intake** for **other** rows; this item’s text is above."
  );
  return lines.join("\n");
}

/** Punch list row the user focused (green ring / Inspect) — full detail for Suzi chat. */
export type SuziFocusedPunchList = {
  id: string;
  itemNumber: number;
  title: string;
  description: string | null;
  category: string | null;
  rank: number;
  columnLabel: string;
  status: "open" | "done";
  notes: { id: string; content: string; createdAt: string }[];
  /** Checkbox subtasks (Inspect); use id with punch_list action_toggle. */
  actions: { id: string; content: string; done: boolean }[];
};

const FOCUSED_PUNCH_DESC_MAX = 8_000;
const FOCUSED_PUNCH_NOTE_BODY_MAX = 4_000;
const FOCUSED_PUNCH_NOTES_TOTAL_MAX = 12_000;

function formatFocusedPunchListSection(p: SuziFocusedPunchList): string {
  const descRaw = p.description?.trim() || "";
  const descShown =
    descRaw.length > FOCUSED_PUNCH_DESC_MAX
      ? `${descRaw.slice(0, FOCUSED_PUNCH_DESC_MAX)}\n… (truncated)`
      : descRaw;

  const notesOrdered = [...p.notes].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  let notesTotal = 0;
  const noteLines: string[] = [];
  for (const n of notesOrdered) {
    let c = n.content?.trim() || "";
    if (c.length > FOCUSED_PUNCH_NOTE_BODY_MAX) {
      c = `${c.slice(0, FOCUSED_PUNCH_NOTE_BODY_MAX)}…`;
    }
    const block = `- (${new Date(n.createdAt).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })})\n  ${c.replace(/\n/g, "\n  ")}`;
    if (notesTotal + block.length > FOCUSED_PUNCH_NOTES_TOTAL_MAX) {
      noteLines.push("… (further notes omitted for context size)");
      break;
    }
    noteLines.push(block);
    notesTotal += block.length;
  }

  const lines = [
    "",
    "### ACTIVE PUNCH LIST TARGET — the green-highlighted card on the board",
    "**If this section appears in context, Govind has that row selected: green border / green ring on the Kanban card.** That is his **current focus** for punch-list work. **Inspect (modal) may be closed** — selection is from the green highlight alone. Phrases like **this card**, **the highlighted one**, **the green one**, **the one I have selected**, **this on screen**, **this item** mean **the row below** (`item_number`), not some other # from chat history.",
    "**This block is authoritative:** Do not infer focus from older messages or tool output. If you see **item_number (focused)** below, that is the card with the green UI state unless Govind explicitly names a different number.",
    `**Default target for punch_list tools:** If the user says **this item**, **this card**, **this task**, **close this out**, **close it out**, **close this item**, **mark this done**, **mark it complete**, **finish this**, **it's a duplicate** (meaning dismiss this card), **the one I selected**, **the one I have open**, **correct that**, **update this title**, or similar **without** naming a different card number, use **item_number="${p.itemNumber}"** (below). Do not substitute a # from chat history, a misread digit, or a **list** result — and **do not** ask “which number?” when this block is present unless they clearly mean a **different** card.`,
    "**If they override the card:** When they clearly name a different item (e.g. “item 125”, “#125”, “work on one-two-five” meaning digits 1-2-5), use **that** \`item_number\` for that turn and after — not the focused number.",
    "**Spoken digits (voice / casual):** “one two five” / “item one two five” means card **#125** (concatenate: 1, 2, 5). It does **not** mean #1025. “One oh two five” / “one zero two five” / “ten twenty-five” may mean **#1025**. If still ambiguous, ask once which # is on their card.",
    "Treat questions like “what is this task?”, “what should I do here?”, “expand on this”, or “what do the notes say?” as referring to **this** row unless the user clearly means another item.",
    `- **id:** \`${p.id}\``,
    `- **item_number (focused):** ${p.itemNumber} — the **green-highlighted** card on the board is #${p.itemNumber}`,
    `- **title:** ${p.title}`,
    `- **column:** ${p.columnLabel} (rank ${p.rank})`,
    `- **status:** ${p.status}`,
    p.category ? `- **category:** ${p.category}` : "- **category:** (none)",
    descShown
      ? `- **description:**\n\`\`\`\n${descShown}\n\`\`\``
      : "- **description:** (empty)",
    p.notes.length
      ? `- **notes** (${p.notes.length}, newest first in Inspect):\n${noteLines.join("\n")}`
      : "- **notes:** (none)",
    p.actions.length
      ? `- **actions (subtasks):** Each line is \`done\` or \`open\` with \`action_id\` for **punch_list** **action_toggle**:\n${p.actions
          .map(
            (a) =>
              `  - [${a.done ? "done" : "open"}] \`${a.content.replace(/`/g, "'")}\` — action_id=\`${a.id}\``
          )
          .join("\n")}`
      : "- **actions:** (none — use **action_add** with this item's **item_number** to add subtasks)",
    "",
    "**How to help:** Answer from title, description, notes, and actions above. Use **punch_list** to move, complete (**done** / close out), **archive**, add **journal notes** (**note** — Inspect **Notes**), or add/toggle **checkbox subtasks** (**action_add** / **action_toggle** — Inspect **Actions**). If Govind asks to **add an action**, **action item**, **subtask**, **checkbox step**, or **to-do on this card**, use **action_add** with **content**, **not** **note**. **note** is for narrative/log text only. The snapshot may be stale after tool calls. For **“close out” / duplicate**, **done** is usual unless they said **archive**. When editing **titles**, Govind usually wants **Title Case** unless he says otherwise.",
  ];
  return lines.join("\n");
}

/** Reminder row highlighted in the Reminders tab — injected into chat context for Suzi. */
export type SuziFocusedReminder = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  nextDueAt: string | null;
  recurrence: string | null;
  isActive: boolean;
};

const FOCUSED_REMINDER_DESC_MAX = 4_000;

function formatFocusedReminderSection(r: SuziFocusedReminder): string {
  const descRaw = r.description?.trim() || "";
  const descShown =
    descRaw.length > FOCUSED_REMINDER_DESC_MAX
      ? `${descRaw.slice(0, FOCUSED_REMINDER_DESC_MAX)}\n… (truncated)`
      : descRaw;

  return [
    "",
    "### Focused Reminder (green border — selected row in Reminders tab)",
    "Treat “this reminder,” “the one I selected,” or “change the date on this” as **this** row unless the user names another.",
    `- **id:** \`${r.id}\` (use with **reminders** **update** / **delete**).`,
    `- **title:** ${r.title}`,
    `- **category:** ${r.category}`,
    r.nextDueAt
      ? `- **next due:** ${r.nextDueAt} (Pacific interpretation as in UI)`
      : "- **next due:** (none)",
    r.recurrence ? `- **recurrence:** ${r.recurrence}` : "- **recurrence:** (none)",
    `- **active:** ${r.isActive}`,
    descShown
      ? `- **description:**\n\`\`\`\n${descShown}\n\`\`\``
      : "- **description:** (empty)",
    "",
    "**How to help:** Use **reminders** with **id** above for edits; do not guess another id.",
  ].join("\n");
}

/** Note card highlighted in the Notes tab — injected into chat context for Suzi. */
export type SuziFocusedNote = {
  id: string;
  noteNumber: number;
  title: string;
  content: string | null;
  tag: string | null;
  pinned: boolean;
};

const FOCUSED_NOTE_CONTENT_MAX = 12_000;

function formatFocusedNoteSection(n: SuziFocusedNote): string {
  const bodyRaw = n.content?.trim() || "";
  const bodyShown =
    bodyRaw.length > FOCUSED_NOTE_CONTENT_MAX
      ? `${bodyRaw.slice(0, FOCUSED_NOTE_CONTENT_MAX)}\n… (truncated)`
      : bodyRaw;

  return [
    "",
    "### Focused Note (green border — selected card in Notes tab)",
    "Treat “this note,” “update this,” or “what does # say” as **this** note unless the user names another **note_number**.",
    `- **id:** \`${n.id}\``,
    `- **note_number:** ${n.noteNumber} (use with **notes** **update** / **delete**).`,
    `- **title:** ${n.title}`,
    n.tag ? `- **tag:** ${n.tag}` : "- **tag:** (none)",
    `- **pinned:** ${n.pinned}`,
    bodyShown
      ? `- **content:**\n\`\`\`\n${bodyShown}\n\`\`\``
      : "- **content:** (empty)",
    "",
    "**How to help:** Use **notes** with **note_number** or **id** above; prefer **note_number** when editing.",
  ].join("\n");
}

/** Build focused context from a Reminders API row. */
export function reminderToFocusedContext(r: {
  id: string;
  title: string;
  description: string | null;
  category: string;
  nextDueAt: string | null;
  recurrence: string | null;
  isActive: boolean;
}): SuziFocusedReminder {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category,
    nextDueAt: r.nextDueAt,
    recurrence: r.recurrence,
    isActive: r.isActive,
  };
}

/** Build focused context from a Notes API row. */
export function noteToFocusedContext(n: {
  id: string;
  noteNumber: number;
  title: string;
  content: string | null;
  tag: string | null;
  pinned: boolean;
}): SuziFocusedNote {
  return {
    id: n.id,
    noteNumber: n.noteNumber,
    title: n.title,
    content: n.content,
    tag: n.tag,
    pinned: n.pinned,
  };
}

/** Build focused context from a list row + Kanban column label (server shape). */
export function punchListItemToFocusedContext(
  item: {
    id: string;
    itemNumber: number;
    title: string;
    description: string | null;
    category: string | null;
    rank: number;
    status: "open" | "done";
    notes: { id: string; content: string; createdAt: string }[];
    actions?: { id: string; content: string; done: boolean }[];
  },
  columnLabel: string
): SuziFocusedPunchList {
  return {
    id: item.id,
    itemNumber: item.itemNumber,
    title: item.title,
    description: item.description,
    category: item.category,
    rank: item.rank,
    columnLabel,
    status: item.status,
    notes: item.notes.map((n) => ({
      id: n.id,
      content: n.content,
      createdAt: n.createdAt,
    })),
    actions: (item.actions ?? []).map((a) => ({
      id: a.id,
      content: a.content,
      done: a.done,
    })),
  };
}

export type SuziWorkPanelContextInput = {
  /** True when the right rail is showing Suzi's work panel (not Agent info). */
  workPanelOpen: boolean;
  /** Active sub-tab inside the work panel. Ignored if workPanelOpen is false. */
  subTab: SuziWorkSubTab;
  /** Highlighted Intake card; included in context whenever set (even if another work tab is visible). */
  focusedIntake?: SuziFocusedIntake | null;
  /** Focused punch list row; same rules as Intake (persists across tabs while set). */
  focusedPunchList?: SuziFocusedPunchList | null;
  /** Focused reminder row (Reminders tab). */
  focusedReminder?: SuziFocusedReminder | null;
  /** Focused note card (Notes tab). */
  focusedNote?: SuziFocusedNote | null;
};

type TabSpec = {
  uiLabel: string;
  primaryTool: "punch_list" | "reminders" | "notes" | "intake";
  purpose: string;
  commands: string;
  ids: string;
};

const TABS: Record<SuziWorkSubTab, TabSpec> = {
  punchlist: {
    uiLabel: "Punch List",
    primaryTool: "punch_list",
    purpose:
      "Engineering / ops tasks in Kanban columns (Now, Later, Next, Sometime, Backlog, Idea). Not calendar reminders, not reference notes, not Intake captures.",
    commands:
      "punch_list: list | add (NEW item only) | update | done / close_out / finish / close this out / duplicate — use **focused item_number** when **ACTIVE PUNCH LIST TARGET** (green card on board) is in context and user did not name another # | reopen | archive | archive_done | **note** (Inspect **Notes** — journal only) | **action_add** / **action_toggle** (Inspect **Actions** — user “action item” / subtask / checkbox). After done, reply briefly; do not list-hunt or ask which # when green-target context is present.",
    ids: "Item numbers on cards (e.g. 1001). Comma-separate for batch done.",
  },
  reminders: {
    uiLabel: "Reminders",
    primaryTool: "reminders",
    purpose:
      "Time-based items: birthdays, holidays, recurring checks, one-time due tasks. Uses due dates and optional recurrence (Pacific). For arbitrary reference facts without a schedule, use the notes tool and the Notes tab — not this tool.",
    commands:
      "reminders: list | search | add | update | delete | upcoming. add requires category (birthday, holiday, recurring, one-time) and usually a date.",
    ids: "Reminder UUID from list/search output (id: …).",
  },
  notes: {
    uiLabel: "Notes",
    primaryTool: "notes",
    purpose:
      "Durable reference notes Govind browses in the Notes tab — facts, preferences, snippets. Separate from reminders, punch_list, and Intake (links/snippets inbox).",
    commands:
      "notes: list | add | update | delete | search. Use note_number (#5001-style) from list output when editing.",
    ids: "note_number (e.g. 5001) or UUID.",
  },
  intake: {
    uiLabel: "Intake",
    primaryTool: "intake",
    purpose:
      "Capture inbox in the Intake tab — links, snippets, things to triage later (may become punch list or article research later). Not structured notes (use notes) and not scheduled items (use reminders). Items can also arrive via Share (Android PWA) or inbound email webhook.",
    commands:
      "intake: list | add | update | delete | archive | search. **Promote to punch list:** when **Focused Intake** is in context and user wants this on the board — **punch_list add** first (short new title, full intake in description, rank **now**, infer **category**), then **intake archive** with **id**. delete/archive remove from queue. filterQuery with itemNumber when Intake search matches screen.",
    ids: "UUID from list output (id: …).",
  },
};

/**
 * One-line muted hints in Suzi’s work sub-tab header (human UI).
 * Commands echo `TABS` tool verbs (see PROJECT-MEMORY for agent-first UI defaults).
 */
export const SUZI_WORK_TAB_HEADER_HINT: Record<SuziWorkSubTab, string> = {
  intake: "List · Add · Search · Archive · Promote To Punch List",
  punchlist: "Add · Update · Done · Inspect · Drag Columns",
  reminders: "List · Add · Search · Update · Delete · Upcoming",
  notes: "List · Add · Search · Update · Tags · Note Numbers",
};

/** Class for small low-contrast “human fallback” actions in the Suzi work sub-tab header (e.g. Intake add). */
export const SUZI_WORK_PANEL_FALLBACK_BTN_CLASS =
  "shrink-0 text-[9px] sm:text-[10px] leading-none px-1.5 py-0.5 rounded border border-[#5b8eb8]/55 bg-transparent font-normal text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--accent-blue)]/12 hover:border-[#7aa8d4]/65 whitespace-nowrap transition-colors";

const GLOBAL_TOOLS =
  "Also available: web_search, memory (your long-term agent memory — not the Notes tab).";

/** When the work panel is closed, remind the model tools still apply from chat. */
const PANEL_CLOSED_HINT =
  "Suzi's work panel is closed (Agent info or another view). The user may still ask to change punch list, reminders, notes, or intake — use the correct tool from their request; open the work panel to mirror the same tabs.";

export function formatSuziWorkPanelContext(input: SuziWorkPanelContextInput): string {
  const focusAppend = [
    input.focusedIntake?.id ? formatFocusedIntakeSection(input.focusedIntake) : "",
    input.focusedPunchList?.id ? formatFocusedPunchListSection(input.focusedPunchList) : "",
    input.focusedReminder?.id ? formatFocusedReminderSection(input.focusedReminder) : "",
    input.focusedNote?.id ? formatFocusedNoteSection(input.focusedNote) : "",
  ].join("");

  if (!input.workPanelOpen) {
    return [
      "## Suzi — UI context",
      PANEL_CLOSED_HINT,
      "",
      "### Tab ↔ tool (reference)",
      `- **${TABS.intake.uiLabel}** → \`intake\` — ${TABS.intake.purpose}`,
      `- **${TABS.punchlist.uiLabel}** → \`punch_list\` — ${TABS.punchlist.purpose}`,
      `- **${TABS.reminders.uiLabel}** → \`reminders\` — ${TABS.reminders.purpose}`,
      `- **${TABS.notes.uiLabel}** → \`notes\` — ${TABS.notes.purpose}`,
      "",
      GLOBAL_TOOLS,
      focusAppend,
    ].join("\n");
  }

  const spec = TABS[input.subTab];
  const punchMustUseTool =
    input.subTab === "punchlist"
      ? [
          "",
          "**Execution rule (Punch List tab):** When the user asks to add, move, complete, archive, or list punch-list items, you must complete a **real** `punch_list` tool call in this turn (via the API). Do not only describe or show JSON — that does not change the board.",
        ]
      : [];

  const intakeMustUseTool =
    input.subTab === "intake"
      ? [
          "",
          "**Execution rule (Intake tab):** When the user asks to add, remove, list, or search Intake captures, you must complete a **real** `intake` tool call in this turn. Do not claim you saved something without calling the tool.",
        ]
      : [];

  const remindersMustUseTool =
    input.subTab === "reminders"
      ? [
          "",
          "**Execution rule (Reminders tab):** When the user asks to add, change, remove, or list reminders, you must complete a **real** `reminders` tool call in this turn when data should change.",
        ]
      : [];

  const notesMustUseTool =
    input.subTab === "notes"
      ? [
          "",
          "**Execution rule (Notes tab):** When the user asks to add, edit, remove, or search Notes-tab notes, you must complete a **real** `notes` tool call in this turn when data should change.",
        ]
      : [];

  return [
    "## Suzi — active work panel",
    `The user has the **${spec.uiLabel}** tab open in the right work panel.`,
    "",
    `**Primary tool:** \`${spec.primaryTool}\``,
    spec.purpose,
    ...punchMustUseTool,
    ...intakeMustUseTool,
    ...remindersMustUseTool,
    ...notesMustUseTool,
    "",
    "**Commands:**",
    spec.commands,
    "",
    "**IDs:**",
    spec.ids,
    "",
    GLOBAL_TOOLS,
    focusAppend,
  ].join("\n");
}
