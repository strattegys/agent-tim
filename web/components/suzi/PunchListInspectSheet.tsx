"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import type { PunchListItem } from "@/lib/punch-list";
import { panelBus } from "@/lib/events";

interface PunchListInspectSheetProps {
  item: PunchListItem;
  columnLabel: string;
  onClose: () => void;
  isFocusedForSuzi: boolean;
  onClearSuziFocus: () => void;
}

type ActionFilter = "all" | "open" | "done";

const ACTION_FILTERS: { key: ActionFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "done", label: "Done" },
];

/**
 * Fixed 90% of the overlay height (area below Suzi sub-tabs down to panel bottom). Does not
 * shrink when inner content is short — shrink-0 + min-h match h so flex centering cannot collapse it.
 */
const INSPECT_PANEL_CLASS =
  "relative z-10 flex h-[90%] min-h-[90%] w-2/3 shrink-0 min-w-0 max-h-full max-w-full flex-col rounded-xl border-2 border-[var(--border-color)] bg-[var(--bg-primary)] shadow-2xl overflow-hidden";

/** Renders inside a `relative` kanban root so Suzi chat and the rest of the UI stay visible. */
export default function PunchListInspectSheet({
  item,
  columnLabel,
  onClose,
  isFocusedForSuzi,
  onClearSuziFocus,
}: PunchListInspectSheetProps) {
  const [actionFilter, setActionFilter] = useState<ActionFilter>("open");
  const [newActionText, setNewActionText] = useState("");
  const [savingAction, setSavingAction] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const notesNewestFirst = useMemo(() => {
    const list = [...(item.notes || [])];
    list.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    return list;
  }, [item.notes]);

  const filteredActions = useMemo(() => {
    const list = [...(item.actions || [])];
    if (actionFilter === "open") return list.filter((a) => !a.done);
    if (actionFilter === "done") return list.filter((a) => a.done);
    return list;
  }, [item.actions, actionFilter]);

  const refreshBoard = useCallback(() => {
    panelBus.emit("punch_list");
  }, []);

  const toggleAction = async (actionId: string, done: boolean) => {
    setTogglingId(actionId);
    try {
      const res = await fetch("/api/punch-list/actions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: actionId, done }),
      });
      if (res.ok) refreshBoard();
    } finally {
      setTogglingId(null);
    }
  };

  const addAction = async () => {
    const t = newActionText.trim();
    if (!t || savingAction) return;
    setSavingAction(true);
    try {
      const res = await fetch("/api/punch-list/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id, content: t }),
      });
      if (res.ok) {
        setNewActionText("");
        refreshBoard();
      }
    } finally {
      setSavingAction(false);
    }
  };

  return (
    <div
      className="absolute inset-0 z-40 flex min-h-0 items-center justify-center p-2 sm:p-3 pointer-events-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="punch-inspect-title"
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
        aria-hidden
        onClick={onClose}
      />
      <div className={INSPECT_PANEL_CLASS}>
        <div className="shrink-0 px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] space-y-2">
          <div className="flex items-start gap-2">
            <h2
              id="punch-inspect-title"
              className={`text-sm font-semibold flex-1 min-w-0 leading-snug line-clamp-2 ${
                item.status === "done"
                  ? "line-through text-[var(--text-tertiary)]"
                  : "text-[var(--text-primary)]"
              }`}
            >
              <span className="tabular-nums">#{item.itemNumber}</span>
              <span className="text-[var(--text-tertiary)] font-normal"> · </span>
              {item.title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 self-center px-2 py-1 text-xs rounded-md border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)]"
            >
              Close
            </button>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-[var(--text-secondary)]">
            <span className="px-2 py-0.5 rounded-md bg-[var(--bg-primary)] border border-[var(--border-color)]">
              {columnLabel}
            </span>
            <span className="px-2 py-0.5 rounded-md bg-[var(--bg-primary)] border border-[var(--border-color)]">
              {item.status === "open" ? "Open" : "Done"}
            </span>
            {item.category && (
              <span className="px-2 py-0.5 rounded-md bg-[var(--bg-primary)] border border-[var(--border-color)]">
                {item.category}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-1 min-h-0 flex-col overflow-hidden p-3 pt-2">
          {/* Left: description (60%) · Right: 60% actions / 40% notes (column height) */}
          <div className="flex min-h-0 flex-1 flex-row gap-3 overflow-hidden">
            <div className="w-[60%] min-w-0 h-full flex flex-col min-h-0">
              <p className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)] mb-1 shrink-0">
                Description
              </p>
              <div className="min-h-0 flex-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] overflow-y-auto overflow-x-hidden px-2.5 py-2">
                {item.description?.trim() ? (
                  <p className="text-sm text-[var(--text-chat-body)] whitespace-pre-wrap break-words leading-relaxed">
                    {item.description}
                  </p>
                ) : (
                  <p className="text-sm text-[var(--text-tertiary)] italic">No description.</p>
                )}
              </div>
            </div>

            <div className="w-[40%] min-w-0 h-full min-h-0 grid grid-rows-[3fr_2fr] gap-2 border-l border-[var(--border-color)] pl-3">
              <div className="min-h-0 flex h-full min-w-0 flex-col border border-[var(--border-color)] rounded-lg bg-[var(--bg-secondary)]/40 overflow-hidden">
                <div className="shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1 space-y-1">
                  <p className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">
                    Actions {item.actions?.length ? `(${item.actions.length})` : ""}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {ACTION_FILTERS.map(({ key, label }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setActionFilter(key)}
                        className={`text-[9px] px-2 py-0.5 rounded-full cursor-pointer transition-colors ${
                          actionFilter === key
                            ? "bg-[var(--accent-green)]/90 text-[var(--text-primary)] font-medium"
                            : "bg-[var(--bg-primary)] text-[var(--text-tertiary)] border border-[var(--border-color)] hover:text-[var(--text-chat-body)]"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1.5">
                  {!filteredActions.length ? (
                    <p className="text-[11px] text-[var(--text-tertiary)] italic leading-snug">
                      {actionFilter === "open"
                        ? "No open actions."
                        : actionFilter === "done"
                          ? "No completed actions."
                          : "No actions yet."}
                    </p>
                  ) : (
                    filteredActions.map((a) => (
                      <label
                        key={a.id}
                        className={`flex items-start gap-1.5 rounded-md px-1 py-0.5 cursor-pointer hover:bg-[var(--bg-secondary)] ${
                          a.done ? "opacity-70" : ""
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={a.done}
                          disabled={togglingId === a.id}
                          onChange={(e) => toggleAction(a.id, e.target.checked)}
                          className="mt-0.5 shrink-0 rounded border-[var(--border-color)] scale-90"
                        />
                        <span
                          className={`text-[11px] text-[var(--text-chat-body)] break-words min-w-0 leading-snug ${
                            a.done ? "line-through text-[var(--text-tertiary)]" : ""
                          }`}
                        >
                          {a.content}
                        </span>
                      </label>
                    ))
                  )}
                </div>
                <div className="shrink-0 border-t border-[var(--border-color)] p-1.5 flex gap-1 bg-[var(--bg-secondary)]/60">
                  <input
                    type="text"
                    value={newActionText}
                    onChange={(e) => setNewActionText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void addAction();
                      }
                    }}
                    placeholder="New action…"
                    className="flex-1 min-w-0 text-[11px] px-1.5 py-0.5 rounded-md bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-chat-body)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--accent-green)]"
                  />
                  <button
                    type="button"
                    disabled={savingAction || !newActionText.trim()}
                    onClick={() => void addAction()}
                    className="shrink-0 text-[11px] px-1.5 py-0.5 rounded-md border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40"
                  >
                    Add
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex h-full min-w-0 flex-col border border-[var(--border-color)] rounded-lg bg-[var(--bg-secondary)]/40 overflow-hidden">
                <p className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--text-tertiary)] px-2.5 py-1.5 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
                  Notes {item.notes?.length ? `(${item.notes.length})` : ""}
                </p>
                <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-3">
                  {!notesNewestFirst.length ? (
                    <p className="text-xs text-[var(--text-tertiary)] italic">No notes yet.</p>
                  ) : (
                    notesNewestFirst.map((note) => (
                      <div
                        key={note.id}
                        className="pl-2 border-l-2 border-[var(--border-color)] text-sm text-[var(--text-chat-body)] whitespace-pre-wrap break-words"
                      >
                        <p className="text-[10px] text-[var(--text-tertiary)] mb-1 tabular-nums">
                          {new Date(note.createdAt).toLocaleString("en-US", {
                            timeZone: "America/Los_Angeles",
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </p>
                        {note.content}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="shrink-0 border-t border-[var(--border-color)] px-3 py-2 bg-[var(--bg-secondary)] flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] text-[var(--text-tertiary)]">
            {isFocusedForSuzi
              ? "This card is active for Suzi (green ring on the board). Chat stays visible beside the board."
              : "Focus this card from the board to pin Suzi context."}
          </p>
          {isFocusedForSuzi && (
            <button
              type="button"
              onClick={onClearSuziFocus}
              className="text-xs px-2 py-1 rounded-md border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] shrink-0"
            >
              Clear Suzi focus
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
