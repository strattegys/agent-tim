"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import FridayPackageCard, {
  type FridayPackageRow,
  type FridayWorkflowBreakdown,
} from "./FridayPackageCard";
import { panelBus } from "@/lib/events";
import { useDocumentVisible } from "@/lib/use-document-visible";

const COLUMNS = [
  { key: "ACTIVE", label: "Active", color: "var(--accent-green)" },
  { key: "PAUSED", label: "Paused", color: "var(--accent-orange)" },
  { key: "COMPLETED", label: "Completed", color: "var(--text-tertiary)" },
] as const;

const POLL_MS_VISIBLE = 5000;
const POLL_MS_HIDDEN = 30_000;

/**
 * Operational package board: ACTIVE / PAUSED / COMPLETED (live ops).
 * Used in Penny’s dashboard; was previously Friday’s Packages tab.
 */
export default function OperationalPackageQueue() {
  const tabVisible = useDocumentVisible();
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

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-[var(--text-tertiary)]">Loading package queue…</p>
      </div>
    );
  }

  return (
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
  );
}
