"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { PACKAGE_TEMPLATES, type PackageTemplateSpec } from "@/lib/package-types";
import { WORKFLOW_TYPES, type WorkflowTypeSpec } from "@/lib/workflow-types";
import { panelBus } from "@/lib/events";
import { useDocumentVisible } from "@/lib/use-document-visible";
import PackageDetailCard from "./PackageDetailCard";
import AddPackageModal from "./AddPackageModal";
import WorkflowTemplateCard from "./WorkflowTemplateCard";
import HumanTasksPanel from "../friday/HumanTasksPanel";
import OperationalPackageQueue from "../friday/OperationalPackageQueue";
import type { PackageSpec } from "@/lib/package-types";

interface PackageRow {
  id: string;
  name: string;
  templateId: string;
  stage: string;
  packageNumber?: number | null;
  spec: PackageSpec;
  customerId: string | null;
  customerType: string;
  createdBy: string;
  createdAt: string;
  workflowCount: number;
}

const POLL_MS_VISIBLE = 5000;
const POLL_MS_HIDDEN = 30_000;

type Tab = "queue" | "packages" | "pkg-templates" | "wf-templates";

interface PennyDashboardPanelProps {
  onClose: () => void;
  /** Chat UI: active tab for ephemeral agent context. */
  onDashboardTabChange?: (tab: Tab) => void;
}

export default function PennyDashboardPanel({
  onClose,
  onDashboardTabChange,
}: PennyDashboardPanelProps) {
  const tabVisible = useDocumentVisible();
  const [tab, setTab] = useState<Tab>("queue");

  useEffect(() => {
    onDashboardTabChange?.(tab);
  }, [tab, onDashboardTabChange]);
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [orphanState, setOrphanState] = useState<{
    loading: boolean;
    count: number;
    migrateAllowed: boolean;
  }>({ loading: true, count: 0, migrateAllowed: false });
  const [orphanMigrating, setOrphanMigrating] = useState(false);
  const [migrationError, setMigrationError] = useState<string | null>(null);
  const [addPackageOpen, setAddPackageOpen] = useState(false);
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

  const fetchOrphans = useCallback(() => {
    fetch("/api/crm/packages/orphan-workflows")
      .then((r) => r.json())
      .then((data) => {
        if (!mountedRef.current) return;
        setOrphanState({
          loading: false,
          count: typeof data.count === "number" ? data.count : 0,
          migrateAllowed: data.migrateAllowed === true,
        });
      })
      .catch(() => {
        if (mountedRef.current)
          setOrphanState({ loading: false, count: 0, migrateAllowed: false });
      });
  }, []);

  const runOrphanMigration = useCallback(async () => {
    setMigrationError(null);
    setOrphanMigrating(true);
    try {
      const r = await fetch("/api/crm/packages/orphan-workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = [data?.error, data?.hint].filter(Boolean).join(" ");
        setMigrationError(msg || "Migration failed");
        return;
      }
      panelBus.emit("package_manager");
      panelBus.emit("dashboard_sync");
      fetchPackages();
      fetchOrphans();
    } finally {
      setOrphanMigrating(false);
    }
  }, [fetchPackages, fetchOrphans]);

  useEffect(() => {
    mountedRef.current = true;
    fetchPackages();
    fetchOrphans();
    const tick = () => {
      fetchPackages();
      fetchOrphans();
    };
    const ms = tabVisible ? POLL_MS_VISIBLE : POLL_MS_HIDDEN;
    const interval = setInterval(tick, ms);
    const unsub = panelBus.on("package_manager", tick);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
      unsub();
    };
  }, [fetchPackages, fetchOrphans, tabVisible]);

  const TABS: { key: Tab; label: string; count?: string }[] = [
    {
      key: "queue",
      label: "Package queue",
    },
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
      {/* Header with tabs — match Suzi sub-tabs: low contrast, text-weight only for active */}
      <div className="h-10 shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center px-3 gap-2">
        {TABS.map((t) => {
          const isActive = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`text-xs px-2 py-1 rounded cursor-pointer transition-colors flex items-center gap-1 ${
                isActive
                  ? "font-semibold text-[var(--text-primary)]"
                  : "font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {t.label}
              {t.count != null && (
                <span className="text-[10px] font-normal text-[var(--text-tertiary)] tabular-nums">
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {tab === "queue" ? (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <OperationalPackageQueue />
        </div>
      ) : tab === "wf-templates" ? (
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
                  <span className="text-xs font-semibold text-[var(--text-primary)]">
                    {t.label}
                  </span>
                  <span className="text-[10px] text-[var(--text-tertiary)] font-mono">
                    {t.id}
                  </span>
                </div>
                <p className="text-[11px] text-[var(--text-secondary)] mb-2 leading-relaxed">
                  {t.description}
                </p>
                <div className="space-y-1">
                  {t.deliverables.map((d, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 text-[11px] text-[var(--text-tertiary)]"
                    >
                      <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-[var(--text-tertiary)] opacity-40" />
                      <span className="text-[var(--text-secondary)]">{d.label}</span>
                      <span className="ml-auto">
                        {d.volumeLabel?.trim() || `${d.targetCount} items`}
                      </span>
                      <span className="text-[var(--text-tertiary)]">{d.ownerAgent}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <AddPackageModal
            open={addPackageOpen}
            onClose={() => setAddPackageOpen(false)}
            onCreated={() => {
              panelBus.emit("package_manager");
              panelBus.emit("dashboard_sync");
              fetchPackages();
            }}
          />
          <div className="shrink-0 px-2 py-1.5 border-b border-[var(--border-color)] flex items-center justify-end gap-2 bg-[var(--bg-secondary)]/40">
            <button
              type="button"
              onClick={() => setAddPackageOpen(true)}
              className="text-[10px] font-semibold px-2.5 py-1 rounded-md bg-[#E67E22] text-white hover:opacity-90 transition-opacity"
            >
              New package
            </button>
          </div>
          {!orphanState.loading && orphanState.count > 0 && (
            <div className="shrink-0 mx-3 mt-2 mb-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] text-[var(--text-secondary)]">
              <div className="flex items-start justify-between gap-2">
                <p>
                  <span className="font-semibold text-[var(--text-primary)]">
                    {orphanState.count} workflow{orphanState.count === 1 ? "" : "s"}
                  </span>{" "}
                  from the legacy board have no package yet. Each can appear as a card in{" "}
                  <span className="text-[var(--text-primary)]">Draft</span> after linking.
                </p>
                {orphanState.migrateAllowed ? (
                  <button
                    type="button"
                    disabled={orphanMigrating}
                    onClick={runOrphanMigration}
                    className="shrink-0 text-[10px] font-semibold px-2 py-1 rounded-md bg-amber-600/30 text-amber-100 hover:bg-amber-600/45 disabled:opacity-50"
                  >
                    {orphanMigrating ? "…" : "Link to Draft"}
                  </button>
                ) : null}
              </div>
              {!orphanState.migrateAllowed && (
                <p className="mt-1 text-[10px] text-[var(--text-tertiary)] leading-relaxed">
                  Run{" "}
                  <code className="font-mono text-[var(--text-secondary)]">npm run migrate:orphan-workflows</code>{" "}
                  from <code className="font-mono">web/</code>, or set{" "}
                  <code className="font-mono">ALLOW_ORPHAN_PACKAGE_MIGRATION=1</code> to enable the button here.
                </p>
              )}
              {migrationError ? (
                <p className="mt-1.5 text-[10px] text-red-400/90">{migrationError}</p>
              ) : null}
            </div>
          )}
          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-sm text-[var(--text-tertiary)]">Loading packages...</p>
            </div>
          ) : packages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 px-4">
              <p className="text-sm text-[var(--text-tertiary)] text-center">
                No packages yet — use <strong className="text-[var(--text-secondary)]">New package</strong> above or ask Penny in chat.
              </p>
            </div>
          ) : (
        /* ── Two-column board: Draft (40%) | Testing (60%) ── */
        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* Draft column — 40% */}
          <div className="flex flex-col border-r border-[var(--border-color)]" style={{ width: "40%" }}>
            <div className="shrink-0 px-2.5 py-2 border-b border-[var(--border-color)] flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-[var(--text-tertiary)] opacity-50" />
              <span className="text-[10px] font-medium text-[var(--text-secondary)] uppercase tracking-wider">
                Draft
              </span>
              {draftPackages.length > 0 && (
                <span className="text-[10px] text-[var(--text-tertiary)] ml-auto tabular-nums">{draftPackages.length}</span>
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
              <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-[var(--text-tertiary)] opacity-70" />
              <span className="text-[10px] font-medium text-[var(--text-secondary)] uppercase tracking-wider">
                Testing
              </span>
              {testingPackages.length > 0 && (
                <span className="text-[10px] text-[var(--text-tertiary)] ml-auto tabular-nums">{testingPackages.length}</span>
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
                    <PackageDetailCard pkg={pkg} onPackageMutate={fetchPackages} />

                    {/* Tasks + Logs side by side */}
                    <div className="flex gap-1.5 min-h-[220px] max-h-[min(55vh,520px)] min-h-0 shrink-0">
                      {/* Tasks — left 60% */}
                      <div style={{ width: "60%" }} className="min-h-0 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] overflow-hidden flex flex-col">
                        <div className="shrink-0 px-2.5 py-1.5 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
                          <span className="text-[10px] font-medium text-[var(--text-secondary)] uppercase tracking-wider">Tasks</span>
                        </div>
                        <div className="flex-1 min-h-0 overflow-hidden">
                          <HumanTasksPanel packageStageFilter="PENDING_APPROVAL" compact />
                        </div>
                      </div>

                      {/* Logs — right 40% (newest first; scroll for history) */}
                      <div style={{ width: "40%" }} className="min-h-0 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] overflow-hidden flex flex-col">
                        <div className="shrink-0 px-2.5 py-1.5 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
                          <span className="text-[10px] font-medium text-[var(--text-secondary)] uppercase tracking-wider">Logs</span>
                        </div>
                        <div className="flex-1 min-h-0 overflow-hidden flex flex-col p-0">
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
      )}
    </div>
  );
}

/** Reads simLog from sessionStorage (newest-first). Refreshes on panelBus + interval. */
function SimLogViewer({ packageId }: { packageId: string }) {
  const [log, setLog] = useState<string[]>([]);
  const tabVisible = useDocumentVisible();

  useEffect(() => {
    const read = () => {
      try {
        const saved = sessionStorage.getItem(`simLog-${packageId}`);
        if (saved) setLog(JSON.parse(saved));
      } catch {
        setLog([]);
      }
    };
    read();
    const unsub = panelBus.on("sim_log", read);
    const ms = tabVisible ? 4000 : 20_000;
    const iv = setInterval(read, ms);
    return () => {
      unsub();
      clearInterval(iv);
    };
  }, [packageId, tabVisible]);

  if (log.length === 0) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto flex items-center justify-center px-2">
        <p className="text-[10px] text-[var(--text-tertiary)] text-center py-4">
          No logs yet — start a test to see activity
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 py-2 space-y-0.5">
      {log.map((line, i) => (
        <div
          key={`${i}-${line.slice(0, 64)}`}
          className="text-[10px] text-[var(--text-tertiary)] font-mono leading-relaxed break-words"
        >
          {line}
        </div>
      ))}
    </div>
  );
}
