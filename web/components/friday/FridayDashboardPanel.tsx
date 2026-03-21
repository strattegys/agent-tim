"use client";

import { useState, useEffect } from "react";
import WorkflowRow, { type WorkflowStat } from "./WorkflowRow";

const FILTERS = ["All", "Active", "Paused", "Planning", "Completed"] as const;
type Filter = (typeof FILTERS)[number];

interface FridayDashboardPanelProps {
  onClose: () => void;
}

export default function FridayDashboardPanel({ onClose }: FridayDashboardPanelProps) {
  const [workflows, setWorkflows] = useState<WorkflowStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("All");

  useEffect(() => {
    fetch("/api/crm/workflow-stats")
      .then((r) => r.json())
      .then((data) => setWorkflows(data.workflows || []))
      .catch(() => setWorkflows([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = filter === "All"
    ? workflows
    : workflows.filter((w) => w.stage.toUpperCase() === filter.toUpperCase());

  const totalItems = workflows.reduce((sum, w) => sum + w.totalItems, 0);
  const totalAlerts = workflows.reduce((sum, w) => sum + w.alertCount, 0);

  return (
    <div className="flex-1 bg-[var(--bg-primary)] flex flex-col overflow-hidden min-w-0">
      {/* Header */}
      <div className="h-10 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center px-3 gap-2">
        <span className="text-xs font-semibold text-[var(--text-primary)]">
          All Workflows
        </span>
        <span className="ml-auto text-xs text-[var(--text-tertiary)]">
          {loading ? "Loading..." : (
            <>
              {filtered.length} workflow{filtered.length !== 1 ? "s" : ""}
              {totalItems > 0 && ` \u00B7 ${totalItems} items`}
              {totalAlerts > 0 && ` \u00B7 ${totalAlerts} alerts`}
            </>
          )}
        </span>
      </div>

      {/* Filter pills */}
      <div className="shrink-0 px-3 py-2 flex gap-1.5 border-b border-[var(--border-color)]">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-[10px] px-2.5 py-1 rounded-full cursor-pointer transition-colors ${
              filter === f
                ? "bg-[var(--accent-green)] text-white font-medium"
                : "bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-color)]"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Workflow list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-[var(--text-tertiary)]">Loading workflows...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-[var(--text-tertiary)]">
              {filter === "All"
                ? "No workflows found"
                : `No ${filter.toLowerCase()} workflows`}
            </p>
          </div>
        ) : (
          filtered.map((w) => <WorkflowRow key={w.id} workflow={w} />)
        )}
      </div>
    </div>
  );
}
