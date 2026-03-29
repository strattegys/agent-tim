"use client";

import { useState, useEffect } from "react";
import KanbanInlinePanel from "@/components/kanban/KanbanInlinePanel";
import MarniKnowledgePanel from "./MarniKnowledgePanel";

export type MarniWorkPanelTab = "queue" | "knowledge";

interface MarniWorkPanelProps {
  onClose: () => void;
  /** Chat UI: active tab for ephemeral agent context. */
  onWorkTabChange?: (tab: MarniWorkPanelTab) => void;
}

/**
 * Marni’s work panel: content-distribution pipeline (inline Kanban) and Knowledge Base, like Tim’s multi-tab work panel.
 */
export default function MarniWorkPanel({ onClose, onWorkTabChange }: MarniWorkPanelProps) {
  const [tab, setTab] = useState<MarniWorkPanelTab>("queue");

  useEffect(() => {
    onWorkTabChange?.(tab);
  }, [tab, onWorkTabChange]);

  return (
    <div className="flex-1 bg-[var(--bg-primary)] flex flex-col overflow-hidden min-w-0">
      <div className="h-10 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center px-2 gap-0.5">
        {(["queue", "knowledge"] as const).map((key) => {
          const label = key === "queue" ? "Work Queue" : "Knowledge Base";
          const isActive = tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`text-xs px-2 py-1 rounded cursor-pointer transition-colors ${
                isActive
                  ? "font-semibold text-[var(--text-primary)]"
                  : "font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              }`}
            >
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </div>
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {tab === "queue" ? (
          <KanbanInlinePanel onClose={onClose} agentId="marni" />
        ) : (
          <MarniKnowledgePanel embedded onClose={onClose} />
        )}
      </div>
    </div>
  );
}
