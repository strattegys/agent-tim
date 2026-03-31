"use client";

import { useState, useEffect } from "react";
import HumanTasksPanel from "./HumanTasksPanel";
import ToolsPanel from "./ToolsPanel";
import ObservationPostPanel from "./ObservationPostPanel";

type Tab = "observation" | "tasks" | "tools";

interface FridayDashboardPanelProps {
  onClose?: () => void;
  onSwitchToAgent?: (agentId: string) => void;
  pendingTaskCount?: number;
  /** When opening from ?panel=tasks (maps to dashboard + this tab). */
  initialWorkTab?: Tab;
  /** Chat UI: which dashboard tab is active (including initial mount). */
  onDashboardTabChange?: (tab: Tab) => void;
}

export default function FridayDashboardPanel({
  onSwitchToAgent,
  pendingTaskCount = 0,
  initialWorkTab,
  onDashboardTabChange,
}: FridayDashboardPanelProps) {
  const [tab, setTab] = useState<Tab>(() =>
    initialWorkTab === "tasks" || initialWorkTab === "tools" || initialWorkTab === "observation"
      ? initialWorkTab
      : "observation"
  );

  useEffect(() => {
    onDashboardTabChange?.(tab);
  }, [tab, onDashboardTabChange]);

  const TABS: { key: Tab; label: string; count?: string }[] = [
    {
      key: "observation",
      label: "Observation Post",
    },
    {
      key: "tasks",
      label: "Human tasks",
      count: pendingTaskCount > 0 ? String(pendingTaskCount) : undefined,
    },
    {
      key: "tools",
      label: "Tools",
    },
  ];

  return (
    <div className="flex-1 bg-[var(--bg-primary)] flex flex-col overflow-hidden min-w-0">
      <div className="h-10 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center px-3 gap-2">
        {TABS.map((t) => {
          const isActive = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`text-xs px-2 py-1 rounded cursor-pointer transition-colors flex items-center gap-1.5 ${
                isActive
                  ? "font-semibold text-[var(--text-primary)]"
                  : "font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {t.label}
              {t.count ? (
                <span className="text-[10px] font-normal text-[var(--text-tertiary)] tabular-nums">{t.count}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {tab === "observation" ? (
        <ObservationPostPanel />
      ) : tab === "tools" ? (
        <ToolsPanel />
      ) : (
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <HumanTasksPanel
            onSwitchToAgent={onSwitchToAgent}
            packageStageFilter="ACTIVE"
          />
        </div>
      )}
    </div>
  );
}
