"use client";

import { useState, type ReactNode } from "react";
import { PUNCH_LIST_RANK_COLORS } from "@/lib/punch-list-columns";
import type { PunchListItem, PunchListNote } from "@/lib/punch-list";

export type { PunchListItem, PunchListNote };

function InspectIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

interface PunchListCardProps {
  item: PunchListItem;
  /** Top row, right side next to item # (e.g. drag grip). */
  dragHandle?: ReactNode;
  /** Green ring — Suzi chat context / Inspect target. */
  isFocused?: boolean;
  /** Click anywhere on the card (except Inspect / drag / note control) toggles Suzi focus. */
  onToggleSuziFocus?: () => void;
  /** Open full detail sheet (also sets Suzi focus from panel). */
  onInspect?: () => void;
}

export default function PunchListCard({
  item,
  dragHandle,
  isFocused = false,
  onToggleSuziFocus,
  onInspect,
}: PunchListCardProps) {
  const [expanded, setExpanded] = useState(false);
  const rankColor = PUNCH_LIST_RANK_COLORS[item.rank] || "#9CA3AF";
  const isDone = item.status === "done";
  /** Notes from API are newest-first; index 0 is the latest. */
  const latestNote = item.notes?.[0];
  const noteCount = item.notes?.length || 0;

  const body = (
    <>
      {/* Title — full card width below the # + chrome row */}
      <p
        className={`text-[11px] font-medium text-[var(--text-chat-body)] leading-snug w-full min-w-0 break-words mt-3.5 ${
          isDone ? "line-through text-[var(--text-tertiary)]" : ""
        }`}
      >
        {item.title}
      </p>

      {/* Latest note only — up to 3 lines */}
      {latestNote && !expanded && (
        <div className="mt-2 mb-1 pl-1.5 border-l-2 border-[var(--border-color)] min-w-0">
          <p className="text-[10px] text-[var(--text-tertiary)] line-clamp-3 italic py-0.5 break-words">
            {latestNote.content}
          </p>
        </div>
      )}

      {/* Expanded notes */}
      {expanded && noteCount > 0 && (
        <div className="mt-2 mb-1 space-y-2">
          {item.notes.map((note) => (
            <div key={note.id} className="pl-1.5 border-l-2 border-[var(--border-color)]">
              <p className="text-[10px] text-[var(--text-tertiary)] italic py-0.5">
                {note.content}
              </p>
              <span className="text-[8px] text-[var(--text-tertiary)]">
                {new Date(note.createdAt).toLocaleDateString("en-US", {
                  timeZone: "America/Los_Angeles",
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Meta row */}
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        {item.category && (
          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-[var(--bg-secondary)] text-[var(--text-tertiary)] border border-[var(--border-color)]">
            {item.category}
          </span>
        )}
        {noteCount > 0 && (
          <button
            type="button"
            draggable={false}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="text-[8px] text-[var(--text-secondary)] hover:text-[var(--accent-green)] underline-offset-2 hover:underline cursor-pointer ml-auto"
          >
            {expanded ? "hide" : `${noteCount}`}
          </button>
        )}
      </div>
    </>
  );

  /** Item # shares top row with controls; title/note sit full width below. */
  const chrome = (
    <div className="shrink-0 self-start flex flex-row gap-2.5 items-start">
      {onInspect && (
        <button
          type="button"
          draggable={false}
          title="Inspect — title, description, all notes"
          aria-label="Inspect punch list item"
          onClick={(e) => {
            e.stopPropagation();
            onInspect();
          }}
          className="w-7 h-7 flex items-center justify-center rounded-md cursor-pointer bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-secondary)] shadow-sm hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
        >
          <InspectIcon />
        </button>
      )}
      {dragHandle ? (
        <div
          className="shrink-0"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {dragHandle}
        </div>
      ) : null}
    </div>
  );

  const selectable = Boolean(onToggleSuziFocus);
  const hasChrome = Boolean(dragHandle || onInspect);

  const headerRow = (
    <div className="flex items-start justify-between gap-3 min-w-0">
      <span
        className="text-[11px] font-semibold shrink-0 opacity-80 tabular-nums"
        style={{ color: rankColor }}
      >
        {item.publicRef}
      </span>
      {hasChrome ? chrome : null}
    </div>
  );

  return (
    <div
      onClick={selectable ? () => onToggleSuziFocus?.() : undefined}
      onKeyDown={
        selectable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onToggleSuziFocus?.();
              }
            }
          : undefined
      }
      tabIndex={selectable ? 0 : undefined}
      title={selectable ? "Tap to select for Suzi (green ring). Tap again to clear." : undefined}
      className={`rounded px-2.5 py-2.5 transition-[box-shadow,border-color] bg-[var(--bg-primary)] min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-green)]/60 ${
        selectable ? "cursor-pointer" : ""
      } ${
        isFocused
          ? "border-2 border-[var(--accent-green)] shadow-[0_0_0_1px_var(--accent-green)]"
          : "border border-[var(--border-color)]"
      }`}
    >
      <div className={`flex flex-col min-w-0 w-full ${isDone ? "opacity-50" : ""}`}>
        {headerRow}
        {body}
      </div>
    </div>
  );
}
