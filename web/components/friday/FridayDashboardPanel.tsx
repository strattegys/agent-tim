"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import WorkflowCard, { type WorkflowStat } from "./WorkflowRow";

const COLUMNS = [
  { key: "PLANNING", label: "Planning", color: "#6b8a9e" },
  { key: "ACTIVE", label: "Active", color: "#1D9E75" },
  { key: "PAUSED", label: "Paused", color: "#D85A30" },
  { key: "COMPLETED", label: "Completed", color: "#22c55e" },
] as const;

const POLL_INTERVAL = 5000;

interface FridayDashboardPanelProps {
  onClose: () => void;
}

export default function FridayDashboardPanel({ onClose }: FridayDashboardPanelProps) {
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
    return () => { mountedRef.current = false; clearInterval(interval); };
  }, [fetchWorkflows]);

  return (
    <div className="flex-1 bg-[var(--bg-primary)] flex flex-col overflow-hidden min-w-0">
      {/* Header */}
      <div className="h-10 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center px-3 gap-2">
        <span className="text-xs font-semibold text-[var(--text-primary)]">
          Workflows
        </span>
        <span className="ml-auto text-xs text-[var(--text-tertiary)]">
          {loading ? "Loading..." : `${workflows.length} workflow${workflows.length !== 1 ? "s" : ""}`}
        </span>
      </div>

      {/* Kanban columns */}
      {loading ? (
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
