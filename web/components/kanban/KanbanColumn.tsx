"use client";

import { useState } from "react";
import KanbanCard, { type Person, type PersonAlert } from "./KanbanCard";

export interface StageConfig {
  key: string;
  label: string;
  color: string;
}

const PAGE_SIZE = 6;

interface KanbanColumnProps {
  stage: StageConfig;
  people: Person[];
  alerts: Record<string, PersonAlert>;
  selectedPersonId: string | null;
  onSelectPerson: (person: Person) => void;
}

export default function KanbanColumn({
  stage,
  people,
  alerts,
  selectedPersonId,
  onSelectPerson,
}: KanbanColumnProps) {
  const [page, setPage] = useState(0);
  const alertCount = people.filter((p) => alerts[p.id]).length;

  // Sort: people with alerts first, then alphabetical
  const sorted = [...people].sort((a, b) => {
    const aAlert = alerts[a.id] ? 0 : 1;
    const bAlert = alerts[b.id] ? 0 : 1;
    if (aAlert !== bAlert) return aAlert - bAlert;
    return (a.firstName || "").localeCompare(b.firstName || "");
  });

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const visible = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="flex flex-col min-w-[220px] w-[220px] shrink-0 overflow-hidden">
      {/* Column header */}
      <div className="flex items-center gap-2 px-2 py-2">
        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: stage.color }} />
        <span className="text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wide">
          {stage.label}
        </span>
        {alertCount > 0 && (
          <span className="text-[10px] bg-orange-400/20 text-orange-400 px-1.5 py-0.5 rounded-full font-medium">
            {alertCount}
          </span>
        )}
        <span className="text-xs text-[var(--text-tertiary)] ml-auto">{people.length}</span>
      </div>

      {/* Cards — fixed 6-row grid so all cards are identical height */}
      <div className="grid grid-rows-6 flex-1 min-h-0 px-1 gap-2 overflow-hidden">
        {visible.map((person) => (
          <div key={person.id} className="min-h-0 overflow-hidden">
            <KanbanCard
              person={person}
              alert={alerts[person.id]}
              isSelected={person.id === selectedPersonId}
              onClick={() => onSelectPerson(person)}
            />
          </div>
        ))}
        {people.length === 0 && (
          <div className="text-xs text-[var(--text-tertiary)] text-center py-4 italic flex-1 flex items-center justify-center">
            No contacts
          </div>
        )}
      </div>

      {/* Column footer — page controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-2 py-1.5 mt-1 border-t border-[var(--border-color)]">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30 disabled:cursor-default cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </button>
          <span className="text-[10px] text-[var(--text-tertiary)]">
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30 disabled:cursor-default cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
