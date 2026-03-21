"use client";

import { useState } from "react";

export interface PunchListNote {
  id: string;
  itemId: string;
  content: string;
  createdAt: string;
}

export interface PunchListItem {
  id: string;
  itemNumber: number;
  agentId: string;
  title: string;
  description: string | null;
  category: string | null;
  rank: number;
  status: "open" | "done";
  notes: PunchListNote[];
  createdAt: string;
  updatedAt: string;
}

const RANK_COLORS: Record<number, string> = {
  1: "#EF4444",
  2: "#F97316",
  3: "#F59E0B",
  4: "#EAB308",
  5: "#84CC16",
  6: "#22C55E",
  7: "#6366F1",
  8: "#9CA3AF",
};

interface PunchListCardProps {
  item: PunchListItem;
}

export default function PunchListCard({
  item,
}: PunchListCardProps) {
  const [expanded, setExpanded] = useState(false);
  const rankColor = RANK_COLORS[item.rank] || "#9CA3AF";
  const isDone = item.status === "done";
  const latestNote = item.notes?.[0];
  const noteCount = item.notes?.length || 0;

  return (
    <div
      className={`rounded-lg border p-3 transition-colors ${
        isDone
          ? "border-[var(--border-color)] bg-[var(--bg-primary)] opacity-50"
          : "border-[var(--border-color)] bg-[var(--bg-secondary)]"
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Item number */}
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
          style={{ background: `${rankColor}22`, color: rankColor }}
        >
          <span className="text-[10px] font-bold">{item.itemNumber}</span>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Title */}
          <span
            className={`text-xs font-semibold text-[var(--text-primary)] ${
              isDone ? "line-through" : ""
            }`}
          >
            {item.title}
          </span>

          {/* Description */}
          {item.description && (
            <p className="text-[11px] text-[var(--text-secondary)] mt-0.5 line-clamp-2">
              {item.description}
            </p>
          )}

          {/* Latest note preview */}
          {latestNote && !expanded && (
            <div className="mt-1.5 pl-2 border-l-2 border-[var(--border-color)]">
              <p className="text-[11px] text-[var(--text-secondary)] line-clamp-1 italic">
                {latestNote.content}
              </p>
            </div>
          )}

          {/* Expanded notes */}
          {expanded && noteCount > 0 && (
            <div className="mt-1.5 space-y-1.5">
              {item.notes.map((note) => (
                <div key={note.id} className="pl-2 border-l-2 border-[var(--border-color)]">
                  <p className="text-[11px] text-[var(--text-secondary)] italic">
                    {note.content}
                  </p>
                  <span className="text-[9px] text-[var(--text-tertiary)]">
                    {new Date(note.createdAt).toLocaleDateString("en-US", {
                      timeZone: "America/Los_Angeles",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Meta row: rank badge, category, date, expand toggle */}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span
              className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
              style={{ background: `${rankColor}22`, color: rankColor }}
            >
              R{item.rank}
            </span>
            {item.category && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium bg-[var(--bg-primary)] text-[var(--text-secondary)] border border-[var(--border-color)]">
                {item.category}
              </span>
            )}
            <span className="text-[9px] text-[var(--text-tertiary)]">
              {new Date(item.createdAt).toLocaleDateString("en-US", {
                timeZone: "America/Los_Angeles",
                month: "short",
                day: "numeric",
              })}
            </span>
            {noteCount > 0 && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="text-[9px] text-[var(--accent-green)] hover:underline cursor-pointer ml-auto"
              >
                {expanded ? "collapse" : `${noteCount} note${noteCount > 1 ? "s" : ""}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
