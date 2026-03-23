"use client";

import { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { WORKFLOW_TYPES, type StageSpec } from "@/lib/workflow-types";
import type { PackageSpec, PackageDeliverable } from "@/lib/package-types";
import { PACKAGE_TEMPLATES } from "@/lib/package-types";
import CampaignSpecModal from "./CampaignSpecModal";
import ArtifactViewer from "../shared/ArtifactViewer";

const AGENT_COLORS: Record<string, string> = {
  scout: "#2563EB",
  tim: "#1D9E75",
  ghost: "#4A90D9",
  marni: "#D4A017",
  penny: "#E67E22",
  friday: "#9B59B6",
  king: "#FFFFFF",
};

const ITEM_TYPE_LABELS: Record<string, string> = {
  person: "people",
  content: "content",
};

const STAGE_COLORS: Record<string, string> = {
  DRAFT: "#6b8a9e",
  PENDING_APPROVAL: "#D4A017",
  ACTIVE: "#1D9E75",
  COMPLETED: "#22c55e",
};

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

interface PackageDetailCardProps {
  pkg: PackageRow;
}

export default function PackageDetailCard({ pkg }: PackageDetailCardProps) {
  const [expandedStage, setExpandedStage] = useState<string | null>(null);
  const [specOpen, setSpecOpen] = useState(false);
  const [brief, setBrief] = useState(pkg.spec?.brief || "");
  const [pkgStage, setPkgStage] = useState(
    // Use stored stage, fallback to checking workflow count
    pkg.stage?.toUpperCase() || (pkg.workflowCount > 0 ? "PENDING_APPROVAL" : "DRAFT")
  );
  const [simLog, setSimLog] = useState<string[]>([]);
  const [artifactView, setArtifactView] = useState<{ workflowId?: string; stage?: string; itemType?: string } | null>(null);
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
    const interval = setInterval(fetchProgress, 5000);
    return () => clearInterval(interval);
  }, [pkgStage, pkg.id]);

  const handleTest = useCallback(async () => {
    try {
      const res = await fetch("/api/crm/packages/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageId: pkg.id, targetStage: "PENDING_APPROVAL" }),
      });
      const data = await res.json();
      if (data.ok) {
        setPkgStage("PENDING_APPROVAL");
        setSimLog((prev) => [
          ...prev,
          `Testing: created ${data.workflows.length} workflows`,
          ...data.workflows.map((w: { label: string; ownerAgent: string }) => `  → ${w.label} (${w.ownerAgent})`),
        ]);
      } else {
        setSimLog((prev) => [...prev, `Error: ${data.error}`]);
      }
    } catch (e) {
      setSimLog((prev) => [...prev, `Test failed: ${e}`]);
    }
  }, [pkg.id]);

  const handleActivate = useCallback(async () => {
    try {
      // Just update the stage from PENDING_APPROVAL to ACTIVE
      const res = await fetch("/api/crm/packages/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageId: pkg.id, targetStage: "ACTIVE" }),
      });
      const data = await res.json();
      if (data.ok) {
        setPkgStage("ACTIVE");
        setSimLog((prev) => [
          ...prev,
          `Activated: package is now live`,
        ]);
      } else {
        setSimLog((prev) => [...prev, `Error: ${data.error}`]);
      }
    } catch (e) {
      setSimLog((prev) => [...prev, `Activation failed: ${e}`]);
    }
  }, [pkg.id]);

  const handleReset = useCallback(async () => {
    try {
      const res = await fetch("/api/crm/packages/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageId: pkg.id }),
      });
      const data = await res.json();
      if (data.ok) {
        setPkgStage("DRAFT");
        setSimLog([`Reset: cleared ${data.cleared.workflows} workflows, ${data.cleared.boards} boards`]);
      } else {
        setSimLog((prev) => [...prev, `Reset error: ${data.error}`]);
      }
    } catch (e) {
      setSimLog((prev) => [...prev, `Reset failed: ${e}`]);
    }
  }, [pkg.id]);

  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-[var(--text-primary)] truncate">
            {pkg.name}
          </div>
          <div className="text-[10px] text-[var(--text-tertiary)]">
            {pkg.templateId}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {pkgStage === "DRAFT" && (
            <button
              onClick={handleTest}
              className="text-[10px] px-2.5 py-1 rounded-full bg-[#D4A017] text-white font-semibold hover:bg-[#b8891a] transition-colors"
            >
              Test
            </button>
          )}
          {pkgStage === "PENDING_APPROVAL" && (
            <>
              <button
                onClick={handleActivate}
                className="text-[10px] px-2.5 py-1 rounded-full bg-[#1D9E75] text-white font-semibold hover:bg-[#17865f] transition-colors"
              >
                Activate
              </button>
              <button
                onClick={handleReset}
                className="text-[10px] px-2.5 py-1 rounded-full bg-[#555] text-white font-semibold hover:bg-[#777] transition-colors"
              >
                Reset
              </button>
            </>
          )}
          {pkgStage === "ACTIVE" && (
            <button
              onClick={handleReset}
              className="text-[10px] px-2.5 py-1 rounded-full bg-[#555] text-white font-semibold hover:bg-[#777] transition-colors"
            >
              Reset
            </button>
          )}
          <span
            className="text-[9px] px-2 py-0.5 rounded-full text-white font-semibold uppercase"
            style={{ backgroundColor: STAGE_COLORS[pkgStage] || "#6b8a9e" }}
          >
            {pkgStage.replace("_", " ")}
          </span>
        </div>
      </div>

      {/* Campaign Specification */}
      <div className="border-t border-[var(--border-color)]">
        <button
          onClick={() => setSpecOpen(true)}
          className="w-full px-3 py-1.5 flex items-center gap-1.5 text-left hover:bg-[var(--bg-tertiary)] transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={brief ? "#E67E22" : "var(--text-tertiary)"} strokeWidth="2" strokeLinecap="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <span className="text-[10px] font-semibold text-[var(--text-secondary)]">
            Campaign Spec
          </span>
          {brief ? (
            <span className="text-[10px] text-[var(--text-tertiary)] truncate ml-1">
              {brief.slice(0, 50)}...
            </span>
          ) : (
            <span className="text-[10px] text-[#E67E22] ml-1">
              Add specification
            </span>
          )}
        </button>
      </div>

      {/* Campaign Spec Modal — portal to escape overflow */}
      {specOpen && typeof document !== "undefined" && createPortal(
        <CampaignSpecModal
          packageId={pkg.id}
          packageName={pkg.name}
          initialSpec={brief}
          onClose={() => setSpecOpen(false)}
          onSave={(newSpec) => setBrief(newSpec)}
        />,
        document.body
      )}

      {/* Deliverables */}
      {deliverables.length > 0 && (
        <div className="border-t border-[var(--border-color)] px-4 py-4 space-y-5">
          {deliverables.map((d, idx) => {
            const wfType = WORKFLOW_TYPES[d.workflowType];
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
                hasData={(artifactStages[d.workflowType] || []).length > 0 || Object.values(progress[d.workflowType] || {}).some(c => c > 0)}
                onInspect={() => setArtifactView({
                  workflowId: workflowIds[d.workflowType],
                  itemType: wfType?.itemType || "content",
                })}
              />
            );
          })}
        </div>
      )}

      {/* Simulation Log */}
      {simLog.length > 0 && (
        <div className="border-t border-[var(--border-color)] px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase">
              Simulation Log
            </span>
            <button
              onClick={() => setSimLog([])}
              className="text-[9px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            >
              Clear
            </button>
          </div>
          <div className="bg-[var(--bg-primary)] rounded border border-[var(--border-color)] p-2 max-h-40 overflow-y-auto">
            {simLog.map((line, i) => (
              <div key={i} className="text-[10px] text-[var(--text-secondary)] font-mono leading-relaxed">
                {line}
              </div>
            ))}
          </div>
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

      {/* Artifact Viewer — portal to escape overflow */}
      {artifactView && typeof document !== "undefined" && createPortal(
        <ArtifactViewer
          workflowId={artifactView.workflowId}
          itemType={artifactView.itemType || "content"}
          onClose={() => setArtifactView(null)}
        />,
        document.body
      )}
    </div>
  );
}

// ─── Deliverable Row ──────────────────────────────────────────────

interface DeliverableRowProps {
  label: string;
  agent: string;
  volume: number;
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
  hasData: boolean;
  onInspect: () => void;
}

function DeliverableRow({
  label,
  agent,
  volume,
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
  hasData,
  onInspect,
}: DeliverableRowProps) {
  const agentColor = AGENT_COLORS[agent] || "#888";
  const totalInPipeline = volumeInfo?.totalItems || 0;
  // Use raw volume prop (from deliverable template) for display logic, not API response
  const isContinuous = volume === 0 && !!stopWhen;

  const intervalLabel = pacing?.interval === "daily" ? "per day" : pacing?.interval === "weekly" ? "per week" : pacing?.interval === "biweekly" ? "every 2 weeks" : "";

  // Build volume display string
  let volumeDisplay = "";
  if (isContinuous) {
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
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
      {/* Header: agent avatar + label + agent name + volume + inspect */}
      <div className="flex items-center gap-3.5 mb-3">
        <img
          src={`/api/agent-avatar?id=${agent}`}
          alt={agent}
          className="w-7 h-7 rounded-full object-cover shrink-0"
          style={{ border: `2px solid ${agentColor}` }}
        />
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-[13px] font-bold text-[var(--text-primary)] leading-tight">
            {label}
          </span>
          <span className="text-[10px] text-[var(--text-tertiary)] capitalize">
            {agent} · {volumeDisplay}
          </span>
        </div>
        {hasData && (
          <button
            onClick={onInspect}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            title={itemType === "person" ? "Inspect people" : "Inspect artifacts"}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
          </button>
        )}
      </div>

      {/* Dependency info */}
      {blockedBy && blockedBy.length > 0 && (
        <div className="mb-4 space-y-1.5">
          {blockedBy.map((dep, i) => {
            const depDeliverable = allDeliverables[dep.deliverableIndex];
            const depWf = depDeliverable
              ? WORKFLOW_TYPES[depDeliverable.workflowType]
              : null;
            const depStage = depWf?.defaultBoard?.stages.find(
              (s) => s.key === dep.stage
            );
            return (
              <div
                key={i}
                className="flex items-center gap-1.5 text-[10px] text-amber-400/80"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 8v4l2 2" />
                </svg>
                <span>
                  Waits for{" "}
                  <span className="font-semibold text-amber-300">
                    {depDeliverable?.label || `#${dep.deliverableIndex}`}
                  </span>
                  {" → "}
                  <span
                    className="font-medium px-1 py-0.5 rounded text-[9px] text-white"
                    style={{
                      backgroundColor: depStage?.color || "#888",
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
            const triggerWf = triggerDel ? WORKFLOW_TYPES[triggerDel.workflowType] : null;
            const triggerStage = triggerWf?.defaultBoard?.stages.find(s => s.key === stopWhen.stage);
            return (
              <div className="flex items-center gap-1.5 text-[10px] text-red-400/80">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                  <path d="M9 9h6v6H9z" />
                </svg>
                <span>
                  Stops when{" "}
                  <span className="font-semibold text-red-300">
                    {triggerDel?.label || `#${stopWhen.deliverableIndex}`}
                  </span>
                  {" → "}
                  <span
                    className="font-medium px-1 py-0.5 rounded text-[9px] text-white"
                    style={{ backgroundColor: triggerStage?.color || "#888" }}
                  >
                    {triggerStage?.label || stopWhen.stage}
                  </span>
                  {" = "}
                  <span className="font-bold text-red-300">{stopWhen.count}</span>
                </span>
              </div>
            );
          })()}
        </div>
      )}

      {/* Stage pipeline */}
      {(() => {
        // Detect cycles: find stages that transition back to an earlier stage
        const wfType = WORKFLOW_TYPES[allDeliverables[deliverableIndex]?.workflowType];
        const transitions = wfType?.defaultBoard?.transitions || {};
        // Find cycle pairs: { from: stageKey, to: stageKey } where 'to' appears earlier in stages
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

        // Build a set: the arrow between stages[i] and stages[i+1] is a cycle
        // if stages[i+1] transitions back to stages[i] (or earlier)
        const cycleArrowAfter = new Set(
          cycles.map(c => c.toIdx) // arrow after the target stage shows cycle
        );

        return (
          <div className="flex flex-wrap gap-1.5 items-center">
            {stages.map((s, i) => {
              const fullKey = `${deliverableIndex}-${s.key}`;
              const isExpanded = expandedStage === fullKey;
              const hasNote = stageNotes?.[s.key];
              const count = stageCounts[s.key] || 0;
              // Show cycle icon for the arrow after this stage if the next stage cycles back
              const showCycleArrow = cycleArrowAfter.has(i);

              return (
                <div key={s.key} className="flex items-center gap-0.5">
                  <button
                    onClick={() => onToggleStage(s.key)}
                    className="relative text-[9px] px-1.5 py-0.5 rounded-full text-white font-medium transition-opacity hover:opacity-80 flex items-center gap-0.5"
                    style={{
                      backgroundColor: s.color,
                      outline: isExpanded
                        ? "2px solid var(--text-primary)"
                        : "none",
                      outlineOffset: "1px",
                    }}
                    title={s.instructions}
                  >
                    {s.requiresHuman && (
                      <svg width="7" height="7" viewBox="0 0 24 24" fill="white" stroke="none">
                        <circle cx="12" cy="7" r="4" />
                        <path d="M5.5 21a6.5 6.5 0 0 1 13 0" />
                      </svg>
                    )}
                    {s.label}
                    {hasNote ? " *" : ""}
                    {count > 0 && (
                      <span className="ml-0.5 inline-flex items-center justify-center min-w-[14px] h-[14px] rounded-full bg-white/30 text-[8px] font-bold">
                        {count}
                      </span>
                    )}
                  </button>
                  {i < stages.length - 1 && (
                    showCycleArrow ? (
                      /* Cycle icon between stages that loop back */
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--text-tertiary)"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        title="Cycles back"
                      >
                        <path d="M17 2l4 4-4 4" />
                        <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                        <path d="M7 22l-4-4 4-4" />
                        <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                      </svg>
                    ) : (
                      /* Normal forward arrow */
                      <svg
                        width="8"
                        height="8"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--text-tertiary)"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                      >
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
            className="mt-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border-color)] p-2 text-[11px] leading-relaxed"
          >
            {s.requiresHuman && (
              <div className="flex items-center gap-1 mb-1.5">
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-semibold uppercase">
                  Human Required
                </span>
              </div>
            )}
            <div className="text-[var(--text-secondary)]">
              {s.instructions}
            </div>
            {s.requiresHuman && s.humanAction && (
              <div className="mt-1.5 pt-1.5 border-t border-[var(--border-color)]">
                <div className="flex items-center gap-1 mb-0.5">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round">
                    <circle cx="12" cy="7" r="4" />
                    <path d="M5.5 21a6.5 6.5 0 0 1 13 0" />
                  </svg>
                  <span className="text-[10px] font-semibold text-amber-400">
                    Your action:
                  </span>
                </div>
                <p className="text-[11px] text-amber-300/80 leading-relaxed">
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
