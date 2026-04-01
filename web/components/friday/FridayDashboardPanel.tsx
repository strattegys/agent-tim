"use client";

import ToolsPanel from "./ToolsPanel";
import FridayGoalsPanel from "./FridayGoalsPanel";
import FridayCronPanel from "./FridayCronPanel";
import FridayPackageAdminPanel from "./FridayPackageAdminPanel";
import type { FridayDashboardTab } from "@/lib/agent-ui-context";

interface FridayDashboardPanelProps {
  onClose?: () => void;
  dashboardTab: FridayDashboardTab;
  onDashboardTabChange: (tab: FridayDashboardTab) => void;
}

export default function FridayDashboardPanel({
  onClose: _onClose,
  dashboardTab: tab,
  onDashboardTabChange,
}: FridayDashboardPanelProps) {
  const TABS: { key: FridayDashboardTab; label: string; title?: string }[] = [
    { key: "goals", label: "Goals", title: "Throughput vs daily/weekly targets (from workflow type registry)" },
    {
      key: "package-kanban",
      label: "Package Kanban",
      title: "Draft through completed — compact cards; open for planner, workflow steps, or live Kanban",
    },
    { key: "pkg-templates", label: "Package templates", title: "Static package type definitions" },
    {
      key: "wf-templates",
      label: "Workflow templates",
      title: "All workflow type definitions — library plus new types from the CRM",
    },
    { key: "tools", label: "Tools", title: "Internal tools registry" },
    { key: "cron", label: "Cron", title: "All scheduled jobs — schedule, last run, status" },
  ];

  return (
    <div className="flex-1 bg-[var(--bg-primary)] flex flex-col overflow-hidden min-w-0">
      <div className="h-10 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center px-2 gap-1 overflow-x-auto">
        {TABS.map((t) => {
          const isActive = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              title={t.title}
              onClick={() => onDashboardTabChange(t.key)}
              className={`text-xs px-2 py-1 rounded cursor-pointer transition-colors flex items-center gap-1 shrink-0 whitespace-nowrap ${
                isActive
                  ? "font-semibold text-[var(--text-primary)]"
                  : "font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {t.label}
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
      ) : (
        <FridayPackageAdminPanel activeView={tab} />
      )}
    </div>
  );
}
