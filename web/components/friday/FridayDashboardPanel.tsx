"use client";

import ToolsPanel from "./ToolsPanel";
import FridayGoalsPanel from "./FridayGoalsPanel";
import FridayCronPanel from "./FridayCronPanel";
import FridayPackageAdminPanel from "./FridayPackageAdminPanel";
import type { FridayDashboardTab } from "@/lib/agent-ui-context";
import { useCronStatus, cronJobsWithErrors } from "@/lib/use-cron-status";
import { useMemo } from "react";

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
  const { data: cronData } = useCronStatus(true);
  const cronErrors = useMemo(() => cronJobsWithErrors(cronData?.jobs), [cronData?.jobs]);

  const TABS: { key: FridayDashboardTab; label: string; title?: string }[] = [
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
    { key: "cron", label: "Cron", title: "All scheduled jobs — schedule, last run, status" },
  ];

  return (
    <div className="flex-1 bg-[var(--bg-primary)] flex flex-col overflow-hidden min-w-0">
      {cronErrors.length > 0 ? (
        <div
          role="alert"
          className="shrink-0 border-b border-red-500/35 bg-red-500/10 px-3 py-2 text-[11px] text-[var(--text-primary)]"
        >
          <p className="font-semibold text-red-600 dark:text-red-400">
            Cron / automation: {cronErrors.length} job{cronErrors.length === 1 ? "" : "s"} last run failed
          </p>
          <p className="text-[var(--text-secondary)] mt-0.5">
            LinkedIn webhooks, inbox drain, and catch-up depend on healthy jobs. Open the{" "}
            <button
              type="button"
              className="underline font-medium text-[var(--text-primary)] hover:no-underline"
              onClick={() => onDashboardTabChange("cron")}
            >
              Cron
            </button>{" "}
            tab for names and error text. Fix CRM connectivity (see Status rail / Data Platform) or env, then
            refresh.
          </p>
          <ul className="mt-1.5 list-disc list-inside text-[var(--text-tertiary)] space-y-0.5">
            {cronErrors.slice(0, 5).map((j) => (
              <li key={j.id}>
                <span className="font-mono text-[10px]">{j.id}</span>
                {j.lastResult ? ` — ${j.lastResult.slice(0, 120)}` : ""}
              </li>
            ))}
            {cronErrors.length > 5 ? <li>…and {cronErrors.length - 5} more</li> : null}
          </ul>
        </div>
      ) : null}

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
      ) : (
        <FridayPackageAdminPanel activeView={tab} />
      )}
    </div>
  );
}
