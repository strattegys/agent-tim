"use client";

import { useState, useEffect } from "react";
import type { MarniWorkQueueSelection } from "@/lib/marni-work-context";
import type { AgentConfig } from "@/lib/agent-frontend";
import KanbanInlinePanel from "@/components/kanban/KanbanInlinePanel";
import MarniDashboardPanel from "@/components/marni/MarniDashboardPanel";
import MarniMessagesPanel from "@/components/marni/MarniMessagesPanel";

export type MarniWorkPanelTab = "dashboard" | "queue" | "board";

interface MarniWorkPanelProps {
  agent: AgentConfig;
  onClose: () => void;
  onMarniWorkSelectionChange?: (selection: MarniWorkQueueSelection | null) => void;
}

/**
 * Marni’s work panel: placeholder dashboard, distribution work queue, Kanban board.
 */
export default function MarniWorkPanel({
  agent: _agent,
  onClose,
  onMarniWorkSelectionChange,
}: MarniWorkPanelProps) {
  const [tab, setTab] = useState<MarniWorkPanelTab>("queue");

  useEffect(() => {
    if (tab === "board" || tab === "dashboard") onMarniWorkSelectionChange?.(null);
  }, [tab, onMarniWorkSelectionChange]);

  return (
    <div className="flex-1 bg-[var(--bg-primary)] flex flex-col overflow-hidden min-w-0">
      <div className="h-10 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center px-2 gap-0.5">
        {(["dashboard", "queue", "board"] as const).map((key) => {
          const label =
            key === "dashboard" ? "Dashboard" : key === "queue" ? "Work Queue" : "Board";
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
              {label}
            </button>
          );
        })}
      </div>
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {tab === "board" ? (
          <KanbanInlinePanel onClose={onClose} agentId="marni" />
        ) : tab === "dashboard" ? (
          <MarniDashboardPanel />
        ) : (
          <MarniMessagesPanel embedded onWorkSelectionChange={onMarniWorkSelectionChange} />
        )}
      </div>
    </div>
  );
}
