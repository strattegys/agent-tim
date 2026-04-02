"use client";

import ToolsPanel from "./ToolsPanel";
import FridayGoalsPanel from "./FridayGoalsPanel";
import FridayCronPanel from "./FridayCronPanel";
import FridayPackageAdminPanel from "./FridayPackageAdminPanel";
import type { FridayArchitecturePane, FridayDashboardTab } from "@/lib/agent-ui-context";
import FridayArchitecturePanel from "./FridayArchitecturePanel";
import { useCronStatus, cronJobsWithErrors } from "@/lib/use-cron-status";
import { useMemo } from "react";

interface FridayDashboardPanelProps {
  onClose?: () => void;
  dashboardTab: FridayDashboardTab;
  onDashboardTabChange: (tab: FridayDashboardTab) => void;
  /** When true (NEXT_PUBLIC_HIDE_ARCHITECTURE_TAB), the Architecture tab is omitted. */
  architectureTabHidden?: boolean;
  architecturePane: FridayArchitecturePane;
  onArchitecturePaneChange: (pane: FridayArchitecturePane) => void;
}

export default function FridayDashboardPanel({
  onClose: _onClose,
  dashboardTab: tab,
  onDashboardTabChange,
  architectureTabHidden = false,
  architecturePane,
  onArchitecturePaneChange,
}: FridayDashboardPanelProps) {
  const { data: cronData } = useCronStatus(true);
  const cronErrors = useMemo(() => cronJobsWithErrors(cronData?.jobs), [cronData?.jobs]);

  const TABS: { key: FridayDashboardTab; label: string; title?: string }[] = useMemo(() => {
    const all: { key: FridayDashboardTab; label: string; title?: string }[] = [
      { key: "goals", label: "Goals", title: "Throughput vs daily/weekly targets (from workflow type registry)" },
      {
        key: "package-kanban",
        label: "Package Kanban",
        title: "Draft through completed — compact cards; open for planner, workflow steps, or live Kanban",
      },
      {
        key: "wf-templates",
        label: "Workflow templates",
        title: "Workflow types — stages, transitions, people vs content",
      },
      { key: "tools", label: "Tools", title: "Internal tools registry" },
      {
        key: "architecture",
        label: "Architecture",
        title: "Infrastructure diagram and visual code import graphs (dependency-cruiser → Mermaid)",
      },
      { key: "cron", label: "Cron", title: "All scheduled jobs — schedule, last run, status" },
    ];
    if (architectureTabHidden) return all.filter((t) => t.key !== "architecture");
    return all;
  }, [architectureTabHidden]);

  return (
    <div className="flex-1 bg-[var(--bg-primary)] flex flex-col overflow-hidden min-w-0">
      <div className="h-10 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center px-2 gap-1 overflow-x-auto">
        {TABS.map((t) => {
          const isActive = tab === t.key;
          const cronTabAlert = t.key === "cron" && cronErrors.length > 0;
          return (
            <button
              key={t.key}
              type="button"
              title={
                cronTabAlert
                  ? `${t.title ?? t.label} — ${cronErrors.length} error(s) on last run`
                  : t.title
              }
              onClick={() => onDashboardTabChange(t.key)}
              className={`text-xs px-2 py-1 rounded cursor-pointer transition-colors flex items-center gap-1 shrink-0 whitespace-nowrap ${
                isActive
                  ? "font-semibold text-[var(--text-primary)]"
                  : "font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {t.label}
              {cronTabAlert ? (
                <span
                  className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0"
                  aria-hidden
                />
              ) : null}
            </button>
          );
        })}
      </div>

      {tab === "tools" ? (
        <ToolsPanel />
      ) : tab === "goals" ? (
        <FridayGoalsPanel />
      ) : tab === "cron" ? (
        <FridayCronPanel />
      ) : tab === "architecture" ? (
        <FridayArchitecturePanel
          architecturePane={architecturePane}
          onArchitecturePaneChange={onArchitecturePaneChange}
        />
      ) : (
        <FridayPackageAdminPanel activeView={tab} />
      )}
    </div>
  );
}
