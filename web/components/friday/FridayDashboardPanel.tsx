"use client";

import HumanTasksPanel from "./HumanTasksPanel";
import ToolsPanel from "./ToolsPanel";
import FridayPackageAdminPanel from "./FridayPackageAdminPanel";
import type { FridayDashboardTab, FridayPackageSubTab } from "@/lib/agent-ui-context";

interface FridayDashboardPanelProps {
  onClose?: () => void;
  onSwitchToAgent?: (agentId: string) => void;
  pendingTaskCount?: number;
  /** Top-level tab — owned by parent for URL sync and Penny → Friday redirects. */
  dashboardTab: FridayDashboardTab;
  onDashboardTabChange: (tab: FridayDashboardTab) => void;
  /** Packages column sub-tab — owned by parent for URL sync. */
  packageSubTab: FridayPackageSubTab;
  onPackageSubTabChange: (sub: FridayPackageSubTab) => void;
}

export default function FridayDashboardPanel({
  onSwitchToAgent,
  pendingTaskCount = 0,
  dashboardTab: tab,
  onDashboardTabChange,
  packageSubTab,
  onPackageSubTabChange,
}: FridayDashboardPanelProps) {
  const TABS: { key: FridayDashboardTab; label: string; count?: string }[] = [
    {
      key: "packages",
      label: "Packages",
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
              onClick={() => onDashboardTabChange(t.key)}
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

      {tab === "packages" ? (
        <FridayPackageAdminPanel
          packageSubTab={packageSubTab}
          onPackageSubTabChange={onPackageSubTabChange}
        />
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
