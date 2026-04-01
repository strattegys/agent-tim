"use client";

import { useState, useEffect, useCallback } from "react";
import useSWR from "swr";
import {
  PLANNER_PACKAGE_TEMPLATES,
  type PackageTemplateSpec,
} from "@/lib/package-types";
import { WORKFLOW_TYPES, type WorkflowTypeSpec } from "@/lib/workflow-types";
import { panelBus } from "@/lib/events";
import { useDocumentVisible } from "@/lib/use-document-visible";
import PackageDetailCard from "@/components/penny/PackageDetailCard";
import AddPackageModal from "@/components/penny/AddPackageModal";
import WorkflowTemplateCard from "@/components/penny/WorkflowTemplateCard";
import OperationalPackageQueue from "./OperationalPackageQueue";
import type { PackageSpec } from "@/lib/package-types";
import type { FridayDashboardTab } from "@/lib/agent-ui-context";

/** Package-area views mounted from Friday’s top-level tabs (not tasks/tools). */
export type FridayPackageAdminView = Extract<
  FridayDashboardTab,
  "queue" | "planner" | "pkg-templates" | "wf-templates"
>;

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

interface FridayPackageAdminPanelProps {
  activeView: FridayPackageAdminView;
}

export default function FridayPackageAdminPanel({ activeView: tab }: FridayPackageAdminPanelProps) {
  const tabVisible = useDocumentVisible();

  const { data: pkgData, isLoading: loading, mutate: refreshPackages } = useSWR<{ packages: PackageRow[] }>(
    "/api/crm/packages",
    async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    {
      refreshInterval: tabVisible ? POLL_MS_VISIBLE : POLL_MS_HIDDEN,
      revalidateOnFocus: true,
      dedupingInterval: 5_000,
    },
  );
  const packages = pkgData?.packages ?? [];

  const { data: orphanData, mutate: refreshOrphans } = useSWR<{
    count: number;
    migrateAllowed: boolean;
  }>(
    "/api/crm/packages/orphan-workflows",
    async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      return {
        count: typeof d.count === "number" ? d.count : 0,
        migrateAllowed: d.migrateAllowed === true,
      };
    },
    { refreshInterval: tabVisible ? POLL_MS_VISIBLE : POLL_MS_HIDDEN, dedupingInterval: 5_000 },
  );
  const orphanState = {
    loading: !orphanData,
    count: orphanData?.count ?? 0,
    migrateAllowed: orphanData?.migrateAllowed ?? false,
  };

  const [orphanMigrating, setOrphanMigrating] = useState(false);
  const [migrationError, setMigrationError] = useState<string | null>(null);
  const [addPackageOpen, setAddPackageOpen] = useState(false);

  const fetchPackages = useCallback(() => void refreshPackages(), [refreshPackages]);

  useEffect(() => {
    const unsub = panelBus.on("package_manager", () => {
      void refreshPackages();
      void refreshOrphans();
    });
    return unsub;
  }, [refreshPackages, refreshOrphans]);

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
      void refreshPackages();
      void refreshOrphans();
    } finally {
      setOrphanMigrating(false);
    }
  }, [refreshPackages, refreshOrphans]);

  const pkgTemplates: PackageTemplateSpec[] = PLANNER_PACKAGE_TEMPLATES;
  const wfTemplates: WorkflowTypeSpec[] = Object.values(WORKFLOW_TYPES);

  const draftPackages = packages.filter((p) => p.stage.toUpperCase() === "DRAFT");
  const testingPackages = packages.filter((p) => p.stage.toUpperCase() === "PENDING_APPROVAL");

  return (
    <div className="flex-1 bg-[var(--bg-primary)] flex flex-col overflow-hidden min-w-0">
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
            wfTemplates.map((tmpl) => (
              <WorkflowTemplateCard key={tmpl.id} template={tmpl} />
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
            pkgTemplates.map((tmpl) => (
              <div
                key={tmpl.id}
                className="rounded-lg p-3 border border-[var(--border-color)] bg-[var(--bg-secondary)]"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-[var(--text-primary)]">
                    {tmpl.label}
                  </span>
                  <span className="text-[10px] text-[var(--text-tertiary)] font-mono">
                    {tmpl.id}
                  </span>
                </div>
                <p className="text-[11px] text-[var(--text-secondary)] mb-2 leading-relaxed">
                  {tmpl.description}
                </p>
                <div className="space-y-1">
                  {tmpl.deliverables.map((d, i) => (
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
      ) : tab === "planner" ? (
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
                No packages yet — use <strong className="text-[var(--text-secondary)]">New package</strong> above or
                use <strong className="text-[var(--text-secondary)]">package_manager</strong> with Friday in chat.
              </p>
            </div>
          ) : (
            <div className="flex-1 min-h-0 flex overflow-hidden">
              <div className="flex flex-col border-r border-[var(--border-color)]" style={{ width: "40%" }}>
                <div className="shrink-0 px-2.5 py-2 border-b border-[var(--border-color)] flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-[var(--text-tertiary)] opacity-50" />
                  <span className="text-[10px] font-medium text-[var(--text-secondary)] uppercase tracking-wider">
                    Draft
                  </span>
                  {draftPackages.length > 0 && (
                    <span className="text-[10px] text-[var(--text-tertiary)] ml-auto tabular-nums">
                      {draftPackages.length}
                    </span>
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

              <div className="flex flex-col" style={{ width: "60%" }}>
                <div className="shrink-0 px-2.5 py-2 border-b border-[var(--border-color)] flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-[var(--text-tertiary)] opacity-70" />
                  <span className="text-[10px] font-medium text-[var(--text-secondary)] uppercase tracking-wider">
                    Testing
                  </span>
                  {testingPackages.length > 0 && (
                    <span className="text-[10px] text-[var(--text-tertiary)] ml-auto tabular-nums">
                      {testingPackages.length}
                    </span>
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
                        <PackageDetailCard pkg={pkg} onPackageMutate={fetchPackages} />

                        <div className="min-h-[220px] max-h-[min(55vh,520px)] min-h-0 shrink-0 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] overflow-hidden flex flex-col">
                          <div className="shrink-0 px-2.5 py-1.5 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
                            <span className="text-[10px] font-medium text-[var(--text-secondary)] uppercase tracking-wider">
                              Logs
                            </span>
                          </div>
                          <div className="flex-1 min-h-0 overflow-hidden flex flex-col p-0">
                            <SimLogViewer packageId={pkg.id} />
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
      ) : null}
    </div>
  );
}

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
