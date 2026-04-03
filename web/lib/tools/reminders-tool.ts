import {
  listReminders,
  getUpcomingReminders,
  addReminder,
  updateReminder,
  deleteReminder,
  getReminderByPublicRef,
} from "../reminders";
import type { ToolModule } from "./types";

const tool: ToolModule = {
  metadata: {
    id: "reminders",
    displayName: "Reminders",
    category: "internal",
    description:
      "Time-based reminders (birthdays, holidays, recurring, one-time due). Suzi checks due items via heartbeat. Reference notes live in the notes tool / Notes tab — not here.",
    operations: ["list", "search", "add", "update", "delete", "upcoming"],
    requiresApproval: false,
  },

  declaration: {
    name: "reminders",
    description:
      "Scheduled and due-date reminders only: birthdays, holidays, recurring events, one-time tasks with a when. Commands: list (optional category filter), search, add, update, delete, upcoming. Each row has a stable **public_ref** (e.g. RM0012) in list output — use **public_ref** or **id** for update/delete. Categories for new items: birthday, holiday, recurring, one-time. Recurrence: yearly, monthly, weekly, daily. For arbitrary reference facts, preferences, or snippets without a schedule, use the **notes** tool (Notes tab) — do not use this tool for that. Legacy DB rows may still have category `note`; prefer **notes** tool for new reference content.",
    parameters: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description: "list, search, add, update, delete, or upcoming",
        },
        title: {
          type: "string",
          description: "Reminder title (for add/update)",
        },
        description: {
          type: "string",
          description: "Optional details (for add/update)",
        },
        category: {
          type: "string",
          description:
            "For add: birthday | holiday | recurring | one-time. For list filter: same, or note for legacy rows only. New reference text → notes tool.",
        },
        date: {
          type: "string",
          description:
            "ISO date/datetime for when it's due. For date-only birthdays/holidays use noon Pacific, e.g. 2026-03-28T12:00:00-07:00. ALWAYS include US Pacific timezone offset (for add/update)",
        },
        recurrence: {
          type: "string",
          description:
            "yearly, monthly, weekly, daily — omit for one-time (for add/update)",
        },
        advance_days: {
          type: "string",
          description:
            "Days before the date to start reminding, default 0 (for add/update)",
        },
        query: {
          type: "string",
          description: "Search term (for search command)",
        },
        id: {
          type: "string",
          description: "Reminder UUID (for update/delete)",
        },
        public_ref: {
          type: "string",
          description: "Stable ref like RM0012 (alternative to id for update/delete)",
        },
      },
      required: ["command"],
    },
  },

  async execute(args, { agentId }) {
    const cmd = args.command;

    if (cmd === "list") {
      const items = await listReminders(agentId, { category: args.category });
      if (items.length === 0) return "No reminders found.";
      return items
        .map(
          (r) =>
            `[${r.category}] ${r.publicRef} ${r.title}${r.nextDueAt ? ` — due: ${new Date(r.nextDueAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}${r.recurrence ? ` (${r.recurrence})` : ""}${r.description ? ` — ${r.description}` : ""} (id: ${r.id})`
        )
        .join("\n");
    }

    if (cmd === "search") {
      if (!args.query) return "Error: query is required for search";
      const items = await listReminders(agentId, { search: args.query });
      if (items.length === 0) return "No reminders matching that query.";
      return items
        .map(
          (r) =>
            `[${r.category}] ${r.publicRef} ${r.title}${r.nextDueAt ? ` — due: ${new Date(r.nextDueAt).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric" })}` : ""} (id: ${r.id})`
        )
        .join("\n");
    }

    if (cmd === "add") {
      if (!args.title) return "Error: title is required";
      if (!args.category)
        return "Error: category is required: birthday, holiday, recurring, or one-time (use notes tool for reference snippets without a due date)";

      let dateStr: string | undefined = args.date;
      if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        dateStr = `${dateStr}T12:00:00-07:00`;
      }

      let anchor: Record<string, number> | undefined;
      if (args.recurrence === "yearly" && dateStr) {
        const d = new Date(dateStr);
        anchor = {
          month: d.toLocaleString("en-US", {
            timeZone: "America/Los_Angeles",
            month: "numeric",
          }) as unknown as number,
          day: parseInt(
            d.toLocaleString("en-US", {
              timeZone: "America/Los_Angeles",
              day: "numeric",
            })
          ),
        };
      } else if (args.recurrence === "monthly" && dateStr) {
        const d = new Date(dateStr);
        anchor = {
          dayOfMonth: parseInt(
            d.toLocaleString("en-US", {
              timeZone: "America/Los_Angeles",
              day: "numeric",
            })
          ),
        };
      } else if (args.recurrence === "weekly" && dateStr) {
        const d = new Date(dateStr);
        anchor = { dayOfWeek: d.getDay() };
      } else if (args.recurrence === "daily") {
        anchor = {};
      }

      const reminder = await addReminder(agentId, {
        category: args.category,
        title: args.title,
        description: args.description,
        nextDueAt: dateStr || undefined,
        recurrence: args.recurrence,
        recurrenceAnchor: anchor,
        advanceNoticeDays: args.advance_days ? parseInt(args.advance_days) : 0,
      });
      return `Reminder created: ${reminder.publicRef} "${reminder.title}" [${reminder.category}]${reminder.nextDueAt ? ` due ${new Date(reminder.nextDueAt).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric" })}` : ""}${reminder.recurrence ? ` (${reminder.recurrence})` : ""} (id: ${reminder.id})`;
    }

    if (cmd === "update") {
      let targetId = args.id?.trim() || "";
      if (!targetId && args.public_ref?.trim()) {
        const row = await getReminderByPublicRef(agentId, args.public_ref.trim());
        if (!row) return `Error: Reminder ${args.public_ref} not found.`;
        targetId = row.id;
      }
      if (!targetId) return "Error: id or public_ref is required for update";
      const updates: Record<string, unknown> = {};
      if (args.title) updates.title = args.title;
      if (args.description) updates.description = args.description;
      if (args.category) updates.category = args.category;
      if (args.date) {
        let ud = args.date;
        if (/^\d{4}-\d{2}-\d{2}$/.test(ud)) ud = `${ud}T12:00:00-07:00`;
        updates.nextDueAt = ud;
      }
      if (args.recurrence) updates.recurrence = args.recurrence;
      if (args.advance_days)
        updates.advanceNoticeDays = parseInt(args.advance_days);
      await updateReminder(targetId, updates);
      return `Reminder updated.`;
    }

    if (cmd === "delete") {
      let targetId = args.id?.trim() || "";
      if (!targetId && args.public_ref?.trim()) {
        const row = await getReminderByPublicRef(agentId, args.public_ref.trim());
        if (!row) return `Error: Reminder ${args.public_ref} not found.`;
        targetId = row.id;
      }
      if (!targetId) return "Error: id or public_ref is required for delete";
      await deleteReminder(targetId);
      return `Reminder deleted.`;
    }

    if (cmd === "upcoming") {
      const items = await getUpcomingReminders(agentId);
      if (items.length === 0) return "No upcoming reminders.";
      return items
        .map(
          (r) =>
            `[${r.category}] ${r.publicRef} ${r.title} — ${r.nextDueAt ? new Date(r.nextDueAt).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric" }) : "no date"}${r.advanceNoticeDays > 0 ? ` (${r.advanceNoticeDays}d advance notice)` : ""}${r.description ? ` — ${r.description}` : ""}`
        )
        .join("\n");
    }

    return "Unknown reminders command. Use: list, search, add, update, delete, upcoming";
  },
};

export default tool;
