"use client";

import { useState } from "react";
import KanbanColumn, { type StageConfig } from "./KanbanColumn";
import type { Person, PersonAlert } from "./KanbanCard";

export const STAGES: StageConfig[] = [
  { key: "TARGET", label: "Target", color: "#6b8a9e" },
  { key: "INITIATED", label: "Initiated", color: "#2b5278" },
  { key: "ACCEPTED", label: "Accepted", color: "#534AB7" },
  { key: "MESSAGED", label: "Messaged", color: "#7c5bbf" },
  { key: "ENGAGED", label: "Engaged", color: "#1D9E75" },
  { key: "PROSPECT", label: "Prospect", color: "#D85A30" },
  { key: "CONVERTED", label: "Converted", color: "#22c55e" },
];

const PAGE_SIZE = 6;

interface KanbanBoardProps {
  people: Person[];
  alerts: Record<string, PersonAlert>;
  selectedPersonId: string | null;
  onSelectPerson: (person: Person) => void;
}

export default function KanbanBoard({
  people,
  alerts,
  selectedPersonId,
  onSelectPerson,
}: KanbanBoardProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Group people by stage
  const grouped = new Map<string, Person[]>();
  for (const stage of STAGES) {
    grouped.set(stage.key, []);
  }
  for (const person of people) {
    const key = person.stage || "TARGET";
    const list = grouped.get(key);
    if (list) {
      list.push(person);
    } else {
      grouped.get("TARGET")!.push(person);
    }
  }

  // Find the max column size to know if there's more to show
  let maxColumnSize = 0;
  for (const list of grouped.values()) {
    if (list.length > maxColumnSize) maxColumnSize = list.length;
  }

  const hasMore = visibleCount < maxColumnSize;
  const showing = Math.min(visibleCount, maxColumnSize);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Columns */}
      <div className="flex gap-3 overflow-x-auto flex-1 min-h-0 px-3 pt-3">
        {STAGES.map((stage) => (
          <KanbanColumn
            key={stage.key}
            stage={stage}
            people={grouped.get(stage.key) || []}
            alerts={alerts}
            visibleCount={visibleCount}
            selectedPersonId={selectedPersonId}
            onSelectPerson={onSelectPerson}
          />
        ))}
      </div>

      {/* Footer — page controls */}
      <div className="shrink-0 h-10 border-t border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center justify-center gap-4 px-4">
        {visibleCount > PAGE_SIZE && (
          <button
            onClick={() => setVisibleCount(PAGE_SIZE)}
            className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            Back to top
          </button>
        )}
        {hasMore ? (
          <button
            onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
            className="text-xs text-[var(--accent-blue)] hover:underline cursor-pointer flex items-center gap-1"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
            Show more (showing {showing} of {maxColumnSize} max)
          </button>
        ) : maxColumnSize > 0 ? (
          <span className="text-xs text-[var(--text-tertiary)]">
            Showing all ({maxColumnSize} max per column)
          </span>
        ) : null}
      </div>
    </div>
  );
}
