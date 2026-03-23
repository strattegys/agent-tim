"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import WorkflowCard, { type WorkflowStat } from "./WorkflowRow";
import ToolsPanel from "./ToolsPanel";
import { panelBus } from "@/lib/events";

const COLUMNS = [
  { key: "PLANNING", label: "Planning", color: "#6b8a9e" },
  { key: "ACTIVE", label: "Active", color: "#1D9E75" },
  { key: "PAUSED", label: "Paused", color: "#D85A30" },
  { key: "COMPLETED", label: "Completed", color: "#22c55e" },
] as const;

const POLL_INTERVAL = 5000;

type Tab = "workflows" | "tools";

interface FridayDashboardPanelProps {
  onClose: () => void;
}

export default function FridayDashboardPanel({ onClose }: FridayDashboardPanelProps) {
  const [tab, setTab] = useState<Tab>("workflows");
  const [workflows, setWorkflows] = useState<WorkflowStat[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const fetchWorkflows = useCallback(() => {
    fetch("/api/crm/workflow-stats")
      .then((r) => r.json())
      .then((data) => { if (mountedRef.current) setWorkflows(data.workflows || []); })
      .catch(() => { if (mountedRef.current) setWorkflows([]); })
      .finally(() => { if (mountedRef.current) setLoading(false); });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchWorkflows();
    const interval = setInterval(fetchWorkflows, POLL_INTERVAL);
    const unsub = panelBus.on("workflow_manager", fetchWorkflows);
    return () => { mountedRef.current = false; clearInterval(interval); unsub(); };
  }, [fetchWorkflows]);

  const TABS: { key: Tab; label: string; count?: string }[] = [
    {
      key: "workflows",
      label: "Workflows",
      count: loading ? "..." : `${workflows.length}`,
    },
    {
      key: "tools",
      label: "Tools",
    },
  ];

  return (
    <div className="flex-1 bg-[var(--bg-primary)] flex flex-col overflow-hidden min-w-0">
      {/* Header with tabs */}
      <div className="h-10 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center px-3 gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="text-xs font-semibold px-2 py-1 rounded transition-colors flex items-center gap-1.5"
            style={{
              color: tab === t.key ? "var(--text-primary)" : "var(--text-tertiary)",
              background: tab === t.key ? "var(--bg-tertiary)" : "transparent",
            }}
          >
            {t.label}
            {t.count && (
              <span
                className="text-[10px] font-normal"
                style={{ color: "var(--text-tertiary)" }}
              >
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "tools" ? (
        <ToolsPanel />
      ) : loading ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-[var(--text-tertiary)]">Loading workflows...</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex overflow-x-auto">
          {COLUMNS.map((col) => {
            const colWorkflows = workflows.filter(
              (w) => w.stage.toUpperCase() === col.key
            );
            return (
              <div
                key={col.key}
                className="flex-1 min-w-[160px] flex flex-col border-r border-[var(--border-color)] last:border-r-0"
              >
                {/* Column header */}
                <div className="shrink-0 px-2.5 py-2 border-b border-[var(--border-color)] flex items-center gap-1.5">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: col.color }}
                  />
                  <span className="text-[10px] font-semibold text-[var(--text-primary)] uppercase tracking-wider">
                    {col.label}
                  </span>
                  {colWorkflows.length > 0 && (
                    <span className="text-[10px] text-[var(--text-tertiary)] ml-auto">
                      {colWorkflows.length}
                    </span>
                  )}
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto p-1.5 space-y-1.5">
                  {colWorkflows.length === 0 ? (
                    <div className="flex items-center justify-center py-8">
                      <span className="text-[10px] text-[var(--text-tertiary)]">None</span>
                    </div>
                  ) : (
                    colWorkflows.map((w) => (
                      <WorkflowCard key={w.id} workflow={w} />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
