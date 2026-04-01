"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import useSWR from "swr";
import PackageDetailCard from "@/components/penny/PackageDetailCard";
import AddPackageModal from "@/components/penny/AddPackageModal";
import FridayPackageBuilderModal from "./FridayPackageBuilderModal";
import KanbanInlinePanel from "@/components/kanban/KanbanInlinePanel";
import type { PackageDeliverable, PackageSpec } from "@/lib/package-types";
import { panelBus } from "@/lib/events";
import { useDocumentVisible } from "@/lib/use-document-visible";
import { PACKAGE_TEMPLATES, PLANNER_PACKAGE_TEMPLATES } from "@/lib/package-types";
import PackageKanbanCard from "./PackageKanbanCard";
import FridayPackageCard, {
  type FridayPackageRow,
  type FridayWorkflowBreakdown,
} from "./FridayPackageCard";

const COLUMNS = [
  { key: "DRAFT", label: "Draft", color: "var(--text-tertiary)" },
  { key: "PENDING_APPROVAL", label: "Testing", color: "#6366f1" },
  { key: "ACTIVE", label: "Active", color: "var(--accent-green)" },
  { key: "PAUSED", label: "Paused", color: "var(--accent-orange)" },
  { key: "COMPLETED", label: "Completed", color: "var(--text-tertiary)" },
] as const;

const POLL_MS_VISIBLE = 5000;
const POLL_MS_HIDDEN = 30_000;

interface PackageDetailRow {
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

function parseSpec(raw: unknown): PackageSpec {
  if (raw == null) return {} as PackageSpec;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as PackageSpec;
    } catch {
      return {} as PackageSpec;
    }
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as PackageSpec;
  }
  return {} as PackageSpec;
}

/** Rows in spec, or else template default — used so Draft tiles show planned workflow count before `_workflow` rows exist. */
function plannedDeliverableCount(spec: PackageSpec, templateId: string): number {
  const fromSpec = Array.isArray(spec?.deliverables) ? spec.deliverables.length : 0;
  if (fromSpec > 0) return fromSpec;
  const tmpl = PACKAGE_TEMPLATES[templateId];
  return Array.isArray(tmpl?.deliverables) ? tmpl.deliverables.length : 0;
}

/** Merge saved deliverables into one package row in the SWR payload (instant overlay update). */
function patchPackageSpecDeliverables(
  data: { packages: Record<string, unknown>[] } | undefined,
  packageId: string,
  deliverables: PackageDeliverable[]
): { packages: Record<string, unknown>[] } | undefined {
  if (!data?.packages) return data;
  return {
    ...data,
    packages: data.packages.map((p) => {
      if (String(p.id) !== packageId) return p;
      const spec = parseSpec(p.spec) as unknown as Record<string, unknown>;
      return {
        ...p,
        spec: {
          ...spec,
          deliverables: deliverables.map((d) => ({ ...d })),
        },
      };
    }),
  };
}

function mapApiRows(
  rows: Record<string, unknown>[]
): { planner: PackageDetailRow; friday: FridayPackageRow; stageNorm: string }[] {
  return rows.map((p) => {
    const rawWf = p.workflows;
    const workflows: FridayWorkflowBreakdown[] | undefined = Array.isArray(rawWf)
      ? (rawWf as Record<string, unknown>[]).map((w) => ({
          id: String(w.id),
          name: String(w.name || ""),
          ownerAgent: String(w.ownerAgent || ""),
          workflowType: String(w.workflowType || ""),
          workflowTypeLabel:
            w.workflowTypeLabel != null && String(w.workflowTypeLabel).trim() !== ""
              ? String(w.workflowTypeLabel)
              : null,
          itemType:
            w.itemType === "content" || w.itemType === "person" ? w.itemType : undefined,
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

    const stageNorm = String(p.stage || "").toUpperCase().trim() || "DRAFT";

    const planner: PackageDetailRow = {
      id: String(p.id),
      name: String(p.name || ""),
      templateId: String(p.templateId || ""),
      stage: String(p.stage || ""),
      packageNumber: p.packageNumber != null ? Number(p.packageNumber) : null,
      spec: parseSpec(p.spec),
      customerId: p.customerId != null ? String(p.customerId) : null,
      customerType: String(p.customerType || "person"),
      createdBy: String(p.createdBy || "penny"),
      createdAt: String(p.createdAt || ""),
      workflowCount: Number(p.workflowCount) || 0,
    };

    const friday: FridayPackageRow = {
      id: String(p.id),
      name: String(p.name || ""),
      templateId: String(p.templateId || ""),
      stage: stageNorm,
      packageNumber: p.packageNumber != null ? Number(p.packageNumber) : undefined,
      workflowCount: Number(p.workflowCount) || 0,
      itemCount: p.itemCount != null ? Number(p.itemCount) : undefined,
      createdAt: String(p.createdAt || ""),
      spec: p.spec,
      workflows,
    };

    return { planner, friday, stageNorm };
  });
}

function columnKeyForStage(stageNorm: string): (typeof COLUMNS)[number]["key"] {
  const found = COLUMNS.find((c) => c.key === stageNorm);
  return found ? found.key : "DRAFT";
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
        <p className="text-[10px] text-[var(--text-tertiary)] text-center py-3">
          No sim logs yet — run a test from package details
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

export default function PackageKanbanBoard() {
  const tabVisible = useDocumentVisible();
  const [kanbanWorkflow, setKanbanWorkflow] = useState<{ id: string; name: string } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [addPackageOpen, setAddPackageOpen] = useState(false);
  const [packageWizardOpen, setPackageWizardOpen] = useState(false);
  const [orphanMigrating, setOrphanMigrating] = useState(false);
  const [migrationError, setMigrationError] = useState<string | null>(null);

  const { data: pkgData, isLoading: loading, mutate: refreshPackages } = useSWR<{ packages: Record<string, unknown>[] }>(
    "/api/crm/packages?includeStats=true&includeWorkflowBreakdown=true",
    async (url: string) => {
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    {
      refreshInterval: tabVisible ? POLL_MS_VISIBLE : POLL_MS_HIDDEN,
      revalidateOnFocus: true,
      dedupingInterval: 5_000,
    },
  );

  const { data: orphanData, mutate: refreshOrphans } = useSWR<{
    count: number;
    migrateAllowed: boolean;
  }>(
    "/api/crm/packages/orphan-workflows",
    async (url: string) => {
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      return {
        count: typeof d.count === "number" ? d.count : 0,
        migrateAllowed: d.migrateAllowed === true,
      };
    },
    { refreshInterval: tabVisible ? POLL_MS_VISIBLE : POLL_MS_HIDDEN, dedupingInterval: 5_000 },
  );

  const combined = useMemo(() => mapApiRows(pkgData?.packages ?? []), [pkgData?.packages]);

  const orphanState = {
    loading: !orphanData,
    count: orphanData?.count ?? 0,
    migrateAllowed: orphanData?.migrateAllowed ?? false,
  };

  const fetchPackages = useCallback(
    () => void refreshPackages(undefined, { revalidate: true }),
    [refreshPackages]
  );

  useEffect(() => {
    const unsub = panelBus.on("package_manager", () => {
      void refreshPackages(undefined, { revalidate: true });
      void refreshOrphans();
    });
    const unsubWf = panelBus.on("workflow_manager", () =>
      void refreshPackages(undefined, { revalidate: true })
    );
    return () => {
      unsub();
      unsubWf();
    };
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
      void refreshPackages(undefined, { revalidate: true });
      void refreshOrphans();
    } finally {
      setOrphanMigrating(false);
    }
  }, [refreshPackages, refreshOrphans]);

  const detailEntry = useMemo(
    () => combined.find((c) => c.planner.id === detailId) ?? null,
    [combined, detailId]
  );

  /** Close overlay and drop the row immediately so delete always looks successful while SWR revalidates. */
  const handlePlannerPackageDeleted = useCallback(() => {
    const id = detailId;
    setDetailId(null);
    if (!id) return;
    void refreshPackages(
      (current) => {
        if (!current?.packages) return current;
        return {
          ...current,
          packages: current.packages.filter((p) => String(p.id) !== id),
        };
      },
      { revalidate: true }
    );
  }, [detailId, refreshPackages]);

  const handleDetailWorkflowsSaved = useCallback(
    (saved: PackageDeliverable[]) => {
      if (!detailId) return;
      panelBus.emit("package_manager");
      panelBus.emit("dashboard_sync");
      void refreshPackages(
        (current) => patchPackageSpecDeliverables(current, detailId, saved) ?? current,
        { revalidate: true }
      );
    },
    [detailId, refreshPackages]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setDetailId(null);
    };
    if (detailId) {
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }
  }, [detailId]);

  const openWorkflowKanban = useCallback((wf: FridayWorkflowBreakdown) => {
    setDetailId(null);
    setKanbanWorkflow({
      id: wf.id,
      name:
        (typeof wf.workflowTypeLabel === "string" && wf.workflowTypeLabel.trim()) ||
        (wf.name?.trim() ? wf.name : wf.workflowType || "Workflow"),
    });
  }, []);

  if (kanbanWorkflow) {
    return (
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[var(--bg-primary)]">
        <div className="shrink-0 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] flex items-center gap-2 px-3 py-2">
          <button
            type="button"
            onClick={() => setKanbanWorkflow(null)}
            className="text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer px-2 py-1 rounded border border-[var(--border-color)]"
          >
            ← Package Kanban
          </button>
          <span className="text-xs font-semibold text-[var(--text-primary)] truncate">
            {kanbanWorkflow.name}
          </span>
        </div>
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <KanbanInlinePanel
            onClose={() => setKanbanWorkflow(null)}
            fixedWorkflowId={kanbanWorkflow.id}
            fixedWorkflowLabel={kanbanWorkflow.name}
            agentId="friday"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-[var(--bg-primary)]">
      <AddPackageModal
        open={addPackageOpen}
        onClose={() => setAddPackageOpen(false)}
        onCreated={() => {
          panelBus.emit("package_manager");
          panelBus.emit("dashboard_sync");
          fetchPackages();
        }}
      />
      <FridayPackageBuilderModal
        open={packageWizardOpen}
        onClose={() => setPackageWizardOpen(false)}
        onCreated={() => {
          panelBus.emit("package_manager");
          panelBus.emit("dashboard_sync");
          fetchPackages();
        }}
      />

      <div className="shrink-0 px-2 py-1.5 border-b border-[var(--border-color)] flex items-center justify-between gap-2 bg-[var(--bg-secondary)]/40">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
          Package Kanban
        </h3>
        <div className="flex items-center gap-1.5">
          {PLANNER_PACKAGE_TEMPLATES.length > 0 ? (
            <button
              type="button"
              onClick={() => setPackageWizardOpen(true)}
              className="text-[10px] font-semibold px-2.5 py-1 rounded-md border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              Package wizard
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setAddPackageOpen(true)}
            className="text-[10px] font-semibold px-2.5 py-1 rounded-md bg-[#E67E22] text-white hover:opacity-90 transition-opacity"
          >
            New package
          </button>
        </div>
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
          {migrationError ? <p className="mt-1.5 text-[10px] text-red-400/90">{migrationError}</p> : null}
        </div>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-[var(--text-tertiary)]">Loading packages…</p>
        </div>
      ) : combined.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-4">
          <p className="text-sm text-[var(--text-tertiary)] text-center">
            No packages yet — use <strong className="text-[var(--text-secondary)]">New package</strong> or{" "}
            <strong className="text-[var(--text-secondary)]">package_manager</strong> with Friday in chat.
          </p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex overflow-x-auto">
          {COLUMNS.map((col) => {
            const colPkgs = combined.filter((c) => columnKeyForStage(c.stageNorm) === col.key);
            return (
              <div
                key={col.key}
                className="flex-1 min-w-[148px] flex flex-col border-r border-[var(--border-color)] last:border-r-0"
              >
                <div className="shrink-0 px-2 py-2 border-b border-[var(--border-color)] flex items-center gap-1.5 bg-[var(--bg-primary)]/30">
                  <span
                    className="w-2 h-2 rounded-full shrink-0 opacity-70"
                    style={{ backgroundColor: col.color }}
                  />
                  <span className="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider truncate">
                    {col.label}
                  </span>
                  {colPkgs.length > 0 && (
                    <span className="text-[10px] text-[var(--text-tertiary)] ml-auto tabular-nums shrink-0">
                      {colPkgs.length}
                    </span>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto p-1.5 space-y-1.5">
                  {colPkgs.length === 0 ? (
                    <div className="flex items-center justify-center py-6">
                      <span className="text-[10px] text-[var(--text-tertiary)]">—</span>
                    </div>
                  ) : (
                    colPkgs.map((c) => {
                      const planned = plannedDeliverableCount(c.planner.spec, c.planner.templateId);
                      const displayWorkflowCount = Math.max(c.planner.workflowCount, planned);
                      return (
                        <PackageKanbanCard
                          key={c.planner.id}
                          pkg={{
                            id: c.planner.id,
                            name: c.planner.name,
                            templateId: c.planner.templateId,
                            stage: c.stageNorm,
                            packageNumber: c.planner.packageNumber,
                            workflowCount: displayWorkflowCount,
                            itemCount: c.friday.itemCount,
                          }}
                          onOpen={() => setDetailId(c.planner.id)}
                        />
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {detailEntry ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-6 bg-black/55"
          role="presentation"
          onClick={() => setDetailId(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Package ${detailEntry.planner.name}`}
            className="w-full max-w-2xl max-h-[min(92vh,720px)] flex flex-col overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {detailEntry.stageNorm !== "DRAFT" && detailEntry.stageNorm !== "PENDING_APPROVAL" ? (
              <div className="shrink-0 flex items-center justify-end gap-2 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2">
                <button
                  type="button"
                  onClick={() => setDetailId(null)}
                  className="rounded-md border border-[var(--border-color)] px-2.5 py-1 text-[10px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]"
                >
                  Close
                </button>
              </div>
            ) : null}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 space-y-3">
              {detailEntry.stageNorm === "DRAFT" || detailEntry.stageNorm === "PENDING_APPROVAL" ? (
                <>
                  <PackageDetailCard
                    pkg={detailEntry.planner}
                    onWorkflowsSaved={handleDetailWorkflowsSaved}
                    onDeleted={handlePlannerPackageDeleted}
                    onPackageMutate={fetchPackages}
                    onDismiss={() => setDetailId(null)}
                  />
                  {detailEntry.stageNorm === "PENDING_APPROVAL" ? (
                    <div className="rounded-lg border border-[var(--border-color)] overflow-hidden flex flex-col max-h-52">
                      <div className="shrink-0 px-2 py-1.5 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
                        <span className="text-[9px] font-medium text-[var(--text-secondary)] uppercase tracking-wider">
                          Sim logs
                        </span>
                      </div>
                      <SimLogViewer packageId={detailEntry.planner.id} />
                    </div>
                  ) : null}
                </>
              ) : (
                <FridayPackageCard
                  pkg={detailEntry.friday}
                  onPackageMutate={fetchPackages}
                  onOpenWorkflowKanban={openWorkflowKanban}
                />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
