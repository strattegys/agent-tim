"use client";

import { reminderRefUiLabel } from "@/lib/public-ref";

export interface Reminder {
  id: string;
  reminderNumber?: number;
  publicRef?: string;
  agentId: string;
  category: "birthday" | "holiday" | "recurring" | "one-time" | "fact" | "note";
  title: string;
  description: string | null;
  nextDueAt: string | null;
  recurrence: "yearly" | "monthly" | "weekly" | "daily" | null;
  recurrenceAnchor: Record<string, number> | null;
  advanceNoticeDays: number;
  lastDeliveredAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const CATEGORY_ICONS: Record<string, string> = {
  birthday: "\uD83C\uDF82",
  holiday: "\uD83C\uDF89",
  recurring: "\uD83D\uDD01",
  "one-time": "\uD83D\uDCCC",
  fact: "\uD83D\uDCA1",
  note: "\uD83D\uDCDD",
};

const CATEGORY_COLORS: Record<string, string> = {
  birthday: "#E879A8",
  holiday: "#D85A30",
  recurring: "#5B8DEF",
  "one-time": "#1D9E75",
  fact: "#A78BFA",
  note: "#A78BFA",
};

interface ReminderCardProps {
  reminder: Reminder;
  onToggle: (id: string, isActive: boolean) => void;
  onDelete: (id: string) => void;
  /** Green border — selected row for Suzi chat context. */
  isFocused?: boolean;
  onToggleSuziFocus?: () => void;
}

export default function ReminderCard({
  reminder,
  onToggle,
  onDelete,
  isFocused = false,
  onToggleSuziFocus,
}: ReminderCardProps) {
  const icon = CATEGORY_ICONS[reminder.category] || "\uD83D\uDD14";
  const catColor = CATEGORY_COLORS[reminder.category] || "#888";

  const dueDate = reminder.nextDueAt ? new Date(reminder.nextDueAt) : null;
  const dueLabel = dueDate
    ? dueDate.toLocaleDateString("en-US", {
        timeZone: "America/Los_Angeles",
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;
  // Show time for non-all-day reminders (not midnight)
  const dueTime = dueDate
    ? (() => {
        const t = dueDate.toLocaleTimeString("en-US", {
          timeZone: "America/Los_Angeles",
          hour: "numeric",
          minute: "2-digit",
        });
        // Skip if midnight (likely an all-day/date-only reminder)
        return t === "12:00 AM" ? null : t;
      })()
    : null;

  const isOverdue =
    reminder.nextDueAt && new Date(reminder.nextDueAt) < new Date();

  const reminderRefLabel = reminderRefUiLabel(reminder);

  const selectable = Boolean(onToggleSuziFocus);

  return (
    <div
      className={`rounded-lg border p-3 transition-[box-shadow,border-color,colors] ${
        isFocused
          ? "border-2 border-[var(--accent-green)] shadow-[0_0_0_1px_var(--accent-green)] bg-[var(--bg-secondary)]"
          : reminder.isActive
            ? "border border-[var(--border-color)] bg-[var(--bg-secondary)]"
            : "border border-[var(--border-color)] bg-[var(--bg-primary)] opacity-50"
      } ${selectable ? "cursor-pointer" : ""}`}
      onClick={selectable ? () => onToggleSuziFocus?.() : undefined}
      title={
        selectable
          ? isFocused
            ? "Focused for Suzi — tap to clear"
            : "Tap to focus for Suzi chat"
          : undefined
      }
    >
      <div className="flex items-start gap-2">
        {/* Icon */}
        <span className="text-base mt-0.5 shrink-0">{icon}</span>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {reminderRefLabel ? (
              <span className="text-[10px] font-bold font-mono tabular-nums px-1.5 py-0.5 rounded border border-[var(--border-color)] text-[var(--accent-green)] shrink-0">
                {reminderRefLabel}
              </span>
            ) : null}
            <span className="text-xs font-semibold text-[var(--text-primary)] truncate">
              {reminder.title}
            </span>
            <span
              className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0 font-medium"
              style={{
                background: `${catColor}22`,
                color: catColor,
              }}
            >
              {reminder.category}
            </span>
          </div>

          {reminder.description && (
            <p className="text-[11px] text-[var(--text-secondary)] mt-0.5 line-clamp-2">
              {reminder.description}
            </p>
          )}

          <div className="flex items-center gap-3 mt-1.5">
            {dueLabel && (
              <span
                className={`text-[10px] ${
                  isOverdue
                    ? "text-red-400"
                    : "text-[var(--text-tertiary)]"
                }`}
              >
                {isOverdue ? "Overdue: " : ""}
                {dueLabel}{dueTime ? ` at ${dueTime}` : ""}
              </span>
            )}
            {reminder.recurrence && (
              <span className="text-[10px] text-[var(--text-tertiary)]">
                {reminder.recurrence}
              </span>
            )}
            {reminder.advanceNoticeDays > 0 && (
              <span className="text-[10px] text-[var(--text-tertiary)]">
                {reminder.advanceNoticeDays}d notice
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onToggle(reminder.id, !reminder.isActive)}
            className="p-1 rounded cursor-pointer hover:bg-[var(--bg-primary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            title={reminder.isActive ? "Pause" : "Activate"}
          >
            {reminder.isActive ? (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            )}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(reminder.id);
            }}
            className="p-1 rounded cursor-pointer hover:bg-red-500/10 text-[var(--text-tertiary)] hover:text-red-400"
            title="Delete"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14H6L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
              <path d="M9 6V4h6v2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
