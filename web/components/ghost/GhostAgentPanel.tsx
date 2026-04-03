"use client";

import { useState, useEffect } from "react";
import type { GhostWorkQueueSelection } from "@/lib/ghost-work-context";
import type { AgentConfig } from "@/lib/agent-frontend";
import KanbanInlinePanel from "@/components/kanban/KanbanInlinePanel";
import GhostDashboardPanel from "./GhostDashboardPanel";
import GhostMessagesPanel from "./GhostMessagesPanel";

export type GhostWorkPanelTab = "dashboard" | "queue" | "board";

interface GhostAgentPanelProps {
  agent: AgentConfig;
  contentQueueCount?: number;
  onGhostWorkSelectionChange?: (selection: GhostWorkQueueSelection | null) => void;
}

/**
 * Ghost’s work panel: dashboard + content work queue + board.
 */
export default function GhostAgentPanel({
  agent: _agent,
  contentQueueCount = 0,
  onGhostWorkSelectionChange,
}: GhostAgentPanelProps) {
  const [tab, setTab] = useState<GhostWorkPanelTab>("queue");

  useEffect(() => {
    if (tab === "board") onGhostWorkSelectionChange?.(null);
  }, [tab, onGhostWorkSelectionChange]);

  return (
    <div className="flex-1 bg-[var(--bg-primary)] flex flex-col overflow-hidden min-w-0">
      <div className="h-10 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center px-2 gap-0.5">
        {(["dashboard", "queue", "board"] as const).map((key) => {
          const label =
            key === "dashboard" ? "Dashboard" : key === "queue" ? "Work Queue" : "Board";
          const isActive = tab === key;
          const count = key === "queue" ? contentQueueCount : 0;
          const showBadge = count > 0 && key === "queue";
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`text-xs px-2 py-1 rounded cursor-pointer transition-colors inline-flex items-center gap-1.5 max-sm:max-w-[32%] ${
                isActive
                  ? "font-semibold text-[var(--text-primary)]"
                  : "font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              }`}
            >
              <span className="truncate">{label}</span>
              {showBadge ? (
                <span
                  className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-medium tabular-nums flex items-center justify-center bg-[var(--bg-primary)] text-[var(--text-secondary)] border border-[var(--border-color)]"
                  title={`${count} item${count !== 1 ? "s" : ""}`}
                >
                  {count > 99 ? "99+" : count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {tab === "board" ? (
          <KanbanInlinePanel onClose={() => setTab("queue")} agentId="ghost" />
        ) : tab === "dashboard" ? (
          <GhostDashboardPanel />
        ) : (
          <GhostMessagesPanel embedded onWorkSelectionChange={onGhostWorkSelectionChange} />
        )}
      </div>
    </div>
  );
}
