"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import FridayPackageCard, {
  type FridayPackageRow,
  type FridayWorkflowBreakdown,
} from "./FridayPackageCard";
import HumanTasksPanel from "./HumanTasksPanel";
import ToolsPanel from "./ToolsPanel";
import { panelBus } from "@/lib/events";
import { useDocumentVisible } from "@/lib/use-document-visible";

const COLUMNS = [
  { key: "ACTIVE", label: "Active", color: "var(--accent-green)" },
  { key: "PAUSED", label: "Paused", color: "var(--accent-orange)" },
  { key: "COMPLETED", label: "Completed", color: "var(--text-tertiary)" },
] as const;

const POLL_MS_VISIBLE = 5000;
const POLL_MS_HIDDEN = 30_000;

type Tab = "packages" | "tasks" | "tools";

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
  const tabVisible = useDocumentVisible();
  const [tab, setTab] = useState<Tab>(() =>
    initialWorkTab === "tasks" || initialWorkTab === "tools" || initialWorkTab === "packages"
      ? initialWorkTab
      : "packages"
  );

  useEffect(() => {
    onDashboardTabChange?.(tab);
  }, [tab, onDashboardTabChange]);

  const [packages, setPackages] = useState<FridayPackageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const fetchPackages = useCallback(() => {
    fetch("/api/crm/packages?operational=true&includeStats=true&includeWorkflowBreakdown=true")
      .then((r) => r.json())
      .then((data) => {
        if (!mountedRef.current) return;
        const rows = (data.packages || []) as Record<string, unknown>[];
        setPackages(
          rows.map((p) => {
            const rawWf = p.workflows;
            const workflows: FridayWorkflowBreakdown[] | undefined = Array.isArray(rawWf)
              ? (rawWf as Record<string, unknown>[]).map((w) => ({
                  id: String(w.id),
                  name: String(w.name || ""),
                  ownerAgent: String(w.ownerAgent || ""),
                  workflowType: String(w.workflowType || ""),
                  targetCount: Number(w.targetCount) || 0,
                  volumeLabel:
                    w.volumeLabel != null && String(w.volumeLabel).trim() !== ""
                      ? String(w.volumeLabel)
                      : null,
                  totalItems: Number(w.totalItems) || 0,
                  stageCounts:
                    w.stageCounts && typeof w.stageCounts === "object" && !Array.isArray(w.stageCounts)
                      ? (w.stageCounts as Record<string, number>)
                      : {},
                  stages: Array.isArray(w.stages)
                    ? (w.stages as Record<string, unknown>[]).map((s) => ({
                        key: String(s.key),
                        label: String(s.label),
                        color: typeof s.color === "string" ? s.color : "#64748b",
                        requiresHuman: Boolean(s.requiresHuman),
                      }))
                    : [],
                }))
              : undefined;
            return {
              id: String(p.id),
              name: String(p.name || ""),
              templateId: String(p.templateId || ""),
              stage: String(p.stage || "").toUpperCase(),
              packageNumber: p.packageNumber != null ? Number(p.packageNumber) : undefined,
              workflowCount: Number(p.workflowCount) || 0,
              itemCount: p.itemCount != null ? Number(p.itemCount) : undefined,
              createdAt: String(p.createdAt || ""),
              workflows,
            };
          })
        );
      })
      .catch(() => {
        if (mountedRef.current) setPackages([]);
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchPackages();
    const ms = tabVisible ? POLL_MS_VISIBLE : POLL_MS_HIDDEN;
    const interval = setInterval(fetchPackages, ms);
    const unsubWf = panelBus.on("workflow_manager", fetchPackages);
    const unsubPkg = panelBus.on("package_manager", fetchPackages);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
      unsubWf();
      unsubPkg();
    };
  }, [fetchPackages, tabVisible]);

  const TABS: { key: Tab; label: string; count?: string }[] = [
    {
      key: "packages",
      label: "Packages",
      count: loading ? "..." : `${packages.length}`,
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

      {tab === "tools" ? (
        <ToolsPanel />
      ) : tab === "tasks" ? (
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <HumanTasksPanel
            onSwitchToAgent={onSwitchToAgent}
            packageStageFilter="ACTIVE"
          />
        </div>
      ) : loading ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-[var(--text-tertiary)]">Loading packages...</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex overflow-x-auto">
          {COLUMNS.map((col) => {
            const colPkgs = packages.filter((p) => p.stage === col.key);
            return (
              <div
                key={col.key}
                className="flex-1 min-w-[160px] flex flex-col border-r border-[var(--border-color)] last:border-r-0"
              >
                <div className="shrink-0 px-2.5 py-2 border-b border-[var(--border-color)] flex items-center gap-1.5 bg-[var(--bg-primary)]/30">
                  <span
                    className="w-2 h-2 rounded-full shrink-0 opacity-70"
                    style={{ backgroundColor: col.color }}
                  />
                  <span className="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
                    {col.label}
                  </span>
                  {colPkgs.length > 0 && (
                    <span className="text-[10px] text-[var(--text-tertiary)] ml-auto">{colPkgs.length}</span>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto p-1.5 space-y-1.5">
                  {colPkgs.length === 0 ? (
                    <div className="flex items-center justify-center py-8">
                      <span className="text-[10px] text-[var(--text-tertiary)]">None</span>
                    </div>
                  ) : (
                    colPkgs.map((p) => <FridayPackageCard key={p.id} pkg={p} />)
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
