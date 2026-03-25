"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { PACKAGE_TEMPLATES, type PackageTemplateSpec } from "@/lib/package-types";
import { WORKFLOW_TYPES, type WorkflowTypeSpec } from "@/lib/workflow-types";
import { panelBus } from "@/lib/events";
import PackageDetailCard from "./PackageDetailCard";
import WorkflowTemplateCard from "./WorkflowTemplateCard";
import HumanTasksPanel from "../friday/HumanTasksPanel";
import type { PackageSpec } from "@/lib/package-types";

interface PackageRow {
  id: string;
  name: string;
  templateId: string;
  stage: string;
  spec: PackageSpec;
  customerId: string | null;
  customerType: string;
  createdBy: string;
  createdAt: string;
  workflowCount: number;
}

const POLL_INTERVAL = 5000;

type Tab = "packages" | "pkg-templates" | "wf-templates";

interface PennyDashboardPanelProps {
  onClose: () => void;
}

export default function PennyDashboardPanel({ onClose }: PennyDashboardPanelProps) {
  const [tab, setTab] = useState<Tab>("packages");
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const pkgTemplates: PackageTemplateSpec[] = Object.values(PACKAGE_TEMPLATES);
  const wfTemplates: WorkflowTypeSpec[] = Object.values(WORKFLOW_TYPES);

  const fetchPackages = useCallback(() => {
    fetch("/api/crm/packages")
      .then((r) => r.json())
      .then((data) => {
        if (mountedRef.current) setPackages(data.packages || []);
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
    const interval = setInterval(fetchPackages, POLL_INTERVAL);
    const unsub = panelBus.on("package_manager", fetchPackages);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
      unsub();
    };
  }, [fetchPackages]);

  const TABS: { key: Tab; label: string; count?: string }[] = [
    {
      key: "packages",
      label: "Package Planner",
      count: loading ? "..." : `${packages.length}`,
    },
    {
      key: "pkg-templates",
      label: "Package Templates",
      count: `${pkgTemplates.length}`,
    },
    {
      key: "wf-templates",
      label: "Workflow Templates",
      count: `${wfTemplates.length}`,
    },
  ];

  const draftPackages = packages.filter((p) => p.stage.toUpperCase() === "DRAFT");
  const testingPackages = packages.filter((p) => p.stage.toUpperCase() === "PENDING_APPROVAL");

  return (
    <div className="flex-1 bg-[var(--bg-primary)] flex flex-col overflow-hidden min-w-0">
      {/* Header with tabs — v2 layout */}
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
              <span style={{ color: "var(--text-tertiary)" }} className="text-[10px] font-bold">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "wf-templates" ? (
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          {wfTemplates.length === 0 ? (
            <div className="flex-1 flex items-center justify-center py-12">
              <p className="text-sm text-[var(--text-tertiary)]">No workflow templates defined</p>
            </div>
          ) : (
            wfTemplates.map((t) => (
              <WorkflowTemplateCard key={t.id} template={t} />
            ))
          )}
        </div>
      ) : tab === "pkg-templates" ? (
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          {pkgTemplates.length === 0 ? (
            <div className="flex-1 flex items-center justify-center py-12">
              <p className="text-sm text-[var(--text-tertiary)]">No package templates defined</p>
            </div>
          ) : (
            pkgTemplates.map((t) => (
              <div
                key={t.id}
                className="rounded-lg p-3 border border-[var(--border-color)] bg-[var(--bg-secondary)]"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-semibold text-[var(--text-primary)]">
                    {t.label}
                  </span>
                  <span className="text-[10px] text-[var(--text-tertiary)] font-mono">
                    {t.id}
                  </span>
                </div>
                <p className="text-xs text-[var(--text-secondary)] mb-2">
                  {t.description}
                </p>
                <div className="space-y-1">
                  {t.deliverables.map((d, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 text-[11px] text-[var(--text-tertiary)]"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-[#E67E22] shrink-0" />
                      <span className="text-[var(--text-secondary)]">{d.label}</span>
                      <span className="ml-auto">{d.targetCount} items</span>
                      <span className="text-[var(--text-tertiary)]">{d.ownerAgent}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      ) : loading ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-[var(--text-tertiary)]">Loading packages...</p>
        </div>
      ) : packages.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-[var(--text-tertiary)]">
            No packages yet — ask Penny to create one
          </p>
        </div>
      ) : (
        /* ── Two-column board: Draft (40%) | Testing (60%) ── */
        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* Draft column — 40% */}
          <div className="flex flex-col border-r border-[var(--border-color)]" style={{ width: "40%" }}>
            <div className="shrink-0 px-2.5 py-2 border-b border-[var(--border-color)] flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: "#6b8a9e" }} />
              <span className="text-[10px] font-semibold text-[var(--text-primary)] uppercase tracking-wider">
                Draft
              </span>
              {draftPackages.length > 0 && (
                <span className="text-[10px] text-[var(--text-tertiary)] ml-auto">{draftPackages.length}</span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-1.5 space-y-1.5">
              {draftPackages.length === 0 ? (
                <div className="flex items-center justify-center py-8">
                  <span className="text-[10px] text-[var(--text-tertiary)]">None</span>
                </div>
              ) : (
                draftPackages.map((pkg) => (
                  <PackageDetailCard key={pkg.id} pkg={pkg} initialCollapsed />
                ))
              )}
            </div>
          </div>

          {/* Testing column — 60% */}
          <div className="flex flex-col" style={{ width: "60%" }}>
            <div className="shrink-0 px-2.5 py-2 border-b border-[var(--border-color)] flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: "#D4A017" }} />
              <span className="text-[10px] font-semibold text-[var(--text-primary)] uppercase tracking-wider">
                Testing
              </span>
              {testingPackages.length > 0 && (
                <span className="text-[10px] text-[var(--text-tertiary)] ml-auto">{testingPackages.length}</span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-1.5">
              {testingPackages.length === 0 ? (
                <div className="flex items-center justify-center py-8">
                  <span className="text-[10px] text-[var(--text-tertiary)]">No packages in testing</span>
                </div>
              ) : (
                testingPackages.map((pkg) => (
                  <div key={pkg.id} className="space-y-2">
                    {/* Package card */}
                    <PackageDetailCard pkg={pkg} />

                    {/* Tasks + Logs side by side */}
                    <div className="flex gap-1.5 min-h-[300px]">
                      {/* Tasks — left 60% */}
                      <div style={{ width: "60%" }} className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] overflow-hidden flex flex-col">
                        <div className="shrink-0 px-2.5 py-1.5 border-b border-[var(--border-color)]">
                          <span className="text-[10px] font-semibold text-[var(--text-primary)] uppercase tracking-wider">Tasks</span>
                        </div>
                        <div className="flex-1 overflow-hidden">
                          <HumanTasksPanel packageStageFilter="PENDING_APPROVAL" compact />
                        </div>
                      </div>

                      {/* Logs — right 40% */}
                      <div style={{ width: "40%" }} className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] overflow-hidden flex flex-col">
                        <div className="shrink-0 px-2.5 py-1.5 border-b border-[var(--border-color)]">
                          <span className="text-[10px] font-semibold text-[var(--text-primary)] uppercase tracking-wider">Logs</span>
                        </div>
                        <div className="flex-1 overflow-y-auto p-2">
                          <SimLogViewer packageId={pkg.id} />
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Reads simLog from sessionStorage for a given packageId */
function SimLogViewer({ packageId }: { packageId: string }) {
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    const read = () => {
      try {
        const saved = sessionStorage.getItem(`simLog-${packageId}`);
        if (saved) setLog(JSON.parse(saved));
      } catch {}
    };
    read();
    const iv = setInterval(read, 2000);
    return () => clearInterval(iv);
  }, [packageId]);

  if (log.length === 0) {
    return (
      <div className="text-[10px] text-[var(--text-tertiary)] text-center py-4">
        No logs yet — start a test to see activity
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {log.map((line, i) => (
        <div key={i} className="text-[10px] text-[var(--text-secondary)] font-mono leading-relaxed">
          {line}
        </div>
      ))}
    </div>
  );
}
