"use client";

import { useState } from "react";
import KanbanCard, { type ItemAlert } from "./KanbanCard";
import type { StageConfig, WorkflowItem } from "@/lib/board-types";

export type { StageConfig };

const PAGE_SIZE = 6;

interface KanbanColumnProps {
  stage: StageConfig;
  items: WorkflowItem[];
  alerts: Record<string, ItemAlert>;
  selectedItemId: string | null;
  onSelectItem: (item: WorkflowItem) => void;
}

export default function KanbanColumn({
  stage,
  items,
  alerts,
  selectedItemId,
  onSelectItem,
}: KanbanColumnProps) {
  const [page, setPage] = useState(0);
  // Alert count uses sourceId since alerts are keyed by person ID
  const alertCount = items.filter((i) => alerts[i.sourceId]).length;

  // Sort: items with alerts first, then alphabetical by title
  const sorted = [...items].sort((a, b) => {
    const aAlert = alerts[a.sourceId] ? 0 : 1;
    const bAlert = alerts[b.sourceId] ? 0 : 1;
    if (aAlert !== bAlert) return aAlert - bAlert;
    return (a.title || "").localeCompare(b.title || "");
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
        <span className="text-xs text-[var(--text-tertiary)] ml-auto">{items.length}</span>
      </div>

      {/* Cards — fixed 6-row grid so all cards are identical height */}
      <div className="grid grid-rows-6 flex-1 min-h-0 px-1 gap-2 overflow-hidden">
        {visible.map((item) => {
          const needsHumanAttention =
            item.humanTaskOpen === true || Boolean(stage.requiresHuman && stage.humanAction);
          return (
            <div key={item.id} className="min-h-0 overflow-hidden">
              <KanbanCard
                item={item}
                alert={alerts[item.sourceId]}
                isSelected={item.id === selectedItemId}
                onClick={() => onSelectItem(item)}
                needsHumanAttention={needsHumanAttention}
              />
            </div>
          );
        })}
        {items.length === 0 && (
          <div className="text-xs text-[var(--text-tertiary)] text-center py-4 italic flex-1 flex items-center justify-center">
            No items
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
