"use client";

import { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { WORKFLOW_TYPES, type StageSpec, type WorkflowTypeSpec } from "@/lib/workflow-types";
import type { PackageSpec, PackageDeliverable } from "@/lib/package-types";
import { PACKAGE_TEMPLATES } from "@/lib/package-types";
import { TIM_WARM_OUTREACH_PACKAGE_BRIEF } from "@/lib/package-spec-briefs/tim-warm-outreach-package-brief";
import { panelBus } from "@/lib/events";
import { useDocumentVisible } from "@/lib/use-document-visible";
import { getAgentSpec } from "@/lib/agent-registry";
import AgentAvatar from "../AgentAvatar";
import ArtifactViewer from "../shared/ArtifactViewer";
import CampaignSpecModal from "./CampaignSpecModal";

const ITEM_TYPE_LABELS: Record<string, string> = {
  person: "people",
  content: "content",
};

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

interface PackageDetailCardProps {
  pkg: PackageRow;
  /**
   * When true (Package Planner Draft column), card starts collapsed regardless of pkg.stage quirks.
   * When omitted, falls back to: collapsed iff stage is DRAFT.
   */
  initialCollapsed?: boolean;
  /** After PATCH (rename, etc.) refresh the planner list */
  onPackageMutate?: () => void;
}

export default function PackageDetailCard({ pkg, initialCollapsed, onPackageMutate }: PackageDetailCardProps) {
  const [wfLookup, setWfLookup] = useState<Record<string, WorkflowTypeSpec>>(() => ({ ...WORKFLOW_TYPES }));
  useEffect(() => {
    let cancel = false;
    fetch("/api/crm/workflow-type-definitions", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { types?: WorkflowTypeSpec[] } | null) => {
        if (cancel || !data?.types?.length) return;
        const m: Record<string, WorkflowTypeSpec> = {};
        for (const t of data.types) m[t.id] = t;
        setWfLookup(m);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, []);

  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof initialCollapsed === "boolean") return initialCollapsed;
    const stage = String(pkg.stage ?? "")
      .trim()
      .toUpperCase();
    return stage === "DRAFT";
  });
  const [useFakeData, setUseFakeData] = useState(() => {
    // Read from package spec if available (persisted by activate route), default unchecked
    const spec = typeof pkg.spec === "string" ? JSON.parse(pkg.spec) : pkg.spec;
    return spec?.useFakeData ?? false;
  });
  const [expandedStage, setExpandedStage] = useState<string | null>(null);
  const [pkgStage, setPkgStage] = useState(
    // Use stored stage, fallback to checking workflow count
    pkg.stage?.toUpperCase() || (pkg.workflowCount > 0 ? "PENDING_APPROVAL" : "DRAFT")
  );
  const [simLog, setSimLogRaw] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = sessionStorage.getItem(`simLog-${pkg.id}`);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const setSimLog = useCallback((updater: string[] | ((prev: string[]) => string[])) => {
    setSimLogRaw((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      try {
        sessionStorage.setItem(`simLog-${pkg.id}`, JSON.stringify(next));
        panelBus.emit("sim_log");
      } catch {}
      return next;
    });
  }, [pkg.id]);
  const [renamingPackage, setRenamingPackage] = useState(false);
  const [nameDraft, setNameDraft] = useState(pkg.name);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const tabVisible = useDocumentVisible();

  useEffect(() => {
    setNameDraft(pkg.name);
    setRenamingPackage(false);
    setNameError(null);
  }, [pkg.id, pkg.name]);

  const savePackageName = useCallback(async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setNameError("Name cannot be empty");
      return;
    }
    if (trimmed === pkg.name.trim()) {
      setRenamingPackage(false);
      return;
    }
    setSavingName(true);
    setNameError(null);
    try {
      const r = await fetch("/api/crm/packages", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id: pkg.id, name: trimmed }),
      });
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setNameError(data.error || `Failed (${r.status})`);
        return;
      }
      setRenamingPackage(false);
      panelBus.emit("package_manager");
      onPackageMutate?.();
    } finally {
      setSavingName(false);
    }
  }, [nameDraft, onPackageMutate, pkg.id, pkg.name]);

  const [artifactView, setArtifactView] = useState<{
    workflowId?: string;
    itemType?: "person" | "content";
    agentId?: string;
    title?: string;
    allWorkflowArtifacts?: boolean;
  } | null>(null);
  // Stage progress: { workflowType: { stageKey: count } }
  const [progress, setProgress] = useState<Record<string, Record<string, number>>>({});
  // Volume tracking: { workflowType: { targetCount, totalItems } }
  const [volumeInfo, setVolumeInfo] = useState<Record<string, { targetCount: number; totalItems: number }>>({});
  // Artifact stages: { workflowType: string[] }
  const [artifactStages, setArtifactStages] = useState<Record<string, string[]>>({});
  // Workflow ID by type: { workflowType: workflowId }
  const [workflowIds, setWorkflowIds] = useState<Record<string, string>>({});

  // Use template deliverables as the authoritative source (order, indices, blockedBy all reference template positions)
  // Fall back to stored spec deliverables only if no template exists
  const template = PACKAGE_TEMPLATES[pkg.templateId];
  const deliverables = template?.deliverables || pkg.spec?.deliverables || [];
  const showPackageBrief = Boolean(template?.showPackageBrief);

  const initialBrief = (() => {
    try {
      const s = typeof pkg.spec === "string" ? JSON.parse(pkg.spec) : pkg.spec;
      return typeof s?.brief === "string" ? s.brief : "";
    } catch {
      return "";
    }
  })();
  const [briefText, setBriefText] = useState(initialBrief);
  const [specModalOpen, setSpecModalOpen] = useState(false);

  useEffect(() => {
    setBriefText(initialBrief);
  }, [pkg.id, initialBrief]);

  // Backfill canonical Tim warm-outreach brief when the row was created before spec.brief was wired (e.g. default package name "Warm Outreach", dev store, or pre-seed DB).
  useEffect(() => {
    if (pkg.templateId !== "vibe-coding-outreach") return;
    if (initialBrief.trim() !== "") return;

    const ac = new AbortController();
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch("/api/crm/packages", {
          method: "PATCH",
          signal: ac.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: pkg.id,
            spec: { brief: TIM_WARM_OUTREACH_PACKAGE_BRIEF },
          }),
        });
        if (!cancelled && !ac.signal.aborted && r.ok) {
          setBriefText(TIM_WARM_OUTREACH_PACKAGE_BRIEF);
        }
      } catch {
        /* ignore abort / network */
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [pkg.id, pkg.templateId, initialBrief]);

  // Poll for stage progress when active or testing
  useEffect(() => {
    if (pkgStage !== "ACTIVE" && pkgStage !== "PENDING_APPROVAL") {
      setProgress({});
      return;
    }
    const fetchProgress = () => {
      fetch(`/api/crm/packages/progress?packageId=${pkg.id}`)
        .then((r) => r.json())
        .then((d) => {
          const wfs = d.workflows || {};
          const byType: Record<string, Record<string, number>> = {};
          const byVol: Record<string, { targetCount: number; totalItems: number }> = {};
          const byArt: Record<string, string[]> = {};
          const byId: Record<string, string> = {};
          for (const [wfId, wf] of Object.entries(wfs) as Array<[string, { workflowType: string; stageCounts: Record<string, number>; targetCount: number; totalItems: number; artifactStages?: string[] }]>) {
            byType[wf.workflowType] = wf.stageCounts;
            byVol[wf.workflowType] = { targetCount: wf.targetCount, totalItems: wf.totalItems };
            byArt[wf.workflowType] = wf.artifactStages || [];
            byId[wf.workflowType] = wfId;
          }
          setProgress(byType);
          setVolumeInfo(byVol);
          setArtifactStages(byArt);
          setWorkflowIds(byId);
        })
        .catch(() => {});
    };
    fetchProgress();
    const ms = tabVisible ? 5000 : 20_000;
    const interval = setInterval(fetchProgress, ms);
    return () => clearInterval(interval);
  }, [pkgStage, pkg.id, tabVisible]);

  // Move to Testing mode (no tasks created yet)
  const appendActivationLog = useCallback((data: { activationLog?: string[] }) => {
    if (!data.activationLog?.length) return;
    const lines = [...data.activationLog!].reverse();
    setSimLog((prev) => [...lines, ...prev]);
  }, []);

  const handleTest = useCallback(async () => {
    try {
      const res = await fetch("/api/crm/packages/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageId: pkg.id, targetStage: "PENDING_APPROVAL", skipTasks: true }),
      });
      const data = await res.json();
      if (data.ok) {
        setPkgStage("PENDING_APPROVAL");
        setSimLog((prev) => [
          `[${new Date().toLocaleTimeString()}] Moved to Testing (no workflows yet)`,
          ...prev,
        ]);
        appendActivationLog(data);
        panelBus.emit("package_manager");
        panelBus.emit("dashboard_sync");
      } else {
        setSimLog((prev) => [
          `[${new Date().toLocaleTimeString()}] Error: ${data.error}`,
          ...[...(data.activationLog || [])].reverse(),
          ...(data.detail ? [`Detail: ${data.detail}`] : []),
          ...prev,
        ]);
      }
    } catch (e) {
      setSimLog((prev) => [`${new Date().toLocaleTimeString()}] Test failed: ${e}`, ...prev]);
    }
  }, [pkg.id, appendActivationLog]);

  // Start the test — create workflows and first task
  const handleStartTest = useCallback(async () => {
    try {
      const res = await fetch("/api/crm/packages/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageId: pkg.id, targetStage: "PENDING_APPROVAL", useFakeData }),
      });
      const data = await res.json();
      if (data.ok) {
        setSimLog((prev) => [
          `[${new Date().toLocaleTimeString()}] Start Test: ${data.workflows.length} workflow(s) created`,
          ...data.workflows.map(
            (w: { label: string; ownerAgent: string; workflowId?: string }) =>
              `  → ${w.label} (${w.ownerAgent})${w.workflowId ? ` [${w.workflowId.slice(0, 8)}…]` : ""}`
          ),
          ...prev,
        ]);
        appendActivationLog(data);
        panelBus.emit("package_manager");
        panelBus.emit("dashboard_sync");
      } else {
        setSimLog((prev) => [
          `[${new Date().toLocaleTimeString()}] Error: ${data.error}`,
          ...[...(data.activationLog || [])].reverse(),
          ...(data.detail ? [`Detail: ${data.detail}`] : []),
          ...prev,
        ]);
      }
    } catch (e) {
      setSimLog((prev) => [`${new Date().toLocaleTimeString()}] Start failed: ${e}`, ...prev]);
    }
  }, [pkg.id, useFakeData, appendActivationLog]);

  const handleActivate = useCallback(async () => {
    try {
      const res = await fetch("/api/crm/packages/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageId: pkg.id,
          targetStage: "ACTIVE",
          useFakeData,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setPkgStage("ACTIVE");
        setSimLog((prev) => [
          `[${new Date().toLocaleTimeString()}] Activated: package is now live`,
          ...prev,
        ]);
        appendActivationLog(data);
        panelBus.emit("package_manager");
        panelBus.emit("dashboard_sync");
      } else {
        setSimLog((prev) => [
          `[${new Date().toLocaleTimeString()}] Error: ${data.error}`,
          ...[...(data.activationLog || [])].reverse(),
          ...(data.detail ? [`Detail: ${data.detail}`] : []),
          ...prev,
        ]);
      }
    } catch (e) {
      setSimLog((prev) => [`${new Date().toLocaleTimeString()}] Activation failed: ${e}`, ...prev]);
    }
  }, [pkg.id, appendActivationLog]);

  // Reset clears test data but stays in current stage (PENDING_APPROVAL)
  const handleReset = useCallback(async () => {
    try {
      const res = await fetch("/api/crm/packages/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageId: pkg.id }),
      });
      const data = await res.json();
      if (data.ok) {
        setSimLog((prev) => [
          `Reset: cleared ${data.cleared.workflows} workflows, ${data.cleared.boards} boards. Ready to Start Test again.`,
          ...prev,
        ]);
        setProgress({});
        setVolumeInfo({});
        setArtifactStages({});
        setWorkflowIds({});
        panelBus.emit("package_manager");
        panelBus.emit("dashboard_sync");
      } else {
        setSimLog((prev) => [`Reset error: ${data.error}`, ...prev]);
      }
    } catch (e) {
      setSimLog((prev) => [`Reset failed: ${e}`, ...prev]);
    }
  }, [pkg.id]);

  // Back to Draft — reset data and move stage back
  const handleBackToDraft = useCallback(async () => {
    try {
      const res = await fetch("/api/crm/packages/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageId: pkg.id, targetStage: "DRAFT" }),
      });
      const data = await res.json();
      if (data.ok) {
        setPkgStage("DRAFT");
        setSimLog([]);
        try { sessionStorage.removeItem(`simLog-${pkg.id}`); } catch {}
        setProgress({});
        setVolumeInfo({});
        setArtifactStages({});
        setWorkflowIds({});
        panelBus.emit("package_manager");
        panelBus.emit("dashboard_sync");
      } else {
        setSimLog((prev) => [`Error: ${data.error}`, ...prev]);
      }
    } catch (e) {
      setSimLog((prev) => [`Failed: ${e}`, ...prev]);
    }
  }, [pkg.id]);

  const btnBase =
    "text-[10px] px-2 py-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-tertiary)] transition-colors font-medium cursor-pointer";
  const btnAccent =
    "text-[10px] px-2 py-1 rounded-md border border-[var(--accent-green)]/30 bg-[var(--accent-green)]/10 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--accent-green)]/15 transition-colors font-medium cursor-pointer";
  const btnWarm =
    "text-[10px] px-2 py-1 rounded-md border border-[var(--accent-orange)]/25 bg-[var(--accent-orange)]/8 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--accent-orange)]/12 transition-colors font-medium cursor-pointer";

  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1 flex items-start gap-1.5">
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="min-w-0 flex items-center gap-1.5 text-left hover:opacity-80 transition-opacity flex-1"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--text-tertiary)"
              strokeWidth="2"
              strokeLinecap="round"
              className={`shrink-0 transition-transform mt-0.5 ${isCollapsed ? "-rotate-90" : ""}`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
            <div className="min-w-0 flex-1">
              {renamingPackage ? (
                <div className="space-y-1" onClick={(e) => e.stopPropagation()}>
                  <input
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    className="w-full text-xs font-semibold bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-1.5 py-1 text-[var(--text-primary)]"
                    disabled={savingName}
                    autoFocus
                  />
                  {nameError ? (
                    <p className="text-[9px] text-red-400/90">{nameError}</p>
                  ) : null}
                  <div className="flex gap-1">
                    <button
                      type="button"
                      disabled={savingName}
                      onClick={savePackageName}
                      className="text-[9px] px-2 py-0.5 rounded bg-[var(--accent-green)]/20 text-[var(--accent-green)] font-semibold border border-[var(--accent-green)]/40"
                    >
                      {savingName ? "…" : "Save"}
                    </button>
                    <button
                      type="button"
                      disabled={savingName}
                      onClick={() => {
                        setNameDraft(pkg.name);
                        setRenamingPackage(false);
                        setNameError(null);
                      }}
                      className="text-[9px] px-2 py-0.5 rounded border border-[var(--border-color)] text-[var(--text-tertiary)]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="text-xs font-semibold text-[var(--text-primary)] truncate">
                    {pkg.packageNumber != null && !Number.isNaN(pkg.packageNumber) && (
                      <span className="text-[var(--text-tertiary)] font-bold tabular-nums mr-1">
                        #{pkg.packageNumber}
                      </span>
                    )}
                    {pkg.name}
                  </div>
                  <div className="text-[10px] text-[var(--text-tertiary)] truncate">{pkg.templateId}</div>
                </>
              )}
            </div>
          </button>
          {!renamingPackage && (
            <button
              type="button"
              title="Rename package"
              onClick={(e) => {
                e.stopPropagation();
                setRenamingPackage(true);
              }}
              className="shrink-0 p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)]"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {pkgStage === "DRAFT" && (
            <>
              <label
                className="flex items-center gap-1 text-[9px] text-[var(--text-tertiary)] cursor-pointer select-none"
                title="Only for Draft / Testing. Unchecked = real Ghost spec + article (Anthropic). Checked = template placeholders. Active packages always use real APIs."
              >
                <input
                  type="checkbox"
                  checked={useFakeData}
                  onChange={(e) => setUseFakeData(e.target.checked)}
                  className="w-3 h-3 rounded border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--accent-green)]"
                />
                Fake Data
              </label>
              <button onClick={handleTest} className={btnWarm}>
                Test
              </button>
            </>
          )}
          {pkgStage === "PENDING_APPROVAL" && (
            <>
              <label
                className="flex items-center gap-1 text-[9px] text-[var(--text-tertiary)] cursor-pointer select-none"
                title="Only while testing. Unchecked = real APIs. Checked = placeholders. Goes away once the package is Active."
              >
                <input
                  type="checkbox"
                  checked={useFakeData}
                  onChange={(e) => setUseFakeData(e.target.checked)}
                  className="w-3 h-3 rounded border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--accent-green)]"
                />
                Fake Data
              </label>
              <button onClick={handleStartTest} className={btnWarm}>
                Start Test
              </button>
              <button onClick={handleReset} className={btnBase}>
                Reset
              </button>
              <button onClick={handleActivate} className={btnAccent}>
                Activate
              </button>
              <button onClick={handleBackToDraft} className={btnBase}>
                Draft
              </button>
            </>
          )}
          {pkgStage === "ACTIVE" && (
            <button onClick={handleReset} className={btnBase}>
              Reset
            </button>
          )}
        </div>
      </div>

      {showPackageBrief && (
        <div className="px-3 py-1.5 border-b border-[var(--border-color)] flex items-center justify-between gap-2 bg-[var(--bg-primary)]/40">
          <span className="text-[10px] text-[var(--text-secondary)] truncate min-w-0">
            <span className="text-[var(--text-tertiary)]">Outreach brief:</span>{" "}
            {briefText.trim() ? (
              <span className="text-[var(--text-primary)]">Set ({briefText.trim().length} chars)</span>
            ) : (
              <span className="text-amber-600/90">Not set — recommended before Start Test</span>
            )}
          </span>
          <button
            type="button"
            onClick={() => setSpecModalOpen(true)}
            className="shrink-0 text-[10px] px-2 py-0.5 rounded font-semibold text-white bg-[#E67E22] hover:opacity-90 transition-opacity"
          >
            Edit
          </button>
        </div>
      )}

      {/* Collapsible body */}
      {!isCollapsed && (
      <>

      {/* Deliverables */}
      {deliverables.length > 0 && (
        <div className="border-t border-[var(--border-color)] px-4 py-4 space-y-5">
          {deliverables.map((d, idx) => {
            const wfType = wfLookup[d.workflowType];
            const stages = wfType?.defaultBoard?.stages || [];
            const itemTypeLabel = wfType
              ? ITEM_TYPE_LABELS[wfType.itemType] || wfType.itemType
              : "items";

            return (
              <DeliverableRow
                key={idx}
                label={d.label}
                agent={d.ownerAgent}
                volume={d.targetCount}
                volumeLabel={d.volumeLabel}
                itemType={wfType?.itemType || "content"}
                itemTypeLabel={itemTypeLabel}
                stages={stages}
                stageNotes={d.stageNotes}
                expandedStage={expandedStage}
                onToggleStage={(key) => {
                  const fullKey = `${idx}-${key}`;
                  setExpandedStage(expandedStage === fullKey ? null : fullKey);
                }}
                deliverableIndex={idx}
                blockedBy={d.blockedBy}
                stopWhen={d.stopWhen}
                allDeliverables={deliverables}
                stageCounts={progress[d.workflowType] || {}}
                volumeInfo={volumeInfo[d.workflowType]}
                pacing={d.pacing}
                workflowTypesById={wfLookup}
                onInspect={async () => {
                  let wid = workflowIds[d.workflowType];
                  if (!wid) {
                    try {
                      const r = await fetch(`/api/crm/packages/progress?packageId=${pkg.id}`);
                      const j = await r.json();
                      const wmap = j.workflows || {};
                      for (const [id, wf] of Object.entries(wmap) as [string, { workflowType?: string }][]) {
                        if (wf.workflowType === d.workflowType) {
                          wid = id;
                          break;
                        }
                      }
                    } catch {
                      /* ignore */
                    }
                  }
                  if (!wid) return;
                  setWorkflowIds((prev) => ({ ...prev, [d.workflowType]: wid! }));
                  setArtifactView({
                    workflowId: wid,
                    agentId: d.ownerAgent,
                    title: `${pkg.name} — ${d.label}`,
                    allWorkflowArtifacts: true,
                    itemType: "content",
                  });
                }}
              />
            );
          })}
        </div>
      )}

      {/* Footer */}
      {(pkg.customerId || pkg.workflowCount > 0) && (
        <div className="border-t border-[var(--border-color)] px-3 py-1.5 flex items-center gap-3 text-[10px] text-[var(--text-tertiary)]">
          {pkg.customerId && (
            <span>Customer: {pkg.customerId.slice(0, 8)}...</span>
          )}
          {pkg.workflowCount > 0 && (
            <span>{pkg.workflowCount} workflows</span>
          )}
        </div>
      )}

      </>
      )}


      {/* Artifact Viewer — portal to escape overflow */}
      {artifactView && typeof document !== "undefined" && createPortal(
        <ArtifactViewer
          workflowId={artifactView.workflowId}
          itemType={artifactView.itemType || "content"}
          agentId={artifactView.agentId}
          title={artifactView.title}
          allWorkflowArtifacts={artifactView.allWorkflowArtifacts}
          onClose={() => setArtifactView(null)}
        />,
        document.body
      )}

      {specModalOpen && (
        <CampaignSpecModal
          packageId={pkg.id}
          packageName={pkg.name}
          initialSpec={briefText}
          modalTitle="Outreach brief"
          helpText="Messaging angle, tone, what Govind is building (vibe coding / AI agents), boundaries (no pitch deck, no links), and anything Tim should honor for every contact in this package. Saved as package spec.brief and copied to each workflow item as the first artifact when you start testing."
          placeholder="Example: Friend-to-first tone. Govind is focused on vibe coding and shipping AI-agent workflows for teams. DMs are short, no strattegys.com links. Mention Intuit-style speed only if it fits..."
          onClose={() => setSpecModalOpen(false)}
          onSave={(text) => setBriefText(text)}
        />
      )}
    </div>
  );
}

// ─── Deliverable Row ──────────────────────────────────────────────

interface DeliverableRowProps {
  label: string;
  agent: string;
  volume: number;
  /** Overrides derived volume line (e.g. "Five messages per day") */
  volumeLabel?: string;
  itemType: "person" | "content";
  itemTypeLabel: string;
  stages: StageSpec[];
  stageNotes?: Record<string, string>;
  expandedStage: string | null;
  onToggleStage: (stageKey: string) => void;
  deliverableIndex: number;
  blockedBy?: PackageDeliverable["blockedBy"];
  stopWhen?: PackageDeliverable["stopWhen"];
  allDeliverables: PackageDeliverable[];
  stageCounts: Record<string, number>;
  volumeInfo?: { targetCount: number; totalItems: number };
  pacing?: { batchSize: number; interval: string; bufferPercent?: number };
  onInspect: () => void | Promise<void>;
  workflowTypesById: Record<string, WorkflowTypeSpec>;
}

function DeliverableRow({
  label,
  agent,
  volume,
  volumeLabel,
  itemType,
  itemTypeLabel,
  stages,
  stageNotes,
  expandedStage,
  onToggleStage,
  deliverableIndex,
  blockedBy,
  stopWhen,
  allDeliverables,
  stageCounts,
  volumeInfo,
  pacing,
  onInspect,
  workflowTypesById,
}: DeliverableRowProps) {
  const agentColor = getAgentSpec(agent).color;
  const totalInPipeline = volumeInfo?.totalItems || 0;
  // Use raw volume prop (from deliverable template) for display logic, not API response
  const isContinuous = volume === 0 && !!stopWhen;

  const intervalLabel = pacing?.interval === "daily" ? "per day" : pacing?.interval === "weekly" ? "per week" : pacing?.interval === "biweekly" ? "every 2 weeks" : "";

  // Build volume display string
  let volumeDisplay = "";
  if (volumeLabel && volumeLabel.trim()) {
    volumeDisplay = volumeLabel.trim();
  } else if (isContinuous) {
    // Scout: just "5 per day"
    volumeDisplay = pacing ? `${pacing.batchSize} ${intervalLabel}` : "continuous";
  } else if (itemType === "person" && volume > 0) {
    // Tim: "20 messages" — person workflows show the output goal only
    volumeDisplay = `${volume} messages`;
  } else if (pacing && volume > 1) {
    // Marni posts: "3 posts · 1 per week"
    volumeDisplay = `${volume} ${itemTypeLabel} · ${pacing.batchSize} ${intervalLabel}`;
  } else if (volume === 1) {
    // Ghost: "1 article"
    volumeDisplay = `1 ${itemTypeLabel}`;
  } else {
    volumeDisplay = `${totalInPipeline > 0 ? `${totalInPipeline}/${volume}` : `${volume}`} ${itemTypeLabel}`;
  }

  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
      {/* Header: agent avatar + label + agent name + volume + inspect */}
      <div className="flex items-center gap-3 mb-2.5">
        <span
          className="rounded-full shrink-0 opacity-90"
          style={{ padding: "1px", background: `${agentColor}55` }}
        >
          <AgentAvatar
            agentId={agent}
            name={getAgentSpec(agent).name}
            color={agentColor}
            circleClassName="w-7 h-7 min-w-[28px] min-h-[28px]"
            initialClassName="text-xs font-semibold text-white"
          />
        </span>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-xs font-semibold text-[var(--text-primary)] leading-tight">
            {label}
          </span>
          <span className="text-[10px] text-[var(--text-tertiary)] capitalize">
            {agent} · {volumeDisplay}
          </span>
        </div>
        <button
            type="button"
            onClick={() => void onInspect()}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-secondary)] transition-colors text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            title="Artifact history (all items in this workflow)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
          </button>
      </div>

      {/* Dependency info */}
      {blockedBy && blockedBy.length > 0 && (
        <div className="mb-4 space-y-1.5">
          {blockedBy.map((dep, i) => {
            const depDeliverable = allDeliverables[dep.deliverableIndex];
            const depWf = depDeliverable
              ? workflowTypesById[depDeliverable.workflowType]
              : null;
            const depStage = depWf?.defaultBoard?.stages.find(
              (st: StageSpec) => st.key === dep.stage
            );
            return (
              <div
                key={i}
                className="flex items-center gap-1.5 text-[10px] text-[var(--text-tertiary)]"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  className="opacity-60 shrink-0"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 8v4l2 2" />
                </svg>
                <span>
                  Waits for{" "}
                  <span className="font-medium text-[var(--text-secondary)]">
                    {depDeliverable?.label || `#${dep.deliverableIndex}`}
                  </span>
                  {" → "}
                  <span
                    className="font-medium px-1.5 py-0.5 rounded text-[9px] border border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]"
                    style={{
                      borderColor: depStage?.color ? `${depStage.color}40` : undefined,
                    }}
                  >
                    {depStage?.label || dep.stage}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Stop condition */}
      {stopWhen && (
        <div className="mb-4">
          {(() => {
            const triggerDel = allDeliverables[stopWhen.deliverableIndex];
            const triggerWf = triggerDel ? workflowTypesById[triggerDel.workflowType] : null;
            const triggerStage = triggerWf?.defaultBoard?.stages.find(
              (st: StageSpec) => st.key === stopWhen.stage
            );
            return (
              <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-tertiary)]">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="opacity-60 shrink-0">
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                  <path d="M9 9h6v6H9z" />
                </svg>
                <span>
                  Stops when{" "}
                  <span className="font-medium text-[var(--text-secondary)]">
                    {triggerDel?.label || `#${stopWhen.deliverableIndex}`}
                  </span>
                  {" → "}
                  <span
                    className="font-medium px-1.5 py-0.5 rounded text-[9px] border border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]"
                    style={{
                      borderColor: triggerStage?.color ? `${triggerStage.color}40` : undefined,
                    }}
                  >
                    {triggerStage?.label || stopWhen.stage}
                  </span>
                  {" = "}
                  <span className="font-medium text-[var(--text-secondary)]">{stopWhen.count}</span>
                </span>
              </div>
            );
          })()}
        </div>
      )}

      {/* Stage pipeline */}
      {(() => {
        // Detect cycles: find stages that transition back to an earlier stage
        const wfType = workflowTypesById[allDeliverables[deliverableIndex]?.workflowType];
        const transitions = wfType?.defaultBoard?.transitions || {};
        const cycles: Array<{ fromIdx: number; toIdx: number }> = [];
        stages.forEach((s, i) => {
          const targets = transitions[s.key] || [];
          targets.forEach((t: string) => {
            const targetIdx = stages.findIndex(st => st.key === t);
            if (targetIdx >= 0 && targetIdx < i) {
              cycles.push({ fromIdx: i, toIdx: targetIdx });
            }
          });
        });
        const cycleArrowAfter = new Set(cycles.map(c => c.toIdx));

        return (
          <div className="flex flex-wrap gap-1.5 items-center">
            {stages.map((s, i) => {
              const fullKey = `${deliverableIndex}-${s.key}`;
              const isExpanded = expandedStage === fullKey;
              const hasNote = stageNotes?.[s.key];
              const count = stageCounts[s.key] || 0;
              const showCycleArrow = cycleArrowAfter.has(i);

              return (
                <div key={s.key} className="flex items-center gap-0.5">
                  <button
                    onClick={() => onToggleStage(s.key)}
                    className="relative text-[9px] px-1.5 py-0.5 rounded-md font-medium border transition-colors flex items-center gap-0.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    style={{
                      backgroundColor: `${s.color}14`,
                      borderColor: isExpanded ? "var(--text-tertiary)" : `${s.color}35`,
                    }}
                    title={s.instructions}
                  >
                    {s.requiresHuman && (
                      <svg width="7" height="7" viewBox="0 0 24 24" fill="currentColor" stroke="none" className="opacity-70">
                        <circle cx="12" cy="7" r="4" />
                        <path d="M5.5 21a6.5 6.5 0 0 1 13 0" />
                      </svg>
                    )}
                    {s.label}
                    {hasNote ? " *" : ""}
                    {count > 0 && (
                      <span className="ml-0.5 inline-flex items-center justify-center min-w-[14px] h-[14px] rounded-full bg-[var(--bg-tertiary)] text-[8px] font-medium text-[var(--text-tertiary)]">
                        {count}
                      </span>
                    )}
                  </button>
                  {i < stages.length - 1 && (
                    showCycleArrow ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 2l4 4-4 4" />
                        <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                        <path d="M7 22l-4-4 4-4" />
                        <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                      </svg>
                    ) : (
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2.5" strokeLinecap="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    )
                  )}
                </div>
                );
              })}
            </div>
        );
      })()}

      {/* Expanded instructions panel */}
      {stages.map((s) => {
        const fullKey = `${deliverableIndex}-${s.key}`;
        if (expandedStage !== fullKey) return null;
        const note = stageNotes?.[s.key];

        return (
          <div
            key={`detail-${s.key}`}
            className="mt-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] p-2 text-[11px] leading-relaxed"
          >
            {s.requiresHuman && (
              <div className="flex items-center gap-1 mb-1.5">
                <span className="text-[9px] px-1.5 py-0.5 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-tertiary)] font-medium uppercase tracking-wide">
                  Human required
                </span>
              </div>
            )}
            <div className="text-[var(--text-secondary)]">
              {s.instructions}
            </div>
            {s.requiresHuman && s.humanAction && (
              <div className="mt-1.5 pt-1.5 border-t border-[var(--border-color)]">
                <div className="flex items-center gap-1 mb-0.5">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-[var(--text-tertiary)]">
                    <circle cx="12" cy="7" r="4" />
                    <path d="M5.5 21a6.5 6.5 0 0 1 13 0" />
                  </svg>
                  <span className="text-[10px] font-medium text-[var(--text-secondary)]">
                    Your action
                  </span>
                </div>
                <p className="text-[11px] text-[var(--text-tertiary)] leading-relaxed">
                  {s.humanAction}
                </p>
              </div>
            )}
            {note && (
              <div className="mt-1.5 pt-1.5 border-t border-[var(--border-color)] text-[var(--text-primary)]">
                <span className="text-[10px] font-semibold text-[var(--text-tertiary)]">
                  Note:{" "}
                </span>
                {note}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
